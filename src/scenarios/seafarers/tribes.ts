import { sideEdge, parseHexId } from '../../board/hex.js';
import type { MapSpec } from '../../board/mapSpec.js';
import { TERRAIN_BASE, TOKENS_28, TOKENS_BASE_SPIRAL } from '../../core/constants.js';
import { shuffle } from '../../core/rng.js';
import type { EdgeId, GameState, HarborType, HexId, PlayerId } from '../../core/types.js';
import { drawDevCard, log, nameOf } from '../../rules/helpers.js';
import { topo, totalVP } from '../../rules/queries.js';
import { seafarersRules, type ScenarioDef } from '../types.js';
import { seafarersSupply, withoutTokens } from './common.js';

// 5 ---------------------------------------------------------------------------

type Gift = 'vp' | 'devCard' | 'harbor';

interface TribeState {
  /** Face-down gifts on marked coastal paths of the tribe islands. */
  gifts: Record<EdgeId, Gift>;
  /** Harbor types handed out with harbor gifts, drawn in order. */
  giftHarbors: HarborType[];
}

const GIFTS: Gift[] = ['vp', 'vp', 'vp', 'vp', 'devCard', 'devCard', 'devCard', 'harbor', 'harbor', 'harbor'];

export const theForgottenTribe: ScenarioDef = {
  id: 'seafarers-5-forgotten-tribe',
  name: 'The Forgotten Tribe',
  expansion: 'seafarers',
  description:
    'The tribe islands cannot be settled. A ship placed on a marked path collects its gift: a VP chit, a development card or a harbor to place next to your own coastal settlement. 13 VP to win.',
  minPlayers: 3,
  maxPlayers: 4,
  victoryPoints: () => 13,
  map: (): MapSpec => ({
    rows: [
      '~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~',
      '~  ~  ?  ?  ?  ~  ~  p@tribe ~ ~ ~',
      '~  ~  ?  ?  ?  ?  ~  ~  ~  f@tribe ~',
      '~  ?  ?  ?@main ?  ?  ~  g@tribe ~ ~ ~',
      '~  ~  ?  ?  ?  ?  ~  ~  ~  h@tribe ~',
      '~  ~  ?  ?  ?  ~  ~  m@tribe ~ ~ ~',
      '~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~',
    ],
    pools: { default: { terrains: TERRAIN_BASE, tokens: TOKENS_BASE_SPIRAL } },
    harbors: {
      spots: 'auto',
      pool: ['generic', 'generic', 'brick', 'lumber', 'grain', 'wool'],
      zones: ['main'],
    },
    robber: 'desert',
    pirate: 'offboard',
  }),
  ...seafarersSupply,
  rules: seafarersRules({ forbiddenZones: ['tribe'], robberForbiddenZones: ['tribe'] }),
  hooks: {
    init(state) {
      const tribeHexes = Object.keys(state.board.hexes)
        .filter((h) => state.board.hexes[h].zone === 'tribe')
        .sort();
      const spots: EdgeId[] = [];
      for (const h of tribeHexes) {
        const a = parseHexId(h);
        spots.push(sideEdge(a, 3), sideEdge(a, 0)); // west and east coasts
      }
      const gifts = shuffle(state.rng, [...GIFTS]);
      const tribe: TribeState = {
        gifts: Object.fromEntries(spots.map((e, i) => [e, gifts[i % gifts.length]])),
        giftHarbors: shuffle(state.rng, ['generic', 'generic', 'ore'] as HarborType[]),
      };
      state.ext.tribe = tribe;
      state.ext.heldHarbors = {};
    },
    afterEdge(state, player, edge, kind) {
      if (kind !== 'ship') return;
      const tribe = state.ext.tribe as TribeState;
      const gift = tribe.gifts[edge];
      if (!gift) return;
      delete tribe.gifts[edge];
      const name = nameOf(state, player);
      if (gift === 'vp') {
        state.players[player].bonusVP += 1;
        log(state, `${name} receives a victory point from the forgotten tribe`);
      } else if (gift === 'devCard') {
        log(state, `${name} receives a development card from the forgotten tribe`);
        drawDevCard(state, player);
      } else {
        const type = tribe.giftHarbors.pop() ?? 'generic';
        const held = state.ext.heldHarbors as Record<string, HarborType[]>;
        (held[player] ??= []).push(type);
        log(state, `${name} receives a ${type} harbor to place at one of their coastal settlements`);
      }
    },
    redact(state) {
      const tribe = state.ext.tribe as TribeState;
      // Viewers see where gifts lie, not what they are.
      state.ext.tribe = { giftSpots: Object.keys(tribe.gifts).sort(), giftHarborsLeft: tribe.giftHarbors.length };
    },
  },
};

// 6 ---------------------------------------------------------------------------

export const CLOTH_PER_VILLAGE = 5;
/** The game also ends once this many villages have run out of cloth. */
export const EXHAUSTED_VILLAGES_TO_END = 3;

interface ClothState {
  villages: Record<HexId, number>;
  cloth: number[];
}

function clothOf(state: GameState): ClothState {
  return state.ext.cloth as ClothState;
}

/** A player is connected to a village when one of their ships lies on its coast. */
export function connectedToVillage(state: GameState, p: PlayerId, village: HexId): boolean {
  return topo(state).hexEdges[village].some((e) => {
    const piece = state.board.pieces[e];
    return piece?.owner === p && piece.type === 'ship';
  });
}

export const clothForCatan: ScenarioDef = {
  id: 'seafarers-6-cloth-for-catan',
  name: 'Cloth for Catan',
  expansion: 'seafarers',
  description:
    'Players start with three settlements. Link a ship to a tribe village to receive cloth when its number is rolled; every 2 cloth is 1 VP. No Longest Trade Route. 14 VP, or most VP once three villages run dry.',
  minPlayers: 3,
  maxPlayers: 4,
  victoryPoints: () => 14,
  map: (): MapSpec => ({
    rows: [
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
      '~ ?@west ? ~ ~ ~ p4@village ~ ~ ?@east ? ~ ~',
      '~ ? ? ? ~ ~ ~ ~ ~ ? ? ? ~',
      '~ ? ? ? ~ f6@village ~ g8@village ~ ? ? ? ~',
      '~ ? ? ~ ~ ~ ~ ~ ~ ~ ? ? ~',
      '~ ? ? ~ ~ ~ h10@village ~ ~ ? ? ~ ~',
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
    ],
    pools: {
      default: {
        terrains: { forest: 5, pasture: 5, fields: 5, hills: 4, mountains: 4, desert: 1 },
        tokens: withoutTokens(TOKENS_28, [4, 6, 8, 10]),
      },
    },
    harbors: {
      spots: 'auto',
      pool: ['generic', 'generic', 'generic', 'generic', 'brick', 'lumber', 'wool', 'grain', 'ore'],
      zones: ['west', 'east'],
    },
    robber: 'desert',
    pirate: 'offboard',
  }),
  ...seafarersSupply,
  rules: seafarersRules({
    longestRoute: false,
    forbiddenZones: ['village'],
    robberForbiddenZones: ['village'],
    setupRounds: [
      { order: 'forward', collect: false },
      { order: 'reverse', collect: true },
      { order: 'forward', collect: false },
    ],
  }),
  hooks: {
    init(state) {
      const villages: Record<HexId, number> = {};
      for (const [h, hex] of Object.entries(state.board.hexes)) if (hex.zone === 'village') villages[h] = CLOTH_PER_VILLAGE;
      state.ext.cloth = { villages, cloth: state.players.map(() => 0) } satisfies ClothState;
    },
    afterRoll(state, dice) {
      const sum = dice[0] + dice[1];
      if (sum === 7) return;
      const c = clothOf(state);
      const n = state.players.length;
      for (const village of Object.keys(c.villages).sort()) {
        if (state.board.hexes[village].token !== sum) continue;
        for (let i = 0; i < n; i++) {
          const p = (state.turn.current + i) % n;
          if (c.villages[village] <= 0) break;
          if (!connectedToVillage(state, p, village)) continue;
          c.villages[village]--;
          c.cloth[p]++;
          log(state, `${nameOf(state, p)} receives 1 cloth`);
        }
        if (c.villages[village] === 0) log(state, 'A village has run out of cloth');
      }
    },
    extraVP(state, p) {
      return Math.floor(clothOf(state).cloth[p] / 2);
    },
    checkEnd(state) {
      const c = clothOf(state);
      const empty = Object.values(c.villages).filter((v) => v <= 0).length;
      if (empty < EXHAUSTED_VILLAGES_TO_END) return null;
      // Most VP wins; ties go to most cloth, then to the earliest in turn order from the current player.
      const n = state.players.length;
      let best: PlayerId | null = null;
      for (let i = 0; i < n; i++) {
        const p = (state.turn.current + i) % n;
        if (best === null) {
          best = p;
          continue;
        }
        const a = totalVP(state, p);
        const b = totalVP(state, best);
        if (a > b || (a === b && c.cloth[p] > c.cloth[best])) best = p;
      }
      return { winner: best, reason: `${empty} villages have run out of cloth; most victory points` };
    },
  },
};
