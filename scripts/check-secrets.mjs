import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ignored = new Set(["node_modules", ".git", ".next", ".local", "coverage", "playwright-report", "test-results"]);
const failures = [];
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { await scan(file); continue; }
    if (entry.name.startsWith(".env") && entry.name !== ".env.example") continue;
    if (!/\.(?:mts|tsx?|m?js|json|ya?ml|md|sql)$/.test(entry.name) && entry.name !== ".env.example") continue;
    const text = await readFile(file, "utf8");
    if (/sb_secret_[a-zA-Z0-9_-]{24,}/.test(text) || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) failures.push(file);
    for (const token of text.match(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g) ?? []) {
      try { if (JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).role === "service_role") failures.push(file); } catch { /* Not a parseable JWT. */ }
    }
    if (/NEXT_PUBLIC_[A-Z_]*(?:SERVICE_ROLE|SECRET_KEY|WEBHOOK_SECRET|PRIVATE_KEY)\s*=/.test(text)) failures.push(file);
  }
}
await scan(process.cwd());
if (failures.length) { console.error("Potential secret exposure in:", [...new Set(failures)]); process.exit(1); }
console.log("Secret-pattern checks passed. This heuristic does not replace a dedicated secret scanner or review.");