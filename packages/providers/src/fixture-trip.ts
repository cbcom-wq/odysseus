import { SCHEMA_VERSION } from '@odysseus/domain';
import type { Card, CardAnchor, CardKind, Option, PlanningState, Trip } from '@odysseus/domain';

/**
 * The seeded demo trip: Amsterdam → Brussels → Paris, from
 * docs/design_concept_images/trip_workspace_view.png.
 *
 * This data is load-bearing, not filler. If every alternative differed only in price, the workspace
 * would have nothing to demonstrate — the whole point is that the cheapest option often costs you
 * something the price does not show. So the options here trade off on purpose:
 *
 *   - a flight $96 cheaper that lands at 21:55 and collides with the canal cruise
 *   - one $46 dearer that hands back an hour and three quarters of the first day
 *   - a hotel $24/night less that sits outside the centre and adds a taxi
 *   - a train and a flight for the same leg, trading fare against hours
 *
 * On the inbound leg: the mockup shows Delta 117 leaving at 19:45 and Hotel Alpha checking in the
 * same evening, which cannot both be true of an eight-hour flight. Resolved here by having it
 * depart Sep 22 and land the morning of Sep 23 — physically honest, and it still produces exactly
 * the dates the mockup draws.
 */

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}`;

function flight(
  id: string,
  title: string,
  detail: string,
  cost: number,
  departDate: string,
  departTime: string,
  arriveTime: string,
  durationMinutes: number,
  nightsInTransit: 0 | 1,
): Option {
  return {
    id,
    source: 'fixture',
    title,
    detail,
    cost: { kind: 'fixed', amount: cost },
    timing: { kind: 'journey', departDate, departTime, arriveTime, nightsInTransit, durationMinutes },
  };
}

function stay(id: string, title: string, detail: string, perNight: number): Option {
  return {
    id,
    source: 'fixture',
    title,
    detail,
    cost: { kind: 'per-night', amount: perNight },
  };
}

function slot(
  id: string,
  title: string,
  detail: string,
  cost: number,
  startTime: string,
  endTime: string,
): Option {
  return {
    id,
    source: 'fixture',
    title,
    detail,
    cost: { kind: 'fixed', amount: cost },
    timing: { kind: 'slot', startTime, endTime },
  };
}

function card(
  id: string,
  kind: CardKind,
  anchor: CardAnchor,
  options: Option[],
  selectedOptionId: string,
  state: PlanningState = 'selected',
): Card {
  return { id, kind, state, anchor, options, selectedOptionId };
}

export function buildFixtureTrip(): Trip {
  counter = 0;

  return {
    id: nextId('trip'),
    name: 'Europe Adventure',
    travelers: 2,
    length: { min: 8, max: 16 },
    currency: 'USD',
    preferences: { ranking: 'balanced', dayStart: '08:00', dayEnd: '22:00' },
    schemaVersion: SCHEMA_VERSION,

    segments: [
      { id: 'ams', location: { name: 'Amsterdam', code: 'AMS' }, duration: { min: 2, ideal: 3, max: 5 } },
      { id: 'bru', location: { name: 'Brussels', code: 'BRU' }, duration: { min: 1, ideal: 2, max: 4 } },
      { id: 'par', location: { name: 'Paris', code: 'PAR' }, duration: { min: 3, ideal: 5, max: 7 } },
    ],

    connections: [
      { id: 'inbound', fromSegmentId: null, toSegmentId: 'ams' },
      { id: 'ams-bru', fromSegmentId: 'ams', toSegmentId: 'bru' },
      { id: 'bru-par', fromSegmentId: 'bru', toSegmentId: 'par' },
      { id: 'outbound', fromSegmentId: 'par', toSegmentId: null },
    ],

    cards: [
      // ---- Getting there. The decision the whole demo turns on. ----
      card(
        'c-inbound',
        'flight',
        { kind: 'connection', connectionId: 'inbound' },
        [
          flight('dl117', 'Delta 117', 'ORD → AMS · 1 stop', 642, '2026-09-22', '19:45', '11:35', 530, 1),
          // Cheapest fare on the board, and it costs the entire first day plus the canal cruise.
          flight('kl602', 'KLM 602', 'ORD → AMS · nonstop', 546, '2026-09-23', '08:15', '21:55', 460, 0),
          // Pay $46, get back an hour and three quarters of Amsterdam.
          flight('af1243', 'Air France 1243', 'ORD → AMS · nonstop', 688, '2026-09-22', '17:30', '09:50', 500, 1),
          flight('ba216', 'British Airways 216', 'ORD → AMS · 1 stop', 602, '2026-09-22', '16:00', '12:15', 555, 1),
          flight('lh440', 'Lufthansa 440', 'ORD → AMS · 1 stop', 629, '2026-09-22', '18:40', '15:05', 565, 1),
        ],
        'dl117',
      ),

      // ---- Amsterdam ----
      card(
        'c-ams-taxi',
        'transport',
        { kind: 'segment-day', segmentId: 'ams', dayOffset: 0 },
        [
          slot('taxi-ams', 'Taxi to hotel', 'Schiphol → Centrum · 25 min', 38, '12:10', '12:35'),
          slot('train-ams', 'Train to Centraal', 'Schiphol → Centraal · 17 min', 12, '12:10', '12:27'),
        ],
        'taxi-ams',
      ),
      card(
        'c-ams-hotel',
        'lodging',
        { kind: 'segment', segmentId: 'ams' },
        [
          stay('alpha', 'Hotel Alpha', 'Centrum · 8.4 · free cancellation', 110),
          // Cheaper per night, but it is a tram ride from everything.
          stay('zaan', 'Zaan Garden Hotel', 'Noord · 8.1 · 20 min to centre', 86),
          stay('canal', 'Canal House', 'Grachtengordel · 9.1 · walk everywhere', 148),
        ],
        'alpha',
      ),
      card(
        'c-ams-cruise',
        'activity',
        { kind: 'segment-day', segmentId: 'ams', dayOffset: 0 },
        [slot('cruise', 'Evening canal cruise', 'Departs Prinsengracht · 90 min', 42, '19:30', '21:00')],
        'cruise',
      ),
      card(
        'c-ams-vangogh',
        'activity',
        { kind: 'segment-day', segmentId: 'ams', dayOffset: 1 },
        [slot('vangogh', 'Van Gogh Museum', 'Timed entry · 2 hrs', 26, '10:00', '12:00')],
        'vangogh',
      ),
      card(
        'c-ams-anne',
        'activity',
        { kind: 'segment-day', segmentId: 'ams', dayOffset: 1 },
        [slot('anne', 'Anne Frank House', 'Timed entry · 90 min', 16, '13:00', '14:30')],
        'anne',
      ),

      // ---- Amsterdam → Brussels ----
      card(
        'c-ams-bru',
        'transport',
        { kind: 'connection', connectionId: 'ams-bru' },
        [
          flight('ic-early', 'Intercity 9221', 'Centraal → Bruxelles-Midi', 42, '2026-09-25', '08:41', '10:34', 113, 0),
          flight('ic-midday', 'Intercity 9229', 'Centraal → Bruxelles-Midi', 42, '2026-09-25', '12:41', '14:34', 113, 0),
          flight('thalys', 'Eurostar 9317', 'Centraal → Bruxelles-Midi · direct', 68, '2026-09-25', '09:17', '11:02', 105, 0),
        ],
        'ic-early',
      ),

      // ---- Brussels ----
      card(
        'c-bru-hotel',
        'lodging',
        { kind: 'segment', segmentId: 'bru' },
        [
          stay('bravo', 'Hotel Bravo', 'Grand Place · 8.6 · breakfast included', 135),
          stay('sablon', 'Le Sablon', 'Sablon · 8.8 · quieter', 152),
        ],
        'bravo',
      ),
      card(
        'c-bru-tour',
        'activity',
        { kind: 'segment-day', segmentId: 'bru', dayOffset: 0 },
        [slot('grandplace', 'Grand Place walking tour', 'Guided · 2 hrs', 20, '11:00', '13:00')],
        'grandplace',
      ),
      card(
        'c-bru-bruges',
        'transport',
        { kind: 'segment-day', segmentId: 'bru', dayOffset: 1 },
        [slot('bruges', 'Day trip to Bruges', 'Train · 1 hr 15 each way', 28, '09:00', '10:15')],
        'bruges',
      ),
      card(
        'c-bru-chocolate',
        'activity',
        { kind: 'segment-day', segmentId: 'bru', dayOffset: 1 },
        [slot('chocolate', 'Chocolate tasting', 'Bruges · 90 min', 35, '14:00', '15:30')],
        'chocolate',
      ),

      // ---- Brussels → Paris ----
      card(
        'c-bru-par',
        'transport',
        { kind: 'connection', connectionId: 'bru-par' },
        [
          flight('af-par', 'Air France 1243', 'BRU → CDG · nonstop', 128, '2026-09-27', '10:20', '11:40', 80, 0),
          // Slower door to door once you count the airport, and $46 less.
          flight('tgv-par', 'TGV 9835', 'Bruxelles-Midi → Paris Nord', 82, '2026-09-27', '10:13', '11:35', 82, 0),
        ],
        'af-par',
      ),

      // ---- Paris ----
      card(
        'c-par-hotel',
        'lodging',
        { kind: 'segment', segmentId: 'par' },
        [
          stay('lumiere', 'Hotel Lumière', '7e · 8.9 · river view', 168),
          stay('marais', 'Maison Marais', 'Le Marais · 8.7', 154),
        ],
        'lumiere',
      ),
      card(
        'c-par-seine',
        'activity',
        { kind: 'segment-day', segmentId: 'par', dayOffset: 0 },
        [slot('seine', 'Seine river cruise', 'Pont Neuf · 1 hr', 18, '19:00', '20:00')],
        'seine',
      ),
      card(
        'c-par-sainte',
        'activity',
        { kind: 'segment-day', segmentId: 'par', dayOffset: 1 },
        [slot('sainte', 'Sainte-Chapelle', 'Timed entry · 1 hr', 12, '10:00', '11:00')],
        'sainte',
      ),

      // ---- Home ----
      card(
        'c-outbound',
        'flight',
        { kind: 'connection', connectionId: 'outbound' },
        [
          flight('dl123', 'Delta 123', 'CDG → ORD · nonstop', 618, '2026-10-02', '13:40', '16:20', 520, 0),
          flight('ua941', 'United 941', 'CDG → ORD · nonstop', 587, '2026-10-02', '10:05', '12:45', 520, 0),
        ],
        'dl123',
      ),
    ],
  };
}
