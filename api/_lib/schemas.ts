import { z, ZodError } from 'zod';
import { HttpError } from './errors.js';

const timestamp = z.string().datetime({ offset: true });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();

function decimals(places: number, max: number) {
  return z.number().positive().max(max).refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6,
    `weight supports at most ${places} decimal places`,
  );
}

const memberWeight = decimals(2, 99.99);
const headcount = decimals(2, 999.99);
const shareWeight = decimals(2, 999999.99);

export const memberSchema = z.object({
  id: uuid,
  name: z.string().trim().min(1).max(200),
  kind: z.enum(['person', 'family']),
  phone: z.string().regex(/^\+[1-9]\d{1,14}$/).nullable().optional(),
  family_id: uuid.nullable().optional(),
  weight: memberWeight,
  is_self: z.boolean(),
  updated_at: timestamp,
  deleted_at: timestamp.nullable().optional(),
});

export const groupSchema = z.object({
  id: uuid,
  name: z.string().trim().min(1).max(200),
  kind: z.string().trim().min(1).max(40).nullable().optional(),
  default_split: z.enum(['per_head', 'per_party']),
  currency: z.string().regex(/^[A-Z]{3}$/),
  starts_on: day.nullable().optional(),
  ends_on: day.nullable().optional(),
  archived: z.boolean(),
  updated_at: timestamp,
  deleted_at: timestamp.nullable().optional(),
});

export const groupMemberSchema = z.object({
  group_id: uuid,
  member_id: uuid,
  weight: headcount.nullable().optional(),
  sort_order: z.number().int().min(0).max(10000),
  updated_at: timestamp,
  deleted_at: timestamp.nullable().optional(),
});

const splitSchema = z.object({
  member_id: uuid,
  weight: shareWeight.nullable().optional(),
  people: z.array(uuid).nullable().optional(),
  owed_paise: z.number().int().nonnegative(),
});

export const expenseSchema = z.object({
  id: uuid,
  group_id: uuid,
  paid_by: uuid,
  amount_paise: z.number().int().positive(),
  split_type: z.enum(['per_head', 'per_party', 'shares', 'exact']),
  note: z.string().max(500).nullable().optional(),
  category: z.string().max(80).nullable().optional(),
  spent_on: day,
  created_at: timestamp,
  updated_at: timestamp,
  deleted_at: timestamp.nullable().optional(),
  splits: z.array(splitSchema).min(1),
}).superRefine((expense, ctx) => {
  const sum = expense.splits.reduce((total, split) => total + split.owed_paise, 0);
  if (!Number.isSafeInteger(sum) || sum !== expense.amount_paise) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `splits sum to ${sum}, expected ${expense.amount_paise}`,
      path: ['splits'],
    });
  }
  const seen = new Set<string>();
  expense.splits.forEach((split, index) => {
    if (seen.has(split.member_id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'duplicate split member',
        path: ['splits', index, 'member_id'],
      });
    }
    seen.add(split.member_id);
    const needsWeight = expense.split_type === 'per_head' || expense.split_type === 'shares';
    if (needsWeight && !(split.weight && split.weight > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'weight is required',
        path: ['splits', index, 'weight'],
      });
    }
  });
});

export const settlementSchema = z.object({
  id: uuid,
  group_id: uuid,
  from_member: uuid,
  to_member: uuid,
  amount_paise: z.number().int().positive(),
  note: z.string().max(500).nullable().optional(),
  paid_on: day,
  updated_at: timestamp,
  deleted_at: timestamp.nullable().optional(),
}).refine((row) => row.from_member !== row.to_member, {
  message: 'from_member and to_member must differ',
});

export const shareLinkSchema = z.object({
  id: uuid,
  token: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
  group_id: uuid.nullable().optional(),
  member_id: uuid.nullable().optional(),
  updated_at: timestamp,
  revoked_at: timestamp.nullable().optional(),
}).refine((row) => Boolean(row.group_id || row.member_id), {
  message: 'group_id or member_id is required',
});

export const syncSchema = z.object({
  since: z.number().int().nonnegative(),
  push: z.object({
    members: z.array(memberSchema).default([]),
    groups: z.array(groupSchema).default([]),
    group_members: z.array(groupMemberSchema).default([]),
    expenses: z.array(expenseSchema).default([]),
    settlements: z.array(settlementSchema).default([]),
    share_links: z.array(shareLinkSchema).default([]),
  }),
});

export const googleAuthSchema = z.object({
  idToken: z.string().min(20),
});

export const patchMeSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  upi_vpa: z.string().trim().min(3).max(100).nullable().optional(),
}).refine((body) => body.name !== undefined || body.upi_vpa !== undefined, {
  message: 'name or upi_vpa is required',
});

export type SyncBody = z.infer<typeof syncSchema>;
export type MemberInput = z.infer<typeof memberSchema>;
export type GroupInput = z.infer<typeof groupSchema>;
export type GroupMemberInput = z.infer<typeof groupMemberSchema>;
export type ExpenseInput = z.infer<typeof expenseSchema>;
export type SettlementInput = z.infer<typeof settlementSchema>;
export type ShareLinkInput = z.infer<typeof shareLinkSchema>;

export function zodHttpError(error: ZodError, body: unknown): HttpError {
  const issue = error.issues[0];
  return new HttpError(422, issue?.message ?? 'invalid request', rowId(body, issue?.path ?? []));
}

function rowId(body: unknown, path: Array<string | number>): string | undefined {
  let current: unknown = body;
  let id: string | undefined;
  for (const key of path) {
    if (!current || typeof current !== 'object') break;
    const record = current as Record<string, unknown>;
    if (typeof record.id === 'string') id = record.id;
    else if (typeof record.group_id === 'string' && typeof record.member_id === 'string') {
      id = `${record.group_id}:${record.member_id}`;
    }
    current = record[String(key)];
  }
  return id;
}
