import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  persistMappings,
  loadAllMappings,
  clearAllMappings,
  countMappings,
  writeBatchDirect,
  loadBatchSummaries,
  recordRestoreEvent,
  getRestoreEventCount,
  MAPPING_KEY_PREFIX,
  PERSIST_MESSAGE_TYPE,
  MAX_BATCHES,
  TokenMapping,
  MappingBatch,
} from '../src/tokenizer/mapping-store';

function makeChromeMock() {
  const store: Record<string, unknown> = {};
  return {
    store,
    chrome: {
      storage: {
        session: {
          set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(store, items); }),
          get: vi.fn(async () => ({ ...store })),
          remove: vi.fn(async (keys: string[]) => { for (const k of keys) delete store[k]; }),
        },
      },
      runtime: {
        // Mirrors the service worker's acknowledged write: {ok: true} once landed.
        sendMessage: vi.fn(async () => ({ ok: true })),
      },
    },
  };
}

function mapping(placeholder: string, original: string): TokenMapping {
  return { placeholder, original, type: 'email' };
}

describe('mapping-store', () => {
  afterEach(async () => {
    await clearAllMappings(); // reset memory fallback between tests
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('trusted context (no window — service worker/test env)', () => {
    let mock: ReturnType<typeof makeChromeMock>;

    beforeEach(() => {
      mock = makeChromeMock();
      vi.stubGlobal('chrome', mock.chrome);
    });

    it('writes batches directly to chrome.storage.session', async () => {
      await persistMappings([mapping('[EMAIL_1]', 'a@b.com')]);
      expect(mock.chrome.storage.session.set).toHaveBeenCalledTimes(1);
      const keys = Object.keys(mock.store);
      expect(keys).toHaveLength(1);
      expect(keys[0].startsWith(MAPPING_KEY_PREFIX)).toBe(true);
    });

    it('does not write empty batches', async () => {
      await persistMappings([]);
      expect(mock.chrome.storage.session.set).not.toHaveBeenCalled();
    });

    it('loads mappings back, ignoring unrelated keys', async () => {
      await persistMappings([mapping('[EMAIL_1]', 'a@b.com')]);
      mock.store['unrelated_key'] = { some: 'thing' };
      const loaded = await loadAllMappings();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].original).toBe('a@b.com');
    });

    it('orders batches newest first', async () => {
      const now = vi.spyOn(Date, 'now');
      now.mockReturnValue(1000);
      await persistMappings([mapping('[EMAIL_1]', 'old@b.com')]);
      now.mockReturnValue(2000);
      await persistMappings([mapping('[EMAIL_1]', 'new@b.com')]);

      const loaded = await loadAllMappings();
      expect(loaded[0].original).toBe('new@b.com');
      expect(loaded[1].original).toBe('old@b.com');
    });

    it('tie-breaks same-ms batches by sequence, newest first', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(5000);
      await persistMappings([mapping('[EMAIL_1]', 'first@b.com')]);
      await persistMappings([mapping('[EMAIL_1]', 'second@b.com')]);

      const loaded = await loadAllMappings();
      expect(loaded[0].original).toBe('second@b.com');
    });

    it('clearAllMappings removes only mapping keys', async () => {
      await persistMappings([mapping('[EMAIL_1]', 'a@b.com')]);
      mock.store['unrelated_key'] = { keep: 'me' };
      await clearAllMappings();
      expect(await countMappings()).toBe(0);
      expect(mock.store['unrelated_key']).toEqual({ keep: 'me' });
    });

    it('counts mappings across batches', async () => {
      await persistMappings([mapping('[EMAIL_1]', 'a@b.com'), mapping('[EMAIL_2]', 'c@d.com')]);
      await persistMappings([mapping('[PHONE_1]', '416-555-0199')]);
      expect(await countMappings()).toBe(3);
    });

    it('stores batch provenance and reports it in summaries (never values)', async () => {
      const now = vi.spyOn(Date, 'now');
      now.mockReturnValue(1000);
      await persistMappings([mapping('[EMAIL_1]', 'a@b.com')], { source: 'paste', site: 'chatgpt.com' });
      now.mockReturnValue(2000);
      await persistMappings(
        [mapping('[PHONE_1]', '416-555-0199'), mapping('[EMAIL_1~ZZZZ]', 'c@d.com')],
        { source: 'popup' }
      );

      const summaries = await loadBatchSummaries();
      expect(summaries).toHaveLength(2);
      // newest first
      expect(summaries[0]).toMatchObject({ source: 'popup', count: 2 });
      expect(summaries[0].site).toBeUndefined();
      expect(summaries[1]).toMatchObject({ source: 'paste', site: 'chatgpt.com', count: 1 });
      // values never leak into summaries
      expect(JSON.stringify(summaries)).not.toContain('a@b.com');
    });

    it('summaries mark legacy batches without a source as unknown', async () => {
      await writeBatchDirect({ createdAt: 500, seq: 1, mappings: [mapping('[EMAIL_1]', 'a@b.com')] });
      const summaries = await loadBatchSummaries();
      expect(summaries[0].source).toBe('unknown');
    });

    it('tracks restore events for the session', async () => {
      expect(await getRestoreEventCount()).toBe(0);
      await recordRestoreEvent();
      await recordRestoreEvent();
      expect(await getRestoreEventCount()).toBe(2);
    });

    it('skips malformed batches in storage', async () => {
      mock.store[`${MAPPING_KEY_PREFIX}corrupt`] = { nope: true };
      await persistMappings([mapping('[EMAIL_1]', 'a@b.com')]);
      const loaded = await loadAllMappings();
      expect(loaded).toHaveLength(1);
    });

    it('evicts oldest batches beyond the retention cap', async () => {
      const now = vi.spyOn(Date, 'now');
      for (let i = 0; i < MAX_BATCHES + 5; i++) {
        now.mockReturnValue(1000 + i);
        await persistMappings([mapping(`[EMAIL_${i}]`, `u${i}@b.com`)]);
      }
      const keys = Object.keys(mock.store).filter(k => k.startsWith(MAPPING_KEY_PREFIX));
      expect(keys).toHaveLength(MAX_BATCHES);
      const loaded = await loadAllMappings();
      // Newest batch survives; the very first ones were evicted.
      expect(loaded.some(m => m.original === `u${MAX_BATCHES + 4}@b.com`)).toBe(true);
      expect(loaded.some(m => m.original === 'u0@b.com')).toBe(false);
    });

    it('retries after evicting half when the write is rejected (quota)', async () => {
      // Seed a full store, then make the next set() fail once (quota-style).
      const now = vi.spyOn(Date, 'now');
      for (let i = 0; i < MAX_BATCHES; i++) {
        now.mockReturnValue(1000 + i);
        await persistMappings([mapping(`[EMAIL_${i}]`, `u${i}@b.com`)]);
      }
      mock.chrome.storage.session.set.mockRejectedValueOnce(new Error('QUOTA_BYTES exceeded'));
      await writeBatchDirect({
        createdAt: 99999, seq: 999, mappings: [mapping('[EMAIL_1~ZZQQ]', 'new@b.com')],
      });
      // Pin the evict-half policy: half the old batches kept + the new one.
      const keys = Object.keys(mock.store).filter(k => k.startsWith(MAPPING_KEY_PREFIX));
      expect(keys).toHaveLength(Math.floor(MAX_BATCHES / 2) + 1);
      const loaded = await loadAllMappings();
      expect(loaded.some(m => m.original === 'new@b.com')).toBe(true);
      expect(loaded.some(m => m.original === `u${MAX_BATCHES - 1}@b.com`)).toBe(true); // newest survivor
      expect(loaded.some(m => m.original === 'u0@b.com')).toBe(false); // oldest evicted
    });

    it('never evicts the batch it just wrote, even with a backwards clock step', async () => {
      // Seed a full store with FUTURE timestamps, then write one batch whose
      // createdAt sorts oldest (clock stepped back). It must still survive.
      const now = vi.spyOn(Date, 'now');
      for (let i = 0; i < MAX_BATCHES; i++) {
        now.mockReturnValue(100000 + i);
        await persistMappings([mapping(`[EMAIL_${i}]`, `u${i}@b.com`)]);
      }
      await writeBatchDirect({
        createdAt: 500, seq: 1, mappings: [mapping('[EMAIL_1~PAST]', 'past@b.com')],
      });
      const keys = Object.keys(mock.store).filter(k => k.startsWith(MAPPING_KEY_PREFIX));
      expect(keys).toHaveLength(MAX_BATCHES);
      const loaded = await loadAllMappings();
      expect(loaded.some(m => m.original === 'past@b.com')).toBe(true);
    });
  });

  describe('content-script context (web page window)', () => {
    let mock: ReturnType<typeof makeChromeMock>;

    beforeEach(() => {
      mock = makeChromeMock();
      vi.stubGlobal('chrome', mock.chrome);
      vi.stubGlobal('window', { location: { protocol: 'https:' } });
    });

    it('routes writes through runtime.sendMessage instead of direct storage', async () => {
      await persistMappings([mapping('[EMAIL_1]', 'a@b.com')]);
      expect(mock.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
      expect(mock.chrome.storage.session.set).not.toHaveBeenCalled();
      const msg = mock.chrome.runtime.sendMessage.mock.calls[0][0] as {
        type: string; batch: MappingBatch;
      };
      expect(msg.type).toBe(PERSIST_MESSAGE_TYPE);
      expect(msg.batch.mappings[0].original).toBe('a@b.com');
    });

    it('falls back to memory when messaging throws', async () => {
      mock.chrome.runtime.sendMessage.mockRejectedValueOnce(new Error('Extension context invalidated'));
      await persistMappings([mapping('[EMAIL_1]', 'a@b.com')]);
      // Same-context read still sees the batch via the memory fallback.
      const loaded = await loadAllMappings();
      expect(loaded.some(m => m.original === 'a@b.com')).toBe(true);
    });

    it('falls back to memory when the worker reports a failed write', async () => {
      mock.chrome.runtime.sendMessage.mockResolvedValueOnce({ ok: false });
      await persistMappings([mapping('[EMAIL_1]', 'a@b.com')]);
      const loaded = await loadAllMappings();
      expect(loaded.some(m => m.original === 'a@b.com')).toBe(true);
    });

    it('caps the memory fallback at 32 batches, keeping the newest', async () => {
      // Orphaned content script: messaging dead for the life of the page.
      mock.chrome.runtime.sendMessage.mockRejectedValue(new Error('Extension context invalidated'));
      for (let i = 0; i < 40; i++) {
        await persistMappings([mapping(`[EMAIL_${i}]`, `u${i}@b.com`)]);
      }
      const loaded = await loadAllMappings();
      expect(loaded).toHaveLength(32);
      expect(loaded.some(m => m.original === 'u39@b.com')).toBe(true);
      expect(loaded.some(m => m.original === 'u0@b.com')).toBe(false);
    });
  });

  describe('extension page context (popup)', () => {
    it('writes directly from chrome-extension: pages', async () => {
      const mock = makeChromeMock();
      vi.stubGlobal('chrome', mock.chrome);
      vi.stubGlobal('window', { location: { protocol: 'chrome-extension:' } });

      await persistMappings([mapping('[EMAIL_1]', 'a@b.com')]);
      expect(mock.chrome.storage.session.set).toHaveBeenCalledTimes(1);
      expect(mock.chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('no extension APIs (plain unit-test env)', () => {
    it('persists and reads via the in-memory fallback', async () => {
      await persistMappings([mapping('[EMAIL_1]', 'a@b.com')]);
      const loaded = await loadAllMappings();
      expect(loaded).toHaveLength(1);
      expect(await countMappings()).toBe(1);
    });
  });

  describe('writeBatchDirect', () => {
    it('stores the given batch under a fresh prefixed key', async () => {
      const mock = makeChromeMock();
      vi.stubGlobal('chrome', mock.chrome);
      const batch: MappingBatch = {
        createdAt: 123, seq: 1, mappings: [mapping('[EMAIL_1]', 'a@b.com')],
      };
      await writeBatchDirect(batch);
      const [key, value] = Object.entries(mock.store)[0];
      expect(key.startsWith(MAPPING_KEY_PREFIX)).toBe(true);
      expect(value).toEqual(batch);
    });
  });
});
