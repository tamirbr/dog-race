import { v4 as uuid } from "uuid";

export const MAX_LOBBY_PLAYERS = 5;
export const MATCH_QUEUE_TIMEOUT_MS = 30000;
export const MATCH_QUEUE_MIN_HUMANS = 5;
export const TRACK_IDS = [
  "green_park",
  "desert_dash",
  "city_circuit",
  "snowy_peaks",
  "rainbow_bay",
  "starlight_carnival",
];
export const BOT_DOG_IDS = ["zara", "rocky", "luna", "max", "pip", "coco", "bolt"];

const players = new Map();
const nicknames = new Map();
const lobbies = new Map();
const matchQueue = new Set();
const reconnectTokens = new Map();
const friendRequestsOutgoing = new Map();
const friendRequestsIncoming = new Map();
const lobbyInvites = new Map();

let botCounter = 0;

export function randomNickname() {
  let nick;
  do {
    nick = "player" + Math.floor(1000 + Math.random() * 9000);
  } while (nicknames.has(nick));
  return nick;
}

export function publicPlayer(p) {
  if (!p) return null;
  return {
    id: p.id,
    nickname: p.nickname,
    dogId: p.dogId,
    status: p.status,
    lobbyId: p.lobbyId,
    online: p.online,
  };
}

export function createPlayer(socketId, preferredNickname) {
  let nickname = randomNickname();
  if (preferredNickname) {
    const trimmed = String(preferredNickname).trim();
    const key = trimmed.toLowerCase();
    if (trimmed.length >= 2 && trimmed.length <= 16 && /^[a-zA-Z0-9_]+$/.test(trimmed) && !nicknames.has(key)) {
      nickname = trimmed;
    }
  }
  const token = uuid();
  const player = {
    id: socketId,
    nickname,
    dogId: "buddy",
    friends: new Set(),
    lobbyId: null,
    status: "idle",
    online: true,
    reconnectToken: token,
    lastSeen: Date.now(),
  };
  players.set(socketId, player);
  nicknames.set(nickname.toLowerCase(), socketId);
  reconnectTokens.set(token, socketId);
  return player;
}

export function getPlayer(socketId) {
  return players.get(socketId) || null;
}

export function findByNickname(name) {
  const id = nicknames.get(String(name || "").trim().toLowerCase());
  return id ? players.get(id) : null;
}

export function renamePlayer(player, newName) {
  const trimmed = String(newName || "").trim();
  if (!trimmed || trimmed.length < 2 || trimmed.length > 16) {
    return { ok: false, error: "invalid_name" };
  }
  if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
    return { ok: false, error: "invalid_chars" };
  }
  const key = trimmed.toLowerCase();
  if (nicknames.has(key) && nicknames.get(key) !== player.id) {
    return { ok: false, error: "taken" };
  }
  nicknames.delete(player.nickname.toLowerCase());
  player.nickname = trimmed;
  nicknames.set(key, player.id);
  return { ok: true, nickname: trimmed };
}

export function removePlayer(socketId) {
  const player = players.get(socketId);
  if (!player) return null;
  nicknames.delete(player.nickname.toLowerCase());
  reconnectTokens.delete(player.reconnectToken);
  players.delete(socketId);
  matchQueue.delete(socketId);
  friendRequestsOutgoing.delete(socketId);
  friendRequestsIncoming.delete(socketId);
  lobbyInvites.delete(socketId);
  for (const set of friendRequestsOutgoing.values()) set.delete(socketId);
  for (const set of friendRequestsIncoming.values()) set.delete(socketId);
  return player;
}

export function restoreByToken(token) {
  const socketId = reconnectTokens.get(token);
  if (!socketId) return null;
  return players.get(socketId) || null;
}

export function rebindSocket(oldId, newSocketId, player) {
  players.delete(oldId);
  nicknames.set(player.nickname.toLowerCase(), newSocketId);
  reconnectTokens.set(player.reconnectToken, newSocketId);
  player.id = newSocketId;
  player.online = true;
  player.lastSeen = Date.now();
  players.set(newSocketId, player);
  return player;
}

function outgoingSet(playerId) {
  if (!friendRequestsOutgoing.has(playerId)) friendRequestsOutgoing.set(playerId, new Set());
  return friendRequestsOutgoing.get(playerId);
}

function incomingSet(playerId) {
  if (!friendRequestsIncoming.has(playerId)) friendRequestsIncoming.set(playerId, new Set());
  return friendRequestsIncoming.get(playerId);
}

export function areFriends(a, b) {
  if (!a || !b) return false;
  return a.friends.has(b.id);
}

export function listFriends(player) {
  return [...player.friends].map((fid) => publicPlayer(players.get(fid))).filter(Boolean);
}

export function listFriendRequests(player) {
  const incoming = [...incomingSet(player.id)].map((fromId) => {
    const from = players.get(fromId);
    return from ? { id: from.id, nickname: from.nickname } : null;
  }).filter(Boolean);
  const outgoing = [...outgoingSet(player.id)].map((toId) => {
    const to = players.get(toId);
    return to ? { id: to.id, nickname: to.nickname } : null;
  }).filter(Boolean);
  return { incoming, outgoing };
}

export function sendFriendRequest(player, targetNickname) {
  const target = findByNickname(targetNickname);
  if (!target) return { ok: false, error: "not_found" };
  if (target.id === player.id) return { ok: false, error: "self" };
  if (areFriends(player, target)) return { ok: false, error: "already_friends" };
  if (incomingSet(player.id).has(target.id)) {
    return { ok: false, error: "incoming_pending", from: publicPlayer(target) };
  }
  if (outgoingSet(player.id).has(target.id)) return { ok: false, error: "already_sent" };
  outgoingSet(player.id).add(target.id);
  incomingSet(target.id).add(player.id);
  return { ok: true, to: publicPlayer(target) };
}

export function acceptFriendRequest(player, fromId) {
  const from = players.get(fromId);
  if (!from) return { ok: false, error: "not_found" };
  if (!incomingSet(player.id).has(fromId)) return { ok: false, error: "no_request" };
  incomingSet(player.id).delete(fromId);
  outgoingSet(fromId).delete(player.id);
  player.friends.add(from.id);
  from.friends.add(player.id);
  return { ok: true, friend: publicPlayer(from) };
}

export function declineFriendRequest(player, fromId) {
  const from = players.get(fromId);
  if (!from) return { ok: false, error: "not_found" };
  if (!incomingSet(player.id).has(fromId)) return { ok: false, error: "no_request" };
  incomingSet(player.id).delete(fromId);
  outgoingSet(fromId).delete(player.id);
  return { ok: true, from: publicPlayer(from) };
}

export function cancelFriendRequest(player, targetId) {
  const target = players.get(targetId);
  if (!target) return { ok: false, error: "not_found" };
  if (!outgoingSet(player.id).has(targetId)) return { ok: false, error: "no_request" };
  outgoingSet(player.id).delete(targetId);
  incomingSet(targetId).delete(player.id);
  return { ok: true, to: publicPlayer(target) };
}

export function removeFriend(player, friendId) {
  player.friends.delete(friendId);
  const other = players.get(friendId);
  if (other) other.friends.delete(player.id);
  return { ok: true };
}

export function createLobbyInvite(target, lobby, host) {
  lobbyInvites.set(target.id, {
    lobbyId: lobby.id,
    fromId: host.id,
    from: host.nickname,
    trackId: lobby.trackId,
    createdAt: Date.now(),
  });
}

export function getLobbyInvite(targetId) {
  return lobbyInvites.get(targetId) || null;
}

export function clearLobbyInvite(targetId, lobbyId) {
  const invite = lobbyInvites.get(targetId);
  if (invite && (!lobbyId || invite.lobbyId === lobbyId)) lobbyInvites.delete(targetId);
}

export function clearLobbyInvitesForLobby(lobbyId) {
  for (const [targetId, invite] of lobbyInvites.entries()) {
    if (invite.lobbyId === lobbyId) lobbyInvites.delete(targetId);
  }
}

function nextBotName() {
  botCounter += 1;
  return "Bot" + botCounter;
}

export function createLobby(hostId, trackId = "green_park") {
  const id = uuid().slice(0, 8);
  const lobby = {
    id,
    hostId,
    trackId: TRACK_IDS.includes(trackId) ? trackId : "green_park",
    slots: [],
    state: "waiting",
    raceSeed: null,
    invites: new Set(),
    createdAt: Date.now(),
  };
  lobbies.set(id, lobby);
  return lobby;
}

export function getLobby(lobbyId) {
  return lobbies.get(lobbyId) || null;
}

export function deleteLobby(lobbyId) {
  lobbies.delete(lobbyId);
}

export function lobbyHumans(lobby) {
  return lobby.slots.filter((s) => !s.isBot);
}

export function lobbyPlayerCount(lobby) {
  return lobby.slots.length;
}

export function findPlayerSlot(lobby, playerId) {
  return lobby.slots.find((s) => s.id === playerId) || null;
}

export function addHumanToLobby(lobby, player) {
  if (lobbyPlayerCount(lobby) >= MAX_LOBBY_PLAYERS) {
    return { ok: false, error: "full" };
  }
  if (findPlayerSlot(lobby, player.id)) {
    return { ok: true };
  }
  lobby.slots.push({
    id: player.id,
    nickname: player.nickname,
    dogId: player.dogId,
    ready: false,
    isBot: false,
  });
  player.lobbyId = lobby.id;
  player.status = "lobby";
  return { ok: true };
}

export function addBotToLobby(lobby) {
  if (lobbyPlayerCount(lobby) >= MAX_LOBBY_PLAYERS) {
    return { ok: false, error: "full" };
  }
  const dogId = BOT_DOG_IDS[lobby.slots.length % BOT_DOG_IDS.length];
  const bot = {
    id: "bot-" + uuid().slice(0, 8),
    nickname: nextBotName(),
    dogId,
    ready: true,
    isBot: true,
  };
  lobby.slots.push(bot);
  return { ok: true, bot };
}

export function removeBotFromLobby(lobby) {
  for (let i = lobby.slots.length - 1; i >= 0; i--) {
    if (lobby.slots[i].isBot) {
      lobby.slots.splice(i, 1);
      return { ok: true };
    }
  }
  return { ok: false, error: "no_bots" };
}

export function removeFromLobby(lobby, playerId) {
  const idx = lobby.slots.findIndex((s) => s.id === playerId);
  if (idx >= 0) lobby.slots.splice(idx, 1);
  const player = players.get(playerId);
  if (player) {
    player.lobbyId = null;
    player.status = "idle";
    player.ready = false;
  }
}

export function fillBots(lobby) {
  while (lobbyPlayerCount(lobby) < MAX_LOBBY_PLAYERS) {
    addBotToLobby(lobby);
  }
}

export function ensureHost(lobby) {
  if (!lobby.slots.length) return null;
  const hostAlive = lobby.slots.some((s) => s.id === lobby.hostId && !s.isBot);
  if (!hostAlive) {
    const next = lobby.slots.find((s) => !s.isBot);
    if (next) lobby.hostId = next.id;
  }
  return lobby.hostId;
}

export function serializeLobby(lobby, viewerId) {
  return {
    id: lobby.id,
    hostId: lobby.hostId,
    trackId: lobby.trackId,
    state: lobby.state,
    isHost: lobby.hostId === viewerId,
    slots: lobby.slots.map((s) => ({
      id: s.id,
      nickname: s.nickname,
      dogId: s.dogId,
      ready: s.ready,
      isBot: s.isBot,
      online: s.isBot ? true : !!(players.get(s.id)?.online),
    })),
    playerCount: lobby.slots.length,
    maxPlayers: MAX_LOBBY_PLAYERS,
  };
}

export function joinMatchQueue(player) {
  if (player.lobbyId) return { ok: false, error: "in_lobby" };
  matchQueue.add(player.id);
  player.status = "queue";
  return { ok: true };
}

export function leaveMatchQueue(player) {
  matchQueue.delete(player.id);
  if (player.status === "queue") player.status = "idle";
  return { ok: true };
}

export function getMatchQueue() {
  return matchQueue;
}

export function pickRandomTrack() {
  return TRACK_IDS[Math.floor(Math.random() * TRACK_IDS.length)];
}

export function allPlayers() {
  return players;
}

export function allLobbies() {
  return lobbies;
}

export function stats() {
  return {
    players: players.size,
    lobbies: lobbies.size,
    queue: matchQueue.size,
  };
}
