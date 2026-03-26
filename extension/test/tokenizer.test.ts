import { describe, it, expect, beforeEach } from 'vitest';
import { tokenize, detokenize, clearMappings } from '../src/tokenizer';
import { Detection } from '../src/scanner/types';

// Mock sessionStorage for Node.js test environment
const store: Record<string, string> = {};
const mockSessionStorage = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
};
Object.defineProperty(globalThis, 'sessionStorage', { value: mockSessionStorage, writable: true });

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
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
  });

  it('tokenizes a single detection', () => {
    const text = 'My SIN is 046-454-286 ok';
    const detection = makeDetection({
      type: 'sin', value: '046-454-286', start: 10, end: 21,
    });
    const result = tokenize(text, [detection]);
    expect(result).toBe('My SIN is [SIN_REDACTED_1] ok');
  });

  it('tokenizes multiple detections of same type', () => {
    const text = 'Emails: a@b.com and c@d.com';
    const detections = [
      makeDetection({ value: 'a@b.com', start: 8, end: 15 }),
      makeDetection({ value: 'c@d.com', start: 20, end: 27 }),
    ];
    const result = tokenize(text, detections);
    expect(result).toContain('[EMAIL_1]');
    expect(result).toContain('[EMAIL_2]');
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
    expect(result).toContain('[PERSON_1]');
    expect(result).toContain('[SIN_REDACTED_1]');
    expect(result).toContain('[EMAIL_1]');
  });

  it('returns original text when no detections', () => {
    const text = 'Nothing sensitive here';
    expect(tokenize(text, [])).toBe(text);
  });

  it('detokenizes restores original values', () => {
    const text = 'SIN is 046-454-286';
    const detection = makeDetection({
      type: 'sin', value: '046-454-286', start: 7, end: 18,
    });
    tokenize(text, [detection]);

    const aiResponse = 'The [SIN_REDACTED_1] belongs to the patient';
    const { result, restored } = detokenize(aiResponse);
    expect(result).toBe('The 046-454-286 belongs to the patient');
    expect(restored).toBe(1);
  });

  it('detokenize returns 0 restored when no tokens match', () => {
    const { result, restored } = detokenize('No tokens here');
    expect(result).toBe('No tokens here');
    expect(restored).toBe(0);
  });

  it('detokenize handles expired session gracefully', () => {
    // Clear storage to simulate expired session
    clearMappings();
    const { result, restored } = detokenize('The [SIN_REDACTED_1] is gone');
    expect(result).toBe('The [SIN_REDACTED_1] is gone');
    expect(restored).toBe(0);
  });
});
