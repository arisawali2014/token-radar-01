// Local gate check: mirrors the seven rows in the kit's RULES.txt against out/.
// Usage: node tools/check-gates.mjs [out-dir]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from '../vendor/makefun-board.ts';

const out = process.argv[2] ?? join(fileURLToPath(new URL('.', import.meta.url)), '..', 'out');
const repo = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const snap = JSON.parse(readFileSync(join(repo, 'input', 'snapshot.json'), 'utf8'));
const rows = [];
let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`PASS ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

// --- image dimensions without a dependency: PNG IHDR, JPEG SOF ---
function imageSize(buf, name) {
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), kind: 'PNG' };
  }
  if (buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd9 || marker === 0xda) break;
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5), kind: 'JPEG' };
      }
      i += 2 + len;
    }
  }
  throw new Error(`${name}: not a whole PNG or JPEG`);
}

// 1. dashboard_files
{
  const dir = join(out, 'dashboard');
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => !n.startsWith('.')) : [];
  const files = names.filter((n) => statSync(join(dir, n)).isFile());
  const total = files.reduce((n, f) => n + statSync(join(dir, f)).size, 0);
  const badName = files.find((n) => !/^[A-Za-z0-9._-]{1,128}$/.test(n) || n.startsWith('.') || n.startsWith('-'));
  const httpIn = files.find((n) => {
    const text = readFileSync(join(dir, n), 'utf8');
    if (n.endsWith('.html')) return /<(?:[^>]+)(?:href|src|action|poster)\s*=\s*["']https?:/i.test(text) || /<style[^>]*>[^<]*https?:/i.test(text) || /<script[^>]*\ssrc\s*=\s*["']https?:/i.test(text);
    if (n.endsWith('.css')) return /https?:\/\//.test(text);
    if (n.endsWith('.js')) return /(?:import\s|from\s|require\s*\(|import\s*\()\s*["']https?:/.test(text);
    return false;
  });
  check('dashboard_files', files.includes('index.html') && files.some((n) => n.endsWith('.css')) && files.some((n) => n.endsWith('.js')) && files.length <= 400 && total <= 4_194_304 && !badName && !httpIn,
    `${files.length} files, ${total} bytes${httpIn ? `, network address in ${httpIn}` : ''}`);
}

// 2. board_file
let board;
{
  const raw = readFileSync(join(out, 'board.json'));
  board = JSON.parse(raw.toString('utf8')).rows;
  const slugs = new Set(snap.protocols.map((p) => p.slug));
  const seen = new Set();
  const bad = board.find((r) =>
    !slugs.has(r.slug) || seen.has(r.slug) || typeof r.name !== 'string' || !r.name ||
    !Number.isSafeInteger(r.rank) || r.rank <= 0 ||
    !Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14 ||
    !Array.isArray(r.farm_steps) || (seen.add(r.slug), false));
  check('board_file', Array.isArray(board) && board.length >= 100 && board.length <= 4000 && raw.length <= 8_388_608 && !bad,
    `${board.length} rows${bad ? `, first bad row: ${bad.slug}` : ''}`);
}

// 3. sorted_by_value
{
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  const ranksOk = ranks.every((r, i) => r === i + 1);
  const sorted = board.every((r, i) => i === 0 || r.implied_value_usd <= board[i - 1].implied_value_usd);
  const varied = board.length < 2 || board[0].implied_value_usd !== board[board.length - 1].implied_value_usd;
  check('sorted_by_value', ranksOk && sorted && varied, `ranks 1..${board.length}, top ${board[0].implied_value_usd}, bottom ${board[board.length - 1].implied_value_usd}`);
}

// 4. coverage
{
  const have = new Set(board.map((r) => r.slug));
  const missing = snap.watchlist.filter((s) => !have.has(s));
  const extra = board.filter((r) => !snap.watchlist.includes(r.slug)).length;
  check('coverage', missing.length === 0, `${snap.watchlist.length}/${snap.watchlist.length} watchlist, ${extra} early rows`);
}

// 5. farm_steps
{
  const bad = board.find((r) => r.farm_steps.length < 3 || r.farm_steps.length > 12 || r.farm_steps.some((s) => s.trim().length < 20 || s.trim().length > 600));
  const doubled = board.find((r) => r.farm_steps.some((s) => /about about/i.test(s)));
  check('farm_steps', !bad && !doubled, bad ? `bad steps in ${bad.slug}` : doubled ? `doubled word in ${doubled.slug}` : `${board.length} rows x ${board[0].farm_steps.length} steps`);
}

// 6. screenshots
{
  const dir = join(out, 'screenshots');
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => !n.startsWith('.')) : [];
  let detail = '';
  let ok = names.length >= 3 && names.length <= 4;
  for (const n of names) {
    const p = join(dir, n);
    const buf = readFileSync(p);
    if (buf.length > 524_288) { ok = false; detail = `${n} past 512 KiB`; break; }
    try {
      const { w, h, kind } = imageSize(buf, n);
      detail = `${names.length} images, e.g. ${n} ${w}x${h} ${kind} ${buf.length} bytes`;
      if (Math.max(w, h) > 1440 || Math.min(w, h) < 800) { ok = false; detail = `${n} is ${w}x${h}`; break; }
    } catch (e) { ok = false; detail = e.message; break; }
  }
  check('screenshots', ok, detail);
}

// 7. dossier_matches
{
  const built = Buffer.from(buildDossier(out, { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } })).toString('utf8');
  const onDisk = readFileSync(join(out, 'dossier.json'), 'utf8');
  check('dossier_matches', built === onDisk && Buffer.byteLength(onDisk) <= 1_572_864, `dossier.json ${Buffer.byteLength(onDisk)} bytes, rebuild ${built === onDisk ? 'identical' : 'DIFFERS'}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
