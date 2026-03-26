import { Detection, PatternDefinition } from '../types';

function isValidLuhn(digits: string): boolean {
  const nums = digits.split('').map(Number);
  let sum = 0;
  let alternate = false;
  for (let i = nums.length - 1; i >= 0; i--) {
    let n = nums[i];
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

export const creditCardPattern: PatternDefinition = {
  type: 'credit_card',
  severity: 'high',
  explanationKey: 'credit_card',
  priority: 80,

  scan(text: string): Detection[] {
    const results: Detection[] = [];
    // 13-19 digit numbers with optional dashes/spaces (common CC formats)
    const regex = /\b(\d{4})[-\s]?(\d{4})[-\s]?(\d{4})[-\s]?(\d{1,7})\b/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const digits = match[0].replace(/[-\s]/g, '');
      if (digits.length < 13 || digits.length > 19) continue;
      if (!isValidLuhn(digits)) continue;

      // Check common prefixes: Visa (4), MC (51-55, 2221-2720), Amex (34,37)
      const prefix = parseInt(digits.substring(0, 2));
      const prefix4 = parseInt(digits.substring(0, 4));
      const isKnownPrefix =
        digits[0] === '4' || // Visa
        (prefix >= 51 && prefix <= 55) || // Mastercard
        (prefix4 >= 2221 && prefix4 <= 2720) || // Mastercard (new)
        prefix === 34 || prefix === 37 || // Amex
        prefix === 36 || // Diners
        digits.substring(0, 4) === '6011' || // Discover
        prefix === 65; // Discover

      if (!isKnownPrefix) continue;

      results.push({
        type: 'credit_card',
        value: match[0],
        start: match.index,
        end: match.index + match[0].length,
        severity: 'high',
        layer: 'L1',
        confidence: 0.95,
        explanationKey: 'credit_card',
      });
    }

    return results;
  },
};
