const MINUS = '−';

function assertPaise(paise: number): void {
  if (!Number.isSafeInteger(paise)) {
    throw new Error('paise must be an integer');
  }
}

/** Last three digits, then groups of two: 123456 → 1,23,456. */
export function groupIndian(rupees: number): string {
  if (!Number.isSafeInteger(rupees) || rupees < 0) {
    throw new Error('rupees must be a non-negative integer');
  }
  const digits = String(rupees);
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  const groups: string[] = [];
  for (let index = head.length; index > 0; index -= 2) {
    groups.unshift(head.slice(Math.max(0, index - 2), index));
  }
  return `${groups.join(',')},${tail}`;
}

function formatAbs(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const remainder = paise % 100;
  const grouped = groupIndian(rupees);
  if (remainder === 0) return grouped;
  return `${grouped}.${String(remainder).padStart(2, '0')}`;
}

/** ₹ with Indian grouping. Two decimals only when paise remain. */
export function formatINR(paise: number): string {
  assertPaise(paise);
  const body = formatAbs(Math.abs(paise));
  return paise < 0 ? `${MINUS}₹${body}` : `₹${body}`;
}

/** Balances: +₹ when owed to you, −₹ when you owe. */
export function formatSignedINR(paise: number): string {
  assertPaise(paise);
  if (paise > 0) return `+₹${formatAbs(paise)}`;
  if (paise < 0) return `${MINUS}₹${formatAbs(-paise)}`;
  return '₹0';
}

/**
 * Parse a typed rupee amount into integer paise.
 * Accepts "2,500", "2500", "49.75", and an optional ₹ prefix.
 */
export function parseINR(input: string): number {
  const cleaned = input
    .trim()
    .replace(/₹/g, '')
    .replace(/\s/g, '')
    .replace(/,/g, '')
    .replaceAll(MINUS, '-');

  const match = /^([+-])?(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) throw new Error('invalid amount');

  const sign = match[1] === '-' ? -1 : 1;
  const rupees = Number(match[2]);
  const fraction = match[3] ?? '';
  const fractionPaise = fraction.length === 0 ? 0 : Number(fraction.padEnd(2, '0'));
  const paise = rupees * 100 + fractionPaise;
  if (!Number.isSafeInteger(rupees) || !Number.isSafeInteger(paise)) {
    throw new Error('amount is too large');
  }
  return sign * paise;
}
