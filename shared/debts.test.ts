import { describe, expect, it } from 'vitest';
import { computeBalances } from './balances';
import { simplifyDebts, throughMe } from './debts';
import {
  coorgExpenses,
  coorgMembers,
  coorgTransfers,
} from './fixtures/coorgTrip';

describe('simplifyDebts', () => {
  it('settles the Coorg trip the way the PRD describes', () => {
    const nets = computeBalances(coorgExpenses, []);
    expect(simplifyDebts(nets)).toEqual(coorgTransfers);
  });

  it('breaks equal amounts by member id', () => {
    expect(simplifyDebts({ b: -100, a: -100, c: 200 })).toEqual([
      { fromMemberId: 'a', toMemberId: 'c', amountPaise: 100 },
      { fromMemberId: 'b', toMemberId: 'c', amountPaise: 100 },
    ]);
  });

  it('returns nothing when everyone is already square', () => {
    expect(simplifyDebts({ a: 0, b: 0 })).toEqual([]);
  });

  it('rejects nets that do not sum to zero', () => {
    expect(() => simplifyDebts({ a: 100 })).toThrow(/sum to 0/);
  });
});

describe('throughMe', () => {
  it('routes every other debtor to me and me to every other creditor', () => {
    const nets = computeBalances(coorgExpenses, []);
    expect(throughMe(nets, coorgMembers.sanjay)).toEqual([
      { fromMemberId: coorgMembers.vijay, toMemberId: coorgMembers.sanjay, amountPaise: 650_000 },
      { fromMemberId: coorgMembers.ravi, toMemberId: coorgMembers.sanjay, amountPaise: 400_000 },
      { fromMemberId: coorgMembers.karthik, toMemberId: coorgMembers.sanjay, amountPaise: 350_000 },
      { fromMemberId: coorgMembers.sanjay, toMemberId: coorgMembers.arun, amountPaise: 400_000 },
    ]);
  });

  it('has me pay creditors when I am the debtor', () => {
    expect(throughMe({ me: -500, a: 500 }, 'me')).toEqual([
      { fromMemberId: 'me', toMemberId: 'a', amountPaise: 500 },
    ]);
  });
});
