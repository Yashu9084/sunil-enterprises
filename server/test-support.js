import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export async function startTestServer(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sunil-api-"));
  const child = spawn(process.execPath, ["server/index.js"], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      ALLOW_LOCAL_SETUP: "1",
      PORT: "0",
      DATA_DIR: dir,
      ...extra,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Server did not start: " + output)),
      15000,
    );
    child.stdout.on("data", (b) => {
      output += b;
      const match = output.match(/listening on port (\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.stderr.on("data", (b) => (output += b));
    child.on("exit", () => {
      clearTimeout(timer);
      reject(Error("Server exited: " + output));
    });
  });
  return {
    get output() {
      return output;
    },
    base: `http://localhost:${port}`,
    dir,
    async close() {
      child.kill();
      await new Promise((r) =>
        child.exitCode !== null ? r() : child.once("exit", r),
      );
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
