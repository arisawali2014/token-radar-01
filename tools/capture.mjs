// Capture the three dossier screenshots with the headless browser on this machine.
// The dashboard mirrors its state in the URL hash, so each view is one file URL:
// the board, a protocol's detail drawer, and a filtered view. Chrome writes PNGs;
// tools/jpg.py then tunes each one to a JPEG in the 300-350 KB band.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = join(here, '..');
const chrome = '/opt/meta-chromium/chrome';
const outDir = join(repo, 'out', 'dashboard');
const tmpDir = join(repo, '.shots');
mkdirSync(tmpDir, { recursive: true });

const top = process.argv[2] ?? 'steakhouse-financial';
const filter = process.argv[3] ?? 'Lending';

const shots = [
  ['1-board.png', `${outDir}/index.html`],
  ['2-detail.png', `${outDir}/index.html#p=${top}`],
  ['3-filtered.png', `${outDir}/index.html#category=${filter}`],
];

for (const [name, url] of shots) {
  const dest = join(tmpDir, name);
  execFileSync(
    chrome,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--window-size=1440,900',
      '--virtual-time-budget=8000',
      `--screenshot=${dest}`,
      `file://${url}`,
    ],
    { stdio: 'inherit' },
  );
  if (!existsSync(dest)) throw new Error(`chrome wrote no screenshot for ${name}`);
  console.log(`capture: ${name} <- ${url}`);
}
console.log('capture: 3 PNGs in .shots/, run tools/jpg.py next');
