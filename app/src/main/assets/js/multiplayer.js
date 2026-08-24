window.DogRace = window.DogRace || {};

(function () {
  const STORAGE_URL = "dograce.mp.url";
  const STORAGE_TOKEN = "dograce.mp.token";
  const Kind = DogRace.ParticipantKind || { LOCAL: "local", AI: "ai", REMOTE: "remote" };

  let available = false;
  let probing = false;
  let socket = null;
  let probeTimer = null;
  let syncTimer = null;
  let lobby = null;
  let friends = [];
  let queueWaiting = false;
  let pendingInvite = null;
  let racePayload = null;
  let playerId = null;
  let onLobbyUpdate = null;
  let onRaceStart = null;
  let onInvite = null;
  let onToast = null;
  let onAvailabilityChange = null;

  function backendUrl() {
    if (DogRace.Config.multiplayer.backendUrl) return DogRace.Config.multiplayer.backendUrl;
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("mp");
    if (fromQuery) return fromQuery;
    try {
      const saved = localStorage.getItem(STORAGE_URL);
      if (saved) return saved;
    } catch (err) {
      /* ignore */
    }
    const host = window.location.hostname || "localhost";
    if (host === "localhost" || host === "127.0.0.1") return "http://localhost:3001";
    return window.location.protocol + "//" + host + ":3001";
  }

  function setBackendUrl(url) {
    DogRace.Config.multiplayer.backendUrl = url;
    try {
      localStorage.setItem(STORAGE_URL, url);
    } catch (err) {
      /* ignore */
    }
  }

  function reconnectToken() {
    try {
      return localStorage.getItem(STORAGE_TOKEN) || "";
    } catch (err) {
      return "";
    }
  }

  function saveToken(token) {
    try {
      localStorage.setItem(STORAGE_TOKEN, token);
    } catch (err) {
      /* ignore */
    }
  }

  function emitToast(msg, icon) {
    if (onToast) onToast(msg, icon);
    else if (DogRace.UI && DogRace.UI.toast) DogRace.UI.toast(msg, icon || "ℹ️");
  }

  function setAvailable(on) {
    if (available === on) return;
    available = on;
    if (onAvailabilityChange) onAvailabilityChange(on);
    if (DogRace.UI && DogRace.UI.setMultiplayerVisible) DogRace.UI.setMultiplayerVisible(on);
  }

  async function probe() {
    if (probing) return available;
    probing = true;
    const url = backendUrl();
    const timeout = DogRace.Config.multiplayer.probeTimeoutMs || 2500;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      const res = await fetch(url.replace(/\/$/, "") + "/health", { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error("bad status");
      const data = await res.json();
      setAvailable(!!data.ok);
    } catch (err) {
      setAvailable(false);
      disconnect();
    }
    probing = false;
    return available;
  }

  function disconnect() {
    if (syncTimer) {
      clearInterval(syncTimer);
      syncTimer = null;
    }
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }
    lobby = null;
    friends = [];
    queueWaiting = false;
    racePayload = null;
  }

  function connect() {
    if (!available || typeof io === "undefined") return Promise.resolve(false);
    if (socket && socket.connected) return Promise.resolve(true);
    return new Promise((resolve) => {
      const url = backendUrl().replace(/\/$/, "");
      socket = io(url, {
        transports: ["websocket", "polling"],
        auth: { token: reconnectToken() },
        reconnection: true,
        reconnectionAttempts: 5,
      });

      const done = (ok) => {
        socket.off("connect", onConnect);
        socket.off("connect_error", onErr);
        resolve(ok);
      };
      const onConnect = () => done(true);
      const onErr = () => done(false);
      socket.on("connect", onConnect);
      socket.on("connect_error", onErr);

      socket.on("connect", () => {
        playerId = socket.id;
      });

      socket.on("session:new", (data) => {
        saveToken(data.token);
        if (DogRace.UI && DogRace.UI.setMpNickname) DogRace.UI.setMpNickname(data.nickname);
      });
      socket.on("session:restored", (data) => {
        saveToken(data.token);
        if (DogRace.UI && DogRace.UI.setMpNickname) DogRace.UI.setMpNickname(data.nickname);
        if (data.lobbyId && data.status === "lobby") {
          /* lobby:update will follow */
        }
      });

      socket.on("friends:list", (list) => {
        friends = list || [];
        if (DogRace.UI && DogRace.UI.renderMpFriends) DogRace.UI.renderMpFriends();
      });

      socket.on("lobby:update", (data) => {
        lobby = data;
        if (onLobbyUpdate) onLobbyUpdate(data);
        if (DogRace.UI && DogRace.UI.renderLobby) DogRace.UI.renderLobby(data);
      });

      socket.on("lobby:invite", (data) => {
        pendingInvite = data;
        if (onInvite) onInvite(data);
        emitToast("Invite from " + data.from + "!", "📨");
        if (DogRace.UI && DogRace.UI.showMpInvite) DogRace.UI.showMpInvite(data);
      });

      socket.on("lobby:kicked", () => {
        lobby = null;
        emitToast("You were removed from the lobby", "🚪");
        if (DogRace.UI && DogRace.UI.onLobbyLeft) DogRace.UI.onLobbyLeft();
      });

      socket.on("queue:status", (data) => {
        queueWaiting = !!data.waiting;
        if (DogRace.UI && DogRace.UI.renderMpQueue) DogRace.UI.renderMpQueue(data);
      });

      socket.on("race:start", (data) => {
        racePayload = data;
        lobby = lobby ? Object.assign({}, lobby, { state: "racing" }) : null;
        if (onRaceStart) onRaceStart(data);
        else if (window.DogRaceApp && DogRaceApp.startMultiplayerRace) DogRaceApp.startMultiplayerRace(data);
      });

      socket.on("race:rejoin", (data) => {
        emitToast("Race in progress — rejoining is not supported in this build", "🏁");
      });

      socket.on("race:peer", (data) => {
        if (window.DogRaceApp && DogRaceApp.applyPeerSync) DogRaceApp.applyPeerSync(data);
      });

      socket.on("disconnect", () => {
        if (lobby && DogRace.UI && DogRace.UI.renderLobby) DogRace.UI.renderLobby(lobby);
      });
    });
  }

  function rpc(event, payload) {
    return new Promise((resolve) => {
      if (!socket || !socket.connected) return resolve({ ok: false, error: "offline" });
      socket.emit(event, payload, resolve);
    });
  }

  DogRace.Multiplayer = {
    Kind,
    isAvailable() {
      return available;
    },
    getBackendUrl: backendUrl,
    setBackendUrl,
    getPlayerId() {
      return playerId || (socket && socket.id) || null;
    },
    getLobby() {
      return lobby;
    },
    getFriends() {
      return friends;
    },
    getPendingInvite() {
      return pendingInvite;
    },
    isQueueWaiting() {
      return queueWaiting;
    },
    onLobbyUpdate(fn) {
      onLobbyUpdate = fn;
    },
    onRaceStart(fn) {
      onRaceStart = fn;
    },
    onInvite(fn) {
      onInvite = fn;
    },
    onToast(fn) {
      onToast = fn;
    },
    onAvailabilityChange(fn) {
      onAvailabilityChange = fn;
    },

    async init() {
      await probe();
      if (available) await connect();
      probeTimer = setInterval(async () => {
        const was = available;
        await probe();
        if (available && !was) await connect();
      }, DogRace.Config.multiplayer.probeIntervalMs || 30000);
    },

    async ensureConnected() {
      if (!available) await probe();
      if (!available) return false;
      if (!socket || !socket.connected) await connect();
      return !!(socket && socket.connected);
    },

    rename(nickname) {
      return rpc("nickname:rename", nickname);
    },

    setDog(dogId) {
      return rpc("dog:set", dogId);
    },

    addFriend(nickname) {
      return rpc("friends:add", nickname);
    },

    removeFriend(friendId) {
      return rpc("friends:remove", friendId);
    },

    searchFriend(nickname) {
      return rpc("friends:search", nickname);
    },

    createLobby(trackId) {
      return rpc("lobby:create", trackId || "green_park");
    },

    joinLobby(lobbyId) {
      return rpc("lobby:join", lobbyId);
    },

    joinFriendLobby(nickname) {
      return rpc("lobby:joinFriend", nickname);
    },

    leaveLobby() {
      return rpc("lobby:leave");
    },

    inviteFriend(nickname) {
      return rpc("lobby:invite", nickname);
    },

    setTrack(trackId) {
      return rpc("lobby:setTrack", trackId);
    },

    addBot() {
      return rpc("lobby:addBot");
    },

    removeBot() {
      return rpc("lobby:removeBot");
    },

    kickPlayer(targetId) {
      return rpc("lobby:kick", targetId);
    },

    setReady(ready) {
      return rpc("lobby:ready", ready);
    },

    startRace() {
      return rpc("lobby:start");
    },

    joinQueue() {
      return rpc("queue:join");
    },

    leaveQueue() {
      return rpc("queue:leave");
    },

    acceptInvite() {
      if (!pendingInvite) return Promise.resolve({ ok: false });
      const id = pendingInvite.lobbyId;
      pendingInvite = null;
      return this.joinLobby(id);
    },

  async quitLobbyAndMenu() {
      await this.leaveQueue();
      await this.leaveLobby();
      lobby = null;
      queueWaiting = false;
      if (DogRace.UI && DogRace.UI.onLobbyLeft) DogRace.UI.onLobbyLeft();
    },

    startSyncLoop(race, playerId) {
      if (syncTimer) clearInterval(syncTimer);
      const ms = DogRace.Config.multiplayer.syncIntervalMs || 100;
      syncTimer = setInterval(() => {
        if (!socket || !socket.connected || !race || !race.player) return;
        const p = race.player;
        socket.emit("race:sync", {
          z: p.z,
          lane: p.lane,
          x: p.x,
          speed: p.speed,
          finished: p.finished,
          finishPlace: p.finishPlace,
          boosting: p.boosting,
          jumpHeight: p.jumpHeight,
        });
      }, ms);
    },

    stopSyncLoop() {
      if (syncTimer) {
        clearInterval(syncTimer);
        syncTimer = null;
      }
    },

    reportFinish(place, time) {
      return rpc("race:done", { place, time });
    },

    buildRaceFromPayload(payload, localPlayerId, localDogId) {
      const pid = localPlayerId || playerId;
      const track = DogRace.trackById(payload.trackId) || DogRace.Tracks[0];
      const participants = (payload.participants || []).map((spec, i) => {
        const isLocal = spec.id === pid;
        const kind = spec.isBot ? Kind.AI : isLocal ? Kind.LOCAL : Kind.REMOTE;
        const lanes = [1, 0, 2, 0, 2];
        return {
          id: spec.id,
          kind,
          dogId: isLocal ? localDogId : spec.dogId,
          name: spec.nickname,
          lane: lanes[i % lanes.length],
          z: 200 + (i % 3) * 80,
          isBot: spec.isBot,
        };
      });
      return DogRace.createRace({
        track,
        playerDogId: localDogId,
        fieldSize: participants.length,
        participants,
        seed: payload.seed,
        multiplayer: true,
        startAt: payload.startAt,
      });
    },
  };
})();
