import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
const suffix = randomBytes(5).toString("hex"),
  name = "sunil-smoke-" + suffix,
  volume = "sunil-smoke-data-" + suffix,
  password = randomBytes(20).toString("hex"),
  image = process.env.TEST_IMAGE || "sunil-enterprises:local";
const docker = (args, input) =>
  execFileSync("docker", args, {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
const code = `import{readFileSync}from'node:fs';import assert from'node:assert/strict';const{password,first}=JSON.parse(readFileSync(0,'utf8'));let cookie='';async function api(path,body){const r=await fetch('http://127.0.0.1:3000/api/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Cookie:cookie},body:body?JSON.stringify(body):undefined});assert.equal(r.status,200,path);if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return r.json();}if(first){await api('setup',{name:'Smoke owner',username:'owner',password});}await api('login',{username:'owner',password});if(first)await api('parties',{name:'Persistence check',kind:'customer'});const s=await api('state');assert.equal(s.parties.length,1);assert.equal(s.parties[0].name,'Persistence check');console.log('Container HTTP and persisted account verified.');`;
async function start() {
  docker([
    "run",
    "-d",
    "--name",
    name,
    "--network",
    "none",
    "-e",
    "ALLOW_LOCAL_SETUP=1",
    "-v",
    volume + ":/app/data",
    image,
  ]);
  for (let i = 0; i < 50; i++) {
    try {
      docker([
        "exec",
        name,
        "node",
        "-e",
        "fetch('http://127.0.0.1:3000/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
      ]);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw Error("Container did not become ready.");
}
try {
  docker(["volume", "create", volume]);
  await start();
  docker(
    ["exec", "-i", name, "node", "--input-type=module", "-e", code],
    JSON.stringify({ password, first: true }),
  );
  docker(["stop", name]);
  docker(["rm", name]);
  await start();
  docker(
    ["exec", "-i", name, "node", "--input-type=module", "-e", code],
    JSON.stringify({ password, first: false }),
  );
  assert.equal(docker(["exec", name, "id", "-u"]), "1000");
  console.log(
    "Container smoke passed: production HTTP, non-root runtime and persistent volume across replacement.",
  );
} finally {
  try {
    docker(["rm", "-f", name]);
  } catch {}
  try {
    docker(["volume", "rm", volume]);
  } catch {}
}
