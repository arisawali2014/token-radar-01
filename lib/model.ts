// Token Radar's model (radar-2): one sealed snapshot in, one ranked board out.
//
// The board ranks every genuine pre-token protocol the snapshot carries: the 40
// on the watchlist (the floor, never the ceiling) plus every other rankable
// protocol below it. A protocol is rankable when its record carries no token at
// all (no market cap, no CoinGecko id, no symbol) and it is not a wrapped,
// staked or bridged product of a token that already trades, not an exchange,
// and not a versioned pool of another protocol. Protocols whose token already
// trades are kept apart in the live view, shown with the market's own value,
// never mixed into the ranking.
//
// Implied value follows only from the snapshot's own figures:
//
//   growth     = clamp(change_7d, -50, 150) per cent; unknown growth counts as 0
//   growthMult = 1 + (growth / 100) x 0.6
//   maturity   = 0.70 + min(age_days, 1460) / 1460 x 0.50   (age unknown: 365 days)
//   breadth    = 1 + 0.03 x min(chains, 5)
//   implied    = max(1, round(tvl_usd x 0.25 x growthMult x maturity x breadth))
//
// TVL is the size of the prize, seven-day growth is its momentum, age is how
// long it has run with no token (the longer the wait, the closer a launch), and
// chain breadth is how much surface a farmer has to work with. No protocol name
// is ever special-cased: the same function scores every row, and the dashboard
// shows each row's own multipliers so the page and board.json can be checked
// against each other.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.7,
  maturity_range: 0.5,
  maturity_days: 1460,
  unknown_age_days: 365,
  breadth_per_chain: 0.03,
  breadth_max_chains: 5,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, farm plan included so the page never re-derives it. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  watchlist: boolean;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_implied_usd: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export interface ImpliedBreakdown {
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  age: number | null;
}

/** The four multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): ImpliedBreakdown {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + model.breadth_per_chain * Math.min(protocol.chains.length, model.breadth_max_chains);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * model.base_multiple * growthMult * maturityMult * breadthMult));
  return { implied, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word wrapped, staked or staking anywhere in the name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** A name that begins with an exchange's name. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
/** Categories that are a wrapped, staked or bridged product of a token that already trades. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped,
 * staked or bridged product, not an exchange, and not a versioned pool. The
 * watchlist rule, minus the TVL floor.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The snapshot's protocols by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, whatever else the board adds.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, at any TVL. The
  // floor is never the whole board, and a small protocol growing fast can
  // outrank a large quiet one.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => ({ p, ...impliedValue(p, snapshot.as_of, model) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const watchlist = new Set(snapshot.watchlist);
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    watchlist: watchlist.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  return 100;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 45;
}

/** What one transaction costs on the protocol's main chain, as a farmer would feel it. */
function gasFor(chain: string): string {
  if (chain === 'Ethereum') return 'about $8 of gas';
  if (chain === 'Solana') return 'under $0.10 of gas';
  if (chain === 'Bitcoin') return 'about $3 of gas';
  return 'about $1 of gas';
}

/**
 * One category's pair of qualifying actions. `core` is the main deposit, `second`
 * a different touchpoint so the wallet shows more than one kind of activity, and
 * `repeat` is the weekly cadence that keeps the wallet active across snapshots.
 * The table is matched on the category's lowercase words; the fallback row at
 * the end covers every category the table does not name.
 */
interface CategoryActions {
  match: string[];
  core: (name: string, capital: number, chain: string) => string;
  second: (name: string, small: number, chain: string) => string;
  repeat: (name: string, small: number, chain: string) => string;
}

const CATEGORY_ACTIONS: CategoryActions[] = [
  {
    match: ['lend', 'cdp', 'collateral'],
    core: (n, c, ch) => `Supply $${c} of USDC to ${n} on ${ch} and keep the position open.`,
    second: (n, s) => `Borrow $${s} against the supply and repay it inside the same week, so the loan leaves a trace without interest piling up.`,
    repeat: () => `Each week, top up the supply a little or run one borrow-and-repay cycle, so the wallet shows steady lending activity.`,
  },
  {
    match: ['dex', 'yield', 'leveraged farm'],
    core: (n, c, ch) => `Provide $${c} of liquidity to ${n}'s main pool on ${ch} and keep the position open.`,
    second: (n, s) => `Swap $${s} through ${n}'s own pool, so the wallet shows trading volume as well as liquidity.`,
    repeat: (n, s) => `Each week, swap a small amount through ${n}'s pool or add a little more liquidity, so the wallet shows steady trading and LP activity.`,
  },
  {
    match: ['bridge'],
    core: (n, c, ch) => `Bridge $${c} of USDC to ${ch} through ${n} and use the bridged funds in its app.`,
    second: (n, s) => `Bridge $${s} back the other way a week later, so the wallet has volume in both directions.`,
    repeat: (n, s) => `Each week, bridge a small amount through ${n} in one direction, alternating the direction, so the wallet shows steady bridging volume.`,
  },
  {
    match: ['staking', 'restak'],
    core: (n, c) => `Stake $${c} of the chain's staking asset through ${n} and keep the receipt token.`,
    second: (n, s) => `Stake a second, smaller amount of $${s} a week later, so the wallet shows repeat staking rather than one deposit.`,
    repeat: (n, s) => `Each week, stake a small extra amount through ${n} or claim and restake the rewards, so the wallet shows steady staking activity.`,
  },
  {
    match: ['perpetual', 'derivative'],
    core: (n, c, ch) => `Deposit $${c} of USDC as margin on ${n} and open one small hedge, no more than a tenth of the deposit.`,
    second: (n, s) => `Close the first hedge after a few days and open a fresh one the next week, keeping each trade small.`,
    repeat: (n, s) => `Each week, open and close one small hedge on ${n}, keeping each trade a fraction of the deposit, so the wallet shows steady trading.`,
  },
  {
    match: ['prediction'],
    core: (n, c) => `Fund $${c} and place one market position on ${n}, on an outcome you have read about first.`,
    second: (n, s) => `Settle the first market and place a second $${s} position on a different outcome.`,
    repeat: (n, s) => `Each week, settle one market on ${n} and place one small position on a new outcome, so the wallet shows steady market activity.`,
  },
  {
    match: ['curator', 'allocator'],
    core: (n, c, ch) => `Deposit $${c} into a ${n} vault on ${ch} and keep the vault shares.`,
    second: (n, s) => `Deposit a second tranche of $${s} into a different ${n} vault, so the wallet touches more than one vault.`,
    repeat: (n, s) => `Each week, add a small tranche to a ${n} vault or move a little between vaults, so the wallet shows steady vault activity.`,
  },
  {
    match: ['stable'],
    core: (n, c, ch) => `Mint or deposit $${c} of the stable asset through ${n} on ${ch} and hold it.`,
    second: (n, s) => `Swap half of the minted stable asset for USDC and back, so the wallet shows use of the stable asset.`,
    repeat: (n, s) => `Each week, mint a small amount of the stable asset through ${n} or swap a little of it, so the wallet shows steady use of the stable asset.`,
  },
  {
    match: ['rwa'],
    core: (n, c, ch) => `Mint $${c} of the protocol's yield-bearing asset on ${ch} and hold it.`,
    second: () => `Claim or compound the yield the position earns, and record the claim in the farm log.`,
    repeat: () => `Each week, claim or compound the yield the position earns, so the wallet shows steady yield activity.`,
  },
  {
    match: ['insurance'],
    core: (n, c, ch) => `Buy $${c} of cover from ${n} on ${ch} and keep the policy active.`,
    second: (n, s) => `Top up the cover by $${s} or renew it before it lapses, so the policy stays continuous.`,
    repeat: () => `Each week, check the cover stays active and top it up before it lapses, so the policy never goes quiet.`,
  },
  {
    match: ['basis'],
    core: (n, c, ch) => `Deposit $${c} of USDC into ${n}'s basis vault on ${ch} and keep the position open.`,
    second: (n, s) => `Add a second deposit of $${s} after the first funding round settles.`,
    repeat: (n, s) => `Each week, add a small deposit to ${n}'s basis vault after the funding round settles, so the wallet shows steady vault activity.`,
  },
];

/** The category's actions, or the generic deposit pair when nothing matches. */
function actionsFor(p: SnapshotProtocol): CategoryActions {
  const c = (p.category ?? '').toLowerCase();
  for (const row of CATEGORY_ACTIONS) {
    if (row.match.some((m) => c.includes(m))) return row;
  }
  return {
    match: [],
    core: (n, cap, ch) => `Deposit $${cap} of USDC into ${n} on ${ch} and keep the position open.`,
    second: (n, s) => `Make a second deposit of $${s} a week later, so the wallet shows repeat activity instead of one deposit.`,
    repeat: () => `Each week, repeat one qualifying action, a deposit, a borrow, a swap or a vote, so the wallet stays active across snapshots instead of going quiet.`,
  };
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const small = Math.max(25, Math.round(capital / 4));
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const actions = actionsFor(p);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline, never in a screenshot or a chat.`,
      cost: 'nothing to set up, under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actions.core(p.name, capital, chain),
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: actions.second(p.name, small, chain),
      cost: gas,
      time: '10 minutes',
    },
    {
      text: actions.repeat(p.name, small, chain),
      cost: `${gas} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot window.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; a claim link from a chat or a search ad is a scam until proven otherwise.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction hash in a farm log, and unwind in two steps when you exit so one bad transaction cannot trap the whole position.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, farm plan included. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_pct: row.model.growth_pct,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    watchlist: row.watchlist,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    total_implied_usd: board.reduce((n, r) => n + r.implied_value_usd, 0),
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
