// Downloads encrypted pre-restore safety evidence; never prints the Mongo URI.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { MongoClient } from "mongodb";
const [id, output] = process.argv.slice(2);
if (!process.env.MONGODB_URI || !/^[a-f0-9-]{36}$/.test(id || "") || !output)
  throw Error(
    "Set MONGODB_URI privately. Usage: node scripts/safety-backup.mjs BACKUP_ID OUTPUT.skbackup",
  );
const client = new MongoClient(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 10000,
});
try {
  await client.connect();
  const collection = client
    .db(process.env.MONGODB_DB || "sunil_enterprises")
    .collection("restore_safety");
  const manifest = await collection.findOne({ _id: id, ready: true });
  if (!manifest) throw Error("Safety backup was not found or is incomplete.");
  const chunks = await collection
    .find({ backup: id })
    .sort({ index: 1 })
    .toArray();
  if (chunks.length !== manifest.chunks || chunks.some((c, i) => c.index !== i))
    throw Error("Safety backup chunks are incomplete.");
  const bytes = Buffer.concat(chunks.map((c) => Buffer.from(c.bytes.value())));
  if (!bytes.subarray(0, 11).equals(Buffer.from("SUNILKHATA1")))
    throw Error("Unsupported safety backup.");
  writeFileSync(resolve(output), bytes, { mode: 0o600, flag: "wx" });
  console.log(
    "Encrypted safety backup downloaded. Use the passphrase entered at the corresponding restore.",
  );
} catch {
  console.error(
    "Could not download the safety backup. Check its ID, private MongoDB configuration, database access and destination file.",
  );
  process.exitCode = 1;
} finally {
  await client.close();
}
