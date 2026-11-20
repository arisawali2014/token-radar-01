// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a searchable and filterable table, a
// per-protocol detail view with the model's own inputs and the protocol's farm
// plan (the board's own steps, straight from data.js), and the live-token
// protocols set aside. No network: every byte it shows is already in data.js.
//
// The shell (header, stats, tabs, controls, model panel, footer) is built once;
// only the table region re-renders when the user types, sorts or filters, so the
// search box never loses focus mid-word. State is mirrored in the URL hash
// (#q= #category= #watch= #tab= #sort= #p=) so a board, a filtered view and a
// detail view are each one link.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', watch: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    return (typeof n === 'number' && isFinite(n)) ? 'x' + n.toFixed(2) : 'n/a';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pctClass(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'flat';
    if (n > 0) return 'up';
    if (n < 0) return 'down';
    return 'flat';
  }

  // The watchlist is the snapshot's own list of slugs; the board carries it
  // so the page can badge watchlist rows without a second data source.
  var watchSlugs = {};
  (DATA.watchlist || []).forEach(function (s) { watchSlugs[s] = true; });

  var categories = [];
  DATA.rows.forEach(function (r) {
    var c = r.category || 'Uncategorised';
    if (categories.indexOf(c) < 0) categories.push(c);
  });
  categories.sort();

  function readHash() {
    var h = new URLSearchParams(location.hash.slice(1));
    state.q = h.get('q') || '';
    state.category = h.get('category') || 'all';
    state.watch = h.get('watch') === '1';
    state.tab = h.get('tab') === 'live' ? 'live' : 'pre-token';
    state.sort = h.get('sort') || 'implied';
    state.selected = h.get('p') || null;
  }
  function writeHash() {
    var h = new URLSearchParams();
    if (state.q) h.set('q', state.q);
    if (state.category !== 'all') h.set('category', state.category);
    if (state.watch) h.set('watch', '1');
    if (state.tab === 'live') h.set('tab', 'live');
    if (state.sort !== 'implied') h.set('sort', state.sort);
    if (state.selected) h.set('p', state.selected);
    var s = h.toString();
    history.replaceState(null, '', s ? '#' + s : location.pathname + location.search);
  }

  function rowBySlug(slug) {
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) return DATA.rows[i];
    return null;
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.watch && !watchSlugs[r.slug]) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (q && (r.name + ' ' + r.slug).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort;
    var dir = state.dir;
    function num(a, b) { return (a === null || a === undefined ? -Infinity : a) - (b === null || b === undefined ? -Infinity : b); }
    rows.sort(function (a, b) {
      var d = 0;
      if (key === 'implied') d = num(a.implied_value_usd, b.implied_value_usd);
      else if (key === 'tvl') d = num(a.tvl_usd, b.tvl_usd);
      else if (key === 'growth') d = num(a.change_7d, b.change_7d);
      else if (key === 'age') d = num(a.age_days, b.age_days);
      else d = num(a.rank, b.rank);
      if (d === 0) d = num(a.rank, b.rank);
      return d * dir;
    });
    return rows;
  }

  function sortButton(label, key) {
    var arrow = state.sort === key ? (state.dir === -1 ? ' ↓' : ' ↑') : '';
    return '<button type="button" data-sort="' + key + '">' + esc(label) + arrow + '</button>';
  }

  function renderTable() {
    var region = document.getElementById('table-region');
    if (!region) return;
    if (state.tab === 'live') {
      var live = DATA.live.slice();
      var rows = live.map(function (p) {
        return '<tr><td class="num">' + fmtUsd(p.mcap_usd) + '</td>' +
          '<td><span class="name">' + esc(p.name) + '</span><span class="sub">' + esc(p.slug) + '</span></td>' +
          '<td>' + esc(p.category || 'Uncategorised') + '</td>' +
          '<td>' + esc(p.chains.slice(0, 2).join(', ') || '—') + '</td>' +
          '<td class="num">' + fmtUsd(p.tvl_usd) + '</td>' +
          '<td class="num ' + pctClass(p.change_7d) + '">' + fmtPct(p.change_7d) + '</td></tr>';
      }).join('');
      region.innerHTML =
        '<p class="note">Already trading — shown at the market\u2019s own value, never mixed into the ranked board. ' +
        'The board ranks only protocols that record no token.</p>' +
        '<table class="board"><thead><tr><th>Market cap</th><th>Protocol</th><th>Category</th><th>Chains</th><th>TVL</th><th>7d</th></tr></thead><tbody>' +
        rows + '</tbody></table>';
      return;
    }
    var rows = filteredRows();
    var body = rows.map(function (r) {
      var watch = watchSlugs[r.slug] ? ' <span class="tag watch">watchlist</span>' : '';
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' aria-current="true"' : '') + '>' +
        '<td class="num rank">' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span>' + watch +
        '<span class="sub">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || 'Uncategorised') + '</td>' +
        '<td>' + esc(r.chains.slice(0, 2).join(', ') || '—') + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + pctClass(r.change_7d) + '">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td class="num"><b>' + fmtUsd(r.implied_value_usd) + '</b></td></tr>';
    }).join('');
    region.innerHTML = rows.length === 0
      ? '<p class="empty">No protocol matches this filter. Clear the search or pick another category.</p>'
      : '<table class="board"><thead><tr>' +
        '<th>' + sortButton('Rank', 'rank') + '</th><th>Protocol</th><th>Category</th><th>Chains</th>' +
        '<th>' + sortButton('TVL', 'tvl') + '</th><th>' + sortButton('7d', 'growth') + '</th>' +
        '<th>' + sortButton('Age', 'age') + '</th><th>' + sortButton('Implied value', 'implied') + '</th>' +
        '</tr></thead><tbody>' + body + '</tbody></table>';
    region.querySelectorAll('[data-sort]').forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.getAttribute('data-sort');
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'rank' ? 1 : -1; }
        writeHash();
        renderTable();
      });
    });
    region.querySelectorAll('tr[data-slug]').forEach(function (tr) {
      tr.addEventListener('click', function () {
        state.selected = tr.getAttribute('data-slug');
        writeHash();
        renderTable();
        renderDetail();
      });
    });
    var count = document.getElementById('row-count');
    if (count) count.textContent = rows.length + ' of ' + DATA.rows.length + ' protocols';
  }

  function renderDetail() {
    var region = document.getElementById('detail-region');
    if (!region) return;
    var r = state.selected ? rowBySlug(state.selected) : null;
    if (!r) { region.innerHTML = ''; return; }
    var watch = watchSlugs[r.slug] ? '<span class="tag watch">on the watchlist</span>' : '';
    var steps = (r.farm_steps || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    region.innerHTML =
      '<section class="detail" aria-label="Protocol detail">' +
      '<header><h2>#' + r.rank + ' · ' + esc(r.name) + ' ' + watch + '</h2>' +
      '<button type="button" class="close" id="detail-close">Close ✕</button></header>' +
      '<p class="note">' + esc(r.name) + ' records no token — no market cap, no CoinGecko id, no symbol in the snapshot. ' +
      'That is the record\u2019s claim, not proof it has none. TVL ' + fmtUsd(r.tvl_usd) + ' on ' +
      esc(r.chains.join(', ') || 'its main chain') + '.</p>' +
      '<div class="facts">' +
      '<div class="fact"><span class="num">' + fmtUsd(r.implied_value_usd) + '</span><span class="lbl">implied value</span></div>' +
      '<div class="fact"><span class="num">' + fmtUsd(r.tvl_usd) + '</span><span class="lbl">TVL</span></div>' +
      '<div class="fact"><span class="num ' + pctClass(r.change_7d) + '">' + fmtPct(r.change_7d) + '</span><span class="lbl">TVL change, 7 days</span></div>' +
      '<div class="fact"><span class="num">' + fmtAge(r.age_days) + '</span><span class="lbl">tracked since ' + esc(r.listed_at || 'unknown') + '</span></div>' +
      '<div class="fact"><span class="num">' + fmtMult(r.growth_multiplier) + '</span><span class="lbl">growth multiplier (' + fmtPct(r.growth_pct) + ' clamped)</span></div>' +
      '<div class="fact"><span class="num">' + fmtMult(r.maturity_multiplier) + '</span><span class="lbl">maturity multiplier</span></div>' +
      '<div class="fact"><span class="num">' + esc(r.category || 'Uncategorised') + '</span><span class="lbl">category</span></div>' +
      '<div class="fact"><span class="num">' + esc(r.chains.slice(0, 3).join(', ') || '—') + '</span><span class="lbl">chains</span></div>' +
      '</div>' +
      '<h3>How to farm it</h3><ol class="steps">' + steps + '</ol>' +
      '<p class="note">An implied value is this entry\u2019s own claim from the snapshot\u2019s figures — never a prediction that a token is issued, or when. ' +
      'Farm only with money you can lose, and claim only from links the protocol itself publishes.</p>' +
      '</section>';
    document.getElementById('detail-close').addEventListener('click', function () {
      state.selected = null;
      writeHash();
      renderTable();
      renderDetail();
    });
    region.scrollIntoView({ block: 'nearest' });
  }

  function renderShell() {
    var m = DATA.model;
    var catOptions = ['<option value="all">All categories</option>'].concat(
      categories.map(function (c) {
        return '<option value="' + esc(c) + '"' + (state.category === c ? ' selected' : '') + '>' + esc(c) + '</option>';
      })
    ).join('');
    app.innerHTML =
      '<div class="wrap">' +
      '<header class="hero"><p class="eyebrow">Token Radar · model ' + esc(DATA.model_version) + ' · snapshot ' + esc(DATA.as_of) + '</p>' +
      '<h1>Which pre-token protocol is worth farming next?</h1>' +
      '<p class="lede">Every protocol DefiLlama tracks at $5M+ of TVL, ranked by what its launch would be worth if its record stayed as it is. ' +
      '<b>' + DATA.watchlist_size + ' protocols sit on the watchlist</b> — TVL at or above ' + fmtUsd(DATA.floor_usd) + ' with no token recorded — ' +
      'and the board adds <b>' + DATA.early_size + ' early ones below the floor</b> the radar exists to find. Click any row for its farm plan.</p></header>' +
      '<div class="stats">' +
      '<div class="stat"><div class="num">' + DATA.board_size + '</div><div class="lbl">protocols ranked</div></div>' +
      '<div class="stat"><div class="num">' + DATA.watchlist_size + '</div><div class="lbl">on the watchlist</div></div>' +
      '<div class="stat"><div class="num">' + DATA.early_size + '</div><div class="lbl">early, below the floor</div></div>' +
      '<div class="stat"><div class="num">' + DATA.live_size + '</div><div class="lbl">already trading, set aside</div></div>' +
      '</div>' +
      '<div class="tabs" role="group" aria-label="Board view">' +
      '<button type="button" class="tab" id="tab-pre" aria-pressed="' + (state.tab === 'pre-token') + '">Pre-token board</button>' +
      '<button type="button" class="tab" id="tab-live" aria-pressed="' + (state.tab === 'live') + '">Already trading</button>' +
      '</div>' +
      '<div class="controls">' +
      '<input type="search" id="q" placeholder="Search a protocol…" value="' + esc(state.q) + '" aria-label="Search protocols">' +
      '<select id="category" aria-label="Filter by category">' + catOptions + '</select>' +
      '<label class="check"><input type="checkbox" id="watch" ' + (state.watch ? 'checked' : '') + '> Watchlist only</label>' +
      '<span class="count" id="row-count"></span>' +
      '</div>' +
      '<div id="table-region"></div>' +
      '<div id="detail-region"></div>' +
      '<section class="model" aria-label="How the value is worked out"><h2>How the implied value is worked out</h2>' +
      '<p>Every row follows the same formula from the snapshot\u2019s own figures — TVL, its seven-day change, and how long the protocol has run with no token. ' +
      'No protocol name is special-cased. A reader can re-derive any row from the numbers in its detail view.</p>' +
      '<div class="formula">implied = TVL × ' + m.base_multiple + ' × growth × maturity\n' +
      'growth   = 1 + clamp(change_7d, ' + m.growth_floor + ', +' + m.growth_cap + ') / 100 × ' + m.growth_weight + '   (no 7d change counts as 0)\n' +
      'maturity = ' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' × ' + m.maturity_range + '   (age unknown: ' + m.unknown_age_days + ' days)</div>' +
      '<p>TVL is the size of the prize, seven-day growth is its momentum, and age is how long it has run with no token — the longer the wait, the closer a launch is priced. ' +
      'Protocols whose token already trades are ranked by their market cap instead, in the <b>Already trading</b> tab, and never mixed into this board.</p></section>' +
      '<footer class="foot"><p>Source: ' + esc(DATA.source) + ' · snapshot ' + esc(DATA.as_of) + ' · floor ' + fmtUsd(DATA.floor_usd) + ' · model ' + esc(DATA.model_version) + '.</p>' +
      '<p>Implied values are this entry\u2019s own claims, never make.fun\u2019s, and never a prediction that a token is issued. “Records no token” is what the snapshot\u2019s record says — a protocol on the list may still have a token its record does not carry.</p></footer>' +
      '</div>';

    document.getElementById('q').addEventListener('input', function (e) {
      state.q = e.target.value;
      writeHash();
      renderTable();
    });
    document.getElementById('category').addEventListener('change', function (e) {
      state.category = e.target.value;
      writeHash();
      renderTable();
    });
    document.getElementById('watch').addEventListener('change', function (e) {
      state.watch = e.target.checked;
      writeHash();
      renderTable();
    });
    document.getElementById('tab-pre').addEventListener('click', function () {
      state.tab = 'pre-token';
      writeHash();
      renderShell();
      renderTable();
      renderDetail();
    });
    document.getElementById('tab-live').addEventListener('click', function () {
      state.tab = 'live';
      writeHash();
      renderShell();
      renderTable();
      renderDetail();
    });
  }

  readHash();
  // The watchlist slugs ride in the data as the board's own watchlist array.
  renderShell();
  renderTable();
  renderDetail();
  app.removeAttribute('aria-busy');
  window.addEventListener('hashchange', function () {
    readHash();
    renderShell();
    renderTable();
    renderDetail();
  });
})();
