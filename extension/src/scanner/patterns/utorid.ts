import { Detection, PatternDefinition } from '../types';

const CONTEXT_WINDOW = 200;
const CONTEXT_SIGNALS = [
  'utoronto', '@utoronto.ca', '@mail.utoronto.ca',
  'acorn', 'quercus', 'utorid', 'utor',
  'u of t', 'uoft', 'university of toronto',
];

function hasInstitutionalContext(text: string, matchStart: number, matchEnd: number): boolean {
  const windowStart = Math.max(0, matchStart - CONTEXT_WINDOW);
  const windowEnd = Math.min(text.length, matchEnd + CONTEXT_WINDOW);
  const surrounding = text.slice(windowStart, windowEnd).toLowerCase();

  return CONTEXT_SIGNALS.some(signal => surrounding.includes(signal));
}

export const utoridPattern: PatternDefinition = {
  type: 'utorid',
  severity: 'medium',
  explanationKey: 'utorid',
  priority: 50,

  scan(text: string): Detection[] {
    const results: Detection[] = [];
    // UTORid format: 2-8 lowercase letters followed by 1-4 digits
    const regex = /\b([a-z]{2,8}\d{1,4})\b/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      // Only flag if institutional context is nearby
      if (!hasInstitutionalContext(text, match.index, match.index + match[0].length)) {
        continue;
      }

      results.push({
        type: 'utorid',
        value: match[0],
        start: match.index,
        end: match.index + match[0].length,
        severity: 'medium',
        layer: 'L1',
        confidence: 0.80,
        explanationKey: 'utorid',
      });
    }

    return results;
  },
};
