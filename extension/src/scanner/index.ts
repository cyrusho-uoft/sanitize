import { Detection } from './types';
import { patterns } from './registry';
import { mergeDetections } from './merge';

export { Detection, type Severity, type Layer } from './types';
export { mergeDetections } from './merge';

/**
 * Run all L1 patterns against the given text.
 * Returns merged, deduplicated detections sorted by position.
 */
export function scanL1(text: string): Detection[] {
  if (!text || text.trim().length === 0) return [];

  const allDetections: Detection[][] = patterns.map(pattern => pattern.scan(text));
  return mergeDetections(...allDetections);
}
