import type { SQLiteDatabase } from 'expo-sqlite';
import type { BalanceExpense, BalanceSettlement, SplitType } from '../../../shared/types';
import { computeBalances } from '../money';
import { nowIso, randomToken, roundWeight, uuid } from '../ids';

const MEMBER_SQL = `id, name, kind, phone, family_id, weight, is_self, updated_at, deleted_at, seq, dirty`;

export type Member = {
  id: string;
  name: string;
  kind: 'person' | 'family';
  phone: string | null;
  family_id: string | null;
  weight: number;
  is_self: number;
  updated_at: string;
  deleted_at: string | null;
  seq: number;
  dirty: number;
};

export type Group = {
  id: string;
  name: string;
  kind: string | null;
  default_split: 'per_head' | 'per_party';
  currency: string;
  starts_on: string | null;
  ends_on: string | null;
  archived: number;
  updated_at: string;
  deleted_at: string | null;
  seq: number;
  dirty: number;
};

export type Party = {
  group_id: string;
  member_id: string;
  weight: number | null;
  sort_order: number;
  name: string;
  kind: 'person' | 'family';
  phone: string | null;
  member_weight: number;
  is_self: number;
};

export type ExpenseRow = {
  id: string;
  group_id: string;
  paid_by: string;
  amount_paise: number;
  split_type: SplitType;
  note: string | null;
  category: string | null;
  spent_on: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  seq: number;
  dirty: number;
};

export type SplitRow = {
  expense_id: string;
  member_id: string;
  weight: number | null;
  people: string | null;
  owed_paise: number;
};

export type SettlementRow = {
  id: string;
  group_id: string;
  from_member: string;
  to_member: string;
  amount_paise: number;
  note: string | null;
  paid_on: string;
  updated_at: string;
  deleted_at: string | null;
  seq: number;
  dirty: number;
};

export type ShareLinkRow = {
  id: string;
  token: string;
  group_id: string | null;
  member_id: string | null;
  updated_at: string;
  revoked_at: string | null;
  seq: number;
  dirty: number;
};

export type SavedSplit = {
  memberId: string;
  weight: number | null;
  people: string[];
  owedPaise: number;
};

export type RemoteMember = {
  id: string;
  name: string;
  kind: 'person' | 'family';
  phone: string | null;
  family_id: string | null;
  weight: number;
  is_self: boolean;
  updated_at: string;
  deleted_at: string | null;
  seq: number;
};

export class SelfConflictError extends Error {
  constructor(
    readonly localId: string,
    readonly server: RemoteMember,
  ) {
    super('This phone had a different profile from the account');
  }
}

async function tx(db: SQLiteDatabase, run: () => Promise<void>): Promise<void> {
  await db.execAsync('BEGIN');
  try {
    await run();
    await db.execAsync('COMMIT');
  } catch (error) {
    await db.execAsync('ROLLBACK');
    throw error;
  }
}

export async function getSelf(db: SQLiteDatabase): Promise<Member | null> {
  return db.getFirstAsync<Member>(
    `select ${MEMBER_SQL} from members where is_self = 1 limit 1`,
  );
}

export async function ensureSelf(db: SQLiteDatabase, name: string): Promise<string> {
  const existing = await getSelf(db);
  if (existing && !existing.deleted_at) return existing.id;
  const now = nowIso();
  if (existing) {
    await db.runAsync(
      'update members set name = ?, deleted_at = null, updated_at = ?, dirty = 1 where id = ?',
      name.trim() || existing.name,
      now,
      existing.id,
    );
    return existing.id;
  }
  const id = uuid();
  await db.runAsync(
    `insert into members (id, name, kind, phone, family_id, weight, is_self, updated_at, deleted_at, seq, dirty)
     values (?, ?, 'person', null, null, 1, 1, ?, null, 0, 1)`,
    id,
    name.trim() || 'Me',
    now,
  );
  return id;
}

export async function renameSelf(db: SQLiteDatabase, name: string): Promise<void> {
  const self = await getSelf(db);
  if (!self) return;
  await db.runAsync(
    'update members set name = ?, updated_at = ?, dirty = 1 where id = ?',
    name.trim(),
    nowIso(),
    self.id,
  );
}

export async function memberNames(
  db: SQLiteDatabase,
): Promise<Map<string, { name: string; is_self: number }>> {
  const rows = await db.getAllAsync<{ id: string; name: string; is_self: number }>(
    'select id, name, is_self from members',
  );
  return new Map(rows.map((row) => [row.id, { name: row.name, is_self: row.is_self }]));
}

export async function listMembers(db: SQLiteDatabase): Promise<Member[]> {
  return db.getAllAsync<Member>(
    `select ${MEMBER_SQL} from members where deleted_at is null order by name collate nocase`,
  );
}

export async function saveMember(
  db: SQLiteDatabase,
  input: {
    id?: string;
    name: string;
    kind: 'person' | 'family';
    phone: string | null;
    familyId: string | null;
    weight: number;
  },
): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error('Name is required');
  const weight = roundWeight(input.weight);
  if (!(weight > 0) || weight > 99.99) throw new Error('Weight must be between 0.01 and 99.99');
  const id = input.id ?? uuid();
  const now = nowIso();
  await db.runAsync(
    `insert into members (id, name, kind, phone, family_id, weight, is_self, updated_at, deleted_at, seq, dirty)
     values (?, ?, ?, ?, ?, ?, 0, ?, null, 0, 1)
     on conflict(id) do update set
       name = excluded.name,
       kind = excluded.kind,
       phone = excluded.phone,
       family_id = excluded.family_id,
       weight = excluded.weight,
       updated_at = excluded.updated_at,
       dirty = 1`,
    id,
    name,
    input.kind,
    input.phone,
    input.familyId,
    weight,
    now,
  );
  return id;
}

export async function softDeleteMember(db: SQLiteDatabase, id: string): Promise<string> {
  const self = await getSelf(db);
  if (self?.id === id) throw new Error('You stay on every list');
  const now = nowIso();
  await tx(db, async () => {
    await db.runAsync(
      `update members set deleted_at = ?, updated_at = ?, dirty = 1
       where deleted_at is null and (id = ? or family_id = ?)`,
      now,
      now,
      id,
      id,
    );
    await db.runAsync(
      `update group_members set deleted_at = ?, updated_at = ?, dirty = 1
       where deleted_at is null and member_id in (
         select id from members where id = ? or family_id = ?
       )`,
      now,
      now,
      id,
      id,
    );
  });
  return now;
}

export async function restoreMember(db: SQLiteDatabase, id: string, deletedAt: string): Promise<void> {
  const now = nowIso();
  await tx(db, async () => {
    await db.runAsync(
      `update members set deleted_at = null, updated_at = ?, dirty = 1
       where deleted_at = ? and (id = ? or family_id = ?)`,
      now,
      deletedAt,
      id,
      id,
    );
    await db.runAsync(
      `update group_members set deleted_at = null, updated_at = ?, dirty = 1
       where deleted_at = ? and member_id in (select id from members where id = ? or family_id = ?)`,
      now,
      deletedAt,
      id,
      id,
    );
  });
}

export async function listGroups(db: SQLiteDatabase): Promise<Group[]> {
  return db.getAllAsync<Group>(
    `select id, name, kind, default_split, currency, starts_on, ends_on, archived, updated_at, deleted_at, seq, dirty
     from groups
     where deleted_at is null and archived = 0
     order by updated_at desc`,
  );
}

export async function getGroup(db: SQLiteDatabase, id: string): Promise<Group | null> {
  return db.getFirstAsync<Group>(
    `select id, name, kind, default_split, currency, starts_on, ends_on, archived, updated_at, deleted_at, seq, dirty
     from groups where id = ?`,
    id,
  );
}

export async function getLastGroupId(db: SQLiteDatabase): Promise<string | null> {
  const row = await db.getFirstAsync<{ last_group_id: string | null }>(
    'select last_group_id from sync_state where id = 1',
  );
  return row?.last_group_id ?? null;
}

export async function setLastGroupId(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('update sync_state set last_group_id = ? where id = 1', id);
}

export async function createGroup(
  db: SQLiteDatabase,
  name: string,
  defaultSplit: 'per_head' | 'per_party',
  selfId: string,
): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Group name is required');
  const id = uuid();
  const now = nowIso();
  await tx(db, async () => {
    await db.runAsync(
      `insert into groups (
         id, name, kind, default_split, currency, starts_on, ends_on, archived, updated_at, deleted_at, seq, dirty
       ) values (?, ?, null, ?, 'INR', null, null, 0, ?, null, 0, 1)`,
      id,
      trimmed,
      defaultSplit,
      now,
    );
    await db.runAsync(
      `insert into group_members (group_id, member_id, weight, sort_order, updated_at, deleted_at, seq, dirty)
       values (?, ?, 1, 0, ?, null, 0, 1)`,
      id,
      selfId,
      now,
    );
    await db.runAsync('update sync_state set last_group_id = ? where id = 1', id);
  });
  return id;
}

export async function archiveGroup(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync(
    'update groups set archived = 1, updated_at = ?, dirty = 1 where id = ?',
    nowIso(),
    id,
  );
}

export async function listParties(db: SQLiteDatabase, groupId: string): Promise<Party[]> {
  return db.getAllAsync<Party>(
    `select gm.group_id, gm.member_id, gm.weight, gm.sort_order,
            m.name, m.kind, m.phone, m.weight as member_weight, m.is_self
     from group_members gm
     join members m on m.id = gm.member_id
     where gm.group_id = ? and gm.deleted_at is null and m.deleted_at is null
     order by gm.sort_order, m.name collate nocase`,
    groupId,
  );
}

export async function addParty(db: SQLiteDatabase, groupId: string, memberId: string, weight: number): Promise<void> {
  const rounded = roundWeight(weight);
  if (!(rounded > 0)) throw new Error('Headcount must be greater than 0');
  const max = await db.getFirstAsync<{ m: number | null }>(
    'select max(sort_order) as m from group_members where group_id = ?',
    groupId,
  );
  const sort = (max?.m ?? -1) + 1;
  const now = nowIso();
  await db.runAsync(
    `insert into group_members (group_id, member_id, weight, sort_order, updated_at, deleted_at, seq, dirty)
     values (?, ?, ?, ?, ?, null, 0, 1)
     on conflict(group_id, member_id) do update set
       weight = excluded.weight,
       deleted_at = null,
       updated_at = excluded.updated_at,
       dirty = 1`,
    groupId,
    memberId,
    rounded,
    sort,
    now,
  );
}

export async function setPartyWeight(
  db: SQLiteDatabase,
  groupId: string,
  memberId: string,
  weight: number,
): Promise<void> {
  const rounded = roundWeight(weight);
  if (!(rounded > 0)) throw new Error('Headcount must be greater than 0');
  await db.runAsync(
    'update group_members set weight = ?, updated_at = ?, dirty = 1 where group_id = ? and member_id = ?',
    rounded,
    nowIso(),
    groupId,
    memberId,
  );
}

export async function removeParty(db: SQLiteDatabase, groupId: string, memberId: string): Promise<void> {
  const now = nowIso();
  await db.runAsync(
    'update group_members set deleted_at = ?, updated_at = ?, dirty = 1 where group_id = ? and member_id = ?',
    now,
    now,
    groupId,
    memberId,
  );
}

export async function restoreParty(db: SQLiteDatabase, groupId: string, memberId: string): Promise<void> {
  await db.runAsync(
    'update group_members set deleted_at = null, updated_at = ?, dirty = 1 where group_id = ? and member_id = ?',
    nowIso(),
    groupId,
    memberId,
  );
}

export async function listExpenses(db: SQLiteDatabase, groupId: string): Promise<ExpenseRow[]> {
  return db.getAllAsync<ExpenseRow>(
    `select id, group_id, paid_by, amount_paise, split_type, note, category, spent_on,
            created_at, updated_at, deleted_at, seq, dirty
     from expenses
     where group_id = ? and deleted_at is null
     order by spent_on desc, created_at desc`,
    groupId,
  );
}

export async function getExpense(db: SQLiteDatabase, id: string): Promise<ExpenseRow | null> {
  return db.getFirstAsync<ExpenseRow>(
    `select id, group_id, paid_by, amount_paise, split_type, note, category, spent_on,
            created_at, updated_at, deleted_at, seq, dirty
     from expenses where id = ?`,
    id,
  );
}

export async function listSplits(db: SQLiteDatabase, expenseId: string): Promise<SplitRow[]> {
  return db.getAllAsync<SplitRow>(
    'select expense_id, member_id, weight, people, owed_paise from expense_splits where expense_id = ?',
    expenseId,
  );
}

export async function saveExpense(
  db: SQLiteDatabase,
  input: {
    id?: string;
    groupId: string;
    paidBy: string;
    amountPaise: number;
    splitType: SplitType;
    note: string | null;
    category: string | null;
    spentOn: string;
    splits: SavedSplit[];
  },
): Promise<string> {
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) {
    throw new Error('Amount must be greater than 0');
  }
  const sum = input.splits.reduce((total, split) => total + split.owedPaise, 0);
  if (sum !== input.amountPaise) {
    throw new Error('The shares do not add up to the amount');
  }
  if (input.splits.length === 0) throw new Error('Choose who shares this');
  const id = input.id ?? uuid();
  const now = nowIso();
  await tx(db, async () => {
    const existing = await db.getFirstAsync<{ created_at: string }>('select created_at from expenses where id = ?', id);
    await db.runAsync(
      `insert into expenses (
         id, group_id, paid_by, amount_paise, split_type, note, category, spent_on,
         created_at, updated_at, deleted_at, seq, dirty
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, 0, 1)
       on conflict(id) do update set
         group_id = excluded.group_id,
         paid_by = excluded.paid_by,
         amount_paise = excluded.amount_paise,
         split_type = excluded.split_type,
         note = excluded.note,
         category = excluded.category,
         spent_on = excluded.spent_on,
         updated_at = excluded.updated_at,
         deleted_at = null,
         dirty = 1`,
      id,
      input.groupId,
      input.paidBy,
      input.amountPaise,
      input.splitType,
      input.note,
      input.category,
      input.spentOn,
      existing?.created_at ?? now,
      now,
    );
    await db.runAsync('delete from expense_splits where expense_id = ?', id);
    for (const split of input.splits) {
      await db.runAsync(
        `insert into expense_splits (expense_id, member_id, weight, people, owed_paise, dirty)
         values (?, ?, ?, ?, ?, 1)`,
        id,
        split.memberId,
        split.weight,
        split.people.length > 0 ? JSON.stringify(split.people) : null,
        split.owedPaise,
      );
    }
    await db.runAsync('update sync_state set last_group_id = ? where id = 1', input.groupId);
  });
  return id;
}

export async function softDeleteExpense(db: SQLiteDatabase, id: string): Promise<void> {
  const now = nowIso();
  await db.runAsync(
    'update expenses set deleted_at = ?, updated_at = ?, dirty = 1 where id = ?',
    now,
    now,
    id,
  );
}

export async function restoreExpense(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync(
    'update expenses set deleted_at = null, updated_at = ?, dirty = 1 where id = ?',
    nowIso(),
    id,
  );
}

export async function listSettlements(db: SQLiteDatabase, groupId: string): Promise<SettlementRow[]> {
  return db.getAllAsync<SettlementRow>(
    `select id, group_id, from_member, to_member, amount_paise, note, paid_on, updated_at, deleted_at, seq, dirty
     from settlements
     where group_id = ? and deleted_at is null
     order by paid_on desc, updated_at desc`,
    groupId,
  );
}

export async function saveSettlement(
  db: SQLiteDatabase,
  input: {
    groupId: string;
    fromMember: string;
    toMember: string;
    amountPaise: number;
    note: string | null;
    paidOn: string;
  },
): Promise<string> {
  if (input.fromMember === input.toMember) throw new Error('Pick two different people');
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) {
    throw new Error('Amount must be greater than 0');
  }
  const id = uuid();
  const now = nowIso();
  await db.runAsync(
    `insert into settlements (
       id, group_id, from_member, to_member, amount_paise, note, paid_on, updated_at, deleted_at, seq, dirty
     ) values (?, ?, ?, ?, ?, ?, ?, ?, null, 0, 1)`,
    id,
    input.groupId,
    input.fromMember,
    input.toMember,
    input.amountPaise,
    input.note,
    input.paidOn,
    now,
  );
  return id;
}

export async function softDeleteSettlement(db: SQLiteDatabase, id: string): Promise<void> {
  const now = nowIso();
  await db.runAsync(
    'update settlements set deleted_at = ?, updated_at = ?, dirty = 1 where id = ?',
    now,
    now,
    id,
  );
}

export async function restoreSettlement(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync(
    'update settlements set deleted_at = null, updated_at = ?, dirty = 1 where id = ?',
    nowIso(),
    id,
  );
}

export async function findShareLink(
  db: SQLiteDatabase,
  groupId: string | null,
  memberId: string | null,
): Promise<ShareLinkRow | null> {
  if (memberId) {
    return db.getFirstAsync<ShareLinkRow>(
      `select id, token, group_id, member_id, updated_at, revoked_at, seq, dirty
       from share_links
       where revoked_at is null and group_id = ? and member_id = ?
       limit 1`,
      groupId,
      memberId,
    );
  }
  return db.getFirstAsync<ShareLinkRow>(
    `select id, token, group_id, member_id, updated_at, revoked_at, seq, dirty
     from share_links
     where revoked_at is null and group_id = ? and member_id is null
     limit 1`,
    groupId,
  );
}

export async function createShareLink(
  db: SQLiteDatabase,
  groupId: string,
  memberId: string | null,
): Promise<ShareLinkRow> {
  const existing = await findShareLink(db, groupId, memberId);
  if (existing) return existing;
  const id = uuid();
  const token = randomToken();
  const now = nowIso();
  await db.runAsync(
    `insert into share_links (id, token, group_id, member_id, updated_at, revoked_at, seq, dirty)
     values (?, ?, ?, ?, ?, null, 0, 1)`,
    id,
    token,
    groupId,
    memberId,
    now,
  );
  const created = await findShareLink(db, groupId, memberId);
  if (!created) throw new Error('The share link was not saved');
  return created;
}

export async function groupNets(db: SQLiteDatabase, groupId: string): Promise<Record<string, number>> {
  const rows = await db.getAllAsync<{
    id: string;
    paid_by: string;
    amount_paise: number;
    member_id: string | null;
    owed_paise: number | null;
  }>(
    `select e.id, e.paid_by, e.amount_paise, s.member_id, s.owed_paise
     from expenses e
     left join expense_splits s on s.expense_id = e.id
     where e.group_id = ? and e.deleted_at is null`,
    groupId,
  );
  const byId = new Map<string, BalanceExpense>();
  for (const row of rows) {
    let expense = byId.get(row.id);
    if (!expense) {
      expense = { paidBy: row.paid_by, amountPaise: row.amount_paise, splits: [] };
      byId.set(row.id, expense);
    }
    if (row.member_id && row.owed_paise != null) {
      expense.splits.push({ memberId: row.member_id, owedPaise: row.owed_paise });
    }
  }
  const settlements = await db.getAllAsync<{
    from_member: string;
    to_member: string;
    amount_paise: number;
  }>(
    `select from_member, to_member, amount_paise from settlements
     where group_id = ? and deleted_at is null`,
    groupId,
  );
  const settlementRows: BalanceSettlement[] = settlements.map((row) => ({
    fromMemberId: row.from_member,
    toMemberId: row.to_member,
    amountPaise: row.amount_paise,
  }));
  return computeBalances([...byId.values()], settlementRows);
}

export async function selfNet(db: SQLiteDatabase): Promise<number> {
  const self = await getSelf(db);
  if (!self) return 0;
  const groups = await listGroups(db);
  let total = 0;
  for (const group of groups) {
    const nets = await groupNets(db, group.id);
    total += nets[self.id] ?? 0;
  }
  return total;
}

type PushMember = {
  id: string;
  name: string;
  kind: 'person' | 'family';
  phone: string | null;
  family_id: string | null;
  weight: number;
  is_self: boolean;
  updated_at: string;
  deleted_at: string | null;
};

type PushGroup = {
  id: string;
  name: string;
  kind: string | null;
  default_split: 'per_head' | 'per_party';
  currency: string;
  starts_on: string | null;
  ends_on: string | null;
  archived: boolean;
  updated_at: string;
  deleted_at: string | null;
};

type PushParty = {
  group_id: string;
  member_id: string;
  weight: number | null;
  sort_order: number;
  updated_at: string;
  deleted_at: string | null;
};

type PushExpense = {
  id: string;
  group_id: string;
  paid_by: string;
  amount_paise: number;
  split_type: SplitType;
  note: string | null;
  category: string | null;
  spent_on: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  splits: { member_id: string; weight: number | null; people: string[]; owed_paise: number }[];
};

type PushSettlement = {
  id: string;
  group_id: string;
  from_member: string;
  to_member: string;
  amount_paise: number;
  note: string | null;
  paid_on: string;
  updated_at: string;
  deleted_at: string | null;
};

type PushLink = {
  id: string;
  token: string;
  group_id: string | null;
  member_id: string | null;
  updated_at: string;
  revoked_at: string | null;
};

export type PushBody = {
  members: PushMember[];
  groups: PushGroup[];
  group_members: PushParty[];
  expenses: PushExpense[];
  settlements: PushSettlement[];
  share_links: PushLink[];
};

export type PushedIds = {
  members: Set<string>;
  groups: Set<string>;
  parties: Set<string>;
  expenses: Set<string>;
  settlements: Set<string>;
  links: Set<string>;
};

function weightOf(value: number | null): number | null {
  if (value == null || Number.isNaN(value)) return null;
  const rounded = roundWeight(value);
  return rounded > 0 ? rounded : null;
}

function peopleOf(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

export async function collectPush(db: SQLiteDatabase): Promise<{ push: PushBody; pushed: PushedIds }> {
  const members = await db.getAllAsync<Member>(
    `select ${MEMBER_SQL} from members where dirty = 1`,
  );
  members.sort((a, b) => Number(Boolean(a.family_id)) - Number(Boolean(b.family_id)));
  const groups = await db.getAllAsync<Group>(
    `select id, name, kind, default_split, currency, starts_on, ends_on, archived, updated_at, deleted_at, seq, dirty
     from groups where dirty = 1`,
  );
  const parties = await db.getAllAsync<{
    group_id: string;
    member_id: string;
    weight: number | null;
    sort_order: number;
    updated_at: string;
    deleted_at: string | null;
  }>(
    `select group_id, member_id, weight, sort_order, updated_at, deleted_at
     from group_members where dirty = 1`,
  );
  const expenses = await db.getAllAsync<ExpenseRow>(
    `select id, group_id, paid_by, amount_paise, split_type, note, category, spent_on,
            created_at, updated_at, deleted_at, seq, dirty
     from expenses where dirty = 1`,
  );
  const settlements = await db.getAllAsync<SettlementRow>(
    `select id, group_id, from_member, to_member, amount_paise, note, paid_on, updated_at, deleted_at, seq, dirty
     from settlements where dirty = 1`,
  );
  const links = await db.getAllAsync<ShareLinkRow>(
    `select id, token, group_id, member_id, updated_at, revoked_at, seq, dirty
     from share_links where dirty = 1`,
  );

  const pushExpenses: PushExpense[] = [];
  for (const expense of expenses) {
    const splits = await listSplits(db, expense.id);
    if (splits.length === 0) continue;
    pushExpenses.push({
      id: expense.id,
      group_id: expense.group_id,
      paid_by: expense.paid_by,
      amount_paise: expense.amount_paise,
      split_type: expense.split_type,
      note: expense.note,
      category: expense.category,
      spent_on: expense.spent_on,
      created_at: expense.created_at,
      updated_at: expense.updated_at,
      deleted_at: expense.deleted_at,
      splits: splits.map((split) => ({
        member_id: split.member_id,
        weight: weightOf(split.weight),
        people: peopleOf(split.people),
        owed_paise: split.owed_paise,
      })),
    });
  }

  return {
    push: {
      members: members.map((member) => ({
        id: member.id,
        name: member.name,
        kind: member.kind,
        phone: member.phone,
        family_id: member.family_id,
        weight: weightOf(member.weight) ?? 1,
        is_self: member.is_self === 1,
        updated_at: member.updated_at,
        deleted_at: member.deleted_at,
      })),
      groups: groups.map((group) => ({
        id: group.id,
        name: group.name,
        kind: group.kind,
        default_split: group.default_split,
        currency: group.currency,
        starts_on: group.starts_on,
        ends_on: group.ends_on,
        archived: group.archived === 1,
        updated_at: group.updated_at,
        deleted_at: group.deleted_at,
      })),
      group_members: parties.map((party) => ({
        group_id: party.group_id,
        member_id: party.member_id,
        weight: weightOf(party.weight),
        sort_order: party.sort_order,
        updated_at: party.updated_at,
        deleted_at: party.deleted_at,
      })),
      expenses: pushExpenses,
      settlements: settlements.map((row) => ({
        id: row.id,
        group_id: row.group_id,
        from_member: row.from_member,
        to_member: row.to_member,
        amount_paise: row.amount_paise,
        note: row.note,
        paid_on: row.paid_on,
        updated_at: row.updated_at,
        deleted_at: row.deleted_at,
      })),
      share_links: links
        .filter((link) => link.group_id || link.member_id)
        .map((link) => ({
          id: link.id,
          token: link.token,
          group_id: link.group_id,
          member_id: link.member_id,
          updated_at: link.updated_at,
          revoked_at: link.revoked_at,
        })),
    },
    pushed: {
      members: new Set(members.map((member) => member.id)),
      groups: new Set(groups.map((group) => group.id)),
      parties: new Set(parties.map((party) => `${party.group_id}:${party.member_id}`)),
      expenses: new Set(pushExpenses.map((expense) => expense.id)),
      settlements: new Set(settlements.map((row) => row.id)),
      links: new Set(links.map((link) => link.id)),
    },
  };
}

export async function getCursor(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ cursor: number }>('select cursor from sync_state where id = 1');
  return row?.cursor ?? 0;
}

type RemoteGroup = {
  id: string;
  name: string;
  kind: string | null;
  default_split: 'per_head' | 'per_party';
  currency: string;
  starts_on: string | null;
  ends_on: string | null;
  archived: boolean;
  updated_at: string;
  deleted_at: string | null;
  seq: number;
};

type RemoteParty = {
  group_id: string;
  member_id: string;
  weight: number | null;
  sort_order: number;
  updated_at: string;
  deleted_at: string | null;
  seq: number;
};

type RemoteSplit = {
  member_id: string;
  weight: number | null;
  people: string[] | null;
  owed_paise: number;
};

type RemoteExpense = {
  id: string;
  group_id: string;
  paid_by: string;
  amount_paise: number;
  split_type: SplitType;
  note: string | null;
  category: string | null;
  spent_on: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  seq: number;
  splits: RemoteSplit[];
};

type RemoteSettlement = {
  id: string;
  group_id: string;
  from_member: string;
  to_member: string;
  amount_paise: number;
  note: string | null;
  paid_on: string;
  updated_at: string;
  deleted_at: string | null;
  seq: number;
};

type RemoteLink = {
  id: string;
  token: string;
  group_id: string | null;
  member_id: string | null;
  updated_at: string;
  revoked_at: string | null;
  seq: number;
};

export type RemotePull = {
  members: RemoteMember[];
  groups: RemoteGroup[];
  group_members: RemoteParty[];
  expenses: RemoteExpense[];
  settlements: RemoteSettlement[];
  share_links: RemoteLink[];
};

async function dirtyId(db: SQLiteDatabase, sql: string, ...params: (string | number)[]): Promise<boolean> {
  const row = await db.getFirstAsync<{ dirty: number }>(sql, ...params);
  return row?.dirty === 1;
}

export async function applyPull(
  db: SQLiteDatabase,
  pull: RemotePull,
  pushed: PushedIds,
  cursor: number,
): Promise<void> {
  const serverSelf = pull.members.find((member) => member.is_self && !member.deleted_at);
  const localSelf = await getSelf(db);
  if (serverSelf && localSelf && localSelf.id !== serverSelf.id) {
    throw new SelfConflictError(localSelf.id, serverSelf);
  }

  const members = [...pull.members].sort((a, b) => Number(Boolean(a.family_id)) - Number(Boolean(b.family_id)));
  await tx(db, async () => {
    for (const member of members) {
      if (await dirtyId(db, 'select dirty from members where id = ?', member.id) && !pushed.members.has(member.id)) {
        continue;
      }
      await db.runAsync(
        `insert into members (id, name, kind, phone, family_id, weight, is_self, updated_at, deleted_at, seq, dirty)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
         on conflict(id) do update set
           name = excluded.name,
           kind = excluded.kind,
           phone = excluded.phone,
           family_id = excluded.family_id,
           weight = excluded.weight,
           is_self = excluded.is_self,
           updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at,
           seq = excluded.seq,
           dirty = 0`,
        member.id,
        member.name,
        member.kind,
        member.phone,
        member.family_id,
        member.weight,
        member.is_self ? 1 : 0,
        member.updated_at,
        member.deleted_at,
        member.seq,
      );
    }

    for (const group of pull.groups) {
      if (await dirtyId(db, 'select dirty from groups where id = ?', group.id) && !pushed.groups.has(group.id)) {
        continue;
      }
      await db.runAsync(
        `insert into groups (
           id, name, kind, default_split, currency, starts_on, ends_on, archived, updated_at, deleted_at, seq, dirty
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
         on conflict(id) do update set
           name = excluded.name,
           kind = excluded.kind,
           default_split = excluded.default_split,
           currency = excluded.currency,
           starts_on = excluded.starts_on,
           ends_on = excluded.ends_on,
           archived = excluded.archived,
           updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at,
           seq = excluded.seq,
           dirty = 0`,
        group.id,
        group.name,
        group.kind,
        group.default_split,
        group.currency,
        group.starts_on,
        group.ends_on,
        group.archived ? 1 : 0,
        group.updated_at,
        group.deleted_at,
        group.seq,
      );
    }

    for (const party of pull.group_members) {
      const key = `${party.group_id}:${party.member_id}`;
      if (
        await dirtyId(
          db,
          'select dirty from group_members where group_id = ? and member_id = ?',
          party.group_id,
          party.member_id,
        ) && !pushed.parties.has(key)
      ) {
        continue;
      }
      await db.runAsync(
        `insert into group_members (group_id, member_id, weight, sort_order, updated_at, deleted_at, seq, dirty)
         values (?, ?, ?, ?, ?, ?, ?, 0)
         on conflict(group_id, member_id) do update set
           weight = excluded.weight,
           sort_order = excluded.sort_order,
           updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at,
           seq = excluded.seq,
           dirty = 0`,
        party.group_id,
        party.member_id,
        party.weight,
        party.sort_order,
        party.updated_at,
        party.deleted_at,
        party.seq,
      );
    }

    for (const expense of pull.expenses) {
      if (await dirtyId(db, 'select dirty from expenses where id = ?', expense.id) && !pushed.expenses.has(expense.id)) {
        continue;
      }
      await db.runAsync(
        `insert into expenses (
           id, group_id, paid_by, amount_paise, split_type, note, category, spent_on,
           created_at, updated_at, deleted_at, seq, dirty
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
         on conflict(id) do update set
           group_id = excluded.group_id,
           paid_by = excluded.paid_by,
           amount_paise = excluded.amount_paise,
           split_type = excluded.split_type,
           note = excluded.note,
           category = excluded.category,
           spent_on = excluded.spent_on,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at,
           seq = excluded.seq,
           dirty = 0`,
        expense.id,
        expense.group_id,
        expense.paid_by,
        expense.amount_paise,
        expense.split_type,
        expense.note,
        expense.category,
        expense.spent_on,
        expense.created_at,
        expense.updated_at,
        expense.deleted_at,
        expense.seq,
      );
      await db.runAsync('delete from expense_splits where expense_id = ?', expense.id);
      for (const split of expense.splits) {
        await db.runAsync(
          `insert into expense_splits (expense_id, member_id, weight, people, owed_paise, dirty)
           values (?, ?, ?, ?, ?, 0)`,
          expense.id,
          split.member_id,
          split.weight,
          split.people && split.people.length > 0 ? JSON.stringify(split.people) : null,
          split.owed_paise,
        );
      }
    }

    for (const row of pull.settlements) {
      if (
        await dirtyId(db, 'select dirty from settlements where id = ?', row.id) && !pushed.settlements.has(row.id)
      ) {
        continue;
      }
      await db.runAsync(
        `insert into settlements (
           id, group_id, from_member, to_member, amount_paise, note, paid_on, updated_at, deleted_at, seq, dirty
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
         on conflict(id) do update set
           group_id = excluded.group_id,
           from_member = excluded.from_member,
           to_member = excluded.to_member,
           amount_paise = excluded.amount_paise,
           note = excluded.note,
           paid_on = excluded.paid_on,
           updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at,
           seq = excluded.seq,
           dirty = 0`,
        row.id,
        row.group_id,
        row.from_member,
        row.to_member,
        row.amount_paise,
        row.note,
        row.paid_on,
        row.updated_at,
        row.deleted_at,
        row.seq,
      );
    }

    for (const link of pull.share_links) {
      if (await dirtyId(db, 'select dirty from share_links where id = ?', link.id) && !pushed.links.has(link.id)) {
        continue;
      }
      await db.runAsync(
        `insert into share_links (id, token, group_id, member_id, updated_at, revoked_at, seq, dirty)
         values (?, ?, ?, ?, ?, ?, ?, 0)
         on conflict(id) do update set
           token = excluded.token,
           group_id = excluded.group_id,
           member_id = excluded.member_id,
           updated_at = excluded.updated_at,
           revoked_at = excluded.revoked_at,
           seq = excluded.seq,
           dirty = 0`,
        link.id,
        link.token,
        link.group_id,
        link.member_id,
        link.updated_at,
        link.revoked_at,
        link.seq,
      );
    }

    await db.runAsync('update sync_state set cursor = ? where id = 1', cursor);
  });
}

export async function replaceSelf(db: SQLiteDatabase, localId: string, server: RemoteMember): Promise<void> {
  if (localId === server.id) return;
  const parties = await db.getAllAsync<{
    group_id: string;
    weight: number | null;
    sort_order: number;
    dirty: number;
  }>('select group_id, weight, sort_order, dirty from group_members where member_id = ?', localId);
  const splits = await db.getAllAsync<{ expense_id: string }>(
    'select expense_id from expense_splits where member_id = ?',
    localId,
  );
  await db.execAsync('PRAGMA foreign_keys = OFF');
  await db.execAsync('BEGIN');
  try {
    const now = nowIso();
    for (const party of parties) {
      const taken = await db.getFirstAsync<{ ok: number }>(
        'select 1 as ok from group_members where group_id = ? and member_id = ?',
        party.group_id,
        server.id,
      );
      if (taken) {
        if (party.dirty) {
          await db.runAsync(
            `update group_members
             set weight = ?, sort_order = ?, updated_at = ?, dirty = 1, deleted_at = null
             where group_id = ? and member_id = ?`,
            party.weight,
            party.sort_order,
            now,
            party.group_id,
            server.id,
          );
        }
        await db.runAsync(
          'delete from group_members where group_id = ? and member_id = ?',
          party.group_id,
          localId,
        );
      } else {
        await db.runAsync(
          'update group_members set member_id = ?, dirty = 1, updated_at = ? where group_id = ? and member_id = ?',
          server.id,
          now,
          party.group_id,
          localId,
        );
      }
    }
    for (const split of splits) {
      const taken = await db.getFirstAsync<{ ok: number }>(
        'select 1 as ok from expense_splits where expense_id = ? and member_id = ?',
        split.expense_id,
        server.id,
      );
      if (taken) {
        await db.runAsync(
          'delete from expense_splits where expense_id = ? and member_id = ?',
          split.expense_id,
          localId,
        );
      } else {
        await db.runAsync(
          'update expense_splits set member_id = ? where expense_id = ? and member_id = ?',
          server.id,
          split.expense_id,
          localId,
        );
      }
      await db.runAsync(
        'update expenses set dirty = 1, updated_at = ? where id = ?',
        now,
        split.expense_id,
      );
    }
    const peopleRows = await db.getAllAsync<{ expense_id: string; member_id: string; people: string }>(
      'select expense_id, member_id, people from expense_splits where people like ?',
      `%${localId}%`,
    );
    for (const row of peopleRows) {
      await db.runAsync(
        'update expense_splits set people = ? where expense_id = ? and member_id = ?',
        row.people.split(localId).join(server.id),
        row.expense_id,
        row.member_id,
      );
      await db.runAsync('update expenses set dirty = 1, updated_at = ? where id = ?', now, row.expense_id);
    }
    await db.runAsync(
      'update expenses set paid_by = ?, dirty = 1, updated_at = ? where paid_by = ?',
      server.id,
      now,
      localId,
    );
    await db.runAsync(
      'update settlements set from_member = ?, dirty = 1, updated_at = ? where from_member = ?',
      server.id,
      now,
      localId,
    );
    await db.runAsync(
      'update settlements set to_member = ?, dirty = 1, updated_at = ? where to_member = ?',
      server.id,
      now,
      localId,
    );
    await db.runAsync(
      'update share_links set member_id = ?, dirty = 1, updated_at = ? where member_id = ?',
      server.id,
      now,
      localId,
    );
    await db.runAsync(
      'update members set family_id = ?, dirty = 1, updated_at = ? where family_id = ?',
      server.id,
      now,
      localId,
    );
    await db.runAsync('delete from members where id = ?', localId);
    await db.runAsync(
      `insert into members (id, name, kind, phone, family_id, weight, is_self, updated_at, deleted_at, seq, dirty)
       values (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 0)`,
      server.id,
      server.name,
      server.kind,
      server.phone,
      server.family_id,
      server.weight,
      server.updated_at,
      server.deleted_at,
      server.seq,
    );
    await db.execAsync('COMMIT');
  } catch (error) {
    await db.execAsync('ROLLBACK');
    throw error;
  } finally {
    await db.execAsync('PRAGMA foreign_keys = ON');
  }
}
