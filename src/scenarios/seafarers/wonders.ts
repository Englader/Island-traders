import type { MapSpec } from '../../board/mapSpec.js';
import { HARBORS_BASE, TOKENS_28 } from '../../core/constants.js';
import { hasAtLeast } from '../../core/resources.js';
import type { Action, GameState, PartialCounts, PlayerId } from '../../core/types.js';
import { log, nameOf, payToBank } from '../../rules/helpers.js';
import { buildingsOf, publicVP, topo, vertexZones } from '../../rules/queries.js';
import { seafarersRules, type ScenarioDef } from '../types.js';
import { seafarersSupply, withoutTokens } from './common.js';

/**
 * The Wonders of Catan: claim a wonder once you meet its entry requirement,
 * then build its four levels (5 resources each). Finishing a wonder wins
 * outright; otherwise you need 10 VP and the strictly highest wonder level.
 *
 * The spec does not list the wonders, so the five below (requirements and
 * costs) are this engine's definitions. They are data and easy to replace.
 */
export const WONDER_LEVELS = 4;

export interface WonderDef {
  id: string;
  name: string;
  requirement: string;
  cost: PartialCounts;
  eligible(state: GameState, p: PlayerId): boolean;
}

export const WONDERS: WonderDef[] = [
  {
    id: 'greatWall',
    name: 'Great Wall',
    requirement: 'a settlement or city next to a desert',
    cost: { brick: 2, lumber: 1, grain: 1, ore: 1 },
    eligible: (s, p) => {
      const { settlements, cities } = buildingsOf(s, p);
      return [...settlements, ...cities].some((v) =>
        topo(s).vertexHexes[v].some((h) => s.board.hexes[h].terrain === 'desert'),
      );
    },
  },
  {
    id: 'greatBridge',
    name: 'Great Bridge',
    requirement: 'buildings on two different islands',
    cost: { brick: 1, lumber: 2, ore: 2 },
    eligible: (s, p) => {
      const { settlements, cities } = buildingsOf(s, p);
      const zones = new Set<string>();
      for (const v of [...settlements, ...cities]) for (const z of vertexZones(s, v)) zones.add(z);
      return zones.size >= 2;
    },
  },
  {
    id: 'lighthouse',
    name: 'Lighthouse',
    requirement: 'a settlement or city on a harbor',
    cost: { lumber: 2, wool: 1, brick: 1, ore: 1 },
    eligible: (s, p) =>
      s.board.harbors.some((h) => topo(s).edgeVertices[h.edge].some((v) => s.board.buildings[v]?.owner === p)),
  },
  {
    id: 'colossus',
    name: 'Colossus',
    requirement: 'two cities',
    cost: { ore: 2, grain: 1, wool: 1, brick: 1 },
    eligible: (s, p) => buildingsOf(s, p).cities.length >= 2,
  },
  {
    id: 'greatLibrary',
    name: 'Great Library',
    requirement: '6 public victory points',
    cost: { grain: 2, wool: 2, ore: 1 },
    eligible: (s, p) => publicVP(s, p) >= 6,
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

export const theWondersOfCatan: ScenarioDef = {
  id: 'seafarers-8-wonders',
  name: 'The Wonders of Catan',
  expansion: 'seafarers',
  description:
    'Meet a wonder\'s entry requirement to claim it, then build its four levels. Finish a wonder, or reach 10 VP with the highest wonder level, to win. No pirate.',
  minPlayers: 3,
  maxPlayers: 4,
  victoryPoints: () => 10,
  map: (): MapSpec => ({
    rows: [
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
      '~ ~ ? ? ? ? ~ ~ ?b ~ ~',
      '~ ~ ? ? ? ? ? ~ ~ ?b ~',
      '~ ? ? d@main ? ? ? ~ ~ ~ ~',
      '~ ~ ? ? ? ? ? ~ ~ ?b ~',
      '~ ~ ? ? ? ? ~ ~ ?b ~ ~',
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
    ],
    pools: {
      default: {
        terrains: { forest: 5, pasture: 5, fields: 5, hills: 4, mountains: 4 },
        tokens: withoutTokens(TOKENS_28, [3, 5, 9, 11]),
      },
      b: { terrains: { gold: 2, hills: 1, mountains: 1 }, tokens: [3, 5, 9, 11] },
    },
    harbors: { spots: 'auto', pool: HARBORS_BASE, zones: ['main'] },
    robber: 'desert',
    pirate: null,
  }),
  ...seafarersSupply,
  rules: seafarersRules({ pirate: false }),
  hooks: {
    init(state) {
      state.ext.wonders = {
        claimed: {},
        owned: state.players.map(() => null),
        levels: state.players.map(() => 0),
      } satisfies WondersState;
    },
    action(state, a) {
      if (a.name === 'claimWonder') {
        const id = String(a.args?.wonder ?? '');
        const err = claimError(state, a.player, id);
        if (err) return err;
        ws(state).claimed[id] = a.player;
        ws(state).owned[a.player] = id;
        log(state, `${nameOf(state, a.player)} claims the ${WONDERS.find((w) => w.id === id)!.name}`);
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
