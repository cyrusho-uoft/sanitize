import { describe, it, expect } from 'vitest';
import { healthCardPattern } from '../src/scanner/patterns/health-card';

describe('Health Card Pattern', () => {
  it('detects valid Ontario health card with dashes', () => {
    const results = healthCardPattern.scan('OHIP: 1234-567-890-AB');
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe('high');
  });

  it('detects health card with spaces', () => {
    const results = healthCardPattern.scan('Card: 1234 567 890 AB');
    expect(results).toHaveLength(1);
  });

  it('detects health card without separators', () => {
    const results = healthCardPattern.scan('Number: 1234567890AB');
    expect(results).toHaveLength(1);
  });

  it('rejects without version code letters', () => {
    const results = healthCardPattern.scan('Number: 1234567890');
    expect(results).toHaveLength(0);
  });

  it('rejects with lowercase version code', () => {
    const results = healthCardPattern.scan('Number: 1234567890ab');
    expect(results).toHaveLength(0);
  });

  it('rejects with only one letter', () => {
    const results = healthCardPattern.scan('Number: 1234567890A');
    expect(results).toHaveLength(0);
  });
});
