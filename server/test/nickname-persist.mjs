import { io } from "socket.io-client";

const URL = process.env.MP_URL || "http://localhost:3001";
const nickname = "persist" + Date.now().toString().slice(-5);

function once(socket, event, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout " + event)), timeout);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

async function connect(auth) {
  const socket = io(URL, { transports: ["websocket"], forceNew: true, auth });
  const sessionP = Promise.race([once(socket, "session:new"), once(socket, "session:restored")]);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("connect timeout")), 5000);
    socket.on("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.on("connect_error", reject);
  });
  const session = await sessionP;
  return { socket, session };
}

async function main() {
  const first = await connect({ nickname });
  if (first.session.nickname !== nickname) {
    throw new Error("expected nickname " + nickname + " got " + first.session.nickname);
  }
  const token = first.session.token;
  first.socket.disconnect();

  const restored = await connect({ token, nickname });
  if (restored.session.nickname !== nickname) {
    throw new Error("restored nickname mismatch: " + restored.session.nickname);
  }
  restored.socket.disconnect();

  console.log("NICKNAME PERSIST OK", { nickname, token: token.slice(0, 8) + "..." });
}

main().catch((err) => {
  console.error("NICKNAME PERSIST FAILED", err.message);
  process.exit(1);
});
