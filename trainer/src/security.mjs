import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export async function hashPassword(password) {
  if (typeof password !== "string" || password.length < 12) {
    throw new Error("Mật khẩu phải có ít nhất 12 ký tự.");
  }
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$32768$8$1$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(password, encoded) {
  const [algorithm, n, r, p, saltText, hashText] = String(encoded).split("$");
  if (algorithm !== "scrypt" || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, "base64");
  const actual = await scrypt(
    password,
    Buffer.from(saltText, "base64"),
    expected.length,
    {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    },
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function newSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function tokenDigest(token) {
  return createHash("sha256").update(token).digest("hex");
}
