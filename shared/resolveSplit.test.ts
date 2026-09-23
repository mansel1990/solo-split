import { describe, expect, it } from 'vitest';
import { resolveSplit } from './resolveSplit';

function owed(amountPaise: number, type: 'per_head' | 'per_party' | 'shares' | 'exact', parties: Parameters<typeof resolveSplit>[2]) {
  return resolveSplit(amountPaise, type, parties).map((share) => share.owedPaise);
}

describe('resolveSplit', () => {
  it('splits ₹100 three ways into whole rupees, extra rupee to the first party', () => {
    expect(owed(10000, 'per_party', [
      { memberId: 'a' },
      { memberId: 'b' },
      { memberId: 'c' },
    ])).toEqual([3400, 3300, 3300]);
  });

  it('splits ₹100 by weights 2.5, 1, 1 into whole rupees', () => {
    expect(owed(10000, 'per_head', [
      { memberId: 'family', weight: 2.5 },
      { memberId: 'a', weight: 1 },
      { memberId: 'b', weight: 1 },
    ])).toEqual([5600, 2200, 2200]);
  });

  it('keeps paise when the amount itself has paise', () => {
    expect(owed(9950, 'per_party', [
      { memberId: 'a' },
      { memberId: 'b' },
    ])).toEqual([4975, 4975]);
  });

  it('rounds a whole rupee in rupee units, so ₹1 split 3 ways is not 34 paise', () => {
    expect(owed(100, 'per_party', [
      { memberId: 'a' },
      { memberId: 'b' },
      { memberId: 'c' },
    ])).toEqual([100, 0, 0]);
  });

  it('uses the paise path for an amount that is not a whole rupee', () => {
    expect(owed(1001, 'per_party', [
      { memberId: 'a' },
      { memberId: 'b' },
      { memberId: 'c' },
    ])).toEqual([334, 334, 333]);
  });

  it('treats shares like weights, including percentages', () => {
    expect(owed(10000, 'shares', [
      { memberId: 'a', weight: 50 },
      { memberId: 'b', weight: 50 },
    ])).toEqual([5000, 5000]);
  });

  it('ignores headcount for per_party', () => {
    const shares = resolveSplit(9000, 'per_party', [
      { memberId: 'family', weight: 2 },
      { memberId: 'a', weight: 1 },
    ]);
    expect(shares.map((share) => share.owedPaise)).toEqual([4500, 4500]);
    expect(shares.map((share) => share.weight)).toEqual([1, 1]);
  });

  it('accepts an exact split that sums to the amount', () => {
    const shares = resolveSplit(10000, 'exact', [
      { memberId: 'a', owedPaise: 4000 },
      { memberId: 'b', owedPaise: 6000 },
    ]);
    expect(shares).toEqual([
      { memberId: 'a', weight: null, owedPaise: 4000 },
      { memberId: 'b', weight: null, owedPaise: 6000 },
    ]);
  });

  it('rejects an exact split that does not sum to the amount', () => {
    expect(() => resolveSplit(10000, 'exact', [
      { memberId: 'a', owedPaise: 4000 },
      { memberId: 'b', owedPaise: 5000 },
    ])).toThrow(/expected 10000/);
  });

  it('rejects an empty party list, a bad amount, and a duplicate party', () => {
    expect(() => resolveSplit(100, 'per_party', [])).toThrow(/at least one/);
    expect(() => resolveSplit(1.5, 'per_party', [{ memberId: 'a' }])).toThrow(/positive integer/);
    expect(() => resolveSplit(100, 'per_party', [
      { memberId: 'a' },
      { memberId: 'a' },
    ])).toThrow(/duplicate/);
  });
});
