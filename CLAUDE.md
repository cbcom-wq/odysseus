# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

Odysseus is currently in the **design/architecture phase**. The `docs/design/` directory contains the authoritative specifications. No source code has been written yet.

## Architecture

Three-layer local-first Windows desktop application:

```
React + TypeScript (frontend)
         ↕ HTTP / WebSocket
Python FastAPI (backend)
         ↕
SQLite (local database)
```

The executable (`TravelPlanner.exe`) starts the FastAPI server, then opens an embedded browser window loading the React app.

**Planned directory layout:**

```
frontend/src/
  components/   # FlightCard, HotelCard, ActivityCard, Timeline, CollectionCard
  pages/        # Dashboard, TripView, Planner, Collection
  services/     # api.ts (HTTP client to backend)

backend/
  main.py
  api/          # trips.py, events.py, media.py, users.py
  database/     # models.py, database.py
  services/     # document_parser.py, image_processing.py, ai_service.py, travel_import.py
```

## Core Domain Concepts

**The trip is the primary object.** Everything else exists to build, improve, and document that trip. This is not a booking engine; it is a planning workspace.

### Three workflow phases

1. **Trip Explorer** — "What trip should I take?" — discovery and inspiration, produces Trip Concepts
2. **Trip Workspace** — "How do I make this trip the best it can be?" — the Planning Canvas, the heart of the app
3. **Collections** — completed trip archive and memory preservation

### Data model

Everything in a trip is a Travel Event:

```
Trip → Event (Flight | Hotel | Train | Restaurant | Activity | Memory)
```

Example event shape:
```json
{ "type": "flight", "title": "Kansas City to Paris", "date": "2026-09-23",
  "location": "MCI", "destination": "CDG", "status": "confirmed" }
```

### Planning states (card lifecycle)

`Unplanned → Exploring → Selected → Locked → Booked`

- **Locked**: user has committed; treated as a fixed constraint; optimization continues around it
- **Booked**: never changed by the planner unless explicitly unlocked

### Planning Canvas

The single source of truth for a trip. Every other view (Budget, Map, Timeline, Booking, Documents) is a different perspective on the same trip data — no duplicate planning state.

The Dynamic Options Panel is context-sensitive: selecting a card changes what alternatives and insights are shown.

### Travel Card system

Each event type maps to a themed UI card (flight → boarding pass style, hotel → key card style). The same card component is reused throughout Explorer → Workspace → Collections.

## Development Milestones

1. **Phase 1 — Foundation**: Windows shell, FastAPI server, React app, SQLite, trip creation
2. **Phase 2 — Travel Timeline**: Event creation, timeline display, Flight/Hotel/Activity cards
3. **Phase 3 — Import & Automation**: Document/PDF uploads, OCR, confirmation parsing, auto-event creation
4. **Phase 4 — Travel Memories**: Photo attachments, completed trip tracking, Collections, achievement badges

## Design Principles

- **One workspace**: all planning happens inside the Planning Canvas; never split into disconnected Flight/Hotel/Activity pages
- **Cards are reusable**: same card travels from discovery → booking → archive
- **Progressive commitment**: optimize around whatever flexibility remains after locked/booked cards
- **Local-first, cloud-ready**: SQLite now; PostgreSQL migration path should not require architecture redesign
- **AI enhances structured data**: AI layer assists (planning suggestions, document parsing) but does not replace explicit trip objects

## Key Design Documents

- `docs/design/high_level_sw_architecture.md` — tech stack, component directories, data model, desktop packaging
- `docs/design/odysseus_workflow_design.md` — three workflow phases, Planning Canvas, planning states, design principles
- `docs/design/trip_explorer_design_document.md` — Explorer UX, search modes, value scoring, AI assistant integration
- `docs/design/trip_workspace_design_document.md` — Workspace UX, Trip/Location/Activity/Transportation/Lodging objects, optimization engine
