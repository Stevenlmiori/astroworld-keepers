# Astroworld Keepers — ranking refresh

> **Working on this project? Read [ARCHITECTURE.md](ARCHITECTURE.md) first.**
> It covers the build pipeline, which files are generated (several are — do not edit
> them by hand), how the valuation model works, and the traps that have already
> caught people once.


Re-pulls the FantasyPros PPR consensus and rebuilds the page.

```
cd "keeper-tool"
./update.sh
```

That is the whole thing: it pulls fresh rankings and projections, rebuilds both
pages, and pushes them live. No install step — stdlib only, no pip.

Every page footer shows **Page built <date, time>**, so you can always tell at a
glance whether what you are looking at is current.

## Cadence up to the Sept 2 draft

| When | Why |
|---|---|
| Every 2-3 days through Aug 28 | Preseason injuries and depth-chart moves |
| Aug 26-27 | NFL cutdown to 53 — biggest single shake-up for RB2s, kickers, defenses |
| Daily Aug 30 - Sept 1 | Consensus firms up; the most experts are in by now |
| **Sept 2, a few hours before the draft** | The one that matters. Do this. |

Then leave it alone during the draft. Redeploying mid-draft is safe — your
ticked players are stored in the browser, not in the page — but values shifting
under you while you pick is just confusing.

If the live page looks stale right after an update, hard-refresh
(Cmd+Shift+R, or pull-to-refresh on mobile). GitHub Pages caches for a few
minutes.

`refresh.py` alone rebuilds the local files without publishing, if you ever want
to look before you push.

## The model

Every keeper gets a **0-100 rating**, Madden style, where the number is the
grade: 90s = A, 80s = B, 70s = C, 60s = D, 50s and below = F. 100 is reserved
for a keeper nobody in this league has.

Underneath it is **projected fantasy points gained** by keeping a player instead
of spending that pick. Both are shown in the table.

    score = value(your keeper) - value(best player still on the board at that pick)

Both sides are points above replacement, in this league's exact scoring
(6-pt passing TDs, full PPR) and lineup (QB/WR/WR/WR/RB/RB/TE/flex, 12 teams).
Replacement level is the last player at each position who realistically starts:
QB13, RB28, WR43, TE13.

Two sources, each doing what it is good at:

- **FantasyPros ECR** (100+ experts) decides *who is good* — consensus beats any
  single projection set for ranking players.
- **ESPN season projections** supply only the *shape of positional value* — how
  much a WR10 is worth versus a TE4 versus a QB7.

The "best player still on the board" side simulates the draft: it removes all
twelve kept players from the pool, accounts for the picks those keepers consume,
and reads off who is actually left.

Rosters, 2025 results, eligibility and the 2026 draft order never change, so
they stay frozen in `keepers_base.json` and are never re-scraped.

## Known weaknesses

- Picks past roughly round 8 are valued at zero, which flatters deep keepers.
  Real late picks are lottery tickets with upside no projection captures.
- Projections cannot price suspensions, holdouts or injury tail risk.
- Teams flagged **coin flip** change answer depending on where replacement level
  is set. Four of the twelve currently do. Treat those as ties.
- Keeping a player who costs a first-round pick concentrates risk in one name;
  the model is risk-neutral and does not penalise that.

## What it prints

- Best keeper for each of the 12 teams, in order
- Biggest **keeper-value** moves since the last run, in fantasy points
- **Teams whose best keeper changed** — the thing actually worth acting on
- Any rostered player missing from the FantasyPros list, scored as #560

## Files

| File | What it is |
|---|---|
| `refresh.py` | The script. Run this. |
| `keepers_base.json` | Frozen inputs — rosters, eligibility, keeper cost picks. |
| `template.html` | The page, with `__KEEPER_DATA__` where the data is injected. |
| `last_ranks.json` | Previous run's ranks + scores, for the movement report. |
| `last_run.txt` | Timestamp of the last refresh. |
| `deploy.sh` | Pushes the current page live to GitHub Pages. |
| `site/` | Git checkout of the published site. Do not edit by hand. |

## Tuning

Everything lives at the top of `refresh.py`:

```python
REPLACEMENT = {"QB": 13, "RB": 28, "WR": 43, "TE": 13}
```

Move these and the whole board shifts. Lower RB (say 24) makes running backs
scarcer and lifts every RB keeper. `SCENARIOS` right below is the set of
alternates used to decide whether a team's answer is robust or a coin flip.
`astro_points()` encodes the league scoring. `ANCHORS` maps points-gained onto
the 0-100 rating (piecewise linear); `GRADES` sets the letter cutoffs, which are
just the rating bands.

## If it breaks

FantasyPros embeds the rankings in a `var ecrData = {...}` blob and ESPN serves
projections from a public JSON endpoint. If either changes shape, the script says
so and **leaves the existing page untouched** rather than writing a broken one.

## The three pages

| Page | What it is for |
|---|---|
| [Keepers](https://stevenlmiori.github.io/astroworld-keepers/) | Which keeper each team should take, and why. Analysis, done before Sept 1. |
| [Value Board](https://stevenlmiori.github.io/astroworld-keepers/rankings.html) | Clean reference ranking of every player for this league's format. |
| [Draft Room](https://stevenlmiori.github.io/astroworld-keepers/draft.html) | The live tool. Use it to rehearse now and to run the real draft on Sept 2. |

### Draft Room

* **Keepers block** — set each of the 12 teams' keepers once. They come off the
  board and occupy their true cost pick. They survive **Clear picks**, so you can
  run simulation after simulation without re-entering them. *Use model's picks*
  fills all twelve with the keeper page's recommendation in one click.
* **One tap per pick** — the app knows the snake order and which picks keepers
  consume, so tapping a player drafts him to whoever is on the clock and advances.
  Tap a drafted player again to undo him; *Undo pick* rolls back the last one.
* **Two separate clears** — *Clear picks* wipes the draft but keeps the keepers.
  *Clear keepers* wipes only the keepers. Both need two taps.
* **Draft board** — every pick by team and round, keepers marked **K**, your
  column highlighted.
* Your own keeper and picks feed **My roster** automatically.

Keepers and picks live in that browser's local storage, so pick one device for
draft day. They are per-browser and never leave it.

## Publishing

All three pages are live under **https://stevenlmiori.github.io/astroworld-keepers/** —
public, no sign-in, works on phones. Anyone in the league can just open them.

```
python3 refresh.py && ./deploy.sh
```

`refresh.py` rebuilds the local HTML; `deploy.sh` copies it into `site/` and
pushes to GitHub Pages. The live URL updates 30-60 seconds later. If nothing
changed, `deploy.sh` says so and skips the push.

The page carries a `noindex` tag and the repo serves a `robots.txt` that
disallows crawlers, so it will not turn up in search results — it is reachable
only by people you send the link to.

There is also a Claude artifact version of the same page, but that one requires
viewers to sign in to Claude. The GitHub Pages link is the one to share.
