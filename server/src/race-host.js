import { createRace, stepRace, serializeRaceState, RACE_DT } from "../race-engine.js";

const activeRaces = new Map();

export function startHostedRace(lobby, io, getPlayer, emitLobby) {
  stopHostedRace(lobby.id);
  const race = createRace({
    trackId: lobby.trackId,
    seed: lobby.raceSeed,
    slots: lobby.slots,
  });
  race.tick = 0;
  race.inputs = {};
  race.startAt = Date.now() + 3500;
  const host = {
    lobbyId: lobby.id,
    race,
    interval: null,
    emitLobby,
  };
  host.lobby = lobby;
  activeRaces.set(lobby.id, host);
  const payload = {
    lobbyId: lobby.id,
    trackId: lobby.trackId,
    seed: lobby.raceSeed,
    startAt: race.startAt,
    participants: lobby.slots.map((s, i) => ({
      id: s.id,
      nickname: s.nickname,
      dogId: s.dogId,
      isBot: s.isBot,
      slot: i,
    })),
    authority: "server",
  };
  lobby.slots.filter((s) => !s.isBot).forEach((slot) => {
    const p = getPlayer(slot.id);
    if (p) io.to(p.id).emit("race:start", payload);
  });
  host.interval = setInterval(() => tickRace(host, io, getPlayer), RACE_DT * 1000);
  lobby.slots.filter((s) => !s.isBot).forEach((slot) => {
    const p = getPlayer(slot.id);
    if (p) p.status = "racing";
  });
  return host;
}

function tickRace(host, io, getPlayer) {
  const { race, lobbyId } = host;
  if (!race || race.finished) return;
  if (race.startAt && Date.now() < race.startAt) {
    const untilGo = (race.startAt - Date.now()) / 1000;
    race.phase = "countdown";
    race.countdown = untilGo + 3;
    io.to(lobbyId).emit("race:state", serializeRaceState(race));
    return;
  }
  race.tick += 1;
  stepRace(race, race.inputs, RACE_DT);
  const state = serializeRaceState(race);
  io.to(lobbyId).emit("race:state", state);
  if (race.phase === "results" && race.results) {
    io.to(lobbyId).emit("race:results", {
      placements: race.results,
      trackId: race.trackId,
      seed: race.seed,
    });
    stopHostedRace(lobbyId);
    const lobby = host.lobby;
    if (lobby) {
      lobby.state = "waiting";
      lobby.slots.forEach((s) => {
        s.ready = false;
      });
      lobby.slots.filter((s) => !s.isBot).forEach((slot) => {
        const p = getPlayer(slot.id);
        if (p) p.status = "lobby";
      });
      if (host.emitLobby) host.emitLobby(lobby);
    }
  }
}

export function setRaceInput(lobbyId, playerId, input) {
  const host = activeRaces.get(lobbyId);
  if (!host || !host.race || host.race.phase !== "running") return false;
  host.race.inputs[playerId] = {
    laneDelta: input.laneDelta || 0,
    boost: !!(input.boostRequest || input.boost),
    jump: !!input.jump,
  };
  return true;
}

export function stopHostedRace(lobbyId) {
  const host = activeRaces.get(lobbyId);
  if (!host) return;
  if (host.interval) clearInterval(host.interval);
  activeRaces.delete(lobbyId);
}

export function getHostedRace(lobbyId) {
  return activeRaces.get(lobbyId);
}

export function attachLobby(host, lobby) {
  host.lobby = lobby;
}
