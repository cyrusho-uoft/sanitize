import { describe, it, expect } from 'vitest';
import { sinPattern } from '../src/scanner/patterns/sin';

describe('SIN Pattern', () => {
  it('detects valid SIN with dashes', () => {
    const results = sinPattern.scan('My SIN is 046-454-286');
    expect(results).toHaveLength(1);
    expect(results[0].value).toBe('046-454-286');
    expect(results[0].severity).toBe('high');
    expect(results[0].type).toBe('sin');
  });

  it('detects valid SIN without dashes', () => {
    const results = sinPattern.scan('SIN: 046454286');
    expect(results).toHaveLength(1);
    expect(results[0].value).toBe('046454286');
  });

  it('detects valid SIN with spaces', () => {
    const results = sinPattern.scan('Number is 046 454 286');
    expect(results).toHaveLength(1);
  });

  it('rejects all-zeros', () => {
    const results = sinPattern.scan('My number is 000-000-000');
    expect(results).toHaveLength(0);
  });

  it('rejects invalid Luhn checksum', () => {
    const results = sinPattern.scan('Fake SIN: 123-456-789');
    expect(results).toHaveLength(0);
  });

  it('rejects partial match (only 8 digits)', () => {
    const results = sinPattern.scan('Number: 12345678');
    expect(results).toHaveLength(0);
  });

  it('detects multiple SINs in same text', () => {
    const results = sinPattern.scan('SINs: 046-454-286 and 046 454 286');
    expect(results).toHaveLength(2);
  });

  it('does not match SIN embedded in longer number', () => {
    const results = sinPattern.scan('Account: 10464542861');
    // The regex uses \b boundaries so this should not match a 10+ digit number
    expect(results).toHaveLength(0);
  });
});
