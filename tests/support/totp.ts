import { createHmac } from "node:crypto";

// Test-only RFC 6238 SHA-1 generator; never used by the application.
export function totp(secret: string, timeMs = Date.now()): string {
  if (!/^[A-Z2-7]+$/.test(secret) || !Number.isSafeInteger(timeMs) || timeMs < 0) throw new Error("Invalid TOTP test input");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timeMs / 30000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
}