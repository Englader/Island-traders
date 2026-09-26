import { describe, expect, it } from 'vitest';
import { bankCheck, countsPhrase, pickRules, rowCount, rowKind, rowOf, rowSides, signed, stepRow, stepValue, type BoxRule, type SignedCounts } from '../web/src/game/trade.js';

const rates = { brick: 4, lumber: 3, wool: 2, grain: 4, ore: 4 };

describe('trade row', () => {
  it('splits a row into what you give (negative) and what you get (positive)', () => {
    expect(rowSides({ brick: -1, wool: 2, ore: 0 })).toEqual({ give: { brick: 1 }, get: { wool: 2 } });
    expect(rowSides({})).toEqual({ give: {}, get: {} });
    expect(rowOf({ brick: 1 }, { wool: 2 })).toEqual({ brick: -1, wool: 2 });
    expect(rowSides(rowOf({ grain: 2, ore: 1 }, { lumber: 3 }))).toEqual({ give: { grain: 2, ore: 1 }, get: { lumber: 3 } });
  });

  it('names the kind of offer, with open sides as TradeOffer.open', () => {
    expect(rowKind({ brick: -1, wool: 2 })).toBe('offer');
    expect(rowKind({ wool: 2 })).toBe('give');
    expect(rowKind({ brick: -1 })).toBe('get');
    expect(rowKind({ ore: 0 })).toBe('empty');
  });

  it('steps one card at a time, within the limits', () => {
    const rule: BoxRule = { min: -2, max: 9 };
    let row = stepRow({}, 'brick', 1, rule);
    expect(row).toEqual({ brick: 1 });
    row = stepRow(stepRow(row, 'brick', -1, rule), 'brick', -1, rule);
    expect(row).toEqual({ brick: -1 });
    row = stepRow(row, 'brick', -1, rule);
    expect(row).toEqual({ brick: -2 });
    // giving is capped by the hand
    expect(stepRow(row, 'brick', -1, rule)).toBe(row);
    expect(stepValue(9, 1, rule)).toBeNull();
    // back to zero leaves the resource out
    expect(stepRow({ brick: 1 }, 'brick', -1, rule)).toEqual({});
  });

  it('gives a whole lot per step below zero (bank and harbor rates)', () => {
    const rule: BoxRule = { min: -8, max: 5, lot: 4 };
    expect(stepValue(0, -1, rule)).toBe(-4);
    expect(stepValue(-4, -1, rule)).toBe(-8);
    expect(stepValue(-8, -1, rule)).toBeNull();
    expect(stepValue(-4, 1, rule)).toBe(0);
    expect(stepValue(0, 1, rule)).toBe(1);
    expect(stepValue(1, -1, rule)).toBe(0);
    // too few cards for one lot
    expect(stepValue(0, -1, { min: 0, max: 5, lot: 4 })).toBeNull();
  });

  it('never changes a locked box', () => {
    const rule: BoxRule = { min: -1, max: -1, locked: true };
    expect(stepValue(-1, 1, rule)).toBeNull();
    expect(stepValue(-1, -1, rule)).toBeNull();
    expect(stepRow({ brick: -1 }, 'brick', 1, rule)).toEqual({ brick: -1 });
  });

  it('checks a bank trade: lots given must match the cards taken', () => {
    expect(bankCheck({ brick: -4, ore: 1 }, rates)).toEqual({ lots: 1, cards: 1, ok: true });
    expect(bankCheck({ brick: -4, wool: -2, ore: 1, grain: 1 }, rates)).toEqual({ lots: 2, cards: 2, ok: true });
    expect(bankCheck({ brick: -4, ore: 2 }, rates)).toMatchObject({ lots: 1, cards: 2, ok: false });
    expect(bankCheck({ lumber: -6, ore: 1 }, rates)).toMatchObject({ lots: 2, cards: 1, ok: false });
    expect(bankCheck({ brick: -3, ore: 1 }, rates).ok).toBe(false);
    expect(bankCheck({}, rates)).toEqual({ lots: 0, cards: 0, ok: false });
  });

  it('reads out counts and signs', () => {
    expect(countsPhrase({ brick: 1 })).toBe('1 brick');
    expect(countsPhrase({ brick: 1, wool: 2 })).toBe('1 brick and 2 wool');
    expect(countsPhrase({ brick: 1, wool: 2, ore: 3 })).toBe('1 brick, 2 wool and 3 ore');
    expect(countsPhrase({})).toBe('nothing');
    expect([signed(2), signed(-1), signed(0)]).toEqual(['+2', '−1', '0']);
  });
});

describe('picking cards (discards on a 7, free resources)', () => {
  const hand = { brick: 3, lumber: 2, wool: 1, grain: 3, ore: 0 };

  it('discards up to what you hold, and stops at the number owed', () => {
    let row: SignedCounts = {};
    const tap = (r: keyof typeof hand) => (row = stepRow(row, r, -1, pickRules(row, 4, hand, -1)[r]));
    expect(pickRules(row, 4, hand, -1).brick).toEqual({ min: -3, max: 0 });
    // nothing to discard of ore, and nothing to take back yet
    expect(stepValue(0, -1, pickRules(row, 4, hand, -1).ore)).toBeNull();
    expect(stepValue(0, 1, pickRules(row, 4, hand, -1).brick)).toBeNull();
    tap('wool');
    tap('wool');
    expect(row).toEqual({ wool: -1 });
    tap('brick');
    tap('brick');
    tap('grain');
    expect(rowCount(row)).toBe(4);
    // four picked: no box goes further, but each can be taken back
    const full = pickRules(row, 4, hand, -1);
    for (const r of ['brick', 'lumber', 'wool', 'grain', 'ore'] as const) expect(stepValue(row[r] ?? 0, -1, full[r])).toBeNull();
    expect(stepValue(-2, 1, pickRules(row, 4, hand, -1).brick)).toBe(-1);
    tap('lumber');
    expect(rowSides(row).give).toEqual({ brick: 2, wool: 1, grain: 1 });
  });

  it('takes up to what the bank has', () => {
    const bank = { brick: 0, lumber: 19, wool: 1, grain: 19, ore: 19 };
    expect(pickRules({}, 2, bank, 1).brick).toEqual({ min: 0, max: 0 });
    expect(pickRules({}, 2, bank, 1).wool).toEqual({ min: 0, max: 1 });
    expect(pickRules({ wool: 1, ore: 1 }, 2, bank, 1).ore).toEqual({ min: 0, max: 1 });
    expect(pickRules({ wool: 1, ore: 1 }, 2, bank, 1).grain).toEqual({ min: 0, max: 0 });
    expect(rowCount({ wool: 1, ore: -2 })).toBe(3);
  });
});
