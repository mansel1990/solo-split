import { resolveSplit } from '../resolveSplit';
import type { BalanceExpense, Transfer } from '../types';

export const coorgMembers = {
  sanjay: 'sanjay',
  ravi: 'ravi',
  arun: 'arun',
  karthik: 'karthik',
  vijay: 'vijay',
} as const;

const heads = [
  { memberId: coorgMembers.sanjay, weight: 2 },
  { memberId: coorgMembers.ravi, weight: 2 },
  { memberId: coorgMembers.arun, weight: 1 },
  { memberId: coorgMembers.karthik, weight: 1 },
  { memberId: coorgMembers.vijay, weight: 1 },
];

function rupees(amount: number): number {
  return amount * 100;
}

function expense(
  paidBy: string,
  amountRupees: number,
  type: 'per_head' | 'per_party',
  parties: { memberId: string; weight?: number }[],
): BalanceExpense {
  const amountPaise = rupees(amountRupees);
  const resolved = resolveSplit(amountPaise, type, parties);
  return {
    paidBy,
    amountPaise,
    splits: resolved.map((share) => ({
      memberId: share.memberId,
      owedPaise: share.owedPaise,
    })),
  };
}

/** PRD worked example. Drinks are the three bachelors only, one share each. */
export const coorgExpenses: BalanceExpense[] = [
  expense(coorgMembers.sanjay, 21000, 'per_head', heads),
  expense(coorgMembers.ravi, 7000, 'per_head', heads),
  expense(coorgMembers.arun, 10500, 'per_head', heads),
  expense(coorgMembers.karthik, 3000, 'per_party', [
    { memberId: coorgMembers.arun },
    { memberId: coorgMembers.karthik },
    { memberId: coorgMembers.vijay },
  ]),
];

export const coorgNets: Record<string, number> = {
  sanjay: rupees(10000),
  ravi: rupees(-4000),
  arun: rupees(4000),
  karthik: rupees(-3500),
  vijay: rupees(-6500),
};

export const coorgTransfers: Transfer[] = [
  { fromMemberId: coorgMembers.vijay, toMemberId: coorgMembers.sanjay, amountPaise: rupees(6500) },
  { fromMemberId: coorgMembers.ravi, toMemberId: coorgMembers.arun, amountPaise: rupees(4000) },
  { fromMemberId: coorgMembers.karthik, toMemberId: coorgMembers.sanjay, amountPaise: rupees(3500) },
];
