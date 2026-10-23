import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
const files = [
  "/",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/manifest.webmanifest",
  ...readdirSync("dist/assets")
    .filter((n) => /\.(js|css|woff2?|ttf)$/.test(n))
    .map((n) => "/assets/" + n),
];
const version = createHash("sha256")
  .update(JSON.stringify(files))
  .digest("hex")
  .slice(0, 16);
const path = "dist/sw.js";
writeFileSync(
  path,
  readFileSync(path, "utf8")
    .replace('"__CACHE_VERSION__"', JSON.stringify("sunil-shell-" + version))
    .replace('"__PRECACHE__"', JSON.stringify(files)),
);
