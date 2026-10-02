import { isLandTerrain } from '../board/mapSpec.js';
import { CARDS, RESOURCES, TERRAIN_RESOURCE } from '../core/constants.js';
import { isResource, total } from '../core/resources.js';
import { nextInt, rollDie } from '../core/rng.js';
import type {
  Action,
  Card,
  CardCounts,
  CkState,
  Commodity,
  EventFace,
  GameState,
  HexId,
  ImprovementTrack,
  Phase,
  PlayerId,
  ProgressCardName,
  VertexId,
} from '../core/types.js';
import { addGoldChoice, describeCounts, log, nameOf, payFromBank } from '../rules/helpers.js';
import { updateLongestRoute } from '../rules/longestRoute.js';
import { buildingsOf, topo } from '../rules/queries.js';
import { scenarioOf } from '../scenarios/registry.js';
import { noteCommodityProduction, noteProduction } from '../engine/stats.js';
import { bankOf, hasCards, moveCards } from './cards.js';
import {
  ABILITY_LEVEL,
  BARBARIAN_TRACK,
  CK_COSTS,
  EVENT_DIE,
  IMPROVEMENT_NAMES,
  MAX_CITY_WALLS,
  MAX_IMPROVEMENT,
  METROPOLIS_LEVEL,
  PROGRESS_CARD_NAMES,
  PROGRESS_CARDS,
  TERRAIN_COMMODITY,
  TRACK_COMMODITY,
  TRACKS,
  WALL_HAND_BONUS,
  commodityBank,
  defenderCards,
  drawsOn,
  improvementCost,
} from './constants.js';
import {
  KNIGHT_NAMES,
  activeStrength,
  chaseError,
  displaceError,
  knightPlacementError,
  moveKnightError,
  promoteError,
  retreatSpots,
} from './knights.js';
import {
  drawProgress,
  newDecks,
  progressDiscardsDue,
  progressEffect,
  progressExcess,
  returnToDeck,
  takeFromHand,
} from './progress.js';

/**
 * Cities & Knights as a rules module: applyAction routes the expansion's
 * actions here and calls these functions at the points where the expansion
 * changes the base turn (set-up, the roll, the 7, building a city, ending a
 * turn). Everything is keyed on `state.ck`, so games without it never reach
 * this code. Page numbers refer to the 5th-edition Game Rules & Almanac (2020).
 */

type A<T extends Action['type']> = Extract<Action, { type: T }>;

export function initCk(s: GameState): CkState {
  // the 5-6 Player Extension adds commodities and Defender cards (constants.ts)
  const bank = commodityBank(s.players.length);
  return {
    bank: { paper: bank, cloth: bank, coin: bank },
    barbarians: 0,
    attacks: 0,
    decks: newDecks(s.rng),
    defenderCards: defenderCards(s.players.length),
    knights: {},
    metropolises: { trade: null, politics: null, science: null },
    merchant: null,
    tipped: [],
    event: null,
    turnEffects: [],
    players: s.players.map(() => ({
      commodities: { paper: 0, cloth: 0, coin: 0 },
      improvements: { trade: 0, politics: 0, science: 0 },
      walls: [],
      progress: [],
      vpCards: [],
      defenders: 0,
    })),
  };
}

const EVENT_LABEL: Record<EventFace, string> = {
  ship: 'the barbarian ship',
  trade: 'the yellow city gate (trade)',
  politics: 'the blue city gate (politics)',
  science: 'the green city gate (science)',
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** The robber (and pirate) only move once the barbarians have attacked (p. 5). */
export function robberActive(s: GameState): boolean {
  return !s.ck || s.ck.attacks > 0;
}

/** The set-up round that collects starting resources places a city instead of a settlement (p. 4). */
export function setupPlacesCity(s: GameState, round: number): boolean {
  return !!s.ck && scenarioOf(s).rules.setupRounds[round].collect;
}

/** Hand size above which a 7 forces a discard: +2 per city wall (p. 6). */
export function sevenLimit(s: GameState, p: PlayerId): number {
  return s.options.discardLimit + (s.ck ? s.ck.players[p].walls.length * WALL_HAND_BONUS : 0);
}

export function isMetropolis(s: GameState, v: VertexId): boolean {
  return TRACKS.some((t) => s.ck?.metropolises[t]?.vertex === v);
}

/** The player's cities (a pillaged city lying on its side is a settlement). */
export function citiesOf(s: GameState, p: PlayerId): VertexId[] {
  return buildingsOf(s, p).cities;
}

/** Cities the barbarians can pillage: not metropolises (p. 8, 11). */
export function pillageableCities(s: GameState, p: PlayerId): VertexId[] {
  return citiesOf(s, p).filter((v) => !isMetropolis(s, v));
}

/** Barbarian strength: every city on the board, metropolises included (p. 11). */
export function barbarianStrength(s: GameState): number {
  return Object.values(s.board.buildings).filter((b) => b.type === 'city').length;
}

export function improvementPrice(s: GameState, p: PlayerId, track: ImprovementTrack): CardCounts {
  const next = s.ck!.players[p].improvements[track] + 1;
  let n = improvementCost(next);
  // Crane: one improvement this turn costs one commodity less (Almanac p. 14).
  if (s.ck!.turnEffects.some((e) => e.player === p && e.effect === 'crane')) n = Math.max(0, n - 1);
  return { [TRACK_COMMODITY[track]]: n };
}

/**
 * Why the player cannot buy the next level of `track` now (null: they can).
 * Whether it wins the metropolis is `winsMetropolis`. `ignoreCost`: whether
 * they could, given the commodities (the Crane).
 */
export function improvementError(s: GameState, p: PlayerId, track: ImprovementTrack, ignoreCost = false): string | null {
  const ck = s.ck!;
  if (!TRACKS.includes(track)) return 'no such city improvement';
  const level = ck.players[p].improvements[track];
  if (level >= MAX_IMPROVEMENT) return `your ${track} is fully developed`;
  const cities = citiesOf(s, p);
  if (cities.length === 0) return 'you need a city to build city improvements';
  const next = level + 1;
  // Beyond level 3 you need a city where a metropolis could stand (p. 8).
  const holds = ck.metropolises[track]?.owner === p;
  if (next >= METROPOLIS_LEVEL && !holds && cities.every((v) => isMetropolis(s, v))) {
    return 'you need a city without a metropolis to build beyond level 3';
  }
  if (!ignoreCost && !hasCards(s, p, improvementPrice(s, p, track))) return `not enough ${TRACK_COMMODITY[track]}`;
  return null;
}

/** Whether reaching the next level of `track` wins its metropolis. */
export function winsMetropolis(s: GameState, p: PlayerId, track: ImprovementTrack): boolean {
  const ck = s.ck!;
  const next = ck.players[p].improvements[track] + 1;
  const m = ck.metropolises[track];
  if (next === METROPOLIS_LEVEL) return m === null;
  if (next === MAX_IMPROVEMENT) return m === null || (m.owner !== p && ck.players[m.owner].improvements[track] < MAX_IMPROVEMENT);
  return false;
}

/** Cities that could take a metropolis. */
export function metropolisSites(s: GameState, p: PlayerId): VertexId[] {
  return citiesOf(s, p).filter((v) => !isMetropolis(s, v));
}

export function merchantHexError(s: GameState, p: PlayerId, hex: HexId): string | null {
  const h = s.board.hexes[hex];
  if (!h || !isLandTerrain(h.terrain)) return 'the merchant goes on a land hex';
  if (h.terrain === 'gold') return 'the merchant may not go on a gold field';
  if (!topo(s).hexVertices[hex].some((v) => s.board.buildings[v]?.owner === p)) {
    return 'the merchant goes next to one of your settlements or cities';
  }
  return null;
}

/** The Merchant card: puts the merchant on a hex under `p`'s control (Almanac pp. 17-18). */
export function placeMerchant(s: GameState, p: PlayerId, hex: HexId): string | null {
  const err = merchantHexError(s, p, hex);
  if (err) return err;
  s.ck!.merchant = { hex, owner: p };
  const terrain = s.board.hexes[hex].terrain;
  const r = TERRAIN_RESOURCE[terrain];
  log(s, `${nameOf(s, p)} places the merchant on a ${terrain} hex${r ? ` (${r} 2:1)` : ''}`);
  return null;
}

// ---------------------------------------------------------------------------
// The roll: event die first, then production (p. 5)
// ---------------------------------------------------------------------------

/** Rolls the yellow and red dice (unless `fixed`, the Alchemist) and the event die, and resolves the event. */
export function ckRollDice(s: GameState, p: PlayerId, fixed?: [number, number]): void {
  const ck = s.ck!;
  const dice: [number, number] = fixed ?? [rollDie(s.rng), rollDie(s.rng)];
  const event = EVENT_DIE[nextInt(s.rng, EVENT_DIE.length)];
  s.turn.dice = dice;
  ck.event = event;
  (s.rolls ??= []).push({ by: p, dice: [dice[0], dice[1]], turn: s.turn.number, event, ...(fixed ? { chosen: true as const } : {}) });
  log(s, `${nameOf(s, p)} ${fixed ? 'sets the dice to' : 'rolls'} ${dice[0] + dice[1]} (${dice[0]}+${dice[1]})`);
  log(s, `The event die shows ${EVENT_LABEL[event]}; the red die is ${dice[1]}`);
  s.phase = { kind: 'ck', step: 'production', resume: { kind: 'main' } };
  if (event === 'ship') advanceBarbarians(s);
  else progressDraws(s, event, dice[1]);
}

function turnOrder(s: GameState): PlayerId[] {
  const n = s.players.length;
  return Array.from({ length: n }, (_, i) => (s.turn.current + i) % n);
}

/** City gate: everyone whose improvement in that colour shows the red die draws, in turn order (p. 5, 9). */
function progressDraws(s: GameState, track: ImprovementTrack, red: number): void {
  const ck = s.ck!;
  for (const p of turnOrder(s)) {
    if (drawsOn(ck.players[p].improvements[track], red)) drawProgress(s, p, track);
  }
  const due = progressDiscardsDue(s);
  if (Object.keys(due).length > 0) s.phase = { kind: 'ck', step: 'progressDiscard', pending: due, resume: s.phase };
}

function advanceBarbarians(s: GameState): void {
  const ck = s.ck!;
  ck.barbarians++;
  if (ck.barbarians < BARBARIAN_TRACK) {
    log(s, `The barbarian ship sails closer (${ck.barbarians} of ${BARBARIAN_TRACK})`);
    return;
  }
  barbarianAttack(s);
}

/**
 * The barbarians land (p. 11): every city (metropolises included) against
 * every active knight. If the barbarians are stronger, the players with a
 * city they can pillage who contributed the least each lose a city;
 * otherwise the sole strongest contributor becomes Defender of Catan (1 VP)
 * and tied contributors each draw a progress card of their choice. Then the
 * ship goes home and every knight is deactivated.
 */
export function barbarianAttack(s: GameState): void {
  const ck = s.ck!;
  const order = turnOrder(s);
  const strength = s.players.map((pl) => activeStrength(s, pl.id));
  const barbarians = barbarianStrength(s);
  const defence = strength.reduce((a, b) => a + b, 0);
  log(s, `The barbarians attack: ${barbarians} against the knights' ${defence}`);
  let next: Phase = s.phase;
  if (barbarians > defence) {
    // Players with no city or only metropolises are immune; the next-lowest suffer instead.
    const eligible = order.filter((p) => pillageableCities(s, p).length > 0);
    if (eligible.length === 0) {
      log(s, 'The barbarians win, but find no city to pillage');
    } else {
      const least = Math.min(...eligible.map((p) => strength[p]));
      const pending: Record<string, number> = {};
      for (const p of eligible) {
        if (strength[p] !== least) continue;
        const cities = pillageableCities(s, p);
        if (cities.length === 1) pillage(s, cities[0]);
        else pending[p] = 1;
      }
      if (Object.keys(pending).length > 0) {
        log(s, `${Object.keys(pending).map((p) => nameOf(s, Number(p))).join(' and ')} must choose a city to lose`);
        next = { kind: 'ck', step: 'pillage', pending, resume: next };
      }
    }
  } else {
    const most = Math.max(...strength);
    const top = order.filter((p) => strength[p] === most);
    if (top.length === 1) {
      const p = top[0];
      if (ck.defenderCards > 0) {
        ck.defenderCards--;
        ck.players[p].defenders++;
        log(s, `Catan is saved! ${nameOf(s, p)} is the Defender of Catan (1 VP)`);
      } else {
        log(s, `Catan is saved! ${nameOf(s, p)} defended best, but no Defender of Catan card is left`);
      }
    } else {
      log(s, `Catan is saved! ${top.map((p) => nameOf(s, p)).join(', ')} tie as its best defenders and each draw a progress card`);
      next = { kind: 'ck', step: 'progressDiscard', pending: {}, resume: next, lazy: true };
      next = { kind: 'ck', step: 'defenderDraw', queue: top, resume: next };
    }
  }
  ck.barbarians = 0;
  for (const k of Object.values(ck.knights)) k.active = false;
  if (ck.attacks === 0) {
    if (ck.asleep) wakeRobberAndPirate(s);
    else log(s, 'The barbarians return home; from now on the robber can be moved');
  } else log(s, 'The barbarians return home');
  ck.attacks++;
  s.phase = next;
}

/**
 * Seafarers scenarios, the first attack: the robber and the pirate leave the
 * barbarian track for the hexes where the scenario starts them (2025
 * rulebook p. 12: "follow the directions in the Seafarers scenario for
 * initial pirate placement"); from now on they move as usual. Nobody is
 * robbed as they arrive.
 */
function wakeRobberAndPirate(s: GameState): void {
  const ck = s.ck!;
  const { robber, pirate } = ck.asleep!;
  delete ck.asleep;
  s.board.robber = robber;
  s.board.pirate = pirate;
  const pieces = [robber !== null ? 'robber' : null, pirate !== null ? 'pirate' : null].filter((x) => x !== null);
  log(
    s,
    pieces.length === 0
      ? 'The barbarians return home; from now on the robber can be moved'
      : `The barbarians return home; the ${pieces.join(' and the ')} ${pieces.length > 1 ? 'take their places' : 'takes its place'} on the board and can be moved from now on`,
  );
}

/** Reduces a city to a settlement; its city wall goes too (p. 6, 11). */
export function pillage(s: GameState, v: VertexId): void {
  const ck = s.ck!;
  const b = s.board.buildings[v];
  const pl = s.players[b.owner];
  b.type = 'settlement';
  if (pl.supply.settlements > 0) {
    pl.supply.settlements--;
    pl.supply.cities++;
  } else {
    // 2025 rulebook: with no settlement left, the city lies on its side as one.
    ck.tipped.push(v);
  }
  const walls = ck.players[b.owner].walls;
  const wall = walls.indexOf(v);
  if (wall >= 0) walls.splice(wall, 1);
  log(s, `The barbarians pillage a city of ${pl.name}${wall >= 0 ? ' and its city wall' : ''}`);
}

function robberPhase(s: GameState, resume: Phase): Phase {
  if (!robberActive(s)) {
    log(s, 'The robber stays put until the barbarians first attack');
    return resume;
  }
  const r = scenarioOf(s).rules;
  if (!r.robber && !r.pirate) return resume;
  return { kind: 'robber', reason: 'seven', resume };
}

/** The 'production' step: a 7 (discards, then the robber once active) or production and the aqueduct. */
function production(s: GameState, resume: Phase): void {
  const dice = s.turn.dice!;
  const sum = dice[0] + dice[1];
  // what a scenario adds to a roll (Cloth for Catan: the villages' cloth), as after the base game's roll
  const afterRoll = scenarioOf(s).hooks.afterRoll;
  if (sum === 7) {
    s.phase = { kind: 'discard', pending: {}, resume: robberPhase(s, resume), lazy: true };
    afterRoll?.(s, [dice[0], dice[1]]);
    return;
  }
  s.phase = resume;
  const prod = produceCards(s, sum);
  const pending: Record<string, number> = {};
  for (const pl of s.players) {
    if (s.ck!.players[pl.id].improvements.science >= ABILITY_LEVEL && !prod.received.has(pl.id)) pending[pl.id] = 1;
  }
  if (Object.keys(pending).length > 0 && total(s.bank) > 0) {
    s.phase = { kind: 'ck', step: 'aqueduct', pending, resume: s.phase };
  }
  addGoldChoice(s, prod.gold);
  afterRoll?.(s, [dice[0], dice[1]]);
}

/**
 * Production with commodities (p. 5, 7): a settlement takes 1 resource; a
 * city takes 2 brick or 2 grain on hills and fields, and 1 resource plus 1
 * commodity on forest (paper), pasture (cloth) and mountains (coin). Gold
 * fields pay free picks as usual. The bank-shortage rule applies to each
 * kind of card separately.
 */
export function produceCards(s: GameState, roll: number): { dealt: Record<number, CardCounts>; gold: Record<number, number>; received: Set<PlayerId> } {
  const ck = s.ck!;
  const t = topo(s);
  const demand = new Map<Card, Map<PlayerId, number>>(CARDS.map((k) => [k, new Map()]));
  const gold: Record<number, number> = {};
  const add = (k: Card, p: PlayerId, n: number) => demand.get(k)!.set(p, (demand.get(k)!.get(p) ?? 0) + n);
  for (const id of Object.keys(s.board.hexes)) {
    const hex = s.board.hexes[id];
    if (hex.token !== roll || id === s.board.robber) continue;
    const res = TERRAIN_RESOURCE[hex.terrain];
    const com = TERRAIN_COMMODITY[hex.terrain];
    if (!res && hex.terrain !== 'gold') continue;
    for (const v of t.hexVertices[id]) {
      const b = s.board.buildings[v];
      if (!b) continue;
      const city = b.type === 'city';
      if (!res) {
        gold[b.owner] = (gold[b.owner] ?? 0) + (city ? 2 : 1);
      } else if (!city) {
        add(res, b.owner, 1);
      } else if (com) {
        add(res, b.owner, 1);
        add(com, b.owner, 1);
      } else {
        add(res, b.owner, 2);
      }
    }
  }
  const dealt: Record<number, CardCounts> = {};
  const shortages: Card[] = [];
  const bank = bankOf(s);
  const pay = (k: Card, p: PlayerId, n: number) => {
    if (n <= 0) return;
    if ((RESOURCES as readonly string[]).includes(k)) payFromBank(s, p, { [k]: n });
    else moveCards(s, 'bank', p, { [k]: n });
    (dealt[p] ??= {})[k] = n;
  };
  for (const k of CARDS) {
    const owed = demand.get(k)!;
    if (owed.size === 0) continue;
    let need = 0;
    for (const n of owed.values()) need += n;
    if (need > bank[k]) {
      if (owed.size === 1) {
        const [[p, n]] = [...owed.entries()];
        pay(k, p, Math.min(n, bank[k]));
        if (bank[k] < n) shortages.push(k);
      } else {
        shortages.push(k);
      }
      continue;
    }
    for (const [p, n] of owed) pay(k, p, n);
  }
  for (const [p, got] of Object.entries(dealt)) log(s, `${nameOf(s, Number(p))} receives ${describeCounts(got)}`);
  for (const k of shortages) log(s, `The bank is short of ${k}: it is not paid out`);
  // statistics: resources as in the base game, commodities apart
  const resources: Record<number, CardCounts> = {};
  const commodities: Record<number, Partial<Record<Commodity, number>>> = {};
  for (const [p, got] of Object.entries(dealt)) {
    for (const [k, n] of Object.entries(got)) {
      if (isResource(k)) (resources[Number(p)] ??= {})[k] = n;
      else (commodities[Number(p)] ??= {})[k as Commodity] = n;
    }
  }
  noteProduction(s, resources);
  noteCommodityProduction(s, commodities);
  const received = new Set<PlayerId>([...Object.keys(dealt), ...Object.keys(gold)].map(Number));
  return { dealt, gold, received };
}

/** Resolves phases nobody has to act in; true when it changed the phase (applyAction's settle loop). */
export function ckSettle(s: GameState): boolean {
  const ph = s.phase;
  if (ph.kind !== 'ck') return false;
  switch (ph.step) {
    case 'production':
      production(s, ph.resume);
      return true;
    case 'progressDiscard':
      if (ph.lazy) {
        s.phase = { kind: 'ck', step: 'progressDiscard', pending: progressDiscardsDue(s), resume: ph.resume };
        return true;
      }
      if (Object.keys(ph.pending).length === 0) {
        s.phase = ph.resume;
        return true;
      }
      return false;
    case 'pillage':
      if (Object.keys(ph.pending).length === 0) {
        s.phase = ph.resume;
        return true;
      }
      return false;
    case 'aqueduct':
      if (Object.keys(ph.pending).length === 0 || total(s.bank) === 0) {
        s.phase = ph.resume;
        return true;
      }
      return false;
    case 'defenderDraw': {
      const ck = s.ck!;
      if (ph.queue.length > 0 && TRACKS.every((t) => ck.decks[t].length === 0)) {
        log(s, 'Every progress deck is empty');
        s.phase = ph.resume;
        return true;
      }
      if (ph.queue.length === 0) {
        s.phase = ph.resume;
        return true;
      }
      return false;
    }
    case 'retreat':
      if (retreatSpots(s, ph.player, ph.from).length === 0) {
        log(s, `${nameOf(s, ph.player)}'s knight has nowhere to go and leaves the board`);
        s.phase = ph.resume;
        return true;
      }
      return false;
    case 'card':
      // every player the card waited on has answered
      if (ph.pending && Object.keys(ph.pending).length === 0) {
        s.phase = ph.resume;
        return true;
      }
      return false;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Building (knights, walls, improvements, activating, promoting): as for roads and cities. */
function buildError(s: GameState, p: PlayerId): string | null {
  if (s.turn.actor !== p) return 'it is not your turn';
  if (s.phase.kind === 'main' || s.phase.kind === 'specialBuild') return null;
  if (s.phase.kind === 'preRoll') return 'roll the dice first';
  return 'you cannot build right now';
}

/**
 * The parts of a turn with knight actions and progress cards: the player who
 * rolled, and with 5-6 players and paired players, player 2's action phase
 * (C&K 5-6 rules, 2023 p. 3, 2025 pp. 3-4). Never the special build phase
 * (2020 p. 3), which only builds, activates and promotes.
 */
export function ckActionPart(s: GameState): boolean {
  return s.turn.role === 'active' || s.turn.role === 'paired';
}

/** Knight actions and progress cards: your own turn (or paired part), after rolling. */
function turnError(s: GameState, p: PlayerId): string | null {
  if (s.turn.actor !== p) return 'it is not your turn';
  if (s.phase.kind !== 'main') {
    if (s.phase.kind === 'specialBuild') return 'not allowed in the special build phase';
    return s.phase.kind === 'preRoll' ? 'roll the dice first' : 'not allowed right now';
  }
  if (!ckActionPart(s)) return 'not allowed in this part of the turn';
  return null;
}

function pay(s: GameState, p: PlayerId, cost: CardCounts): string | null {
  if (!hasCards(s, p, cost)) return 'not enough resources';
  moveCards(s, p, 'bank', cost);
  return null;
}

export const CK_ACTIONS = new Set<Action['type']>([
  'buildKnight',
  'activateKnight',
  'promoteKnight',
  'moveKnight',
  'displaceKnight',
  'retreatKnight',
  'chaseRobber',
  'buildCityWall',
  'improveCity',
  'pillageCity',
  'drawProgress',
  'discardProgress',
  'aqueduct',
  'playProgress',
  'progressChoice',
]);

/** Handles the expansion's own actions; returns an error or null. */
export function ckAction(s: GameState, a: Action): string | null {
  if (!s.ck) return 'this game is not played with Cities & Knights';
  switch (a.type) {
    case 'buildKnight':
      return buildKnight(s, a);
    case 'activateKnight':
      return activateKnight(s, a);
    case 'promoteKnight':
      return promoteKnight(s, a);
    case 'moveKnight':
      return moveKnight(s, a);
    case 'displaceKnight':
      return displaceKnight(s, a);
    case 'retreatKnight':
      return retreatKnight(s, a);
    case 'chaseRobber':
      return chaseRobber(s, a);
    case 'buildCityWall':
      return buildCityWall(s, a);
    case 'improveCity':
      return improveCity(s, a);
    case 'pillageCity':
      return pillageCity(s, a);
    case 'drawProgress':
      return defenderDraw(s, a);
    case 'discardProgress':
      return discardProgress(s, a);
    case 'aqueduct':
      return aqueduct(s, a);
    case 'playProgress':
      return playProgress(s, a);
    case 'progressChoice':
      return progressChoice(s, a);
    default:
      return `unknown action type "${a.type}"`;
  }
}

function buildKnight(s: GameState, a: A<'buildKnight'>): string | null {
  const e = buildError(s, a.player);
  if (e) return e;
  const err = knightPlacementError(s, a.player, a.vertex);
  if (err) return err;
  const paid = pay(s, a.player, CK_COSTS.knight);
  if (paid) return paid;
  s.turn.buildingStarted = true;
  s.ck!.knights[a.vertex] = { owner: a.player, level: 1, active: false, activatedPart: -1, promotedPart: -1 };
  log(s, `${nameOf(s, a.player)} hires a basic knight`);
  updateLongestRoute(s);
  return null;
}

function ownKnight(s: GameState, p: PlayerId, v: VertexId) {
  const k = s.ck!.knights[v];
  return k && k.owner === p ? k : null;
}

function activateKnight(s: GameState, a: A<'activateKnight'>): string | null {
  const e = buildError(s, a.player);
  if (e) return e;
  const k = ownKnight(s, a.player, a.vertex);
  if (!k) return 'you have no knight there';
  if (k.active) return 'the knight is already active';
  const paid = pay(s, a.player, CK_COSTS.activate);
  if (paid) return paid;
  s.turn.buildingStarted = true;
  k.active = true;
  k.activatedPart = s.turn.part;
  log(s, `${nameOf(s, a.player)} activates a ${KNIGHT_NAMES[k.level]}`);
  return null;
}

function promoteKnight(s: GameState, a: A<'promoteKnight'>): string | null {
  const e = buildError(s, a.player);
  if (e) return e;
  const err = promoteError(s, a.player, a.vertex);
  if (err) return err;
  const paid = pay(s, a.player, CK_COSTS.promote);
  if (paid) return paid;
  s.turn.buildingStarted = true;
  const k = s.ck!.knights[a.vertex];
  k.level = (k.level + 1) as 2 | 3;
  k.promotedPart = s.turn.part;
  log(s, `${nameOf(s, a.player)} promotes a knight to a ${KNIGHT_NAMES[k.level]}`);
  return null;
}

function moveKnight(s: GameState, a: A<'moveKnight'>): string | null {
  const e = turnError(s, a.player);
  if (e) return e;
  const err = moveKnightError(s, a.player, a.from, a.to);
  if (err) return err;
  const ck = s.ck!;
  const k = ck.knights[a.from];
  delete ck.knights[a.from];
  ck.knights[a.to] = { ...k, active: false };
  log(s, `${nameOf(s, a.player)} moves a ${KNIGHT_NAMES[k.level]}`);
  updateLongestRoute(s);
  return null;
}

/**
 * A stronger knight takes the intersection of a weaker opposing knight
 * (p. 10). The displaced knight's owner then moves it along their own roads
 * to an empty intersection, keeping its status; if there is none, it goes
 * back to their supply.
 */
function displaceKnight(s: GameState, a: A<'displaceKnight'>): string | null {
  const e = turnError(s, a.player);
  if (e) return e;
  const err = displaceError(s, a.player, a.from, a.to);
  if (err) return err;
  const ck = s.ck!;
  const k = ck.knights[a.from];
  const victim = ck.knights[a.to];
  delete ck.knights[a.from];
  ck.knights[a.to] = { ...k, active: false };
  log(s, `${nameOf(s, a.player)}'s ${KNIGHT_NAMES[k.level]} displaces ${nameOf(s, victim.owner)}'s ${KNIGHT_NAMES[victim.level]}`);
  if (retreatSpots(s, victim.owner, a.to).length === 0) {
    log(s, `${nameOf(s, victim.owner)}'s knight has nowhere to go and leaves the board`);
  } else {
    s.phase = { kind: 'ck', step: 'retreat', player: victim.owner, from: a.to, knight: victim, resume: s.phase };
  }
  updateLongestRoute(s);
  return null;
}

function retreatKnight(s: GameState, a: A<'retreatKnight'>): string | null {
  const ph = s.phase;
  if (ph.kind !== 'ck' || ph.step !== 'retreat') return 'no knight is retreating';
  if (ph.player !== a.player) return 'it is not your knight';
  if (!retreatSpots(s, a.player, ph.from).includes(a.to)) return 'the knight cannot retreat there';
  s.ck!.knights[a.to] = ph.knight;
  log(s, `${nameOf(s, a.player)} moves the displaced knight`);
  s.phase = ph.resume;
  updateLongestRoute(s);
  return null;
}

function chaseRobber(s: GameState, a: A<'chaseRobber'>): string | null {
  const e = turnError(s, a.player);
  if (e) return e;
  const err = chaseError(s, a.player, a.vertex, a.piece);
  if (err) return err;
  s.ck!.knights[a.vertex].active = false;
  log(s, `${nameOf(s, a.player)}'s knight chases away the ${a.piece}`);
  s.phase = { kind: 'robber', reason: 'chase', piece: a.piece, resume: s.phase };
  return null;
}

function buildCityWall(s: GameState, a: A<'buildCityWall'>): string | null {
  const e = buildError(s, a.player);
  if (e) return e;
  const b = s.board.buildings[a.vertex];
  if (!b || b.owner !== a.player || b.type !== 'city') return 'a city wall goes under one of your cities';
  const walls = s.ck!.players[a.player].walls;
  if (walls.includes(a.vertex)) return 'this city already has a wall';
  if (walls.length >= MAX_CITY_WALLS) return `you may have at most ${MAX_CITY_WALLS} city walls`;
  const paid = pay(s, a.player, CK_COSTS.cityWall);
  if (paid) return paid;
  s.turn.buildingStarted = true;
  walls.push(a.vertex);
  log(s, `${nameOf(s, a.player)} builds a city wall`);
  return null;
}

function improveCity(s: GameState, a: A<'improveCity'>): string | null {
  const e = buildError(s, a.player);
  if (e) return e;
  const err = improvementError(s, a.player, a.track);
  if (err) return err;
  const ck = s.ck!;
  const wins = winsMetropolis(s, a.player, a.track);
  if (wins) {
    if (a.vertex === undefined) return 'choose the city for the metropolis';
    if (!metropolisSites(s, a.player).includes(a.vertex)) return 'the metropolis goes on one of your cities without one';
  } else if (a.vertex !== undefined) {
    return 'this improvement does not win a metropolis';
  }
  const price = improvementPrice(s, a.player, a.track);
  moveCards(s, a.player, 'bank', price);
  ck.turnEffects = ck.turnEffects.filter((x) => !(x.player === a.player && x.effect === 'crane'));
  s.turn.buildingStarted = true;
  const level = ++ck.players[a.player].improvements[a.track];
  log(s, `${nameOf(s, a.player)} builds the ${IMPROVEMENT_NAMES[a.track][level - 1]} (${a.track} level ${level})`);
  if (wins) {
    const before = ck.metropolises[a.track];
    ck.metropolises[a.track] = { owner: a.player, vertex: a.vertex! };
    log(
      s,
      before
        ? `${nameOf(s, a.player)} takes the ${a.track} metropolis from ${nameOf(s, before.owner)}`
        : `${nameOf(s, a.player)} builds the ${a.track} metropolis`,
    );
  }
  return null;
}

function pillageCity(s: GameState, a: A<'pillageCity'>): string | null {
  const ph = s.phase;
  if (ph.kind !== 'ck' || ph.step !== 'pillage' || !ph.pending[a.player]) return 'you do not lose a city now';
  if (!pillageableCities(s, a.player).includes(a.vertex)) return 'choose one of your cities without a metropolis';
  pillage(s, a.vertex);
  delete ph.pending[a.player];
  return null;
}

function defenderDraw(s: GameState, a: A<'drawProgress'>): string | null {
  const ph = s.phase;
  if (ph.kind !== 'ck' || ph.step !== 'defenderDraw') return 'you cannot draw a progress card now';
  if (ph.queue[0] !== a.player) return 'it is not your turn to draw';
  if (!TRACKS.includes(a.deck)) return 'no such deck';
  if (s.ck!.decks[a.deck].length === 0) return 'that deck is empty';
  drawProgress(s, a.player, a.deck);
  ph.queue = ph.queue.slice(1);
  return null;
}

function discardProgress(s: GameState, a: A<'discardProgress'>): string | null {
  const ph = s.phase;
  if (ph.kind === 'ck' && ph.step === 'progressDiscard') {
    if (!ph.pending[a.player]) return 'you do not need to discard a progress card';
  } else {
    const e = turnError(s, a.player);
    if (e) return e;
    if (progressExcess(s, a.player) === 0) return 'you are within the limit of progress cards';
  }
  if (!PROGRESS_CARDS[a.card] || !takeFromHand(s, a.player, a.card)) return 'you do not have that card';
  returnToDeck(s, a.card);
  log(s, `${nameOf(s, a.player)} discards a progress card`);
  log(s, `(${nameOf(s, a.player)} discarded ${PROGRESS_CARDS[a.card].title})`, [a.player]);
  if (ph.kind === 'ck' && ph.step === 'progressDiscard') {
    if (--ph.pending[a.player] <= 0) delete ph.pending[a.player];
  }
  return null;
}

function aqueduct(s: GameState, a: A<'aqueduct'>): string | null {
  const ph = s.phase;
  if (ph.kind !== 'ck' || ph.step !== 'aqueduct' || !ph.pending[a.player]) return 'you have no aqueduct pick now';
  if (a.resource !== undefined) {
    if (!isResource(a.resource)) return 'choose a resource';
    if (s.bank[a.resource] <= 0) return 'the bank has none of that resource';
    payFromBank(s, a.player, { [a.resource]: 1 });
    log(s, `${nameOf(s, a.player)} takes 1 ${a.resource} (Aqueduct)`);
  }
  delete ph.pending[a.player];
  return null;
}

/**
 * When a card may be played: after the roll on your own turn, any number per
 * turn, also the turn it was drawn (p. 6, 9); the Alchemist only before the
 * roll (Almanac p. 14). Never on another player's turn or during another
 * decision (FAQ 95: not before the roll is resolved).
 */
export function progressTimingError(s: GameState, p: PlayerId, card: ProgressCardName): string | null {
  const info = PROGRESS_CARDS[card];
  if (!info) return 'unknown progress card';
  if (info.vp) return 'victory point cards are played when drawn';
  if (info.beforeRoll) {
    if (s.turn.actor !== p || s.turn.role !== 'active') return 'it is not your turn';
    if (s.phase.kind !== 'preRoll') return `${info.title} is played before rolling the dice`;
    return null;
  }
  return turnError(s, p);
}

/**
 * Plays a progress card: it leaves the hand face up for everyone to see
 * (`ck.played`, the log), goes face down under its deck (p. 6) and its
 * effect resolves (src/ck/effects.ts).
 */
function playProgress(s: GameState, a: A<'playProgress'>): string | null {
  const err = progressTimingError(s, a.player, a.card);
  if (err) return err;
  if (!s.ck!.players[a.player].progress.includes(a.card)) return 'you do not have that card';
  const effect = progressEffect(a.card);
  if (!effect) return `${PROGRESS_CARDS[a.card].title} cannot be played yet`;
  if (a.args !== undefined && (typeof a.args !== 'object' || a.args === null || Array.isArray(a.args))) return 'invalid card choices';
  takeFromHand(s, a.player, a.card);
  returnToDeck(s, a.card);
  (s.ck!.played ??= []).push({ player: a.player, card: a.card, turn: s.turn.number });
  log(s, `${nameOf(s, a.player)} plays ${PROGRESS_CARDS[a.card].title}`);
  return effect.play(s, a.player, a.args);
}

/**
 * Answers a progress card: in its 'card' step, from a player it waits on;
 * in the main phase, a move of a card with a lasting effect (`args.card`
 * names it: Commercial Harbor).
 */
function progressChoice(s: GameState, a: A<'progressChoice'>): string | null {
  const ph = s.phase;
  if (a.args !== undefined && (typeof a.args !== 'object' || a.args === null || Array.isArray(a.args))) return 'invalid choice';
  if (ph.kind === 'ck' && ph.step === 'card') {
    const waiting = ph.pending ? !!ph.pending[a.player] : ph.player === a.player;
    if (!waiting) return 'this choice is not yours to make';
    const effect = progressEffect(ph.card);
    if (!effect?.respond) return 'this card takes no choices';
    return effect.respond(s, a.player, a.args);
  }
  const card = a.args?.card as ProgressCardName | undefined;
  if (ph.kind === 'main' && card !== undefined && PROGRESS_CARD_NAMES.includes(card)) {
    const e = turnError(s, a.player);
    if (e) return e;
    const effect = progressEffect(card);
    if (!effect?.turnAct) return 'that card offers no moves now';
    return effect.turnAct(s, a.player, a.args);
  }
  return 'no progress card is waiting on a choice';
}

/**
 * The player whose turn it is must be within the progress hand limit before
 * ending it (2025 rulebook); with paired players, player 2 too before ending
 * their action phase.
 */
export function ckEndTurnError(s: GameState, p: PlayerId): string | null {
  if (!s.ck || !ckActionPart(s)) return null;
  return progressExcess(s, p) > 0 ? 'discard progress cards down to 4 first' : null;
}

/** buildCity in Cities & Knights: a city pillaged onto its side must be the next one rebuilt. */
export function ckCityError(s: GameState, p: PlayerId, v: VertexId): string | null {
  const tipped = s.ck?.tipped ?? [];
  const mine = tipped.filter((x) => s.board.buildings[x]?.owner === p);
  if (mine.length > 0 && !mine.includes(v)) return 'rebuild your pillaged city lying on its side first';
  return null;
}

/** True when `v` is a pillaged city lying on its side (its piece is already on the board). */
export function isTipped(s: GameState, v: VertexId): boolean {
  return !!s.ck?.tipped.includes(v);
}

export function untip(s: GameState, v: VertexId): void {
  s.ck!.tipped = s.ck!.tipped.filter((x) => x !== v);
}
