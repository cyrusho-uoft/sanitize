import { describe, it, expect } from 'vitest';
import { utoridPattern } from '../src/scanner/patterns/utorid';

describe('UTORid Pattern', () => {
  it('detects UTORid near @utoronto.ca context', () => {
    const results = utoridPattern.scan('My UTORid smithj12 and email smithj12@utoronto.ca');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(r => r.value === 'smithj12')).toBe(true);
  });

  it('detects UTORid near "ACORN" context', () => {
    const results = utoridPattern.scan('Log into ACORN with your UTORid tanc45');
    expect(results).toHaveLength(1);
    expect(results[0].value).toBe('tanc45');
  });

  it('does NOT flag without institutional context', () => {
    const results = utoridPattern.scan('The variable name is abc123 in the code');
    expect(results).toHaveLength(0);
  });

  it('detects when context is within 200 chars', () => {
    const padding = 'x'.repeat(150);
    const text = `UTORid: smithj12 ${padding} utoronto`;
    const results = utoridPattern.scan(text);
    expect(results).toHaveLength(1);
  });

  it('does NOT flag when context is beyond 200 chars', () => {
    const padding = 'x'.repeat(250);
    const text = `smithj12 ${padding} utoronto`;
    const results = utoridPattern.scan(text);
    expect(results).toHaveLength(0);
  });

  it('detects UTORid near "Quercus" context', () => {
    const results = utoridPattern.scan('Submit on Quercus using account cheny78');
    expect(results).toHaveLength(1);
  });
});
