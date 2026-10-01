import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * Phone copy of the PRD tables. user_id is omitted because this database
 * belongs to one signed-in owner. Synced tables carry dirty (1 = needs push)
 * and seq. The cursor lives in sync_state.
 */
const initSql = `
create table members (
  id text primary key,
  name text not null,
  kind text not null default 'person' check (kind in ('person', 'family')),
  phone text,
  family_id text references members(id),
  weight real not null default 1,
  is_self integer not null default 0,
  updated_at text not null,
  deleted_at text,
  seq integer not null default 0,
  dirty integer not null default 0
);
create unique index one_self on members (is_self) where is_self = 1;

create table groups (
  id text primary key,
  name text not null,
  kind text,
  default_split text not null default 'per_head' check (default_split in ('per_head', 'per_party')),
  currency text not null default 'INR',
  starts_on text,
  ends_on text,
  archived integer not null default 0,
  updated_at text not null,
  deleted_at text,
  seq integer not null default 0,
  dirty integer not null default 0
);

create table group_members (
  group_id text not null references groups(id),
  member_id text not null references members(id),
  weight real check (weight > 0),
  sort_order integer not null default 0,
  updated_at text not null,
  deleted_at text,
  seq integer not null default 0,
  dirty integer not null default 0,
  primary key (group_id, member_id)
);

create table expenses (
  id text primary key,
  group_id text not null references groups(id),
  paid_by text not null references members(id),
  amount_paise integer not null check (amount_paise > 0),
  split_type text not null check (split_type in ('per_head', 'per_party', 'shares', 'exact')),
  note text,
  category text,
  spent_on text not null,
  created_at text not null,
  updated_at text not null,
  deleted_at text,
  seq integer not null default 0,
  dirty integer not null default 0
);

create table expense_splits (
  expense_id text not null references expenses(id) on delete cascade,
  member_id text not null references members(id),
  weight real,
  people text,
  owed_paise integer not null check (owed_paise >= 0),
  dirty integer not null default 0,
  primary key (expense_id, member_id)
);

create table settlements (
  id text primary key,
  group_id text not null references groups(id),
  from_member text not null references members(id),
  to_member text not null references members(id),
  amount_paise integer not null check (amount_paise > 0),
  note text,
  paid_on text not null,
  updated_at text not null,
  deleted_at text,
  seq integer not null default 0,
  dirty integer not null default 0,
  check (from_member <> to_member)
);

create table share_links (
  id text primary key,
  token text unique not null,
  group_id text references groups(id),
  member_id text references members(id),
  updated_at text not null,
  revoked_at text,
  seq integer not null default 0,
  dirty integer not null default 0,
  check (group_id is not null or member_id is not null)
);

create table users (
  id text primary key,
  email text not null,
  name text,
  upi_vpa text
);

create table sync_state (
  id integer primary key check (id = 1),
  cursor integer not null
);
insert into sync_state (id, cursor) values (1, 0);

create index members_seq on members (seq);
create index groups_seq on groups (seq);
create index group_members_seq on group_members (seq);
create index expenses_seq on expenses (seq);
create index settlements_seq on settlements (seq);
create index share_links_seq on share_links (seq);
create index expenses_group on expenses (group_id) where deleted_at is null;
create index settlements_group on settlements (group_id) where deleted_at is null;
`;

const migrations: { id: string; sql: string }[] = [{ id: '001_init', sql: initSql }];

export async function migrate(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    create table if not exists schema_migrations (
      id text primary key,
      applied_at text not null
    );
  `);
  const applied = await db.getAllAsync<{ id: string }>('select id from schema_migrations');
  const done = new Set(applied.map((row) => row.id));
  for (const migration of migrations) {
    if (done.has(migration.id)) continue;
    await db.execAsync('BEGIN');
    try {
      await db.execAsync(migration.sql);
      await db.runAsync(
        'insert into schema_migrations (id, applied_at) values (?, ?)',
        migration.id,
        new Date().toISOString(),
      );
      await db.execAsync('COMMIT');
    } catch (error) {
      await db.execAsync('ROLLBACK');
      throw error;
    }
  }
}
