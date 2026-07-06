import { describe, it, expect, beforeEach } from 'vitest';
import { tokenize, detokenize, clearMappings, getMappingCount } from '../src/tokenizer';
import { scanL1 } from '../src/scanner';
import { Detection } from '../src/scanner/types';

// No chrome.* in the test environment — mapping-store falls back to its
// in-context memory store, which is exactly what these tests exercise.
// The chrome.storage.session paths are covered in mapping-store.test.ts.

function makeDetection(overrides: Partial<Detection>): Detection {
  return {
    type: 'email',
    value: 'test@example.com',
    start: 0,
    end: 16,
    severity: 'medium',
    layer: 'L1',
    confidence: 0.9,
    explanationKey: 'email',
    ...overrides,
  };
}

describe('Tokenizer', () => {
  beforeEach(async () => {
    await clearMappings();
  });

  it('tokenizes a single detection', () => {
    const text = 'My SIN is 046-454-286 ok';
    const detection = makeDetection({
      type: 'sin', value: '046-454-286', start: 10, end: 21,
    });
    const result = tokenize(text, [detection]);
    // Placeholder carries a per-batch tag: [SIN_REDACTED_1~xxxx]
    expect(result).toMatch(/^My SIN is \[SIN_REDACTED_1~[A-Z]{4}\] ok$/);
  });

  it('tokenizes multiple detections of same type', () => {
    const text = 'Emails: a@b.com and c@d.com';
    const detections = [
      makeDetection({ value: 'a@b.com', start: 8, end: 15 }),
      makeDetection({ value: 'c@d.com', start: 20, end: 27 }),
    ];
    const result = tokenize(text, detections);
    expect(result).toContain('[EMAIL_1~');
    expect(result).toContain('[EMAIL_2~');
    expect(result).not.toContain('a@b.com');
    expect(result).not.toContain('c@d.com');
  });

  it('tokenizes mixed types', () => {
    const text = 'Name: John, SIN: 046-454-286, email: john@uoft.ca';
    const detections = [
      makeDetection({ type: 'person_name', value: 'John', start: 6, end: 10 }),
      makeDetection({ type: 'sin', value: '046-454-286', start: 17, end: 28 }),
      makeDetection({ value: 'john@uoft.ca', start: 37, end: 49 }),
    ];
    const result = tokenize(text, detections);
    expect(result).toContain('[PERSON_1~');
    expect(result).toContain('[SIN_REDACTED_1~');
    expect(result).toContain('[EMAIL_1~');
  });

  it('detections in one batch share a single tag', () => {
    const text = 'Emails: a@b.com and c@d.com';
    const detections = [
      makeDetection({ value: 'a@b.com', start: 8, end: 15 }),
      makeDetection({ value: 'c@d.com', start: 20, end: 27 }),
    ];
    const result = tokenize(text, detections);
    const tags = [...result.matchAll(/~([A-Z]{4})\]/g)].map(m => m[1]);
    expect(tags).toHaveLength(2);
    expect(tags[0]).toBe(tags[1]);
  });

  it('returns original text when no detections', () => {
    const text = 'Nothing sensitive here';
    expect(tokenize(text, [])).toBe(text);
  });

  it('detokenizes restores original values', async () => {
    const text = 'SIN is 046-454-286';
    const detection = makeDetection({
      type: 'sin', value: '046-454-286', start: 7, end: 18,
    });
    const sanitized = tokenize(text, [detection]);
    const placeholder = sanitized.match(/\[SIN_REDACTED_1~[A-Z]{4}\]/)![0];

    const aiResponse = `The ${placeholder} belongs to the patient`;
    const { result, restored } = await detokenize(aiResponse);
    expect(result).toBe('The 046-454-286 belongs to the patient');
    expect(restored).toBe(1);
  });

  it('detokenize returns 0 restored when no tokens match', async () => {
    const { result, restored } = await detokenize('No tokens here');
    expect(result).toBe('No tokens here');
    expect(restored).toBe(0);
  });

  it('detokenize handles cleared mappings gracefully', async () => {
    const sanitized = tokenize('SIN is 046-454-286', [makeDetection({
      type: 'sin', value: '046-454-286', start: 7, end: 18,
    })]);
    const placeholder = sanitized.match(/\[SIN_REDACTED_1~[A-Z]{4}\]/)![0];
    await clearMappings();
    const { result, restored } = await detokenize(`The ${placeholder} is gone`);
    expect(result).toBe(`The ${placeholder} is gone`);
    expect(restored).toBe(0);
  });

  it('counts mappings across tokenize calls', async () => {
    tokenize('a@b.com', [makeDetection({ value: 'a@b.com', start: 0, end: 7 })]);
    tokenize('c@d.com', [makeDetection({ value: 'c@d.com', start: 0, end: 7 })]);
    expect(await getMappingCount()).toBe(2);
  });

  it('re-scanning sanitized text never re-detects placeholders as PII', () => {
    // Regression: a lowercase batch tag matched the UTORid pattern
    // ([a-z]{2,8}\d{1,4}) and the placeholder label itself supplied the
    // institutional context, so sanitized text got re-tokenized into
    // nested, unrestorable placeholders. Tags are uppercase-only now.
    const text = 'My UTORid is jsmith42 and my email is js@mail.utoronto.ca';
    const detections = scanL1(text);
    expect(detections.length).toBeGreaterThan(0);
    const sanitized = tokenize(text, detections);
    expect(scanL1(sanitized)).toEqual([]);
  });

  it('independent batches never collide — both restore their own original', async () => {
    // Two separate tokenize calls each mint an EMAIL_1 placeholder, but the
    // per-batch tag keeps them distinct across tabs/conversations.
    const s1 = tokenize('a@b.com', [makeDetection({ value: 'a@b.com', start: 0, end: 7 })]);
    const s2 = tokenize('c@d.com', [makeDetection({ value: 'c@d.com', start: 0, end: 7 })]);
    expect(s1).not.toBe(s2);

    const { result, restored } = await detokenize(`First: ${s1}, second: ${s2}`);
    expect(restored).toBe(2);
    expect(result).toBe('First: a@b.com, second: c@d.com');
  });
});
