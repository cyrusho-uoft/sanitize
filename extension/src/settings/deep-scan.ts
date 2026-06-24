import { Detection } from '../scanner/types';
import { DEFAULT_BACKEND_URL } from '../scanner/l2';

export interface DeepScanSettings {
  enabled: boolean;
  backendUrl: string;
}

/** Read the Deep Scan (L2) settings from chrome.storage. Defaults to disabled. */
export async function loadDeepScanSettings(): Promise<DeepScanSettings> {
  try {
    const r = await chrome.storage.local.get(['deepScanEnabled', 'backendUrl']);
    return {
      enabled: !!r.deepScanEnabled,
      backendUrl: (r.backendUrl as string) || DEFAULT_BACKEND_URL,
    };
  } catch {
    return { enabled: false, backendUrl: DEFAULT_BACKEND_URL };
  }
}

/**
 * Request an L2 deep scan from the service worker.
 *
 * Content scripts can't reliably make cross-origin fetches (page CSP/CORS), so the
 * actual network call runs in the service worker, which holds the backend host
 * permission. The worker gates on `deepScanEnabled` and fails open to `[]`.
 */
export async function requestDeepScan(text: string): Promise<Detection[]> {
  try {
    const resp = (await chrome.runtime.sendMessage({ type: 'deep-scan', text })) as
      | { detections?: Detection[] }
      | undefined;
    return Array.isArray(resp?.detections) ? resp!.detections! : [];
  } catch {
    return [];
  }
}
