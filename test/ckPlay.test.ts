import { describe, expect, it } from 'vitest';
import {
  PROGRESS_CARDS,
  PROGRESS_CARD_NAMES,
  applyAction,
  getTopologyFor,
  legalActions,
  viewFor,
  type Action,
  type GameState,
  type ProgressCardName,
} from '../src/index.js';
import { progressAsk } from '../web/src/game/ask.js';
import { fxFor } from '../web/src/game/fx.js';
import {
  PLAY_KIND,
  harborOffers,
  harvestPreview,
  inventorHexes,
  inventorPartners,
  kindPicks,
  playAsk,
  playedFx,
  playerPicks,
  playsOf,
  progressWhy,
  rollPreview,
  rollPreviewLines,
  saboteurVictims,
  smithSeconds,
  swapDots,
  turnChips,
  weddingGuests,
  type PlayAction,
} from '../web/src/game/progress.js';
import { ckAfterSetup, ckMain, giveCards, giveProgress, knightSpots, placeKnight, setLevels } from '../e2e/ckState.js';

/** Sam's turn after the roll on the beginners' map, holding `cards`. */
function main(cards: ProgressCardName[] = [], seed = 'ck-play'): GameState {
  const s = ckMain(ckAfterSetup(seed));
  giveProgress(s, 0, cards);
  return s;
}

const plays = (s: GameState, card: ProgressCardName, p = 0) => playsOf(legalActions(s, p), card);

function apply(s: GameState, a: Action): GameState {
  const r = applyAction(s, a);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

describe('playing progress cards in the browser: what can be played, and why not', () => {
  it('every card has a way to be played, except the victory point cards', () => {
    for (const c of PROGRESS_CARD_NAMES) expect(PLAY_KIND[c] === null).toBe(!!PROGRESS_CARDS[c].vp);
  });

  it('the legal moves decide: a card the engine offers needs no reason', () => {
    const s = main(['inventor', 'warlord']);
    const legal = legalActions(s, 0);
    expect(progressWhy(viewFor(s, 0), 0, 'inventor', legal)).toBeNull();
    // no knights to activate
    expect(progressWhy(viewFor(s, 0), 0, 'warlord', legal)).toBe('You have no knights');
  });

  it('timing: before the roll only the Alchemist; after it everything else; never on another turn', () => {
    const pre = ckAfterSetup('ck-play');
    giveProgress(pre, 0, ['alchemist', 'inventor']);
    const legal = legalActions(pre, 0);
    expect(progressWhy(viewFor(pre, 0), 0, 'alchemist', legal)).toBeNull();
    expect(progressWhy(viewFor(pre, 0), 0, 'inventor', legal)).toBe('Roll first: progress cards are played after the roll');
    const s = main(['alchemist']);
    expect(progressWhy(viewFor(s, 0), 0, 'alchemist', legalActions(s, 0))).toBe('Played before rolling: keep it for your next turn');
    giveProgress(s, 1, ['spy', 'alchemist']);
    expect(progressWhy(viewFor(s, 1), 1, 'spy', legalActions(s, 1))).toBe('Play it on your own turn, after the roll');
    expect(progressWhy(viewFor(s, 1), 1, 'alchemist', legalActions(s, 1))).toBe('Play it on your own turn, before you roll');
  });

  it('what each card needs: the Bishop waits for the barbarians, the Spy for cards to see, Medicine for its price', () => {
    const s = main(['bishop', 'spy', 'medicine', 'commercialHarbor', 'engineer']);
    const v = viewFor(s, 0);
    const legal = legalActions(s, 0);
    expect(progressWhy(v, 0, 'bishop', legal)).toBe('The robber sleeps until the barbarians first attack');
    expect(progressWhy(v, 0, 'spy', legal)).toBe('Nobody else holds progress cards');
    expect(progressWhy(v, 0, 'medicine', legal)).toBe('It costs 2 ore and 1 grain');
    expect(progressWhy(v, 0, 'commercialHarbor', legal)).toBe('No opponent holds a commodity');
    // one city, no wall yet: the Engineer is playable
    expect(progressWhy(v, 0, 'engineer', legal)).toBeNull();
    s.ck!.players[0].walls.push(Object.entries(s.board.buildings).find(([, b]) => b.owner === 0 && b.type === 'city')![0]);
    expect(progressWhy(viewFor(s, 0), 0, 'engineer', legalActions(s, 0))).toBe('Every one of your cities has a wall');
  });
});

describe('the Alchemist', () => {
  it('previews what a total gives everyone, as the engine then pays it', () => {
    for (const dice of [
      [2, 2],
      [3, 3],
      [4, 5],
      [6, 4],
      [5, 6],
    ] as Array<[number, number]>) {
      const s = ckAfterSetup('ck-play');
      giveProgress(s, 0, ['alchemist']);
      const pv = rollPreview(viewFor(s, null), dice);
      expect(pv.total).toBe(dice[0] + dice[1]);
      const after = apply(s, { type: 'playProgress', player: 0, card: 'alchemist', args: { dice } });
      expect(after.turn.dice).toEqual(dice);
      for (const pl of s.players) {
        const got = pv.gets.find((g) => g.p === pl.id)?.cards ?? {};
        for (const r of ['brick', 'lumber', 'wool', 'grain', 'ore'] as const) {
          expect(after.players[pl.id].resources[r] - s.players[pl.id].resources[r], `${dice} ${pl.name} ${r}`).toBe(got[r] ?? 0);
        }
        for (const c of ['paper', 'cloth', 'coin'] as const) {
          expect(after.ck!.players[pl.id].commodities[c] - s.ck!.players[pl.id].commodities[c], `${dice} ${pl.name} ${c}`).toBe(got[c] ?? 0);
        }
      }
    }
  });

  it('a 7: who discards, and the robber still asleep', () => {
    const s = ckAfterSetup('ck-play');
    giveCards(s, 1, { brick: 6, ore: 4 });
    const v = viewFor(s, 0);
    const pv = rollPreview(v, [3, 4]);
    expect(pv.seven).toBe(true);
    expect(pv.discards).toEqual([{ p: 1, n: Math.floor(v.players[1].resourceCount / 2) }]);
    const lines = rollPreviewLines(v, 0, pv);
    expect(lines.produce[0]).toBe('A 7: nobody produces');
    expect(lines.produce).toContain(`Ada discards ${Math.floor(v.players[1].resourceCount / 2)} cards`);
    expect(lines.produce).toContain('The robber sleeps until the barbarians first attack');
  });

  it('the red die: who would draw on each city gate', () => {
    const s = ckAfterSetup('ck-play');
    setLevels(s, 0, { science: 1 });
    setLevels(s, 2, { science: 3, trade: 1 });
    const v = viewFor(s, 0);
    const pv = rollPreview(v, [1, 2]);
    expect(pv.draws.science).toEqual([0, 2]);
    expect(pv.draws.trade).toEqual([2]);
    expect(pv.draws.politics).toEqual([]);
    expect(rollPreview(v, [1, 4]).draws.science).toEqual([2]);
    const lines = rollPreviewLines(v, 0, pv);
    expect(lines.draws).toEqual(['Yellow gate: Björn draws a trade card', 'Blue gate: nobody draws', 'Green gate: you and Björn draw a science card']);
  });
});

describe('picks on the board', () => {
  it('the Inventor: every swappable number, then only its partners (never the same number)', () => {
    const s = main(['inventor']);
    const ps = plays(s, 'inventor');
    const hexes = inventorHexes(ps);
    expect(hexes.length).toBe(Object.values(s.board.hexes).filter((h) => h.token !== null && ![2, 6, 8, 12].includes(h.token)).length);
    const three = hexes.find((h) => s.board.hexes[h].token === 3)!;
    const partners = inventorPartners(ps, three);
    expect([...partners.keys()].every((h) => s.board.hexes[h].token !== 3)).toBe(true);
    expect(partners.size).toBe(hexes.filter((h) => s.board.hexes[h].token !== 3).length);
  });

  it('the Inventor: how a swap changes the dots on your buildings, as the board then shows', () => {
    const s = main(['inventor']);
    const t = getTopologyFor(s.board.layoutKey);
    // the dots of every number next to Sam's buildings (a city counts twice)
    const total = (x: GameState) =>
      Object.entries(x.board.hexes).reduce((n, [h, hex]) => {
        if (hex.token === null) return n;
        const w = t.hexVertices[h].reduce((k, vx) => k + (x.board.buildings[vx]?.owner === 0 ? (x.board.buildings[vx].type === 'city' ? 2 : 1) : 0), 0);
        return n + w * (6 - Math.abs(7 - hex.token));
      }, 0);
    const ps = plays(s, 'inventor');
    let changed = 0;
    for (const a of ps) {
      const [h1, h2] = a.args!.hexes as [string, string];
      const d = swapDots(viewFor(s, 0), 0, h1, h2);
      expect(d).toBe(total(apply(s, a)) - total(s));
      if (d !== 0) changed++;
    }
    expect(changed).toBeGreaterThan(0);
  });

  it('the Smith: a second knight, while a piece of the next strength is left', () => {
    const s = main(['smith']);
    const [a, b, c] = knightSpots(s, 0);
    placeKnight(s, 0, a, 1, true);
    placeKnight(s, 0, b, 1, false);
    expect(smithSeconds(viewFor(s, 0), 0, plays(s, 'smith'), a)).toEqual([b]);
    // a strong knight already on the board: only one strong piece left, so not both basics
    placeKnight(s, 0, c, 2, false);
    expect(smithSeconds(viewFor(s, 0), 0, plays(s, 'smith'), a)).toEqual([]);
    // the engine agrees: after promoting one basic knight it asks nothing more
    const after = apply(s, { type: 'playProgress', player: 0, card: 'smith', args: { vertex: a } });
    expect(after.phase.kind).toBe('main');
  });
});

describe('the confirmation', () => {
  it('names the card, its choices and what follows', () => {
    const s = main(['spy', 'merchant', 'resourceMonopoly', 'diplomat']);
    giveProgress(s, 1, ['bishop']);
    const v = viewFor(s, 0);
    const spy = plays(s, 'spy')[0];
    expect(playAsk(v, 0, spy).title).toBe('Spy on Ada?');
    expect(playAsk(v, 0, spy).notes[0]).toBe('Ada holds 1 progress card: you see them and may take one');
    const merchant = plays(s, 'merchant')[0];
    expect(playAsk(v, 0, merchant).title).toBe('Place the merchant here?');
    expect(playAsk(v, 0, merchant).notes).toContain('+1 victory point while you hold it');
    const wool = plays(s, 'resourceMonopoly').find((a) => a.args?.resource === 'wool')!;
    expect(playAsk(v, 0, wool).title).toBe('Name wool?');
    const own = plays(s, 'diplomat').find((a) => s.board.pieces[a.args!.edge as string].owner === 0)!;
    expect(playAsk(v, 0, own).title).toBe('Take up your road?');
    const ada = plays(s, 'diplomat').find((a) => s.board.pieces[a.args!.edge as string].owner === 1)!;
    expect(playAsk(v, 0, ada).title).toBe("Remove Ada's road?");
  });

  it('shows the face of the card, and Medicine its price', () => {
    const s = main(['medicine']);
    giveCards(s, 0, { ore: 2, grain: 1 });
    const a = plays(s, 'medicine')[0];
    const ask = progressAsk(a, viewFor(s, 0), 0);
    expect(ask.card).toBe('medicine');
    expect(ask.title).toBe('Upgrade this settlement to a city?');
    expect(ask.cost).toEqual({ ore: 2, grain: 1 });
    expect(ask.left.find((x) => x.r === 'ore')?.n).toBe(s.players[0].resources.ore - 2);
  });

  it('Irrigation and Mining: the gain, as the engine pays it', () => {
    for (const card of ['irrigation', 'mining'] as const) {
      const s = main([card]);
      const h = harvestPreview(viewFor(s, 0), 0, card);
      const a = plays(s, card)[0];
      if (!a) {
        expect(h.amount).toBe(0);
        continue;
      }
      const after = apply(s, a);
      expect(after.players[0].resources[h.resource] - s.players[0].resources[h.resource]).toBe(h.amount);
      expect(playAsk(viewFor(s, 0), 0, a).title).toBe(`Take ${h.amount} ${h.resource}?`);
    }
  });

  it('the Saboteur and the Wedding: who loses or gives what, as the engine asks', () => {
    const s = main(['saboteur', 'wedding']);
    giveCards(s, 1, { brick: 3, wool: 2 });
    s.ck!.players[1].defenders = 1;
    const v = viewFor(s, 0);
    expect(saboteurVictims(v, 0).map((x) => x.p)).toContain(1);
    expect(weddingGuests(v, 0)).toEqual([{ p: 1, n: 2 }]);
    const after = apply(s, plays(s, 'wedding')[0]);
    const ph = after.phase;
    expect(ph.kind === 'ck' && ph.step === 'card' ? ph.pending : null).toEqual({ 1: 2 });
  });
});

describe('the players and kinds offered', () => {
  it('the Spy offers only players with progress cards; the Merchant Fleet every card not at 2:1 already', () => {
    const s = main(['spy', 'merchantFleet']);
    giveProgress(s, 2, ['crane']);
    const picks = playerPicks(viewFor(s, 0), plays(s, 'spy'));
    expect(picks.map((x) => x.p)).toEqual([2]);
    expect(picks[0].detail).toBe('1 progress card');
    const kinds = kindPicks(viewFor(s, 0), 0, plays(s, 'merchantFleet'));
    expect(kinds.length).toBe(8);
    expect(kinds.every((k) => k.rate > 2)).toBe(true);
  });
});

describe('after the card', () => {
  it('Commercial Harbor offers by opponent, and its chip', () => {
    const s = main(['commercialHarbor']);
    giveCards(s, 0, { brick: 1 });
    giveCards(s, 1, { cloth: 1 });
    const after = apply(s, plays(s, 'commercialHarbor')[0]);
    const offers = harborOffers(legalActions(after, 0));
    expect([...offers.keys()]).toEqual([1]);
    expect(offers.get(1)!.map((a) => a.args?.resource)).toContain('brick');
    expect(turnChips(viewFor(after, 2))).toEqual([{ key: 'harbor', card: 'commercialHarbor', label: 'Commercial Harbor', detail: '1 offer open', player: 0 }]);
    const done = apply(after, offers.get(1)!.find((a) => a.args?.resource === 'brick')!);
    expect(turnChips(viewFor(done, 0))[0].detail).toBe('offers made');
  });

  it('the Crane, the Merchant Fleet and the Warlord as chips, for everyone to see', () => {
    const s = main(['crane', 'merchantFleet', 'warlord']);
    giveCards(s, 0, { paper: 1 });
    placeKnight(s, 0, knightSpots(s, 0)[0], 1, false);
    let t = apply(s, plays(s, 'crane')[0]);
    t = apply(t, plays(t, 'merchantFleet').find((a) => a.args?.resource === 'wool')!);
    t = apply(t, plays(t, 'warlord')[0]);
    expect(turnChips(viewFor(t, 1)).map((c) => `${c.label}: ${c.detail}`)).toEqual(['Crane: next improvement −1', 'Merchant Fleet: wool 2:1', 'Warlord: knights activated']);
    // the turn ends: the chips go
    t.phase = { kind: 'main' };
    const next = apply(t, { type: 'endTurn', player: 0 });
    expect(turnChips(viewFor(next, 1))).toEqual([]);
  });

  it('the moment shown to everyone: who played what, on whom', () => {
    const s = main(['spy', 'diplomat']);
    giveProgress(s, 1, ['bishop']);
    const spy = plays(s, 'spy')[0] as PlayAction;
    const before = viewFor(s, 1);
    const after = apply(s, spy);
    const fx = fxFor(spy, before, viewFor(after, 1), 1);
    expect(fx).toEqual({ kind: 'progPlay', by: 0, card: 'spy', target: 1, detail: 'Looks at your progress cards and may take one' });
    expect(playedFx(spy, before, 2).detail).toBe("Looks at Ada's progress cards and may take one");
    const road = plays(s, 'diplomat').find((a) => s.board.pieces[a.args!.edge as string].owner === 1)!;
    expect(playedFx(road, viewFor(s, 1), 1)).toEqual({ target: 1, detail: 'Removes one of your roads' });
  });
});
