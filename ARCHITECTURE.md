# Astroworld Keepers — how this project works

Read this before changing anything. It explains what the pieces are, which files are
generated, and the reasoning behind decisions that look arbitrary but are not.

---

## 1. What this is

A three-page static site that helps one fantasy football league draft. It is built
locally by a Python script and published to GitHub Pages. There is no server, no
build tool, no framework, and no dependencies outside the Python standard library.

| Page | File | Purpose |
|---|---|---|
| Keepers | `index.html` | Rates every eligible keeper 0-100 for all 12 teams |
| Value Board | `rankings.html` | All ~520 players re-valued for this league's rules |
| Draft Room | `draft.html` | Live draft tool: pick tracking, roster, board, simulation |

Live: <https://stevenlmiori.github.io/astroworld-keepers/>

---

## 2. Build pipeline

```
refresh.py ──fetches──▶ FantasyPros ECR + ESPN projections + Sleeper projections/ADP
     │
     ├─ computes values, keeper ratings, ADP edge
     │
     └─ injects one JSON blob into each *_template.html
                    │
                    ▼
        ../Astroworld {Keepers,Rankings,Draft Room} 2026.html
                    │
              deploy.sh copies them into site/ and pushes
                    │
                    ▼
              GitHub Pages
```

**One command does everything:** `./update.sh` (runs `refresh.py` then `deploy.sh`).

### Files

| File | Generated? | Notes |
|---|---|---|
| `refresh.py` | no — **edit this** | All data fetching and modelling |
| `deploy.sh`, `update.sh` | no | Publishing |
| `keepers_base.json` | no — **frozen input** | Rosters, 2025 draft results, eligibility, 2026 pick order. Never re-scraped; none of it changes. |
| `template.html`, `rankings_template.html`, `draft_template.html` | **YES — generated** | Do not hand-edit. See §3. |
| `site/` | **YES** | Git checkout of the published site. Written by `deploy.sh`. |
| `last_ranks.json`, `last_run.txt` | yes | Previous run's numbers, for the "what moved" report |

### ⚠️ The templates are generated

The three `*_template.html` files are assembled from source fragments that live in a
scratch directory outside this folder. **Editing a template directly will be silently
overwritten** the next time the page is assembled.

If you need to change page markup, styling or client-side JS and the source fragments
are not available, the practical move is to **recover them from a template**: each
template is `head + body + <script>const DATA=__KEEPER_DATA__; …</script>`, so it can
be split back into its three parts, edited, and reassembled. Treat that split as the
first step of any front-end change, and consider committing the fragments into this
folder so the next person does not have to.

---

## 3. The valuation model

This is the part worth understanding. Everything below lives in `refresh.py`.

### League rules that drive it

Astroworld starts **QB / WR / WR / WR / RB / RB / TE / W-R-T flex / K / DEF**, 12
teams, 15 rounds, full PPR, and **6-point passing touchdowns**. Those specifics are
the entire reason this tool exists — generic PPR rankings price none of them.

### ⚠ Two things that silently break the pages

**1. `refresh.py` owns the document preamble.** `assemble.py` produces a *fragment* —
`head.html` starts at `<title>`, with no `<!doctype>`, `<html>`, `<head>`,
`<meta charset>` or `<meta name="viewport">`. `refresh.py` prepends all of those when it
writes the final page (and inserts `</head><body>` before `<header class="bar">`).

So **never hand-roll "inject the data blob into the template"** as a shortcut to avoid
re-fetching. It produces a page with no doctype and no viewport meta, which renders at
980px on every phone and silently disables every `max-width:700px` rule. Always go
through `refresh.py` (or `./update.sh`).

**2. The narrow-screen column hides are positional.** `head.html` hides columns with
`.t-value thead th:nth-child(N)` / `tbody td:nth-child(N)` inside `@media (max-width:700px)`.
Both tables (Value Board *and* Draft Room) carry `class="t-value"`, so one rule governs
both. **Reordering or adding a column silently hides the wrong one** — the header and the
cell keep matching, so nothing looks broken, you just lose a different column than you meant
to. Re-check those indices after any column change.

Related: `thead th` is `text-align:left` by default and `td.r` is right-aligned, so a
right-aligned numeric column needs `class="r"` on **both** the `th` and the `td`, or the
header floats left of its own numbers.

### The four numbers, and which column shows what

`refresh.py` emits four per-player numbers. Three are visible, because showing only the
blend made the model look wrong to a human reader.

| Field | Column | What it is |
|---|---|---|
| `slotv` | *(hidden)* | Value of whoever sits at this player's FantasyPros consensus rank inside his position pool — what the expert market thinks he's worth |
| `ownv` | *(hidden, drives the Pts tint)* | Points above replacement from the ESPN+Sleeper blend, no consensus |
| `v` | **Value** | `0.5*slotv + 0.5*ownv`. Cross-position comparable. **Everything drafts, sorts and simulates on this.** |
| `bpts` | **Pts** (season-total mode) | Best estimate of actual Astroworld fantasy points for the season. Only comparable *within* a position. |
| `ownv` | **Pts+** (over-replacement mode) | The same blended projection minus the positional replacement baseline — the cross-position version of Pts. |
| `pts` | *(hidden)* | **ESPN-only** season total. Kept for reference. Do not show it as "the projection" — see below. |

### How `bpts` is built

`blend_projections()` computes two things from the same two sources:

* `pts` (the VORP one) — each source's points **above replacement**, floored at 0, averaged.
  Floored because a value model should not reward being deeply below replacement.
* `bpts` — the same scale-cancelling deviation-from-baseline trick **without the floor**
  (flooring would collapse every sub-replacement player onto one identical number, which
  is useless in a points column), re-expressed as season points by adding ESPN's
  replacement baseline back on. So it reads as a 17-game season total.

Both use each source's *own* replacement level, which is the whole point: Sleeper projects
18 games and ESPN 17, so raw totals are not comparable but deviations from a startable
baseline are.

**The ESPN-only trap.** `pts` and `bpts` can rank players very differently. Matthew
Stafford is QB6 on ESPN alone (369) but QB8 blended (355), because Sleeper has him at
QB15 — Sleeper's QB board is rushing-heavy and Stafford projects 19 rushing yards.
FantasyPros' humans also have him ~QB15 (FP #104). **If you quote "the projection" to the
user, quote `bpts`.** Quoting `pts` overstates a single vendor's opinion as consensus.

### The Pts column has two modes

Raw season points cannot be compared across positions — sorting on them stacks every QB
at the top, which is useless on a draft board. So the column toggles:

* **season total** (`ptsTot` = `bpts`) — reads naturally, compare within a position
* **over replacement** (`ptsPar` = `ownv`) — header becomes `Pts+`, comparable across positions

The `#ptsMode` button in the filter bar flips it; the choice persists in
`localStorage['astroworld-ptsmode']`. `applyPtsMode()` rewrites `p.pts` on every player
(so the existing `data-k="pts"` sort key keeps working untouched), retitles the `th`, and
relabels the button. **It must run before the first `render()`** — it is called just ahead
of `renderAll()` / `render()` at the bottom of each script.

Note `ownv` is `null` for K/DST (and one junk TE), so those show `—` in Pts+ mode.

Pts+ is deliberately *not* the same as **Value**: Value blends `ownv` 50/50 with the expert
consensus slot value, Pts+ is projection-only. Sorting the two side by side is the fastest
way to see where the model and the market disagree.

### Column order (both tables)

`✓ | Astro # | Player | Pos | Value | Pts | ADP | FP rank | Edge | Bye`

Grouped: identity, then **our model** (Value, Pts), then **the market** (ADP, FP rank),
then Edge as the model-vs-market verdict, then Bye. `Pts` is a real sort key set on line 1
of both scripts (`pts: p.bpts != null ? p.bpts : p.pts`), which **shadows** the raw ESPN
`p.pts` inside the page — intentional, so no UI code can accidentally show the ESPN-only
number. The Pts cell is tinted green/red where `ownv` and `v` disagree by 3+.

This replaced an older "Gap" column (`fp - ar`) that duplicated FP rank and Astro #.
`gapCell()` survives on the Value Board only, for the risers/fallers lists.

### Value = points above replacement

```
value(player) = CONSENSUS_WEIGHT × slotValue + (1 − CONSENSUS_WEIGHT) × ownProjection
```

* **slotValue** — what the Nth best player at that position is worth, where N is
  FantasyPros' positional rank. Uses the crowd to decide who is better.
* **ownProjection** — that player's own blended projection.
* Both are in *points above replacement*, where replacement is the last startable
  player at the position (`REPLACEMENT = {QB:13, RB:28, WR:43, TE:13}`).

**Why blend?** Consensus alone means a player inherits the points of whoever else
sits in his slot (Chase Brown was literally being credited with De'Von Achane's
projection). Projections alone let one shop's model run away with the board.

### Two projection sources, blended in VORP space

ESPN and Sleeper are both scored under Astroworld's rules, then converted to points
above replacement **before** averaging. This matters: Sleeper assumes an 18-game
season and ESPN 17, so raw points are not comparable — but points above a startable
baseline are.

### Keeper rating

```
gain   = value(keeper) − value(best player still on the board at his cost pick)
rating = piecewise-linear map of gain onto 0-100  (ANCHORS)
```

Grades **are** the rating bands: 90s = A, 80s = B, 70s = C, 60s = D, below 60 = F.

The counterfactual is the **most valuable player remaining**, not the next name in
consensus order. Reading a single index made a keeper's rating swing 35 points on no
news, because whoever landed on that index might be a low-value QB or a high-value RB.

### Edge (the draft-day number)

```
edge = value(player) − value(best player still available after his ADP)
```

Positive means the room is underpaying. ADP comes from Sleeper (`adp_ppr`) and is a
**lagging indicator** — it takes days to absorb injury news that expert ranks reflect
immediately.

### Stability check

Every team's keeper is re-solved under four different replacement-level assumptions.
If the answer changes, that team is flagged **too close to call** rather than given
false precision.

---

## 4. Draft Room specifics

### Storage keys (all `localStorage`, per browser)

| Key | Contents |
|---|---|
| `astroworld-picks-2026` | `[[overallPick, playerName], …]` |
| `astroworld-keepers-2026` | Astroworld: `[[team, name]]`. Custom: `[[team, {n, rd}]]` |
| `astroworld-me-2026` | Which team the viewer is |
| `astroworld-league-2026` | League config (see below) |

Keepers are stored separately from picks **on purpose** — "Clear picks" wipes a
simulation without making you re-enter the keepers.

### Astroworld vs Custom mode

`CFG` drives everything. In Astroworld mode `ORDER`/`SLOT`/`TEAMS`/`SLOTS` come from
`DATA`; in Custom mode they are generated from `CFG` (team count, round count, snake
type, team names, roster slots). `applyConfig()` rebuilds them.

**Astroworld's draft order is unusual:** round 1 forward, round 2 reverse, **round 3
reverse again**, then alternating from round 4. `roundForward()` encodes this as the
`third` option; `snake` and `none` are the ordinary cases.

⚠️ `applyConfig()` assigns `SLOTS`, which is declared far below it. It must be called
**at the end of the script**, not at its definition site, or the whole file dies in
the temporal dead zone.

### The draft simulation

CPU teams draft off FantasyPros rankings, because that is what the room will use. But
ranking alone produces nonsense (four receivers before a first running back), so each
candidate is scored by **how much he improves that team's lineup**, not by how good he
is in the abstract. In round 1 those are the same answer; by round 5 they are not.

On top of the value model sit hard behavioural rules, because some things no drafter
ever does:

* No third WR with an empty backfield; no third RB before owning a receiver
* Everyone leaves with a **backup running back**
* Bench ceilings: QB and TE capped at starters + 1; exactly one K and one DEF
* K and DEF carry **zero model value**, so the lineup maths will never choose one.
  Left to the forced-fill rule alone they all land in the last two rounds, which is
  not how a room behaves. Instead a window opens once a team's skill lineup is whole
  and it has taken a bench flier: defenses from round `ROUNDS−5`, kickers from
  `ROUNDS−4`, with the odds climbing toward the end. Defenses go a round or so before
  kickers, as they do in life. The forced fill remains as the backstop.
* A second TE never counts toward FLEX (this is what made teams take two tight ends
  in the first four rounds)
* Depth weights: a first backup RB is worth ~0.5 of a starter, a fourth WR ~0.34

All of these adapt to the configured roster in Custom mode — set DEF to 0 and no
defense is ever drafted.

`armTwoStep(id, label, count, run, armLabel)` — pass `armLabel` for any button whose
count is not a meaningful noun, or the armed state reads "1? Tap again".

**When changing the sim, re-run the audit.** Drive it directly rather than through the
buttons (`while (currentPick()) simOne()`), because the two-step confirm buttons do
not clear reliably in a tight loop and will make a clean sim look broken. Check across
several complete drafts: no rule violations, every starting slot filled, bench size
equal to `rounds − starters`, and sane positional counts.

---

## 5. Things that will bite you

* **Everything is verified against the live URL, not the local file.** GitHub Pages
  caches for a few minutes; add a cache-busting query string when checking.
* **Preview panes block `localStorage`** on `data:` and `file:` URLs. The code degrades
  gracefully, but persistence can only be tested on the real https page.
* **`innerText` returns empty for collapsed `<details>`.** Check `innerHTML` instead
  before concluding something did not render.
* **Sort headers**: the checkbox column has no `.ar` arrow span. Any unguarded
  `querySelector('.ar').textContent` there throws and kills every sort.
* Both themes matter. Colours are defined as tokens on `:root` and redefined for
  `prefers-color-scheme: dark` and `[data-theme]`. Never hard-code a colour that only
  works in one theme.
* Positional ranks shown in the UI are **this model's** (`vpr`), not FantasyPros'
  (`fppr`). Mixing them made a player read "RB9" while sorted below RB12.

---

## 6. Refresh cadence

Rankings move daily in preseason. `./update.sh` is cheap — run it every couple of
days, and always a few hours before the draft. Every page footer shows **Page built
<date, time>** so staleness is visible at a glance.
