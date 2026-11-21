// Local gate check: mirrors the seven rows in the kit's RULES.txt against out/.
// Usage: node tools/check-gates.mjs [out-dir]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from '../vendor/makefun-board.ts';

const out = process.argv[2] ?? join(fileURLToPath(new URL('.', import.meta.url)), '..', 'out');
const repo = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const snap = JSON.parse(readFileSync(join(repo, 'input', 'snapshot.json'), 'utf8'));
let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`PASS ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    fail++;
    console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`);
  }
}

// --- image dimensions without a dependency: PNG IHDR, JPEG SOF ---
function imageSize(buf, name) {
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), kind: 'PNG' };
  }
  if (buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
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
  const totalBytes = files.reduce((s, n) => s + statSync(join(dir, n)).size, 0);
  const hasHtml = files.includes('index.html');
  const hasCss = files.some((n) => n.endsWith('.css'));
  const hasJs = files.some((n) => n.endsWith('.js'));
  let offender = null;
  for (const n of files) {
    const text = readFileSync(join(dir, n), 'utf8');
    if (/\b(?:src|href)\s*=\s*["']https?:\/\//i.test(text) || /(?:import|from|require)\s*\(?\s*["']https?:\/\//.test(text) || /https?:\/\//.test(text) && n.endsWith('.css')) {
      offender = n;
      break;
    }
    if (n.endsWith('.css') && /url\(\s*["']?https?:\/\//.test(text)) {
      offender = n;
      break;
    }
  }
  check(
    'dashboard_files',
    hasHtml && hasCss && hasJs && files.length <= 400 && totalBytes <= 4 * 1024 * 1024 && !offender,
    `${files.length} files, ${totalBytes} bytes${offender ? `, network address in ${offender}` : ''}`,
  );
}

// 2. board_file
let board = null;
{
  const raw = readFileSync(join(out, 'board.json'), 'utf8');
  const parsed = JSON.parse(raw);
  const rows = Array.isArray(parsed) ? parsed : parsed.rows;
  board = rows;
  const slugs = new Set(snap.protocols.map((p) => p.slug));
  const bad = rows.filter(
    (r) =>
      typeof r.slug !== 'string' ||
      !slugs.has(r.slug) ||
      typeof r.name !== 'string' ||
      !r.name ||
      !Number.isSafeInteger(r.rank) ||
      r.rank <= 0 ||
      !Number.isSafeInteger(r.implied_value_usd) ||
      r.implied_value_usd <= 0 ||
      r.implied_value_usd > 1e14 ||
      !Array.isArray(r.farm_steps),
  );
  const allEqual = rows.length >= 2 && rows.every((r) => r.implied_value_usd === rows[0].implied_value_usd);
  check(
    'board_file',
    rows.length >= 100 && rows.length <= 4000 && Buffer.byteLength(raw, 'utf8') <= 8 * 1024 * 1024 && bad.length === 0 && !allEqual,
    `${rows.length} rows${bad.length ? `, bad rows: ${bad.slice(0, 3).map((r) => r.slug).join(', ')}` : ''}`,
  );
}

// 3. sorted_by_value
{
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  const ranksOk = ranks.every((r, i) => r === i + 1);
  const orderOk = board.every((r, i) => i === 0 || r.implied_value_usd <= board[i - 1].implied_value_usd);
  check('sorted_by_value', ranksOk && orderOk, `${board.length} rows, ranks 1..${board.length}`);
}

// 4. coverage
{
  const have = new Set(board.map((r) => r.slug));
  const missing = snap.watchlist.filter((s) => !have.has(s));
  const nonWatch = board.filter((r) => !snap.watchlist.includes(r.slug)).length;
  check('coverage', missing.length === 0 && nonWatch >= 60, `${snap.watchlist.length}/${snap.watchlist.length} watchlist, ${nonWatch} non-watchlist rows`);
}

// 5. farm_steps
{
  const bad = board.filter((r) => {
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) return true;
    return r.farm_steps.some((s) => typeof s !== 'string' || s.trim().length < 20 || s.trim().length > 600);
  });
  check('farm_steps', bad.length === 0, bad.length ? `bad rows: ${bad.slice(0, 3).map((r) => r.slug).join(', ')}` : `${board.length} rows, 6 steps each`);
}

// 6. screenshots
{
  const dir = join(out, 'screenshots');
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => !n.startsWith('.')) : [];
  let ok = names.length >= 3 && names.length <= 4;
  const detail = [];
  for (const n of names) {
    const buf = readFileSync(join(dir, n));
    const { w, h, kind } = imageSize(buf, n);
    const sizeOk = buf.length <= 512 * 1024 && Math.max(w, h) <= 1440 && Math.min(w, h) >= 800;
    if (!sizeOk) ok = false;
    detail.push(`${n} ${kind} ${w}x${h} ${Math.round(buf.length / 1024)}KB`);
  }
  check('screenshots', ok, detail.join('; '));
}

// 7. dossier_matches
{
  const raw = readFileSync(join(out, 'dossier.json'));
  let rebuilt = null;
  let err = null;
  try {
    rebuilt = buildDossier(out, { text_max_bytes: 65536, screenshots: { max: 4, max_bytes: 524288 }, dashboard: { max_files: 400, max_bytes: 4194304 } });
  } catch (e) {
    err = e.message;
  }
  const same = rebuilt !== null && Buffer.compare(raw, Buffer.from(rebuilt)) === 0;
  check('dossier_matches', same && raw.length <= 1.5 * 1024 * 1024, err ?? `${raw.length} bytes${same ? ', byte-identical' : ', DIFFERS from rebuild'}`);
}

console.log(`gates: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
