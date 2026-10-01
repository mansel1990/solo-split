import type { PoolClient, QueryResult } from '@neondatabase/serverless';
import { withTransaction } from './_lib/db.js';
import { HttpError } from './_lib/errors.js';
import { api, readJson, requireUser, sendJson } from './_lib/http.js';
import {
  syncSchema,
  zodHttpError,
  type ExpenseInput,
  type GroupInput,
  type GroupMemberInput,
  type MemberInput,
  type SettlementInput,
  type ShareLinkInput,
  type SyncBody,
} from './_lib/schemas.js';

type Pull = {
  members: unknown[];
  groups: unknown[];
  group_members: unknown[];
  expenses: unknown[];
  settlements: unknown[];
  share_links: unknown[];
};

function duplicate(ids: string[]): string | undefined {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return undefined;
}

function orderMembers(members: MemberInput[]): MemberInput[] {
  const byId = new Map(members.map((member) => [member.id, member]));
  const ordered: MemberInput[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (member: MemberInput): void => {
    if (visited.has(member.id)) return;
    if (visiting.has(member.id)) {
      throw new HttpError(422, 'family reference cycle', member.id);
    }
    if (member.family_id === member.id) {
      throw new HttpError(422, 'family_id cannot reference itself', member.id);
    }
    visiting.add(member.id);
    const parent = member.family_id ? byId.get(member.family_id) : undefined;
    if (parent) visit(parent);
    visiting.delete(member.id);
    visited.add(member.id);
    ordered.push(member);
  };

  for (const member of members) visit(member);
  return ordered;
}

function pgFailure(error: unknown, id?: string): never {
  if (error instanceof HttpError) throw error;
  const code = (error as { code?: string }).code;
  if (code === '23503') throw new HttpError(422, 'referenced row not found', id);
  if (code === '23505') throw new HttpError(422, 'conflicts with an existing row', id);
  if (code === '23514') throw new HttpError(422, 'row failed a check constraint', id);
  throw error;
}

async function applied(
  client: PoolClient,
  result: QueryResult,
  lookupSql: string,
  lookupValues: unknown[],
  userId: string,
  id: string,
): Promise<void> {
  if ((result.rowCount ?? 0) > 0) return;
  const existing = await client.query(lookupSql, lookupValues);
  const owner = existing.rows[0]?.user_id as string | undefined;
  if (owner && owner !== userId) {
    throw new HttpError(422, 'row belongs to another user', id);
  }
  throw new HttpError(422, 'upsert did not apply', id);
}

async function upsertMember(client: PoolClient, userId: string, member: MemberInput): Promise<void> {
  const result = await client.query(
    `insert into allsquare.members
       (id, user_id, name, kind, phone, family_id, weight, is_self, updated_at, deleted_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (id) do update set
       name = excluded.name,
       kind = excluded.kind,
       phone = excluded.phone,
       family_id = excluded.family_id,
       weight = excluded.weight,
       is_self = excluded.is_self,
       updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at
     where members.user_id = excluded.user_id
     returning id`,
    [
      member.id,
      userId,
      member.name,
      member.kind,
      member.phone ?? null,
      member.family_id ?? null,
      member.weight,
      member.is_self,
      member.updated_at,
      member.deleted_at ?? null,
    ],
  );
  await applied(
    client,
    result,
    'select user_id from allsquare.members where id = $1',
    [member.id],
    userId,
    member.id,
  );
}

async function upsertGroup(client: PoolClient, userId: string, group: GroupInput): Promise<void> {
  const result = await client.query(
    `insert into allsquare.groups
       (id, user_id, name, kind, default_split, currency, starts_on, ends_on, archived, updated_at, deleted_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     on conflict (id) do update set
       name = excluded.name,
       kind = excluded.kind,
       default_split = excluded.default_split,
       currency = excluded.currency,
       starts_on = excluded.starts_on,
       ends_on = excluded.ends_on,
       archived = excluded.archived,
       updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at
     where groups.user_id = excluded.user_id
     returning id`,
    [
      group.id,
      userId,
      group.name,
      group.kind ?? null,
      group.default_split,
      group.currency,
      group.starts_on ?? null,
      group.ends_on ?? null,
      group.archived,
      group.updated_at,
      group.deleted_at ?? null,
    ],
  );
  await applied(
    client,
    result,
    'select user_id from allsquare.groups where id = $1',
    [group.id],
    userId,
    group.id,
  );
}

async function upsertGroupMember(
  client: PoolClient,
  userId: string,
  row: GroupMemberInput,
): Promise<void> {
  const id = `${row.group_id}:${row.member_id}`;
  const result = await client.query(
    `insert into allsquare.group_members
       (user_id, group_id, member_id, weight, sort_order, updated_at, deleted_at)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (group_id, member_id) do update set
       weight = excluded.weight,
       sort_order = excluded.sort_order,
       updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at
     where group_members.user_id = excluded.user_id
     returning group_id`,
    [
      userId,
      row.group_id,
      row.member_id,
      row.weight ?? null,
      row.sort_order,
      row.updated_at,
      row.deleted_at ?? null,
    ],
  );
  await applied(
    client,
    result,
    'select user_id from allsquare.group_members where group_id = $1 and member_id = $2',
    [row.group_id, row.member_id],
    userId,
    id,
  );
}

async function upsertExpense(client: PoolClient, userId: string, expense: ExpenseInput): Promise<void> {
  const result = await client.query(
    `insert into allsquare.expenses
       (id, user_id, group_id, paid_by, amount_paise, split_type, note, category,
        spent_on, created_at, updated_at, deleted_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     on conflict (id) do update set
       group_id = excluded.group_id,
       paid_by = excluded.paid_by,
       amount_paise = excluded.amount_paise,
       split_type = excluded.split_type,
       note = excluded.note,
       category = excluded.category,
       spent_on = excluded.spent_on,
       created_at = excluded.created_at,
       updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at
     where expenses.user_id = excluded.user_id
     returning id`,
    [
      expense.id,
      userId,
      expense.group_id,
      expense.paid_by,
      expense.amount_paise,
      expense.split_type,
      expense.note ?? null,
      expense.category ?? null,
      expense.spent_on,
      expense.created_at,
      expense.updated_at,
      expense.deleted_at ?? null,
    ],
  );
  await applied(
    client,
    result,
    'select user_id from allsquare.expenses where id = $1',
    [expense.id],
    userId,
    expense.id,
  );

  await client.query(
    'delete from allsquare.expense_splits where expense_id = $1 and user_id = $2',
    [expense.id, userId],
  );
  for (const split of expense.splits) {
    await client.query(
      `insert into allsquare.expense_splits
         (user_id, expense_id, member_id, weight, people, owed_paise)
       values ($1,$2,$3,$4,$5,$6)`,
      [
        userId,
        expense.id,
        split.member_id,
        split.weight ?? null,
        split.people ?? null,
        split.owed_paise,
      ],
    );
  }
}

async function upsertSettlement(
  client: PoolClient,
  userId: string,
  row: SettlementInput,
): Promise<void> {
  const result = await client.query(
    `insert into allsquare.settlements
       (id, user_id, group_id, from_member, to_member, amount_paise, note, paid_on, updated_at, deleted_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (id) do update set
       group_id = excluded.group_id,
       from_member = excluded.from_member,
       to_member = excluded.to_member,
       amount_paise = excluded.amount_paise,
       note = excluded.note,
       paid_on = excluded.paid_on,
       updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at
     where settlements.user_id = excluded.user_id
     returning id`,
    [
      row.id,
      userId,
      row.group_id,
      row.from_member,
      row.to_member,
      row.amount_paise,
      row.note ?? null,
      row.paid_on,
      row.updated_at,
      row.deleted_at ?? null,
    ],
  );
  await applied(
    client,
    result,
    'select user_id from allsquare.settlements where id = $1',
    [row.id],
    userId,
    row.id,
  );
}

async function upsertShareLink(
  client: PoolClient,
  userId: string,
  row: ShareLinkInput,
): Promise<void> {
  const result = await client.query(
    `insert into allsquare.share_links
       (id, user_id, token, group_id, member_id, updated_at, revoked_at)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (id) do update set
       token = excluded.token,
       group_id = excluded.group_id,
       member_id = excluded.member_id,
       updated_at = excluded.updated_at,
       revoked_at = excluded.revoked_at
     where share_links.user_id = excluded.user_id
     returning id`,
    [
      row.id,
      userId,
      row.token,
      row.group_id ?? null,
      row.member_id ?? null,
      row.updated_at,
      row.revoked_at ?? null,
    ],
  );
  await applied(
    client,
    result,
    'select user_id from allsquare.share_links where id = $1',
    [row.id],
    userId,
    row.id,
  );
}

function iso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function day(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

async function pullSince(client: PoolClient, userId: string, since: number): Promise<{ cursor: number; pull: Pull }> {
  const members = await client.query(
    `select id, name, kind, phone, family_id, weight, is_self, updated_at, deleted_at, seq
     from allsquare.members where user_id = $1 and seq > $2 order by seq`,
    [userId, since],
  );
  const groups = await client.query(
    `select id, name, kind, default_split, currency, starts_on, ends_on, archived, updated_at, deleted_at, seq
     from allsquare.groups where user_id = $1 and seq > $2 order by seq`,
    [userId, since],
  );
  const groupMembers = await client.query(
    `select group_id, member_id, weight, sort_order, updated_at, deleted_at, seq
     from allsquare.group_members where user_id = $1 and seq > $2 order by seq`,
    [userId, since],
  );
  const expenses = await client.query(
    `select id, group_id, paid_by, amount_paise, split_type, note, category,
            spent_on, created_at, updated_at, deleted_at, seq
     from allsquare.expenses where user_id = $1 and seq > $2 order by seq`,
    [userId, since],
  );
  const expenseIds = expenses.rows.map((row) => row.id as string);
  const splits = expenseIds.length === 0
    ? { rows: [] as Record<string, unknown>[] }
    : await client.query(
      `select expense_id, member_id, weight, people, owed_paise
       from allsquare.expense_splits
       where user_id = $1 and expense_id = any($2::uuid[])
       order by expense_id, member_id`,
      [userId, expenseIds],
    );
  const settlements = await client.query(
    `select id, group_id, from_member, to_member, amount_paise, note, paid_on, updated_at, deleted_at, seq
     from allsquare.settlements where user_id = $1 and seq > $2 order by seq`,
    [userId, since],
  );
  const shareLinks = await client.query(
    `select id, token, group_id, member_id, updated_at, revoked_at, seq
     from allsquare.share_links where user_id = $1 and seq > $2 order by seq`,
    [userId, since],
  );

  const splitsByExpense = new Map<string, unknown[]>();
  for (const split of splits.rows) {
    const expenseId = split.expense_id as string;
    const list = splitsByExpense.get(expenseId) ?? [];
    list.push({
      member_id: split.member_id,
      weight: split.weight,
      people: split.people,
      owed_paise: split.owed_paise,
    });
    splitsByExpense.set(expenseId, list);
  }

  let cursor = since;
  const notice = (seq: unknown) => {
    if (typeof seq === 'number' && seq > cursor) cursor = seq;
  };

  const pull: Pull = {
    members: members.rows.map((row) => {
      notice(row.seq);
      return {
        id: row.id,
        name: row.name,
        kind: row.kind,
        phone: row.phone,
        family_id: row.family_id,
        weight: row.weight,
        is_self: row.is_self,
        updated_at: iso(row.updated_at),
        deleted_at: iso(row.deleted_at),
        seq: row.seq,
      };
    }),
    groups: groups.rows.map((row) => {
      notice(row.seq);
      return {
        id: row.id,
        name: row.name,
        kind: row.kind,
        default_split: row.default_split,
        currency: row.currency,
        starts_on: day(row.starts_on),
        ends_on: day(row.ends_on),
        archived: row.archived,
        updated_at: iso(row.updated_at),
        deleted_at: iso(row.deleted_at),
        seq: row.seq,
      };
    }),
    group_members: groupMembers.rows.map((row) => {
      notice(row.seq);
      return {
        group_id: row.group_id,
        member_id: row.member_id,
        weight: row.weight,
        sort_order: row.sort_order,
        updated_at: iso(row.updated_at),
        deleted_at: iso(row.deleted_at),
        seq: row.seq,
      };
    }),
    expenses: expenses.rows.map((row) => {
      notice(row.seq);
      return {
        id: row.id,
        group_id: row.group_id,
        paid_by: row.paid_by,
        amount_paise: row.amount_paise,
        split_type: row.split_type,
        note: row.note,
        category: row.category,
        spent_on: day(row.spent_on),
        created_at: iso(row.created_at),
        updated_at: iso(row.updated_at),
        deleted_at: iso(row.deleted_at),
        seq: row.seq,
        splits: splitsByExpense.get(row.id as string) ?? [],
      };
    }),
    settlements: settlements.rows.map((row) => {
      notice(row.seq);
      return {
        id: row.id,
        group_id: row.group_id,
        from_member: row.from_member,
        to_member: row.to_member,
        amount_paise: row.amount_paise,
        note: row.note,
        paid_on: day(row.paid_on),
        updated_at: iso(row.updated_at),
        deleted_at: iso(row.deleted_at),
        seq: row.seq,
      };
    }),
    share_links: shareLinks.rows.map((row) => {
      notice(row.seq);
      return {
        id: row.id,
        token: row.token,
        group_id: row.group_id,
        member_id: row.member_id,
        updated_at: iso(row.updated_at),
        revoked_at: iso(row.revoked_at),
        seq: row.seq,
      };
    }),
  };

  return { cursor, pull };
}

async function pushAll(client: PoolClient, userId: string, body: SyncBody): Promise<void> {
  const { push } = body;
  const memberIds = duplicate(push.members.map((row) => row.id));
  if (memberIds) throw new HttpError(422, 'duplicate id in push', memberIds);
  const groupIds = duplicate(push.groups.map((row) => row.id));
  if (groupIds) throw new HttpError(422, 'duplicate id in push', groupIds);
  const expenseIds = duplicate(push.expenses.map((row) => row.id));
  if (expenseIds) throw new HttpError(422, 'duplicate id in push', expenseIds);
  const settlementIds = duplicate(push.settlements.map((row) => row.id));
  if (settlementIds) throw new HttpError(422, 'duplicate id in push', settlementIds);
  const linkIds = duplicate(push.share_links.map((row) => row.id));
  if (linkIds) throw new HttpError(422, 'duplicate id in push', linkIds);
  const partyKey = duplicate(push.group_members.map((row) => `${row.group_id}:${row.member_id}`));
  if (partyKey) throw new HttpError(422, 'duplicate group member in push', partyKey);

  const members = orderMembers(push.members);
  const step = async (id: string, write: () => Promise<void>) => {
    try {
      await write();
    } catch (error) {
      pgFailure(error, id);
    }
  };
  for (const member of members) await step(member.id, () => upsertMember(client, userId, member));
  for (const group of push.groups) await step(group.id, () => upsertGroup(client, userId, group));
  for (const row of push.group_members) {
    await step(`${row.group_id}:${row.member_id}`, () => upsertGroupMember(client, userId, row));
  }
  for (const expense of push.expenses) await step(expense.id, () => upsertExpense(client, userId, expense));
  for (const row of push.settlements) await step(row.id, () => upsertSettlement(client, userId, row));
  for (const row of push.share_links) await step(row.id, () => upsertShareLink(client, userId, row));
}

export async function runSync(userId: string, body: unknown): Promise<{ cursor: number; pull: Pull }> {
  const parsed = syncSchema.safeParse(body);
  if (!parsed.success) throw zodHttpError(parsed.error, body);
  return withTransaction(async (client) => {
    await pushAll(client, userId, parsed.data);
    return pullSince(client, userId, parsed.data.since);
  });
}

export default api(async (req, res) => {
  if (req.method !== 'POST') throw new HttpError(405, 'method not allowed');
  const caller = await requireUser(req);
  let body: unknown;
  try {
    body = await readJson(req);
  } catch (error) {
    if (error instanceof SyntaxError) throw error;
    throw new HttpError(400, 'request body is not JSON');
  }
  const result = await runSync(caller.id, body);
  sendJson(res, 200, result);
});
