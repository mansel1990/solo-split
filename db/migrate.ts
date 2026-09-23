import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoolClient } from '@neondatabase/serverless';
import { createPool } from './client.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function splitSql(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let index = 0;
  let dollar: string | null = null;

  while (index < sql.length) {
    if (dollar) {
      if (sql.startsWith(dollar, index)) {
        current += dollar;
        index += dollar.length;
        dollar = null;
        continue;
      }
      current += sql[index];
      index += 1;
      continue;
    }

    const dollarTag = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(index));
    if (sql[index] === '$' && dollarTag) {
      dollar = dollarTag[0];
      current += dollar;
      index += dollar.length;
      continue;
    }

    if (sql[index] === '-' && sql[index + 1] === '-') {
      const end = sql.indexOf('\n', index);
      const comment = sql.slice(index, end === -1 ? sql.length : end);
      current += comment;
      index += comment.length;
      continue;
    }

    if (sql[index] === "'") {
      let end = index + 1;
      while (end < sql.length) {
        if (sql[end] === "'" && sql[end + 1] === "'") {
          end += 2;
          continue;
        }
        if (sql[end] === "'") {
          end += 1;
          break;
        }
        end += 1;
      }
      current += sql.slice(index, end);
      index = end;
      continue;
    }

    if (sql[index] === ';') {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = '';
      index += 1;
      continue;
    }

    current += sql[index];
    index += 1;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

async function outsideSnapshot(client: PoolClient): Promise<string> {
  const result = await client.query(`
    select n.nspname, c.relname, c.relkind
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast', 'allsquare')
    order by 1, 2, 3
  `);
  return JSON.stringify(result.rows);
}

async function assertIsolated(client: PoolClient): Promise<void> {
  const functions = await client.query(`
    select n.nspname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'bump_seq' and n.nspname <> 'allsquare'
  `);
  if (functions.rows.length > 0) {
    throw new Error('bump_seq() exists outside the allsquare schema');
  }

  const sequences = await client.query(`
    select n.nspname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'S' and c.relname = 'sync_seq' and n.nspname <> 'allsquare'
  `);
  if (sequences.rows.length > 0) {
    throw new Error('sync_seq exists outside the allsquare schema');
  }

  const triggers = await client.query(`
    select n.nspname, c.relname, t.tgname
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal
      and t.tgname in (
        'members_seq','groups_seq','group_members_seq',
        'expenses_seq','settlements_seq','share_links_seq'
      )
      and n.nspname <> 'allsquare'
  `);
  if (triggers.rows.length > 0) {
    throw new Error('a sync trigger was created outside the allsquare schema');
  }

  const tables = await client.query(`
    select relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'allsquare'
      and c.relkind = 'r'
      and relname in (
        'users','members','groups','group_members','expenses',
        'expense_splits','settlements','share_links','schema_migrations'
      )
  `);
  if (tables.rows.length !== 9) {
    throw new Error(`expected 9 allsquare tables, found ${tables.rows.length}`);
  }
}

async function main(): Promise<void> {
  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = await outsideSnapshot(client);
    await client.query('CREATE SCHEMA IF NOT EXISTS allsquare');
    await client.query('SET LOCAL search_path TO allsquare');
    await client.query(`
      create table if not exists allsquare.schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const dir = path.join(root, 'db', 'migrations');
    const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
    for (const filename of files) {
      const seen = await client.query(
        'select 1 from allsquare.schema_migrations where filename = $1',
        [filename],
      );
      if ((seen.rowCount ?? 0) > 0) {
        console.log(`skip ${filename}`);
        continue;
      }
      const sql = await readFile(path.join(dir, filename), 'utf8');
      for (const statement of splitSql(sql)) {
        await client.query(statement);
      }
      await client.query(
        'insert into allsquare.schema_migrations (filename) values ($1)',
        [filename],
      );
      console.log(`applied ${filename}`);
    }

    const after = await outsideSnapshot(client);
    if (before !== after) {
      throw new Error('migration changed an object outside the allsquare schema');
    }
    await assertIsolated(client);
    await client.query('COMMIT');
    console.log('allsquare schema is ready');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
