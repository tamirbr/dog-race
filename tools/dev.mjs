import { spawn } from "child_process";
import path from "path";

const root = path.resolve(".");
const serverDir = path.join(root, "server");

function run(cmd, args, cwd) {
  const child = spawn(cmd, args, { cwd, stdio: "inherit", shell: true });
  child.on("exit", (code) => {
    if (code) process.exit(code || 1);
  });
  return child;
}

run("npm", ["start"], serverDir);
setTimeout(() => run("npm", ["start"], root), 800);
