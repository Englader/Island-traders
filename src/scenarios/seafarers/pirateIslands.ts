import { cornerVertex, offsetId, parseHexId } from '../../board/hex.js';
import type { MapSpec } from '../../board/mapSpec.js';
import { rollDie } from '../../core/rng.js';
import type { Action, EdgeId, GameState, HexId, PlayerId, VertexId } from '../../core/types.js';
import { addGoldChoice, discardRandom, log, nameOf } from '../../rules/helpers.js';
import { topo } from '../../rules/queries.js';
import { seafarersRules, type ScenarioDef } from '../types.js';
import { seafarersSupply } from './common.js';

/**
 * The Pirate Islands, as summarised in the rules spec: fixed map, no robber, a
 * single unbranched ship route per player, knights turn ships into warships, a
 * pirate fleet that sails a fixed circuit by the lower die and attacks, and
 * fortress battles (warships vs one die). Win with 10 VP after capturing your
 * own fortress. No Longest Trade Route or Largest Army.
 *
 * Details the spec leaves open are engine choices, exported as constants:
 * fortress strength, fleet attack strength (the higher die) and outcomes.
 */
export const FORTRESS_STRENGTH = 3;

/** Fortress islets, one per seat, as odd-r offsets. */
const FORTS = ['1,1', '1,5', '4,1', '4,5'];
/** The fleet's circuit through the channel between the islets and the main island. */
const CIRCUIT = ['5,1', '6,1', '6,2', '6,3', '6,4', '6,5', '5,5', '5,4', '5,3', '5,2'];

interface Fortress {
  hex: HexId;
  vertex: VertexId;
  strength: number;
  captured: boolean;
}

interface PirateIslandsState {
  circuit: HexId[];
  fleetIndex: number;
  fortresses: Fortress[];
  /** Turn part in which each player last attacked their fortress. */
  lastAttack: number[];
}

function pi(state: GameState): PirateIslandsState {
  return state.ext.pirateIslands as PirateIslandsState;
}

export function warships(state: GameState, p: PlayerId): number {
  return Object.values(state.board.pieces).filter((x) => x.owner === p && x.type === 'ship' && x.warship).length;
}

function shipsOf(state: GameState, p: PlayerId, except: EdgeId | null = null): EdgeId[] {
  return Object.entries(state.board.pieces)
    .filter(([e, x]) => e !== except && x.owner === p && x.type === 'ship')
    .map(([e]) => e);
}

/** Your ship adjacent to your fortress (the ship that fights), if any. */
function shipAtFortress(state: GameState, p: PlayerId): EdgeId | null {
  const f = pi(state).fortresses[p];
  return topo(state).vertexEdges[f.vertex].find((e) => {
    const x = state.board.pieces[e];
    return x?.owner === p && x.type === 'ship';
  }) ?? null;
}

function attackError(state: GameState, p: PlayerId): string | null {
  if (state.phase.kind !== 'main' || state.turn.actor !== p || state.turn.role === 'specialBuild') {
    return 'you can only attack during your own turn';
  }
  const f = pi(state).fortresses[p];
  if (f.captured) return 'your fortress is already captured';
  if (pi(state).lastAttack[p] === state.turn.part) return 'only one attack per turn';
  if (!shipAtFortress(state, p)) return 'your trade route must reach your fortress';
  return null;
}

function capture(state: GameState, p: PlayerId): void {
  const f = pi(state).fortresses[p];
  f.captured = true;
  state.ext.blockedVertices = (state.ext.blockedVertices as VertexId[]).filter((v) => v !== f.vertex);
  if (state.players[p].supply.settlements > 0) {
    state.board.buildings[f.vertex] = { owner: p, type: 'settlement' };
    state.players[p].supply.settlements--;
  }
  log(state, `${nameOf(state, p)} captures their pirate fortress!`);
}

export const thePirateIslands: ScenarioDef = {
  id: 'seafarers-7-pirate-islands',
  name: 'The Pirate Islands',
  expansion: 'seafarers',
  description:
    'Build one unbranched trade route to your pirate fortress, arm it with warships (knights) and capture the fortress. A pirate fleet circles the channel and raids coastal settlements. 10 VP plus your fortress to win.',
  minPlayers: 3,
  maxPlayers: 4,
  victoryPoints: () => 10,
  map: (): MapSpec => ({
    rows: [
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
      '~ h5@fort ~ ~ m9@fort ~ ~ f5@main p10 g6 ~ ~',
      '~ ~ ~ ~ ~ ~ ~ g3 m9 h11 f4 ~',
      '~ ~ $6@gold $12 ~ ~ ~ p8 h10 d f2 ~',
      '~ ~ ~ ~ ~ ~ ~ m4 f11 p3 g6 ~',
      '~ g10@fort ~ ~ p3@fort ~ ~ h12 p8 m5 ~ ~',
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
    ],
    pools: {},
    harbors: { spots: 'auto', pool: ['generic', 'generic', 'generic', 'lumber', 'grain', 'ore'], zones: ['main'] },
    robber: 'offboard',
    pirate: 'offboard',
  }),
  ...seafarersSupply,
  rules: seafarersRules({
    robber: false,
    pirate: false,
    shipMoves: false,
    longestRoute: false,
    largestArmy: false,
    setupZones: ['main'],
    forbiddenZones: ['fort'],
  }),
  hooks: {
    init(state) {
      const circuit = CIRCUIT.map((o) => {
        const [c, r] = o.split(',').map(Number);
        return offsetId(c, r);
      });
      const fortresses: Fortress[] = state.players.map((_, i) => {
        const [c, r] = FORTS[i].split(',').map(Number);
        const hex = offsetId(c, r);
        return { hex, vertex: cornerVertex(parseHexId(hex), 0), strength: FORTRESS_STRENGTH, captured: false };
      });
      state.ext.pirateIslands = {
        circuit,
        fleetIndex: 0,
        fortresses,
        lastAttack: state.players.map(() => -1),
      } satisfies PirateIslandsState;
      state.ext.blockedVertices = fortresses.map((f) => f.vertex);
      state.board.pirate = circuit[0];
    },
    afterRoll(state, dice) {
      const st = pi(state);
      const steps = Math.min(dice[0], dice[1]);
      st.fleetIndex = (st.fleetIndex + steps) % st.circuit.length;
      const hex = st.circuit[st.fleetIndex];
      state.board.pirate = hex;
      const strength = Math.max(dice[0], dice[1]);
      log(state, `The pirate fleet sails ${steps} and attacks with strength ${strength}`);
      const owners = new Set<PlayerId>();
      for (const v of topo(state).hexVertices[hex]) {
        const b = state.board.buildings[v];
        if (b) owners.add(b.owner);
      }
      const rewards: Record<number, number> = {};
      for (const p of [...owners].sort((a, b) => a - b)) {
        const defense = warships(state, p);
        if (defense > strength) {
          rewards[p] = 1;
          log(state, `${nameOf(state, p)} repels the pirates (${defense} warships) and takes a resource of choice`);
        } else if (defense < strength) {
          const lost = discardRandom(state, p);
          log(state, `${nameOf(state, p)} is raided${lost ? ' and loses a card' : ''}`);
        } else {
          log(state, `${nameOf(state, p)} holds off the pirates`);
        }
      }
      addGoldChoice(state, rewards);
    },
    onKnight(state, player, resume) {
      const convertible = shipsOf(state, player).filter((e) => !state.board.pieces[e].warship);
      if (convertible.length === 0) {
        log(state, 'No ship can be turned into a warship');
        return resume;
      }
      return { kind: 'scenario', step: 'warship', player, resume };
    },
    shipAllowed(state, player, edge, movingFrom) {
      const mine = shipsOf(state, player, movingFrom);
      if (mine.length === 0) return null;
      const t = topo(state);
      const [a, b] = t.edgeVertices[edge];
      const at = (v: VertexId) => mine.filter((e) => t.edgeVertices[e].includes(v)).length;
      if (at(a) === 0 && at(b) === 0) return 'you may only extend your single trade route';
      if (at(a) >= 2 || at(b) >= 2) return 'your trade route may not branch';
      return null;
    },
    canWin(state, player) {
      return pi(state).fortresses[player].captured;
    },
    action(state, a) {
      if (a.name === 'convertWarship') {
        const ph = state.phase;
        if (ph.kind !== 'scenario' || ph.step !== 'warship' || ph.player !== a.player) return 'no warship to place now';
        const edge = a.args?.edge as EdgeId;
        const piece = state.board.pieces[edge];
        if (!piece || piece.owner !== a.player || piece.type !== 'ship' || piece.warship) return 'choose one of your ships';
        piece.warship = true;
        log(state, `${nameOf(state, a.player)} commissions a warship`);
        state.phase = ph.resume;
        return null;
      }
      if (a.name === 'attackFortress') {
        const err = attackError(state, a.player);
        if (err) return err;
        const st = pi(state);
        st.lastAttack[a.player] = state.turn.part;
        const f = st.fortresses[a.player];
        const die = rollDie(state.rng);
        const force = warships(state, a.player);
        if (force > die) {
          f.strength--;
          log(state, `${nameOf(state, a.player)} attacks the fortress (${force} vs ${die}) and wins`);
          if (f.strength <= 0) capture(state, a.player);
        } else if (force < die) {
          const ship = shipAtFortress(state, a.player)!;
          delete state.board.pieces[ship];
          state.players[a.player].supply.ships++;
          log(state, `${nameOf(state, a.player)} attacks the fortress (${force} vs ${die}) and loses a ship`);
        } else {
          log(state, `${nameOf(state, a.player)} attacks the fortress (${force} vs ${die}): a draw`);
        }
        return null;
      }
      return `unknown scenario action "${a.name}"`;
    },
    legalActions(state, player) {
      const out: Action[] = [];
      const ph = state.phase;
      if (ph.kind === 'scenario' && ph.step === 'warship' && ph.player === player) {
        for (const e of shipsOf(state, player)) {
          if (!state.board.pieces[e].warship) out.push({ type: 'scenario', player, name: 'convertWarship', args: { edge: e } });
        }
        return out;
      }
      if (attackError(state, player) === null) out.push({ type: 'scenario', player, name: 'attackFortress' });
      return out;
    },
  },
};
