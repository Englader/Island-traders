import { handOf } from '../ck/cards.js';
import { CK_COSTS } from '../ck/constants.js';
import { barbarianStrength, pillageableCities } from '../ck/engine.js';
import { activeStrength } from '../ck/knights.js';
import { CARDS } from '../core/constants.js';
import { hasAtLeast } from '../core/resources.js';
import type { Action, Card, CardCounts, GameState, PlayerId } from '../core/types.js';
import { topo } from '../rules/queries.js';

/**
 * A simple Cities & Knights fallback for the heuristic bot (smart play is
 * phase 3): it answers every C&K decision with a legal move, buys city
 * improvements whenever it can, keeps its knights up when the barbarians
 * draw near, walls its cities when its hand is large, chases the robber
 * off its own hexes, and otherwise plays the base-game strategy.
 */

function byType<T extends Action['type']>(acts: Action[], type: T): Array<Extract<Action, { type: T }>> {
  return acts.filter((a): a is Extract<Action, { type: T }> => a.type === type);
}

/** Expected pips at an intersection (a rough value of a city). */
function pipsAt(s: GameState, v: string): number {
  let n = 0;
  for (const h of topo(s).vertexHexes[v]) {
    const t = s.board.hexes[h]?.token;
    if (t) n += 6 - Math.abs(7 - t);
  }
  return n;
}

/** Decisions in the expansion's own phases. */
export function ckPhaseAction(s: GameState, p: PlayerId, acts: Action[]): Action | null {
  const ph = s.phase;
  if (ph.kind !== 'ck' || acts.length === 0) return acts[0] ?? null;
  switch (ph.step) {
    case 'pillage': {
      // lose a city without a wall, and the poorest one
      const walls = s.ck!.players[p].walls;
      const options = byType(acts, 'pillageCity');
      options.sort((a, b) => Number(walls.includes(a.vertex)) - Number(walls.includes(b.vertex)) || pipsAt(s, a.vertex) - pipsAt(s, b.vertex));
      return options[0] ?? acts[0];
    }
    case 'defenderDraw': {
      const imp = s.ck!.players[p].improvements;
      const options = byType(acts, 'drawProgress');
      options.sort((a, b) => imp[b.deck] - imp[a.deck]);
      return options[0] ?? acts[0];
    }
    case 'aqueduct': {
      const have = s.players[p].resources;
      const options = byType(acts, 'aqueduct').filter((a) => a.resource !== undefined);
      options.sort((a, b) => have[a.resource!] - have[b.resource!]);
      return options[0] ?? acts[0];
    }
    default:
      return acts[0];
  }
}

/** Discarding on a 7 with commodities in hand: from the biggest piles. */
export function ckDiscardAction(s: GameState, p: PlayerId): Action | null {
  const ph = s.phase;
  if (ph.kind !== 'discard') return null;
  const need = ph.pending[p];
  if (need === undefined) return null;
  const have = handOf(s, p);
  const cards: CardCounts = {};
  for (let i = 0; i < need; i++) {
    let pick: Card | null = null;
    for (const k of CARDS) if (have[k] > 0 && (pick === null || have[k] > have[pick])) pick = k;
    if (pick === null) break;
    have[pick]--;
    cards[pick] = (cards[pick] ?? 0) + 1;
  }
  return { type: 'discard', player: p, cards };
}

/**
 * The expansion's moves worth making now in the main phase, or null to go
 * on with the base-game strategy.
 */
export function ckMainAction(s: GameState, p: PlayerId, acts: Action[]): Action | null {
  const ck = s.ck!;
  // Over the progress card limit (no card effects yet): put one back.
  const discard = byType(acts, 'discardProgress')[0];
  if (discard) return discard;
  // Chase the robber off its own hexes.
  const robber = s.board.robber;
  if (robber) {
    const mine = topo(s).hexVertices[robber].some((v) => s.board.buildings[v]?.owner === p);
    const chase = byType(acts, 'chaseRobber').find((a) => a.piece === 'robber');
    if (mine && chase) return chase;
  }
  // City improvements: commodities have little other use. Metropolis on the best city.
  const improve = byType(acts, 'improveCity');
  if (improve.length > 0) {
    const imp = ck.players[p].improvements;
    improve.sort((a, b) => imp[b.track] - imp[a.track] || (b.vertex ? pipsAt(s, b.vertex) : 0) - (a.vertex ? pipsAt(s, a.vertex) : 0));
    return improve[0];
  }
  // Defence: when the ship is near, keep at least the weakest share of the defence, and Catan safe.
  const cities = pillageableCities(s, p).length;
  const strength = s.players.map((pl) => activeStrength(s, pl.id));
  const defence = strength.reduce((a, b) => a + b, 0);
  const near = ck.barbarians >= 3;
  const weakest = strength[p] <= Math.min(...strength.filter((_, i) => i !== p));
  if (near && cities > 0 && (defence < barbarianStrength(s) || weakest)) {
    const activate = byType(acts, 'activateKnight')[0];
    if (activate) return activate;
    const build = byType(acts, 'buildKnight');
    if (build.length > 0) return build.sort((a, b) => pipsAt(s, b.vertex) - pipsAt(s, a.vertex))[0];
  }
  // A large hand: wall a city.
  const res = s.players[p].resources;
  const handSize = CARDS.reduce((n, k) => n + handOf(s, p)[k], 0);
  const wall = byType(acts, 'buildCityWall')[0];
  if (wall && handSize > 9 && hasAtLeast(res, { ...CK_COSTS.cityWall, brick: 3 })) return wall;
  return null;
}
