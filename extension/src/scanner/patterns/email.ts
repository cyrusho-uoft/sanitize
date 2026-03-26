import { Detection, PatternDefinition } from '../types';

const UOFT_DOMAINS = [
  'utoronto.ca',
  'mail.utoronto.ca',
  'cs.toronto.edu',
  'ece.utoronto.ca',
  'utsc.utoronto.ca',
  'utm.utoronto.ca',
];

export const emailPattern: PatternDefinition = {
  type: 'email',
  severity: 'medium',
  explanationKey: 'email',
  priority: 40,

  scan(text: string): Detection[] {
    const results: Detection[] = [];
    const regex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const domain = match[0].split('@')[1].toLowerCase();
      const isUofT = UOFT_DOMAINS.some(d => domain === d || domain.endsWith('.' + d));

      results.push({
        type: 'email',
        value: match[0],
        start: match.index,
        end: match.index + match[0].length,
        severity: isUofT ? 'high' : 'medium',
        layer: 'L1',
        confidence: 0.99,
        explanationKey: isUofT ? 'email_uoft' : 'email',
      });
    }

    return results;
  },
};
