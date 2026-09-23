import { SignJWT, jwtVerify } from 'jose';

export type AuthUser = { id: string; email: string };

function secret(): Uint8Array {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error('JWT_SECRET is required');
  return new TextEncoder().encode(value);
}

/** App session, about 90 days, so the phone can stay offline. */
export async function signUserJwt(user: AuthUser): Promise<string> {
  return new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime('90d')
    .sign(secret());
}

export async function verifyUserJwt(token: string): Promise<AuthUser> {
  const { payload } = await jwtVerify(token, secret());
  if (!payload.sub || typeof payload.email !== 'string') {
    throw new Error('invalid token');
  }
  return { id: payload.sub, email: payload.email };
}
