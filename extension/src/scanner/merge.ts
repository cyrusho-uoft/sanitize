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
 */
export function mergeDetections(...sources: Detection[][]): Detection[] {
  const all = sources.flat().sort((a, b) => a.start - b.start);
  const merged: Detection[] = [];

  for (const detection of all) {
    const overlapIdx = merged.findIndex(existing => overlaps(existing, detection));

    if (overlapIdx === -1) {
      merged.push(detection);
    } else {
      const winner = pickWinner(merged[overlapIdx], detection);
      merged[overlapIdx] = winner;
    }
  }

  return merged.sort((a, b) => a.start - b.start);
}
