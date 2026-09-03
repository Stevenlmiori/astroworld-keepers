const P = DATA.players.map(p => ({ ...p, gap: (p.fp != null && p.ar != null) ? p.fp - p.ar : null,
  // Two views of the same blended projection. Season total reads naturally but only
  // compares within a position; over-replacement is the cross-position version.
  ptsTot: (p.bpts != null ? p.bpts : p.pts),
  ptsPar: p.ownv,
  off: (DATA.teamsOff && DATA.teamsOff[p.nfl]) ? DATA.teamsOff[p.nfl].off : null,
  spr: p.spr,
  yr: p.yr,
  up: p.up, sleeper: p.sleeper, cvorp: p.cvorp, cpts: p.cpts, cjump: p.cjump,
  // untouched copies of what refresh.py shipped, so 'Balanced' is exact
  v0: p.v, ar0: p.ar, edge0: p.edge, vpr0: p.vpr,
  gap0: (p.fp != null && p.ar != null) ? p.fp - p.ar : null,
  pts: (p.bpts != null ? p.bpts : p.pts) }));
const el = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Sleeper injury flags. Preseason "Questionable" is noisy, so it stays quiet; Out
// and IR get the loud treatment.
const INJ = { Questionable: ['q', 'Q'], Doubtful: ['d', 'D'], Out: ['o', 'OUT'],
              IR: ['o', 'IR'], PUP: ['o', 'PUP'], Sus: ['o', 'SUS'] };
const TEAM_OFF = DATA.teamsOff || {};
// How much the team's offense actually predicts THIS position's fantasy finish. Tested on
// 2025 actuals in Astroworld scoring: top-12 QBs came from top-half offenses 11 times in
// 12 with zero from the bottom ten (rank correlation +0.48); WRs moderately (+0.28);
// RBs barely (+0.17 — Achane was RB5 on the #30 offense, Jeanty RB11 on #32); TEs not
// at all (−0.02). So the chip is full strength for a QB, muted for a WR, and greyed out
// for a RB or TE so it cannot mislead at a glance.
const OFF_TRUST = { QB: 'full', WR: 'soft', RB: 'off', TE: 'off' };
const offCell = p => {
  const t = TEAM_OFF[p.nfl];
  if (!t) return '<span class="offchip none">—</span>';
  const trust = OFF_TRUST[normPos(p.p)] || 'off';
  // red (0) -> amber (50) -> green (100); oklch keeps the steps perceptually even
  const hue = 25 + (t.off / 100) * 120;
  const why = trust === 'full' ? 'Strong signal for a QB.'
            : trust === 'soft' ? 'Moderate signal for a WR — target share matters more.'
            : `Weak signal for a ${normPos(p.p)} — volume beats team quality. Shown for context only.`;
  return `<span class="offchip ${trust}" style="--h:${hue}" title="${esc(p.nfl)} offense ${t.off}/100 — #${t.rank} of 32 by the market · implied ${t.wins} wins · ${Math.round(t.pmost * 100)}% to lead the league in scoring, ${Math.round(t.pleast * 100)}% to finish last. ${why}">${esc(p.nfl)}</span>`;
};
// Sleeper: his CEILING is worth far more than a pick at his ADP normally returns.
// Not a prediction — a flag that you are not paying for the good outcome.
const upTag = p => p.sleeper
  ? `<span class="upchip" title="Sleeper — ceiling ≈ ${Math.round(p.cvorp)} value (about ${p.cjump} spots up his own position, ~${Math.round(p.cpts)} pts), which is ${p.up} more than pick ${Math.round(p.adp)} normally returns. Median case is the Value column; this is the upside case.">▲${Math.round(p.up)}</span>`
  : '';
const mktTag = p => p.mkt
  ? `<span class="mkt ${p.mkt[0] < 0 ? 'dn' : 'up'}" title="Vegas: ${p.mkt[0] > 0 ? '+' : ''}${p.mkt[0]} pts vs the projections — ${esc(p.mkt[1])}">$${p.mkt[0] > 0 ? '+' : ''}${p.mkt[0]}</span>`
  : '';
function injTag(p) {
  if (!p.inj) return '';
  const m = INJ[p.inj.s] || ['q', p.inj.s.slice(0, 3).toUpperCase()];
  const t = p.inj.s + (p.inj.b ? ' — ' + p.inj.b : '');
  return ` <span class="inj i-${m[0]}" title="${esc(t)}">${m[1]}</span>`;
}

el('themeBtn').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme');
  const dark = cur ? cur === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
  drawCurve();
});

/* ---------- drafted board, remembered between sessions ---------- */
const KEY = 'astroworld-drafted-2026';
const store = (() => {                       // private browsing can throw on write
  try { localStorage.getItem(KEY); return localStorage; } catch (e) { return null; }
})();
// id -> 'taken' (someone else) | 'mine'.  Tapping a box cycles through the three.
const STATE = new Map((() => {
  try {
    const raw = JSON.parse(store?.getItem(KEY) || '[]');
    // tolerate the older format, which was a flat list of drafted ids
    return Array.isArray(raw) ? raw.map(x => Array.isArray(x) ? x : [x, 'taken']) : [];
  } catch (e) { return []; }
})());
const idOf = p => p.n + '|' + p.p;           // name alone is not unique enough
const stateOf = p => STATE.get(idOf(p));
const NEXT = { undefined: 'taken', taken: 'mine', mine: undefined };

function saveState() {
  try { store?.setItem(KEY, JSON.stringify([...STATE])); } catch (e) { /* full or blocked */ }
  const mine = [...STATE.values()].filter(v => v === 'mine').length;
  const gone = STATE.size;
  el('draftCount').textContent = gone ? `${gone} off the board · ${mine} mine` : '';
  el('clearBtn').style.display = gone ? '' : 'none';
  if (!gone && typeof disarmClear === 'function') disarmClear();
  drawRoster();
}

/* ---------- my roster ---------- */
const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'];
const FLEXOK = { WR: 1, RB: 1, TE: 1 };
const normPos = p => (p === 'DST' ? 'DEF' : p);
function myPlayers() {
  return P.filter(p => stateOf(p) === 'mine').sort((a, b) => b.v - a.v);
}
function fillRoster() {
  const filled = SLOTS.map(s => ({ slot: s, p: null }));
  const left = [];
  for (const pl of myPlayers()) {
    const pos = normPos(pl.p);
    const spot = filled.find(f => f.slot === pos && !f.p);
    if (spot) spot.p = pl; else left.push(pl);
  }
  for (const pl of left.slice()) {            // leftovers try the flex, then the bench
    if (!FLEXOK[normPos(pl.p)]) continue;
    const flex = filled.find(f => f.slot === 'FLEX' && !f.p);
    if (flex) { flex.p = pl; left.splice(left.indexOf(pl), 1); }
  }
  return { filled, bench: left };
}
function drawRoster() {
  const { filled, bench } = fillRoster();
  el('roster').innerHTML = filled.map(f => {
    // an empty slot is tinted by the position it wants; a filled one by who is in it
    const hue = f.p ? f.p.p : (f.slot === 'FLEX' ? '' : f.slot);
    return `<div class="slot ${f.p ? 'on' : ''} ${hue ? 'p-' + hue : ''}">
      <div class="slothead">
        <span class="slotlabel">${f.slot}</span>
        ${f.p ? `<span class="slotmeta">${f.p.p}${f.p.posrk ?? ''}</span>` : ''}
      </div>
      ${f.p ? `<div class="slotname">${esc(f.p.n)}</div>`
            : `<div class="slotempty">open</div>`}
    </div>`;
  }).join('') + (bench.length
    ? `<div class="slot bench on"><div class="slothead">
         <span class="slotlabel">BENCH</span><span class="slotmeta">${bench.length}</span></div>
       <div class="benchlist">${bench.map(b =>
         `<span class="benchchip p-${b.p}">${esc(b.n)}<i>${b.p}${b.posrk ?? ''}</i></span>`).join('')}</div>
       </div>` : '');
  const need = filled.filter(f => !f.p).map(f => f.slot);
  el('rosterNote').innerHTML = need.length
    ? `still need <b>${need.join(' · ')}</b>`
    : (filled.some(f => f.p) ? '<b>starting lineup complete</b>' : 'tap a player twice to add him here');
}

const POSORD = { QB: 0, RB: 1, WR: 2, TE: 3, K: 4, DST: 5, DEF: 5 };
[...new Set(P.map(p => p.p))].sort((a, b) => (POSORD[a] ?? 9) - (POSORD[b] ?? 9))
  .forEach(pos => el('posSel').insertAdjacentHTML('beforeend', `<option value="${esc(pos)}">${esc(pos)}</option>`));
// The W/R/T slot: everyone who can fill it, in one list, so you can compare a WR3 to an RB2 directly.
const FLEX_POS = new Set(['RB', 'WR', 'TE']);
el('posSel').insertAdjacentHTML('beforeend', `<option value="FLEX">Flex (RB / WR / TE)</option>`);

let maxV = Math.max(...P.map(p => p.v), 1);
/* ---------- how much the expert consensus counts ----------
   Value ships as a 50/50 blend of the projections (ownv) and the consensus slot value
   (slotv, already re-priced for 6-point passing TDs by refresh.py). The consensus is
   useful — it carries camp news and depth-chart moves no projection has — but it is
   still an opinion, so the weight is yours. Changing it recomputes Value, Astro # and
   Edge for the whole board. It does NOT change how the simulated opponents draft:
   they read off FantasyPros because that is what the room actually does. */
const W_MODES = [
  { id: 'balanced', w: 0.5,  label: 'Balanced', note: 'half projections, half consensus' },
  { id: 'proj',     w: 0.25, label: 'Projection-led', note: 'consensus counts a quarter' },
  { id: 'pure',     w: 0,    label: 'Projections only', note: 'no expert opinion at all' }
];
let wMode = 'balanced';
try { const st = localStorage.getItem('astroworld-weight');
      if (W_MODES.some(m => m.id === st)) wMode = st; } catch (e) {}

function applyWeights() {
  const m = W_MODES.find(x => x.id === wMode) || W_MODES[0];
  if (m.id === 'balanced') {
    // The shipped numbers are what refresh.py computed at full precision. Restore them
    // rather than recomputing from the rounded slotv/ownv, so the default view can
    // never drift a tenth away from the build.
    for (const p of P) { p.v = p.v0; p.ar = p.ar0; p.edge = p.edge0; p.gap = p.gap0; p.vpr = p.vpr0; }
    paintWeightUI(m); return;
  }
  const w = m.w;
  for (const p of P) {
    p.v = (p.ownv == null || p.slotv == null) ? (p.slotv != null ? p.slotv : (p.ownv || 0))
        : w * p.slotv + (1 - w) * p.ownv;
  }
  // Astro # is just the board re-ranked by Value...
  [...P].sort((a, b) => b.v - a.v).forEach((p, i) => { p.ar = i + 1; });
  // ...and the positional rank has to follow it, or the POS chip shows one ranking
  // while Astro # shows another (RB5/RB6 disagreeing with #11/#12).
  const seenPos = {};
  [...P].sort((a, b) => a.ar - b.ar).forEach(p => {
    seenPos[p.p] = (seenPos[p.p] || 0) + 1; p.vpr = seenPos[p.p];
  });
  // Edge: value minus the best player still on the board after his ADP. Walk the ADP
  // order backwards carrying a running max — same as refresh.py does.
  P.forEach(p => { p.edge = null; });
  const withAdp = P.filter(p => p.adp).sort((a, b) => a.adp - b.adp);
  let bestAfter = 0;
  for (let i = withAdp.length - 1; i >= 0; i--) {
    withAdp[i].edge = Math.round((withAdp[i].v - bestAfter) * 10) / 10;
    bestAfter = Math.max(bestAfter, withAdp[i].v);
  }
  P.forEach(p => { p.gap = (p.fp != null && p.ar != null) ? p.fp - p.ar : null; });
  paintWeightUI(m);
}
function paintWeightUI(m) {
  document.querySelectorAll('.wchip').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.w === wMode)));
  const n = el('wNote');
  if (n) n.textContent = m.note;
}
document.querySelectorAll('.wchip').forEach(b => b.addEventListener('click', () => {
  wMode = b.dataset.w;
  try { localStorage.setItem('astroworld-weight', wMode); } catch (e) {}
  applyWeights(); applyPtsMode(); redrawAfterWeights();
}));

let sleepOnly = false;
let ptsMode = 'total';                 // 'total' = season points | 'par' = above replacement
try { ptsMode = localStorage.getItem('astroworld-ptsmode') === 'par' ? 'par' : 'total'; } catch (e) {}
// Yahoo's board vs FantasyPros'. A big split means the room you are drafting against
// is looking at a different player than the national consensus is.
const yahooCell = p => {
  if (p.yr == null) return '<span class="gap">—</span>';
  const d = p.fp == null ? 0 : p.fp - p.yr;      // + means Yahoo likes him more
  const cls = d >= 15 ? 'up' : d <= -15 ? 'down' : '';
  const t = p.fp == null ? '' :
    (d === 0 ? 'Yahoo and FantasyPros agree'
     : `Yahoo has him ${Math.abs(d)} spots ${d > 0 ? 'higher' : 'lower'} than FantasyPros`);
  return `<span class="gap ${cls}" title="${t}">${p.yr}</span>`;
};
const ptsCell = p => {
  const v = ptsMode === 'par' ? p.ptsPar : p.ptsTot;
  if (v == null) return '—';
  // Tint where the projections and the expert consensus disagree about him.
  const d = p.ownv == null ? 0 : p.ownv - p.v;
  const cls = d >= 3 ? 'up' : d <= -3 ? 'down' : '';
  const other = ptsMode === 'par'
    ? (p.ptsTot == null ? '' : `${Math.round(p.ptsTot)} pts projected`)
    : (p.ptsPar == null ? '' : `+${Math.round(p.ptsPar)} over replacement`);
  const note = d >= 3 ? 'projections above consensus' : d <= -3 ? 'projections below consensus' : '';
  // ESPN and Sleeper do not always see the same player. Where they are far apart the
  // number is a guess between two stories, so flag it rather than hide it.
  const spr = p.spr;
  const shaky = spr != null && spr >= 25;
  const sprNote = spr == null ? '' :
    `ESPN and Sleeper are ${Math.round(spr)} pts apart on him` +
    (shaky ? ' — low confidence, already discounted' : '');
  return `<span class="gap ${cls} ${shaky ? 'shaky' : ''}" title="${[other, note, sprNote].filter(Boolean).join(' · ')}"
    >${Math.round(v)}${shaky ? '<i class="sprdot">±</i>' : ''}</span>`;
};
function applyPtsMode() {
  for (const p of P) p.pts = ptsMode === 'par' ? p.ptsPar : p.ptsTot;
  const th = document.querySelector('#tbl thead th[data-k="pts"]');
  if (th) {
    const arrow = th.querySelector('.ar');
    th.childNodes[0].nodeValue = ptsMode === 'par' ? 'Pts+' : 'Pts';
    if (arrow) th.appendChild(arrow);
    th.title = ptsMode === 'par'
      ? 'Projected Astroworld points ABOVE the last startable player at his position. Same projection as the season total, just measured from a startable baseline — which makes it comparable ACROSS positions. No expert opinion in it.'
      : "Our best estimate of his ACTUAL Astroworld fantasy points for the season — ESPN and Sleeper projections blended, on a 17-game scale, scored with this league's exact rules (full PPR, 6-point passing TDs, -2 INT). No expert opinion in it. Only compare within a position: every QB outscores every RB.";
  }
  const b = el('ptsMode');
  if (b) b.textContent = ptsMode === 'par' ? 'Pts: over replacement' : 'Pts: season total';
}
el('sleepBtn').addEventListener('click', () => {
  sleepOnly = !sleepOnly;
  el('sleepBtn').setAttribute('aria-pressed', String(sleepOnly));
  render(); el('tblwrap').scrollTop = 0;
});
el('ptsMode').addEventListener('click', () => {
  ptsMode = ptsMode === 'par' ? 'total' : 'par';
  try { localStorage.setItem('astroworld-ptsmode', ptsMode); } catch (e) {}
  applyPtsMode(); render();
});
function gapCell(g) {
  if (g == null) return '—';
  const cls = g >= 15 ? 'up' : g <= -15 ? 'down' : '';
  return `<span class="gap ${cls}">${g > 0 ? '+' + g : g}</span>`;
}
function rowHTML(p) {
  const w = Math.min(100, 100 * p.v / maxV);
  const bar = `<span class="mini"><i style="width:${w}%"></i></span>`;
  const id = idOf(p), st = STATE.get(id);
  const pos = `<span class="pos p-${p.p}">${p.p}${p.vpr ?? p.posrk ?? ''}</span>`;
  const label = st === 'mine' ? 'on my team' : st === 'taken' ? 'drafted by someone else' : 'available';
  return `<tr class="${st === 'mine' ? 'mine' : st === 'taken' ? 'drafted' : ''}" data-id="${esc(id)}">
    <td class="chkcol"><button type="button" class="draftbox" data-state="${st || ''}"
      title="${esc(p.n)}: ${label} — click to change"
      aria-label="${esc(p.n)}: ${label}">${st === 'mine' ? '★' : ''}</button></td>
    <td class="scorecell num r">${p.ar ?? '—'}</td>
    <td><span class="pname">${esc(p.n)}</span> <span class="pteam">${esc(p.nfl || '')}</span>${injTag(p)}${upTag(p)}<span class="posinline p-${p.p}">${p.p}${p.vpr ?? p.posrk ?? ''}</span></td>
    <td>${pos}</td>
    <td class="r">${offCell(p)}</td>
    <td class="r num"><span class="vcell"><span class="vnum">${Math.round(p.v)}</span>${bar}<span class="vmkt">${mktTag(p)}</span></span></td>
    <td class="r num">${ptsCell(p)}</td>
    <td class="r num">${p.adp ? p.adp.toFixed(1) : '—'}</td>
    <td class="r num">${p.fp ?? '—'}</td>
    <td class="r num">${yahooCell(p)}</td>
    <td class="r num">${p.edge == null ? '—' : `<span class="gap ${p.edge >= 5 ? 'up' : p.edge <= -12 ? 'down' : ''}">${p.edge > 0 ? '+' + p.edge : p.edge}</span>`}</td>
    <td class="r num">${p.bye || '—'}</td>
  </tr>`;
}

let sortK = 'ar', sortDir = 'asc', posF = '', view = '', q = '';
function render() {
  let rows = P.filter(p =>
    (!posF || (posF === 'FLEX' ? FLEX_POS.has(p.p) : p.p === posF)) &&
    (!sleepOnly || p.sleeper) &&
    (view === '' || (view === 'mine' ? stateOf(p) === 'mine' : !stateOf(p))) &&
    (!q || p.n.toLowerCase().includes(q) || (p.nfl || '').toLowerCase().includes(q)));
  const dir = sortDir === 'desc' ? -1 : 1;
  rows.sort((a, b) => {
    if (sortK === 'p') {
      const key = p => (POSORD[p.p] ?? 9) * 1000 + (p.posrk ?? 999);
      return dir * (key(a) - key(b));
    }
    let x = a[sortK], y = b[sortK];
    if (x == null) x = sortDir === 'desc' ? -1e9 : 1e9;
    if (y == null) y = sortDir === 'desc' ? -1e9 : 1e9;
    if (typeof x === 'string' || typeof y === 'string') return dir * String(x).localeCompare(String(y));
    return dir * (x - y);
  });
  el('tbody').innerHTML = rows.map(rowHTML).join('') ||
    `<tr><td colspan="9" style="text-align:center;padding:32px;color:var(--on-var)">No players match those filters.</td></tr>`;
  el('legend').innerHTML = `<span>${rows.length} shown · value = projected points above the last startable player at that position</span>`;
}
document.querySelectorAll('#tbl thead th').forEach(th => th.addEventListener('click', () => {
  const k = th.dataset.k;
  if (!k) return;                            // the checkbox column is not sortable
  if (sortK === k) sortDir = sortDir === 'desc' ? 'asc' : 'desc';
  else { sortK = k; sortDir = ['n', 'p', 'own', 'ar', 'fp', 'bye', 'adp'].includes(k) ? 'asc' : 'desc'; }
  document.querySelectorAll('#tbl thead th').forEach(o => { o.removeAttribute('data-dir'); const a = o.querySelector('.ar'); if (a) a.textContent = '▼'; });
  th.dataset.dir = sortDir;
  const arw = th.querySelector('.ar'); if (arw) arw.textContent = sortDir === 'desc' ? '▼' : '▲';
  render(); el('tblwrap').scrollTop = 0;
}));
document.querySelectorAll('.fchip[data-view]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.fchip[data-view]').forEach(o => o.setAttribute('aria-pressed', 'false'));
  b.setAttribute('aria-pressed', 'true'); view = b.dataset.view; render(); el('tblwrap').scrollTop = 0;
}));
// Two-step inline confirm rather than confirm(): browsers suppress dialogs in
// embedded and sandboxed contexts, which silently swallowed the clear.
let armed = false, armTimer = null;
function disarmClear() {
  armed = false; clearTimeout(armTimer);
  el('clearBtn').textContent = 'Clear drafted';
  el('clearBtn').classList.remove('armed');
}
el('clearBtn').addEventListener('click', () => {
  if (!STATE.size) return;
  if (!armed) {
    armed = true;
    el('clearBtn').textContent = `Clear all ${STATE.size}? Tap again`;
    el('clearBtn').classList.add('armed');
    clearTimeout(armTimer);
    armTimer = setTimeout(disarmClear, 15000);
    return;
  }
  disarmClear();
  STATE.clear(); saveState(); render();
});
document.addEventListener('click', e => {
  if (armed && !e.target.closest('#clearBtn')) disarmClear();
});
// delegated, so marks survive every re-render from sorting and filtering
el('tbody').addEventListener('click', e => {
  const box = e.target.closest('.draftbox');
  if (!box) return;
  const tr = box.closest('tr'), id = tr.dataset.id;
  const next = NEXT[STATE.get(id)];
  if (next) STATE.set(id, next); else STATE.delete(id);
  box.dataset.state = next || '';
  box.textContent = next === 'mine' ? '★' : '';
  tr.classList.toggle('drafted', next === 'taken');
  tr.classList.toggle('mine', next === 'mine');
  saveState();
  if (view !== '') render();                 // filtered views must drop or gain the row
});
el('posSel').addEventListener('change', e => { posF = e.target.value; render(); el('tblwrap').scrollTop = 0; });
saveState();
el('q').addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); render(); el('tblwrap').scrollTop = 0; });
function redrawAfterWeights() { maxV = Math.max(...P.map(p => p.v), 1); render(); drawMovers(); }
applyWeights();
applyPtsMode();
render();

/* ---------- positional value curves ---------- */
function drawCurve() {
  const C = DATA.curves || {}, POS = ['WR', 'RB', 'TE', 'QB'];
  const HUE = { WR: 262, RB: 152, TE: 22, QB: 205 };
  const W = 520, H = 236, PAD = { l: 44, r: 14, t: 16, b: 30 };
  const cs = getComputedStyle(document.documentElement), c = n => cs.getPropertyValue(n).trim();
  const N = 40, mx = Math.max(...POS.flatMap(p => (C[p] || []).slice(0, N)));
  const x = i => PAD.l + (i / (N - 1)) * (W - PAD.l - PAD.r);
  const y = v => H - PAD.b - (v / mx) * (H - PAD.t - PAD.b);
  const col = p => `oklch(var(--tl) var(--tc) ${HUE[p]})`;
  const lines = POS.map(p => {
    const arr = (C[p] || []).slice(0, N);
    if (!arr.length) return '';
    return `<path d="${arr.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join('')}"
      fill="none" stroke="${col(p)}" stroke-width="2.2" stroke-linecap="round"/>`;
  }).join('');
  const ticks = [1, 8, 16, 24, 32, 40].map(n =>
    `<line x1="${x(n - 1)}" y1="${PAD.t}" x2="${x(n - 1)}" y2="${H - PAD.b}" stroke="${c('--outline-var')}" stroke-width=".5"/>
     <text x="${x(n - 1)}" y="${H - 10}" fill="${c('--on-var')}" font-size="9.5" text-anchor="middle" font-family="Roboto Mono">${n}</text>`).join('');
  const yt = [0, Math.round(mx / 2), Math.round(mx)].map(v =>
    `<text x="${PAD.l - 7}" y="${y(v) + 3.5}" fill="${c('--on-var')}" font-size="9.5" text-anchor="end" font-family="Roboto Mono">${v}</text>`).join('');
  const R = DATA.replacement || {};
  el('curve').innerHTML =
    `<div class="clegend">${POS.map(p => `<span><i style="background:${col(p)}"></i>${p}<b>${R[p] ? ' · repl ' + R[p] : ''}</b></span>`).join('')}</div>
     <svg viewBox="0 0 ${W} ${H}" width="100%" role="img"
       aria-label="Projected points above replacement by rank within each position">
       ${ticks}${yt}
       <text x="${x(N - 1)}" y="${PAD.t + 8}" fill="${c('--on-var')}" font-size="9.5" text-anchor="end" font-family="Roboto">rank at position →</text>
       ${lines}
     </svg>`;
}
drawCurve();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', drawCurve);

/* ---------- biggest disagreements ---------- */
const li = p => `<li><span class="pos p-${p.p}">${p.p}${p.vpr ?? p.posrk ?? ''}</span><span class="nm">${esc(p.n)}
  <span class="sm">· ${esc(p.nfl || '')}</span></span>
  <span class="sm num">FP ${p.fp} → ${p.ar}</span>${gapCell(p.gap)}</li>`;
function drawMovers() {
  const ranked = P.filter(p => p.gap != null && p.v > 0);
  el('upList').innerHTML = ranked.slice().sort((a, b) => b.gap - a.gap).slice(0, 10).map(li).join('');
  el('downList').innerHTML = ranked.slice().sort((a, b) => a.gap - b.gap).slice(0, 10).map(li).join('');
}
drawMovers();

el('upd').textContent = 'updated ' + DATA.updated;
if (DATA.built) { el('built').textContent = DATA.built;
  const st = el('stamp'); if (st) st.textContent = DATA.built + (DATA.updated ? ` · FantasyPros consensus ${DATA.updated}` : ''); }
el('nexp').textContent = DATA.experts;
