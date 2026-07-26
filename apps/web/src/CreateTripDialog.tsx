import type { Trip } from '@odysseus/domain';
import { buildNewTrip } from '@odysseus/providers';
import { useState } from 'react';

/**
 * Starting from nothing.
 *
 * Deliberately short. A trip should be usable the moment you can name where you want to go — dates
 * and durations are things the workspace helps you work out, not a gate you pass to get in.
 */
export function CreateTripDialog({
  onCreate,
  onCancel,
}: {
  onCreate: (trip: Trip) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [travelers, setTravelers] = useState('2');
  const [destinations, setDestinations] = useState('');
  const [minNights, setMinNights] = useState('7');
  const [maxNights, setMaxNights] = useState('14');
  const [startDate, setStartDate] = useState('');

  const places = destinations
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean);

  const ready = name.trim().length > 0 && places.length > 0;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    onCreate(
      buildNewTrip({
        name: name.trim(),
        travelers: Math.max(1, Number(travelers) || 1),
        nights: {
          min: Math.max(1, Number(minNights) || 1),
          max: Math.max(Number(minNights) || 1, Number(maxNights) || 1),
        },
        destinations: places,
        ...(startDate ? { startDate } : {}),
      }),
    );
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Start a trip">
      <form className="dialog" onSubmit={submit}>
        <h2>Start a trip</h2>
        <p>Names and rough length are enough. Dates come later, once you start choosing.</p>

        <div className="field">
          <label className="label" htmlFor="trip-name">
            What are you calling it
          </label>
          <input
            id="trip-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Japan in spring"
            autoFocus
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="trip-dest">
            Where are you going
          </label>
          <input
            id="trip-dest"
            value={destinations}
            onChange={(e) => setDestinations(e.target.value)}
            placeholder="Tokyo, Hakone, Kyoto"
          />
          <div className="field__hint">Separate places with commas, in the order you would visit them.</div>
        </div>

        <div className="field">
          <label className="label" htmlFor="trip-start">
            Leaving on
          </label>
          <input
            id="trip-start"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <div className="field__hint">
            Optional. Leave it empty and the trip stays on relative days until a flight or a booking
            fixes it.
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label className="label" htmlFor="trip-travelers">
              Travellers
            </label>
            <input
              id="trip-travelers"
              type="number"
              min="1"
              value={travelers}
              onChange={(e) => setTravelers(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="trip-min">
              Nights, at least
            </label>
            <input
              id="trip-min"
              type="number"
              min="1"
              value={minNights}
              onChange={(e) => setMinNights(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="trip-max">
              At most
            </label>
            <input
              id="trip-max"
              type="number"
              min="1"
              value={maxNights}
              onChange={(e) => setMaxNights(e.target.value)}
            />
          </div>
        </div>

        <div className="actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={!ready}>
            Start planning
          </button>
        </div>
      </form>
    </div>
  );
}
