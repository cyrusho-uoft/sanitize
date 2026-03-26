import { Detection, PatternDefinition } from '../types';

export const phonePattern: PatternDefinition = {
  type: 'phone',
  severity: 'medium',
  explanationKey: 'phone',
  priority: 30,

  scan(text: string): Detection[] {
    const results: Detection[] = [];
    // North American phone formats: (416) 555-1234, 416-555-1234, +1 416 555 1234, 4165551234
    const regex = /(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      // Skip if it looks like it's part of a longer number (SIN, student number, etc.)
      const before = text[match.index - 1];
      if (before && /\d/.test(before)) continue;

      results.push({
        type: 'phone',
        value: match[0],
        start: match.index,
        end: match.index + match[0].length,
        severity: 'medium',
        layer: 'L1',
        confidence: 0.85,
        explanationKey: 'phone',
      });
    }

    return results;
  },
};
