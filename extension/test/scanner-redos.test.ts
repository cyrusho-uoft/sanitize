import { describe, it, expect } from 'vitest';
import { scanL1 } from '../src/scanner';
import { emailPattern } from '../src/scanner/patterns/email';

/**
 * ReDoS regression guard.
 *
 * scanL1 runs synchronously inside paste/copy handlers, so a regex with
 * super-linear backtracking freezes the tab. These inputs are constructed
 * attacks against the pattern shapes we ship; the time bound is generous for
 * CI noise but far below what any quadratic pattern would need (the old
 * email regex took tens of seconds on the first input).
 */
const TIME_BUDGET_MS = 2000;

function timed(fn: () => void): number {
  const started = Date.now();
  fn();
  return Date.now() - started;
}

describe('L1 ReDoS resistance', () => {
  it('survives the dotted-domain attack that broke the old email regex', () => {
    // 400KB: the fixed regex takes ~85ms; the old quadratic one needed ~170s,
    // so even a partially-regressed pattern cannot slip under the budget.
    const attack = 'a@' + 'a.'.repeat(200_000) + '!';
    const elapsed = timed(() => scanL1(attack));
    expect(elapsed).toBeLessThan(TIME_BUDGET_MS);
  });

  it('survives a high-match-count flood (mergeDetections complexity guard)', () => {
    // ~40k detections from a 640KB repetitive paste — the old findIndex-from-0
    // merge took 2.4s here; the frontier merge stays in single-digit ms.
    const attack = '1234 567 890 AB '.repeat(40_000);
    const elapsed = timed(() => scanL1(attack));
    expect(elapsed).toBeLessThan(TIME_BUDGET_MS);
  });

  it('survives a long unterminated local part', () => {
    const attack = 'a'.repeat(100_000) + '@';
    const elapsed = timed(() => scanL1(attack));
    expect(elapsed).toBeLessThan(TIME_BUDGET_MS);
  });

  it('survives long digit runs (SIN / card / phone stress)', () => {
    const attack = '1'.repeat(200_000);
    const elapsed = timed(() => scanL1(attack));
    expect(elapsed).toBeLessThan(TIME_BUDGET_MS);
  });

  it('survives a long @mention and profile-URL tail', () => {
    const attack = '@' + 'a'.repeat(100_000) + ' https://github.com/' + 'b'.repeat(100_000);
    const elapsed = timed(() => scanL1(attack));
    expect(elapsed).toBeLessThan(TIME_BUDGET_MS);
  });

  it('survives half a megabyte of mixed junk', () => {
    const attack = ('a.b-c_d@e ' + '416555' + '@@..--  ').repeat(25_000);
    const elapsed = timed(() => scanL1(attack));
    expect(elapsed).toBeLessThan(TIME_BUDGET_MS);
  });
});

describe('email pattern correctness after hardening', () => {
  const emailsIn = (text: string) => emailPattern.scan(text).map(d => d.value);

  it('still detects ordinary and U of T emails', () => {
    expect(emailsIn('mail me at jane.doe@gmail.com please')).toEqual(['jane.doe@gmail.com']);
    expect(emailsIn('u of t: john@mail.utoronto.ca')).toEqual(['john@mail.utoronto.ca']);
    expect(emailPattern.scan('john@mail.utoronto.ca')[0].severity).toBe('high');
  });

  it('still detects plus-tags and multi-label subdomains', () => {
    expect(emailsIn('a+tag@sub.dept.example.co.uk!')).toEqual(['a+tag@sub.dept.example.co.uk']);
  });

  it('ignores strings without a TLD', () => {
    expect(emailsIn('not-an-email a@b c@d.')).toEqual([]);
  });

  it('bounds the local part at 64 characters (RFC limit)', () => {
    const local64 = 'x'.repeat(64);
    expect(emailsIn(`${local64}@example.com`)).toEqual([`${local64}@example.com`]);
  });

  it('still covers over-long local parts in full (fails closed, not open)', () => {
    // 65+ chars exceeds the RFC bound, but a PII guard must not silently
    // let the whole address through — the match start expands backwards.
    const local80 = 'y'.repeat(80);
    expect(emailsIn(`send to ${local80}@example.com now`)).toEqual([`${local80}@example.com`]);
  });

  it('detects deep multi-label domains in full', () => {
    expect(emailsIn('user@a.b.c.d.e.f.g.h.i.com')).toEqual(['user@a.b.c.d.e.f.g.h.i.com']);
    expect(emailsIn('user@w1.w2.w3.w4.w5.w6.w7.w8.example.com')).toEqual([
      'user@w1.w2.w3.w4.w5.w6.w7.w8.example.com',
    ]);
  });
});
