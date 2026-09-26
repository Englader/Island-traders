import { describe, expect, it } from 'vitest';
import { createGame, legalActions, topo, viewFor, type Action, type GameState } from '../src/index.js';
import { askFor, leftText, listText } from '../web/src/game/ask.js';

/** Sam's turn after the roll, with a hand; Sam has a settlement on a 2:1 harbor. */
function mainGame(hand: Partial<GameState['players'][number]['resources']> = {}): GameState {
  const s = createGame({ scenario: 'base', players: ['Sam', 'Ada', 'Björn'], seed: 'ask', options: { firstPlayer: 0 } });
  s.turn.number = 1;
  s.turn.part = 1;
  s.turn.current = 0;
  s.turn.actor = 0;
  s.turn.role = 'active';
  s.turn.dice = [3, 4];
  s.phase = { kind: 'main' };
  Object.assign(s.players[0].resources, hand);
  return s;
}

const special = (s: GameState) => s.board.harbors.find((h) => h.type !== 'generic')!;

describe('ask before building', () => {
  it('a development card: the cost, what the hand keeps and the cards left in the deck', () => {
    const s = mainGame({ wool: 1, grain: 3, ore: 4 });
    const ask = askFor([{ type: 'buyDevCard', player: 0 }], viewFor(s, 0), 0)!;
    expect(ask.title).toBe('Buy a development card?');
    expect(ask.choices.map((c) => c.label)).toEqual(['Yes, buy']);
    expect(ask.cost).toEqual({ ore: 1, wool: 1, grain: 1 });
    expect(ask.left).toEqual([
      { r: 'wool', n: 0 },
      { r: 'grain', n: 2 },
      { r: 'ore', n: 3 },
    ]);
    expect(leftText(ask.left)).toBe("You'll have 0 wool, 2 grain and 3 ore left.");
    expect(ask.notes).toContain(`${s.devDeck.length} development cards left in the deck`);
    expect(ask.notes).toContain("You can't play it this turn");
    s.devDeck = s.devDeck.slice(0, 1);
    expect(askFor([{ type: 'buyDevCard', player: 0 }], viewFor(s, 0), 0)!.notes).toContain('This is the last card in the deck');
  });

  it('builds: the last piece, a victory point, a harbor at the spot, and a city', () => {
    const s = mainGame({ brick: 2, lumber: 2, wool: 1, grain: 3, ore: 3 });
    const h = special(s);
    const [v] = topo(s).edgeVertices[h.edge];
    s.players[0].supply.settlements = 1;
    const settle = askFor([{ type: 'buildSettlement', player: 0, vertex: v }], viewFor(s, 0), 0)!;
    expect(settle.title).toBe('Build a settlement here?');
    expect(settle.choices[0].label).toBe('Yes, build');
    expect(settle.notes).toEqual(['+1 victory point', `This spot has a 2:1 ${h.type} harbor`, 'This is your last settlement piece']);
    expect(leftText(settle.left)).toBe("You'll have 1 brick, 1 lumber, 0 wool and 2 grain left.");

    const road = askFor([{ type: 'buildRoad', player: 0, edge: h.edge }], viewFor(s, 0), 0)!;
    expect(road.title).toBe('Build a road here?');
    expect(road.cost).toEqual({ brick: 1, lumber: 1 });
    expect(road.notes).toEqual([]);
    s.players[0].supply.roads = 1;
    expect(askFor([{ type: 'buildRoad', player: 0, edge: h.edge }], viewFor(s, 0), 0)!.notes).toEqual(['This is your last road']);

    s.board.buildings[v] = { owner: 0, type: 'settlement' };
    const city = askFor([{ type: 'buildCity', player: 0, vertex: v }], viewFor(s, 0), 0)!;
    expect(city.title).toBe('Upgrade this settlement to a city?');
    expect(city.notes[0]).toBe('+1 victory point (a city is worth 2)');
    expect(leftText(city.left)).toBe("You'll have 1 grain and 0 ore left.");
  });

  it('when building ends the trading ("trade, then build"), it says so', () => {
    const s = mainGame({ brick: 1, lumber: 1 });
    s.options.tradeBuildMode = 'separate';
    const edge = special(s).edge;
    expect(askFor([{ type: 'buildRoad', player: 0, edge }], viewFor(s, 0), 0)!.notes).toContain("After this you can't trade any more this turn");
    s.turn.buildingStarted = true;
    expect(askFor([{ type: 'buildRoad', player: 0, edge }], viewFor(s, 0), 0)!.notes).toEqual([]);
  });

  it('the starting pieces and the Road Building card are free', () => {
    const s = createGame({ scenario: 'base', players: ['Sam', 'Ada', 'Björn'], seed: 'ask-setup', options: { firstPlayer: 0 } });
    const first = legalActions(s, 0).find((a) => a.type === 'placeSettlement')!;
    const place = askFor([first], viewFor(s, 0), 0)!;
    expect(place.title).toBe('Place your settlement here?');
    expect(place.choices[0].label).toBe('Yes, place');
    expect(place.cost).toBeNull();
    expect(place.left).toEqual([]);

    const g = mainGame();
    g.phase = { kind: 'roadBuilding', remaining: 2, resume: { kind: 'main' } } as GameState['phase'];
    const free = askFor([{ type: 'buildRoad', player: 0, edge: special(g).edge }], viewFor(g, 0), 0)!;
    expect(free.title).toBe('Place a free road here?');
    expect(free.cost).toBeNull();
    expect(free.notes).toEqual(['1 more free piece from the Road Building card after this']);
  });

  it('a coast that takes a road or a ship offers both', () => {
    const s = createGame({ scenario: 'base', players: ['Sam', 'Ada', 'Björn'], seed: 'ask-coast', options: { firstPlayer: 0 } });
    const edge = special(s).edge;
    const both: Action[] = [
      { type: 'placeRoad', player: 0, edge },
      { type: 'placeShip', player: 0, edge },
    ];
    const ask = askFor(both, viewFor(s, 0), 0)!;
    expect(ask.title).toBe('Place your road or ship here?');
    expect(ask.choices.map((c) => [c.label, c.art])).toEqual([
      ['Road', 'road'],
      ['Ship', 'ship'],
    ]);
  });

  it('moving a ship and building a wonder ask too; the robber keeps the confirm bar', () => {
    const s = mainGame({ ore: 3, grain: 2 });
    const edge = special(s).edge;
    expect(askFor([{ type: 'moveShip', player: 0, from: edge, to: edge }], viewFor(s, 0), 0)!.title).toBe('Move your ship here?');
    expect(askFor([{ type: 'moveRobber', player: 0, piece: 'robber', hex: '1,1' } as Action], viewFor(s, 0), 0)).toBeNull();

    s.ext.wonders = { claimed: { monument: 0 }, owned: ['monument', null, null], levels: [3, 0, 0] };
    const wonder = askFor([{ type: 'scenario', player: 0, name: 'buildWonder' }], viewFor(s, 0), 0)!;
    expect(wonder.title).toBe('Build level 4 of the Monument?');
    expect(wonder.cost).toEqual({ ore: 2, grain: 3 });
    expect(wonder.notes).toEqual(['Level 4 finishes the wonder: you win the game']);
    expect(askFor([{ type: 'scenario', player: 0, name: 'claimWonder', args: { wonder: 'theater' } }], viewFor(s, 0), 0)).toBeNull();
  });

  it('lists read naturally', () => {
    expect(listText(['a'])).toBe('a');
    expect(listText(['a', 'b'])).toBe('a and b');
    expect(listText(['a', 'b', 'c'])).toBe('a, b and c');
  });
});
