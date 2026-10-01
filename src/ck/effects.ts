import { CARDS, COMMODITIES, RESOURCES } from '../core/constants.js';
import { cardTotal, isResource } from '../core/resources.js';
import type {
  Card,
  CardCounts,
  Commodity,
  EdgeId,
  GameState,
  HexId,
  KnightLevel,
  Phase,
  PlayerId,
  ProgressCardName,
  Resource,
  Terrain,
  VertexId,
} from '../core/types.js';
import { legalCities, legalEdgePlacements, legalRoads, legalShips } from '../engine/placements.js';
import { describeCounts, log, nameOf, payFromBank } from '../rules/helpers.js';
import { updateLongestRoute } from '../rules/longestRoute.js';
import { handSize, legalRobberMoves, publicVP, topo } from '../rules/queries.js';
import { commodityCount } from './basics.js';
import { cardRates, handOf, hasCards, isCardOf, moveCards, validCards } from './cards.js';
import { MAX_CITY_WALLS, PROGRESS_CARDS, TRACKS } from './constants.js';
import { ckRollDice, improvementError, isTipped, merchantHexError, placeMerchant, robberActive, untip } from './engine.js';
import { KNIGHT_NAMES, knightSiteError, knightsInSupply, knightsOf, onOwnRoute, promoteError, retreatSpots } from './knights.js';
import { cardCombinations } from './legal.js';
import { registerProgressEffect, takeFromHand, type ProgressArgs } from './progress.js';

/**
 * The progress-card effects (5th-edition Game Rules & Almanac, 2020: rules
 * pp. 6 and 9, the Almanac pp. 14-18; catan.com's Cities & Knights FAQ and
 * the 2025 rulebook settle unclear points, see docs/cities-and-knights.md).
 *
 * API, for the browser and the computer players:
 * - `playProgress { card, args }` plays a card; `args` carries the choices
 *   made as it is played (a target player, a hex, a vertex, a resource, the
 *   dice). `legalActions` lists every legal `args`, so the card is only
 *   committed once they are chosen.
 * - Choices that follow (a second knight for the Smith, what other players
 *   give or discard...) are asked in the phase `{ kind: 'ck', step: 'card',
 *   card, player, stage, target?, pending?, data? }` and answered with
 *   `progressChoice { args }` by the `pending` players, or by `player`;
 *   `progressChoice` without `args` declines an optional step. A choice with
 *   a single possible answer is made at once.
 * - The Bishop moves the robber in a `robber` phase with reason 'bishop'
 *   (moveRobber without a victim), Road Building places its roads in the
 *   `roadBuilding` phase, and Intrigue's displaced knight retreats in the
 *   'retreat' step, as after a displacement.
 * - Crane, Merchant Fleet and Commercial Harbor last for the turn
 *   (`ck.turnEffects`); Commercial Harbor's offers are `progressChoice`
 *   actions in the main phase with `args.card: 'commercialHarbor'`.
 *
 * A card whose effect is known in advance to be nothing is not playable
 * (FAQ 98: Mining with no mountains, a Deserter with no opposing knights).
 */

type CardPhase = Extract<Phase, { kind: 'ck'; step: 'card' }>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The other players, in turn order after `p`. */
function opponents(s: GameState, p: PlayerId): PlayerId[] {
  const n = s.players.length;
  return Array.from({ length: n - 1 }, (_, i) => (p + 1 + i) % n);
}

function cardPhase(s: GameState): CardPhase | null {
  const ph = s.phase;
  return ph.kind === 'ck' && ph.step === 'card' ? ph : null;
}

/** Waits on a choice for `card`, resuming the current phase afterwards. */
function ask(
  s: GameState,
  card: ProgressCardName,
  player: PlayerId,
  stage: string,
  extra: { target?: PlayerId; pending?: Record<string, number>; data?: unknown } = {},
): void {
  s.phase = { kind: 'ck', step: 'card', card, player, stage, ...extra, resume: s.phase };
}

/** Ends the card's step (if one is open). */
function finish(s: GameState): void {
  const ph = cardPhase(s);
  if (ph) s.phase = ph.resume;
}

function hasEffect(s: GameState, p: PlayerId, effect: string) {
  return s.ck!.turnEffects.find((e) => e.player === p && e.effect === effect);
}

function playerArg(s: GameState, args: ProgressArgs, key = 'target'): PlayerId | null {
  const v = args?.[key];
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < s.players.length ? v : null;
}

function isVertex(s: GameState, v: unknown): v is VertexId {
  return typeof v === 'string' && Object.hasOwn(topo(s).vertexEdges, v);
}

function isEdge(s: GameState, e: unknown): e is EdgeId {
  return typeof e === 'string' && Object.hasOwn(topo(s).edgeVertices, e);
}

function isHex(s: GameState, h: unknown): h is HexId {
  return typeof h === 'string' && Object.hasOwn(s.board.hexes, h);
}

/** The only way to pick `n` cards from `hand`, if there is just one. */
function forcedPick(hand: Record<Card, number>, n: number): CardCounts | null {
  const kinds = CARDS.filter((k) => hand[k] > 0);
  const size = kinds.reduce((a, k) => a + hand[k], 0);
  if (n >= size) {
    const all: CardCounts = {};
    for (const k of kinds) all[k] = hand[k];
    return all;
  }
  return kinds.length === 1 ? { [kinds[0]]: n } : null;
}

/** `cards`: exactly `n` valid cards that `p` holds. */
function pickError(s: GameState, p: PlayerId, cards: unknown, n: number): string | null {
  if (!validCards(s, cards)) return 'choose cards';
  if (cardTotal(cards) !== n) return `choose exactly ${n} card${n === 1 ? '' : 's'}`;
  if (!hasCards(s, p, cards)) return 'those cards are not in the hand';
  return null;
}

// ---------------------------------------------------------------------------
// Science (green), Almanac pp. 14-15
// ---------------------------------------------------------------------------

/** Alchemist (2), p. 14: before rolling, set both production dice (a 7 too); the event die is rolled and resolved first. */
registerProgressEffect('alchemist', {
  options() {
    const out: ProgressArgs[] = [];
    for (let yellow = 1; yellow <= 6; yellow++) for (let red = 1; red <= 6; red++) out.push({ dice: [yellow, red] });
    return out;
  },
  play(s, p, args) {
    const d = args?.dice;
    if (!Array.isArray(d) || d.length !== 2 || !d.every((x) => Number.isInteger(x) && x >= 1 && x <= 6)) {
      return 'choose both production dice: [yellow, red], 1-6 each';
    }
    ckRollDice(s, p, [d[0] as number, d[1] as number]);
    return null;
  },
});

function canImprove(s: GameState, p: PlayerId): boolean {
  return TRACKS.some((t) => improvementError(s, p, t, true) === null);
}

/** Crane (2), p. 14: one city improvement this turn costs one commodity less (level 1 is free); never two Cranes on one improvement. */
registerProgressEffect('crane', {
  options(s, p) {
    return !hasEffect(s, p, 'crane') && canImprove(s, p) ? [undefined] : [];
  },
  play(s, p) {
    if (hasEffect(s, p, 'crane')) return 'a Crane already lowers your next improvement';
    if (!canImprove(s, p)) return 'you cannot build a city improvement';
    s.ck!.turnEffects.push({ player: p, effect: 'crane' });
    log(s, `${nameOf(s, p)}'s next city improvement this turn costs one commodity less`);
    return null;
  },
});

function wallSites(s: GameState, p: PlayerId): VertexId[] {
  const walls = s.ck!.players[p].walls;
  if (walls.length >= MAX_CITY_WALLS) return [];
  return Object.entries(s.board.buildings)
    .filter(([v, b]) => b.owner === p && b.type === 'city' && !walls.includes(v))
    .map(([v]) => v)
    .sort();
}

/** Engineer (1), p. 14: a city wall for free, under a city without one, at most 3. */
registerProgressEffect('engineer', {
  options(s, p) {
    return wallSites(s, p).map((vertex) => ({ vertex }));
  },
  play(s, p, args) {
    const v = args?.vertex;
    if (!isVertex(s, v) || !wallSites(s, p).includes(v)) {
      return s.ck!.players[p].walls.length >= MAX_CITY_WALLS
        ? `you may have at most ${MAX_CITY_WALLS} city walls`
        : 'choose one of your cities without a city wall';
    }
    s.ck!.players[p].walls.push(v);
    log(s, `${nameOf(s, p)} builds a city wall for free`);
    return null;
  },
});

/** Number tokens the Inventor never moves (p. 14). */
const FIXED_TOKENS = new Set([2, 12, 6, 8]);

function swappableHexes(s: GameState): HexId[] {
  return Object.keys(s.board.hexes)
    .filter((h) => {
      const t = s.board.hexes[h].token;
      return t !== null && !FIXED_TOKENS.has(t);
    })
    .sort();
}

/**
 * Inventor (2), p. 14: swap two number tokens, never a 2, 12, 6 or 8; no
 * building needed next to them; the robber's hex may be chosen and the robber
 * stays on its hex (FAQ 105, 107). Two equal numbers are not offered (no effect).
 */
registerProgressEffect('inventor', {
  options(s) {
    const hexes = swappableHexes(s);
    const out: ProgressArgs[] = [];
    for (let i = 0; i < hexes.length; i++) {
      for (let j = i + 1; j < hexes.length; j++) {
        if (s.board.hexes[hexes[i]].token !== s.board.hexes[hexes[j]].token) out.push({ hexes: [hexes[i], hexes[j]] });
      }
    }
    return out;
  },
  play(s, p, args) {
    const hs = args?.hexes;
    if (!Array.isArray(hs) || hs.length !== 2 || !hs.every((h) => isHex(s, h))) return 'choose two hexes';
    const [a, b] = hs as [HexId, HexId];
    const ta = s.board.hexes[a].token;
    const tb = s.board.hexes[b].token;
    if (ta === null || tb === null) return 'both hexes need a number token';
    if (FIXED_TOKENS.has(ta) || FIXED_TOKENS.has(tb)) return 'the 2, 12, 6 and 8 cannot be swapped';
    if (ta === tb) return 'choose two different numbers';
    s.board.hexes[a].token = tb;
    s.board.hexes[b].token = ta;
    log(s, `${nameOf(s, p)} swaps the ${ta} and the ${tb}`);
    return null;
  },
});

/** Hexes of a terrain next to at least one of the player's settlements or cities. */
function hexesBy(s: GameState, p: PlayerId, terrain: Terrain): HexId[] {
  const t = topo(s);
  return Object.keys(s.board.hexes).filter(
    (h) => s.board.hexes[h].terrain === terrain && (t.hexVertices[h] ?? []).some((v) => s.board.buildings[v]?.owner === p),
  );
}

/**
 * Irrigation and Mining (2 each), pp. 14-15: 2 grain (ore) per fields
 * (mountains) hex next to at least one of your buildings; cities do not
 * double it, and the robber does not stop it (it is not production). With
 * too few cards in the bank, as many as are left (2025 rulebook).
 */
function harvest(card: ProgressCardName, terrain: Terrain, r: Resource): void {
  const amount = (s: GameState, p: PlayerId) => Math.min(2 * hexesBy(s, p, terrain).length, s.bank[r]);
  registerProgressEffect(card, {
    options(s, p) {
      return amount(s, p) > 0 ? [undefined] : [];
    },
    play(s, p) {
      const n = amount(s, p);
      if (n === 0) return hexesBy(s, p, terrain).length === 0 ? `you have no building next to ${terrain}` : `the bank has no ${r}`;
      payFromBank(s, p, { [r]: n });
      log(s, `${nameOf(s, p)} takes ${n} ${r}`);
      return null;
    },
  });
}
harvest('irrigation', 'fields', 'grain');
harvest('mining', 'mountains', 'ore');

const MEDICINE_COST = { ore: 2, grain: 1 } as const;

/** Medicine (2), p. 14: upgrade a settlement to a city for 2 ore and 1 grain (one card per city). */
registerProgressEffect('medicine', {
  options(s, p) {
    return hasCards(s, p, MEDICINE_COST) ? legalCities(s, p).map((vertex) => ({ vertex })) : [];
  },
  play(s, p, args) {
    const v = args?.vertex;
    if (!isVertex(s, v) || !legalCities(s, p).includes(v)) return 'choose one of your settlements to upgrade';
    if (!hasCards(s, p, MEDICINE_COST)) return 'not enough resources: 2 ore and 1 grain';
    moveCards(s, p, 'bank', MEDICINE_COST);
    // as buildCity: a city pillaged onto its side is rebuilt with its own piece
    const tipped = isTipped(s, v);
    s.board.buildings[v] = { owner: p, type: 'city' };
    if (tipped) {
      untip(s, v);
    } else {
      s.players[p].supply.cities--;
      s.players[p].supply.settlements++;
    }
    s.turn.buildingStarted = true;
    log(s, `${nameOf(s, p)} upgrades to a city for 2 ore and 1 grain`);
    return null;
  },
});

/** Road Building (2), p. 15: 2 roads for free (with Seafarers, roads or ships), normal building rules. */
registerProgressEffect('roadBuilding', {
  options(s, p) {
    return legalEdgePlacements(s, p).length > 0 ? [undefined] : [];
  },
  play(s, p) {
    if (legalEdgePlacements(s, p).length === 0) return 'you have nowhere to build a road';
    s.phase = { kind: 'roadBuilding', remaining: 2, resume: s.phase };
    return null;
  },
});

function promotable(s: GameState, p: PlayerId): VertexId[] {
  return knightsOf(s, p)
    .map(([v]) => v)
    .filter((v) => promoteError(s, p, v) === null)
    .sort();
}

function freePromotion(s: GameState, p: PlayerId, v: VertexId): string | null {
  const err = promoteError(s, p, v);
  if (err) return err;
  const k = s.ck!.knights[v];
  k.level = (k.level + 1) as KnightLevel;
  k.promotedPart = s.turn.part;
  log(s, `${nameOf(s, p)} promotes a knight to a ${KNIGHT_NAMES[k.level]} for free`);
  return null;
}

/**
 * Smith (2), p. 15: promote up to 2 knights one level for free, active or
 * inactive, status kept; normal rules (once per knight per turn, mighty
 * needs the Fortress, the supply). Play with the first knight; stage
 * 'promote' asks for a second (no args: stop).
 */
registerProgressEffect('smith', {
  options(s, p) {
    return promotable(s, p).map((vertex) => ({ vertex }));
  },
  play(s, p, args) {
    const v = args?.vertex;
    if (!isVertex(s, v)) return 'choose a knight to promote';
    const err = freePromotion(s, p, v);
    if (err) return err;
    if (promotable(s, p).length > 0) ask(s, 'smith', p, 'promote');
    return null;
  },
  choices(s, p) {
    return [...promotable(s, p).map((vertex) => ({ vertex })), undefined];
  },
  respond(s, p, args) {
    const v = args?.vertex;
    if (v === undefined) {
      finish(s);
      return null;
    }
    if (!isVertex(s, v)) return 'choose a knight to promote';
    const err = freePromotion(s, p, v);
    if (err) return err;
    finish(s);
    return null;
  },
});

// ---------------------------------------------------------------------------
// Politics (blue), Almanac pp. 16-17
// ---------------------------------------------------------------------------

function bishopError(s: GameState, p: PlayerId): string | null {
  if (!robberActive(s)) return 'the robber stays put until the barbarians first attack';
  if (!legalRobberMoves(s, p).some((m) => m.piece === 'robber')) return 'the robber cannot move anywhere';
  return null;
}

/**
 * Bishop (2), p. 16: move the robber (normal rules; only once it is active,
 * p. 5, and never the pirate, FAQ 63) and draw one random resource or
 * commodity from every player with a building next to its new hex (one per
 * player, FAQ 74). The move is a `robber` phase with reason 'bishop'.
 */
registerProgressEffect('bishop', {
  options(s, p) {
    return bishopError(s, p) === null ? [undefined] : [];
  },
  play(s, p) {
    const err = bishopError(s, p);
    if (err) return err;
    s.phase = { kind: 'robber', reason: 'bishop', piece: 'robber', resume: s.phase };
    return null;
  },
});

/** The knight a Deserter's player may place for a removed knight of `level`: the same level, else a basic one (p. 16). */
function desertionLevel(s: GameState, p: PlayerId, level: KnightLevel): KnightLevel | null {
  if (knightsInSupply(s, p, level) > 0) return level;
  if (knightsInSupply(s, p, 1) > 0) return 1;
  return null;
}

function knightSites(s: GameState, p: PlayerId): VertexId[] {
  return topo(s).vertexIds.filter((v) => knightSiteError(s, p, v) === null);
}

/** The Deserter's target removes the knight at `v`; then its player may place one (stage 'place'). */
function desert(s: GameState, p: PlayerId, target: PlayerId, v: VertexId): void {
  const ck = s.ck!;
  const k = ck.knights[v];
  delete ck.knights[v];
  log(s, `${nameOf(s, target)} removes a ${KNIGHT_NAMES[k.level]}`);
  updateLongestRoute(s);
  finish(s);
  const level = desertionLevel(s, p, k.level);
  if (level === null || knightSites(s, p).length === 0) {
    log(s, level === null ? `${nameOf(s, p)} has no knight of that strength or basic knight left to place` : `${nameOf(s, p)} has nowhere to place a knight`);
    return;
  }
  ask(s, 'deserter', p, 'place', { target, data: { level, active: k.active } });
}

/**
 * Deserter (2), p. 16: an opponent removes a knight of their choice (stage
 * 'desert', answered by the target with `{ vertex }`); then you may place
 * one of yours of the same strength, or a basic one if you have none of
 * that strength left, with its status, following the placement rules (stage
 * 'place': `{ vertex }`, no args to decline). A mighty knight even without
 * the Fortress. It may act this turn if it came active (FAQ 83).
 */
registerProgressEffect('deserter', {
  options(s, p) {
    return opponents(s, p)
      .filter((q) => knightsOf(s, q).length > 0)
      .map((target) => ({ target }));
  },
  play(s, p, args) {
    const q = playerArg(s, args);
    if (q === null || q === p) return 'choose an opponent';
    const theirs = knightsOf(s, q);
    if (theirs.length === 0) return `${nameOf(s, q)} has no knights`;
    log(s, `${nameOf(s, q)} must remove a knight`);
    if (theirs.length === 1) desert(s, p, q, theirs[0][0]);
    else ask(s, 'deserter', p, 'desert', { target: q, pending: { [q]: 1 } });
    return null;
  },
  choices(s, p) {
    const ph = cardPhase(s)!;
    if (ph.stage === 'desert') return knightsOf(s, p).map(([vertex]) => ({ vertex }));
    return [...knightSites(s, p).map((vertex) => ({ vertex })), undefined];
  },
  respond(s, p, args) {
    const ph = cardPhase(s)!;
    const v = args?.vertex;
    if (ph.stage === 'desert') {
      if (!isVertex(s, v) || s.ck!.knights[v]?.owner !== p) return 'choose one of your knights';
      desert(s, ph.player, p, v);
      return null;
    }
    if (v === undefined) {
      finish(s);
      return null;
    }
    const { level, active } = ph.data as { level: KnightLevel; active: boolean };
    if (!isVertex(s, v)) return 'choose an intersection';
    const err = knightSiteError(s, p, v);
    if (err) return err;
    s.ck!.knights[v] = { owner: p, level, active, activatedPart: -1, promotedPart: -1 };
    log(s, `${nameOf(s, p)} places a ${KNIGHT_NAMES[level]}${active ? ', active' : ''}`);
    updateLongestRoute(s);
    finish(s);
    return null;
  },
});

/** A piece of `owner`'s colour at `v` other than the road `except`: a building, a knight, a road or ship. */
function attachedAt(s: GameState, owner: PlayerId, v: VertexId, except: EdgeId): boolean {
  if (s.board.buildings[v]?.owner === owner) return true;
  if (s.ck?.knights[v]?.owner === owner) return true;
  return topo(s).vertexEdges[v].some((e) => e !== except && s.board.pieces[e]?.owner === owner);
}

/**
 * Whether the Diplomat may remove the road (or ship) on `e`: it is "open"
 * when at one of its ends nothing of its colour is attached, no settlement,
 * city, knight, road or ship (p. 16, the German Almanac's wording; an
 * opponent's piece there does not close it, FAQ 89), and removing it leaves
 * no knight of its colour without a road (FAQ 90).
 */
export function openRoadError(s: GameState, e: EdgeId): string | null {
  const piece = s.board.pieces[e];
  if (!piece) return 'there is no road there';
  const ends = topo(s).edgeVertices[e];
  if (ends.every((v) => attachedAt(s, piece.owner, v, e))) return 'that road is not open';
  for (const v of ends) {
    const k = s.ck?.knights[v];
    if (k && k.owner === piece.owner && !topo(s).vertexEdges[v].some((o) => o !== e && s.board.pieces[o]?.owner === piece.owner)) {
      return 'removing that road would cut off a knight';
    }
  }
  return null;
}

function rebuildSpots(s: GameState, p: PlayerId, removed: EdgeId, kind: 'road' | 'ship'): EdgeId[] {
  return (kind === 'road' ? legalRoads(s, p) : legalShips(s, p)).filter((e) => e !== removed);
}

/**
 * Diplomat (2), p. 16: remove an open road (or ship). An opponent's goes
 * back to their supply; your own you may place again at once, elsewhere,
 * for free, following the building rules, as the same piece (stage
 * 'rebuild': `{ edge }`, no args to keep it in the supply; FAQ 64, 92).
 * Longest Road is settled once the road is back (FAQ 88).
 */
registerProgressEffect('diplomat', {
  options(s) {
    return Object.keys(s.board.pieces)
      .filter((e) => openRoadError(s, e) === null)
      .sort()
      .map((edge) => ({ edge }));
  },
  play(s, p, args) {
    const e = args?.edge;
    if (!isEdge(s, e)) return 'choose a road';
    const err = openRoadError(s, e);
    if (err) return err;
    const piece = s.board.pieces[e];
    delete s.board.pieces[e];
    if (piece.type === 'road') s.players[piece.owner].supply.roads++;
    else s.players[piece.owner].supply.ships++;
    const own = piece.owner === p;
    log(s, own ? `${nameOf(s, p)} takes up one of their ${piece.type}s` : `${nameOf(s, p)} removes a ${piece.type} of ${nameOf(s, piece.owner)}`);
    if (own && rebuildSpots(s, p, e, piece.type).length > 0) {
      ask(s, 'diplomat', p, 'rebuild', { data: { edge: e, kind: piece.type } });
    } else {
      updateLongestRoute(s);
    }
    return null;
  },
  choices(s, p) {
    const { edge, kind } = cardPhase(s)!.data as { edge: EdgeId; kind: 'road' | 'ship' };
    return [...rebuildSpots(s, p, edge, kind).map((e) => ({ edge: e })), undefined];
  },
  respond(s, p, args) {
    const { edge, kind } = cardPhase(s)!.data as { edge: EdgeId; kind: 'road' | 'ship' };
    const e = args?.edge;
    if (e !== undefined) {
      if (!isEdge(s, e) || !rebuildSpots(s, p, edge, kind).includes(e)) return `you cannot build a ${kind} there`;
      s.board.pieces[e] = { owner: p, type: kind, placedPart: s.turn.part };
      if (kind === 'road') s.players[p].supply.roads--;
      else s.players[p].supply.ships--;
      log(s, `${nameOf(s, p)} places the ${kind} again`);
    }
    updateLongestRoute(s);
    finish(s);
    return null;
  },
});

function intrigueTargets(s: GameState, p: PlayerId): VertexId[] {
  return Object.entries(s.ck!.knights)
    .filter(([v, k]) => k.owner !== p && onOwnRoute(s, p, v))
    .map(([v]) => v)
    .sort();
}

/**
 * Intrigue (2), p. 16: displace an opponent's knight (any strength) standing
 * on an intersection that one of your roads (or ships) touches, without a
 * knight of your own. Its owner moves it along their roads to an empty
 * intersection (the 'retreat' step), or it leaves the board. Nothing else:
 * the Almanac's garbled last sentence reads, in the official German Almanac,
 * "of course, a new knight may then be built where the knight was driven
 * off (by either player)", i.e. by the normal (paid) rules.
 */
registerProgressEffect('intrigue', {
  options(s, p) {
    return intrigueTargets(s, p).map((vertex) => ({ vertex }));
  },
  play(s, p, args) {
    const v = args?.vertex;
    if (!isVertex(s, v) || !intrigueTargets(s, p).includes(v)) return "choose an opponent's knight on an intersection touching your road";
    const ck = s.ck!;
    const k = ck.knights[v];
    delete ck.knights[v];
    log(s, `${nameOf(s, p)} drives off ${nameOf(s, k.owner)}'s ${KNIGHT_NAMES[k.level]}`);
    if (retreatSpots(s, k.owner, v).length === 0) {
      log(s, `${nameOf(s, k.owner)}'s knight has nowhere to go and leaves the board`);
    } else {
      s.phase = { kind: 'ck', step: 'retreat', player: k.owner, from: v, knight: k, resume: s.phase };
    }
    updateLongestRoute(s);
    return null;
  },
});

/**
 * Asks the players in `owed` for that many cards of their choice (stage
 * `stage`); a player with only one way to choose answers at once.
 */
function demandCards(
  s: GameState,
  card: ProgressCardName,
  p: PlayerId,
  stage: string,
  owed: Record<string, number>,
  pay: (s: GameState, from: PlayerId, cards: CardCounts) => void,
): void {
  const pending: Record<string, number> = {};
  for (const [q, n] of Object.entries(owed)) {
    const forced = forcedPick(handOf(s, Number(q)), n);
    if (forced) pay(s, Number(q), forced);
    else pending[q] = n;
  }
  if (Object.keys(pending).length > 0) ask(s, card, p, stage, { pending });
}

function answerCards(s: GameState, p: PlayerId, args: ProgressArgs, pay: (s: GameState, from: PlayerId, cards: CardCounts) => void): string | null {
  const ph = cardPhase(s)!;
  const n = ph.pending![p];
  const err = pickError(s, p, args?.cards, n);
  if (err) return err;
  pay(s, p, args!.cards as CardCounts);
  delete ph.pending![p];
  if (Object.keys(ph.pending!).length === 0) finish(s);
  return null;
}

function cardChoices(s: GameState, p: PlayerId): ProgressArgs[] {
  const n = cardPhase(s)!.pending![p];
  return cardCombinations(handOf(s, p), n).map((cards) => ({ cards }));
}

/** Every other player with at least your VP, with half their hand (rounded down) to discard (p. 17). */
function saboteurVictims(s: GameState, p: PlayerId): Record<string, number> {
  const out: Record<string, number> = {};
  for (const q of opponents(s, p)) {
    const n = Math.floor(handSize(s, q) / 2);
    if (publicVP(s, q) >= publicVP(s, p) && n > 0) out[q] = n;
  }
  return out;
}

const discardTo = (s: GameState, from: PlayerId, cards: CardCounts) => {
  moveCards(s, from, 'bank', cards);
  log(s, `${nameOf(s, from)} discards ${describeCounts(cards)}`);
};

/**
 * Saboteur (2), p. 17: every other player with as many VP as you or more
 * discards half their resource and commodity cards, rounded down, of their
 * choice (FAQ 110), to the bank (stage 'discard': `{ cards }`).
 */
registerProgressEffect('saboteur', {
  options(s, p) {
    return Object.keys(saboteurVictims(s, p)).length > 0 ? [undefined] : [];
  },
  play(s, p) {
    const owed = saboteurVictims(s, p);
    if (Object.keys(owed).length === 0) return 'nobody with at least your victory points has cards to discard';
    demandCards(s, 'saboteur', p, 'discard', owed, discardTo);
    return null;
  },
  choices: cardChoices,
  respond(s, p, args) {
    return answerCards(s, p, args, discardTo);
  },
});

/**
 * Spy (3), p. 17: look at another player's progress cards (stage 'take',
 * `data.cards` shown to you only) and take one if you like (`{ card }`; no
 * args: none). VP cards are never in a hand, so never taken; a Spy may be,
 * and played at once.
 */
registerProgressEffect('spy', {
  options(s, p) {
    return opponents(s, p)
      .filter((q) => s.ck!.players[q].progress.length > 0)
      .map((target) => ({ target }));
  },
  play(s, p, args) {
    const q = playerArg(s, args);
    if (q === null || q === p) return 'choose an opponent';
    if (s.ck!.players[q].progress.length === 0) return `${nameOf(s, q)} has no progress cards`;
    log(s, `${nameOf(s, p)} looks at ${nameOf(s, q)}'s progress cards`);
    ask(s, 'spy', p, 'take', { target: q, data: { cards: [...s.ck!.players[q].progress] } });
    return null;
  },
  choices(s) {
    const q = cardPhase(s)!.target!;
    return [...[...new Set(s.ck!.players[q].progress)].map((card) => ({ card })), undefined];
  },
  respond(s, p, args) {
    const q = cardPhase(s)!.target!;
    const card = args?.card;
    if (card !== undefined) {
      if (typeof card !== 'string' || !takeFromHand(s, q, card as ProgressCardName)) return `${nameOf(s, q)} does not have that card`;
      s.ck!.players[p].progress.push(card as ProgressCardName);
      log(s, `${nameOf(s, p)} takes a progress card from ${nameOf(s, q)}`);
      log(s, `(${nameOf(s, p)} took ${PROGRESS_CARDS[card as ProgressCardName].title})`, [p, q]);
    } else {
      log(s, `${nameOf(s, p)} takes nothing`);
    }
    finish(s);
    return null;
  },
});

/** Warlord (2), p. 17: activate all your knights for free; they still cannot act the turn they are activated. */
registerProgressEffect('warlord', {
  options(s, p) {
    return knightsOf(s, p).some(([, k]) => !k.active) ? [undefined] : [];
  },
  play(s, p) {
    const idle = knightsOf(s, p).filter(([, k]) => !k.active);
    if (idle.length === 0) return knightsOf(s, p).length === 0 ? 'you have no knights' : 'all your knights are active';
    for (const [, k] of idle) {
      k.active = true;
      k.activatedPart = s.turn.part;
    }
    log(s, `${nameOf(s, p)} activates ${idle.length} knight${idle.length === 1 ? '' : 's'} for free`);
    return null;
  },
});

/** Every player with more VP than you who holds cards: 2 of them (1 if that is all) (p. 17). */
function weddingGuests(s: GameState, p: PlayerId): Record<string, number> {
  const out: Record<string, number> = {};
  for (const q of opponents(s, p)) {
    const n = Math.min(2, handSize(s, q));
    if (publicVP(s, q) > publicVP(s, p) && n > 0) out[q] = n;
  }
  return out;
}

/**
 * Wedding (2), p. 17: every player with more VP than you gives you 2
 * resource or commodity cards of their choice, 1 if that is all they have
 * (stage 'give': `{ cards }`).
 */
registerProgressEffect('wedding', {
  options(s, p) {
    return Object.keys(weddingGuests(s, p)).length > 0 ? [undefined] : [];
  },
  play(s, p) {
    const owed = weddingGuests(s, p);
    if (Object.keys(owed).length === 0) return 'nobody with more victory points has cards to give';
    demandCards(s, 'wedding', p, 'give', owed, (st, from, cards) => gift(st, from, p, cards));
    return null;
  },
  choices: cardChoices,
  respond(s, p, args) {
    const to = cardPhase(s)!.player;
    return answerCards(s, p, args, (st, from, cards) => gift(st, from, to, cards));
  },
});

function gift(s: GameState, from: PlayerId, to: PlayerId, cards: CardCounts): void {
  moveCards(s, from, to, cards);
  const n = cardTotal(cards);
  log(s, `${nameOf(s, from)} gives ${nameOf(s, to)} ${n} card${n === 1 ? '' : 's'}`);
  log(s, `(${describeCounts(cards)})`, [from, to]);
}

// ---------------------------------------------------------------------------
// Trade (yellow), Almanac pp. 17-18
// ---------------------------------------------------------------------------

type HarborData = { offered: PlayerId[] };

function harborPartners(s: GameState, p: PlayerId): PlayerId[] {
  const eff = hasEffect(s, p, 'commercialHarbor');
  if (!eff) return [];
  const offered = (eff.data as HarborData).offered;
  return opponents(s, p).filter((q) => !offered.includes(q) && commodityCount(s, q) > 0);
}

function harborExchange(s: GameState, p: PlayerId, q: PlayerId, r: Resource, c: Commodity): void {
  moveCards(s, p, q, { [r]: 1 });
  moveCards(s, q, p, { [c]: 1 });
  log(s, `${nameOf(s, p)} trades a resource to ${nameOf(s, q)} for a commodity`);
  log(s, `(${nameOf(s, p)} gave 1 ${r} for 1 ${c})`, [p, q]);
}

/**
 * Commercial Harbor (2), p. 17: for the rest of the turn, offer each
 * opponent once one resource card from your hand (your choice, FAQ 78);
 * they must give you one commodity of their choice for it (FAQ 77). Offers
 * are `progressChoice { card: 'commercialHarbor', to, resource }` in the
 * main phase, made only to players holding a commodity (a player without
 * one would hand the resource back); the answer is stage 'exchange':
 * `{ commodity }`. Another Commercial Harbor starts a new round of offers.
 */
registerProgressEffect('commercialHarbor', {
  options(s, p) {
    return opponents(s, p).some((q) => commodityCount(s, q) > 0) ? [undefined] : [];
  },
  play(s, p) {
    if (!opponents(s, p).some((q) => commodityCount(s, q) > 0)) return 'no opponent has a commodity';
    const ck = s.ck!;
    ck.turnEffects = ck.turnEffects.filter((e) => !(e.player === p && e.effect === 'commercialHarbor'));
    ck.turnEffects.push({ player: p, effect: 'commercialHarbor', data: { offered: [] } satisfies HarborData });
    log(s, `${nameOf(s, p)} may offer each opponent a resource for a commodity this turn`);
    return null;
  },
  turnChoices(s, p) {
    const out: ProgressArgs[] = [];
    const have = s.players[p].resources;
    for (const to of harborPartners(s, p)) {
      for (const resource of RESOURCES) if (have[resource] > 0) out.push({ card: 'commercialHarbor', to, resource });
    }
    return out;
  },
  turnAct(s, p, args) {
    const eff = hasEffect(s, p, 'commercialHarbor');
    if (!eff) return 'play a Commercial Harbor first';
    const q = playerArg(s, args, 'to');
    if (q === null || q === p) return 'choose an opponent';
    if ((eff.data as HarborData).offered.includes(q)) return `you already made ${nameOf(s, q)} an offer this turn`;
    if (commodityCount(s, q) === 0) return `${nameOf(s, q)} has no commodities`;
    const r = args?.resource;
    if (!isResource(r)) return 'offer a resource card';
    if (s.players[p].resources[r] < 1) return `you have no ${r}`;
    (eff.data as HarborData).offered.push(q);
    const kinds = COMMODITIES.filter((c) => s.ck!.players[q].commodities[c] > 0);
    if (kinds.length === 1) harborExchange(s, p, q, r, kinds[0]);
    else ask(s, 'commercialHarbor', p, 'exchange', { target: q, pending: { [q]: 1 }, data: { resource: r } });
    return null;
  },
  choices(s, q) {
    return COMMODITIES.filter((c) => s.ck!.players[q].commodities[c] > 0).map((commodity) => ({ commodity }));
  },
  respond(s, q, args) {
    const ph = cardPhase(s)!;
    const c = args?.commodity;
    if (typeof c !== 'string' || !(COMMODITIES as readonly string[]).includes(c)) return 'give a commodity';
    if (s.ck!.players[q].commodities[c as Commodity] < 1) return `you have no ${c}`;
    harborExchange(s, ph.player, q, (ph.data as { resource: Resource }).resource, c as Commodity);
    finish(s);
    return null;
  },
});

function masterMerchantTargets(s: GameState, p: PlayerId): PlayerId[] {
  return opponents(s, p).filter((q) => publicVP(s, q) > publicVP(s, p) && handSize(s, q) > 0);
}

function take(s: GameState, p: PlayerId, q: PlayerId, cards: CardCounts): void {
  moveCards(s, q, p, cards);
  const n = cardTotal(cards);
  log(s, `${nameOf(s, p)} takes ${n} card${n === 1 ? '' : 's'} from ${nameOf(s, q)}`);
  log(s, `(${describeCounts(cards)})`, [p, q]);
}

/**
 * Master Merchant (2), p. 17: look at the hand of a player with more VP than
 * you (stage 'take', `data.hand` shown to you only) and take 2 resource or
 * commodity cards of your choice (`{ cards }`; 1 if they hold only one).
 */
registerProgressEffect('masterMerchant', {
  options(s, p) {
    return masterMerchantTargets(s, p).map((target) => ({ target }));
  },
  play(s, p, args) {
    const q = playerArg(s, args);
    if (q === null || !masterMerchantTargets(s, p).includes(q)) return 'choose a player with more victory points than you who holds cards';
    const n = Math.min(2, handSize(s, q));
    log(s, `${nameOf(s, p)} looks at ${nameOf(s, q)}'s hand`);
    const forced = forcedPick(handOf(s, q), n);
    if (forced) take(s, p, q, forced);
    else ask(s, 'masterMerchant', p, 'take', { target: q, data: { hand: handOf(s, q) } });
    return null;
  },
  choices(s) {
    const q = cardPhase(s)!.target!;
    return cardCombinations(handOf(s, q), Math.min(2, handSize(s, q))).map((cards) => ({ cards }));
  },
  respond(s, p, args) {
    const q = cardPhase(s)!.target!;
    const cards = args?.cards;
    const err = pickError(s, q, cards, Math.min(2, handSize(s, q)));
    if (err) return err;
    take(s, p, q, cards as CardCounts);
    finish(s);
    return null;
  },
});

function merchantHexes(s: GameState, p: PlayerId): HexId[] {
  const m = s.ck!.merchant;
  return Object.keys(s.board.hexes)
    .filter((h) => merchantHexError(s, p, h) === null && !(m && m.owner === p && m.hex === h))
    .sort();
}

/**
 * Merchant (6), pp. 17-18: put the merchant on a land hex next to your
 * settlement or city (not gold, 2025): you trade that hex's resource 2:1
 * and hold 1 VP while you control it; another Merchant card takes it over.
 * Where you already have it, it is not offered (no effect).
 */
registerProgressEffect('merchant', {
  options(s, p) {
    return merchantHexes(s, p).map((hex) => ({ hex }));
  },
  play(s, p, args) {
    const h = args?.hex;
    if (!isHex(s, h)) return 'choose a hex';
    if (s.ck!.merchant?.owner === p && s.ck!.merchant.hex === h) return 'the merchant is already yours there';
    return placeMerchant(s, p, h);
  },
});

function fleetKind(args: ProgressArgs): unknown {
  return args?.resource ?? args?.commodity;
}

/**
 * Merchant Fleet (2), p. 18: for the rest of the turn, trade one resource or
 * commodity of your choice 2:1 with the bank, any number of times
 * (`{ resource }` or `{ commodity }`; a card you already trade 2:1 is not
 * offered).
 */
registerProgressEffect('merchantFleet', {
  options(s, p) {
    const rates = cardRates(s, p);
    return CARDS.filter((k) => rates[k] > 2).map((k) => (isResource(k) ? { resource: k } : { commodity: k }));
  },
  play(s, p, args) {
    const k = fleetKind(args);
    if (!isCardOf(s, k)) return 'choose a resource or a commodity';
    if (cardRates(s, p)[k] <= 2) return `you already trade ${k} 2:1`;
    s.ck!.turnEffects.push({ player: p, effect: 'merchantFleet', data: k });
    log(s, `${nameOf(s, p)} trades ${k} 2:1 this turn`);
    return null;
  },
});

/** Resource Monopoly (4), p. 18: name a resource; each other player gives you 2 of it (1 if they have only 1). */
registerProgressEffect('resourceMonopoly', {
  options() {
    return RESOURCES.map((resource) => ({ resource }));
  },
  play(s, p, args) {
    const r = args?.resource;
    if (!isResource(r)) return 'name a resource';
    monopoly(s, p, r, 2);
    return null;
  },
});

/** Trade Monopoly (2), p. 18: name a commodity; each other player gives you 1 of it. */
registerProgressEffect('tradeMonopoly', {
  options() {
    return COMMODITIES.map((commodity) => ({ commodity }));
  },
  play(s, p, args) {
    const c = args?.commodity;
    if (typeof c !== 'string' || !(COMMODITIES as readonly string[]).includes(c)) return 'name a commodity';
    monopoly(s, p, c as Commodity, 1);
    return null;
  },
});

function monopoly(s: GameState, p: PlayerId, k: Card, most: number): void {
  let got = 0;
  for (const q of opponents(s, p)) {
    const n = Math.min(most, handOf(s, q)[k]);
    if (n === 0) continue;
    moveCards(s, q, p, { [k]: n });
    got += n;
    log(s, `${nameOf(s, q)} gives ${nameOf(s, p)} ${n} ${k}`);
  }
  if (got === 0) log(s, `Nobody has any ${k}`);
}
