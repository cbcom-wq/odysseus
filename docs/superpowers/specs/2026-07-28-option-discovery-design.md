# Option Discovery — Claude-driven search

Status: approved 2026-07-28. Extends, and where silent defers to,
`2026-07-25-trip-workspace-design.md`.

## Why

The Workspace exists to evaluate competing options by whole-trip impact, but every option so far
arrives by hand: typed in, or paste-imported one source at a time. The discovery legwork — the
part any travel site already does — is still the user's job. This slice makes the app do it: a
card can go out, search the live web, and come back with real candidates.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Search engine | Claude with web tools, not travel APIs | Covers every card kind, needs no commercial agreements, returns source links. Amadeus/Duffel arrive later as sibling `OptionProvider`s. |
| Trigger | Per-card "Find options" button | Cost and wait are user-initiated and predictable. No auto-search, no whole-trip sweep yet. |
| Where results land | Directly on the card, `source: 'discovered'`, unselected, badged | The OptionsPanel *is* the review surface. User options always survive; a re-search replaces prior discovered options. |
| Card kinds | All but `note` | The machinery is kind-agnostic; quality varies by kind and that is fine. |
| Platform | Desktop CLI only | Runs the Claude Code CLI in the main process like `extractOption` — free with the user's subscription. Browser/API path later behind the same seam. |
| Plumbing | Sixth bridge call + `ClaudeSearchProvider implements OptionProvider` | Finally gives the dormant provider interface its first consumer, exactly where the spec said AI-assist would plug in. |

## Flexible dates are a first-class search

"Brazil for 10–16 days, sometime in March–April 2027, best value" is the searching the app is
*for* — not "flights for these exact dates", which any site can do.

The model already carries most of this: `Trip.length` is a `{min, max}` nights range, and
`anchorDate` is optional (an undated trip schedules on relative days). The missing concept is the
window, so the Trip gains one:

```ts
/** Meaningful while `anchorDate` is absent: the trip starts somewhere inside it. */
readonly dateWindow?: { readonly earliest: IsoDate; readonly latest: IsoDate };
```

When a trip has a window and no anchor, a flight search asks Claude to scan the window for the
best-value **concrete** dates satisfying the length range, and every returned option carries real
depart/return dates plus an explanation of why those dates won. The scheduler needs no change at
all: a selected dated flight already pins the calendar and beats a tentative date, so choosing a
discovered option is what dates the trip — the exact flow the create dialog already promises
("the trip stays on relative days until a flight or a booking fixes it").

## Shape

```
OptionsPanel "Find options"
  → useDiscovery (apps/web)
    → ClaudeSearchProvider (packages/providers) — implements OptionProvider
        buildSearchQuery(trip, card)      pure context: destination, origin,
                                          dates or window+length, party, currency, hints
        transport(query)                  injected; the only I/O
    → bridge.searchOptions(request)       sixth bridge call
      → main process: validate, then searchWithCli (packages/extraction)
          claude --print --output-format json --json-schema …
                 --allowedTools WebSearch,WebFetch --model sonnet
  ← options, Zod-validated in main and again in the renderer
  → discoveredOptions(fields) → Option[] source:'discovered'
  → applyDiscovery: stale-discovered cleanup → mergeOptions → link return legs
```

Every layer mirrors the extraction pipeline, which has already survived contact with the CLI.

## Rules the implementation must keep

- **Only report visited pages.** Each result carries a required `sourceUrl` (and a `sourceName`);
  an option Claude cannot attribute to a page it fetched is not reportable. `sourceUrl` keeps its
  snapshot semantics — never re-fetched.
- **Empty is an answer.** A search that finds nothing returns an empty list (extraction's
  "min 1" rule does not apply) and the UI says so; Claude is told to return nothing rather than
  invent.
- **Nothing is chosen for the user.** Discovered options land unselected; `mergeOptions` never
  selects; return legs mirror the unselected outbound.
- **User options are untouchable.** `mergeOptions` keeps them through every re-search.
- **Re-search cleans up whole fares.** Prior discovered options are removed via `removeOption`
  so their fare-group partners on the homeward card go too — merging alone would strand half a
  round trip.
- **Discovered options are removable but not editable.** Editing runs through the form, which
  stamps `source: 'user'` — allowing it would silently convert provenance.
- **Booked cards do not search.** Booked rejects mutation; the button says why.
- **Providers stay pure.** `ClaudeSearchProvider` takes an injected transport; the CLI spawn
  lives in the main process, the pure builders in `packages/extraction` beside their extraction
  twins.

## Out of scope

Travel-API providers, the browser/API-key search path, whole-trip sweeps, auto-search on card
creation, true CLI-child cancellation (abort abandons the wait, as with extraction), editing
discovered options, re-fetching `sourceUrl`.
