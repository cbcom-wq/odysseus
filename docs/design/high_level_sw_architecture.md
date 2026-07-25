# Odysseus — High-Level Software Architecture

> **Revised 2026-07-25.** The original version of this document specified a Python FastAPI backend
> with SQLite, packaged as a Windows executable wrapping an embedded browser. That stack has been
> replaced by TypeScript end-to-end. See
> [`docs/superpowers/specs/2026-07-25-trip-workspace-design.md`](../superpowers/specs/2026-07-25-trip-workspace-design.md)
> for the decision and its rationale. The domain model, card system, and milestones below are
> unchanged.

## 1. Overview

Odysseus is a personal travel planning and memory platform built around the trip as the primary
object. It allows users to:

- Plan trips using interactive travel cards
- Compare flights, hotels, transport, and activities by their effect on the whole trip
- Organize reservations, documents, and notes
- Capture travel memories through photos and documents
- Build a collection of completed travel experiences

The first target is a desktop application, with the same interface running unchanged in a browser and
later on mobile.

## 2. Architectural Goals

**Web-based user experience.** The interface is a modern web application in React and TypeScript. The
same bundle serves the desktop shell, a hosted website, and later a mobile wrapper.

**Local-first operation.** The application works with no cloud connectivity. This protects personal
travel data, works while travelling, and simplifies early development.

**Portability without redesign.** Desktop, web, and mobile are packaging choices, not architectures.
Business logic lives in platform-agnostic packages so that adding a target does not mean rewriting
one.

**Cloud-ready.** Moving from local files to a hosted API and shared database should be an adapter
swap, not a redesign.

## 3. High-Level Architecture

```
+--------------------------------------------------------+
|                  Electron Shell (desktop)              |
|                                                        |
|  +--------------------------------------------------+  |
|  |            React + TypeScript UI                 |  |
|  |                  (apps/web)                      |  |
|  +---------------------+----------------------------+  |
|                        |                               |
|  +---------------------v----------------------------+  |
|  |   domain  ·  providers  ·  persistence           |  |
|  |   pure TypeScript, platform-agnostic             |  |
|  +---------------------+----------------------------+  |
|                        |                               |
|  +---------------------v----------------------------+  |
|  |     Repository adapter — JSON files on disk      |  |
|  +--------------------------------------------------+  |
+--------------------------------------------------------+

The same UI and packages run in a browser, with the repository
adapter backed by IndexedDB instead of the filesystem.
```

There is no local server process and no inter-process protocol. The UI imports the domain packages
directly, which removes an entire class of startup, port-binding, and process-supervision problems
the original design would have had to solve.

## 4. Technology Stack

**Language.** TypeScript throughout — UI, domain logic, and shells.

**Frontend.** React, Vite, React Router, a state management library, and a mapping framework when the
map view arrives.

**Domain logic.** Plain TypeScript with no framework or I/O dependencies. This is a deliberate
constraint: it makes the scheduler testable, allows speculative evaluation of options by running the
real algorithm on a hypothetical trip, and lets identical logic run in a browser, in Electron, and
later on a server.

**Persistence.** One readable JSON file per trip on desktop; IndexedDB in the browser. Both sit behind
a single `Repository` interface. SQLite becomes worthwhile when media and documents make querying
matter — that is a later adapter, not a redesign.

**Desktop shell.** Electron, kept thin: window, menu, and filesystem binding. No business logic.

### Why not Python

The original design placed FastAPI and SQLite behind an embedded browser. Python remains a better
language for the OCR and document-parsing work in Phase 3, but as the application's spine it would
have meant shipping a Python runtime inside the installer, supervising a child process, handling port
conflicts, and maintaining a second language for logic the UI needs synchronously. The web and mobile
targets would each have required a hosted server, eliminating the offline browser build.

When document parsing arrives, it can be an out-of-process service called on demand — a leaf
dependency rather than the spine.

## 5. Application Components

```
packages/
  domain/        entities, planning-state machine, scheduler,
                 option evaluation, budget rollup. Zero I/O.
  providers/     OptionProvider interface + FixtureProvider
  persistence/   Repository interface + file and IndexedDB adapters

apps/
  web/           React + Vite — the entire user interface
  desktop/       Electron shell wrapping apps/web
```

## 6. Core Data Model

The trip is the primary object. A trip is an ordered set of **Segments** — stays in one place — joined
by **Connections**. Both hold **Cards**.

A card is a *slot* in the trip ("lodging in Paris"). It owns a planning state and an anchor. An
**Option** is a *candidate* that could fill it ("Hotel Alpha, $110/night"), owning cost, timing, and
attributes. Keeping these separate is what allows a decision to be settled while its contents are
still under comparison.

```
Trip
 ├── Segment ── Card ── Option
 │                 └─── Option
 └── Connection ── Card ── Option
```

Card kinds: flight, lodging, transport, activity, dining, note.
Planning states: `unplanned → exploring → selected → locked → booked`.

Planning state governs **policy** — whether the system may suggest or apply changes. It does not
govern scheduling; that is driven by the timing of whichever option is currently selected.

## 7. Travel Card System

Cards are the reusable UI unit, themed by kind — a flight renders as a boarding pass, a hotel as a key
card, a train as a ticket. The same component travels from discovery through comparison and booking
into the completed-trip archive. Adding a travel type means adding a card kind, not a new page.

## 8. File and Media Processing

Later phases support importing boarding passes, confirmations, PDFs, and photos:

```
Document or image → parse/OCR → extract travel details → create card → render
```

## 9. AI Integration

AI is a service layer that enhances structured travel data rather than replacing it. Two uses:
planning suggestions grounded in the actual trip model, and turning confirmation documents into
structured cards. AI-sourced options enter through the same `OptionProvider` interface as any other
source.

## 10. Packaging

Electron produces the desktop installer. The browser build is the same `apps/web` bundle deployed as
a static site. A mobile target reuses both the UI and the domain packages.

## 11. Future Expansion

Cloud sync arrives as a third `Repository` adapter speaking to a hosted API, with PostgreSQL behind
it. Because the domain packages have no I/O, they are unchanged by that move.

## 12. Development Milestones

**Phase 1 — Foundation.** Domain packages, trip model, persistence, application shell.

**Phase 2 — Trip Workspace.** Structure and Day views, cards, option comparison, budget. *This is the
current focus; see the slice 1 spec.*

**Phase 3 — Import and Automation.** Document uploads, OCR, confirmation parsing, automatic card
creation.

**Phase 4 — Travel Memories.** Photo attachments, completed trip tracking, Collections.
