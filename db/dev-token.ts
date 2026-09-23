import { randomUUID } from 'node:crypto';
import { createPool } from './client.ts';
import { signUserJwt } from '../api/_lib/jwt.ts';

const email = 'dev@allsquare.local';
const googleSub = 'dev-local';
const pool = createPool();
const client = await pool.connect();

try {
  await client.query('BEGIN');
  const inserted = await client.query(
    `insert into allsquare.users (google_sub, email, name)
     values ($1, $2, 'Dev')
     on conflict (google_sub) do nothing
     returning id, email`,
    [googleSub, email],
  );
  const user = (inserted.rows[0] as { id: string; email: string } | undefined)
    ?? (await client.query(
      'select id, email from allsquare.users where google_sub = $1',
      [googleSub],
    )).rows[0] as { id: string; email: string };

  await client.query(
    `insert into allsquare.members
       (id, user_id, name, kind, weight, is_self, updated_at)
     values ($1, $2, 'Dev', 'person', 1, true, now())
     on conflict (user_id) where is_self do nothing`,
    [randomUUID(), user.id],
  );
  await client.query('COMMIT');
  const jwt = await signUserJwt(user);
  process.stdout.write(`${jwt}\n`);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
