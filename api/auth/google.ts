import { randomUUID } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { withTransaction } from '../_lib/db.js';
import { HttpError } from '../_lib/errors.js';
import { api, readJson, sendJson } from '../_lib/http.js';
import { signUserJwt } from '../_lib/jwt.js';
import { googleAuthSchema, zodHttpError } from '../_lib/schemas.js';

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  upi_vpa: string | null;
};

export default api(async (req, res) => {
  if (req.method !== 'POST') throw new HttpError(405, 'method not allowed');

  const audience = process.env.GOOGLE_CLIENT_ID;
  if (!audience) throw new HttpError(500, 'GOOGLE_CLIENT_ID is required');

  let body: unknown;
  try {
    body = await readJson(req);
  } catch (error) {
    if (error instanceof SyntaxError) throw error;
    throw new HttpError(400, 'request body is not JSON');
  }

  const parsed = googleAuthSchema.safeParse(body);
  if (!parsed.success) throw zodHttpError(parsed.error, body);

  const client = new OAuth2Client(audience);
  let payload: { sub?: string; email?: string; name?: string } | undefined;
  try {
    const ticket = await client.verifyIdToken({
      idToken: parsed.data.idToken,
      audience,
    });
    payload = ticket.getPayload();
  } catch {
    throw new HttpError(401, 'Google ID token was rejected');
  }
  if (!payload?.sub || !payload.email) {
    throw new HttpError(422, 'Google token is missing a subject or email');
  }

  const googleSub = payload.sub;
  const email = payload.email;
  const profileName = payload.name ?? null;
  const displayName = payload.name?.trim() || payload.email;
  const user = await withTransaction(async (db) => {
    const inserted = await db.query(
      `insert into allsquare.users (google_sub, email, name)
       values ($1, $2, $3)
       on conflict (google_sub) do nothing
       returning id, email, name, upi_vpa`,
      [googleSub, email, profileName],
    );
    const row = (inserted.rows[0] as UserRow | undefined)
      ?? (await db.query(
        `select id, email, name, upi_vpa from allsquare.users where google_sub = $1`,
        [googleSub],
      )).rows[0] as UserRow | undefined;
    if (!row) throw new HttpError(500, 'could not store the Google user');

    await db.query(
      `insert into allsquare.members
         (id, user_id, name, kind, weight, is_self, updated_at)
       values ($1, $2, $3, 'person', 1, true, now())
       on conflict (user_id) where is_self do nothing`,
      [randomUUID(), row.id, displayName],
    );
    return row;
  });
  const jwt = await signUserJwt({ id: user.id, email: user.email });
  sendJson(res, 200, {
    jwt,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      upi_vpa: user.upi_vpa,
    },
  });
});
