import { Detection, TYPE_PRIORITY } from './types';

/** Check if two detections overlap in the text */
function overlaps(a: Detection, b: Detection): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Pick the winner when two detections overlap */
function pickWinner(a: Detection, b: Detection): Detection {
  const priorityA = TYPE_PRIORITY[a.type] ?? 0;
  const priorityB = TYPE_PRIORITY[b.type] ?? 0;

  // Higher type priority wins
  if (priorityA !== priorityB) return priorityA > priorityB ? a : b;

  // Same type: higher confidence wins
  if (a.confidence !== b.confidence) return a.confidence > b.confidence ? a : b;

  // Same type + confidence: prefer L1 (institution-specific)
  if (a.layer !== b.layer) return a.layer === 'L1' ? a : b;

  return a;
}

/**
 * Merge detections from multiple sources (L1 + L2).
 * When spans overlap, the higher-priority detection wins.
 *
 * Linear-time discipline: `all` is sorted by start, so once an entry in
 * `merged` ends at or before the current detection's start it can never
 * overlap this or any later detection — the frontier index skips those
 * permanently. A findIndex from 0 here made scanL1 O(detections²): a 640KB
 * repetitive paste (~40k detections) froze the tab for 2.4s.
 */
export function mergeDetections(...sources: Detection[][]): Detection[] {
  const all = sources.flat().sort((a, b) => a.start - b.start);
  const merged: Detection[] = [];
  let frontier = 0;

  for (const detection of all) {
    while (frontier < merged.length && merged[frontier].end <= detection.start) frontier++;

    let overlapIdx = -1;
    for (let i = frontier; i < merged.length; i++) {
      if (overlaps(merged[i], detection)) {
        overlapIdx = i;
        break;
      }
    }

    if (overlapIdx === -1) {
      merged.push(detection);
    } else {
      merged[overlapIdx] = pickWinner(merged[overlapIdx], detection);
    }
  }

  return merged.sort((a, b) => a.start - b.start);
}
