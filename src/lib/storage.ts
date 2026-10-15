import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// Receipts are encrypted with AES-256-GCM before touching disk and are only ever
// served through an authenticated, ownership-checked route handler.

function key(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) throw new Error("ENCRYPTION_KEY must be a 64-char hex string (32 bytes)");
  return Buffer.from(hex, "hex");
}

function root(): string {
  return path.resolve(process.env.STORAGE_DIR ?? "./storage");
}

function fullPath(storageKey: string): string {
  if (!/^[a-z0-9-]+\/[a-z0-9-]+\.bin$/i.test(storageKey)) throw new Error("Invalid storage key");
  return path.join(root(), storageKey);
}

export function encrypt(plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from("FNR1"), iv, cipher.getAuthTag(), enc]);
}

export function decrypt(blob: Buffer): Buffer {
  if (blob.subarray(0, 4).toString() !== "FNR1") throw new Error("Unknown file format");
  const iv = blob.subarray(4, 16);
  const tag = blob.subarray(16, 32);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(blob.subarray(32)), decipher.final()]);
}

export async function putPrivateFile(userId: string, data: Buffer): Promise<string> {
  const dir = userId.replace(/[^a-z0-9-]/gi, "");
  const storageKey = `${dir}/${randomUUID()}.bin`;
  await mkdir(path.join(root(), dir), { recursive: true });
  await writeFile(fullPath(storageKey), encrypt(data), { mode: 0o600 });
  return storageKey;
}

export async function getPrivateFile(storageKey: string): Promise<Buffer> {
  return decrypt(await readFile(fullPath(storageKey)));
}

export async function deletePrivateFile(storageKey: string): Promise<void> {
  await rm(fullPath(storageKey), { force: true });
}

export async function deleteUserFiles(userId: string): Promise<void> {
  const dir = userId.replace(/[^a-z0-9-]/gi, "");
  if (!dir) return;
  await rm(path.join(root(), dir), { recursive: true, force: true });
}

export const ALLOWED_RECEIPT_TYPES: Record<string, number[][]> = {
  // magic numbers — the declared MIME type is not trusted
  "image/jpeg": [[0xff, 0xd8, 0xff]],
  "image/png": [[0x89, 0x50, 0x4e, 0x47]],
  "image/webp": [[0x52, 0x49, 0x46, 0x46]],
  "application/pdf": [[0x25, 0x50, 0x44, 0x46]],
};

export function sniffMime(buf: Buffer): string | null {
  for (const [mime, sigs] of Object.entries(ALLOWED_RECEIPT_TYPES)) {
    if (sigs.some((sig) => sig.every((b, i) => buf[i] === b))) return mime;
  }
  return null;
}

export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
