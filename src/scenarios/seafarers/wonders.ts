import { markVertex, type MapSpec } from '../../board/mapSpec.js';
import { HARBORS_BASE, TOKENS_28 } from '../../core/constants.js';
import { hasAtLeast } from '../../core/resources.js';
import type { Action, GameState, PartialCounts, PlayerId, VertexId } from '../../core/types.js';
import { log, nameOf, payToBank } from '../../rules/helpers.js';
import { longestRouteLength } from '../../rules/longestRoute.js';
import { buildingsOf, isLandHex, topo, totalVP, vertexLandHexes } from '../../rules/queries.js';
import { seafarersRules, type ScenarioDef } from '../types.js';
import { seafarersSupply, withoutTokens } from './common.js';
import { WONDERS_OF_CATAN } from './officialMaps.js';

/**
 * The Wonders (the rulebook's "Wonders of Catan"). Wonder requirements and
 * per-level costs follow the wonder cards printed in the 5th-edition
 * Seafarers rulebook (Theater, Great Bridge, Monument, Great Wall, Cathedral). You claim a wonder by meeting its requirement and
 * putting one of your unplaced ships on its card. Each of its 4 levels costs
 * the 5 resources on the card, and you may build several levels in a turn.
 * Win by finishing all 4 levels, or with 10 VP and more levels than anyone
 * else.
 *
 * Map markings: the desert wasteland (Great Wall), the strait (Great Bridge)
 * and the intersections next to those strait sites. None of them, nor the
 * small islands, may take a starting settlement; they are open afterwards.
 * The rulebook's map marks five wasteland and two strait intersections; the
 * random set-up takes every intersection next to a desert, and every land
 * intersection next to a sea hex tagged as the strait.
 */
export const WONDER_LEVELS = 4;

export interface WonderDef {
  id: string;
  name: string;
  requirement: string;
  cost: PartialCounts;
  eligible(state: GameState, p: PlayerId): boolean;
}

/** Intersections marked on the rulebook's map (set at the start of the game). */
interface WonderSites {
  strait: VertexId[];
  wasteland: VertexId[];
}

function printedSites(state: GameState): WonderSites | undefined {
  return state.ext.wonderSites as WonderSites | undefined;
}

/** The desert wasteland: the marked intersections, or every intersection next to a desert. */
export function wastelandVertices(state: GameState): VertexId[] {
  const printed = printedSites(state);
  if (printed) return printed.wasteland;
  return topo(state).vertexIds.filter((v) =>
    topo(state).vertexHexes[v].some((h) => state.board.hexes[h].terrain === 'desert'),
  );
}

/** The strait: the marked intersections, or the land intersections next to a sea hex tagged as the strait. */
export function straitVertices(state: GameState): VertexId[] {
  const printed = printedSites(state);
  if (printed) return printed.strait;
  return topo(state).vertexIds.filter(
    (v) =>
      vertexLandHexes(state, v).length > 0 &&
      topo(state).vertexHexes[v].some((h) => state.board.hexes[h].zone === 'strait' && !isLandHex(state, h)),
  );
}

function settlementIn(state: GameState, p: PlayerId, spots: VertexId[]): boolean {
  return buildingsOf(state, p).settlements.some((v) => spots.includes(v));
}

export const WONDERS: WonderDef[] = [
  {
    id: 'theater',
    name: 'Theater',
    requirement: '2 cities',
    cost: { brick: 1, wool: 3, lumber: 1 },
    eligible: (s, p) => buildingsOf(s, p).cities.length >= 2,
  },
  {
    id: 'greatBridge',
    name: 'Great Bridge',
    requirement: 'a settlement at the strait',
    cost: { wool: 1, grain: 1, lumber: 3 },
    eligible: (s, p) => settlementIn(s, p, straitVertices(s)),
  },
  {
    id: 'monument',
    name: 'Monument',
    requirement: 'a city at a harbor and a trade route of at least 5',
    cost: { ore: 2, grain: 3 },
    eligible: (s, p) =>
      buildingsOf(s, p).cities.some((v) => s.board.harbors.some((h) => topo(s).edgeVertices[h.edge].includes(v))) &&
      longestRouteLength(s, p) >= 5,
  },
  {
    id: 'greatWall',
    name: 'Great Wall',
    requirement: 'a settlement at the desert wasteland',
    cost: { brick: 3, grain: 1, lumber: 1 },
    eligible: (s, p) => settlementIn(s, p, wastelandVertices(s)),
  },
  {
    id: 'cathedral',
    name: 'Cathedral',
    requirement: 'a city and 6 victory points',
    cost: { brick: 1, ore: 3, grain: 1 },
    eligible: (s, p) => buildingsOf(s, p).cities.length >= 1 && totalVP(s, p) >= 6,
  },
];

interface WondersState {
  /** wonder id -> owner */
  claimed: Record<string, PlayerId>;
  /** per player: wonder id or null */
  owned: Array<string | null>;
  levels: number[];
}

function ws(state: GameState): WondersState {
  return state.ext.wonders as WondersState;
}

function turnError(state: GameState, p: PlayerId): string | null {
  if (state.phase.kind !== 'main' || state.turn.actor !== p || state.turn.role === 'specialBuild') {
    return 'only during your own turn';
  }
  return null;
}

function claimError(state: GameState, p: PlayerId, id: string): string | null {
  const t = turnError(state, p);
  if (t) return t;
  const w = WONDERS.find((x) => x.id === id);
  if (!w) return 'no such wonder';
  if (ws(state).owned[p]) return 'you already have a wonder';
  if (ws(state).claimed[id] !== undefined) return 'that wonder is taken';
  if (state.players[p].supply.ships <= 0) return 'you need an unplaced ship to mark the wonder';
  if (!w.eligible(state, p)) return `requirement not met: ${w.requirement}`;
  return null;
}

function buildError(state: GameState, p: PlayerId): string | null {
  const t = turnError(state, p);
  if (t) return t;
  const id = ws(state).owned[p];
  if (!id) return 'claim a wonder first';
  if (ws(state).levels[p] >= WONDER_LEVELS) return 'the wonder is complete';
  const w = WONDERS.find((x) => x.id === id)!;
  if (!hasAtLeast(state.players[p].resources, w.cost)) return 'not enough resources';
  return null;
}

export const theWonders: ScenarioDef = {
  id: 'seafarers-8-wonders',
  name: 'The Wonders',
  expansion: 'seafarers',
  description:
    "Meet a wonder's requirement and mark it with a ship to claim it, then build its four levels. Your first settlement on each small island earns 1 VP. Finish a wonder, or reach 10 VP with more levels than anyone else, to win. No pirate.",
  minPlayers: 3,
  maxPlayers: 4,
  victoryPoints: () => 10,
  officialMap: () => WONDERS_OF_CATAN,
  map: (): MapSpec => ({
    rows: [
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
      '~ ? ?@west ? ~ ? ?@east ? ~ ~ ~ ~',
      '~ ? ? ? ~@strait ? ? ? ~ ~ ~ ~',
      '~ ? d d ~@strait ? ? ? ~ $5 ~ ~',
      '~ ? ? d ~ ? ? ? ~ ~ ~ ~',
      '~ ~ ? ? ~ ? ~ ~ ~ ?b $11 ~',
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
    ],
    pools: {
      default: {
        terrains: { forest: 5, pasture: 5, fields: 5, hills: 5, mountains: 4 },
        tokens: withoutTokens(TOKENS_28, [5, 9, 11]),
      },
      b: { terrains: { mountains: 1 }, tokens: [9] },
    },
    harbors: { spots: 'auto', pool: HARBORS_BASE, zones: ['west', 'east'] },
    robber: 'desert',
    pirate: null,
  }),
  ...seafarersSupply,
  rules: seafarersRules({
    pirate: false,
    // 'main' on the rulebook's map; 'west' and 'east' on the random one.
    setupZones: ['main', 'west', 'east'],
    islandBonus: { vp: 1, home: ['main', 'west', 'east'] },
  }),
  hooks: {
    init(state, map) {
      if (map.marks?.strait) {
        state.ext.wonderSites = {
          strait: map.marks.strait.map(markVertex),
          wasteland: (map.marks.wasteland ?? []).map(markVertex),
        } satisfies WonderSites;
      }
      state.ext.wonders = {
        claimed: {},
        owned: state.players.map(() => null),
        levels: state.players.map(() => 0),
      } satisfies WondersState;
    },
    settlementAllowed(state, _player, vertex, setup) {
      if (!setup) return null;
      const strait = straitVertices(state);
      const nearStrait = strait.flatMap((v) => topo(state).vertexNeighbors[v]);
      if (wastelandVertices(state).includes(vertex)) return 'the wasteland is not open for starting settlements';
      if (strait.includes(vertex) || nearStrait.includes(vertex)) return 'the strait is not open for starting settlements';
      return null;
    },
    action(state, a) {
      if (a.name === 'claimWonder') {
        const id = String(a.args?.wonder ?? '');
        const err = claimError(state, a.player, id);
        if (err) return err;
        ws(state).claimed[id] = a.player;
        ws(state).owned[a.player] = id;
        state.players[a.player].supply.ships--; // the ship marks the wonder card
        log(state, `${nameOf(state, a.player)} starts the ${WONDERS.find((w) => w.id === id)!.name}`);
        return null;
      }
      if (a.name === 'buildWonder') {
        const err = buildError(state, a.player);
        if (err) return err;
        const w = WONDERS.find((x) => x.id === ws(state).owned[a.player])!;
        payToBank(state, a.player, w.cost);
        ws(state).levels[a.player]++;
        log(state, `${nameOf(state, a.player)} builds level ${ws(state).levels[a.player]} of the ${w.name}`);
        return null;
      }
      return `unknown scenario action "${a.name}"`;
    },
    legalActions(state, player) {
      const out: Action[] = [];
      for (const w of WONDERS) {
        if (claimError(state, player, w.id) === null) out.push({ type: 'scenario', player, name: 'claimWonder', args: { wonder: w.id } });
      }
      if (buildError(state, player) === null) out.push({ type: 'scenario', player, name: 'buildWonder' });
      return out;
    },
    instantWin(state, player) {
      return ws(state).levels[player] >= WONDER_LEVELS ? 'completed a wonder' : null;
    },
    canWin(state, player) {
      const levels = ws(state).levels;
      const mine = levels[player];
      return mine >= 1 && levels.every((l, i) => i === player || l < mine);
    },
  },
};
