import { Detection, PatternDefinition } from '../types';

export const healthCardPattern: PatternDefinition = {
  type: 'health_card',
  severity: 'high',
  explanationKey: 'health_card',
  priority: 90,

  scan(text: string): Detection[] {
    const results: Detection[] = [];
    // Ontario Health Card: 4-3-3 digits followed by 2 uppercase letters (version code)
    const regex = /\b(\d{4})[-\s]?(\d{3})[-\s]?(\d{3})[-\s]?([A-Z]{2})\b/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      results.push({
        type: 'health_card',
        value: match[0],
        start: match.index,
        end: match.index + match[0].length,
        severity: 'high',
        layer: 'L1',
        confidence: 0.95,
        explanationKey: 'health_card',
      });
    }

    return results;
  },
};
