import type { BalanceExpense, BalanceSettlement } from './types';

function assertPaise(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be an integer number of paise`);
  }
}

function add(nets: Record<string, number>, memberId: string, delta: number): void {
  nets[memberId] = (nets[memberId] ?? 0) + delta;
}

/**
 * net = paid − owed + settlements paid out − settlements received.
 * Positive means the party is owed money. fromMember is the payer.
 */
export function computeBalances(
  expenses: BalanceExpense[],
  settlements: BalanceSettlement[],
): Record<string, number> {
  const nets: Record<string, number> = {};

  for (const expense of expenses) {
    if (expense.deletedAt) continue;
    assertPaise(expense.amountPaise, 'amountPaise');
    if (expense.amountPaise <= 0) throw new Error('amountPaise must be positive');
    add(nets, expense.paidBy, expense.amountPaise);
    for (const split of expense.splits) {
      assertPaise(split.owedPaise, 'owedPaise');
      if (split.owedPaise < 0) throw new Error('owedPaise cannot be negative');
      add(nets, split.memberId, -split.owedPaise);
    }
  }

  for (const settlement of settlements) {
    if (settlement.deletedAt) continue;
    assertPaise(settlement.amountPaise, 'amountPaise');
    if (settlement.amountPaise <= 0) throw new Error('amountPaise must be positive');
    add(nets, settlement.fromMemberId, settlement.amountPaise);
    add(nets, settlement.toMemberId, -settlement.amountPaise);
  }

  return nets;
}
