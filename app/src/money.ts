export { computeBalances } from '../../shared/balances';
export { simplifyDebts, throughMe } from '../../shared/debts';
export { formatINR, formatSignedINR, parseINR } from '../../shared/formatINR';
export { resolveSplit } from '../../shared/resolveSplit';
export type { SplitType, Transfer } from '../../shared/types';

export function paiseToInput(paise: number): string {
  if (paise % 100 === 0) return String(paise / 100);
  return (paise / 100).toFixed(2);
}

export function memberLabel(name: string, isSelf: boolean): string {
  return isSelf ? `${name} (you)` : name;
}
