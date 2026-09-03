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

### ⚠️ The templates are generated — edit `src/`, then run `python3 src/assemble.py`

The three `*_template.html` files are built from the fragments in **`src/`**:

| Fragment | Used by |
|---|---|
| `src/head.html` | all three pages (shared `<title>`, fonts, every CSS rule) |
| `src/body.html` + `src/script.js` | Keepers |
| `src/rank_body.html` + `src/rank_script.js` | Value Board |
| `src/draft_body.html` + `src/draft_script.js` | Draft Room |

`src/assemble.py` writes the templates; `refresh.py` then injects data and the document
preamble. **Never hand-edit a template** — it is overwritten on the next assemble.

History, so nobody repeats it: the fragments originally lived in a session scratchpad
outside the project and were **wiped by the OS on 2026-09-01**. They were recovered by
splitting the templates back into `head + body + <script>` at the `<header class="bar">`
and `const DATA=__KEEPER_DATA__` boundaries — a round-trip that differed only by blank
lines. They now live in `src/` and are committed to the site repo.

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

Related, and it bit twice: a right-aligned numeric column needs `class="r"` on **both**
the `th` and the `td` (`thead th` is `text-align:left` by default), **and** the sort arrow
must be taken out of flow. `.ar` is `opacity:0` when inactive but still occupied ~9px of
layout width, which pushed every right-aligned header label 9px left of its own numbers —
visible as a persistent, subtle misalignment. Fixed with `thead th.r{position:relative}` +
`thead th.r .ar{position:absolute;right:4px}`, parking the arrow in the cell's 14px right
padding, plus deleting the literal space between label and `<span class="ar">` in every
`.r` header (`white-space:nowrap` preserves it otherwise). `applyPtsMode()` writes the Pts
label with no trailing space for the same reason.

To check this rather than eyeball it: compare `Range.getClientRects()` on the header's
first text node against the cell's contents — every right-aligned column should report an
offset of exactly 0.

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

### Scoring audit (2026-09-01)

`astro_points()` was checked line-by-line against the league's Yahoo *Scoring & Settings*
page (saved in `../2026 Keeper Rating/`). Every line matched — completions .02, 25 yds/pt
passing, 6-pt passing TD, −2 INT, 10 yds/pt rushing and receiving, 6-pt TDs, 1/rec, −2
fumbles — **except 2-point conversions (+2)**, which were missing from both scoring
functions. Added: ESPN stat ids 19/26/44 (pass/rush/rec), Sleeper `pass_2pt`/`rush_2pt`/
`rec_2pt`. Worth at most a few points a season to a handful of players.

### The market source (Kalshi)

`fetch_kalshi()` pulls Kalshi's season stat-threshold markets ("Will X record 4,000+
passing yards?") — the seven series in `KALSHI_SERIES`. These are the right Vegas input
because they are **scoring-agnostic**. Two things that look like better market signals
are traps:

* **`KXNFLFFLEADER` ("#1 fantasy QB") settles on Sleeper PPR = 4-point passing TDs.**
  It carries exactly the distortion this league does not want (Stafford at 1.5% there is
  the consensus's opinion, re-expressed with money). Do not use it raw.
* **Thin ladders lie.** A single high-threshold rung at a few cents is dominated by
  longshot bias; fitting a mean to it produced absurd numbers (a rookie WR at 104
  catches). A first attempt that blended those in would have made the model *worse*.

So the filters are strict and deliberate: a rung counts only if its bid/ask spread is
≤ `MKT_MAX_SPREAD` (0.15), and a player's stat counts only if the ladder **brackets the
50% line** — the crossing is then a money-backed median. That leaves ~25–30 players.
`market_adjust()` moves each covered stat `MKT_PULL` (50%) of the way toward that
median, converts to points, caps the total at ±`MKT_CAP` (20), and applies it to **both**
sources' `pts`/`spts` before blending — so it flows through `ownv`, `bpts`, `Value` and
the consensus translation alike. The delta and its stat detail ship as `mkt` and render
as the green/red **`$` tag** beside the name.

What the money says, consistently: liquid medians sit a few percent **below** the
projections almost everywhere (pass yds −80, rush yds −110, rec yds −28 at the median).
Markets price missed games; projections assume 17 healthy ones. That is the whole
signal, and it is why the adjustment is a haircut on nearly every tagged player.

Kalshi team win totals (`KXNFLWINS`) were also pulled for context (Rams 12.4, highest in
the league) but are not wired into the model — there is no clean mapping from team wins
to one player's points.

### Team offense chip (`Off` column)

`fetch_kalshi_teams()` builds a 0-100 **team offensive environment** score for the colour
chip beside every player. Kalshi has no full-ladder "team season points" market, so it is a
composite of two things that do exist and are liquid:

* **Implied regular-season win total** (`KXNFLWINS`, 32 teams, median of the ladder) —
  the backbone, z-scored across the league.
* A **tilt** from the "highest scoring team" / "lowest scoring team" books
  (`KXNFLTEAMPTS-MOST27` / `-LEAST27`), each normalised to remove the overround:
  `log((p_most + .005) / (p_least + .005)) / 3`. These are only informative at the tails,
  which is exactly where an offense signal should bite.

Result is min-max scaled 0-100 and shipped as `DATA.teamsOff[code] = {off, wins, pmost,
pleast, rank}` (2026-09-01: LAR 100, DET 89, BUF 88 … CLE 13, ARI 4, MIA 0). Kalshi uses
`JAX`; the board uses `JAC` — mapped in `KALSHI_TEAM`.

On the page the chip's hue is `25 + off * 1.2` in oklch (red → amber → green, perceptually
even). `off` is a real sort key on `P`. **The column sits at position 5**, so the
narrow-screen `nth-child` hides moved to 4 / 9 / 10 — see the CSS comment.

It is a **tiebreaker, not a projection**: a great back on a bad team still gets the
carries. The column key says so.

### Simulation realism (2026-09-02)

The user caught rooms drafting a fourth WR before a second RB — measured at **33 of 120**
simulated team-drafts, with only **71%** of teams holding RB2 by round 6. Root cause was
three compounding things in `cpuPick()` / `lineupValue()`:

1. **The flex slot carried full starter weight**, so "WR4 into flex" scored the same as
   "RB2 into a starting slot", and in a 3-WR PPR format the receiver usually had more
   consensus value. Now `CPU_FLEX = {RB: .84, WR: .66}` — a per-position flex weight,
   applied when the player lands there. Rooms prefer a back in that spot.
2. **No urgency.** `urgency(round) = min(2, 1 + .18·(round−2))` now multiplies every
   *starting* slot, so an empty RB2 in round 5 is a hole being fixed, not a value call.
3. **RB VORP collapses at replacement (RB28)**, so a round-5 back like RB30 was worth ~5
   to the model however the slots were weighted — humans take him anyway because that
   is his ADP. `cpuVal()` is now **half consensus slot value, half "the value of a pick
   at his ADP"** (`V_BY_RANK[round(adp)−1]`, computed from the *shipped* `v`, so the user's
   weighting control never leaks into how opponents draft). This was the change that
   actually moved RB3 timing.

Plus a hard floor (no 4th WR while RB2 is empty; mirror for RBs), bench-RB depth weights
raised (`CPU_DEPTH` RB .62/.34), and the shortlist ordered by **ADP** rather than expert
rank — the board a room actually drafts off.

Measured over 12 simulated drafts (144 team-drafts), before → after:

| | before | after |
|---|---|---|
| RB2 by round 6 | 71% | **98%** |
| RB2 by round 5 | 64% | 88% |
| RB3 by round 8 | 29% | **63%** |
| Ever 4 WR before RB2 | 33/120 | **0/144** |
| WR2 by round 5 | 88% | 90% |
| Illegal rosters | 0 | 0 |

The measurement script lives in the session history, not the repo; the metrics above are
the acceptance test for any future change to `cpuPick()`.

### Yahoo rankings (`Yahoo` column)

`fetch_yahoo()` pulls Yahoo's own overall preseason rank (`rank_type: "OR"`) from the
**public read-only** endpoint — no OAuth:

    https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/game/nfl/players
        ;sort=AR;start=N;count=25;out=ranks?format=json

25 players per page, walked to 600 (~24 requests, about 6s). 2026-09-02: 573 ranks, and
**every** player with an ADP inside the draftable range is covered. Shipped as `yr`.

This matters because **the league drafts on Yahoo**, so Yahoo's board is what the room is
literally looking at — FantasyPros is the national consensus, Yahoo is the one on screen
during the draft. The cell is tinted where the two disagree by 15+ spots.

Like `fp`, it is a **market ordering and is NOT re-scored for this league's rules**. It
does not feed Value; it is displayed for context only.

⚠ Adding this column moved every later column one to the right — the narrow-screen
`nth-child` hides became 4 / 9 / 10 / 11 and the empty-state `colspan` became 12.

### Source disagreement is now priced (2026-09-02)

The blend was `mean(ESPN_vorp, Sleeper_vorp)`, which treats two sources telling different
stories as if they were a consensus. Breece Hall 2026 was the case that exposed it:

| view of Breece Hall | points |
|---|---|
| ESPN (17 gm) — 1163 rush, 52 rec, 440 rec yd, 10.4 TD | **272** |
| Sleeper (18 gm) — 986 rush, 37 rec, 314 rec yd, 8.0 TD | **211** |
| Kalshi / DK rushing line | ~202 |

The mean put him at 247 and ranked him above players the other two views had behind him.
Two corrections now apply, in this order:

**1. The market's weight scales with disagreement.** `source_spread()` measures how far
apart the two sources are (deviation from each source's own replacement level, so the
17-vs-18-game difference cancels). `market_adjust()` then interpolates
`MKT_PULL` 0.50 → 0.90 and `MKT_CAP` 20 → 45 as that spread approaches `SPREAD_FULL`
(55 pts). Rationale: when the sources agree, the mean is fine and the market only nudges;
when they disagree, the market is the tiebreaker with money behind it.

**2. A winner's-curse shrink for what the market cannot see.** Kalshi only prices the
stats it has ladders for — for Hall that is rushing yards, while ESPN also carries him
15 catches and 2.4 TDs above Sleeper. So `blend_projections()` subtracts
`SPREAD_SHRINK (0.30) × spread/2` from every blended estimate. This is not a fudge: a
draft board is consumed by taking the **max** over noisy estimates, and the max of noisy
estimates is biased upward — the players you reach for are disproportionately the ones
the model happens to overrate. Shrinking by a player's own uncertainty corrects that bias.
Players both sources agree on barely move.

Net effect (2026-09-02): Hall 61.4 → 50.5, Kyren Williams 51.4 → 47.0 — from a 10-point
gap to 3.5, which is what the evidence supports. Board-wide only **11 of 512 players moved
more than 5 rank spots**, and the top 12 is unchanged.

**Positional rank follows the weighting.** `vpr` (the RB5/WR6 chip) is shipped from the
balanced sort. `applyWeights()` recomputes it alongside `ar` for any other weighting, and
restores `vpr0` for balanced — otherwise the POS chip shows one ranking while Astro #
shows another (Cook RB5 at #12, Achane RB6 at #11).

`spr` ships to the page. The Pts cell shows a **±** and a dotted underline at spread ≥ 25,
with the numbers in the tooltip — the discount is disclosed, not hidden.

**Do not raise `SPREAD_SHRINK` to "fix" a specific player.** It is a variance penalty, not
a lever for opinions about individuals.

### The Off chip is position-aware

Tested on 2025 actuals in Astroworld scoring, team offense predicted fantasy finish
strongly for QBs (Spearman +0.48; no top-12 QB from a bottom-10 offense), moderately for
WRs (+0.28), barely for RBs (+0.17 — Achane RB5 on the #30 offense, Jeanty RB11 on #32)
and not at all for TEs (−0.02). `OFF_TRUST = {QB: full, WR: soft, RB: off, TE: off}`
drives a class on the chip: full colour, 62% opacity, or greyed with a coloured ring.
The tooltip says why. The column key says so too.

### Translating the consensus into this rulebook

`slotv` prices a player by where the FantasyPros consensus ranks him *at his position*.
But FantasyPros ranks for **4-point passing TDs** and Astroworld pays **6**. That gap is
worth ~92 points a season to a 46-TD pocket passer and ~50 to a rushing quarterback, so
the published ordering is systematically wrong for this league.

`translate_consensus()` fixes it without inventing an opinion. For each projection source
it ranks the position pool twice — once under generic scoring (`spts`, via
`astro_points_std` / `sleeper_points_std`, which just subtract `2 * pass_td`) and once
under Astroworld's — and averages how many places each player moves. That shift is applied
to his consensus rank *before* `value_of()` prices it.

It is a **translation of the experts' opinion into this rulebook, not a second opinion.**
Non-QBs barely move: the league is full PPR, which is what the rankings already assume.
QBs move up to ±4 places (2026: Dart −4, Daniels −3.5, Dak +3.5, Stafford +2.5).
The shift is exposed on the page as `cmove` for auditing.

Validated against 2025: Stafford finished **QB1** in Astroworld scoring (442.4 pts, 46
passing TDs, 1 rushing yard) but only QB3 under standard scoring — from a preseason rank
of 17. The correction moves exactly the players it should.

### Value weighting is a user control

`CONSENSUS_WEIGHT = 0.5` in `refresh.py` is only the **shipped default**. The pages carry a
three-way control (`.wchip`, `localStorage['astroworld-weight']`):

| Mode | Consensus weight |
|---|---|
| Balanced (default) | 0.5 |
| Projection-led | 0.25 |
| Projections only | 0 |

`applyWeights()` recomputes `v`, then re-derives **Astro # (`ar`)**, **Edge** and `gap` for
the whole board — Edge by walking ADP order backwards carrying a running max, exactly as
`refresh.py` does.

Two things to know:

* **Balanced restores `v0`/`ar0`/`edge0`**, snapshots of what `refresh.py` shipped, rather
  than recomputing. The payload rounds `slotv`/`ownv` to one decimal, so recomputing would
  drift a tenth from the build. The default view must match the build exactly.
* **It deliberately does NOT change how simulated opponents draft.** `cpuVal()` reads
  `slotv`, because the room drafts off FantasyPros regardless of what you believe.

`maxV` is therefore `let`, not `const`, and is recomputed in `redrawAfterWeights()`.

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
