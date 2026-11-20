// Capture the three dossier screenshots with the headless browser on this machine.
//
// The dashboard mirrors its state in the URL hash, so each view is one file URL:
// the board, a protocol's detail drawer, and a filtered view. Chrome's --screenshot
// switch does not produce a file in this build (it exits silently), so this script
// drives the same binary over its DevTools protocol instead: it launches Chrome
// headless with a remote-debugging port, opens each URL in its own target, waits
// for the page to load and settle, and saves Page.captureScreenshot PNGs.
// tools/jpg.py then tunes each one to a JPEG in the 300-350 KB band.
//
// Usage: node tools/capture.mjs [detail-slug] [filter-category]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = join(here, '..');
const chrome = '/opt/meta-chromium/chrome';
const policyPath = '/var/lib/hatch-browser/rootfs-base/usr/share/hatch/chromium/webgl-allowed-domains.txt';
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

const PORT = 9333;
const WIDTH = 1440;
const HEIGHT = 900;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The SHA-256 of the WebGL domain policy this Chromium build requires at startup. */
async function policySha256() {
  const { createHash } = await import('node:crypto');
  const { readFileSync } = await import('node:fs');
  return createHash('sha256').update(readFileSync(policyPath)).digest('hex');
}

/** Wait until Chrome's DevTools HTTP endpoint answers. */
async function waitForChrome() {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('chrome did not open its DevTools port in 30s');
    await sleep(250);
  }
}

/** Open a URL in a fresh target and return its WebSocket debugger URL. */
async function openTarget(url) {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?${new URLSearchParams({ url })}`, { method: 'PUT' });
  if (!res.ok) throw new Error(`chrome refused to open ${url}: HTTP ${res.status}`);
  const target = await res.json();
  if (!target.webSocketDebuggerUrl) throw new Error(`chrome opened ${url} with no debugger URL`);
  return target.webSocketDebuggerUrl;
}

/** One CDP round trip: send a method, wait for its result. */
function cdp(ws, id, method, params = {}) {
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.id !== id) return;
      ws.removeEventListener('message', onMessage);
      if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
      else resolve(msg.result);
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function shoot(wsUrl, url, dest) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  let id = 0;
  await cdp(ws, ++id, 'Page.enable');
  await cdp(ws, ++id, 'Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  await cdp(ws, ++id, 'Page.navigate', { url });
  // Let the page render, the data settle and the detail dialog (if any) open.
  await sleep(2500);
  const shot = await cdp(ws, ++id, 'Page.captureScreenshot', { format: 'png' });
  ws.close();
  writeFileSync(dest, Buffer.from(shot.data, 'base64'));
  if (!existsSync(dest)) throw new Error(`no screenshot written for ${url}`);
  console.log(`capture: ${dest.split('/').pop()} <- ${url}`);
}

const sha = await policySha256();
const child = spawn(
  chrome,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${join(tmpDir, 'chrome-profile')}`,
    `--hatch-webgl-allowed-domains-file=${policyPath}`,
    `--hatch-webgl-allowed-domains-sha256=${sha}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);
try {
  await waitForChrome();
  for (const [name, path] of shots) {
    const url = `file://${path}`;
    const wsUrl = await openTarget(url);
    await shoot(wsUrl, url, join(tmpDir, name));
  }
  console.log('capture: 3 PNGs in .shots/, run tools/jpg.py next');
} finally {
  child.kill('SIGKILL');
  await new Promise((resolve) => child.once('exit', resolve));
}
