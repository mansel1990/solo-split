import { createPool } from './client.ts';

const email = 'dev@allsquare.local';
const pool = createPool();
const client = await pool.connect();

try {
  await client.query('BEGIN');
  await client.query('SET LOCAL search_path TO allsquare');
  const found = await client.query('select id from users where email = $1', [email]);
  const userId = found.rows[0]?.id as string | undefined;
  if (!userId) {
    await client.query('ROLLBACK');
    process.stdout.write(`No user with email ${email}\n`);
  } else {
    const id = [userId];
    await client.query('delete from expense_splits where user_id = $1', id);
    await client.query('delete from settlements where user_id = $1', id);
    await client.query('delete from share_links where user_id = $1', id);
    await client.query('delete from group_members where user_id = $1', id);
    await client.query('delete from expenses where user_id = $1', id);
    await client.query('delete from members where user_id = $1 and family_id is not null', id);
    await client.query('delete from members where user_id = $1', id);
    await client.query('delete from groups where user_id = $1', id);
    await client.query('delete from users where id = $1', id);
    await client.query('COMMIT');
    process.stdout.write(`Deleted ${email}\n`);
  }
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
