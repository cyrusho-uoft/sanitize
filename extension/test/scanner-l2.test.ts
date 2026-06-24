import { describe, it, expect, vi, afterEach } from 'vitest';
import { scanL2, normalizeL2Detection } from '../src/scanner/l2';
import { mergeDetections } from '../src/scanner/merge';
import type { Detection } from '../src/scanner/types';

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  const fn = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('normalizeL2Detection', () => {
  it('maps Presidio entity types to extension L1 type keys', () => {
    const d = normalizeL2Detection(
      { type: 'PERSON', value: 'Jane Doe', start: 0, end: 8, severity: 'high', layer: 'L2', confidence: 0.9, explanationKey: 'PERSON' },
      'Jane Doe',
    );
    expect(d).not.toBeNull();
    expect(d!.type).toBe('person_name');
    expect(d!.explanationKey).toBe('person_name');
    expect(d!.layer).toBe('L2');
  });

  it('maps EMAIL_ADDRESS to email and CA_SOCIAL_INSURANCE_NUMBER to sin', () => {
    expect(normalizeL2Detection(
      { type: 'EMAIL_ADDRESS', value: 'a@b.ca', start: 0, end: 6, severity: 'medium', layer: 'L2', confidence: 0.8, explanationKey: 'EMAIL_ADDRESS' },
      'a@b.ca',
    )!.type).toBe('email');

    expect(normalizeL2Detection(
      { type: 'CA_SOCIAL_INSURANCE_NUMBER', value: '046-454-286', start: 0, end: 11, severity: 'high', layer: 'L2', confidence: 0.95, explanationKey: 'CA_SOCIAL_INSURANCE_NUMBER' },
      '046-454-286',
    )!.type).toBe('sin');
  });

  it('trusts the locally-sliced substring, not the backend-supplied value', () => {
    const d = normalizeL2Detection(
      { type: 'PERSON', value: 'ATTACKER', start: 0, end: 8, severity: 'high', layer: 'L2', confidence: 0.9, explanationKey: 'PERSON' },
      'Jane Doe is here',
    );
    expect(d!.value).toBe('Jane Doe'); // not 'ATTACKER'
  });

  it('defaults an invalid severity to medium', () => {
    const d = normalizeL2Detection(
      { type: 'ORGANIZATION', value: 'UofT', start: 0, end: 4, severity: 'bogus', layer: 'L2', confidence: 0.5, explanationKey: 'ORGANIZATION' },
      'UofT',
    );
    expect(d!.severity).toBe('medium');
  });

  it('drops malformed spans (end <= start)', () => {
    expect(normalizeL2Detection(
      { type: 'PERSON', value: 'x', start: 5, end: 5, severity: 'high', layer: 'L2', confidence: 0.9, explanationKey: 'PERSON' },
      'xxxxx',
    )).toBeNull();
  });

  it('drops out-of-range spans (end > text length)', () => {
    expect(normalizeL2Detection(
      { type: 'sin', value: 'lie', start: 0, end: 999999, severity: 'high', layer: 'L2', confidence: 1, explanationKey: 'sin' },
      'hi',
    )).toBeNull();
  });

  it('drops negative or non-integer spans', () => {
    expect(normalizeL2Detection(
      { type: 'PERSON', value: 'x', start: -1, end: 4, severity: 'high', layer: 'L2', confidence: 1, explanationKey: 'PERSON' },
      'hello',
    )).toBeNull();
    expect(normalizeL2Detection(
      { type: 'PERSON', value: 'x', start: 0, end: 2.5, severity: 'high', layer: 'L2', confidence: 1, explanationKey: 'PERSON' },
      'hello',
    )).toBeNull();
  });
});

describe('scanL2', () => {
  // "Jane Doe lives in Toronto" — PERSON [0,8), LOCATION [18,25)
  const TEXT = 'Jane Doe lives in Toronto';

  it('returns mapped detections from the backend', async () => {
    const fetchMock = mockFetchOnce({
      detections: [
        { type: 'PERSON', value: 'Jane Doe', start: 0, end: 8, severity: 'high', layer: 'L2', confidence: 0.9, explanationKey: 'PERSON' },
        { type: 'LOCATION', value: 'Toronto', start: 18, end: 25, severity: 'medium', layer: 'L2', confidence: 0.6, explanationKey: 'LOCATION' },
      ],
      count: 2, language: 'en',
    });

    const out = await scanL2(TEXT, { url: 'http://localhost:8000' });
    expect(out.map(d => d.type)).toEqual(['person_name', 'location']);
    expect(out.map(d => d.value)).toEqual(['Jane Doe', 'Toronto']);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/v1/scan',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('strips a trailing slash from the configured URL', async () => {
    const fetchMock = mockFetchOnce({ detections: [] });
    await scanL2('some text', { url: 'http://localhost:8000/' });
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8000/api/v1/scan', expect.anything());
  });

  it('returns [] without calling fetch for empty/whitespace text', async () => {
    const fetchMock = mockFetchOnce({ detections: [{ type: 'PERSON' }] });
    expect(await scanL2('   ')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails open to [] on a non-2xx response', async () => {
    mockFetchOnce({ error: 'boom' }, false, 500);
    expect(await scanL2('Jane Doe')).toEqual([]);
  });

  it('fails open to [] on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await scanL2('Jane Doe')).toEqual([]);
  });

  it('fails open to [] on a malformed body', async () => {
    mockFetchOnce({ not: 'an array' });
    expect(await scanL2('Jane Doe')).toEqual([]);
  });

  it('drops a backend detection whose span is out of range', async () => {
    mockFetchOnce({
      detections: [
        { type: 'sin', value: 'evil', start: 0, end: 999999, severity: 'high', layer: 'L2', confidence: 1, explanationKey: 'sin' },
      ],
    });
    expect(await scanL2('short text')).toEqual([]);
  });
});

describe('L1 + L2 merge', () => {
  it('keeps non-overlapping L1 and L2 detections', () => {
    const l1: Detection[] = [
      { type: 'sin', value: '046-454-286', start: 0, end: 11, severity: 'high', layer: 'L1', confidence: 0.95, explanationKey: 'sin' },
    ];
    const l2: Detection[] = [
      { type: 'person_name', value: 'Jane Doe', start: 20, end: 28, severity: 'high', layer: 'L2', confidence: 0.9, explanationKey: 'person_name' },
    ];
    const merged = mergeDetections(l1, l2);
    expect(merged.map(d => d.type)).toEqual(['sin', 'person_name']);
  });

  it('prefers the L1 detection when an L2 span overlaps it', () => {
    const l1: Detection[] = [
      { type: 'email', value: 'a@utoronto.ca', start: 0, end: 13, severity: 'medium', layer: 'L1', confidence: 0.9, explanationKey: 'email' },
    ];
    const l2: Detection[] = [
      { type: 'email', value: 'a@utoronto.ca', start: 0, end: 13, severity: 'medium', layer: 'L2', confidence: 0.9, explanationKey: 'email' },
    ];
    const merged = mergeDetections(l1, l2);
    expect(merged).toHaveLength(1);
    expect(merged[0].layer).toBe('L1');
  });
});
