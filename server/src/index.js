import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import {
  MAX_LOBBY_PLAYERS,
  MATCH_QUEUE_TIMEOUT_MS,
  MATCH_QUEUE_MIN_HUMANS,
  TRACK_IDS,
  addBotToLobby,
  addHumanToLobby,
  areFriends,
  acceptFriendRequest,
  cancelFriendRequest,
  clearLobbyInvite,
  clearLobbyInvitesForLobby,
  createLobby,
  createLobbyInvite,
  createPlayer,
  declineFriendRequest,
  deleteLobby,
  ensureHost,
  fillBots,
  findByNickname,
  findPlayerSlot,
  getLobby,
  getLobbyInvite,
  getMatchQueue,
  getPlayer,
  joinMatchQueue,
  leaveMatchQueue,
  listFriendRequests,
  listFriends,
  lobbyHumans,
  lobbyPlayerCount,
  publicPlayer,
  rebindSocket,
  removeBotFromLobby,
  removeFriend,
  removeFromLobby,
  removePlayer,
  renamePlayer,
  restoreByToken,
  sendFriendRequest,
  serializeLobby,
  stats,
  pickRandomTrack,
} from "./state.js";

const PORT = Number(process.env.PORT || 3001);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const VERSION = "1.0.0";

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "dog-race-multiplayer",
    version: VERSION,
    uptime: process.uptime(),
    ...stats(),
  });
});

app.get("/ping", (_req, res) => {
  res.json({ pong: true, ts: Date.now() });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CORS_ORIGIN, methods: ["GET", "POST"] },
  pingInterval: 10000,
  pingTimeout: 20000,
});

function emitLobby(lobby) {
  lobbyHumans(lobby).forEach((slot) => {
    const p = getPlayer(slot.id);
    if (p?.online) {
      io.to(p.id).emit("lobby:update", serializeLobby(lobby, p.id));
    }
  });
}

function emitFriends(player) {
  io.to(player.id).emit("friends:list", listFriends(player));
}

function emitFriendRequests(player) {
  io.to(player.id).emit("friends:requests", listFriendRequests(player));
}

function emitFriendRequestNotice(target, from) {
  io.to(target.id).emit("friends:request", {
    from: publicPlayer(from),
  });
}

function leaveLobby(player, notify = true) {
  if (!player?.lobbyId) return;
  const lobby = getLobby(player.lobbyId);
  if (!lobby) {
    player.lobbyId = null;
    player.status = "idle";
    return;
  }
  removeFromLobby(lobby, player.id);
  if (!lobby.slots.length) {
    clearLobbyInvitesForLobby(lobby.id);
    deleteLobby(lobby.id);
    return;
  }
  ensureHost(lobby);
  if (notify) emitLobby(lobby);
}

function startRace(lobby, trackId) {
  lobby.state = "racing";
  lobby.trackId = trackId || lobby.trackId;
  lobby.raceSeed = Math.floor(Math.random() * 2147483647);
  const startAt = Date.now() + 3500;
  const payload = {
    lobbyId: lobby.id,
    trackId: lobby.trackId,
    seed: lobby.raceSeed,
    startAt,
    participants: lobby.slots.map((s, i) => ({
      id: s.id,
      nickname: s.nickname,
      dogId: s.dogId,
      isBot: s.isBot,
      slot: i,
    })),
  };
  lobbyHumans(lobby).forEach((slot) => {
    const p = getPlayer(slot.id);
    if (p) {
      p.status = "racing";
      io.to(p.id).emit("race:start", payload);
    }
  });
  emitLobby(lobby);
}

const queueJoinedAt = new Map();

function tryMatchmake() {
  const queue = [...getMatchQueue()];
  if (queue.length < 1) return;

  const ready = queue.filter((id) => {
    const p = getPlayer(id);
    return p && p.online && p.status === "queue" && !p.lobbyId;
  });

  if (ready.length >= MATCH_QUEUE_MIN_HUMANS) {
    const group = ready.slice(0, MAX_LOBBY_PLAYERS);
    const host = getPlayer(group[0]);
    const lobby = createLobby(host.id, pickRandomTrack());
    group.forEach((pid) => {
      const p = getPlayer(pid);
      if (!p) return;
      leaveMatchQueue(p);
      queueJoinedAt.delete(pid);
      addHumanToLobby(lobby, p);
      const slot = findPlayerSlot(lobby, p.id);
      if (slot) slot.ready = true;
    });
    fillBots(lobby);
    startRace(lobby, lobby.trackId);
    return;
  }

  const now = Date.now();
  ready.forEach((id) => {
    if (!queueJoinedAt.has(id)) queueJoinedAt.set(id, now);
  });
  const oldest = ready
    .filter((id) => now - (queueJoinedAt.get(id) || now) >= MATCH_QUEUE_TIMEOUT_MS)
    .slice(0, MAX_LOBBY_PLAYERS);
  if (oldest.length >= 2) {
    const host = getPlayer(oldest[0]);
    const lobby = createLobby(host.id, pickRandomTrack());
    oldest.forEach((pid) => {
      const p = getPlayer(pid);
      if (!p) return;
      leaveMatchQueue(p);
      queueJoinedAt.delete(pid);
      addHumanToLobby(lobby, p);
      const slot = findPlayerSlot(lobby, p.id);
      if (slot) slot.ready = true;
    });
    fillBots(lobby);
    startRace(lobby, lobby.trackId);
  }
}

setInterval(tryMatchmake, 2000);

io.on("connection", (socket) => {
  const token = socket.handshake.auth?.token;
  let player = token ? restoreByToken(token) : null;

  if (player) {
    rebindSocket(player.id, socket.id, player);
    player = getPlayer(socket.id);
    socket.emit("session:restored", {
      nickname: player.nickname,
      token: player.reconnectToken,
      dogId: player.dogId,
      lobbyId: player.lobbyId,
      status: player.status,
    });
    if (player.lobbyId) {
      const lobby = getLobby(player.lobbyId);
      if (lobby) {
        socket.emit("lobby:update", serializeLobby(lobby, player.id));
        if (lobby.state === "racing") {
          socket.emit("race:rejoin", {
            lobbyId: lobby.id,
            trackId: lobby.trackId,
            seed: lobby.raceSeed,
          });
        }
      } else {
        player.lobbyId = null;
        player.status = "idle";
      }
    }
  } else {
    player = createPlayer(socket.id);
    socket.emit("session:new", {
      nickname: player.nickname,
      token: player.reconnectToken,
      dogId: player.dogId,
    });
  }

  socket.emit("friends:list", listFriends(player));
  socket.emit("friends:requests", listFriendRequests(player));
  const pendingLobbyInvite = getLobbyInvite(player.id);
  if (pendingLobbyInvite) {
    socket.emit("lobby:invite", pendingLobbyInvite);
  }

  socket.on("nickname:rename", (name, cb) => {
    const res = renamePlayer(player, name);
    if (res.ok) {
      io.emit("players:refresh");
      if (player.lobbyId) {
        const lobby = getLobby(player.lobbyId);
        const slot = findPlayerSlot(lobby, player.id);
        if (slot) slot.nickname = player.nickname;
        emitLobby(lobby);
      }
    }
    cb?.(res);
  });

  socket.on("dog:set", (dogId, cb) => {
    player.dogId = String(dogId || "buddy");
    if (player.lobbyId) {
      const lobby = getLobby(player.lobbyId);
      const slot = findPlayerSlot(lobby, player.id);
      if (slot) slot.dogId = player.dogId;
      emitLobby(lobby);
    }
    cb?.({ ok: true, dogId: player.dogId });
  });

  socket.on("friends:request", (nickname, cb) => {
    const res = sendFriendRequest(player, nickname);
    if (res.ok) {
      emitFriendRequests(player);
      const target = findByNickname(nickname);
      if (target) {
        emitFriendRequests(target);
        emitFriendRequestNotice(target, player);
      }
    }
    cb?.(res);
  });

  socket.on("friends:accept", (fromId, cb) => {
    const res = acceptFriendRequest(player, fromId);
    if (res.ok) {
      emitFriends(player);
      emitFriendRequests(player);
      const from = getPlayer(fromId);
      if (from) {
        emitFriends(from);
        emitFriendRequests(from);
      }
    }
    cb?.(res);
  });

  socket.on("friends:decline", (fromId, cb) => {
    const res = declineFriendRequest(player, fromId);
    if (res.ok) {
      emitFriendRequests(player);
      const from = getPlayer(fromId);
      if (from) emitFriendRequests(from);
    }
    cb?.(res);
  });

  socket.on("friends:cancel", (targetId, cb) => {
    const res = cancelFriendRequest(player, targetId);
    if (res.ok) {
      emitFriendRequests(player);
      const target = getPlayer(targetId);
      if (target) emitFriendRequests(target);
    }
    cb?.(res);
  });

  socket.on("friends:remove", (friendId, cb) => {
    removeFriend(player, friendId);
    emitFriends(player);
    cb?.({ ok: true });
  });

  socket.on("friends:search", (nickname, cb) => {
    const target = findByNickname(nickname);
    cb?.(target ? publicPlayer(target) : null);
  });

  socket.on("lobby:create", (trackId, cb) => {
    leaveMatchQueue(player);
    leaveLobby(player, false);
    const lobby = createLobby(player.id, trackId);
    addHumanToLobby(lobby, player);
    socket.join(lobby.id);
    emitLobby(lobby);
    cb?.({ ok: true, lobby: serializeLobby(lobby, player.id) });
  });

  socket.on("lobby:join", (lobbyId, cb) => {
    leaveMatchQueue(player);
    leaveLobby(player, false);
    const lobby = getLobby(lobbyId);
    if (!lobby) return cb?.({ ok: false, error: "not_found" });
    if (lobby.state !== "waiting") return cb?.({ ok: false, error: "in_progress" });
    const res = addHumanToLobby(lobby, player);
    if (!res.ok) return cb?.(res);
    socket.join(lobby.id);
    emitLobby(lobby);
    cb?.({ ok: true, lobby: serializeLobby(lobby, player.id) });
  });

  socket.on("lobby:joinFriend", (nickname, cb) => {
    const friend = findByNickname(nickname);
    if (!friend?.lobbyId) return cb?.({ ok: false, error: "no_lobby" });
    socket.emit("lobby:join", friend.lobbyId, cb);
  });

  socket.on("lobby:leave", (_data, cb) => {
    leaveLobby(player);
    cb?.({ ok: true });
  });

  socket.on("lobby:invite", (friendId, cb) => {
    const lobby = getLobby(player.lobbyId);
    if (!lobby || lobby.hostId !== player.id) {
      return cb?.({ ok: false, error: "not_host" });
    }
    if (lobby.state !== "waiting") return cb?.({ ok: false, error: "in_progress" });
    const target = getPlayer(friendId);
    if (!target) return cb?.({ ok: false, error: "not_found" });
    if (!areFriends(player, target)) return cb?.({ ok: false, error: "not_friend" });
    if (findPlayerSlot(lobby, target.id)) return cb?.({ ok: false, error: "already_in_lobby" });
    const invite = {
      lobbyId: lobby.id,
      fromId: player.id,
      from: player.nickname,
      trackId: lobby.trackId,
    };
    createLobbyInvite(target, lobby, player);
    io.to(target.id).emit("lobby:invite", invite);
    cb?.({ ok: true, invite });
  });

  socket.on("lobby:acceptInvite", (lobbyId, cb) => {
    const invite = getLobbyInvite(player.id);
    if (!invite || invite.lobbyId !== lobbyId) return cb?.({ ok: false, error: "no_invite" });
    leaveMatchQueue(player);
    leaveLobby(player, false);
    const lobby = getLobby(lobbyId);
    if (!lobby) {
      clearLobbyInvite(player.id, lobbyId);
      return cb?.({ ok: false, error: "not_found" });
    }
    if (lobby.state !== "waiting") {
      clearLobbyInvite(player.id, lobbyId);
      return cb?.({ ok: false, error: "in_progress" });
    }
    const res = addHumanToLobby(lobby, player);
    if (!res.ok) return cb?.(res);
    clearLobbyInvite(player.id, lobbyId);
    socket.join(lobby.id);
    emitLobby(lobby);
    cb?.({ ok: true, lobby: serializeLobby(lobby, player.id) });
  });

  socket.on("lobby:declineInvite", (lobbyId, cb) => {
    const invite = getLobbyInvite(player.id);
    if (!invite || invite.lobbyId !== lobbyId) return cb?.({ ok: false, error: "no_invite" });
    clearLobbyInvite(player.id, lobbyId);
    const host = getPlayer(invite.fromId);
    if (host) {
      io.to(host.id).emit("lobby:inviteDeclined", {
        lobbyId,
        nickname: player.nickname,
      });
    }
    cb?.({ ok: true });
  });

  socket.on("lobby:setTrack", (trackId, cb) => {
    const lobby = getLobby(player.lobbyId);
    if (!lobby || lobby.hostId !== player.id) {
      return cb?.({ ok: false, error: "not_host" });
    }
    if (!TRACK_IDS.includes(trackId)) return cb?.({ ok: false, error: "bad_track" });
    lobby.trackId = trackId;
    emitLobby(lobby);
    cb?.({ ok: true });
  });

  socket.on("lobby:addBot", (_d, cb) => {
    const lobby = getLobby(player.lobbyId);
    if (!lobby || lobby.hostId !== player.id) return cb?.({ ok: false, error: "not_host" });
    const res = addBotToLobby(lobby);
    if (res.ok) emitLobby(lobby);
    cb?.(res);
  });

  socket.on("lobby:removeBot", (_d, cb) => {
    const lobby = getLobby(player.lobbyId);
    if (!lobby || lobby.hostId !== player.id) return cb?.({ ok: false, error: "not_host" });
    const res = removeBotFromLobby(lobby);
    if (res.ok) emitLobby(lobby);
    cb?.(res);
  });

  socket.on("lobby:kick", (targetId, cb) => {
    const lobby = getLobby(player.lobbyId);
    if (!lobby || lobby.hostId !== player.id) return cb?.({ ok: false, error: "not_host" });
    const slot = findPlayerSlot(lobby, targetId);
    if (!slot || slot.isBot) return cb?.({ ok: false, error: "invalid" });
    removeFromLobby(lobby, targetId);
    io.to(targetId).emit("lobby:kicked", { lobbyId: lobby.id });
    emitLobby(lobby);
    cb?.({ ok: true });
  });

  socket.on("lobby:ready", (ready, cb) => {
    const lobby = getLobby(player.lobbyId);
    if (!lobby) return cb?.({ ok: false, error: "no_lobby" });
    const slot = findPlayerSlot(lobby, player.id);
    if (!slot) return cb?.({ ok: false, error: "not_in_lobby" });
    slot.ready = !!ready;
    emitLobby(lobby);
    cb?.({ ok: true });
  });

  socket.on("lobby:start", (_d, cb) => {
    const lobby = getLobby(player.lobbyId);
    if (!lobby || lobby.hostId !== player.id) return cb?.({ ok: false, error: "not_host" });
    if (lobby.state !== "waiting") return cb?.({ ok: false, error: "already_started" });
    const humans = lobbyHumans(lobby);
    if (!humans.every((s) => s.ready)) return cb?.({ ok: false, error: "not_ready" });
    fillBots(lobby);
    startRace(lobby);
    cb?.({ ok: true });
  });

  socket.on("queue:join", (_d, cb) => {
    if (player.lobbyId) return cb?.({ ok: false, error: "in_lobby" });
    joinMatchQueue(player);
    queueJoinedAt.set(player.id, Date.now());
    socket.emit("queue:status", { waiting: true, players: getMatchQueue().size });
    cb?.({ ok: true });
  });

  socket.on("queue:leave", (_d, cb) => {
    leaveMatchQueue(player);
    queueJoinedAt.delete(player.id);
    socket.emit("queue:status", { waiting: false });
    cb?.({ ok: true });
  });

  socket.on("race:sync", (data) => {
    const lobby = getLobby(player.lobbyId);
    if (!lobby || lobby.state !== "racing") return;
    socket.to(lobby.id).emit("race:peer", {
      id: player.id,
      z: data.z,
      lane: data.lane,
      x: data.x,
      speed: data.speed,
      finished: data.finished,
      finishPlace: data.finishPlace,
      boosting: data.boosting,
      jumpHeight: data.jumpHeight,
    });
  });

  socket.on("race:done", (data, cb) => {
    const lobby = getLobby(player.lobbyId);
    if (!lobby) return cb?.({ ok: false });
    const slot = findPlayerSlot(lobby, player.id);
    if (slot) {
      slot.finishPlace = data.place;
      slot.finishTime = data.time;
    }
    const humans = lobbyHumans(lobby);
    const allDone = humans.every((s) => s.finishPlace || s.finished);
    if (allDone) {
      lobby.state = "waiting";
      lobby.slots.forEach((s) => {
        s.ready = false;
        s.finishPlace = 0;
      });
      emitLobby(lobby);
    }
    cb?.({ ok: true });
  });

  socket.on("disconnect", () => {
    if (!player) return;
    player.online = false;
    player.lastSeen = Date.now();
    leaveMatchQueue(player);
    if (player.lobbyId) {
      const lobby = getLobby(player.lobbyId);
      if (lobby) emitLobby(lobby);
    }
    setTimeout(() => {
      const current = getPlayer(socket.id);
      if (current && !current.online) {
        leaveLobby(current, true);
        removePlayer(socket.id);
      }
    }, 120000);
  });
});

server.listen(PORT, () => {
  console.log(`DOG RACE multiplayer server on http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
});
