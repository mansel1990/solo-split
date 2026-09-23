import type { Transfer } from './types';

function assertNets(nets: Record<string, number>): void {
  let sum = 0;
  for (const [memberId, net] of Object.entries(nets)) {
    if (!Number.isSafeInteger(net)) {
      throw new Error(`net for ${memberId} must be an integer number of paise`);
    }
    sum += net;
  }
  if (sum !== 0) throw new Error('nets must sum to 0');
}

function pick(
  remaining: Map<string, number>,
  direction: 'debtor' | 'creditor',
): string | null {
  let best: string | null = null;
  for (const [memberId, net] of remaining) {
    if (direction === 'debtor' ? net >= 0 : net <= 0) continue;
    if (best === null) {
      best = memberId;
      continue;
    }
    const bestNet = remaining.get(best)!;
    const moreExtreme = direction === 'debtor' ? net < bestNet : net > bestNet;
    if (moreExtreme || (net === bestNet && memberId < best)) best = memberId;
  }
  return best;
}

/** Greedy: largest debtor pays the largest creditor. Ties break by member id. */
export function simplifyDebts(nets: Record<string, number>): Transfer[] {
  assertNets(nets);
  const remaining = new Map<string, number>();
  for (const [memberId, net] of Object.entries(nets)) {
    if (net !== 0) remaining.set(memberId, net);
  }

  const transfers: Transfer[] = [];
  const limit = remaining.size;
  while (transfers.length < limit) {
    const debtorId = pick(remaining, 'debtor');
    const creditorId = pick(remaining, 'creditor');
    if (!debtorId || !creditorId) break;

    const amountPaise = Math.min(-remaining.get(debtorId)!, remaining.get(creditorId)!);
    transfers.push({ fromMemberId: debtorId, toMemberId: creditorId, amountPaise });

    const debtorLeft = remaining.get(debtorId)! + amountPaise;
    const creditorLeft = remaining.get(creditorId)! - amountPaise;
    if (debtorLeft === 0) remaining.delete(debtorId);
    else remaining.set(debtorId, debtorLeft);
    if (creditorLeft === 0) remaining.delete(creditorId);
    else remaining.set(creditorId, creditorLeft);
  }

  return transfers;
}

/**
 * Every other debtor pays self, and self pays every other creditor.
 */
export function throughMe(nets: Record<string, number>, selfId: string): Transfer[] {
  assertNets(nets);
  const transfers: Transfer[] = [];

  const debtors = Object.entries(nets)
    .filter(([memberId, net]) => memberId !== selfId && net < 0)
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  const creditors = Object.entries(nets)
    .filter(([memberId, net]) => memberId !== selfId && net > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  for (const [memberId, net] of debtors) {
    transfers.push({
      fromMemberId: memberId,
      toMemberId: selfId,
      amountPaise: -net,
    });
  }
  for (const [memberId, net] of creditors) {
    transfers.push({
      fromMemberId: selfId,
      toMemberId: memberId,
      amountPaise: net,
    });
  }
  return transfers;
}
