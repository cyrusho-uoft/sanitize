import { Detection, PatternDefinition } from '../types';

export const studentNumberPattern: PatternDefinition = {
  type: 'student_number',
  severity: 'high',
  explanationKey: 'student_number',
  priority: 70,

  scan(text: string): Detection[] {
    const results: Detection[] = [];
    // U of T student numbers: 10 digits starting with 100
    const regex = /\b(100\d{7})\b/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      results.push({
        type: 'student_number',
        value: match[0],
        start: match.index,
        end: match.index + match[0].length,
        severity: 'high',
        layer: 'L1',
        confidence: 0.97,
        explanationKey: 'student_number',
      });
    }

    return results;
  },
};
