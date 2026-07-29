import type { Card, Option } from '@odysseus/domain';
import { describe, expect, it } from 'vitest';
import { mergeOptions } from './provider.js';

const option = (id: string, source: Option['source']): Option => ({
  id,
  source,
  title: id,
  cost: { kind: 'fixed', amount: 100 },
});

const cardWith = (options: Option[], selected?: string): Card => ({
  id: 'c-1',
  kind: 'lodging',
  state: 'exploring',
  anchor: { kind: 'segment', segmentId: 'par' },
  options,
  ...(selected === undefined ? {} : { selectedOptionId: selected }),
});

describe('mergeOptions', () => {
  it('keeps what the user typed and replaces everything fetched', () => {
    const card = cardWith([
      option('mine', 'user'),
      option('old-fixture', 'fixture'),
      option('old-found', 'discovered'),
    ]);
    const merged = mergeOptions(card, [option('new-found', 'discovered')]);
    expect(merged.options.map((o) => o.id)).toEqual(['mine', 'new-found']);
  });

  it('preserves a selection that survived the refresh', () => {
    const card = cardWith([option('mine', 'user'), option('old', 'discovered')], 'mine');
    expect(mergeOptions(card, [option('new', 'discovered')]).selectedOptionId).toBe('mine');
  });

  it('drops a selection that pointed at a replaced option', () => {
    const card = cardWith([option('mine', 'user'), option('old', 'discovered')], 'old');
    expect(mergeOptions(card, [option('new', 'discovered')]).selectedOptionId).toBeUndefined();
  });
});
