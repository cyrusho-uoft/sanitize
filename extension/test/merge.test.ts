import { describe, it, expect } from 'vitest';
import { mergeDetections } from '../src/scanner/merge';
import { Detection } from '../src/scanner/types';

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

describe('mergeDetections', () => {
  it('returns union when no overlaps', () => {
    const a = makeDetection({ start: 0, end: 10 });
    const b = makeDetection({ start: 20, end: 30 });
    const result = mergeDetections([a], [b]);
    expect(result).toHaveLength(2);
  });

  it('keeps higher-priority type on exact overlap', () => {
    const sin = makeDetection({ type: 'sin', start: 0, end: 9, severity: 'high', confidence: 0.9 });
    const phone = makeDetection({ type: 'phone', start: 0, end: 9, severity: 'medium', confidence: 0.85 });
    const result = mergeDetections([sin], [phone]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('sin'); // SIN has higher priority than phone
  });

  it('keeps higher confidence when same type overlaps', () => {
    const a = makeDetection({ type: 'email', start: 0, end: 20, confidence: 0.95 });
    const b = makeDetection({ type: 'email', start: 0, end: 20, confidence: 0.80 });
    const result = mergeDetections([a], [b]);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(0.95);
  });

  it('prefers L1 over L2 when same type and confidence', () => {
    const l1 = makeDetection({ layer: 'L1', confidence: 0.9 });
    const l2 = makeDetection({ layer: 'L2', confidence: 0.9 });
    const result = mergeDetections([l1], [l2]);
    expect(result).toHaveLength(1);
    expect(result[0].layer).toBe('L1');
  });

  it('handles partial overlap — higher priority wins', () => {
    const sin = makeDetection({ type: 'sin', start: 5, end: 14 });
    const phone = makeDetection({ type: 'phone', start: 0, end: 10 });
    const result = mergeDetections([sin], [phone]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('sin');
  });

  it('handles nested span — outer L2 vs inner L1', () => {
    const l2Outer = makeDetection({ type: 'phone', start: 0, end: 20, layer: 'L2' });
    const l1Inner = makeDetection({ type: 'sin', start: 5, end: 14, layer: 'L1' });
    const result = mergeDetections([l2Outer], [l1Inner]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('sin'); // SIN has higher type priority
  });

  it('returns empty for empty inputs', () => {
    expect(mergeDetections([], [])).toHaveLength(0);
  });

  it('returns L1-only results when L2 found nothing', () => {
    const a = makeDetection({ start: 0, end: 10 });
    const result = mergeDetections([a], []);
    expect(result).toHaveLength(1);
  });

  it('results are sorted by position', () => {
    const a = makeDetection({ start: 30, end: 40 });
    const b = makeDetection({ start: 0, end: 10 });
    const c = makeDetection({ start: 15, end: 25 });
    const result = mergeDetections([a, b, c]);
    expect(result[0].start).toBe(0);
    expect(result[1].start).toBe(15);
    expect(result[2].start).toBe(30);
  });
});
