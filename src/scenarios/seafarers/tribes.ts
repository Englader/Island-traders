import { cornerVertex, parseHexId, sideEdge } from '../../board/hex.js';
import type { MapSpec } from '../../board/mapSpec.js';
import { HARBORS_BASE, TERRAIN_BASE, TOKENS_28, TOKENS_BASE_SPIRAL } from '../../core/constants.js';
import { shuffle } from '../../core/rng.js';
import type { Action, DevCardType, EdgeId, GameState, HarborType, PlayerId, VertexId } from '../../core/types.js';
import { harborEdgeError } from '../../engine/apply.js';
import { log, nameOf } from '../../rules/helpers.js';
import { topo, totalVP } from '../../rules/queries.js';
import { seafarersRules, type ScenarioDef } from '../types.js';
import { seafarersSupply, withoutTokens } from './common.js';

// 5 ---------------------------------------------------------------------------

type Gift = 'vp' | 'devCard' | 'harbor';

interface TribeState {
  /** Face-down gifts on marked coastal paths of the tribe islands. */
  gifts: Record<EdgeId, Gift>;
  /** Development cards set aside from the deck for the gift spots. */
  giftCards: DevCardType[];
  /** Harbor tokens handed out with harbor gifts, drawn in order. */
  giftHarbors: HarborType[];
}

/** 8 Catan chits (1 VP each), 4 development cards and 6 harbors. */
export const TRIBE_GIFTS: Gift[] = [
  ...Array<Gift>(8).fill('vp'),
  ...Array<Gift>(4).fill('devCard'),
  ...Array<Gift>(6).fill('harbor'),
];

function legalHarborEdges(state: GameState, p: PlayerId): EdgeId[] {
  return topo(state).edgeIds.filter((e) => harborEdgeError(state, e, p) === null);
}

export const theForgottenTribe: ScenarioDef = {
  id: 'seafarers-5-forgotten-tribe',
  name: 'The Forgotten Tribe',
  expansion: 'seafarers',
  description:
    'The tribe islands cannot be settled. Building or moving a ship onto a marked path collects its gift: a VP chit, a development card, or a harbor that must be placed next to your own coastal settlement at once if possible. 13 VP to win.',
  minPlayers: 3,
  maxPlayers: 4,
  victoryPoints: () => 13,
  map: (): MapSpec => ({
    rows: [
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
      '~ ~ ? ? ? ~ ~ p@tribe ~ f@tribe ~ ~',
      '~ ~ ? ? ? ? ~ ~ ~ ~ ~ ~',
      '~ ? ? ?@main ? ? ~ ~ g@tribe ~ h@tribe ~',
      '~ ~ ? ? ? ? ~ ~ ~ ~ ~ ~',
      '~ ~ ? ? ? ~ ~ m@tribe ~ p@tribe ~ ~',
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
    ],
    pools: { default: { terrains: TERRAIN_BASE, tokens: TOKENS_BASE_SPIRAL } },
    harbors: { spots: 'auto', pool: ['generic', 'generic', 'wool', 'ore'], zones: ['main'] },
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
        spots.push(sideEdge(a, 2), sideEdge(a, 3), sideEdge(a, 4)); // the three coasts facing the main island
      }
      const gifts = shuffle(state.rng, [...TRIBE_GIFTS]);
      // The top development cards are set aside, face down, for the gift spots.
      const giftCards: DevCardType[] = [];
      for (let i = 0; i < gifts.filter((g) => g === 'devCard').length; i++) {
        const c = state.devDeck.pop();
        if (c) giftCards.push(c);
      }
      const tribe: TribeState = {
        gifts: Object.fromEntries(spots.map((e, i) => [e, gifts[i % gifts.length]])),
        giftCards,
        giftHarbors: shuffle(state.rng, ['generic', 'generic', 'generic', 'brick', 'lumber', 'grain'] as HarborType[]),
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
        const card = tribe.giftCards.pop();
        if (card) {
          // Treated like a card bought this turn.
          state.players[player].devCards.push({ type: card, boughtPart: state.turn.part });
          log(state, `${name} receives a development card from the forgotten tribe`);
          log(state, `(${name} received ${card})`, [player]);
        }
      } else {
        const type = tribe.giftHarbors.pop() ?? 'generic';
        const held = state.ext.heldHarbors as Record<string, HarborType[]>;
        (held[player] ??= []).push(type);
        log(state, `${name} receives a ${type} harbor from the forgotten tribe`);
        // It must be placed at once next to one of their coastal buildings, if possible.
        if (legalHarborEdges(state, player).length > 0) {
          state.phase = { kind: 'scenario', step: 'placeHarbor', player, resume: state.phase };
        } else {
          log(state, `${name} sets the harbor aside to place later`);
        }
      }
    },
    legalActions(state, player) {
      const ph = state.phase;
      if (ph.kind !== 'scenario' || ph.step !== 'placeHarbor' || ph.player !== player) return [];
      const held = (state.ext.heldHarbors as Record<string, HarborType[]>)[player] ?? [];
      const index = held.length - 1;
      return legalHarborEdges(state, player).map((edge): Action => ({ type: 'placeHarbor', player, edge, index }));
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
export const CLOTH_GENERAL_SUPPLY = 10;
/** The game ends as soon as fewer than this many villages still have cloth. */
export const VILLAGES_WITH_CLOTH_MIN = 4;

interface Village {
  token: number;
  cloth: number;
  /** Players who reached the village, in order of arrival. */
  traders: PlayerId[];
}

interface ClothState {
  villages: Record<VertexId, Village>;
  general: number;
  cloth: number[];
}

function clothOf(state: GameState): ClothState {
  return state.ext.cloth as ClothState;
}

/** Villages (intersections on the small islands) with their numbers: left and right end of each islet. */
const VILLAGE_TOKENS = [
  [4, 10],
  [5, 9],
  [6, 8],
  [3, 11],
];

function hasTrade(state: GameState, p: PlayerId): boolean {
  return Object.values(clothOf(state).villages).some((v) => v.traders.includes(p));
}

function giveCloth(state: GameState, p: PlayerId, village: Village, allowGeneral: boolean): boolean {
  const c = clothOf(state);
  if (village.cloth > 0) village.cloth--;
  else if (allowGeneral && c.general > 0) c.general--;
  else return false;
  c.cloth[p]++;
  return true;
}

export const clothForCatan: ScenarioDef = {
  id: 'seafarers-6-cloth-for-catan',
  name: 'Cloth for Catan',
  expansion: 'seafarers',
  description:
    'Three starting settlements. Reach the villages of the small islands with ships to trade for cloth: 1 on arrival and 1 whenever the village number is rolled. Every 2 cloth is 1 VP. The pirate may steal cloth. No Longest Trade Route. 14 VP, or most VP once fewer than 4 villages have cloth.',
  minPlayers: 3,
  maxPlayers: 4,
  victoryPoints: () => 14,
  map: (): MapSpec => ({
    rows: [
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
      '~ ~ ~ ~ ~ p@isle g ~ ~ ~ ~ ~ ~',
      '~ ?@west ? ~ ~ ~ ~ ~ ~ ?@east ? ~ ~',
      '~ ? ? ~ ~ f@isle m ~ ~ ? ? ~ ~',
      '~ ? ? ? ~ ~ ~ ~ ~ ? ? ? ~',
      '~ ? ? ~ ~ h@isle p ~ ~ ? ? ~ ~',
      '~ ? ? ~ ~ ~ ~ ~ ~ ? ? ~ ~',
      '~ ~ ~ ~ ~ g@isle f ~ ~ ~ ~ ~ ~',
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
    ],
    pools: {
      default: {
        terrains: { forest: 5, pasture: 4, fields: 4, hills: 4, mountains: 4, desert: 1 },
        tokens: withoutTokens(TOKENS_28, [2, 12]),
      },
    },
    harbors: { spots: 'auto', pool: HARBORS_BASE, zones: ['west', 'east'] },
    robber: 'desert',
    pirate: 'offboard',
  }),
  ...seafarersSupply,
  rules: seafarersRules({
    longestRoute: false,
    forbiddenZones: ['isle'],
    robberForbiddenZones: ['isle'],
    setupRounds: [
      { order: 'forward', collect: false },
      { order: 'reverse', collect: false },
      { order: 'forward', collect: true },
    ],
  }),
  hooks: {
    init(state) {
      const villages: Record<VertexId, Village> = {};
      const islets: string[][] = [];
      for (const [h, hex] of Object.entries(state.board.hexes)) {
        if (hex.zone !== 'isle') continue;
        const row = islets.find((x) => state.board.hexes[x[0]].r === hex.r);
        if (row) row.push(h);
        else islets.push([h]);
      }
      islets.sort((a, b) => state.board.hexes[a[0]].r - state.board.hexes[b[0]].r);
      islets.forEach((pair, i) => {
        pair.sort((a, b) => state.board.hexes[a].q - state.board.hexes[b].q);
        const left = cornerVertex(parseHexId(pair[0]), 3);
        const right = cornerVertex(parseHexId(pair[pair.length - 1]), 0);
        villages[left] = { token: VILLAGE_TOKENS[i % 4][0], cloth: CLOTH_PER_VILLAGE, traders: [] };
        villages[right] = { token: VILLAGE_TOKENS[i % 4][1], cloth: CLOTH_PER_VILLAGE, traders: [] };
      });
      state.ext.cloth = { villages, general: CLOTH_GENERAL_SUPPLY, cloth: state.players.map(() => 0) } satisfies ClothState;
    },
    afterEdge(state, player, edge, kind) {
      if (kind !== 'ship') return;
      const c = clothOf(state);
      for (const v of topo(state).edgeVertices[edge]) {
        const village = c.villages[v];
        if (!village || village.traders.includes(player)) continue;
        village.traders.push(player);
        const got = giveCloth(state, player, village, false);
        log(state, `${nameOf(state, player)} reaches a village${got ? ' and receives 1 cloth' : ''}`);
      }
    },
    afterRoll(state, dice) {
      const sum = dice[0] + dice[1];
      if (sum === 7) return;
      const c = clothOf(state);
      for (const village of Object.values(c.villages)) {
        if (village.token !== sum || village.cloth === 0 || village.traders.length === 0) continue;
        // The current player is served first, then the traders in order of arrival.
        const cur = state.turn.current;
        const order = village.traders.includes(cur) ? [cur, ...village.traders.filter((p) => p !== cur)] : village.traders;
        for (const p of order) {
          if (!giveCloth(state, p, village, true)) break;
          log(state, `${nameOf(state, p)} receives 1 cloth`);
        }
        if (village.cloth === 0) log(state, 'A village has run out of cloth');
      }
    },
    canMovePirate(state, player) {
      return hasTrade(state, player);
    },
    stealChoices(state, _thief, victim, piece) {
      return piece === 'pirate' && clothOf(state).cloth[victim] > 0 ? ['cloth'] : [];
    },
    steal(state, thief, victim, take) {
      if (take !== 'cloth') return;
      const c = clothOf(state);
      c.cloth[victim]--;
      c.cloth[thief]++;
      log(state, `${nameOf(state, thief)} steals 1 cloth from ${nameOf(state, victim)}`);
    },
    routeAnchors(state) {
      return Object.keys(clothOf(state).villages);
    },
    extraVP(state, p) {
      return Math.floor(clothOf(state).cloth[p] / 2);
    },
    checkEnd(state) {
      const c = clothOf(state);
      const withCloth = Object.values(c.villages).filter((v) => v.cloth > 0).length;
      if (withCloth >= VILLAGES_WITH_CLOTH_MIN) return null;
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
      return { winner: best, reason: `only ${withCloth} villages still have cloth; most victory points` };
    },
  },
};
