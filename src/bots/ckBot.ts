import { cardRates, handOf } from '../ck/cards.js';
import { CK_COSTS, TRACK_COMMODITY, TRACKS } from '../ck/constants.js';
import { barbarianStrength, improvementError, improvementPrice, pillageableCities } from '../ck/engine.js';
import { activeStrength, knightsOf } from '../ck/knights.js';
import { CARDS, COMMODITIES, RESOURCES, TERRAIN_RESOURCE } from '../core/constants.js';
import { hasAtLeast } from '../core/resources.js';
import type { Action, Card, CardCounts, GameState, PlayerId, ProgressCardName } from '../core/types.js';
import { handSize, publicVP, topo } from '../rules/queries.js';

/**
 * A simple Cities & Knights fallback for the heuristic bot (smart play is
 * phase 3): it answers every C&K decision with a legal move, buys city
 * improvements whenever it can, keeps its knights up when the barbarians
 * draw near, walls its cities when its hand is large, chases the robber
 * off its own hexes, plays progress cards when they plainly help, and
 * otherwise plays the base-game strategy. It only uses what its seat may
 * see (what a Spy or Master Merchant shows it included).
 */

function byType<T extends Action['type']>(acts: Action[], type: T): Array<Extract<Action, { type: T }>> {
  return acts.filter((a): a is Extract<Action, { type: T }> => a.type === type);
}

/** Expected pips at an intersection (a rough value of a city). */
function pipsAt(s: GameState, v: string): number {
  let n = 0;
  for (const h of topo(s).vertexHexes[v]) {
    const t = s.board.hexes[h]?.token;
    if (t) n += 6 - Math.abs(7 - t);
  }
  return n;
}

/** Decisions in the expansion's own phases. */
export function ckPhaseAction(s: GameState, p: PlayerId, acts: Action[]): Action | null {
  const ph = s.phase;
  if (ph.kind !== 'ck' || acts.length === 0) return acts[0] ?? null;
  switch (ph.step) {
    case 'pillage': {
      // lose a city without a wall, and the poorest one
      const walls = s.ck!.players[p].walls;
      const options = byType(acts, 'pillageCity');
      options.sort((a, b) => Number(walls.includes(a.vertex)) - Number(walls.includes(b.vertex)) || pipsAt(s, a.vertex) - pipsAt(s, b.vertex));
      return options[0] ?? acts[0];
    }
    case 'defenderDraw': {
      const imp = s.ck!.players[p].improvements;
      const options = byType(acts, 'drawProgress');
      options.sort((a, b) => imp[b.deck] - imp[a.deck]);
      return options[0] ?? acts[0];
    }
    case 'aqueduct': {
      const have = s.players[p].resources;
      const options = byType(acts, 'aqueduct').filter((a) => a.resource !== undefined);
      options.sort((a, b) => have[a.resource!] - have[b.resource!]);
      return options[0] ?? acts[0];
    }
    case 'card':
      return cardAnswer(s, p, byType(acts, 'progressChoice')) ?? acts[0];
    default:
      return acts[0];
  }
}

// ---------------------------------------------------------------------------
// Progress cards
// ---------------------------------------------------------------------------

type Choice = Extract<Action, { type: 'progressChoice' }>;
type Play = Extract<Action, { type: 'playProgress' }>;

const arg = <T>(a: { args?: Record<string, unknown> }, k: string) => a.args?.[k] as T;

/** How much the player values a card kind in hand now (higher: keep it, want it). */
function cardValue(s: GameState, p: PlayerId, k: Card): number {
  const have = handOf(s, p)[k];
  if ((COMMODITIES as readonly string[]).includes(k)) {
    const track = TRACKS.find((t) => TRACK_COMMODITY[t] === k)!;
    return 2.5 + (s.ck!.players[p].improvements[track] > 0 ? 0.5 : 0) - have * 0.3;
  }
  return 2 - Math.min(have, 4) * 0.4;
}

/** The cards to give up: `n` from the biggest piles. */
function cheapest(s: GameState, p: PlayerId, n: number): CardCounts {
  const have = handOf(s, p);
  const out: CardCounts = {};
  for (let i = 0; i < n; i++) {
    let pick: Card | null = null;
    for (const k of CARDS) if (have[k] > 0 && (pick === null || have[k] > have[pick])) pick = k;
    if (pick === null) break;
    have[pick]--;
    out[pick] = (out[pick] ?? 0) + 1;
  }
  return out;
}

function sameCounts(a: CardCounts, b: CardCounts): boolean {
  return CARDS.every((k) => (a[k] ?? 0) === (b[k] ?? 0));
}

/** A rough value of keeping each progress card (the lowest is discarded first). */
const CARD_KEEP: Record<ProgressCardName, number> = {
  alchemist: 6, crane: 5, engineer: 4, inventor: 3, irrigation: 6, medicine: 6, mining: 6, printer: 0, roadBuilding: 5, smith: 4,
  bishop: 5, constitution: 0, deserter: 4, diplomat: 2, intrigue: 3, saboteur: 5, spy: 5, warlord: 4, wedding: 6,
  commercialHarbor: 4, masterMerchant: 6, merchant: 5, merchantFleet: 3, resourceMonopoly: 6, tradeMonopoly: 5,
};

/** Answers a progress card's choice ('card' step). */
function cardAnswer(s: GameState, p: PlayerId, choices: Choice[]): Choice | null {
  const ph = s.phase;
  if (ph.kind !== 'ck' || ph.step !== 'card' || choices.length === 0) return null;
  const skip = choices.find((c) => c.args === undefined) ?? null;
  const knights = s.ck!.knights;
  switch (ph.stage) {
    case 'promote': {
      const best = choices.filter((c) => c.args).sort((a, b) => knights[arg<string>(b, 'vertex')].level - knights[arg<string>(a, 'vertex')].level)[0];
      return best ?? skip;
    }
    case 'desert': {
      // give up the weakest knight, an inactive one first
      const score = (c: Choice) => {
        const k = knights[arg<string>(c, 'vertex')];
        return k.level * 2 + (k.active ? 1 : 0);
      };
      return [...choices].sort((a, b) => score(a) - score(b))[0];
    }
    case 'place':
      return choices.filter((c) => c.args).sort((a, b) => pipsAt(s, arg<string>(b, 'vertex')) - pipsAt(s, arg<string>(a, 'vertex')))[0] ?? skip;
    case 'rebuild':
      return choices.find((c) => c.args) ?? skip;
    case 'discard':
    case 'give': {
      const n = ph.pending?.[p] ?? 0;
      const want = cheapest(s, p, n);
      return choices.find((c) => sameCounts(arg<CardCounts>(c, 'cards'), want)) ?? choices[0];
    }
    case 'take': {
      if (ph.card === 'spy') {
        const best = choices.filter((c) => c.args).sort((a, b) => CARD_KEEP[arg<ProgressCardName>(b, 'card')] - CARD_KEEP[arg<ProgressCardName>(a, 'card')])[0];
        return best ?? skip;
      }
      const value = (c: Choice) => CARDS.reduce((n, k) => n + (arg<CardCounts>(c, 'cards')[k] ?? 0) * cardValue(s, p, k), 0);
      return [...choices].sort((a, b) => value(b) - value(a))[0];
    }
    case 'exchange': {
      const have = s.ck!.players[p].commodities;
      return [...choices].sort((a, b) => have[arg<'paper'>(b, 'commodity')] - have[arg<'paper'>(a, 'commodity')])[0];
    }
    default:
      return choices[0];
  }
}

/** Production pips of the player's buildings on a number (settlement 1, city 2 per hex). */
function rollValue(s: GameState, p: PlayerId, sum: number): number {
  let n = 0;
  for (const [id, hex] of Object.entries(s.board.hexes)) {
    if (hex.token !== sum || id === s.board.robber || !TERRAIN_RESOURCE[hex.terrain]) continue;
    for (const v of topo(s).hexVertices[id]) {
      const b = s.board.buildings[v];
      if (b?.owner === p) n += b.type === 'city' ? 2 : 1;
    }
  }
  return n;
}

/** Before rolling: the Alchemist on the number that pays the player best (never a 7), with the lowest red die. */
export function ckPreRollAction(s: GameState, p: PlayerId, acts: Action[]): Action | null {
  const alch = byType(acts, 'playProgress').filter((a) => a.card === 'alchemist');
  if (alch.length === 0) return null;
  let best: Play | null = null;
  let bestScore = 2;
  for (const a of alch) {
    const [yellow, red] = arg<[number, number]>(a, 'dice');
    if (yellow + red === 7) continue;
    const score = rollValue(s, p, yellow + red) - red * 0.01;
    if (score > bestScore) {
      best = a;
      bestScore = score;
    }
  }
  return best;
}

/** What swapping the number tokens of hexes `a` and `b` (the Inventor) gains the player, in pips (others' buildings count against). */
function swapGain(s: GameState, p: PlayerId, a: string, b: string): number {
  const weight = (h: string) => {
    let w = 0;
    for (const v of topo(s).hexVertices[h]) {
      const x = s.board.buildings[v];
      if (x) w += (x.owner === p ? 1 : -0.5) * (x.type === 'city' ? 2 : 1);
    }
    return w;
  };
  const pip = (h: string) => 6 - Math.abs(7 - (s.board.hexes[h].token ?? 7));
  return (pip(b) - pip(a)) * (weight(a) - weight(b));
}

/** A progress card worth playing now in the main phase, or a Commercial Harbor offer. */
function ckCardPlay(s: GameState, p: PlayerId, acts: Action[]): Action | null {
  // Commercial Harbor offers: the resource the player holds most of
  const offers = byType(acts, 'progressChoice');
  if (offers.length > 0) {
    const have = s.players[p].resources;
    return [...offers].sort((a, b) => have[arg<'ore'>(b, 'resource')] - have[arg<'ore'>(a, 'resource')])[0];
  }
  const plays = byType(acts, 'playProgress');
  if (plays.length === 0) return null;
  const of = (card: ProgressCardName) => plays.filter((a) => a.card === card);
  const ck = s.ck!;
  const first = (card: ProgressCardName) => of(card)[0] ?? null;
  const best = (card: ProgressCardName, score: (a: Play) => number, min = -Infinity): Play | null => {
    let out: Play | null = null;
    let top = min;
    for (const a of of(card)) {
      const v = score(a);
      if (v > top) {
        out = a;
        top = v;
      }
    }
    return out;
  };
  const target = (a: Play) => arg<number>(a, 'target');
  const res = s.players[p].resources;
  const rates = cardRates(s, p);
  const options: Array<Play | null> = [
    first('irrigation'),
    first('mining'),
    first('wedding'),
    first('roadBuilding'),
    best('medicine', (a) => pipsAt(s, arg<string>(a, 'vertex'))),
    best('engineer', (a) => pipsAt(s, arg<string>(a, 'vertex'))),
    best('masterMerchant', (a) => handSize(s, target(a)) + publicVP(s, target(a))),
    best('spy', (a) => ck.players[target(a)].progress.length),
    ck.merchant?.owner === p ? null : best('merchant', (a) => merchantValue(s, p, arg<string>(a, 'hex'))),
    first('saboteur'),
    first('bishop'),
    best('resourceMonopoly', (a) => -res[arg<'ore'>(a, 'resource')]),
    best('tradeMonopoly', (a) => -handOf(s, p)[arg<'paper'>(a, 'commodity')]),
    best('smith', (a) => ck.knights[arg<string>(a, 'vertex')].level),
    knightsOf(s, p).filter(([, k]) => !k.active).length >= 2 || ck.barbarians >= 4 ? first('warlord') : null,
    best('deserter', (a) => activeStrength(s, target(a)) + knightsOf(s, target(a)).length),
    best('intrigue', (a) => ck.knights[arg<string>(a, 'vertex')].level),
    best('diplomat', (a) => {
      const owner = s.board.pieces[arg<string>(a, 'edge')].owner;
      return owner === p ? -Infinity : publicVP(s, owner) + (s.longestRoute.holder === owner ? 5 : 0);
    }, -1e9),
    best('inventor', (a) => {
      const [x, y] = arg<[string, string]>(a, 'hexes');
      return swapGain(s, p, x, y);
    }, 0.5),
    TRACKS.some((t) => improvementError(s, p, t) !== null && improvementError(s, p, t, true) === null && cranePrice(s, p, t)) ? first('crane') : null,
    best('merchantFleet', (a) => {
      const k = (arg<Card>(a, 'resource') ?? arg<Card>(a, 'commodity'));
      return handOf(s, p)[k] >= 4 && rates[k] > 2 ? handOf(s, p)[k] : -Infinity;
    }, 0),
    first('commercialHarbor') && RESOURCES.some((r) => res[r] > 0) ? first('commercialHarbor') : null,
  ];
  return options.find((a) => a !== null) ?? null;
}

/** With a Crane, the next level of `track` would be affordable. */
function cranePrice(s: GameState, p: PlayerId, track: (typeof TRACKS)[number]): boolean {
  const price = improvementPrice(s, p, track);
  const k = TRACK_COMMODITY[track];
  return Math.max(0, (price[k] ?? 0) - 1) <= s.ck!.players[p].commodities[k];
}

/** The merchant's worth on a hex: its pips times the player's buildings there. */
function merchantValue(s: GameState, p: PlayerId, hex: string): number {
  const token = s.board.hexes[hex].token;
  const pips = token ? 6 - Math.abs(7 - token) : 0;
  let mine = 0;
  for (const v of topo(s).hexVertices[hex]) if (s.board.buildings[v]?.owner === p) mine += s.board.buildings[v].type === 'city' ? 2 : 1;
  return pips * mine;
}

/** Discarding on a 7 with commodities in hand: from the biggest piles. */
export function ckDiscardAction(s: GameState, p: PlayerId): Action | null {
  const ph = s.phase;
  if (ph.kind !== 'discard') return null;
  const need = ph.pending[p];
  if (need === undefined) return null;
  const have = handOf(s, p);
  const cards: CardCounts = {};
  for (let i = 0; i < need; i++) {
    let pick: Card | null = null;
    for (const k of CARDS) if (have[k] > 0 && (pick === null || have[k] > have[pick])) pick = k;
    if (pick === null) break;
    have[pick]--;
    cards[pick] = (cards[pick] ?? 0) + 1;
  }
  return { type: 'discard', player: p, cards };
}

/**
 * The expansion's moves worth making now in the main phase, or null to go
 * on with the base-game strategy.
 */
export function ckMainAction(s: GameState, p: PlayerId, acts: Action[]): Action | null {
  const ck = s.ck!;
  const card = ckCardPlay(s, p, acts);
  if (card) return card;
  // Over the progress card limit: put back the least useful card.
  const discards = byType(acts, 'discardProgress');
  if (discards.length > 0) return [...discards].sort((a, b) => CARD_KEEP[a.card] - CARD_KEEP[b.card])[0];
  // Chase the robber off its own hexes.
  const robber = s.board.robber;
  if (robber) {
    const mine = topo(s).hexVertices[robber].some((v) => s.board.buildings[v]?.owner === p);
    const chase = byType(acts, 'chaseRobber').find((a) => a.piece === 'robber');
    if (mine && chase) return chase;
  }
  // City improvements: commodities have little other use. Metropolis on the best city.
  const improve = byType(acts, 'improveCity');
  if (improve.length > 0) {
    const imp = ck.players[p].improvements;
    improve.sort((a, b) => imp[b.track] - imp[a.track] || (b.vertex ? pipsAt(s, b.vertex) : 0) - (a.vertex ? pipsAt(s, a.vertex) : 0));
    return improve[0];
  }
  // Defence: when the ship is near, keep at least the weakest share of the defence, and Catan safe.
  const cities = pillageableCities(s, p).length;
  const strength = s.players.map((pl) => activeStrength(s, pl.id));
  const defence = strength.reduce((a, b) => a + b, 0);
  const near = ck.barbarians >= 3;
  const weakest = strength[p] <= Math.min(...strength.filter((_, i) => i !== p));
  if (near && cities > 0 && (defence < barbarianStrength(s) || weakest)) {
    const activate = byType(acts, 'activateKnight')[0];
    if (activate) return activate;
    const build = byType(acts, 'buildKnight');
    if (build.length > 0) return build.sort((a, b) => pipsAt(s, b.vertex) - pipsAt(s, a.vertex))[0];
  }
  // A large hand: wall a city.
  const res = s.players[p].resources;
  const handSize = CARDS.reduce((n, k) => n + handOf(s, p)[k], 0);
  const wall = byType(acts, 'buildCityWall')[0];
  if (wall && handSize > 9 && hasAtLeast(res, { ...CK_COSTS.cityWall, brick: 3 })) return wall;
  return null;
}
