/**
 * CSP toast verification against the real AI sites (Mode A end-to-end).
 *
 * Loads the built extension in Chromium and, for every host the manifest's
 * Mode A content script matches, fires a REAL Ctrl+V (isTrusted paste) of
 * sample PII into the site's own composer/input, then GATES the run on:
 *   1. the toast host `[data-ps-toast-host]` present in the light DOM (the
 *      card itself is in a CLOSED shadow root, unreachable from the page),
 *   2. the host's inline-locked layout applied — computed position:fixed, max
 *      z-index, visibility:visible — AND the host visible inside the viewport
 *      (a CSP-blocked shadow <style> or a hidden host breaks one of these),
 *   3. placeholders inserted and NONE of the planted PII literals present,
 *   4. no CSP-violation console message attributable to the extension,
 *   5. a native site editable was used (a synthetic fallback input exercises
 *      the intercept path but does NOT count as verifying the site).
 * Each site's CSP header and a screenshot are recorded in the report.
 *
 * Verified passing on chatgpt.com, claude.ai and gemini.google.com on
 * 2026-07-13 (see TODOS.md). Content scripts run in Chrome's isolated world,
 * which is exempt from the page CSP — including Gemini's
 * `require-trusted-types-for 'script'` — so the toast renders even under
 * strict policies.
 *
 * Run (from extension/):
 *   npm run build
 *   npm i --no-save playwright && npx playwright install chromium
 *   node e2e/csp-toast-verify.mjs
 *
 * Headed Chromium windows will open (extensions need a persistent context);
 * results + screenshots land in a temp dir printed at the end. The OS
 * clipboard holds the fake PII sample during the run and is cleared in the
 * finally block even when a site test throws.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT_PATH = path.resolve(HERE, '..', 'dist');
const OUT_DIR = path.join(tmpdir(), 'ps-csp-verify');
mkdirSync(OUT_DIR, { recursive: true });

// Canonical fake PII: the classic SIN test number, a plausible U of T address
// and the public U of T switchboard number. Every literal here must also be
// asserted absent after the paste (PII_LITERALS).
const PII_SIN = '046 454 286';
const PII_EMAIL = 'jane.doe@mail.utoronto.ca';
const PII_PHONE = '416-978-2011';
const PII_TEXT = `Student SIN ${PII_SIN}, contact ${PII_EMAIL} or ${PII_PHONE} please.`;
const PII_LITERALS = [PII_SIN, PII_EMAIL, PII_PHONE];

// Literal copy of PLACEHOLDER_RE from src/tokenizer/index.ts (this plain .mjs
// can't import the TS bundle) — update both together.
const PLACEHOLDER_RE = /\[[A-Z][A-Z_]*_\d+~[A-Z]{4}\]/;

/**
 * Derive the site list from the manifest's Mode A content script so a host
 * added there can never silently skip verification. Each host must either be
 * tested (with an entry URL) or explicitly skipped with a reason.
 */
const manifest = JSON.parse(readFileSync(path.resolve(HERE, '..', 'manifest.json'), 'utf8'));
const MODE_A_HOSTS = manifest.content_scripts[0].matches.map(
  (m) => new URL(m.replace('*', 'x')).hostname.replace(/^x\./, '')
);
const ENTRY_URLS = {
  'chatgpt.com': 'https://chatgpt.com/',
  'claude.ai': 'https://claude.ai/login',
  'gemini.google.com': 'https://gemini.google.com/',
};
const SKIPPED_HOSTS = {
  // 301s to chatgpt.com before the content script runs; the target is covered.
  'chat.openai.com': 'redirects to chatgpt.com',
};
const unaccounted = MODE_A_HOSTS.filter((h) => !ENTRY_URLS[h] && !SKIPPED_HOSTS[h]);
if (unaccounted.length > 0) {
  console.error(
    `FAIL: manifest Mode A hosts not covered by this script (add to ENTRY_URLS or SKIPPED_HOSTS with a reason): ${unaccounted.join(', ')}`
  );
  process.exit(1);
}
const SITES = Object.entries(ENTRY_URLS).map(([name, url]) => ({ name, url }));
for (const [host, why] of Object.entries(SKIPPED_HOSTS)) {
  console.log(`skipping ${host}: ${why}`);
}

function setClipboard(text) {
  const b64 = Buffer.from(text, 'utf8').toString('base64');
  // PowerShell can stall on clipboard contention (seen live with the headed
  // browser focused), so bound and retry it — and call this only while no
  // headed browser is up.
  for (let attempt = 1; ; attempt++) {
    try {
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `Set-Clipboard -Value ([System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')))`,
        ],
        { timeout: 30000 }
      );
      return;
    } catch (e) {
      if (attempt >= 3) throw e;
      console.error(`setClipboard attempt ${attempt} failed (${e.code}), retrying...`);
    }
  }
}

const EDITABLE_SELECTORS = [
  '#prompt-textarea', // chatgpt composer (ProseMirror contenteditable)
  'div[contenteditable="true"]',
  'textarea:not([readonly])',
  'input[type="email"]:not([readonly])',
  'input[type="text"]:not([readonly])',
];

async function findEditable(page) {
  for (const sel of EDITABLE_SELECTORS) {
    const el = page.locator(sel).first();
    try {
      // isVisible() returns false (no throw, no wait) when nothing matches.
      if (await el.isVisible()) return { locator: el, selector: sel, synthetic: false };
    } catch {
      /* keep looking */
    }
  }
  // No native editable reachable (login wall / marketing page): add one so
  // the intercept path still gets exercised — but the run is marked synthetic
  // and the PASS gate rejects it: it does not verify the site's own editor.
  await page.evaluate(() => {
    const ta = document.createElement('textarea');
    ta.id = 'ps-e2e-input';
    ta.style.cssText =
      'position:fixed;top:12px;left:12px;width:420px;height:90px;z-index:2147483000;background:#fff;color:#000;border:2px solid red;';
    document.body.appendChild(ta);
  });
  return {
    locator: page.locator('#ps-e2e-input'),
    selector: '#ps-e2e-input (synthetic)',
    synthetic: true,
  };
}

async function testSite(context, site) {
  const result = { site: site.name, url: site.url };
  let page = null;
  try {
    page = await context.newPage();
    const cspViolations = [];
    page.on('console', (msg) => {
      const t = msg.text();
      if (/content security policy|refused to|trusted ?types|trustedhtml/i.test(t))
        cspViolations.push(t.slice(0, 300));
    });

    const resp = await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(5000); // let SPA boot / redirects settle
    result.finalUrl = page.url();
    result.title = await page.title().catch(() => '');
    result.cspHeader = resp?.headers()['content-security-policy'] ?? null;
    result.cspMeta = await page
      .evaluate(
        () =>
          document
            .querySelector('meta[http-equiv="Content-Security-Policy"]')
            ?.getAttribute('content') || null
      )
      .catch(() => null);

    const { locator, selector, synthetic } = await findEditable(page);
    result.editable = selector;
    result.synthetic = synthetic;

    await locator.click({ timeout: 10000 });
    await page.keyboard.press('Control+V');
    await page.waitForTimeout(1500);

    // 1. toast host in DOM? The card lives in a CLOSED shadow root, so we
    // verify via the light-DOM host element the page could actually see.
    result.toastInDom = (await page.locator('[data-ps-toast-host]').count()) > 0;

    // 2. host layout locked + toast actually visible? position:fixed and the
    // max z-index are set inline with !important on the host; a page CSP that
    // blocked the injected shadow styles, or a page rule that hid the host,
    // would break one of these.
    if (result.toastInDom) {
      result.toastStyle = await page.evaluate(() => {
        const el = document.querySelector('[data-ps-toast-host]');
        if (!el) return null;
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return {
          position: cs.position,
          zIndex: cs.zIndex,
          visibility: cs.visibility,
          opacity: cs.opacity,
          // Host wraps the card tightly, so a real rendered card gives the host
          // a non-zero box; a suppressed/empty toast collapses it.
          visible: rect.width > 0 && rect.height > 0,
          inViewport: rect.bottom <= innerHeight + 1 && rect.right <= innerWidth + 1,
        };
      });
      result.styleApplied =
        result.toastStyle?.position === 'fixed' &&
        result.toastStyle?.zIndex === '2147483647' &&
        result.toastStyle?.visibility === 'visible' &&
        result.toastStyle?.visible === true &&
        result.toastStyle?.inViewport === true;
    }

    // 3. paste replaced with placeholders, none of the planted PII present?
    result.fieldValue = await page
      .evaluate(() => {
        const active = document.activeElement;
        if (!active) return null;
        return 'value' in active ? active.value : active.textContent;
      })
      .catch(() => null);
    result.placeholdersInserted = PLACEHOLDER_RE.test(result.fieldValue || '');
    result.rawPiiLeaked = PII_LITERALS.some((lit) => (result.fieldValue || '').includes(lit));

    // 4. CSP violations: record everything, gate on extension-attributable
    // ones (our injected ids/classes or the chrome-extension scheme).
    result.cspViolations = cspViolations;
    result.extensionCspViolations = cspViolations.filter((v) =>
      /ps-toast|chrome-extension:\/\//i.test(v)
    );
  } catch (err) {
    result.error = String(err).slice(0, 500);
  } finally {
    if (page) {
      result.screenshot = path.join(OUT_DIR, `${site.name}${result.error ? '-error' : ''}.png`);
      await page.screenshot({ path: result.screenshot }).catch(() => {});
      await page.close().catch(() => {});
    }
  }
  return result;
}

// Clipboard content is constant for the whole run: set it BEFORE the headed
// browser exists (a focused browser window can hold the clipboard open and
// stall PowerShell — seen live as spawnSync ETIMEDOUT).
setClipboard(PII_TEXT);

const results = [];
let swUrls = [];
const context = await chromium.launchPersistentContext(path.join(OUT_DIR, 'chrome-profile'), {
  headless: false,
  args: [
    `--disable-extensions-except=${EXT_PATH}`,
    `--load-extension=${EXT_PATH}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
  viewport: { width: 1280, height: 800 },
});
try {
  // Make sure the MV3 service worker is up (extension actually loaded).
  if (context.serviceWorkers().length === 0) {
    await context.waitForEvent('serviceworker', { timeout: 15000 }).catch(() => {});
  }
  swUrls = context.serviceWorkers().map((w) => w.url());

  for (const site of SITES) {
    console.log(`--- testing ${site.name} ---`);
    results.push(await testSite(context, site));
  }
} finally {
  await context.close().catch(() => {});
  // Never leave the fake PII in the OS clipboard, even when a site test threw.
  try {
    setClipboard(' ');
  } catch (e) {
    console.error(`WARNING: could not clear the clipboard (${e.code}) — it still holds the fake PII sample.`);
  }
}

const report = { extensionServiceWorkers: swUrls, skipped: SKIPPED_HOSTS, results };
writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`\nResults + screenshots: ${OUT_DIR}`);

const failed = results.filter(
  (r) =>
    r.error ||
    r.synthetic ||
    !r.toastInDom ||
    !r.styleApplied ||
    !r.placeholdersInserted ||
    r.rawPiiLeaked ||
    r.extensionCspViolations.length > 0
);
if (failed.length > 0 || results.length !== SITES.length) {
  console.error(`FAIL: ${failed.map((r) => `${r.site}${r.synthetic ? ' (synthetic input only)' : ''}`).join(', ') || 'incomplete run'}`);
  process.exit(1);
}
console.log('PASS: all sites');
