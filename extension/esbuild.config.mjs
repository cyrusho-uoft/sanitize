import { build, context } from 'esbuild';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const isWatch = process.argv.includes('--watch');

const commonOptions = {
  bundle: true,
  sourcemap: true,
  target: 'es2022',
  format: 'iife',
};

const entries = [
  { in: 'src/popup/popup.ts', out: 'dist/popup/popup.js', format: 'iife' },
  { in: 'src/background/service-worker.ts', out: 'dist/background/service-worker.js', format: 'esm' },
  { in: 'src/content/content-script.ts', out: 'dist/content/content-script.js', format: 'iife' },
  { in: 'src/content/copy-intercept.ts', out: 'dist/content/copy-intercept.js', format: 'iife' },
  { in: 'src/settings/settings.ts', out: 'dist/settings/settings.js', format: 'iife' },
  { in: 'src/offscreen/offscreen.ts', out: 'dist/offscreen/offscreen.js', format: 'iife' },
  { in: 'src/onboarding/onboarding.ts', out: 'dist/onboarding/onboarding.js', format: 'iife' },
];

// Copy static files to dist
function copyStatic() {
  const copies = [
    ['src/popup/popup.html', 'dist/popup/popup.html'],
    ['src/popup/popup.css', 'dist/popup/popup.css'],
    ['src/content/toast.css', 'dist/content/toast.css'],
    ['src/settings/settings.html', 'dist/settings/settings.html'],
    ['src/settings/settings.css', 'dist/settings/settings.css'],
    ['src/offscreen/offscreen.html', 'dist/offscreen/offscreen.html'],
    ['src/onboarding/onboarding.html', 'dist/onboarding/onboarding.html'],
    ['src/onboarding/onboarding.css', 'dist/onboarding/onboarding.css'],
    ['manifest.json', 'dist/manifest.json'],
  ];

  for (const [src, dest] of copies) {
    const destDir = join(dest, '..');
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
    copyFileSync(src, dest);
  }

  // Create icons directory with placeholder
  const iconsDir = 'dist/icons';
  if (!existsSync(iconsDir)) mkdirSync(iconsDir, { recursive: true });
}

async function run() {
  copyStatic();

  for (const entry of entries) {
    const outDir = join(entry.out, '..');
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

    const opts = {
      ...commonOptions,
      entryPoints: [entry.in],
      outfile: entry.out,
      format: entry.format || commonOptions.format,
    };

    if (isWatch) {
      const ctx = await context(opts);
      await ctx.watch();
      console.log(`Watching ${entry.in}...`);
    } else {
      await build(opts);
      console.log(`Built ${entry.out}`);
    }
  }

  if (!isWatch) {
    console.log('\nBuild complete. Load dist/ as an unpacked extension in Edge.');
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
