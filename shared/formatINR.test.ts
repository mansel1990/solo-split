import { describe, expect, it } from 'vitest';
import { formatINR, formatSignedINR, parseINR } from './formatINR';

describe('formatINR', () => {
  it('groups whole rupees and hides paise', () => {
    expect(formatINR(250_000)).toBe('₹2,500');
    expect(formatINR(12_345_600)).toBe('₹1,23,456');
    expect(formatINR(0)).toBe('₹0');
    expect(formatINR(100_000_000_000)).toBe('₹1,00,00,00,000');
  });

  it('shows two decimals only when paise remain', () => {
    expect(formatINR(4975)).toBe('₹49.75');
    expect(formatINR(4970)).toBe('₹49.70');
  });

  it('signs a negative amount', () => {
    expect(formatINR(-650_000)).toBe('−₹6,500');
    expect(formatSignedINR(650_000)).toBe('+₹6,500');
    expect(formatSignedINR(-650_000)).toBe('−₹6,500');
    expect(formatSignedINR(0)).toBe('₹0');
  });
});

describe('parseINR', () => {
  it('parses grouped, plain, and paise amounts', () => {
    expect(parseINR('2,500')).toBe(250_000);
    expect(parseINR('2500')).toBe(250_000);
    expect(parseINR('49.75')).toBe(4975);
  });

  it('accepts a rupee sign, a sign, and one decimal place', () => {
    expect(parseINR('₹2,500')).toBe(250_000);
    expect(parseINR('+2500')).toBe(250_000);
    expect(parseINR('−49.75')).toBe(-4975);
    expect(parseINR('49.5')).toBe(4950);
  });

  it('round-trips formatted amounts', () => {
    for (const paise of [250_000, 12_345_600, 4975, 0]) {
      expect(parseINR(formatINR(paise))).toBe(paise);
    }
  });

  it('rejects amounts that are not rupees and paise', () => {
    expect(() => parseINR('')).toThrow(/invalid/);
    expect(() => parseINR('49.756')).toThrow(/invalid/);
    expect(() => parseINR('12.3.4')).toThrow(/invalid/);
  });
});
