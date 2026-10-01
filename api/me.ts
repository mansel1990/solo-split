import type { PoolClient } from '@neondatabase/serverless';
import { withTransaction } from './_lib/db.js';
import { HttpError } from './_lib/errors.js';
import { api, readJson, requireUser, sendJson } from './_lib/http.js';
import { patchMeSchema, zodHttpError } from './_lib/schemas.js';

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  upi_vpa: string | null;
};

async function loadUser(client: PoolClient, userId: string): Promise<UserRow> {
  const result = await client.query(
    `select id, email, name, upi_vpa from allsquare.users where id = $1`,
    [userId],
  );
  const row = result.rows[0] as UserRow | undefined;
  if (!row) throw new HttpError(401, 'invalid or expired token');
  return row;
}

export default api(async (req, res) => {
  const caller = await requireUser(req);

  if (req.method === 'GET') {
    const user = await withTransaction((client) => loadUser(client, caller.id));
    sendJson(res, 200, user);
    return;
  }

  if (req.method !== 'PATCH') throw new HttpError(405, 'method not allowed');

  let body: unknown;
  try {
    body = await readJson(req);
  } catch (error) {
    if (error instanceof SyntaxError) throw error;
    throw new HttpError(400, 'request body is not JSON');
  }
  const parsed = patchMeSchema.safeParse(body);
  if (!parsed.success) throw zodHttpError(parsed.error, body);

  const user = await withTransaction(async (client) => {
    const sets: string[] = [];
    const values: unknown[] = [caller.id];
    if (parsed.data.name !== undefined) {
      values.push(parsed.data.name);
      sets.push(`name = $${values.length}`);
    }
    if (parsed.data.upi_vpa !== undefined) {
      values.push(parsed.data.upi_vpa);
      sets.push(`upi_vpa = $${values.length}`);
    }
    await client.query(
      `update allsquare.users set ${sets.join(', ')} where id = $1`,
      values,
    );
    return loadUser(client, caller.id);
  });
  sendJson(res, 200, user);
});
