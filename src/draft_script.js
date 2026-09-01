const P = DATA.players.map(p => ({ ...p, gap: (p.fp != null && p.ar != null) ? p.fp - p.ar : null,
  // Two views of the same blended projection. Season total reads naturally but only
  // compares within a position; over-replacement is the cross-position version.
  ptsTot: (p.bpts != null ? p.bpts : p.pts),
  ptsPar: p.ownv,
  off: (DATA.teamsOff && DATA.teamsOff[p.nfl]) ? DATA.teamsOff[p.nfl].off : null,
  // untouched copies of what refresh.py shipped, so 'Balanced' is exact
  v0: p.v, ar0: p.ar, edge0: p.edge,
  gap0: (p.fp != null && p.ar != null) ? p.fp - p.ar : null,
  pts: (p.bpts != null ? p.bpts : p.pts) }));
const BY_NAME = new Map(P.map(p => [p.n, p]));
let MY = DATA.myTeam;   // replaced from storage once it is available
let ORDER = DATA.order, SLOT = DATA.slot;
// Columns run in DRAFT order, not alphabetically — round 1 must read 1..12 left to
// right, which also makes the reverse snake legible in the rounds below it.
let TEAMS = ORDER.slice(0, DATA.teamCount || 12);
let ROUNDS = DATA.rounds || 15, NPICKS = ORDER.length;
const el = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Sleeper injury flags. Preseason "Questionable" is noisy, so it stays quiet; Out
// and IR get the loud treatment.
const INJ = { Questionable: ['q', 'Q'], Doubtful: ['d', 'D'], Out: ['o', 'OUT'],
              IR: ['o', 'IR'], PUP: ['o', 'PUP'], Sus: ['o', 'SUS'] };
const TEAM_OFF = DATA.teamsOff || {};
const offCell = p => {
  const t = TEAM_OFF[p.nfl];
  if (!t) return '<span class="offchip none">—</span>';
  // red (0) -> amber (50) -> green (100); oklch keeps the steps perceptually even
  const hue = 25 + (t.off / 100) * 120;
  return `<span class="offchip" style="--h:${hue}" title="${esc(p.nfl)} offense ${t.off}/100 — #${t.rank} of 32 by the market · implied ${t.wins} wins · ${Math.round(t.pmost * 100)}% to lead the league in scoring, ${Math.round(t.pleast * 100)}% to finish last">${esc(p.nfl)}</span>`;
};
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
});

/* ---------- persistence: keepers and picks are separate on purpose ---------- */
const store = (() => { try { localStorage.getItem('x'); return localStorage; } catch (e) { return null; } })();
const load = (k, d) => { try { return JSON.parse(store?.getItem(k) || d); } catch (e) { return JSON.parse(d); } };
const save = (k, v) => { try { store?.setItem(k, JSON.stringify(v)); } catch (e) { /* blocked or full */ } };
const K_KEY = 'astroworld-keepers-2026', P_KEY = 'astroworld-picks-2026';
const ME_KEY = 'astroworld-me-2026', CFG_KEY = 'astroworld-league-2026';

/* ---------- league configuration ---------- */
// Astroworld mode is the real league. Custom mode throws all of that away and lets
// anyone drive the same engine with their own teams, size and snake rules.
const ROSTER_POS = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'];
const DEF_ROSTER = { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, K: 1, DEF: 1 };
const DEF_CFG = { mode: 'astroworld', teams: 12, rounds: 15, snake: 'third', names: [],
                  roster: Object.assign({}, DEF_ROSTER) };
const rosterCfg = () => Object.assign({}, DEF_ROSTER, CFG.roster || {});
function slotsFromRoster(r) {
  const out = [];
  ROSTER_POS.forEach(p => { for (let i = 0; i < (r[p] || 0); i++) out.push(p); });
  return out;
}
let CFG = Object.assign({}, DEF_CFG, load(CFG_KEY, '{}'));
const saveCfg = () => save(CFG_KEY, CFG);
function customNames() {
  const out = [];
  for (let i = 0; i < CFG.teams; i++) out.push((CFG.names && CFG.names[i]) || `Team ${i + 1}`);
  return out;
}
// forward = 1..n, reverse = n..1. The third-round-reverse variant runs forward,
// reverse, reverse, then alternates from round four on.
function roundForward(rd, snake) {
  if (snake === 'none') return true;
  if (snake === 'snake') return rd % 2 === 1;
  if (rd === 1) return true;
  if (rd === 2 || rd === 3) return false;
  return rd % 2 === 0;
}
function applyConfig() {
  if (CFG.mode === 'astroworld') {
    ORDER = DATA.order; SLOT = DATA.slot;
    TEAMS = ORDER.slice(0, DATA.teamCount || 12);
    ROUNDS = DATA.rounds || 15;
  } else {
    const names = customNames(), n = CFG.teams;
    ORDER = []; SLOT = {}; names.forEach(t => SLOT[t] = {});
    for (let rd = 1; rd <= CFG.rounds; rd++) {
      const seq = roundForward(rd, CFG.snake) ? names : names.slice().reverse();
      seq.forEach((t, i) => { ORDER.push(t); SLOT[t][rd] = (rd - 1) * n + i + 1; });
    }
    TEAMS = names; ROUNDS = CFG.rounds;
  }
  SLOTS = CFG.mode === 'custom' ? slotsFromRoster(rosterCfg())
                                : ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'];
  NPICKS = ORDER.length;
  if (!TEAMS.includes(MY)) { MY = TEAMS[0]; save(ME_KEY, MY); }
  for (const t of [...KEEPERS.keys()]) if (!TEAMS.includes(t)) KEEPERS.delete(t);
}
const KEEPERS = new Map(load(K_KEY, '[]'));      // team -> player name
const PICKS   = new Map(load(P_KEY, '[]'));      // overall pick (number) -> player name
const saveKeepers = () => save(K_KEY, [...KEEPERS]);
{ const saved = load(ME_KEY, 'null'); if (saved) MY = saved; }
const savePicks   = () => save(P_KEY, [...PICKS].map(([k, v]) => [Number(k), v]));

/* ---------- derived draft state ---------- */
// A keeper occupies the exact pick his cost round gives that team.
function keeperPick(team) {
  const entry = KEEPERS.get(team);
  if (!entry) return null;
  if (CFG.mode === 'astroworld') {
    const row = (DATA.teams[team] || []).find(c => c.n === keeperName(team));
    return row ? row.cp : null;
  }
  const rd = Math.min(Math.max(Number(entry.rd) || ROUNDS, 1), ROUNDS);
  return (SLOT[team] || {})[rd] || null;
}
// Astroworld stores a bare name; custom stores {n, rd}. Read both.
const keeperName = t => { const e = KEEPERS.get(t); return e && typeof e === 'object' ? e.n : e; };
function keeperAtPick() {
  const m = new Map();
  for (const t of TEAMS) { const p = keeperPick(t); if (p) m.set(p, keeperName(t)); }
  return m;
}
let KAT = keeperAtPick();
const playerAtPick = n => KAT.get(n) || PICKS.get(n) || null;
function refreshDerived() {
  KAT = keeperAtPick();
  // a keeper's pick is spoken for; drop any manual pick that collides with it
  for (const [pick] of PICKS) if (KAT.has(Number(pick))) PICKS.delete(pick);
}
const takenNames = () => new Set([...KAT.values(), ...PICKS.values()]);
function currentPick() {
  for (let n = 1; n <= NPICKS; n++) if (!playerAtPick(n)) return n;
  return null;
}
const roundOf = n => Math.floor((n - 1) / 12) + 1;
function nextMyPick(from) {
  for (let n = from; n <= NPICKS; n++) if (ORDER[n - 1] === MY && !playerAtPick(n)) return n;
  return null;
}

/* ---------- on the clock ---------- */
function drawClock() {
  const cur = currentPick();
  if (!cur) {
    el('clockNow').innerHTML = `<span class="lbl">Draft complete</span><b>All ${NPICKS} picks in</b>`;
    el('clockNext').textContent = '';
  } else {
    const team = ORDER[cur - 1];
    el('clockNow').innerHTML =
      `<span class="lbl">Round ${roundOf(cur)} &middot; Pick ${cur}</span><b>${esc(team)}</b>` +
      (team === MY ? ` <span class="youre">you</span>` : '');
    const mine = nextMyPick(cur);
    el('clockNext').innerHTML = mine
      ? (mine === cur ? `<b>You are on the clock</b>`
                      : `Your next pick <b>#${mine}</b> &middot; ${mine - cur} away`)
      : `No picks left`;
  }
  document.querySelectorAll('#sim1,#simMine,#simRest').forEach(b => b.disabled = !cur);
}
let mePickerBound = false;
function drawMePicker() {
  const s = el('meSel');
  s.innerHTML = TEAMS.map((t, i) => `<option value="${esc(t)}">${i + 1}. ${esc(t)}</option>`).join('');
  if (!mePickerBound) {
    mePickerBound = true;
    s.addEventListener('change', e => { MY = e.target.value; save(ME_KEY, MY); renderAll(); });
  }
  s.value = MY;
}

/* ---------- keepers block ---------- */
const ALLPLAYERS = P.slice().sort((a, b) => a.ar - b.ar);
el('playerList').innerHTML = ALLPLAYERS.map(o =>
  `<option value="${esc(o.n)}">${o.p}${o.vpr ?? ''} · ${esc(o.nfl || '')}</option>`).join('');
function drawKeepers() {
  const custom = CFG.mode === 'custom';
  el('kgrid').innerHTML = TEAMS.map(t => {
    const sel = keeperName(t) || '';
    if (!custom) {
      const opts = DATA.teams[t] || [];
      return `<label class="kslot ${t === MY ? 'isme' : ''} ${sel ? 'set' : ''}">
        <span class="klabel">${esc(t)}${t === MY ? ' · you' : ''}</span>
        <span class="sel"><select data-team="${esc(t)}">
          <option value="">— none —</option>
          ${opts.map(o => `<option value="${esc(o.n)}" ${o.n === sel ? 'selected' : ''}>${esc(o.n)} · ${o.p}${o.posrk ?? ''} · rd ${o.cr} (${o.s})</option>`).join('')}
        </select></span>
      </label>`;
    }
    const e = KEEPERS.get(t), rd = (e && e.rd) || ROUNDS;
    return `<label class="kslot ${t === MY ? 'isme' : ''} ${sel ? 'set' : ''}">
      <span class="klabel">${esc(t)}${t === MY ? ' · you' : ''}</span>
      <span class="kcustom">
        <input class="kfind" list="playerList" data-team="${esc(t)}" data-role="who"
          value="${esc(sel)}" placeholder="Type a player…" autocomplete="off"
          aria-label="Keeper for ${esc(t)}">
        <span class="sel krd"><select data-team="${esc(t)}" data-role="rd" ${sel ? '' : 'disabled'}>
          ${Array.from({ length: ROUNDS }, (_, i) => i + 1).map(r => `<option value="${r}" ${r === Number(rd) ? 'selected' : ''}>rd ${r}</option>`).join('')}
        </select></span>
      </span>
    </label>`;
  }).join('');
  el('kModel').hidden = custom;
  const n = TEAMS.filter(t => keeperName(t)).length;
  el('kCount').textContent = n ? `${n} of ${TEAMS.length} set` : 'none set';
  el('kblock').classList.toggle('haskeepers', n > 0);
}
el('kgrid').addEventListener('change', e => {
  const t = e.target.dataset.team; if (!t) return;
  if (CFG.mode === 'astroworld') {
    if (e.target.value) KEEPERS.set(t, e.target.value); else KEEPERS.delete(t);
  } else if (e.target.dataset.role === 'who') {
    const v = e.target.value.trim();
    if (!v) KEEPERS.delete(t);
    else if (BY_NAME.has(v)) {
      const prev = KEEPERS.get(t);
      KEEPERS.set(t, { n: v, rd: (prev && prev.rd) || ROUNDS });
    } else { e.target.value = keeperName(t) || ''; return; }   // unknown name: put it back
  } else {
    const cur = KEEPERS.get(t);
    if (cur) KEEPERS.set(t, { n: cur.n, rd: Number(e.target.value) });
  }
  saveKeepers(); refreshDerived(); renderAll();
});
el('kModel').addEventListener('click', () => {
  if (CFG.mode !== 'astroworld') return;   // no model opinion about someone else's league
  for (const [t, n] of Object.entries(DATA.modelPicks || {})) KEEPERS.set(t, n);
  saveKeepers(); refreshDerived(); savePicks(); renderAll();
});
armTwoStep('kClear', 'Clear keepers', () => KEEPERS.size,
  () => { KEEPERS.clear(); saveKeepers(); refreshDerived(); savePicks(); renderAll(); });

/* two-step confirm: dialogs get suppressed in embedded browsers, so never use confirm() */
function armTwoStep(id, label, count, run, armLabel) {
  let armed = false, timer = null;
  const b = el(id);
  const say = armLabel || (n => `Clear ${n}? Tap again`);
  const disarm = () => { armed = false; clearTimeout(timer); b.textContent = label; b.classList.remove('armed'); };
  b.addEventListener('click', ev => {
    ev.stopPropagation();
    if (!count()) return;
    if (!armed) {
      armed = true; b.textContent = say(count()); b.classList.add('armed');
      clearTimeout(timer); timer = setTimeout(disarm, 15000); return;
    }
    disarm(); run();
  });
  document.addEventListener('click', e => { if (armed && !e.target.closest('#' + id)) disarm(); });
  return disarm;
}

/* ---------- picks ---------- */
function draftPlayer(name) {
  const cur = currentPick();
  if (!cur) return;
  PICKS.set(cur, name); savePicks(); renderAll();
}
function undoPick(n) {
  if (n == null) { const keys = [...PICKS.keys()].map(Number); if (!keys.length) return; n = Math.max(...keys); }
  PICKS.delete(n); PICKS.delete(String(n)); savePicks(); renderAll();
}
el('undoBtn').addEventListener('click', () => undoPick(null));
armTwoStep('clearBtn', 'Clear picks', () => PICKS.size,
  () => { PICKS.clear(); savePicks(); renderAll(); });

/* ---------- my roster ---------- */
let SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'];
const FLEXOK = { WR: 1, RB: 1, TE: 1 };
const normPos = p => (p === 'DST' ? 'DEF' : p);
function myPlayers() {
  const names = [];
  if (keeperName(MY)) names.push(keeperName(MY));
  for (const [pick, name] of PICKS) if (ORDER[Number(pick) - 1] === MY) names.push(name);
  return names.map(n => BY_NAME.get(n)).filter(Boolean).sort((a, b) => b.v - a.v);
}
function drawRoster() {
  const filled = SLOTS.map(s => ({ slot: s, p: null })), left = [];
  for (const pl of myPlayers()) {
    const spot = filled.find(f => f.slot === normPos(pl.p) && !f.p);
    if (spot) spot.p = pl; else left.push(pl);
  }
  for (const pl of left.slice()) {
    if (!FLEXOK[normPos(pl.p)]) continue;
    const flex = filled.find(f => f.slot === 'FLEX' && !f.p);
    if (flex) { flex.p = pl; left.splice(left.indexOf(pl), 1); }
  }
  el('roster').innerHTML = filled.map(f => {
    const hue = f.p ? f.p.p : (f.slot === 'FLEX' ? '' : f.slot);
    return `<div class="slot ${f.p ? 'on' : ''} ${hue ? 'p-' + hue : ''}">
      <div class="slothead"><span class="slotlabel">${f.slot}</span>
        ${f.p ? `<span class="slotmeta">${f.p.p}${f.p.posrk ?? ''}</span>` : ''}</div>
      ${f.p ? `<div class="slotname">${esc(f.p.n)}</div>` : `<div class="slotempty">open</div>`}
    </div>`;
  }).join('') + (left.length
    ? `<div class="slot bench on"><div class="slothead"><span class="slotlabel">BENCH</span>
        <span class="slotmeta">${left.length}</span></div>
       <div class="benchlist">${left.map(b => `<span class="benchchip p-${b.p}">${esc(b.n)}<i>${b.p}${b.posrk ?? ''}</i></span>`).join('')}</div></div>` : '');
  const need = filled.filter(f => !f.p).map(f => f.slot);
  el('rosterNote').innerHTML = need.length
    ? `still need <b>${need.join(' · ')}</b>` : '<b>starting lineup complete</b>';
}

/* ---------- available table ---------- */
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
    for (const p of P) { p.v = p.v0; p.ar = p.ar0; p.edge = p.edge0; p.gap = p.gap0; }
    paintWeightUI(m); return;
  }
  const w = m.w;
  for (const p of P) {
    p.v = (p.ownv == null || p.slotv == null) ? (p.slotv != null ? p.slotv : (p.ownv || 0))
        : w * p.slotv + (1 - w) * p.ownv;
  }
  // Astro # is just the board re-ranked by Value.
  [...P].sort((a, b) => b.v - a.v).forEach((p, i) => { p.ar = i + 1; });
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

let ptsMode = 'total';                 // 'total' = season points | 'par' = above replacement
try { ptsMode = localStorage.getItem('astroworld-ptsmode') === 'par' ? 'par' : 'total'; } catch (e) {}
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
  return `<span class="gap ${cls}" title="${[other, note].filter(Boolean).join(' · ')}"
    >${Math.round(v)}</span>`;
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
el('ptsMode').addEventListener('click', () => {
  ptsMode = ptsMode === 'par' ? 'total' : 'par';
  try { localStorage.setItem('astroworld-ptsmode', ptsMode); } catch (e) {}
  applyPtsMode(); render();
});

let sortK = 'ar', sortDir = 'asc', posF = '', view = 'avail', q = '';
function render() {
  const taken = takenNames();
  const keeperNames = new Set(KAT.values());
  let rows = P.filter(p =>
    (!posF || (posF === 'FLEX' ? FLEX_POS.has(p.p) : p.p === posF)) &&
    (view === 'avail' ? !taken.has(p.n) : true) &&
    (!q || p.n.toLowerCase().includes(q) || (p.nfl || '').toLowerCase().includes(q)));
  const dir = sortDir === 'desc' ? -1 : 1;
  rows.sort((a, b) => {
    if (sortK === 'p') { const k = p => (POSORD[p.p] ?? 9) * 1000 + (p.posrk ?? 999); return dir * (k(a) - k(b)); }
    let x = a[sortK], y = b[sortK];
    if (x == null) x = sortDir === 'desc' ? -1e9 : 1e9;
    if (y == null) y = sortDir === 'desc' ? -1e9 : 1e9;
    if (typeof x === 'string' || typeof y === 'string') return dir * String(x).localeCompare(String(y));
    return dir * (x - y);
  });
  el('tbody').innerHTML = rows.map(p => {
    const isKeeper = keeperNames.has(p.n), gone = taken.has(p.n);
    const mine = myPlayers().some(m => m.n === p.n);
    const w = Math.min(100, 100 * p.v / maxV);
    return `<tr class="${mine ? 'mine' : gone ? 'drafted' : ''}" data-name="${esc(p.n)}">
      <td class="chkcol"><span class="draftbox" data-state="${isKeeper ? 'kept' : gone ? 'taken' : ''}"
        title="${isKeeper ? 'Kept — change in the Keepers block' : gone ? 'Drafted — tap to undo' : 'Tap to draft to the team on the clock'}"
        >${isKeeper ? 'K' : ''}</span></td>
      <td class="scorecell num r">${p.ar ?? '—'}</td>
      <td><span class="pname">${esc(p.n)}</span> <span class="pteam">${esc(p.nfl || '')}</span>${injTag(p)}${mktTag(p)}<span class="posinline p-${p.p}">${p.p}${p.vpr ?? p.posrk ?? ''}</span></td>
      <td><span class="pos p-${p.p}">${p.p}${p.vpr ?? p.posrk ?? ''}</span></td>
      <td class="r">${offCell(p)}</td>
      <td class="r num">${Math.round(p.v)}<span class="mini"><i style="width:${w}%"></i></span></td>
      <td class="r num">${ptsCell(p)}</td>
      <td class="r num">${p.adp ? p.adp.toFixed(1) : '—'}</td>
      <td class="r num">${p.fp ?? '—'}</td>
      <td class="r num">${p.edge == null ? '—' : `<span class="gap ${p.edge >= 5 ? 'up' : p.edge <= -12 ? 'down' : ''}">${p.edge > 0 ? '+' + p.edge : p.edge}</span>`}</td>
      <td class="r num">${p.bye || '—'}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="11" style="text-align:center;padding:32px;color:var(--on-var)">No players match those filters.</td></tr>`;
  const cur = currentPick();
  el('legend').innerHTML = `<span>${rows.length} shown · ${taken.size} off the board (${KAT.size} kept, ${PICKS.size} drafted)`
    + `${cur ? ` · tapping a row drafts to pick #${cur}` : ''}</span>`;
}
el('tbody').addEventListener('click', e => {
  const tr = e.target.closest('tr[data-name]');
  if (!tr) return;
  const name = tr.dataset.name;
  if (new Set(KAT.values()).has(name)) return;      // keepers are managed above
  const at = [...PICKS].find(([, v]) => v === name);
  if (at) undoPick(Number(at[0])); else draftPlayer(name);
});
document.querySelectorAll('#tbl thead th').forEach(th => th.addEventListener('click', () => {
  const k = th.dataset.k; if (!k) return;
  if (sortK === k) sortDir = sortDir === 'desc' ? 'asc' : 'desc';
  else { sortK = k; sortDir = ['n', 'p', 'ar', 'fp', 'bye', 'adp'].includes(k) ? 'asc' : 'desc'; }
  document.querySelectorAll('#tbl thead th').forEach(o => { o.removeAttribute('data-dir'); const a = o.querySelector('.ar'); if (a) a.textContent = '▼'; });
  th.dataset.dir = sortDir; const arw = th.querySelector('.ar'); if (arw) arw.textContent = sortDir === 'desc' ? '▼' : '▲';
  render(); el('tblwrap').scrollTop = 0;
}));
document.querySelectorAll('.fchip[data-view]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.fchip[data-view]').forEach(o => o.setAttribute('aria-pressed', 'false'));
  b.setAttribute('aria-pressed', 'true'); view = b.dataset.view; render(); el('tblwrap').scrollTop = 0;
}));
el('posSel').addEventListener('change', e => { posF = e.target.value; render(); el('tblwrap').scrollTop = 0; });
el('q').addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); render(); el('tblwrap').scrollTop = 0; });

/* ---------- simulation ---------- */
// Most of the room drafts off FantasyPros, so the CPU does too — but nobody stocks a
// bench while a starting slot is empty, so needs come first until the lineup is whole.
// Kickers and defenses stay on the board until the end, the way real drafters treat them.
function rosterOf(team) {
  const names = [];
  if (keeperName(team)) names.push(keeperName(team));
  for (const [pick, name] of PICKS) if (ORDER[Number(pick) - 1] === team) names.push(name);
  return names.map(n => BY_NAME.get(n)).filter(Boolean);
}
function openSlots(team) {
  const filled = SLOTS.map(s => ({ slot: s, p: null }));
  const roster = rosterOf(team).slice().sort((a, b) => b.v - a.v);
  const spare = [];
  for (const pl of roster) {
    const spot = filled.find(f => f.slot === normPos(pl.p) && !f.p);
    if (spot) spot.p = pl; else spare.push(pl);
  }
  for (const pl of spare) {
    if (!FLEXOK[normPos(pl.p)]) continue;
    const flex = filled.find(f => f.slot === 'FLEX' && !f.p);
    if (flex) flex.p = pl;
  }
  return filled.filter(f => !f.p).map(f => f.slot);
}
// What a drafter is really asking is not "who is best left" but "who most improves
// the lineup I have". Those are the same answer in round 1 and very different in
// round 5 — which is why nobody takes a fourth receiver before their first back.
// The CPU values players the way the room does, off FantasyPros' slot value.
const cpuVal = p => (p.slotv != null ? p.slotv : p.v) || 0;
const CPU_FLEX = { WR: 1, RB: 1 };   // rooms flex a receiver or a back, not a second TE

// A drafter is not only filling a lineup, he is building a roster. Depth counts —
// just less. The weights below say a starting slot is worth full value, a first
// backup back is worth about half (everyone wants one; backs get hurt), a fourth
// receiver rather less, and everything after that is bench lottery tickets. This is
// what stops the CPU taking four receivers before its first running back.
const CPU_DEPTH = [['RB', .5], ['WR', .34], ['RB', .26], ['WR', .18], ['TE', .12]];
function lineupValue(players) {
  const start = SLOTS.filter(s => s !== 'FLEX').map(s => ({ s, w: 1, p: null }));
  const flex = SLOTS.filter(s => s === 'FLEX').map(() => ({ s: 'FLEX', w: 1, p: null }));
  const depth = CPU_DEPTH.filter(([s]) => SLOTS.includes(s) || s === 'FLEX')
    .map(([s, w]) => ({ s, w, p: null }));
  const spare = [];
  for (const pl of players.slice().sort((a, b) => cpuVal(b) - cpuVal(a))) {
    const spot = start.find(f => f.s === normPos(pl.p) && !f.p);
    if (spot) spot.p = pl; else spare.push(pl);
  }
  const left = [];
  for (const pl of spare) {                        // flex outranks any depth slot
    const f = flex.find(x => !x.p);
    if (f && CPU_FLEX[normPos(pl.p)]) f.p = pl; else left.push(pl);
  }
  for (const pl of left) {
    const spot = depth.find(f => f.s === normPos(pl.p) && !f.p);
    if (spot) spot.p = pl;
  }
  return [...start, ...flex, ...depth]
    .reduce((a, f) => a + (f.p ? cpuVal(f.p) * f.w : 0), 0);
}
function cpuPick(team, round) {
  const taken = takenNames();
  const roster = rosterOf(team);
  const need = openSlots(team);
  let pool = P.filter(p => p.fp && !taken.has(p.n));

  // Kicker and defense are last-resort picks. Nobody spends a mid round on one,
  // and nobody finishes without one — so they become mandatory when the remaining
  // picks only just cover them.
  const cnt = {};
  roster.forEach(p => { const x = normPos(p.p); cnt[x] = (cnt[x] || 0) + 1; });
  const nRB = cnt.RB || 0, nWR = cnt.WR || 0;

  // Hard floors, because these are behaviours no real drafter breaks. Nobody takes a
  // third receiver with an empty backfield, and nobody takes a third back before he
  // owns a single receiver — however the value model happens to rank them.
  // Nobody carries a fifth quarterback in a one-QB league. Bench depth has ceilings.
  const startAt = q => SLOTS.filter(s => s === q).length;
  const CAP = { QB: Math.max(2, startAt('QB') + 1), TE: Math.max(2, startAt('TE') + 1),
                K: Math.max(1, startAt('K')), DEF: Math.max(1, startAt('DEF')) };
  const bothSkill = startAt('RB') > 0 && startAt('WR') > 0;
  pool = pool.filter(p => {
    const pos = normPos(p.p);
    if (CAP[pos] && (cnt[pos] || 0) >= CAP[pos]) return false;
    if (bothSkill && pos === 'WR' && nWR >= 2 && nRB === 0) return false;
    if (bothSkill && pos === 'RB' && nRB >= 2 && nWR === 0) return false;
    return true;
  });

  // Everyone leaves the draft with a backup back. Treat the third RB as a slot that
  // must be filled before the room runs out of picks.
  const depthNeed = (startAt('RB') > 0 && nRB < startAt('RB') + 1) ? ['RB'] : [];
  // How many picks this team ACTUALLY has left, not how many rounds remain. A keeper
  // eats one of them, so a team whose keeper costs the final round has one fewer swing
  // than the round number implies — which is how two teams ended up without a kicker.
  let picksLeft = 0;
  for (let r = round; r <= ROUNDS; r++) {
    const pk = (SLOT[team] || {})[r];
    if (pk && !KAT.has(pk)) picksLeft++;
  }
  // Empty STARTING slots outrank the backup-back preference. Merging the two and
  // sorting by rank let a spare running back beat a mandatory kicker on the last pick,
  // which is how teams finished the draft without one.
  const force = list => {
    const want = new Set();
    list.forEach(s => s === 'FLEX' ? Object.keys(CPU_FLEX).forEach(x => want.add(x)) : want.add(s));
    const cand = pool.filter(p => want.has(normPos(p.p)));
    if (!cand.length) return null;
    cand.sort((a, b) => a.fp - b.fp);
    return cand[0].n;
  };
  if (need.length && picksLeft <= need.length) {
    const pick = force(need);
    if (pick) return pick;
  }
  const allNeed = need.concat(depthNeed);
  if (allNeed.length && picksLeft <= allNeed.length) {
    const pick = force(allNeed);
    if (pick) return pick;
  }

  // Kickers and defenses carry no value in the model, so the lineup maths will never
  // choose one — they would all land in the final two rounds, which is not how a room
  // behaves. Real drafters finish their starters, take a bench flier or two, then start
  // sniping the elite defenses, with kickers trailing a round or so behind. Model that
  // as a window that opens once the skill lineup is whole, with the odds climbing as
  // the end approaches.
  const skillNeed = need.filter(s => s !== 'K' && s !== 'DEF');
  const benchDepth = roster.length - (SLOTS.length - need.length);
  if (!skillNeed.length && benchDepth >= 1) {
    const open = { DEF: ROUNDS - 5, K: ROUNDS - 4 };
    const wants = need.filter(s => (s === 'K' || s === 'DEF') && round >= open[s]);
    if (wants.length) {
      const last = Math.max(...wants.map(s => open[s]));
      const prog = Math.min(1, (round - last + 1) / Math.max(1, ROUNDS - last));
      if (Math.random() < 0.20 + 0.55 * prog) {
        const want = new Set(wants);
        const cand = pool.filter(p => want.has(normPos(p.p)));
        if (cand.length) { cand.sort((a, b) => a.fp - b.fp); return cand[0].n; }
      }
    }
  }
  pool = pool.filter(p => {
    const pos = normPos(p.p);
    if (pos === 'K') return need.includes('K') && round >= ROUNDS - 1;
    if (pos === 'DEF') return need.includes('DEF') && round >= ROUNDS - 2;
    return true;
  });
  if (!pool.length) return null;

  // A human only ever looks at the top of the board, so neither do we.
  pool.sort((a, b) => a.fp - b.fp);
  const shortlist = pool.slice(0, 28);
  const base = lineupValue(roster);
  const scored = shortlist.map((p, i) => ({
    p, i,
    gain: lineupValue(roster.concat(p)) - base
  }));

  const bestGain = Math.max(...scored.map(s => s.gain));
  if (bestGain <= 0.5) {
    // starting lineup is whole — from here it is best player available for the bench
    return shortlist[Math.floor(Math.random() * Math.min(3, shortlist.length))].n;
  }
  // Rank by lineup improvement, but keep consensus as the tiebreak so the CPU never
  // reaches past a clearly better player for a marginally better fit.
  scored.sort((a, b) => (b.gain - a.gain) || (a.i - b.i));
  const top = scored.slice(0, 3);
  return top[Math.floor(Math.random() * top.length)].p.n;
}
function simOne() {
  const cur = currentPick();
  if (!cur) return false;
  const name = cpuPick(ORDER[cur - 1], roundOf(cur));
  if (!name) return false;
  PICKS.set(cur, name);
  return true;
}
function runSim(stopAtMine, limit = 400) {
  let n = 0;
  while (n < limit) {
    const cur = currentPick();
    if (!cur) break;
    if (stopAtMine && ORDER[cur - 1] === MY && n > 0) break;
    if (!simOne()) break;
    n++;
    if (stopAtMine && ORDER[currentPick() - 1] === MY) break;
  }
  savePicks(); renderAll();
  return n;
}
el('sim1').addEventListener('click', () => { if (simOne()) { savePicks(); renderAll(); } });
el('simMine').addEventListener('click', () => {
  const cur = currentPick();
  if (cur && ORDER[cur - 1] === MY) { simOne(); }   // you are up: take this one, then run to the next
  let n = 0;
  while (n < 400) {
    const c = currentPick();
    if (!c || ORDER[c - 1] === MY) break;
    if (!simOne()) break;
    n++;
  }
  savePicks(); renderAll();
});
armTwoStep('simRest', 'Sim rest', () => (currentPick() ? 1 : 0), () => runSim(false),
  () => 'Fill the draft? Tap again');

/* ---------- draft board ---------- */
function drawBoard() {
  const cur = currentPick();
  let h = `<div class="brow bhead"><div class="bcell bcorner">RD</div>` +
    TEAMS.map((t, i) => `<div class="bcell bteam ${t === MY ? 'isme' : ''}"><span class="bseed">${i + 1}</span>${esc(t)}</div>`).join('') + `</div>`;
  for (let r = 1; r <= ROUNDS; r++) {
    h += `<div class="brow"><div class="bcell bround">${r}</div>` + TEAMS.map(t => {
      const pick = SLOT[t] && SLOT[t][r];
      if (!pick) return `<div class="bcell"></div>`;
      const name = playerAtPick(pick), isK = KAT.get(pick) === name && name;
      const pl = name ? BY_NAME.get(name) : null;
      const cls = [t === MY ? 'isme' : '', name ? 'filled' : '', pick === cur ? 'oncl' : '', isK ? 'kept' : ''].join(' ');
      return `<div class="bcell ${cls}" title="Pick ${pick}${name ? ' — ' + name : ''}">
        <span class="bpick">${pick}${isK ? ' K' : ''}</span>
        ${name ? `<span class="bname">${esc(name)}</span>
                  <span class="bpos p-${pl ? pl.p : ''}">${pl ? pl.p + (pl.vpr ?? pl.posrk ?? '') : ''}</span>` : ''}
      </div>`;
    }).join('') + `</div>`;
  }
  el('board').innerHTML = h;
}

/* ---------- settings ---------- */
function drawSettings() {
  document.querySelectorAll('.modeBtn').forEach(b =>
    b.classList.toggle('on', b.dataset.mode === CFG.mode));
  const custom = CFG.mode === 'custom';
  el('customCfg').hidden = !custom;
  el('modeHint').textContent = custom
    ? 'Your own league. Nothing from Astroworld carries over — set the size, the order and the names, then add keepers above if you use them.'
    : "The real Astroworld league: 12 teams, snake with a third-round reverse, and each team's actual keeper menu.";
  const snakeName = { third: 'snake, 3rd-round reverse', snake: 'snake', none: 'no snake' };
  el('setSummary').textContent = custom
    ? `Custom · ${CFG.teams} teams · ${CFG.rounds} rounds · ${snakeName[CFG.snake]}`
    : `Astroworld · ${TEAMS.length} teams · ${ROUNDS} rounds · ${snakeName.third}`;
  if (!custom) return;
  const tSel = el('cfgTeams'), rSel = el('cfgRounds');
  if (!tSel.options.length) {
    for (let i = 4; i <= 16; i++) tSel.add(new Option(i, i));
    for (let i = 8; i <= 25; i++) rSel.add(new Option(i, i));
  }
  tSel.value = CFG.teams; rSel.value = CFG.rounds; el('cfgSnake').value = CFG.snake;
  const r = rosterCfg();
  el('cfgRoster').innerHTML = ROSTER_POS.map(p =>
    `<label class="cfgfield slot"><span>${p}</span>
       <span class="sel"><select data-pos="${p}">
         ${[0,1,2,3,4,5,6].map(v => `<option value="${v}" ${v === (r[p]||0) ? 'selected' : ''}>${v}</option>`).join('')}
       </select></span></label>`).join('');
  const starters = slotsFromRoster(r).length;
  const bench = CFG.rounds - starters;
  el('benchHint').innerHTML = bench >= 0
    ? `${starters} starting spots, <b>${bench}</b> on the bench across ${CFG.rounds} rounds.`
    : `<b>${starters} starting spots but only ${CFG.rounds} rounds</b> — add rounds or trim the lineup.`;
  el('cfgNames').innerHTML = customNames().map((n, i) =>
    `<div class="namerow"><span class="idx">${i + 1}</span>
     <input value="${esc(n)}" data-i="${i}" aria-label="Name for team ${i + 1}" maxlength="24"></div>`).join('');
}
function changeCfg(patch) {
  Object.assign(CFG, patch);
  if (CFG.mode === 'custom') CFG.names = customNames().slice(0, CFG.teams);
  PICKS.clear(); savePicks();          // a different league means a different draft
  saveCfg(); applyConfig(); renderAll();
}
document.querySelectorAll('.modeBtn').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.mode === CFG.mode) return;
  KEEPERS.clear(); saveKeepers();
  changeCfg({ mode: b.dataset.mode });
}));
el('cfgTeams').addEventListener('change', e => changeCfg({ teams: Number(e.target.value) }));
el('cfgRounds').addEventListener('change', e => changeCfg({ rounds: Number(e.target.value) }));
el('cfgSnake').addEventListener('change', e => changeCfg({ snake: e.target.value }));
el('cfgRoster').addEventListener('change', e => {
  const p = e.target.dataset.pos; if (!p) return;
  changeCfg({ roster: Object.assign(rosterCfg(), { [p]: Number(e.target.value) }) });
});
el('cfgNames').addEventListener('change', e => {
  const i = e.target.dataset.i; if (i == null) return;
  const names = customNames(); names[i] = e.target.value.trim() || `Team ${Number(i) + 1}`;
  changeCfg({ names });
});
armTwoStep('cfgReset', 'Reset league', () => 1, () => {
  KEEPERS.clear(); saveKeepers(); PICKS.clear(); savePicks();
  CFG = Object.assign({}, DEF_CFG); saveCfg(); applyConfig(); renderAll();
}, () => 'Reset everything? Tap again');

function renderAll() {
  drawClock(); drawMePicker(); drawSettings(); drawKeepers(); drawRoster(); render(); drawBoard();
}
function redrawAfterWeights() { maxV = Math.max(...P.map(p => p.v), 1); renderAll(); }
applyWeights(); applyPtsMode(); applyConfig(); refreshDerived(); savePicks(); renderAll();
el('upd').textContent = 'updated ' + DATA.updated;
el('nexp').textContent = DATA.experts;
if (DATA.built) { el('built').textContent = DATA.built;
  const st = el('stamp'); if (st) st.textContent = DATA.built + (DATA.updated ? ` · FantasyPros consensus ${DATA.updated}` : ''); }
