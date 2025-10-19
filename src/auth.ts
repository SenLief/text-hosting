import { ShareTokenPayload } from "./types";

const encoder = new TextEncoder();

export async function createShareToken(payload: ShareTokenPayload, secret: string): Promise<string> {
  const data = JSON.stringify(payload);
  const signature = await sign(data, secret);
  return btoa(`${data}.${signature}`);
}

export async function verifyShareToken(token: string, secret: string): Promise<ShareTokenPayload | null> {
  try {
    const decoded = atob(token);
    const [data, signature] = decoded.split(".");
    if (!data || !signature) return null;
    const expected = await sign(data, secret);
    if (!timingSafeEqual(signature, expected)) return null;
    const payload = JSON.parse(data) as ShareTokenPayload;
    if (payload.expiresAt < Date.now()) return null;
    return payload;
  } catch (error) {
    return null;
  }
}

async function sign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
