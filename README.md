# Odysseus

A travel planning workspace where a chosen destination becomes a designed trip.

Not a booking engine. Every part of a trip is an open question with competing answers that differ in
timing, price, and value, and the work is deciding between them. Any site can sort flights by price;
this one knows the cheaper one lands at 21:55, costs you an evening in Amsterdam, and collides with
the canal cruise you already picked.

## Running it

```
npm install
npm run dev --workspace @odysseus/web
```

Then open http://localhost:5173. The first run seeds a demo trip; everything after that is saved as
you work.

```
npm test          # all packages
npm run typecheck # all packages
```

## Layout

```
packages/
  domain/        entities, scheduler, option evaluation, budget. Pure, zero I/O.
  providers/     where candidate options come from
  persistence/   saving trips: JSON files on desktop, IndexedDB in a browser
  brand/         what the product is called
apps/
  web/           the interface
```

`packages/domain` imports nothing framework-shaped and performs no I/O. That is what makes the
scheduler testable, and what makes option evaluation possible at all: a candidate is judged by
applying it to a copy of the trip, rerunning the real scheduler, and diffing, so the preview and the
result cannot drift apart.

## Naming

The name is early. Everything user-facing reads from `packages/brand`, so changing it is a one-line
edit. `STORAGE_NAMESPACE` there is deliberately separate from `PRODUCT_NAME`: storage identity is
not branding, and sharing one string would mean a rename pointed the app at an empty database with
every saved trip apparently gone.

## Status

Trip Workspace slice 1. Structure and day views, option comparison by whole-trip impact, manual
entry, and local persistence all work. Live pricing, the map, AI assistance, the Trip Explorer, and
Collections are designed but not built.

See `docs/superpowers/specs/` for the current spec and `docs/design/` for the wider vision.
