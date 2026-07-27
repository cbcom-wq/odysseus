# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

Odysseus is building **Trip Workspace slice 1**. The authoritative document is
`docs/superpowers/specs/2026-07-25-trip-workspace-design.md`. Where it disagrees with anything in
`docs/design/`, the spec wins — those are earlier vision documents, not current decisions.

## Architecture

TypeScript end-to-end. No backend server process.

```
apps/web (React + TypeScript)
        ↓ direct imports, no IPC
packages/domain · providers · persistence   (pure TS, zero I/O)
        ↓ Repository adapter
JSON files on disk (Electron)  |  IndexedDB (browser)
```

```
packages/
  domain/        entities, planning-state machine, scheduler,
                 option evaluation, budget rollup. Zero I/O.
  providers/     OptionProvider interface + FixtureProvider
  extraction/    OptionExtractor interface + CLI and API backends:
                 turns a pasted link, screenshot, or text into card fields
  persistence/   Repository interface + file and IndexedDB adapters
  brand/         what the product is called. The only place the name is written.
apps/
  web/           React + Vite — the entire user interface
  desktop/       Electron shell: window, menu, filesystem. No business logic.
```

The desktop shell exposes exactly five calls to the interface (load, save, remove, reveal, and
extractOption), defined once in `packages/persistence/src/bridge.ts` so the main process, preload,
and renderer cannot drift apart. The fifth is the odd one out: reading a pasted link or screenshot
means running the Claude Code CLI, and only the main process can start a process. It is what lets a
desktop user skip the API key entirely. The renderer runs sandboxed with no Node access. Two things there are easy to get wrong and
have already bitten once each: `apps/web` must build with `base: './'` or the shell loads a blank
window from `file://`, and `userData` must be pinned to `STORAGE_NAMESPACE` because Electron
otherwise derives it from the app name.

**Never hardcode the product name.** It is early and may change, so everything user-facing reads
`PRODUCT_NAME` from `packages/brand`. `STORAGE_NAMESPACE` is a separate constant on purpose:
storage identity is not branding, and sharing one string would mean a rename pointed the app at an
empty database with every saved trip apparently gone. The `@odysseus/*` npm scope is internal and
no user ever sees it.

**`packages/domain` must not import anything framework-shaped or perform I/O.** This is load-bearing,
not stylistic. It is what makes the scheduler testable and what makes speculative option evaluation
possible at all (see below).

An earlier design specified Python FastAPI + SQLite behind an embedded browser. That was replaced;
see `docs/design/high_level_sw_architecture.md` §4 for why.

## Core Domain Concepts

**The trip is the primary object.** This is not a booking engine; it is a planning workspace.

### Three workflow phases

1. **Trip Explorer** — "What trip should I take?" — discovery, produces Trip Concepts
2. **Trip Workspace** — where a chosen destination becomes a designed trip. *Current focus.*
3. **Collections** — completed trip archive and memory preservation

### What the Workspace is for

Every part of the trip is an open question with competing answers that differ in **timing, price, and
value**. The user's work is evaluation: *which of these flights is actually better, for this trip?*

Any site can sort flights by price. Only the Workspace knows the cheaper one lands at 7 PM, costs an
evening in Amsterdam, and conflicts with the next morning's train. Committing is what happens at the
end of that process — not the reason the Workspace exists.

### Data model

```
Trip
 ├── Segment (a stay in one place) ── Card ── Option
 └── Connection (movement between) ── Card ── Option
```

- **Card** — a *slot* in the trip ("lodging in Paris"). Owns planning state and anchor.
- **Option** — a *candidate* filling it ("Hotel Alpha, $110/night"). Owns cost, timing, attributes.

Keeping these separate is what lets a decision be settled while its contents stay under comparison.

Card anchors are relative (`segment`, `segment-day` + offset, `connection`), never absolute dates —
absolute anchors break on reflow.

### Planning states

`unplanned → exploring → selected → locked → booked`

**Planning state governs policy, not scheduling.** Two orthogonal axes:

- **Option timing** drives the schedule. An Exploring flight still lands at a specific hour and still
  determines what day you reach Amsterdam.
- **Planning state** drives whether the system may suggest or apply changes.

Locking never hides alternatives — it stops the system volunteering them. Booked additionally rejects
mutation without an explicit unlock.

### Two derived views, one model

The structure layer (segments with flexible min/ideal/max nights) is authored. The dated day grid is
**derived** by the scheduler. It is never a second source of truth.

### Option evaluation

Options are ranked by what they do to the **whole trip**, via speculative apply and diff:

```
applyOption(trip, cardId, optionId) → trip′
diffTrips(trip, trip′)             → TripImpact
```

Because domain is pure and the scheduler deterministic, preview and result run identical code and
cannot drift. `TripImpact` carries whole-trip `costDelta` (so a pricier option that removes a hotel
night correctly reads as cheaper), `usableHoursDelta`, conflicts introduced and resolved, orphaned
cards, and schedule shift.

Options introducing conflicts are **demoted and badged, never hidden**. Scores always expand into the
raw deltas behind them.

## Development Milestones

1. **Phase 1 — Foundation**: domain packages, trip model, persistence, app shell
2. **Phase 2 — Trip Workspace**: Structure and Day views, cards, option comparison, budget *(current)*
3. **Phase 3 — Import & Automation**: document uploads, OCR, confirmation parsing
4. **Phase 4 — Travel Memories**: photo attachments, completed trips, Collections

## Design Principles

- **One workspace**: never split into disconnected Flight/Hotel/Activity pages
- **Cards are reusable**: the same card travels from discovery → booking → archive
- **Optimize the whole trip**: evaluate options by trip-level impact, never by their own price alone
- **Explainable**: any score expands into the deltas that produced it; a number the user cannot
  interrogate is one they will not trust
- **Never silently discard user intent**: orphaned cards surface, conflicts are shown, conflicting
  options are demoted rather than hidden
- **Local-first, cloud-ready**: cloud sync is a Repository adapter, not a redesign
- **AI enhances structured data**: AI-sourced options enter through the same `OptionProvider`
  interface as any other source

## Key Documents

- `docs/superpowers/specs/2026-07-25-trip-workspace-design.md` — **authoritative** for current work
- `docs/design/high_level_sw_architecture.md` — stack, components, packaging
- `docs/design/odysseus_workflow_design.md` — three workflow phases, planning states
- `docs/design/trip_explorer_design_document.md` — Explorer UX, value scoring
- `docs/design/trip_workspace_design_document.md` — Workspace vision, trip objects
- `docs/design_concept_images/` — UI mockups; `trip_workspace_view.png` is the Workspace target
