import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
const name = "sunil-tests-" + randomUUID().slice(0, 8);
const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
async function run(command, args, env) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) throw Error("MongoDB test command failed.");
}
try {
  docker(
    "run",
    "-d",
    "--name",
    name,
    "--memory=768m",
    "-p",
    "127.0.0.1::27017",
    "mongo:8.0",
    "--replSet",
    "rs0",
    "--bind_ip_all",
    "--wiredTigerCacheSizeGB",
    "0.25",
    "--setParameter",
    "enableTestCommands=1",
  );
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      docker(
        "exec",
        name,
        "mongosh",
        "--quiet",
        "--eval",
        'rs.initiate({_id:"rs0",members:[{_id:0,host:"localhost:27017"}]})',
      );
      ready = true;
      break;
    } catch {
      await setTimeout(500);
    }
  }
  if (!ready) throw Error("Disposable MongoDB replica set did not initialize.");
  const port = docker(
    "inspect",
    "--format",
    '{{(index (index .NetworkSettings.Ports "27017/tcp") 0).HostPort}}',
    name,
  );
  const env = {
    TEST_MONGODB_FAULTS: "1",
    TEST_MONGODB_URI: `mongodb://127.0.0.1:${port}/?replicaSet=rs0&directConnection=true`,
  };
  await run(
    process.execPath,
    [
      "--test",
      "server/history.test.js",
      "server/estimate-ai.test.js",
      "server/lifecycle.test.js",
      "server/mongo.test.js",
      "server/durable-api.test.js",
    ],
    env,
  );
  if (process.argv.includes("--browser")) {
    await run("npm", ["run", "test:browser"], env);
    await run(process.execPath, ["scripts/photo-browser-smoke.mjs"], env);
  }
} finally {
  try {
    docker("rm", "-f", "-v", name);
  } catch {}
}
