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
    // ReDoS-hardened: the old domain part ([A-Za-z0-9.-]+\.) put '.' inside a
    // quantified class followed by a literal '\.', giving O(n^2) backtracking
    // on inputs like "a@" + "a.".repeat(50k). The load-bearing fix is that
    // labels now EXCLUDE '.', so every parse is unambiguous; quantifier
    // bounds (label<=63 per RFC 1035, <=126 labels, TLD<=24) cap the residual
    // backtracking. No leading \b: with one, a 65+-char local part would be a
    // silent complete miss (no interior \b to re-anchor from) — instead the
    // regex matches a 64-char tail and the code below expands the start
    // backwards to cover the full address.
    const regex = /[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9-]{1,63}\.){1,126}[A-Za-z]{2,24}\b/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const domain = match[0].split('@')[1].toLowerCase();
      const isUofT = UOFT_DOMAINS.some(d => domain === d || domain.endsWith('.' + d));

      // Cover over-long local parts in full (the regex anchors at most 64
      // chars before the '@'; anything earlier is still part of the address).
      let start = match.index;
      while (start > 0 && /[A-Za-z0-9._%+-]/.test(text[start - 1])) start--;
      const end = match.index + match[0].length;

      results.push({
        type: 'email',
        value: text.slice(start, end),
        start,
        end,
        severity: isUofT ? 'high' : 'medium',
        layer: 'L1',
        confidence: 0.99,
        explanationKey: isUofT ? 'email_uoft' : 'email',
      });
    }

    return results;
  },
};
