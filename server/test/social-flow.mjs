import { io } from "socket.io-client";

const URL = process.env.MP_URL || "http://localhost:3001";

function rpc(socket, event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, resolve);
  });
}

function next(socket, event, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for " + event)), timeout);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

async function connectClient(label) {
  const socket = io(URL, { transports: ["websocket"], forceNew: true });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label + " connect timeout")), 5000);
    socket.on("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.on("connect_error", reject);
  });
  await Promise.race([next(socket, "session:new"), next(socket, "session:restored")]);
  return socket;
}

async function main() {
  const a = await connectClient("A");
  const b = await connectClient("B");

  await rpc(a, "nickname:rename", "testerA");
  await rpc(b, "nickname:rename", "testerB");

  const bReqPromise = next(b, "friends:requests");
  const req = await rpc(a, "friends:request", "testerB");
  if (!req.ok) throw new Error("A request to B failed: " + req.error);
  const bReq = await bReqPromise;
  if (!bReq.incoming.some((x) => x.nickname === "testerA")) {
    throw new Error("B did not see incoming request from A");
  }

  const decline = await rpc(b, "friends:decline", bReq.incoming[0].id);
  if (!decline.ok) throw new Error("B decline failed");

  const bReq2Promise = next(b, "friends:requests");
  const req2 = await rpc(a, "friends:request", "testerB");
  if (!req2.ok) throw new Error("A re-request failed: " + req2.error);
  const bReq2 = await bReq2Promise;

  const aFriendsPromise = next(a, "friends:list");
  const bFriendsPromise = next(b, "friends:list");
  const accept = await rpc(b, "friends:accept", bReq2.incoming[0].id);
  if (!accept.ok) throw new Error("B accept failed: " + accept.error);
  const aFriends = await aFriendsPromise;
  const bFriends = await bFriendsPromise;
  if (!aFriends.some((f) => f.nickname === "testerB")) throw new Error("A missing B as friend");
  if (!bFriends.some((f) => f.nickname === "testerA")) throw new Error("B missing A as friend");

  const lobbyRes = await rpc(a, "lobby:create", "green_park");
  if (!lobbyRes.ok) throw new Error("A create lobby failed");

  const aFriend = aFriends.find((f) => f.nickname === "testerB");
  const invitePromise = next(b, "lobby:invite");
  const inviteRes = await rpc(a, "lobby:invite", aFriend.id);
  if (!inviteRes.ok) throw new Error("A invite B failed: " + inviteRes.error);
  const invite = await invitePromise;

  const declinedPromise = next(a, "lobby:inviteDeclined");
  const declineInvite = await rpc(b, "lobby:declineInvite", invite.lobbyId);
  if (!declineInvite.ok) throw new Error("B decline lobby invite failed");
  const declinedNotice = await declinedPromise;
  if (declinedNotice.nickname !== "testerB") throw new Error("A did not get decline notice");

  const invite2Promise = next(b, "lobby:invite");
  const inviteRes2 = await rpc(a, "lobby:invite", aFriend.id);
  if (!inviteRes2.ok) throw new Error("A second invite failed");
  const invite2 = await invite2Promise;

  const joinRes = await rpc(b, "lobby:acceptInvite", invite2.lobbyId);
  if (!joinRes.ok) throw new Error("B accept lobby failed: " + joinRes.error);
  if (!joinRes.lobby.slots.some((s) => s.nickname === "testerB")) {
    throw new Error("B not in lobby after accept");
  }

  a.disconnect();
  b.disconnect();

  console.log("SOCIAL FLOW OK", {
    friends: ["testerA", "testerB"],
    lobby: lobbyRes.lobby.id,
    declinedBy: declinedNotice.nickname,
    lobbyPlayers: joinRes.lobby.slots.map((s) => s.nickname),
  });
}

main().catch((err) => {
  console.error("SOCIAL FLOW FAILED", err.message);
  process.exit(1);
});
