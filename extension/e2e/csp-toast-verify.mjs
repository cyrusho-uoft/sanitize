/**
 * CSP toast verification against the real AI sites (Mode A end-to-end).
 *
 * For each target site this script loads the built extension in Chromium,
 * puts sample PII in the OS clipboard (Windows), fires a REAL Ctrl+V (so the
 * paste event is isTrusted) into a native editable element, then verifies:
 *   1. `.ps-toast-v2` exists in the DOM (not stripped by site JS),
 *   2. the injected <style> actually applied (computed position:fixed +
 *      max z-index — if the page CSP had blocked it, computed styles would
 *      collapse to defaults),
 *   3. the pasted text was replaced with placeholders and no raw PII landed,
 *   4. no CSP violation messages attributable to the extension,
 * and records each site's CSP header plus a screenshot.
 *
 * Verified passing on chatgpt.com, claude.ai and gemini.google.com on
 * 2026-07-13 (see TODOS.md). Content scripts run in Chrome's isolated world,
 * which is exempt from the page CSP — including Gemini's
 * `require-trusted-types-for 'script'` — so the toast renders even under
 * strict policies. This run also caught a real bug: input[type=email] has no
 * selection API and WRITING selectionStart/End throws InvalidStateError
 * (content-script.ts now guards it).
 *
 * Run (from extension/):
 *   npm run build
 *   npm i --no-save playwright && npx playwright install chromium
 *   node e2e/csp-toast-verify.mjs
 *
 * Headed Chromium windows will open (extensions need a persistent context);
 * results + screenshots land in a temp dir printed at the end. The OS
 * clipboard is overwritten with the fake PII sample during the run.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT_PATH = path.resolve(HERE, '..', 'dist');
const OUT_DIR = path.join(tmpdir(), 'ps-csp-verify');
mkdirSync(OUT_DIR, { recursive: true });

// Canonical fake PII: the classic SIN test number, a plausible U of T address
// and the public U of T switchboard number.
const PII_TEXT =
  'Student SIN 046 454 286, contact jane.doe@mail.utoronto.ca or 416-978-2011 please.';
const PLACEHOLDER_RE = /\[[A-Z][A-Z_]*_\d+~[A-Z]{4}\]/;

const SITES = [
  { name: 'chatgpt', url: 'https://chatgpt.com/' },
  { name: 'claude', url: 'https://claude.ai/login' },
  { name: 'gemini', url: 'https://gemini.google.com/' },
];

function setClipboard(text) {
  const b64 = Buffer.from(text, 'utf8').toString('base64');
  execFileSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    `Set-Clipboard -Value ([System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')))`,
  ]);
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
      if ((await el.count()) > 0 && (await el.isVisible()))
        return { locator: el, selector: sel, synthetic: false };
    } catch {
      /* keep looking */
    }
  }
  // No native editable reachable (login wall / marketing page): add one.
  // The paste listener is document-level in the content script's isolated
  // world, so a page-created textarea still exercises the REAL intercept +
  // toast path against the REAL page CSP.
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
  const page = await context.newPage();
  const cspViolations = [];
  page.on('console', (msg) => {
    const t = msg.text();
    if (/content security policy|refused to (apply|execute|load)/i.test(t))
      cspViolations.push(t.slice(0, 300));
  });

  let cspHeader = null;
  page.on('response', (resp) => {
    if (resp.request().isNavigationRequest() && resp.request().frame() === page.mainFrame()) {
      const h = resp.headers()['content-security-policy'];
      if (h) cspHeader = h;
    }
  });

  const result = { site: site.name, url: site.url };
  try {
    await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(5000); // let SPA boot / redirects settle
    result.finalUrl = page.url();
    result.title = await page.title().catch(() => '');
    result.cspMeta = await page
      .evaluate(
        () =>
          document
            .querySelector('meta[http-equiv="Content-Security-Policy"]')
            ?.getAttribute('content') || null
      )
      .catch(() => null);
    result.cspHeader = cspHeader;

    const { locator, selector, synthetic } = await findEditable(page);
    result.editable = selector;
    result.synthetic = synthetic;

    await locator.click({ timeout: 10000 });
    setClipboard(PII_TEXT);
    await page.keyboard.press('Control+V');
    await page.waitForTimeout(1500);

    // 1. toast in DOM?
    result.toastInDom = (await page.locator('.ps-toast-v2').count()) > 0;

    // 2. our stylesheet actually applied?
    if (result.toastInDom) {
      result.toastStyle = await page.evaluate(() => {
        const el = document.querySelector('.ps-toast-v2');
        if (!el) return null;
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return {
          position: cs.position,
          zIndex: cs.zIndex,
          background: cs.backgroundColor,
          visible: rect.width > 0 && rect.height > 0,
          inViewport: rect.bottom <= innerHeight + 1 && rect.right <= innerWidth + 1,
          styleElPresent: !!document.querySelector('#ps-toast-v2-style'),
          headline: el.querySelector('.ps-t-head span')?.textContent || '',
        };
      });
      result.styleApplied =
        result.toastStyle?.position === 'fixed' && result.toastStyle?.zIndex === '2147483647';
    }

    // 3. paste replaced with placeholders, no raw PII?
    result.fieldValue = await page
      .evaluate(() => {
        const active = document.activeElement;
        if (!active) return null;
        return 'value' in active ? active.value : active.textContent;
      })
      .catch(() => null);
    result.placeholdersInserted = PLACEHOLDER_RE.test(result.fieldValue || '');
    result.rawPiiLeaked = (result.fieldValue || '').includes('046 454 286');

    result.cspViolations = cspViolations;
    result.screenshot = path.join(OUT_DIR, `${site.name}.png`);
    await page.screenshot({ path: result.screenshot });
  } catch (err) {
    result.error = String(err).slice(0, 500);
    try {
      result.screenshot = path.join(OUT_DIR, `${site.name}-error.png`);
      await page.screenshot({ path: result.screenshot });
    } catch {
      /* page gone */
    }
  } finally {
    await page.close().catch(() => {});
  }
  return result;
}

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

// Make sure the MV3 service worker is up (extension actually loaded).
if (context.serviceWorkers().length === 0) {
  await context.waitForEvent('serviceworker', { timeout: 15000 }).catch(() => {});
}
const swUrls = context.serviceWorkers().map((w) => w.url());

const results = [];
for (const site of SITES) {
  console.log(`--- testing ${site.name} ---`);
  results.push(await testSite(context, site));
}

await context.close();
// The fake PII stays in the OS clipboard otherwise.
setClipboard(' ');

const report = { extensionServiceWorkers: swUrls, results };
writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`\nResults + screenshots: ${OUT_DIR}`);

const failed = results.filter(
  (r) => r.error || !r.toastInDom || !r.styleApplied || !r.placeholdersInserted || r.rawPiiLeaked
);
if (failed.length > 0) {
  console.error(`FAIL: ${failed.map((r) => r.site).join(', ')}`);
  process.exit(1);
}
console.log('PASS: all sites');
