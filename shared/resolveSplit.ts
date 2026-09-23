import type { ResolvedShare, SplitParty, SplitType } from './types';

function assertAmount(amountPaise: number): void {
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
    throw new Error('amountPaise must be a positive integer');
  }
}

function weightHundredths(weight: number): number {
  if (!Number.isFinite(weight) || weight <= 0) {
    throw new Error('weight must be a positive number');
  }
  const scaled = weight * 100;
  const hundredths = Math.round(scaled);
  if (Math.abs(scaled - hundredths) > 1e-6 || hundredths <= 0) {
    throw new Error('weight supports at most 2 decimal places');
  }
  return hundredths;
}

function assertParties(parties: SplitParty[]): void {
  if (parties.length === 0) {
    throw new Error('a split needs at least one party');
  }
  const seen = new Set<string>();
  for (const party of parties) {
    if (!party.memberId) throw new Error('party is missing memberId');
    if (seen.has(party.memberId)) {
      throw new Error(`duplicate party ${party.memberId}`);
    }
    seen.add(party.memberId);
  }
}

/**
 * Largest-remainder (Hamilton) allocation in integer units.
 * Equal fractional parts go to the earlier party.
 */
function largestRemainder(amountUnits: number, weights: number[]): number[] {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) throw new Error('weights must sum to a positive number');

  const floors = new Array<number>(weights.length);
  const remainders = new Array<number>(weights.length);
  let floorSum = 0;

  for (let index = 0; index < weights.length; index++) {
    const product = amountUnits * weights[index];
    if (!Number.isSafeInteger(product)) {
      throw new Error('amount is too large to split exactly');
    }
    const share = Math.floor(product / totalWeight);
    floors[index] = share;
    remainders[index] = product % totalWeight;
    floorSum += share;
  }

  let leftover = amountUnits - floorSum;
  if (leftover < 0 || leftover > weights.length) {
    throw new Error('split rounding failed');
  }

  const order = weights.map((_, index) => index);
  order.sort((a, b) => remainders[b] - remainders[a] || a - b);
  for (let index = 0; index < leftover; index++) {
    floors[order[index]] += 1;
  }
  return floors;
}

function resolveExact(amountPaise: number, parties: SplitParty[]): ResolvedShare[] {
  let sum = 0;
  const resolved = parties.map((party) => {
    if (party.owedPaise === undefined || !Number.isSafeInteger(party.owedPaise) || party.owedPaise < 0) {
      throw new Error('exact splits need a non-negative integer owedPaise');
    }
    sum += party.owedPaise;
    return { memberId: party.memberId, weight: null, owedPaise: party.owedPaise };
  });
  if (sum !== amountPaise) {
    throw new Error(`exact splits sum to ${sum}, expected ${amountPaise}`);
  }
  return resolved;
}

/**
 * Split an expense into integer paise that sum exactly to amountPaise.
 * A whole-rupee amount is rounded in 100-paise units so each share is a
 * whole number of rupees. Amounts that already contain paise stay on the
 * paise path.
 */
export function resolveSplit(
  amountPaise: number,
  type: SplitType,
  parties: SplitParty[],
): ResolvedShare[] {
  assertAmount(amountPaise);
  assertParties(parties);

  if (type === 'exact') return resolveExact(amountPaise, parties);
  if (type !== 'per_head' && type !== 'per_party' && type !== 'shares') {
    throw new Error(`unknown split type ${type}`);
  }

  const weights = parties.map((party) => {
    if (type === 'per_party') return 100;
    if (party.weight === undefined) throw new Error('weight is required');
    return weightHundredths(party.weight);
  });

  const wholeRupees = amountPaise % 100 === 0;
  const owed = wholeRupees
    ? largestRemainder(amountPaise / 100, weights).map((rupees) => rupees * 100)
    : largestRemainder(amountPaise, weights);

  return parties.map((party, index) => ({
    memberId: party.memberId,
    weight: type === 'per_party' ? 1 : party.weight ?? null,
    owedPaise: owed[index],
  }));
}
