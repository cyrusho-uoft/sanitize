import { Detection, PatternDefinition } from '../types';

const PLATFORM_URL_PATTERNS = [
  /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_-]+)/g,
  /https?:\/\/(?:www\.)?linkedin\.com\/in\/([A-Za-z0-9_-]+)/g,
  /https?:\/\/(?:www\.)?twitter\.com\/([A-Za-z0-9_]+)/g,
  /https?:\/\/(?:www\.)?x\.com\/([A-Za-z0-9_]+)/g,
  /https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9_.]+)/g,
  /https?:\/\/(?:www\.)?facebook\.com\/([A-Za-z0-9_.]+)/g,
];

export const usernamePattern: PatternDefinition = {
  type: 'username',
  severity: 'medium',
  explanationKey: 'username',
  priority: 35,

  scan(text: string): Detection[] {
    const results: Detection[] = [];

    // Pattern 1: @mentions (e.g., @smithj12, @sarah.chen)
    const mentionRegex = /@([A-Za-z][A-Za-z0-9_.-]{1,38})\b/g;
    let match: RegExpExecArray | null;

    while ((match = mentionRegex.exec(text)) !== null) {
      // Skip email addresses — those are caught by the email pattern
      if (match.index > 0 && /[A-Za-z0-9._%+-]/.test(text[match.index - 1])) continue;

      results.push({
        type: 'username',
        value: match[0],
        start: match.index,
        end: match.index + match[0].length,
        severity: 'medium',
        layer: 'L1',
        confidence: 0.85,
        explanationKey: 'username',
      });
    }

    // Pattern 2: Profile URLs (github.com/user, linkedin.com/in/user, etc.)
    for (const urlPattern of PLATFORM_URL_PATTERNS) {
      // Reset lastIndex for each pattern since they have the global flag
      urlPattern.lastIndex = 0;
      while ((match = urlPattern.exec(text)) !== null) {
        results.push({
          type: 'username',
          value: match[0],
          start: match.index,
          end: match.index + match[0].length,
          severity: 'medium',
          layer: 'L1',
          confidence: 0.90,
          explanationKey: 'username_url',
        });
      }
    }

    return results;
  },
};
