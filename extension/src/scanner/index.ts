import { Detection } from './types';
import { patterns } from './registry';
import { mergeDetections } from './merge';

export { Detection, type Severity, type Layer } from './types';
export { mergeDetections } from './merge';
export { scanL2, type L2Config, DEFAULT_BACKEND_URL } from './l2';

/**
 * A single pattern taking longer than this is logged — it means a regex has
 * regressed from the linear-time discipline below and needs fixing.
 */
const SLOW_PATTERN_MS = 50;

/**
 * Run all L1 patterns against the given text.
 * Returns merged, deduplicated detections sorted by position.
 *
 * ReDoS posture: a synchronous regex can NOT be interrupted or timed out on
 * the same thread, and this function must stay synchronous (the paste/copy
 * handlers call it inside the event's dispatch phase). Protection therefore
 * comes from the code itself. The invariant for every L1 regex: no quantified
 * character class may overlap the token that follows it — that is what keeps
 * matching linear (bounded quantifiers only cap the residual backtracking).
 * The same linearity discipline applies to post-processing: mergeDetections
 * must stay O(n log n) in the detection count (a full rescan per detection
 * once froze the tab for 2.4s on a 640KB repetitive paste). Both are enforced
 * by the adversarial inputs in test/scanner-redos.test.ts.
 *
 * We deliberately do NOT truncate the input or silently skip patterns: for a
 * PII guard, scanning less text fails open (unscanned PII would paste raw).
 * A pattern that throws is logged and skipped so one bad recognizer can't
 * disable the other protections; slow patterns are logged for diagnosis.
 */
export function scanL1(text: string): Detection[] {
  if (!text || text.trim().length === 0) return [];

  const allDetections: Detection[][] = [];
  for (const pattern of patterns) {
    const started = Date.now();
    try {
      allDetections.push(pattern.scan(text));
    } catch (err) {
      console.warn(`Prompt Sanitizer: L1 pattern "${pattern.type}" threw — skipped this scan.`, err);
      continue;
    }
    const elapsed = Date.now() - started;
    if (elapsed > SLOW_PATTERN_MS) {
      console.warn(
        `Prompt Sanitizer: L1 pattern "${pattern.type}" took ${elapsed}ms on ${text.length} chars — check it for backtracking regressions.`
      );
    }
  }
  const mergeStarted = Date.now();
  const merged = mergeDetections(...allDetections);
  const mergeElapsed = Date.now() - mergeStarted;
  if (mergeElapsed > SLOW_PATTERN_MS) {
    console.warn(
      `Prompt Sanitizer: mergeDetections took ${mergeElapsed}ms — check it for complexity regressions.`
    );
  }
  return merged;
}
