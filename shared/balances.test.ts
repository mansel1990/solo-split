import { describe, expect, it } from 'vitest';
import { computeBalances } from './balances';
import { coorgExpenses, coorgMembers, coorgNets } from './fixtures/coorgTrip';

describe('computeBalances', () => {
  it('matches the Coorg trip nets', () => {
    expect(computeBalances(coorgExpenses, [])).toEqual(coorgNets);
  });

  it('keeps the nets of a group at zero', () => {
    const nets = computeBalances(coorgExpenses, []);
    const sum = Object.values(nets).reduce((total, net) => total + net, 0);
    expect(sum).toBe(0);
  });

  it('treats the settlement payer as fromMember', () => {
    const nets = computeBalances(coorgExpenses, [
      {
        fromMemberId: coorgMembers.vijay,
        toMemberId: coorgMembers.sanjay,
        amountPaise: 650_000,
      },
    ]);
    expect(nets.vijay).toBe(0);
    expect(nets.sanjay).toBe(350_000);
  });

  it('ignores soft-deleted expenses and settlements', () => {
    expect(computeBalances(
      [{ ...coorgExpenses[0], deletedAt: '2026-09-23T00:00:00.000Z' }],
      [{
        fromMemberId: coorgMembers.vijay,
        toMemberId: coorgMembers.sanjay,
        amountPaise: 100,
        deletedAt: '2026-09-23T00:00:00.000Z',
      }],
    )).toEqual({});
  });
});
