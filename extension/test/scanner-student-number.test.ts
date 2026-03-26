import { describe, it, expect } from 'vitest';
import { studentNumberPattern } from '../src/scanner/patterns/student-number';

describe('Student Number Pattern', () => {
  it('detects valid U of T student number', () => {
    const results = studentNumberPattern.scan('Student #1009234567');
    expect(results).toHaveLength(1);
    expect(results[0].value).toBe('1009234567');
    expect(results[0].severity).toBe('high');
  });

  it('rejects number with wrong prefix', () => {
    const results = studentNumberPattern.scan('ID: 2009234567');
    expect(results).toHaveLength(0);
  });

  it('rejects too-short number', () => {
    const results = studentNumberPattern.scan('ID: 10092345');
    expect(results).toHaveLength(0);
  });

  it('rejects too-long number', () => {
    const results = studentNumberPattern.scan('ID: 10092345678');
    expect(results).toHaveLength(0);
  });

  it('detects student number in context', () => {
    const results = studentNumberPattern.scan(
      'Please review the case for student 1009234567 in the CS department'
    );
    expect(results).toHaveLength(1);
    expect(results[0].start).toBe(35);
  });
});
