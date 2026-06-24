import { Detection, Severity } from './types';

/** Default on-prem L2 gateway. Override per-deployment via the `backendUrl` setting. */
export const DEFAULT_BACKEND_URL = 'http://localhost:8000';

/** How long to wait on the backend before falling back to L1-only. */
export const DEFAULT_L2_TIMEOUT_MS = 4000;

/**
 * Map Presidio (backend) entity types to the extension's L1 type keys so that
 * merge priority (TYPE_PRIORITY), tokenizer labels, and explanations.json all line up.
 * Unmapped types fall back to a lowercased form.
 */
const L2_TYPE_MAP: Record<string, string> = {
  PERSON: 'person_name',
  LOCATION: 'location',
  ORGANIZATION: 'organization',
  EMAIL_ADDRESS: 'email',
  PHONE_NUMBER: 'phone',
  CREDIT_CARD: 'credit_card',
  CA_SOCIAL_INSURANCE_NUMBER: 'sin',
  UTORID: 'utorid',
  STUDENT_NUMBER: 'student_number',
  EMPLOYEE_ID: 'employee_id',
  GRANT_NUMBER: 'grant_number',
};

interface BackendDetection {
  type: string;
  value: string;
  start: number;
  end: number;
  severity: string;
  layer: string;
  confidence: number;
  explanationKey: string;
}

export interface L2Config {
  /** Backend base URL (no trailing /api/v1). */
  url?: string;
  /** Abort after this many ms. */
  timeoutMs?: number;
  /** Presidio analysis language. */
  language?: string;
}

function isValidSeverity(s: string): s is Severity {
  return s === 'high' || s === 'medium' || s === 'low';
}

/**
 * Convert a backend detection into the extension's Detection shape, or null if malformed.
 *
 * The backend is an untrusted boundary (user-configured URL, plain HTTP by default), so we
 * validate the span against the *source text* and trust the locally-sliced substring rather
 * than the backend-supplied `value`. This prevents a hostile/MITM'd backend from corrupting
 * the prompt (out-of-range slices) or poisoning the detokenize mapping with arbitrary text.
 */
export function normalizeL2Detection(d: BackendDetection, text: string): Detection | null {
  if (
    !d ||
    !Number.isInteger(d.start) ||
    !Number.isInteger(d.end) ||
    d.start < 0 ||
    d.end > text.length ||
    d.end <= d.start
  ) {
    return null;
  }
  const type = L2_TYPE_MAP[d.type] || String(d.type).toLowerCase();
  return {
    type,
    value: text.slice(d.start, d.end), // local substring, not the backend-supplied value
    start: d.start,
    end: d.end,
    severity: isValidSeverity(d.severity) ? d.severity : 'medium',
    layer: 'L2',
    confidence: typeof d.confidence === 'number' ? d.confidence : 0.5,
    explanationKey: type,
  };
}

/**
 * Layer-2 deep scan via the on-prem Presidio gateway.
 *
 * Best-effort and fail-open: any error, timeout, non-2xx, or malformed body
 * resolves to `[]` so L2 can never block or break the L1-only path.
 */
export async function scanL2(text: string, config: L2Config = {}): Promise<Detection[]> {
  if (!text || text.trim().length === 0) return [];

  const base = (config.url || DEFAULT_BACKEND_URL).replace(/\/+$/, '');
  const timeoutMs = config.timeoutMs ?? DEFAULT_L2_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(`${base}/api/v1/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language: config.language || 'en' }),
      signal: controller.signal,
    });
    if (!resp.ok) return [];

    const data = (await resp.json()) as { detections?: BackendDetection[] };
    if (!Array.isArray(data?.detections)) return [];

    return data.detections
      .map((d) => normalizeL2Detection(d, text))
      .filter((d): d is Detection => d !== null);
  } catch {
    // network error, timeout/abort, CORS, backend down, bad JSON — fall back to L1 only
    return [];
  } finally {
    clearTimeout(timer);
  }
}
