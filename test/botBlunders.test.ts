import { describe, expect, it } from 'vitest';
import { auditGame, BLUNDER_KINDS, edgeLeadsSomewhere, type BlunderKind } from '../src/bots/audit.js';
import { planExpansion, raceFactor } from '../src/bots/expansion.js';
import { botProfile, expansionOf } from '../src/bots/heuristicBot.js';
import {
  BOT_LEVELS,
  applyAction,
  createGame,
  edgeAllowsShip,
  edgeBetween,
  heuristicAction,
  legalRoads,
  potentialField,
  topo,
  vertexTouchesLand,
  type Action,
  type BotLevel,
  type GameState,
  type PlayerId,
  type VertexId,
} from '../src/index.js';
import { bare, giveC, knight } from './ckHelpers.js';
import { C, act, blank, give, put, road, ship } from './helpers.js';

/**
 * The computer players' blunders and their fixes (src/bots/expansion.ts,
 * src/bots/heuristicBot.ts, src/bots/ckBot.ts), and the blunder audit that
 * counts them (src/bots/audit.ts, `npm run bots:audit`).
 */

/** The bot's move, which the engine must accept. */
function move(s: GameState, p: PlayerId, level: BotLevel): Action {
  const a = heuristicAction(s, p, level);
  expect(a, `a move for ${p} at ${level}`).not.toBeNull();
  expect(applyAction(s, a!).ok, JSON.stringify(a)).toBe(true);
  return a!;
}

/** Player 0's settlement on the centre hex with a road to the next corner; the road can go on toward the opponent's city. */
function cutOff(): { s: GameState; dead: string; city: VertexId } {
  const s = blank('base', 3, {}, 'cut-off');
  const [a, b, c] = [C(0, 0, 0), C(0, 0, 1), C(0, 0, 2)];
  put(s, a, 0);
  road(s, edgeBetween(topo(s), a, b)!, 0);
  // the opponent's city right where the road would go next
  put(s, c, 1, 'city');
  give(s, 0, { brick: 1, lumber: 1 });
  return { s, dead: edgeBetween(topo(s), b, c)!, city: c };
}

describe('dead-end roads', () => {
  it("never builds a road into an opponent's city that cuts its way, at any level", () => {
    const { s, dead, city } = cutOff();
    expect(legalRoads(s, 0)).toContain(dead);
    // the cause of the old bug: value spread into the opponent's intersection, so a road ending there scored well
    expect(potentialField(s, 0).has(city)).toBe(false);
    expect(expansionOf(s, 0, botProfile('hard')).byEdge.get(`road:${dead}`)?.gain).toBe(0);
    // the audit agrees that the road leads nowhere
    expect(edgeLeadsSomewhere(s, 0, dead, 'road')).toBe(false);
    for (const level of BOT_LEVELS) {
      const a = move(s, 0, level);
      expect(a.type === 'buildRoad' && a.edge === dead, `${level} builds into the city`).toBe(false);
    }
    // with the city gone, the same road heads somewhere again
    delete s.board.buildings[city];
    expect(expansionOf(s, 0, botProfile('hard')).byEdge.get(`road:${dead}`)!.gain).toBeGreaterThan(0);
  });

  it('keeps its cards when every road it could build is a dead end, while saving for a city', () => {
    const s = blank('base', 3, {}, 'walled-in');
    const t = topo(s);
    const a = C(0, 0, 0);
    put(s, a, 0);
    const [n1, ...rest] = t.vertexNeighbors[a];
    // its road runs to n1, where an opponent's city stands next in line; past the other
    // intersections the opponent's roads close every way
    road(s, edgeBetween(t, a, n1)!, 0);
    const city = t.vertexNeighbors[n1].find((v) => v !== a)!;
    put(s, city, 1, 'city');
    for (const n of [n1, ...rest]) {
      for (const e of t.vertexEdges[n]) if (!t.edgeVertices[e].includes(a) && !t.edgeVertices[e].includes(city)) road(s, e, 2);
    }
    give(s, 0, { brick: 1, lumber: 1, ore: 2, grain: 2 });
    expect(legalRoads(s, 0)).toContain(edgeBetween(t, n1, city));
    for (const e of legalRoads(s, 0)) expect(edgeLeadsSomewhere(s, 0, e, 'road')).toBe(false);
    for (const level of BOT_LEVELS) expect(move(s, 0, level).type, level).not.toBe('buildRoad');
  });

  it('drops a target as soon as an opponent takes it, and heads for another', () => {
    const { s, city } = cutOff();
    delete s.board.buildings[city];
    const before = planExpansion(s, 0, { value: () => 10 });
    const target = before.best!.toward!;
    expect(before.targets.map((x) => x.vertex)).toContain(target);
    // an opponent settles there
    put(s, target, 2);
    const after = planExpansion(s, 0, { value: () => 10 });
    expect(after.targets.map((x) => x.vertex)).not.toContain(target);
    expect(after.best?.toward).not.toBe(target);
    for (const o of after.options) if (o.gain > 0) expect(o.toward).not.toBe(target);
  });

  it('counts a spot an opponent reaches sooner for less', () => {
    expect(raceFactor(2, 5)).toBe(1);
    expect(raceFactor(2, 2)).toBeLessThan(1);
    expect(raceFactor(2, 1)).toBeLessThan(raceFactor(2, 2));
    const { s, city } = cutOff();
    delete s.board.buildings[city];
    const free = planExpansion(s, 0, { value: () => 10 });
    const spot = free.targets.find((x) => x.spot && x.dist >= 1)!;
    // an opponent's road already touches the spot: it can settle there first
    const t = topo(s);
    road(s, t.vertexEdges[spot.vertex].find((e) => !s.board.pieces[e])!, 2);
    const raced = planExpansion(s, 0, { value: () => 10 }).targets.find((x) => x.vertex === spot.vertex)!;
    expect(raced.rival).toBe(0);
    expect(raced.score).toBeLessThan(spot.score);
    expect(planExpansion(s, 0, { value: () => 10, race: false }).targets.find((x) => x.vertex === spot.vertex)!.score).toBe(spot.score);
  });

  it("never sends a ship into an opponent's coastal settlement", () => {
    const s = blank('test-sea', 3, {}, 'ships');
    const t = topo(s);
    // a coastal settlement of player 0, a ship out to sea, and an opponent's settlement where the next ship would end
    const start = t.vertexIds.find((v) => vertexTouchesLand(s, v) && t.vertexEdges[v].some((e) => edgeAllowsShip(s, e)))!;
    put(s, start, 0);
    const first = t.vertexEdges[start].find((e) => edgeAllowsShip(s, e))!;
    ship(s, first, 0);
    const mid = t.edgeVertices[first].find((v) => v !== start)!;
    const next = t.vertexEdges[mid].find((e) => e !== first && edgeAllowsShip(s, e))!;
    const end = t.edgeVertices[next].find((v) => v !== mid)!;
    put(s, end, 1);
    give(s, 0, { lumber: 1, wool: 1 });
    expect(expansionOf(s, 0, botProfile('hard')).byEdge.get(`ship:${next}`)?.gain ?? 0).toBe(0);
    expect(edgeLeadsSomewhere(s, 0, next, 'ship')).toBe(false);
    for (const level of BOT_LEVELS) {
      const a = move(s, 0, level);
      expect(a.type === 'buildShip' && a.edge === next, level).toBe(false);
    }
  });
});

describe('other blunders', () => {
  it('never puts the robber on its own hex, or where it hurts nobody, while an opponent can be hit', () => {
    const s = blank('base', 3, {}, 'robber');
    const t = topo(s);
    const hexes = Object.keys(s.board.hexes).filter((h) => s.board.hexes[h].token !== null);
    const [mine, theirs] = hexes;
    put(s, t.hexVertices[mine][0], 0);
    put(s, t.hexVertices[theirs].find((v) => !t.vertexNeighbors[v].some((n) => s.board.buildings[n]) && !s.board.buildings[v])!, 1);
    s.board.robber = Object.keys(s.board.hexes).find((h) => s.board.hexes[h].terrain === 'desert')!;
    s.phase = { kind: 'robber', reason: 'seven', resume: { kind: 'main' } };
    for (const level of BOT_LEVELS) {
      const a = move(s, 0, level);
      expect(a.type).toBe('moveRobber');
      const hex = (a as Extract<Action, { type: 'moveRobber' }>).hex;
      const owners = t.hexVertices[hex].map((v) => s.board.buildings[v]?.owner).filter((o) => o !== undefined);
      expect(owners, `${level} robs itself`).not.toContain(0);
      expect(owners.length, `${level} robs nobody`).toBeGreaterThan(0);
    }
  });

  it('keeps the cards of a settlement it can build when it discards on a 7, at every level', () => {
    const s = blank('base', 3, {}, 'discard');
    const t = topo(s);
    const a = C(0, 0, 0);
    put(s, a, 0);
    const b = t.vertexNeighbors[a][0];
    const c = t.vertexNeighbors[b].find((v) => v !== a)!;
    road(s, [edgeBetween(t, a, b)!, edgeBetween(t, b, c)!], 0);
    give(s, 0, { brick: 1, lumber: 1, wool: 1, grain: 1, ore: 4 });
    s.phase = { kind: 'discard', pending: { 0: 4 }, resume: { kind: 'main' } };
    for (const level of BOT_LEVELS) {
      const d = move(s, 0, level) as Extract<Action, { type: 'discard' }>;
      expect(d.cards, level).toEqual({ ore: 4 });
    }
  });

  it('turns down an offer that gets none of its builds any closer', () => {
    let s = blank('base', 3, {}, 'offer');
    put(s, C(0, 0, 0), 1);
    // Bo holds exactly a settlement's cards; Ada offers a fourth ore for its grain
    give(s, 0, { ore: 1 });
    give(s, 1, { brick: 1, lumber: 1, wool: 1, grain: 1, ore: 3 });
    s = act(s, { type: 'proposeTrade', player: 0, give: { ore: 1 }, get: { grain: 1 }, to: [1] });
    for (const level of BOT_LEVELS) expect(move(s, 1, level).type, level).toBe('rejectTrade');
  });

  it('hard builds a city and a settlement in one turn, trading for the card it lacks', () => {
    let s = blank('base', 3, {}, 'two-builds');
    s.board.harbors = [];
    const t = topo(s);
    const a = C(0, 0, 0);
    put(s, a, 0);
    const b = t.vertexNeighbors[a][0];
    const c = t.vertexNeighbors[b].find((v) => v !== a)!;
    road(s, [edgeBetween(t, a, b)!, edgeBetween(t, b, c)!], 0);
    give(s, 0, { ore: 3, grain: 2, brick: 1, lumber: 1, wool: 5 });
    const built: string[] = [];
    for (let i = 0; i < 20; i++) {
      const m = heuristicAction(s, 0, 'hard')!;
      if (m.type === 'endTurn') break;
      if (m.type === 'buildCity' || m.type === 'buildSettlement') built.push(m.type);
      s = act(s, m);
      // nobody takes its offers
      for (const tr of s.turn.trades) for (const q of tr.to) if (!tr.rejected.includes(q)) s = act(s, { type: 'rejectTrade', player: q, tradeId: tr.id });
    }
    expect(built.sort()).toEqual(['buildCity', 'buildSettlement']);
  });
});

describe('the pirate', () => {
  /**
   * The test-sea map: the leader (player 1) has a coastal settlement on one
   * 8-pip hex, which the robber already blocks, and a ship out toward the
   * islet; a weaker player (2) has a city on a 6. Player 0 moves the robber
   * or the pirate.
   */
  function sea(): { s: GameState; leaderShip: string } {
    const s = blank('test-sea', 3, {}, 'pirate');
    const t = topo(s);
    const landOf = (v: VertexId) => t.vertexHexes[v].filter((h) => ['forest', 'pasture', 'hills', 'mountains', 'fields'].includes(s.board.hexes[h].terrain));
    const coastal = (v: VertexId) => landOf(v).length === 1 && t.vertexEdges[v].some((e) => edgeAllowsShip(s, e));
    const lead = t.vertexIds.find(coastal)!;
    const hex = landOf(lead)[0];
    s.board.hexes[hex].token = 8;
    put(s, lead, 1);
    const leaderShip = t.vertexEdges[lead].find((e) => edgeAllowsShip(s, e))!;
    ship(s, leaderShip, 1);
    s.players[1].bonusVP = 5;
    // the weaker player, on another hex, far from the leader
    const weak = t.vertexIds.find((v) => vertexTouchesLand(s, v) && !landOf(v).includes(hex) && landOf(v).length > 0 && !t.vertexNeighbors[v].some((n) => s.board.buildings[n]) && v !== lead)!;
    put(s, weak, 2, 'city');
    for (const h of landOf(weak)) s.board.hexes[h].token = 6;
    give(s, 1, { brick: 1, grain: 2 });
    give(s, 2, { wool: 2 });
    s.board.robber = hex;
    s.board.pirate = null;
    s.phase = { kind: 'robber', reason: 'seven', resume: { kind: 'main' } };
    return { s, leaderShip };
  }

  it("moves the pirate onto the leader's ship when the robber already blocks the leader", () => {
    const { s, leaderShip } = sea();
    for (const level of ['medium', 'hard'] as const) {
      const a = move(s, 0, level) as Extract<Action, { type: 'moveRobber' }>;
      expect(a.piece, level).toBe('pirate');
      expect(topo(s).edgeHexes[leaderShip], level).toContain(a.hex);
      expect(a.victim, level).toBe(1);
    }
  });

  it('still moves the robber when that hurts the leader more', () => {
    const { s } = sea();
    // the robber stands on nothing: the leader's 8 is worth taking
    s.board.robber = Object.keys(s.board.hexes).find((h) => s.board.hexes[h].terrain === 'hills' && !topo(s).hexVertices[h].some((v) => s.board.buildings[v]))!;
    for (const level of ['medium', 'hard'] as const) expect((move(s, 0, level) as Extract<Action, { type: 'moveRobber' }>).piece, level).toBe('robber');
  });
});

describe('Cities & Knights blunders', () => {
  /** Three cities on a bare board; the others' knights awake, player 0's asleep; the ship one move out. */
  function lastMove(): GameState {
    const s = bare();
    put(s, C(0, 0, 0), 0, 'city');
    put(s, C(-2, 0, 0), 1, 'city');
    put(s, C(0, -2, 0), 2, 'city');
    knight(s, C(-2, 2, 0), 1, 1, true);
    knight(s, C(2, -2, 3), 2, 1, true);
    knight(s, C(0, 0, 2), 0, 1);
    s.ck!.barbarians = 6;
    return s;
  }

  it('trades for the grain to wake its knight when the ship is about to land, at every level', () => {
    const s = lastMove();
    give(s, 0, { brick: 4 });
    for (const level of BOT_LEVELS) expect(move(s, 0, level), level).toEqual({ type: 'bankTrade', player: 0, give: { brick: 4 }, get: { grain: 1 } });
  });

  it('keeps its only awake knight at home right before an attack', () => {
    const s = lastMove();
    s.ck!.knights[C(0, 0, 2)].active = true;
    s.ck!.attacks = 1;
    // the robber on its own hex, next to the knight
    s.board.hexes['0,0'].terrain = 'fields';
    s.board.hexes['0,0'].token = 8;
    s.board.robber = '0,0';
    for (const level of BOT_LEVELS) expect(move(s, 0, level).type, level).not.toBe('chaseRobber');
  });

  it('uses a Merchant Fleet once it has played one', () => {
    const s = bare();
    put(s, C(0, 0, 0), 0, 'city');
    give(s, 0, { brick: 4 });
    giveC(s, 0, {});
    s.ck!.turnEffects.push({ player: 0, effect: 'merchantFleet', data: 'brick' });
    for (const level of BOT_LEVELS) {
      const a = move(s, 0, level);
      expect(a.type, level).toBe('bankTrade');
      expect((a as Extract<Action, { type: 'bankTrade' }>).give, level).toEqual({ brick: 2 });
    }
  });
});

describe('the blunder audit', () => {
  const quiet = (kinds: BlunderKind[]) => (b: { kind: BlunderKind }) => kinds.includes(b.kind);
  // what even the easy level never does
  const absurd: BlunderKind[] = ['deadEndRoad', 'roadOverBuild', 'missedBuild', 'robberOwnHex', 'robberEmptyHex', 'badDiscard', 'stuck'];
  const modes = ['base', 'seafarers-1-new-shores', 'seafarers-4-through-the-desert', 'ck', 'ck:seafarers-1-new-shores'];
  for (const mode of modes) {
    it(`finds no blunders by medium and hard players in ${mode}, and none of the absurd ones by easy players`, () => {
      const ck = mode.startsWith('ck');
      const scenario = mode.startsWith('ck:') ? mode.slice(3) : ck ? 'base' : mode;
      for (const level of BOT_LEVELS) {
        const start = createGame({ scenario, players: 3, seed: `audit-${mode}-3p-0`, options: { firstPlayer: 0, ...(ck ? { citiesAndKnights: true } : {}) } });
        const r = auditGame(start, start.players.map(() => level), heuristicAction, ck ? 12000 : 6000);
        expect(r.state.phase.kind).toBe('gameOver');
        const found = r.blunders.filter(quiet(level === 'easy' ? absurd : BLUNDER_KINDS));
        expect(found.map((b) => `${b.kind}: ${b.detail}`), `${level} in ${mode}`).toEqual([]);
      }
    });
  }
});
