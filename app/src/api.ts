import { apiBaseUrl } from './config';
import type { Profile } from './db/profile';

type AuthResponse = {
  jwt: string;
  user: Profile;
};

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') {
    return body.message;
  }
  return `Request failed (${status})`;
}

export async function exchangeGoogleIdToken(idToken: string): Promise<AuthResponse> {
  const response = await fetch(`${apiBaseUrl()}/api/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  const body = await readBody(response);
  if (!response.ok) throw new Error(errorMessage(body, response.status));
  if (!body || typeof body !== 'object' || !('jwt' in body) || typeof body.jwt !== 'string') {
    throw new Error('Sign-in response did not include a token');
  }
  const user = 'user' in body ? body.user : null;
  if (!user || typeof user !== 'object' || !('id' in user) || !('email' in user)) {
    throw new Error('Sign-in response did not include a profile');
  }
  const record = user as Record<string, unknown>;
  return {
    jwt: body.jwt,
    user: {
      id: String(record.id),
      email: String(record.email),
      name: typeof record.name === 'string' ? record.name : null,
      upi_vpa: typeof record.upi_vpa === 'string' ? record.upi_vpa : null,
    },
  };
}

export async function getMe(jwt: string): Promise<Profile> {
  const response = await fetch(`${apiBaseUrl()}/api/me`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  const body = await readBody(response);
  if (!response.ok) throw new Error(errorMessage(body, response.status));
  return asProfile(body);
}

export async function patchMe(
  jwt: string,
  input: { name: string; upi_vpa: string | null },
): Promise<Profile> {
  const response = await fetch(`${apiBaseUrl()}/api/me`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  const body = await readBody(response);
  if (!response.ok) throw new Error(errorMessage(body, response.status));
  return asProfile(body);
}

function asProfile(body: unknown): Profile {
  if (!body || typeof body !== 'object' || !('id' in body) || !('email' in body)) {
    throw new Error('Profile response was incomplete');
  }
  const record = body as Record<string, unknown>;
  return {
    id: String(record.id),
    email: String(record.email),
    name: typeof record.name === 'string' ? record.name : null,
    upi_vpa: typeof record.upi_vpa === 'string' ? record.upi_vpa : null,
  };
}
