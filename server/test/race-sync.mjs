import { io } from "socket.io-client";

const URL = process.env.MP_URL || "http://localhost:3001";
const suffix = Date.now().toString().slice(-4);

function rpc(socket, event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, resolve);
  });
}

function once(socket, event, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout " + event)), timeout);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

async function connect(label, nickname) {
  const socket = io(URL, {
    transports: ["websocket"],
    forceNew: true,
    auth: { nickname },
  });
  const sessionP = Promise.race([once(socket, "session:new"), once(socket, "session:restored")]);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label + " connect timeout")), 5000);
    socket.on("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.on("connect_error", reject);
  });
  await sessionP;
  await rpc(socket, "nickname:rename", nickname);
  return socket;
}

async function main() {
  const nickA = "racerA" + suffix;
  const nickB = "racerB" + suffix;
  const a = await connect("A", nickA);
  const b = await connect("B", nickB);

  const bReqP = once(b, "friends:requests");
  const req = await rpc(a, "friends:request", nickB);
  if (!req.ok) throw new Error("friend request failed: " + req.error);
  const bReq = await bReqP;

  const aFriendsP = once(a, "friends:list");
  const bFriendsP = once(b, "friends:list");
  await rpc(b, "friends:accept", bReq.incoming[0].id);
  const [aFriends, bFriends] = await Promise.all([aFriendsP, bFriendsP]);
  const bFriend = aFriends.find((f) => f.nickname === nickB);
  if (!bFriend) throw new Error("B missing from A friends list");
  if (!bFriends.some((f) => f.nickname === nickA)) throw new Error("A missing from B friends list");

  const lobbyRes = await rpc(a, "lobby:create", "green_park");
  const inviteP = once(b, "lobby:invite");
  const inviteRes = await rpc(a, "lobby:invite", bFriend.id);
  if (!inviteRes.ok) throw new Error("invite failed: " + inviteRes.error);
  await inviteP;
  const joinRes = await rpc(b, "lobby:acceptInvite", lobbyRes.lobby.id);
  if (!joinRes.ok) throw new Error("join failed");

  await rpc(a, "lobby:ready", true);
  await rpc(b, "lobby:ready", true);

  const startA = once(a, "race:start");
  const startB = once(b, "race:start");
  await rpc(a, "lobby:start");
  const raceA = await startA;
  const raceB = await startB;
  if (raceA.seed !== raceB.seed) throw new Error("seed mismatch");
  if (raceA.authority !== "server") throw new Error("expected server authority");

  let statesA = 0;
  let statesB = 0;
  const resultsA = once(a, "race:results", 120000);
  const resultsB = once(b, "race:results", 120000);
  a.on("race:state", () => {
    statesA += 1;
  });
  b.on("race:state", () => {
    statesB += 1;
  });

  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    a.emit("race:input", { laneDelta: 1, boost: false, jump: false });
    b.emit("race:input", { laneDelta: -1, boost: true, jump: false });
    await new Promise((r) => setTimeout(r, 50));
    if (statesA > 30 && statesB > 30) break;
  }
  if (statesA < 10 || statesB < 10) throw new Error("insufficient race:state ticks A=" + statesA + " B=" + statesB);

  const [resA, resB] = await Promise.all([resultsA, resultsB]);
  const orderA = resA.placements.map((p) => p.nickname + ":" + p.place).join(",");
  const orderB = resB.placements.map((p) => p.nickname + ":" + p.place).join(",");
  if (orderA !== orderB) throw new Error("finish order mismatch: " + orderA + " vs " + orderB);

  a.disconnect();
  b.disconnect();
  console.log("RACE SYNC OK", { statesA, statesB, order: orderA, seed: raceA.seed });
}

main().catch((err) => {
  console.error("RACE SYNC FAILED", err.message);
  process.exit(1);
});
