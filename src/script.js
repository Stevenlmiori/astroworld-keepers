const P = DATA.players, SLOT = DATA.slot;
const el = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const V = n => 1000 * Math.pow(2.5 / (n + 1.5), 0.80);

/* ---------- theme ---------- */
el('themeBtn').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme');
  const dark = cur ? cur === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
  drawCurve();
});

/* ---------- derived ---------- */
const eligible = P.filter(p => p.e);
const teams = [...new Set(P.map(p => p.t))].sort((a, b) => a.localeCompare(b));
const HUES = [262, 22, 152, 320, 76, 205, 348, 128, 240, 46, 288, 178];
const hueOf = {};
teams.forEach((t, i) => hueOf[t] = HUES[i % HUES.length]);
const tvar = t => `class="tcolor" style="--h:${hueOf[t]}"`;

const bestByTeam = teams.map(t => eligible.filter(p => p.t === t).sort((a, b) => b.s - a.s)[0])
                        .sort((a, b) => b.s - a.s);
const gradeClass = g => 'g-' + (g === 'A+' ? 'Ap' : g);
const rateClass = g => 'r-' + (g === 'A+' ? 'Ap' : g);
const WHY = { rd1: "1st rd '25", kept25: "Kept '25" };
const STABLE = DATA.stable || {}, RIVAL = DATA.rival || {};
const KEPT = new Set(DATA.kept || []);
const WINNER = {};
P.forEach(p => { if (p.e && KEPT.has(p.n)) WINNER[p.t] = p.n; });

// A tie belongs to ONE decision, not to a whole roster: tag only the two players
// actually competing for that team's keeper slot.
function tiedWith(p) {
  if (STABLE[p.t] !== false) return null;
  const win = WINNER[p.t], riv = RIVAL[p.t];
  if (!win || !riv) return null;
  if (p.n === win) return riv;
  if (p.n === riv) return win;
  return null;
}
const TIETIP = (p, other) => `${esc(p.n)} and ${esc(other)} score close enough that the model cannot `
  + `separate them — which one comes out ahead flips depending on how deep you assume startable players `
  + `run at each position. Treat them as tied and pick on gut, or on who you trust to stay healthy.`;

/* ---------- team cards ---------- */
const maxS = Math.max(bestByTeam[0].gain ?? 1, 1);
el('cards').innerHTML = bestByTeam.map((p, i) => `
  <div class="card tcolor" style="--h:${hueOf[p.t]}">
    <div class="rk">#${i + 1}</div>
    <div class="tm">${esc(p.t)}</div>
    <div class="pl">${esc(p.n)}</div>
    <div class="meta">${p.p}${p.posrk ?? ''} · ${esc(p.nfl || '')} · ${p.v} value · FantasyPros #${p.fp ?? '—'}</div>
    <div class="foot">
      <span class="chip ${gradeClass(p.g)}">${p.s} · ${p.g}</span>
      <span class="cost">Round ${p.cr}, pick ${p.cp}</span>
    </div>
    <div class="bar-t"><div class="bar-f" style="width:${Math.max(3, 100 * (p.gain ?? 0) / maxS)}%"></div></div>
    <div class="cost" style="margin-top:9px">${p.gain > 0 ? '+' : ''}${p.gain.toFixed(1)} pts vs ${esc(p.alt || '—')}</div>
    ${tiedWith(p) ? `<div class="tie" title="${TIETIP(p, tiedWith(p))}">tied with ${esc(tiedWith(p))} — the model can't separate them</div>` : ''}
  </div>`).join('');

/* ---------- table ---------- */
let sortK = 's', sortDir = 'desc', posF = '', teamF = '', showInel = false, q = '';
teams.forEach(t => el('teamSel').insertAdjacentHTML('beforeend', `<option value="${esc(t)}">${esc(t)}</option>`));

const maxGain = Math.max(...eligible.map(p => p.gain ?? 0), 1);
function rowHTML(p) {
  const g = p.gain ?? 0;
  const w = Math.min(100, 100 * Math.abs(g) / maxGain);
  const bar = p.e ? `<span class="mini"><i class="${g < 0 ? 'neg' : ''}" style="width:${w}%"></i></span>` : '';
  return `<tr class="tcolor ${p.e ? '' : 'inel'}" style="--h:${hueOf[p.t]}">
    <td class="scorecell num"><span class="rt ${p.e ? rateClass(p.g) : ''}">${p.e ? p.s : '—'}</span>${bar}</td>
    <td>${p.e ? `<span class="chip ${gradeClass(p.g)}">${p.g}</span>` : `<span class="chip lock">${WHY[p.why]}</span>`}</td>
    <td><span class="pname">${esc(p.n)}</span> <span class="pteam">${esc(p.nfl || '')}</span><span class="posinline">${p.p}${p.posrk ?? ''}</span></td>
    <td><span class="pos">${p.p}${p.posrk ?? ''}</span></td>
    <td class="teamcell"><span class="tdot"></span>${esc(p.t)}</td>
    <td class="r num">${p.ar ?? '—'}</td>
    <td class="r num">${p.fp ?? '—'}</td>
    <td class="r num">${p.e ? p.cp : '—'}</td>
    <td class="r num">${p.gain == null ? '—' : (p.gain > 0 ? '+' : '') + p.gain.toFixed(1)}</td>
    <td class="r num">${p.v ?? '—'}</td>
    <td class="r num">${p.ud ? 'UDFA' : p.r25}</td>
  </tr>`;
}
const GORD = { 'A+': 6, 'A': 5, 'B': 4, 'C': 3, 'D': 2, 'F': 1 };
function render() {
  let rows = P.filter(p => (showInel ? !p.e : p.e)
    && (!posF || p.p === posF) && (!teamF || p.t === teamF)
    && (!q || p.n.toLowerCase().includes(q) || (p.nfl || '').toLowerCase().includes(q)));
  const dir = sortDir === 'desc' ? -1 : 1;
  const POSORD = { QB: 0, RB: 1, WR: 2, TE: 3, K: 4, DEF: 5 };
  rows.sort((a, b) => {
    // Position sorts by position group, then by rank within it: QB1, QB2 ... RB1
    if (sortK === 'p') {
      const key = p => (POSORD[p.p] ?? 9) * 1000 + (p.posrk ?? 999);
      return dir * (key(a) - key(b));
    }
    let x = a[sortK], y = b[sortK];
    if (sortK === 'g') { x = GORD[x] || 0; y = GORD[y] || 0; }
    if (x == null) x = sortDir === 'desc' ? -1e9 : 1e9;
    if (y == null) y = sortDir === 'desc' ? -1e9 : 1e9;
    if (typeof x === 'string') return dir * x.localeCompare(y);
    return dir * (x - y);
  });
  el('tbody').innerHTML = rows.map(rowHTML).join('') ||
    `<tr><td colspan="10" style="text-align:center;padding:32px;color:var(--on-var)">No players match those filters.</td></tr>`;
  el('legend').innerHTML = showInel
    ? `<span>${rows.length} locked out · ineligible players carry no score, so they are ranked by FantasyPros instead</span>`
    : `<span>${rows.length} eligible · rating 0–100 · A+ 97+ · A 90s · B 80s · C 70s · D 60s · F below 60</span>`;
}
document.querySelectorAll('#tbl thead th').forEach(th => th.addEventListener('click', () => {
  const k = th.dataset.k;
  if (sortK === k) sortDir = sortDir === 'desc' ? 'asc' : 'desc';
  // rank-like and text columns open ascending (rank 1 / pick 1 / A-Z first);
  // score-like columns open descending (biggest first)
  else { sortK = k; sortDir = ['n', 't', 'p', 'ar', 'fp', 'cp', 'r25'].includes(k) ? 'asc' : 'desc'; }
  document.querySelectorAll('#tbl thead th').forEach(o => o.removeAttribute('data-dir'));
  th.dataset.dir = sortDir;
  const arw = th.querySelector('.ar'); if (arw) arw.textContent = sortDir === 'desc' ? '▼' : '▲';
  render();
}));
document.querySelectorAll('.fchip[data-pos]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.fchip[data-pos]').forEach(o => o.setAttribute('aria-pressed', 'false'));
  b.setAttribute('aria-pressed', 'true'); posF = b.dataset.pos; render(); el('tblwrap').scrollTop = 0;
}));
function setSort(k, dir) {
  sortK = k; sortDir = dir;
  document.querySelectorAll('#tbl thead th').forEach(o => {
    o.removeAttribute('data-dir');
    const a = o.querySelector('.ar'); if (a) a.textContent = '▼';
  });
  const th = document.querySelector(`#tbl thead th[data-k="${k}"]`);
  if (th) { th.dataset.dir = dir; const a = th.querySelector('.ar'); if (a) a.textContent = dir === 'desc' ? '▼' : '▲'; }
}
el('inelBtn').addEventListener('click', () => {
  showInel = !showInel;
  el('inelBtn').setAttribute('aria-pressed', String(showInel));
  el('inelBtn').textContent = showInel ? 'Locked out' : 'Show locked out';
  setSort(showInel ? 'fp' : 's', showInel ? 'asc' : 'desc');
  render();
  el('tblwrap').scrollTop = 0;
});
el('teamSel').addEventListener('change', e => { teamF = e.target.value; render(); el('tblwrap').scrollTop = 0; });
el('q').addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); render(); el('tblwrap').scrollTop = 0; });
render();

/* ---------- curve chart ---------- */
function drawCurve() {
  const C = DATA.curves || {}, POS = ['WR', 'RB', 'TE', 'QB'];
  const HUE = { WR: 262, RB: 152, TE: 22, QB: 205 };
  const W = 520, H = 236, PAD = { l: 44, r: 14, t: 16, b: 30 };
  const cs = getComputedStyle(document.documentElement), c = n => cs.getPropertyValue(n).trim();
  const N = 40, maxV = Math.max(...POS.flatMap(p => (C[p] || []).slice(0, N)));
  const x = i => PAD.l + (i / (N - 1)) * (W - PAD.l - PAD.r);
  const y = v => H - PAD.b - (v / maxV) * (H - PAD.t - PAD.b);
  const col = p => `oklch(var(--tl) var(--tc) ${HUE[p]})`;
  const lines = POS.map(p => {
    const arr = (C[p] || []).slice(0, N);
    if (!arr.length) return '';
    const d = arr.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join('');
    return `<path d="${d}" fill="none" stroke="${col(p)}" stroke-width="2.2" stroke-linecap="round"/>`;
  }).join('');
  const ticks = [1, 8, 16, 24, 32, 40].map(n =>
    `<line x1="${x(n - 1)}" y1="${PAD.t}" x2="${x(n - 1)}" y2="${H - PAD.b}" stroke="${c('--outline-var')}" stroke-width=".5"/>
     <text x="${x(n - 1)}" y="${H - 10}" fill="${c('--on-var')}" font-size="9.5" text-anchor="middle" font-family="Roboto Mono">${n}</text>`).join('');
  const yt = [0, Math.round(maxV / 2), Math.round(maxV)].map(v =>
    `<text x="${PAD.l - 7}" y="${y(v) + 3.5}" fill="${c('--on-var')}" font-size="9.5" text-anchor="end" font-family="Roboto Mono">${v}</text>`).join('');
  const R = DATA.replacement || {};
  document.getElementById('curve').innerHTML =
   `<div class="clegend">${POS.map(p => `<span><i style="background:${col(p)}"></i>${p}<b>${R[p] ? ' · repl ' + R[p] : ''}</b></span>`).join('')}</div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" role="img"
      aria-label="Projected points above replacement by rank within each position">
      ${ticks}${yt}
      <text x="${x(N - 1)}" y="${PAD.t + 8}" fill="${c('--on-var')}" font-size="9.5" text-anchor="end" font-family="Roboto">rank at position →</text>
      ${lines}
    </svg>
    <p style="font-size:12px;margin:10px 0 0;color:var(--on-var)">Vertical axis is projected points above the
    last startable player at that position. Note how fast QB flattens — past the top few, a quarterback is
    worth almost nothing you couldn't stream off waivers.</p>`;
}
drawCurve();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', drawCurve);

/* ---------- side lists ---------- */
const li = (p, right) => `<li class="tcolor" style="--h:${hueOf[p.t]}"><span class="pos">${p.p}</span><span class="nm">${esc(p.n)}<span class="sm"> · <span class="tdot"></span>${esc(p.t)}</span></span>${right}</li>`;
el('inelList').innerHTML = P.filter(p => !p.e)
  .sort((a, b) => (a.fp ?? 999) - (b.fp ?? 999))
  .map(p => li(p, `<span class="chip lock">${WHY[p.why]}</span>`)).join('');

el('upd').textContent = 'updated ' + DATA.updated;
if (DATA.built) el('built').textContent = DATA.built;
el('nexp').textContent = DATA.experts;
