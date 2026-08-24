window.DogRace = window.DogRace || {};

(function () {
  const STORAGE_URL = "dograce.mp.url";
  const STORAGE_TOKEN = "dograce.mp.token";
  const STORAGE_NICKNAME = "dograce.mp.nickname";
  const Kind = DogRace.ParticipantKind || { LOCAL: "local", AI: "ai", REMOTE: "remote" };

  let available = false;
  let probing = false;
  let socket = null;
  let probeTimer = null;
  let syncTimer = null;
  let lobby = null;
  let friends = [];
  let friendRequests = { incoming: [], outgoing: [] };
  let queueWaiting = false;
  let pendingInvite = null;
  let racePayload = null;
  let latestRaceState = null;
  let latestRaceResults = null;
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

  function savedNickname() {
    try {
      return localStorage.getItem(STORAGE_NICKNAME) || "";
    } catch (err) {
      return "";
    }
  }

  function saveNickname(name) {
    if (!name) return;
    try {
      localStorage.setItem(STORAGE_NICKNAME, name);
    } catch (err) {
      /* ignore */
    }
  }

  async function restoreNickname(data) {
    const saved = savedNickname();
    if (saved && saved !== data.nickname) {
      const res = await rpc("nickname:rename", saved);
      if (res.ok) {
        saveNickname(res.nickname);
        if (DogRace.UI && DogRace.UI.setMpNickname) DogRace.UI.setMpNickname(res.nickname);
        return res.nickname;
      }
    }
    if (data.nickname) saveNickname(data.nickname);
    return data.nickname;
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
    friendRequests = { incoming: [], outgoing: [] };
    queueWaiting = false;
    pendingInvite = null;
    racePayload = null;
  }

  function connect() {
    if (!available || typeof io === "undefined") return Promise.resolve(false);
    if (socket && socket.connected) return Promise.resolve(true);
    return new Promise((resolve) => {
      const url = backendUrl().replace(/\/$/, "");
      socket = io(url, {
        transports: ["websocket", "polling"],
        auth: { token: reconnectToken(), nickname: savedNickname() || undefined },
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

      socket.on("session:new", async (data) => {
        saveToken(data.token);
        const nick = await restoreNickname(data);
        if (DogRace.UI && DogRace.UI.setMpNickname) DogRace.UI.setMpNickname(nick);
      });
      socket.on("session:restored", async (data) => {
        saveToken(data.token);
        const nick = await restoreNickname(data);
        if (DogRace.UI && DogRace.UI.setMpNickname) DogRace.UI.setMpNickname(nick);
        if (data.lobbyId && data.status === "lobby") {
          /* lobby:update will follow */
        }
      });

      socket.on("friends:list", (list) => {
        friends = list || [];
        if (DogRace.UI && DogRace.UI.renderMpFriends) DogRace.UI.renderMpFriends();
        if (DogRace.UI && DogRace.UI.renderLobbyFriends) DogRace.UI.renderLobbyFriends();
      });

      socket.on("friends:requests", (data) => {
        friendRequests = data || { incoming: [], outgoing: [] };
        if (DogRace.UI && DogRace.UI.renderMpFriendRequests) DogRace.UI.renderMpFriendRequests();
      });

      socket.on("friends:request", (data) => {
        emitToast((data.from && data.from.nickname ? data.from.nickname : "Someone") + " sent a friend request", "🐾");
        if (DogRace.UI && DogRace.UI.renderMpFriendRequests) DogRace.UI.renderMpFriendRequests();
      });

      socket.on("lobby:update", (data) => {
        lobby = data;
        if (onLobbyUpdate) onLobbyUpdate(data);
        if (DogRace.UI && DogRace.UI.renderLobby) DogRace.UI.renderLobby(data);
      });

      socket.on("lobby:invite", (data) => {
        pendingInvite = data;
        if (onInvite) onInvite(data);
        emitToast("Lobby invite from " + (data.from || "friend") + "!", "📨");
        if (DogRace.UI && DogRace.UI.showMpInvite) DogRace.UI.showMpInvite(data);
      });

      socket.on("lobby:inviteDeclined", (data) => {
        emitToast((data.nickname || "Friend") + " declined your lobby invite", "🙅");
        if (DogRace.UI && DogRace.UI.renderLobbyFriends) DogRace.UI.renderLobbyFriends(data.nickname);
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
        latestRaceState = null;
        latestRaceResults = null;
        lobby = lobby ? Object.assign({}, lobby, { state: "racing" }) : null;
        if (onRaceStart) onRaceStart(data);
        else if (window.DogRaceApp && DogRaceApp.startMultiplayerRace) DogRaceApp.startMultiplayerRace(data);
      });

      socket.on("race:state", (state) => {
        latestRaceState = state;
        if (window.DogRaceApp && DogRaceApp.applyServerRaceState) DogRaceApp.applyServerRaceState(state);
      });

      socket.on("race:results", (data) => {
        latestRaceResults = data;
        if (window.DogRaceApp && DogRaceApp.finishMultiplayerResults) DogRaceApp.finishMultiplayerResults(data);
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
    getFriendRequests() {
      return friendRequests;
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
      return rpc("nickname:rename", nickname).then((res) => {
        if (res.ok && res.nickname) saveNickname(res.nickname);
        return res;
      });
    },

    setDog(dogId) {
      return rpc("dog:set", dogId);
    },

    requestFriend(nickname) {
      return rpc("friends:request", nickname);
    },

    acceptFriendRequest(fromId) {
      return rpc("friends:accept", fromId);
    },

    declineFriendRequest(fromId) {
      return rpc("friends:decline", fromId);
    },

    cancelFriendRequest(targetId) {
      return rpc("friends:cancel", targetId);
    },

    removeFriend(friendId) {
      return rpc("friends:remove", friendId);
    },

    searchFriend(nickname) {
      return rpc("friends:search", nickname);
    },

    createLobby(trackId) {
      return rpc("lobby:create", trackId || "green_park").then((res) => {
        if (res.ok && res.lobby) lobby = res.lobby;
        return res;
      });
    },

    joinLobby(lobbyId) {
      return rpc("lobby:join", lobbyId).then((res) => {
        if (res.ok && res.lobby) lobby = res.lobby;
        return res;
      });
    },

    joinFriendLobby(nickname) {
      return rpc("lobby:joinFriend", nickname);
    },

    leaveLobby() {
      return rpc("lobby:leave");
    },

    inviteFriend(friendId) {
      return rpc("lobby:invite", friendId);
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
      return rpc("lobby:acceptInvite", id).then((res) => {
        if (res.ok) {
          pendingInvite = null;
          if (res.lobby) lobby = res.lobby;
          if (DogRace.UI && DogRace.UI.hideMpInvite) DogRace.UI.hideMpInvite();
        }
        return res;
      });
    },

    declineInvite() {
      if (!pendingInvite) return Promise.resolve({ ok: false });
      const id = pendingInvite.lobbyId;
      return rpc("lobby:declineInvite", id).then((res) => {
        if (res.ok) {
          pendingInvite = null;
          if (DogRace.UI && DogRace.UI.hideMpInvite) DogRace.UI.hideMpInvite();
        }
        return res;
      });
    },

  async quitLobbyAndMenu() {
      await this.leaveQueue();
      await this.leaveLobby();
      lobby = null;
      queueWaiting = false;
      if (DogRace.UI && DogRace.UI.onLobbyLeft) DogRace.UI.onLobbyLeft();
    },

    sendRaceInput(input) {
      if (!socket || !socket.connected) return;
      socket.emit("race:input", input || {});
    },

    stopSyncLoop() {
      if (syncTimer) {
        clearInterval(syncTimer);
        syncTimer = null;
      }
      latestRaceState = null;
      latestRaceResults = null;
    },

    getLatestRaceState() {
      return latestRaceState;
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
        serverAuthority: payload.authority === "server",
      });
    },
  };
})();
