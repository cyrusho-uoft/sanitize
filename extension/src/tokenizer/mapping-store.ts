/**
 * Cross-context store for token mappings (placeholder ↔ original PII).
 *
 * Backed by chrome.storage.session — in-memory, shared across the service
 * worker, popup, and content scripts, and cleared when the browser closes.
 * This replaces per-tab sessionStorage, which broke restoration across
 * tabs/contexts and was entirely unavailable in the service worker.
 *
 * Write routing:
 *  - Trusted contexts (service worker, popup/settings pages) write directly.
 *  - Content scripts route writes through the service worker via
 *    chrome.runtime.sendMessage — content scripts can't touch
 *    chrome.storage.session without setAccessLevel, and the message also
 *    wakes the worker so the write always lands in a trusted context.
 *
 * Each tokenize() call persists its batch under a unique key, so concurrent
 * writers never race on a shared read-modify-write.
 *
 * Falls back to an in-context memory store when extension APIs are
 * unavailable (unit tests, plain pages) so tokenize/detokenize still work
 * within a single context.
 */

export interface TokenMapping {
  placeholder: string;
  original: string;
  type: string;
}

export interface MappingBatch {
  createdAt: number;
  /** Monotonic per-context counter — tie-breaks batches created in the same ms. */
  seq: number;
  mappings: TokenMapping[];
}

let batchSeq = 0;

export const MAPPING_KEY_PREFIX = 'psmap_';
export const PERSIST_MESSAGE_TYPE = 'persist-mappings';

/**
 * Retention cap: chrome.storage.session is one shared ~10MB area for the
 * whole browser session and batches are otherwise never garbage-collected.
 * Keeping only the newest batches bounds growth (old batches lose to newer
 * ones anyway) and keeps writes working instead of silently failing at quota.
 */
export const MAX_BATCHES = 64;

/** In-context fallback when chrome.storage.session is unreachable. */
const memoryBatches: MappingBatch[] = [];
const MAX_MEMORY_BATCHES = 32;

function pushMemoryBatch(batch: MappingBatch): void {
  memoryBatches.push(batch);
  // Bound the fallback — orphaned content scripts (extension updated while
  // the page stays open) land every batch here for the life of the page.
  if (memoryBatches.length > MAX_MEMORY_BATCHES) {
    memoryBatches.splice(0, memoryBatches.length - MAX_MEMORY_BATCHES);
  }
}

function hasSessionStorageArea(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.session;
}

function hasRuntimeMessaging(): boolean {
  return typeof chrome !== 'undefined' && typeof chrome.runtime?.sendMessage === 'function';
}

/** Trusted contexts (service worker, extension pages) may write directly. */
function isTrustedContext(): boolean {
  if (typeof window === 'undefined') return true; // service worker
  try {
    return window.location.protocol === 'chrome-extension:';
  } catch {
    return false;
  }
}

function newBatchKey(): string {
  return `${MAPPING_KEY_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Remove the oldest mapping batches until at most `keep` remain.
 * `excludeKey` is never evicted (nor counted against `keep`) — createdAt is
 * sender-stamped wall clock, so a just-written batch could otherwise sort
 * "oldest" after a backwards clock step and evict itself.
 */
async function evictOldestBatches(keep: number, excludeKey?: string): Promise<void> {
  const all = await chrome.storage.session.get();
  const entries = Object.entries(all)
    .filter(([k]) => k.startsWith(MAPPING_KEY_PREFIX) && k !== excludeKey)
    .map(([k, v]) => ({ key: k, batch: v as MappingBatch }));
  if (entries.length <= keep) return;
  entries.sort(
    (a, b) =>
      ((a.batch?.createdAt || 0) - (b.batch?.createdAt || 0)) ||
      ((a.batch?.seq || 0) - (b.batch?.seq || 0))
  );
  await chrome.storage.session.remove(entries.slice(0, entries.length - keep).map(e => e.key));
}

/**
 * Write a batch into chrome.storage.session under a fresh key.
 * On failure (realistically: quota exceeded) evicts the oldest batches and
 * retries once — the newest mapping is the one the user will restore.
 * Enforces the MAX_BATCHES retention cap after each write.
 */
export async function writeBatchDirect(batch: MappingBatch): Promise<void> {
  const key = newBatchKey();
  try {
    await chrome.storage.session.set({ [key]: batch });
  } catch {
    await evictOldestBatches(Math.floor(MAX_BATCHES / 2), key);
    await chrome.storage.session.set({ [key]: batch });
  }
  // Keep MAX_BATCHES - 1 others + the batch just written = MAX_BATCHES total.
  await evictOldestBatches(MAX_BATCHES - 1, key);
}

/**
 * Persist a batch of mappings. Resolves when the write has landed (direct
 * write completed, or the service worker acknowledged {ok: true}).
 * Never rejects — on failure the batch is kept in the in-context memory
 * fallback so same-context detokenize still works.
 */
export async function persistMappings(mappings: TokenMapping[]): Promise<void> {
  if (mappings.length === 0) return;
  const batch: MappingBatch = { createdAt: Date.now(), seq: ++batchSeq, mappings };

  try {
    if (isTrustedContext() && hasSessionStorageArea()) {
      await writeBatchDirect(batch);
      return;
    }
    if (hasRuntimeMessaging()) {
      const resp = (await chrome.runtime.sendMessage({
        type: PERSIST_MESSAGE_TYPE,
        batch,
      })) as { ok?: boolean } | undefined;
      if (resp?.ok) return;
      // Worker reported (or never confirmed) the write — keep a local copy.
    }
  } catch {
    // fall through to memory fallback
  }
  pushMemoryBatch(batch);
}

/**
 * Load all persisted mappings, newest batch first. When the same placeholder
 * (e.g. [EMAIL_1]) exists in multiple batches, the most recent sanitize wins.
 */
export async function loadAllMappings(): Promise<TokenMapping[]> {
  const batches: MappingBatch[] = [...memoryBatches];

  if (hasSessionStorageArea()) {
    try {
      // No-arg get() returns the entire storage area (typings reject null).
      const all = await chrome.storage.session.get();
      for (const [key, value] of Object.entries(all)) {
        if (!key.startsWith(MAPPING_KEY_PREFIX)) continue;
        const batch = value as MappingBatch;
        if (Array.isArray(batch?.mappings)) batches.push(batch);
      }
    } catch {
      // storage unreachable — memory fallback only
    }
  }

  batches.sort(
    (a, b) => ((b.createdAt || 0) - (a.createdAt || 0)) || ((b.seq || 0) - (a.seq || 0))
  );
  return batches.flatMap(b => b.mappings);
}

/** Remove all persisted mapping batches (storage + memory fallback). */
export async function clearAllMappings(): Promise<void> {
  memoryBatches.length = 0;
  if (!hasSessionStorageArea()) return;
  try {
    const all = await chrome.storage.session.get();
    const keys = Object.keys(all).filter(k => k.startsWith(MAPPING_KEY_PREFIX));
    if (keys.length > 0) await chrome.storage.session.remove(keys);
  } catch {
    // ignore — session storage clears itself when the browser closes
  }
}

/** Count of stored mappings across all batches. */
export async function countMappings(): Promise<number> {
  const mappings = await loadAllMappings();
  return mappings.length;
}
