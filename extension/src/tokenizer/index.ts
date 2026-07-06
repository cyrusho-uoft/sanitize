import { Detection } from '../scanner/types';
import {
  TokenMapping,
  persistMappings,
  loadAllMappings,
  clearAllMappings,
  countMappings,
} from './mapping-store';

const TYPE_LABELS: Record<string, string> = {
  sin: 'SIN_REDACTED',
  student_number: 'STUDENT_ID',
  health_card: 'HEALTH_CARD',
  credit_card: 'CREDIT_CARD',
  email: 'EMAIL',
  phone: 'PHONE',
  utorid: 'UTORID',
  username: 'USERNAME',
  employee_id: 'EMPLOYEE_ID',
  person_name: 'PERSON',
  location: 'LOCATION',
  organization: 'ORG',
  grant_number: 'GRANT',
};

// Writes started by this context — detokenize awaits them so a
// tokenize → detokenize sequence in one context never misses its own batch.
let pendingWrites: Promise<void>[] = [];

/**
 * Replace detected PII with semantic placeholders.
 * Synchronous (paste/copy handlers depend on it); the mapping batch is
 * persisted to chrome.storage.session in the background via mapping-store.
 *
 * Each call mints a random batch tag embedded in every placeholder
 * (e.g. [EMAIL_1~KQXR]) so placeholders from independent sanitize
 * operations can never collide: mappings now live in one browser-wide
 * store, and without the tag a restore could resolve [EMAIL_1] from a
 * different tab/conversation to the wrong person's PII (or to a value
 * poisoned by a hostile page firing synthetic copy events).
 */
export function tokenize(text: string, detections: Detection[]): string {
  if (detections.length === 0) return text;

  const mappings: TokenMapping[] = [];
  const typeCounts: Record<string, number> = {};
  // Uppercase-only alphabet: no L1 pattern can match it (UTORid needs
  // lowercase letters+digits, the rest need digits/@/URLs), so re-scanning
  // already-sanitized text never re-detects a tag as PII.
  const TAG_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const batchTag = Array.from(
    { length: 4 },
    () => TAG_ALPHABET[Math.floor(Math.random() * TAG_ALPHABET.length)]
  ).join('');

  // Sort by position (end to start) so replacements don't shift indices
  const sorted = [...detections].sort((a, b) => b.start - a.start);

  let result = text;
  for (const detection of sorted) {
    const label = TYPE_LABELS[detection.type] || detection.type.toUpperCase();
    typeCounts[label] = (typeCounts[label] || 0) + 1;
    const placeholder = `[${label}_${typeCounts[label]}~${batchTag}]`;

    mappings.push({
      placeholder,
      original: detection.value,
      type: detection.type,
    });

    result = result.slice(0, detection.start) + placeholder + result.slice(detection.end);
  }

  const write = persistMappings(mappings);
  pendingWrites.push(write);
  // Cap the pending list so long-lived contexts don't grow it unbounded.
  if (pendingWrites.length > 32) pendingWrites = pendingWrites.slice(-32);

  return result;
}

/**
 * Restore original values from placeholders in AI response text.
 * Reads mappings from chrome.storage.session (all contexts, newest first).
 */
export async function detokenize(text: string): Promise<{ result: string; restored: number }> {
  await Promise.allSettled(pendingWrites);
  const mappings = await loadAllMappings();

  if (mappings.length === 0) return { result: text, restored: 0 };

  let result = text;
  let restored = 0;

  for (const mapping of mappings) {
    if (result.includes(mapping.placeholder)) {
      result = result.replaceAll(mapping.placeholder, mapping.original);
      restored++;
    }
  }

  return { result, restored };
}

/** Clear all stored token mappings */
export async function clearMappings(): Promise<void> {
  await Promise.allSettled(pendingWrites);
  pendingWrites = [];
  await clearAllMappings();
}

/** Get current mapping count */
export async function getMappingCount(): Promise<number> {
  await Promise.allSettled(pendingWrites);
  return countMappings();
}
