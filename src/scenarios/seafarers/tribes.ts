import { spreadEdges, styledMap, type DraftMap } from '../../board/generator.js';
import { DIR_NAMES, axialToOffset, edgeKey, neighborId, parseHexId } from '../../board/hex.js';
import { markEdge, markVertex, type MapMark } from '../../board/mapSpec.js';
import { nextInt, shuffle } from '../../core/rng.js';
import type { Action, DevCardType, EdgeId, GameState, HarborType, HexId, PlayerId, RngState, VertexId } from '../../core/types.js';
import { harborEdgeError } from '../../engine/apply.js';
import { log, nameOf } from '../../rules/helpers.js';
import { topo, totalVP } from '../../rules/queries.js';
import { seafarersRules, type ScenarioDef } from '../types.js';
import { seafarersSupply } from './common.js';
import { CLOTH_FOR_CATAN, FORGOTTEN_TRIBE } from './officialMaps.js';

const offsetOf = (id: HexId) => {
  const { col, row } = axialToOffset(parseHexId(id));
  return `${col},${row}`;
};

// 5 ---------------------------------------------------------------------------

const tribeRules = seafarersRules({ forbiddenZones: ['tribe'], robberForbiddenZones: ['tribe'], robberNeedsToken: true });

type Gift = 'vp' | 'devCard' | 'harbor';

interface TribeState {
  /** Gifts on marked coastal paths of the tribe islands. */
  gifts: Record<EdgeId, Gift>;
  /** Harbor type lying on each harbor gift spot (face up). */
  harborAt: Record<EdgeId, HarborType>;
  /** Development cards set aside from the deck for the gift spots (face down). */
  giftCards: DevCardType[];
}

/** 8 VP chits (1 VP each), 4 development cards and 6 harbors. */
export const TRIBE_GIFTS: Gift[] = [
  ...Array<Gift>(8).fill('vp'),
  ...Array<Gift>(4).fill('devCard'),
  ...Array<Gift>(6).fill('harbor'),
];

/** The scenario's 6 harbors are all gifts: one 2:1 harbor per resource and one generic 3:1. */
export const TRIBE_HARBORS: HarborType[] = ['brick', 'lumber', 'wool', 'grain', 'ore', 'generic'];

/** What players see of a gift spot: VP chits and harbors lie face up, development cards face down. */
export type GiftView = 'vp' | 'devCard' | `harbor:${HarborType}`;

function legalHarborEdges(state: GameState, p: PlayerId): EdgeId[] {
  return topo(state).edgeIds.filter((e) => harborEdgeError(state, e, p) === null);
}

/**
 * Gift spots on a new map: 18 coastal paths of the tribe islands, spread
 * around them (no two on one intersection where the coasts allow), with the
 * gifts dealt onto them at random.
 */
function giftSpots(map: DraftMap, rng: RngState): Record<string, MapMark[]> | null {
  const t = map.topology;
  const coasts: Array<{ land: HexId; dir: number }> = [];
  for (const [id, h] of Object.entries(map.hexes).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (h.zone !== 'tribe') continue;
    for (let d = 0; d < 6; d++) if (map.hexes[neighborId(id, d)]?.terrain === 'sea') coasts.push({ land: id, dir: d });
  }
  const picked = spreadEdges(
    t,
    coasts.map((c) => edgeKey(c.land, neighborId(c.land, c.dir))),
    TRIBE_GIFTS.length,
    rng,
  );
  if (!picked) return null;
  const gifts = shuffle(rng, [...TRIBE_GIFTS]);
  const out: Record<Gift, MapMark[]> = { vp: [], devCard: [], harbor: [] };
  picked.forEach((i, k) => out[gifts[k]].push({ at: offsetOf(coasts[i].land), side: DIR_NAMES[coasts[i].dir] }));
  return out;
}

export const theForgottenTribe: ScenarioDef = {
  id: 'seafarers-5-forgotten-tribe',
  name: 'The Forgotten Tribe',
  expansion: 'seafarers',
  description:
    'The tribe islands cannot be settled. Building or moving a ship onto a marked path collects its gift: a VP chit, a development card, or a harbor that must be placed next to your own coastal settlement at once if possible. The robber only visits numbered hexes. 13 VP to win.',
  minPlayers: 3,
  maxPlayers: 4,
  victoryPoints: () => 13,
  officialMap: () => FORGOTTEN_TRIBE,
  map: (players) => styledMap(FORGOTTEN_TRIBE, { players, rules: tribeRules, marks: giftSpots }),
  ...seafarersSupply,
  rules: tribeRules,
  hooks: {
    init(state, map) {
      // The map marks where each kind of gift lies; the harbor types and cards are random.
      const giftAt: Record<EdgeId, Gift> = {};
      for (const g of ['vp', 'devCard', 'harbor'] as const) for (const m of map.marks?.[g] ?? []) giftAt[markEdge(m)] = g;
      // The top development cards are set aside, face down, for the gift spots.
      const giftCards: DevCardType[] = [];
      for (const g of Object.values(giftAt)) {
        const c = g === 'devCard' ? state.devDeck.pop() : undefined;
        if (c) giftCards.push(c);
      }
      const harbors = shuffle(state.rng, [...TRIBE_HARBORS]);
      const harborAt: Record<EdgeId, HarborType> = {};
      for (const [e, g] of Object.entries(giftAt)) if (g === 'harbor') harborAt[e] = harbors.pop() ?? 'generic';
      state.ext.tribe = { gifts: giftAt, harborAt, giftCards } satisfies TribeState;
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
        const type = tribe.harborAt[edge] ?? 'generic';
        delete tribe.harborAt[edge];
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
      // VP chits and harbors lie face up; development cards stay face down.
      const spots: Record<EdgeId, GiftView> = {};
      for (const [e, g] of Object.entries(tribe.gifts)) spots[e] = g === 'harbor' ? `harbor:${tribe.harborAt[e] ?? 'generic'}` : g;
      state.ext.tribe = { spots, cardsLeft: tribe.giftCards.length };
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

/** The village numbers come in pairs, one pair per tribe island (as printed: 9/10, 3/6, 8/11, 5/4). */
const VILLAGE_PAIRS: number[][] = [...new Set(CLOTH_FOR_CATAN.marks!.village.map((m) => m.at))].map((at) =>
  CLOTH_FOR_CATAN.marks!.village.filter((m) => m.at === at).map((m) => m.value!),
);

const clothRules = seafarersRules({
  longestRoute: false,
  forbiddenZones: ['isle'],
  robberForbiddenZones: ['isle'],
  setupRounds: [
    { order: 'forward', collect: false },
    { order: 'reverse', collect: false },
    { order: 'forward', collect: true },
  ],
});

/**
 * Villages on a new map: each tribe island keeps two, on its top and bottom
 * corners (facing the two big islands), with a printed pair of numbers dealt
 * at random. (The islands lie a sea hex apart, so no two villages share an
 * intersection; as on the printed map, two may be the two ends of a path.)
 */
function villageSpots(map: DraftMap, rng: RngState): Record<string, MapMark[]> | null {
  const isles = map.bodies.filter((b) => b.zone === 'isle').map((b) => b.cells[0]);
  const pairs = shuffle(rng, VILLAGE_PAIRS.map((p) => [...p]));
  if (isles.length !== pairs.length) return null;
  const village: MapMark[] = [];
  isles.forEach((id, i) => {
    const [a, b] = nextInt(rng, 2) ? pairs[i] : [pairs[i][1], pairs[i][0]];
    village.push({ at: offsetOf(id), corner: 'N', value: a }, { at: offsetOf(id), corner: 'S', value: b });
  });
  return { village };
}

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

/** The rulebook's "Cloth for Catan". */
export const clothTrade: ScenarioDef = {
  id: 'seafarers-6-cloth-trade',
  name: 'Cloth Trade',
  expansion: 'seafarers',
  description:
    'Three starting settlements. Reach the villages of the small islands with ships to trade for cloth: 1 on arrival and 1 whenever the village number is rolled. Every 2 cloth is 1 VP. The pirate may steal cloth. No Longest Trade Route. 14 VP, or most VP once fewer than 4 villages have cloth.',
  minPlayers: 3,
  maxPlayers: 4,
  victoryPoints: () => 14,
  officialMap: () => CLOTH_FOR_CATAN,
  map: (players) => styledMap(CLOTH_FOR_CATAN, { players, rules: clothRules, marks: villageSpots }),
  ...seafarersSupply,
  rules: clothRules,
  hooks: {
    init(state, map) {
      // The map's villages: number tokens on marked intersections.
      const villages: Record<VertexId, Village> = {};
      for (const m of map.marks?.village ?? []) villages[markVertex(m)] = { token: m.value ?? 0, cloth: CLOTH_PER_VILLAGE, traders: [] };
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
