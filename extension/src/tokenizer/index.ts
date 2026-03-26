import { Detection } from '../scanner/types';

interface TokenMapping {
  placeholder: string;
  original: string;
  type: string;
}

const TYPE_LABELS: Record<string, string> = {
  sin: 'SIN_REDACTED',
  student_number: 'STUDENT_ID',
  health_card: 'HEALTH_CARD',
  credit_card: 'CREDIT_CARD',
  email: 'EMAIL',
  phone: 'PHONE',
  utorid: 'UTORID',
  employee_id: 'EMPLOYEE_ID',
  person_name: 'PERSON',
  location: 'LOCATION',
  organization: 'ORG',
};

const STORAGE_KEY = 'prompt_sanitizer_mappings';

/**
 * Replace detected PII with semantic placeholders.
 * Returns sanitized text and stores the mapping in sessionStorage.
 */
export function tokenize(text: string, detections: Detection[]): string {
  if (detections.length === 0) return text;

  const mappings: TokenMapping[] = [];
  const typeCounts: Record<string, number> = {};

  // Sort by position (end to start) so replacements don't shift indices
  const sorted = [...detections].sort((a, b) => b.start - a.start);

  let result = text;
  for (const detection of sorted) {
    const label = TYPE_LABELS[detection.type] || detection.type.toUpperCase();
    typeCounts[label] = (typeCounts[label] || 0) + 1;
    const placeholder = `[${label}_${typeCounts[label]}]`;

    mappings.push({
      placeholder,
      original: detection.value,
      type: detection.type,
    });

    result = result.slice(0, detection.start) + placeholder + result.slice(detection.end);
  }

  // Store mappings in sessionStorage for de-sanitization
  try {
    const existing = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...existing, ...mappings]));
  } catch {
    // sessionStorage unavailable (e.g., in service worker) — store in memory
    console.warn('sessionStorage unavailable — token mappings will not persist');
  }

  return result;
}

/**
 * Restore original values from placeholders in AI response text.
 * Reads mappings from sessionStorage.
 */
export function detokenize(text: string): { result: string; restored: number } {
  let mappings: TokenMapping[] = [];
  try {
    mappings = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return { result: text, restored: 0 };
  }

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
export function clearMappings(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Get current mapping count */
export function getMappingCount(): number {
  try {
    const mappings = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
    return mappings.length;
  } catch {
    return 0;
  }
}
