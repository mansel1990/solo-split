export function uuid(): string {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') return cryptoRef.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const rand = Math.floor(Math.random() * 16);
    const value = char === 'x' ? rand : (rand & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function roundWeight(value: number): number {
  return Math.round(value * 100) / 100;
}

const TOKEN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** 16 random bytes, encoded as 22 url-safe characters. */
export function randomToken(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (let index = 0; index < 15; index += 3) {
    const n = (bytes[index]! << 16) | (bytes[index + 1]! << 8) | bytes[index + 2]!;
    out += TOKEN[(n >> 18) & 63]! + TOKEN[(n >> 12) & 63]! + TOKEN[(n >> 6) & 63]! + TOKEN[n & 63]!;
  }
  const last = bytes[15]!;
  out += TOKEN[(last >> 2) & 63]! + TOKEN[(last << 4) & 63]!;
  return out;
}

/** Accepts 9876543210, +91 98765 43210, or a full E.164 number. */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const compact = trimmed.replace(/[\s()-]/g, '');
  const withPlus = compact.startsWith('+')
    ? compact
    : compact.length === 10
      ? `+91${compact}`
      : `+${compact}`;
  if (!/^\+[1-9]\d{1,14}$/.test(withPlus)) {
    throw new Error('Use a phone number like +91 98765 43210');
  }
  return withPlus;
}
