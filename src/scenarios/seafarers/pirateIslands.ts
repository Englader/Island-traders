import { cornerVertex, offsetId, parseHexId, sideEdge } from '../../board/hex.js';
import { markEdge, markHex, markVertex, type MapSpec } from '../../board/mapSpec.js';
import { BANK_BASE, DEV_DECK_BASE, TOKENS_28 } from '../../core/constants.js';
import { rollDie } from '../../core/rng.js';
import type { Action, DevCardType, EdgeId, GameState, HexId, Phase, PlayerId, VertexId } from '../../core/types.js';
import { discardRandom, log, nameOf, stealRandom } from '../../rules/helpers.js';
import { buildingsOf, edgeAllowsShip, handSize, topo, vertexZones } from '../../rules/queries.js';
import { seafarersRules, type ScenarioDef } from '../types.js';
import { PIRATE_ISLANDS } from './officialMaps.js';

/**
 * The Pirate Islands (5th-edition Seafarers rulebook, scenario 7):
 *
 * - No robber. Each player starts with a pre-placed coastal
 *   settlement and ship on the main (east) island, then places two more
 *   settlements in the usual snake draft.
 * - Every roll, before production or the 7, the pirate fleet sails clockwise
 *   around the two desert islets by the lower die. That die is also its
 *   strength. It attacks every player with a building next to its hex:
 *   weaker fleet -> the player takes a resource of choice; tie -> nothing;
 *   stronger -> the player discards 1 random card plus 1 per city.
 * - On a 7 players discard as usual, then the roller may rob any player.
 * - One unbranched shipping route per player, from a coastal building on the
 *   main island, via the marked intersection of their colour to their
 *   pirate fortress, by a shortest path (it may not veer off to block
 *   others) and never beyond the fortress.
 * - A knight (in 4-player games also a VP card) turns the rearmost normal
 *   ship of the route into a warship. 3 players: VP cards are removed.
 * - Fortress battle (ends your turn): roll one die. More warships -> remove a
 *   chit (3 chits); equal -> lose the ship next to the fortress; fewer ->
 *   lose the two ships closest to it. The conquered fortress becomes your
 *   settlement (it was one of your settlements all along).
 * - Win: 10 VP and your fortress conquered. No Longest Trade Route or
 *   Largest Army.
 */
export const FORTRESS_STRENGTH = 3;

/** Random set-up, per seat (odd-r offsets): fortress islet, marked intersection islet, main-island start hex. */
const SEATS = [
  { fort: '1,1', way: '3,1', start: '7,1' },
  { fort: '1,7', way: '3,7', start: '7,7' },
  { fort: '1,3', way: '3,3', start: '7,3' },
  { fort: '1,5', way: '3,5', start: '7,5' },
];
/** Random set-up: clockwise circuit around the two desert islets (odd-r offsets). */
const CIRCUIT = ['5,2', '6,2', '6,3', '7,4', '6,5', '6,6', '5,6', '4,5', '4,4', '4,3', '4,2'];

interface Fortress {
  hex: HexId;
  vertex: VertexId;
  /** The marked intersection the route must pass. */
  waypoint: VertexId;
  chits: number;
  captured: boolean;
}

interface PirateIslandsState {
  circuit: HexId[];
  fleetIndex: number;
  /** Null once every fortress has fallen: the fleet leaves. */
  fortresses: Fortress[];
}

function pi(state: GameState): PirateIslandsState {
  return state.ext.pirateIslands as PirateIslandsState;
}

const off = (o: string) => {
  const [c, r] = o.split(',').map(Number);
  return offsetId(c, r);
};

export function warships(state: GameState, p: PlayerId): number {
  return Object.values(state.board.pieces).filter((x) => x.owner === p && x.type === 'ship' && x.warship).length;
}

function shipsOf(state: GameState, p: PlayerId, except: EdgeId | null = null): EdgeId[] {
  return Object.entries(state.board.pieces)
    .filter(([e, x]) => e !== except && x.owner === p && x.type === 'ship')
    .map(([e]) => e);
}

/** The player's route as an ordered list of ships, starting at the end by their main-island building. */
export function routeInOrder(state: GameState, p: PlayerId): EdgeId[] {
  const t = topo(state);
  const ships = new Set(shipsOf(state, p));
  if (ships.size === 0) return [];
  const count = (v: VertexId) => t.vertexEdges[v].filter((e) => ships.has(e)).length;
  const ends: VertexId[] = [];
  for (const e of ships) for (const v of t.edgeVertices[e]) if (count(v) === 1 && !ends.includes(v)) ends.push(v);
  const own = (v: VertexId) => state.board.buildings[v]?.owner === p;
  const start =
    ends.find((v) => own(v) && vertexZones(state, v).includes('main')) ??
    ends.find(own) ??
    ends[0] ??
    t.edgeVertices[[...ships][0]][0];
  const order: EdgeId[] = [];
  const used = new Set<EdgeId>();
  let v = start;
  for (;;) {
    const next = t.vertexEdges[v].find((e) => ships.has(e) && !used.has(e));
    if (!next) break;
    used.add(next);
    order.push(next);
    const [a, b] = t.edgeVertices[next];
    v = a === v ? b : a;
  }
  // any ships not on the walked path (should not happen with unbranched routes)
  for (const e of ships) if (!used.has(e)) order.push(e);
  return order;
}

/**
 * Ship-path distances (in ships) from `target` to every intersection, over
 * sea and coastal paths not taken by another player's piece, never passing
 * through an opponent's building.
 */
function shipDistances(state: GameState, p: PlayerId, target: VertexId, ignore: EdgeId | null): Map<VertexId, number> {
  const t = topo(state);
  const dist = new Map<VertexId, number>([[target, 0]]);
  const queue: VertexId[] = [target];
  while (queue.length > 0) {
    const v = queue.shift()!;
    const d = dist.get(v)!;
    const b = state.board.buildings[v];
    if (v !== target && b && b.owner !== p) continue;
    for (const e of t.vertexEdges[v]) {
      if (!edgeAllowsShip(state, e)) continue;
      const piece = e === ignore ? undefined : state.board.pieces[e];
      if (piece && (piece.owner !== p || piece.type !== 'ship')) continue;
      const [x, y] = t.edgeVertices[e];
      const w = x === v ? y : x;
      if (dist.has(w)) continue;
      dist.set(w, d + 1);
      queue.push(w);
    }
  }
  return dist;
}

function touches(state: GameState, p: PlayerId, v: VertexId): EdgeId | null {
  return (
    topo(state).vertexEdges[v].find((e) => {
      const x = state.board.pieces[e];
      return x?.owner === p && x.type === 'ship';
    }) ?? null
  );
}

function attackError(state: GameState, p: PlayerId): string | null {
  if (state.phase.kind !== 'main' || state.turn.actor !== p || state.turn.role === 'specialBuild') {
    return 'you can only attack during your own turn';
  }
  const f = pi(state).fortresses[p];
  if (f.captured) return 'your fortress is already conquered';
  if (!touches(state, p, f.waypoint)) return 'your route must first reach the marked intersection of your colour';
  if (!touches(state, p, f.vertex)) return 'your route must reach your pirate fortress';
  return null;
}

function removeShip(state: GameState, e: EdgeId): void {
  const piece = state.board.pieces[e];
  delete state.board.pieces[e];
  state.players[piece.owner].supply.ships++;
}

function conquer(state: GameState, p: PlayerId): void {
  const st = pi(state);
  const f = st.fortresses[p];
  f.captured = true;
  state.ext.blockedVertices = (state.ext.blockedVertices as VertexId[]).filter((v) => v !== f.vertex);
  // The fortress settlement was taken from the player's supply at setup.
  state.board.buildings[f.vertex] = { owner: p, type: 'settlement' };
  log(state, `${nameOf(state, p)} conquers their pirate fortress!`);
  if (st.fortresses.every((x) => x.captured)) {
    state.board.pirate = null;
    log(state, 'Every fortress has fallen: the pirate fleet leaves');
  }
}

/** Replaces the final `main` phase of a phase chain (after discards) with `inject`. */
function beforeMain(phase: Phase, inject: (resume: Phase) => Phase): Phase {
  if (phase.kind === 'main') return inject(phase);
  if ('resume' in phase) return { ...phase, resume: beforeMain(phase.resume, inject) } as Phase;
  return phase;
}

export const thePirateIslands: ScenarioDef = {
  id: 'seafarers-7-pirate-islands',
  name: 'The Pirate Islands',
  expansion: 'seafarers',
  description:
    'Build one unbranched shipping route via your marked intersection to your pirate fortress, turn ships into warships with knights and conquer the fortress. A pirate fleet circles the desert islets and raids coastal settlements. 10 VP plus your fortress to win.',
  minPlayers: 3,
  maxPlayers: 4,
  victoryPoints: () => 10,
  officialMap: () => PIRATE_ISLANDS,
  map: (): MapSpec => ({
    rows: [
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
      '~ h#@fort ~ p#@way ~ ~ ~ f#@main g# m# ~ ~',
      '~ ~ ~ ~ ~ ~ ~ ~ p# h# f# ~',
      '~ m#@fort ~ g#@way ~ d@desert ~ p# h# g# ~ ~',
      '~ ~ ~ ~ ~ ~ ~ ~ m# f# p# ~',
      '~ f#@fort ~ h#@way ~ d@desert ~ g# m# f# ~ ~',
      '~ ~ ~ ~ ~ ~ ~ ~ h# p# g# ~',
      '~ p#@fort ~ m#@way ~ ~ ~ f# g# ~ ~ ~',
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
    ],
    pools: { default: { terrains: {}, tokens: TOKENS_28 } },
    harbors: { spots: 'auto', pool: ['generic', 'generic', 'generic', 'brick', 'lumber', 'wool', 'grain', 'ore'], zones: ['main'] },
    robber: 'offboard',
    pirate: 'offboard',
  }),
  bankSize: () => BANK_BASE,
  devDeck: (players): Record<DevCardType, number> =>
    players >= 4
      ? { ...DEV_DECK_BASE, knight: DEV_DECK_BASE.knight + DEV_DECK_BASE.victoryPoint, victoryPoint: 0 }
      : { ...DEV_DECK_BASE, victoryPoint: 0 },
  rules: seafarersRules({
    robber: false,
    pirate: false,
    longestRoute: false,
    largestArmy: false,
    setupZones: ['main'],
    forbiddenZones: ['fort', 'desert'],
    robberForbiddenZones: ['fort', 'desert'],
  }),
  hooks: {
    init(state, map) {
      const m = map.marks;
      // Per seat: fortress hex and intersection, marked intersection, pre-placed settlement and ship.
      const seats = m?.fortress
        ? m.fortress.map((f, i) => ({
            hex: markHex(f),
            vertex: markVertex(f),
            waypoint: markVertex(m.waypoint[i]),
            home: markVertex(m.start[i]),
            ship: markEdge(m.startShip[i]),
          }))
        : SEATS.map((seat) => {
            const start = parseHexId(off(seat.start));
            return {
              hex: off(seat.fort),
              vertex: cornerVertex(parseHexId(off(seat.fort)), 0),
              waypoint: cornerVertex(parseHexId(off(seat.way)), 3),
              home: cornerVertex(start, 2),
              ship: sideEdge(start, 3),
            };
          });
      const fortresses: Fortress[] = state.players.map((pl, i) => {
        const seat = seats[i];
        // The fortress is one of the player's own settlements, stacked on 3 chits.
        pl.supply.settlements--;
        // Pre-placed coastal settlement and ship on the main island.
        state.board.buildings[seat.home] = { owner: i, type: 'settlement' };
        pl.supply.settlements--;
        state.board.pieces[seat.ship] = { owner: i, type: 'ship', placedPart: 0 };
        pl.supply.ships--;
        return { hex: seat.hex, vertex: seat.vertex, waypoint: seat.waypoint, chits: FORTRESS_STRENGTH, captured: false };
      });
      const circuit = m?.circuit ? m.circuit.map(markHex) : CIRCUIT.map(off);
      state.ext.pirateIslands = { circuit, fleetIndex: 0, fortresses } satisfies PirateIslandsState;
      state.ext.blockedVertices = fortresses.map((f) => f.vertex);
      state.board.pirate = circuit[0];
    },
    beforeProduction(state, dice) {
      const st = pi(state);
      if (state.board.pirate === null) return {};
      const lower = Math.min(dice[0], dice[1]);
      st.fleetIndex = (st.fleetIndex + lower) % st.circuit.length;
      const hex = st.circuit[st.fleetIndex];
      state.board.pirate = hex;
      const owners = new Set<PlayerId>();
      for (const v of topo(state).hexVertices[hex]) {
        const b = state.board.buildings[v];
        if (b) owners.add(b.owner);
      }
      if (owners.size === 0) {
        log(state, `The pirate fleet sails ${lower}`);
        return {};
      }
      // Every player with a building next to the fleet is attacked, in seat order from the roller.
      const n = state.players.length;
      const victims = [...owners].sort((a, b) => ((a - state.turn.current + n) % n) - ((b - state.turn.current + n) % n));
      const owed: Record<number, number> = {};
      for (const p of victims) {
        const defense = warships(state, p);
        if (defense > lower) {
          log(state, `The pirate fleet (${lower}) attacks ${nameOf(state, p)} and is beaten by ${defense} warships`);
          owed[p] = 1;
        } else if (defense === lower) {
          log(state, `The pirate fleet (${lower}) attacks ${nameOf(state, p)}: a draw`);
        } else {
          const loss = 1 + buildingsOf(state, p).cities.length;
          let lost = 0;
          for (let i = 0; i < loss; i++) if (discardRandom(state, p)) lost++;
          log(state, `The pirate fleet (${lower}) raids ${nameOf(state, p)}, who loses ${lost} card(s)`);
        }
      }
      return owed;
    },
    afterRoll(state, dice) {
      if (dice[0] + dice[1] !== 7) return;
      const p = state.turn.current;
      state.phase = beforeMain(state.phase, (resume) => ({ kind: 'scenario', step: 'rob', player: p, resume }));
    },
    onKnight(state, player, resume) {
      const ship = routeInOrder(state, player).find((e) => !state.board.pieces[e].warship);
      if (ship) {
        state.board.pieces[ship].warship = true;
        log(state, `${nameOf(state, player)} turns a ship into a warship`);
      } else {
        log(state, `${nameOf(state, player)} has no ship to arm`);
      }
      return resume;
    },
    shipAllowed(state, player, edge, movingFrom) {
      const mine = shipsOf(state, player, movingFrom);
      const t = topo(state);
      const [a, b] = t.edgeVertices[edge];
      const f = pi(state).fortresses[player];
      let near: VertexId;
      if (mine.length === 0) {
        const home = [a, b].find(
          (v) => state.board.buildings[v]?.owner === player && vertexZones(state, v).includes('main'),
        );
        if (!home) return 'your shipping route must start at a coastal building on the main island';
        near = home;
      } else {
        const at = (v: VertexId) => mine.filter((e) => t.edgeVertices[e].includes(v)).length;
        if (at(a) === 0 && at(b) === 0) return 'you may only extend your single shipping route';
        if (at(a) >= 2 || at(b) >= 2) return 'your shipping route may not branch';
        if (mine.some((e) => t.edgeVertices[e].includes(f.vertex))) return 'your route ends at your pirate fortress';
        near = at(a) > 0 ? a : b;
      }
      // The route takes a shortest path: first to the marked intersection, then to the fortress.
      const reachedWaypoint = mine.some((e) => t.edgeVertices[e].includes(f.waypoint));
      const target = reachedWaypoint ? f.vertex : f.waypoint;
      const dist = shipDistances(state, player, target, movingFrom);
      const far = near === a ? b : a;
      const dNear = dist.get(near);
      const dFar = dist.get(far);
      if (dNear === undefined || dFar === undefined || dFar !== dNear - 1) {
        return `your shipping route must take the shortest way to ${reachedWaypoint ? 'your fortress' : 'your marked intersection'}`;
      }
      return null;
    },
    settlementAllowed(state, player, vertex) {
      if (!vertexZones(state, vertex).includes('way')) return null;
      return pi(state).fortresses[player].waypoint === vertex ? null : 'only the marked intersection of your colour';
    },
    canWin(state, player) {
      return pi(state).fortresses[player].captured;
    },
    action(state, a) {
      if (a.name === 'rob') {
        const ph = state.phase;
        if (ph.kind !== 'scenario' || ph.step !== 'rob' || ph.player !== a.player) return 'you cannot rob now';
        const victim = a.args?.victim as number | undefined;
        if (victim !== undefined) {
          if (!Number.isInteger(victim) || victim === a.player || !state.players[victim]) return 'no such player';
          if (handSize(state, victim) === 0) return 'that player has no cards';
          stealRandom(state, a.player, victim);
        }
        state.phase = ph.resume;
        return null;
      }
      if (a.name === 'attackFortress') {
        const err = attackError(state, a.player);
        if (err) return err;
        const f = pi(state).fortresses[a.player];
        const die = rollDie(state.rng);
        const force = warships(state, a.player);
        const name = nameOf(state, a.player);
        if (force > die) {
          f.chits--;
          log(state, `${name} attacks the fortress (${force} warships vs ${die}) and wins`);
          if (f.chits <= 0) conquer(state, a.player);
        } else {
          // Lose the ship next to the fortress; on a defeat also the next one along the route.
          const route = routeInOrder(state, a.player);
          const adjacent = touches(state, a.player, f.vertex)!;
          const idx = route.indexOf(adjacent);
          const lose = [adjacent];
          if (force < die) {
            const neighbour = route[idx - 1] ?? route[idx + 1];
            if (neighbour) lose.push(neighbour);
          }
          for (const e of lose) removeShip(state, e);
          log(state, `${name} attacks the fortress (${force} vs ${die}) and loses ${lose.length} ship(s)`);
        }
        state.ext.forceEndTurn = true;
        return null;
      }
      return `unknown scenario action "${a.name}"`;
    },
    legalActions(state, player) {
      const out: Action[] = [];
      const ph = state.phase;
      if (ph.kind === 'scenario' && ph.step === 'rob') {
        if (ph.player !== player) return out;
        out.push({ type: 'scenario', player, name: 'rob' });
        for (const pl of state.players) {
          if (pl.id !== player && handSize(state, pl.id) > 0) {
            out.push({ type: 'scenario', player, name: 'rob', args: { victim: pl.id } });
          }
        }
        return out;
      }
      if (attackError(state, player) === null) out.push({ type: 'scenario', player, name: 'attackFortress' });
      return out;
    },
  },
};
