import { apiBaseUrl } from './config';
import {
  applyPull,
  collectPush,
  getCursor,
  replaceSelf,
  SelfConflictError,
  type PushBody,
  type PushedIds,
  type RemoteMember,
  type RemotePull,
} from './db/data';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { SplitType } from './money';

export type SyncResult =
  | { ok: true }
  | { ok: false; message: string; offline?: boolean; status?: number; id?: string };

export type SyncStatus = {
  state: 'idle' | 'syncing' | 'saved' | 'offline' | 'error';
  message: string;
  at: number;
};

type Bound = { db: SQLiteDatabase; jwt: string };

let bound: Bound | null = null;
let epoch = 0;
let inflight: Promise<SyncResult> | null = null;
let status: SyncStatus = { state: 'idle', message: '', at: 0 };
const listeners = new Set<(next: SyncStatus) => void>();

function emit(next: SyncStatus): void {
  status = next;
  listeners.forEach((listener) => listener(next));
}

export function useSyncSnapshot(): SyncStatus {
  return status;
}

export function subscribeSync(listener: (next: SyncStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function bindSync(db: SQLiteDatabase, jwt: string): void {
  bound = { db, jwt };
}

export function unbindSync(): void {
  bound = null;
  epoch += 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function bool(value: unknown): boolean {
  return value === true || value === 1;
}

function parseMember(value: unknown): RemoteMember {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    throw new Error('Sync response had a broken person');
  }
  const weight = num(value.weight);
  const seq = num(value.seq);
  const kind = value.kind === 'family' ? 'family' : 'person';
  if (weight == null || seq == null || typeof value.updated_at !== 'string') {
    throw new Error('Sync response had a broken person');
  }
  return {
    id: value.id,
    name: value.name,
    kind,
    phone: str(value.phone),
    family_id: str(value.family_id),
    weight,
    is_self: bool(value.is_self),
    updated_at: value.updated_at,
    deleted_at: str(value.deleted_at),
    seq,
  };
}

function parsePull(value: unknown): { cursor: number; pull: RemotePull } {
  if (!isRecord(value)) throw new Error('Sync response was incomplete');
  const cursor = num(value.cursor);
  if (cursor == null || !isRecord(value.pull)) throw new Error('Sync response was incomplete');
  const pull = value.pull;
  const list = (key: string): unknown[] => (Array.isArray(pull[key]) ? pull[key] : []);
  return {
    cursor,
    pull: {
      members: list('members').map(parseMember),
      groups: list('groups').map((row) => {
        if (!isRecord(row) || typeof row.id !== 'string' || typeof row.name !== 'string') {
          throw new Error('Sync response had a broken group');
        }
        const seq = num(row.seq);
        if (seq == null || typeof row.updated_at !== 'string' || typeof row.default_split !== 'string') {
          throw new Error('Sync response had a broken group');
        }
        return {
          id: row.id,
          name: row.name,
          kind: str(row.kind),
          default_split: row.default_split === 'per_party' ? 'per_party' as const : 'per_head' as const,
          currency: typeof row.currency === 'string' ? row.currency : 'INR',
          starts_on: str(row.starts_on),
          ends_on: str(row.ends_on),
          archived: bool(row.archived),
          updated_at: row.updated_at,
          deleted_at: str(row.deleted_at),
          seq,
        };
      }),
      group_members: list('group_members').map((row) => {
        if (!isRecord(row) || typeof row.group_id !== 'string' || typeof row.member_id !== 'string') {
          throw new Error('Sync response had a broken party');
        }
        const seq = num(row.seq);
        const sort = num(row.sort_order);
        if (seq == null || sort == null || typeof row.updated_at !== 'string') {
          throw new Error('Sync response had a broken party');
        }
        return {
          group_id: row.group_id,
          member_id: row.member_id,
          weight: num(row.weight),
          sort_order: sort,
          updated_at: row.updated_at,
          deleted_at: str(row.deleted_at),
          seq,
        };
      }),
      expenses: list('expenses').map((row) => {
        if (!isRecord(row) || typeof row.id !== 'string') throw new Error('Sync response had a broken expense');
        const amount = num(row.amount_paise);
        const seq = num(row.seq);
        if (
          amount == null || seq == null
          || typeof row.group_id !== 'string'
          || typeof row.paid_by !== 'string'
          || typeof row.spent_on !== 'string'
          || typeof row.created_at !== 'string'
          || typeof row.updated_at !== 'string'
          || typeof row.split_type !== 'string'
        ) {
          throw new Error('Sync response had a broken expense');
        }
        const splits = Array.isArray(row.splits) ? row.splits : [];
        return {
          id: row.id,
          group_id: row.group_id,
          paid_by: row.paid_by,
          amount_paise: amount,
          split_type: row.split_type as SplitType,
          note: str(row.note),
          category: str(row.category),
          spent_on: row.spent_on,
          created_at: row.created_at,
          updated_at: row.updated_at,
          deleted_at: str(row.deleted_at),
          seq,
          splits: splits.map((split) => {
            if (!isRecord(split) || typeof split.member_id !== 'string') {
              throw new Error('Sync response had a broken share');
            }
            const owed = num(split.owed_paise);
            if (owed == null) throw new Error('Sync response had a broken share');
            const people = Array.isArray(split.people)
              ? split.people.filter((person): person is string => typeof person === 'string')
              : [];
            return {
              member_id: split.member_id,
              weight: num(split.weight),
              people,
              owed_paise: owed,
            };
          }),
        };
      }),
      settlements: list('settlements').map((row) => {
        if (!isRecord(row) || typeof row.id !== 'string') throw new Error('Sync response had a broken payment');
        const amount = num(row.amount_paise);
        const seq = num(row.seq);
        if (
          amount == null || seq == null
          || typeof row.group_id !== 'string'
          || typeof row.from_member !== 'string'
          || typeof row.to_member !== 'string'
          || typeof row.paid_on !== 'string'
          || typeof row.updated_at !== 'string'
        ) {
          throw new Error('Sync response had a broken payment');
        }
        return {
          id: row.id,
          group_id: row.group_id,
          from_member: row.from_member,
          to_member: row.to_member,
          amount_paise: amount,
          note: str(row.note),
          paid_on: row.paid_on,
          updated_at: row.updated_at,
          deleted_at: str(row.deleted_at),
          seq,
        };
      }),
      share_links: list('share_links').map((row) => {
        if (!isRecord(row) || typeof row.id !== 'string' || typeof row.token !== 'string') {
          throw new Error('Sync response had a broken link');
        }
        const seq = num(row.seq);
        if (seq == null || typeof row.updated_at !== 'string') throw new Error('Sync response had a broken link');
        return {
          id: row.id,
          token: row.token,
          group_id: str(row.group_id),
          member_id: str(row.member_id),
          updated_at: row.updated_at,
          revoked_at: str(row.revoked_at),
          seq,
        };
      }),
    },
  };
}

const emptyPush = (): PushBody => ({
  members: [],
  groups: [],
  group_members: [],
  expenses: [],
  settlements: [],
  share_links: [],
});

type PostSuccess = { ok: true; cursor: number; pull: RemotePull };
type PostFailure = { ok: false; message: string; offline?: boolean; status?: number; id?: string };

async function postSync(
  jwt: string,
  since: number,
  push: PushBody,
): Promise<PostSuccess | PostFailure> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}/api/sync`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ since, push }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return { ok: false, offline: true, message: 'Saved on this phone' };
  }
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = null;
    }
  }
  if (!response.ok) {
    const message = isRecord(body) && typeof body.message === 'string'
      ? body.message
      : `Sync failed (${response.status})`;
    const id = isRecord(body) && typeof body.id === 'string' ? body.id : undefined;
    return { ok: false, message, status: response.status, id };
  }
  try {
    const parsed = parsePull(body);
    return { ok: true, cursor: parsed.cursor, pull: parsed.pull };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Sync response was incomplete' };
  }
}

async function syncOnce(attempt = 0): Promise<SyncResult> {
  if (!bound) return { ok: false, message: 'Not signed in' };
  const { db, jwt } = bound;
  const epochAtStart = epoch;
  const collected = await collectPush(db);
  const since = await getCursor(db);
  const result = await postSync(jwt, since, collected.push);
  if (!result.ok) {
    if (
      attempt < 1
      && result.status === 422
      && result.message === 'conflicts with an existing row'
      && result.id
    ) {
      const local = collected.push.members.find((member) => member.id === result.id && member.is_self);
      if (local) {
        const pulled = await postSync(jwt, since, emptyPush());
        if (!pulled.ok) return pulled;
        const serverSelf = pulled.pull.members.find((member) => member.is_self && !member.deleted_at);
        if (serverSelf && serverSelf.id !== local.id) {
          if (epoch !== epochAtStart) return { ok: false, message: 'Not signed in' };
          await replaceSelf(db, local.id, serverSelf);
          const empty: PushedIds = {
            members: new Set(),
            groups: new Set(),
            parties: new Set(),
            expenses: new Set(),
            settlements: new Set(),
            links: new Set(),
          };
          await applyPull(db, pulled.pull, empty, pulled.cursor);
          return syncOnce(attempt + 1);
        }
      }
    }
    return result;
  }
  if (epoch !== epochAtStart) return { ok: false, message: 'Not signed in' };
  try {
    await applyPull(db, result.pull, collected.pushed, result.cursor);
  } catch (error) {
    if (error instanceof SelfConflictError && attempt < 1 && epoch === epochAtStart) {
      await replaceSelf(db, error.localId, error.server);
      return syncOnce(attempt + 1);
    }
    return { ok: false, message: error instanceof Error ? error.message : 'Could not save the sync' };
  }
  return { ok: true };
}

function startSync(): Promise<SyncResult> {
  if (inflight) return inflight;
  emit({ state: 'syncing', message: 'Syncing…', at: Date.now() });
  const run = syncOnce()
    .then((result) => {
      if (result.ok) emit({ state: 'saved', message: 'Synced', at: Date.now() });
      else if (result.offline) emit({ state: 'offline', message: result.message, at: Date.now() });
      else emit({ state: 'error', message: result.message, at: Date.now() });
      return result;
    })
    .finally(() => {
      if (inflight === run) inflight = null;
    });
  inflight = run;
  return run;
}

export function syncNow(): Promise<SyncResult> {
  if (!bound) return Promise.resolve({ ok: false, message: 'Not signed in' });
  if (!inflight) return startSync();
  const current = inflight;
  return current.then((result) => {
    if (!result.ok) return result;
    if (inflight && inflight !== current) return inflight;
    return startSync();
  });
}

let timer: ReturnType<typeof setTimeout> | null = null;

export function scheduleSync(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncNow();
  }, 700);
}
