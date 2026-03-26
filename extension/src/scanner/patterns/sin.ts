import { Detection, PatternDefinition } from '../types';

/** Luhn checksum validation */
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

export const sinPattern: PatternDefinition = {
  type: 'sin',
  severity: 'high',
  explanationKey: 'sin',
  priority: 100,

  scan(text: string): Detection[] {
    const results: Detection[] = [];
    // Match 9-digit numbers with optional dashes or spaces
    const regex = /\b(\d{3})[-\s]?(\d{3})[-\s]?(\d{3})\b/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const digits = match[1] + match[2] + match[3];

      // All zeros is not a valid SIN
      if (digits === '000000000') continue;

      // Luhn validation
      if (!isValidLuhn(digits)) continue;

      results.push({
        type: 'sin',
        value: match[0],
        start: match.index,
        end: match.index + match[0].length,
        severity: 'high',
        layer: 'L1',
        confidence: 0.95,
        explanationKey: 'sin',
      });
    }

    return results;
  },
};
