import type { GameState, Knight, KnightLevel, PlayerId, VertexId } from '../core/types.js';
import { topo, vertexTouchesLand } from '../rules/queries.js';
import { ABILITY_LEVEL, KNIGHTS_PER_LEVEL } from './constants.js';

/**
 * Knights (5th-edition rules pp. 6, 9-10). A knight stands on an
 * intersection, never with a building or another knight. It is placed on an
 * empty intersection touching its owner's road, ignores the distance rule,
 * blocks other players' roads and breaks their Longest Road. Active knights
 * that were not activated this turn may move, displace or chase the robber;
 * acting turns them inactive.
 */

export const KNIGHT_NAMES: Record<KnightLevel, string> = { 1: 'basic knight', 2: 'strong knight', 3: 'mighty knight' };

export function knightsOf(s: GameState, p: PlayerId): Array<[VertexId, Knight]> {
  return Object.entries(s.ck?.knights ?? {}).filter(([, k]) => k.owner === p);
}

/** Knights of a level still in the player's supply (2 of each level; a promoted knight's old token returns). */
export function knightsInSupply(s: GameState, p: PlayerId, level: KnightLevel): number {
  return KNIGHTS_PER_LEVEL - knightsOf(s, p).filter(([, k]) => k.level === level).length;
}

/** Sum of the player's active knights' strength (the defence against the barbarians). */
export function activeStrength(s: GameState, p: PlayerId): number {
  let n = 0;
  for (const [, k] of knightsOf(s, p)) if (k.active) n += k.level;
  return n;
}

/** Active, and not activated during this part of the turn. */
export function knightCanAct(s: GameState, k: Knight): boolean {
  return k.active && k.activatedPart !== s.turn.part;
}

function empty(s: GameState, v: VertexId): boolean {
  return !s.board.buildings[v] && !s.ck?.knights[v];
}

/** Touches one of the player's roads (or ships: "rules for roads also apply to ships", p. 13). */
export function onOwnRoute(s: GameState, p: PlayerId, v: VertexId): boolean {
  return (topo(s).vertexEdges[v] ?? []).some((e) => s.board.pieces[e]?.owner === p);
}

export function knightPlacementError(s: GameState, p: PlayerId, v: VertexId): string | null {
  if (!topo(s).vertexEdges[v]) return 'no such intersection';
  if (!empty(s, v)) return 'the intersection is occupied';
  // A new knight goes on land; only a moved knight may stand at sea (p. 13).
  if (!vertexTouchesLand(s, v)) return 'knights are placed on land';
  if (!onOwnRoute(s, p, v)) return 'a knight must be placed on your road';
  if (knightsInSupply(s, p, 1) <= 0) return 'you have no basic knight left (promote one first)';
  return null;
}

/**
 * Where a knight at `from` can go along its owner's roads (and ships): it
 * may pass intersections with the owner's own buildings and knights, never
 * other players' pieces. `moves` are empty intersections; `targets` hold
 * another player's knight it could displace (not passed through).
 */
export function knightReach(s: GameState, p: PlayerId, from: VertexId): { moves: VertexId[]; targets: VertexId[] } {
  const t = topo(s);
  const seen = new Set<VertexId>([from]);
  const stack: VertexId[] = [from];
  const moves: VertexId[] = [];
  const targets: VertexId[] = [];
  while (stack.length > 0) {
    const v = stack.pop()!;
    for (const e of t.vertexEdges[v]) {
      if (s.board.pieces[e]?.owner !== p) continue;
      const [a, b] = t.edgeVertices[e];
      const w = a === v ? b : a;
      if (seen.has(w)) continue;
      seen.add(w);
      const building = s.board.buildings[w];
      const knight = s.ck?.knights[w];
      if ((building && building.owner !== p) || (knight && knight.owner !== p)) {
        if (!building && knight) targets.push(w);
        continue;
      }
      if (!building && !knight) moves.push(w);
      stack.push(w);
    }
  }
  return { moves: moves.sort(), targets: targets.sort() };
}

export function moveKnightError(s: GameState, p: PlayerId, from: VertexId, to: VertexId): string | null {
  const k = s.ck?.knights[from];
  if (!k || k.owner !== p) return 'you have no knight there';
  if (!knightCanAct(s, k)) return k.active ? 'a knight activated this turn cannot act until your next turn' : 'the knight is not active';
  if (!knightReach(s, p, from).moves.includes(to)) return 'the knight cannot reach that intersection along your roads';
  return null;
}

export function displaceError(s: GameState, p: PlayerId, from: VertexId, to: VertexId): string | null {
  const k = s.ck?.knights[from];
  if (!k || k.owner !== p) return 'you have no knight there';
  if (!knightCanAct(s, k)) return k.active ? 'a knight activated this turn cannot act until your next turn' : 'the knight is not active';
  const other = s.ck?.knights[to];
  if (!other || other.owner === p) return 'there is no opposing knight there';
  if (other.level >= k.level) return 'only a stronger knight can displace another';
  if (!knightReach(s, p, from).targets.includes(to)) return 'the knight cannot reach that intersection along your roads';
  return null;
}

/** Empty intersections a displaced knight of `owner` can retreat to from `from`, along the owner's roads (p. 10). */
export function retreatSpots(s: GameState, owner: PlayerId, from: VertexId): VertexId[] {
  return knightReach(s, owner, from).moves.filter((v) => v !== from);
}

export function promoteError(s: GameState, p: PlayerId, v: VertexId): string | null {
  const k = s.ck?.knights[v];
  if (!k || k.owner !== p) return 'you have no knight there';
  if (k.level === 3) return 'mighty knights cannot be promoted';
  if (k.promotedPart === s.turn.part) return 'a knight may only be promoted once per turn';
  if (k.level === 2 && (s.ck!.players[p].improvements.politics ?? 0) < ABILITY_LEVEL) {
    return 'promoting to a mighty knight needs the Fortress (politics level 3)';
  }
  if (knightsInSupply(s, p, (k.level + 1) as KnightLevel) <= 0) return 'you have no stronger knight left';
  return null;
}

/** The robber or pirate on a hex next to the knight's intersection, if the knight may chase it now. */
export function chaseError(s: GameState, p: PlayerId, v: VertexId, piece: 'robber' | 'pirate'): string | null {
  const k = s.ck?.knights[v];
  if (!k || k.owner !== p) return 'you have no knight there';
  if (!knightCanAct(s, k)) return k.active ? 'a knight activated this turn cannot act until your next turn' : 'the knight is not active';
  if ((s.ck?.attacks ?? 0) === 0) return 'the robber stays put until the barbarians first attack';
  const hex = piece === 'robber' ? s.board.robber : s.board.pirate;
  if (!hex || piece !== 'robber' && piece !== 'pirate') return `there is no ${piece} to chase`;
  if (!topo(s).vertexHexes[v].includes(hex)) return `the ${piece} is not next to this knight`;
  return null;
}
