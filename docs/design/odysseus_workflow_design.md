# Travel Planning App - Workflow Architecture v2

## Vision

The application is not a booking engine.

It is an interactive workspace for discovering, designing, optimizing, booking, and preserving memorable trips.

Unlike traditional travel websites that organize planning by booking type (Flights → Hotels → Cars), this application organizes planning around **the trip itself**.

The trip is the primary object.

Everything else exists to build, improve, and document that trip.

---

# Core Workflow

```
            Trip Explorer
                 │
        Discover possibilities
                 │
                 ▼
          Select Trip Concept
                 │
                 ▼
        ╔══════════════════════╗
        ║    Trip Workspace    ║
        ╚══════════════════════╝
                 │
     Design • Compare • Optimize
          Lock • Book • Refine
                 │
                 ▼
      Collections / Trip Archive
```

There are only three major phases of the application.

Each has a single responsibility.

---

# Phase 1 — Trip Explorer

## Purpose

Answer one question:

> **"What trip should I take?"**

The Explorer is intentionally open-ended.

Users may begin with:

* A continent
* A country
* A city
* A budget
* A season
* A travel style
* A bucket list item
* No destination at all

Examples:

* Europe
* Anywhere warm
* National Parks
* Under $3,000
* Best value this October
* Family vacation
* Beach vacation

Explorer should never feel like a booking site.

Its purpose is inspiration and discovery.

---

## Output

Explorer produces **Trip Concepts**.

A Trip Concept is a complete vacation idea.

Examples:

* Portugal Escape
* Classic Italy
* Amsterdam + Belgium
* Scotland Road Trip
* Japan Cherry Blossoms

Each concept contains:

* destinations
* suggested routing
* estimated duration
* estimated budget
* seasonal recommendations
* overall value score

The user selects one concept before moving into planning.

---

# Phase 2 — Trip Workspace

The Workspace is the heart of the application.

Everything after selecting a Trip Concept happens here.

This is **not** a collection of separate Flight, Hotel, or Activity pages.

Instead, there is a single planning environment centered on the trip itself.

## Purpose

Answer the question:

> **"How do I make this trip the best it can be?"**

The Workspace continuously evaluates tradeoffs and updates the trip as the user explores options.

---

# Planning Canvas

The Planning Canvas is the primary interface.

It represents the current version of the trip.

```
Day | Travel | Lodging | Activities | Notes | Daily Cost
```

Every item on the trip is represented as a reusable card.

Examples:

* Flights
* Hotels
* Rental Cars
* Trains
* Ferries
* Restaurants
* Tours
* Museum Tickets
* Reservations
* Notes

These cards are the fundamental building blocks of the application.

The same card is reused throughout:

* search
* planning
* booking
* itinerary
* collections
* trip archive

---

# Dynamic Options Panel

The Workspace includes a contextual options panel.

Selecting a card automatically changes the available options.

Examples:

Selecting a flight displays:

* alternate flights
* alternate airports
* nearby departure dates
* fare trends
* savings opportunities

Selecting a hotel displays:

* similar hotels
* nearby accommodations
* pricing comparisons
* neighborhood insights

Selecting an activity displays:

* related experiences
* nearby attractions
* scheduling suggestions

Users can drag replacement options directly onto the Planning Canvas.

The trip immediately recalculates.

---

# Live Optimization

Every modification immediately updates:

* total cost
* travel time
* itinerary
* transportation
* hotel stays
* activity timing
* overall value score

The Workspace should constantly answer questions like:

* What if I leave one day earlier?
* What if I fly into another city?
* Is this hotel worth $50 more?
* What if I replace this train with a rental car?

Optimization is always performed in the context of the entire trip.

---

# Planning States

Every card has a planning state.

## Unplanned

No option has been selected.

The system recommends possibilities.

## Exploring

The user is actively comparing alternatives.

The system continues suggesting improvements.

## Selected

A preferred option has been chosen.

The system uses this option but still allows replacement.

## Locked

The user has committed to this option.

The planner treats it as a fixed constraint.

Optimization continues around it.

## Booked

Reservations have been completed.

Booking details become part of the card.

The planner never changes booked items unless explicitly unlocked.

---

# Progressive Planning

Planning is expected to happen gradually.

Example:

```
Flights      Booked
Hotels       Locked
Transit      Exploring
Activities   Unplanned
```

The optimization engine should always work within the remaining flexibility.

The goal becomes:

> **Find the best possible trip given the decisions that are already fixed.**

---

# One Shared Trip Model

The Planning Canvas is the source of truth.

Every other view is simply another perspective on the same trip.

Examples:

## Budget View

Calculates totals from trip cards.

## Map View

Displays trip cards geographically.

## Timeline View

Displays trip cards chronologically.

## Booking View

Processes bookings for trip cards.

## Documents

Stores confirmations attached to trip cards.

No duplicate planning data should exist.

---

# Phase 3 — Collections

Once the trip is complete, it moves into Collections.

Collections preserve both the planning process and the completed journey.

Examples:

* Photos
* Boarding passes
* Hotel confirmations
* Tickets
* Reservations
* Notes
* Favorite places
* Expenses
* Memories

Collections also become inspiration for future trips.

---

# Design Principles

## The trip is the product.

Users are never planning flights in isolation.

They are building an entire vacation.

---

## One workspace.

Planning should never require switching between disconnected flight, hotel, and activity pages.

Everything happens within the Planning Canvas.

---

## Cards are reusable.

Every booking, reservation, and activity is represented as a reusable card with a lifecycle that follows it from discovery through booking and into the completed trip.

---

## Progressive commitment.

Planning naturally evolves from exploration to commitment.

The application should support this by allowing individual cards to move from:

Unplanned → Exploring → Selected → Locked → Booked

while continuing to optimize every remaining flexible part of the trip.

---

## Optimize the whole trip.

Every recommendation should consider the impact on the entire vacation—not just the individual booking being viewed.

The application should always help users answer the question:

> **"Is this the best overall version of my trip?"**
