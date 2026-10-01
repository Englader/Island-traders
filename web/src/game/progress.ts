import {
  ABILITY_LEVEL,
  CARDS,
  KNIGHTS_PER_LEVEL,
  MAX_CITY_WALLS,
  MAX_IMPROVEMENT,
  PROGRESS_CARDS,
  TERRAIN_COMMODITY,
  TERRAIN_RESOURCE,
  cardRates,
  drawsOn,
  getTopologyFor,
  improvementCost,
  type Action,
  type Card,
  type CardCounts,
  type GameState,
  type GameView,
  type HexId,
  type ImprovementTrack,
  type KnightLevel,
  type PlayerId,
  type ProgressCardName,
  type Terrain,
  type VertexId,
} from 'engine';
import { KNIGHT_LABEL, TRACK_INFO, TRACK_LIST, improvementName, namesList, sevenLimitOf, spotLabel } from './ck';
import { CARD_INFO, TERRAIN_INFO, bankOfView, handOfView, progressTitle } from './names';

/*
 * Playing your own progress cards in the browser (Cities & Knights, part 4b):
 * which cards can be played and why not, what each card's choices are, what
 * the confirmation says, the Alchemist's preview of a roll, and the moves
 * that follow. The engine's `legalActions` is the source of truth: a card is
 * playable exactly when it lists a `playProgress` for it, with those `args`.
 * Plain data, so it can be tested without a browser.
 */

export type PlayAction = Extract<Action, { type: 'playProgress' }>;
export type ChoiceAction = Extract<Action, { type: 'progressChoice' }>;

/** Every legal way to play `card` now. */
export function playsOf(legal: Action[], card: ProgressCardName): PlayAction[] {
  return legal.filter((a): a is PlayAction => a.type === 'playProgress' && a.card === card);
}

/**
 * How a card's choices are made before it is played:
 * - `confirm`: nothing to choose, only the confirmation;
 * - `vertex`, `hex`, `edge`: a spot on the board (`smith`: one or two
 *   knights, `hexPair`: two number tokens);
 * - `player`: an opponent, in a sheet; `kind`: a resource or commodity;
 * - `dice`: the Alchemist's two production dice.
 * VP cards are never played by hand.
 */
export type PlayKind = 'confirm' | 'vertex' | 'smith' | 'hex' | 'hexPair' | 'edge' | 'player' | 'kind' | 'dice';

export const PLAY_KIND: Record<ProgressCardName, PlayKind | null> = {
  alchemist: 'dice',
  crane: 'confirm',
  engineer: 'vertex',
  inventor: 'hexPair',
  irrigation: 'confirm',
  medicine: 'vertex',
  mining: 'confirm',
  printer: null,
  roadBuilding: 'confirm',
  smith: 'smith',
  bishop: 'confirm',
  constitution: null,
  deserter: 'player',
  diplomat: 'edge',
  intrigue: 'vertex',
  saboteur: 'confirm',
  spy: 'player',
  warlord: 'confirm',
  wedding: 'confirm',
  commercialHarbor: 'confirm',
  masterMerchant: 'player',
  merchant: 'hex',
  merchantFleet: 'kind',
  resourceMonopoly: 'kind',
  tradeMonopoly: 'kind',
};

/** Board picks: what the bar over the board asks for. */
export const PICK_PROMPT: Partial<Record<ProgressCardName, string>> = {
  engineer: 'one of your cities for a free wall',
  medicine: 'the settlement to upgrade',
  smith: 'a knight to promote',
  intrigue: "the opponent's knight to drive off",
  merchant: 'a hex next to your buildings for the merchant',
  inventor: 'a number to swap',
  diplomat: 'an open road to remove',
};

/** The same in a few words, for the status line. */
export const PICK_STATUS: Partial<Record<ProgressCardName, string>> = {
  engineer: 'pick a city',
  medicine: 'pick a settlement',
  smith: 'pick knights',
  intrigue: 'pick a knight',
  merchant: 'pick a hex',
  inventor: 'pick two numbers',
  diplomat: 'pick a road',
};

/** A view is drawn from the state: the engine's pure helpers read it as one. */
const asState = (view: GameView) => view as unknown as GameState;

const nameOf = (view: GameView, p: PlayerId, seat: PlayerId | null) => (p === seat ? 'you' : view.players[p]?.name ?? `Player ${p + 1}`);

function opponents(view: GameView, p: PlayerId): PlayerId[] {
  const n = view.players.length;
  return Array.from({ length: n - 1 }, (_, i) => (p + 1 + i) % n);
}

const commodityCount = (view: GameView, p: PlayerId) => view.ck?.players[p]?.commodityCount ?? 0;

/** Hexes of a terrain next to one of the player's settlements or cities. */
function hexesNextTo(view: GameView, p: PlayerId, terrain: Terrain): HexId[] {
  const t = getTopologyFor(view.board.layoutKey);
  return Object.keys(view.board.hexes).filter((h) => view.board.hexes[h].terrain === terrain && (t.hexVertices[h] ?? []).some((v) => view.board.buildings[v]?.owner === p));
}

function knightsOf(view: GameView, p: PlayerId): Array<[VertexId, { level: KnightLevel; active: boolean }]> {
  return Object.entries(view.ck?.knights ?? {}).filter(([, k]) => k.owner === p) as Array<[VertexId, { level: KnightLevel; active: boolean }]>;
}

function citiesOf(view: GameView, p: PlayerId): VertexId[] {
  return Object.entries(view.board.buildings)
    .filter(([, b]) => b.owner === p && b.type === 'city')
    .map(([v]) => v);
}

function turnEffect(view: GameView, p: PlayerId, effect: string) {
  return view.ck?.turnEffects.find((e) => e.player === p && e.effect === effect);
}

/** A Crane played this turn lowers `p`'s next city improvement by one commodity. */
export function hasCrane(view: GameView, p: PlayerId): boolean {
  return !!turnEffect(view, p, 'crane');
}

/** What the next level of a track costs `p` now, the Crane's discount included. */
export function improvementPriceOf(view: GameView, p: PlayerId, level: number): number {
  return Math.max(0, improvementCost(level) - (hasCrane(view, p) ? 1 : 0));
}

/** Opponents with at least your points and cards to lose: what the Saboteur makes each discard. */
export function saboteurVictims(view: GameView, seat: PlayerId): Array<{ p: PlayerId; n: number }> {
  const mine = view.players[seat]?.publicVP ?? 0;
  return opponents(view, seat)
    .map((p) => ({ p, n: Math.floor((view.players[p]?.resourceCount ?? 0) / 2) }))
    .filter(({ p, n }) => (view.players[p]?.publicVP ?? 0) >= mine && n > 0);
}

/** Opponents with more points than you who hold cards: what a Wedding brings. */
export function weddingGuests(view: GameView, seat: PlayerId): Array<{ p: PlayerId; n: number }> {
  const mine = view.players[seat]?.publicVP ?? 0;
  return opponents(view, seat)
    .map((p) => ({ p, n: Math.min(2, view.players[p]?.resourceCount ?? 0) }))
    .filter(({ p, n }) => (view.players[p]?.publicVP ?? 0) > mine && n > 0);
}

/** Irrigation and Mining: how much they bring now (2 per fields or mountains hex next to your buildings, as the bank allows). */
export function harvestPreview(view: GameView, seat: PlayerId, card: 'irrigation' | 'mining'): { hexes: number; amount: number; resource: 'grain' | 'ore'; short: boolean } {
  const terrain: Terrain = card === 'irrigation' ? 'fields' : 'mountains';
  const resource = card === 'irrigation' ? 'grain' : 'ore';
  const hexes = hexesNextTo(view, seat, terrain).length;
  const amount = Math.min(2 * hexes, view.bank[resource]);
  return { hexes, amount, resource, short: amount < 2 * hexes };
}

/**
 * Why a card can't be played right now (null: it can). Timing first (whose
 * turn, before or after the roll, another decision under way), then what
 * the card needs (FAQ 98: a card with no effect is not playable).
 */
export function progressWhy(view: GameView, seat: PlayerId, card: ProgressCardName, legal: Action[]): string | null {
  if (playsOf(legal, card).length > 0) return null;
  const info = PROGRESS_CARDS[card];
  if (!info) return 'Unknown card';
  if (info.vp) return 'A victory point card counts at once';
  const ph = view.phase;
  if (ph.kind === 'gameOver') return 'The game is over';
  const mine = view.turn.actor === seat;
  if (info.beforeRoll) {
    if (!mine) return 'Play it on your own turn, before you roll';
    if (ph.kind !== 'preRoll') return 'Played before rolling: keep it for your next turn';
    return 'Not possible right now';
  }
  if (!mine) return 'Play it on your own turn, after the roll';
  if (ph.kind === 'preRoll') return 'Roll first: progress cards are played after the roll';
  if (ph.kind !== 'main') return 'Finish the current step first';
  const ck = view.ck!;
  const me = ck.players[seat];
  switch (card) {
    case 'crane': {
      if (turnEffect(view, seat, 'crane')) return 'A Crane already lowers your next improvement';
      if (citiesOf(view, seat).length === 0) return 'You need a city to build city improvements';
      return 'No city improvement you could build';
    }
    case 'engineer':
      if (me.walls.length >= MAX_CITY_WALLS) return `You have all ${MAX_CITY_WALLS} city walls`;
      return citiesOf(view, seat).length === 0 ? 'You have no city to wall' : 'Every one of your cities has a wall';
    case 'inventor':
      return 'No two different numbers to swap';
    case 'irrigation':
    case 'mining': {
      const h = harvestPreview(view, seat, card);
      if (h.hexes === 0) return `None of your buildings is next to ${card === 'irrigation' ? 'fields' : 'mountains'}`;
      return `The bank has no ${h.resource}`;
    }
    case 'medicine': {
      const hand = handOfView(view, seat);
      if ((hand.ore ?? 0) < 2 || (hand.grain ?? 0) < 1) return 'It costs 2 ore and 1 grain';
      return 'No settlement you could upgrade';
    }
    case 'roadBuilding':
      return 'Nowhere to build a road';
    case 'smith':
      return knightsOf(view, seat).length === 0 ? 'You have no knights' : 'None of your knights can be promoted now';
    case 'bishop':
      return ck.robberActive ? 'The robber cannot move anywhere' : 'The robber sleeps until the barbarians first attack';
    case 'deserter':
      return 'No opponent has a knight';
    case 'diplomat':
      return 'No open road on the board';
    case 'intrigue':
      return "No opponent's knight stands on your roads";
    case 'saboteur':
      return 'Nobody with at least your points has cards to discard';
    case 'spy':
      return 'Nobody else holds progress cards';
    case 'warlord':
      return knightsOf(view, seat).length === 0 ? 'You have no knights' : 'All your knights are active already';
    case 'wedding':
      return 'Nobody with more points has cards to give';
    case 'commercialHarbor':
      return 'No opponent holds a commodity';
    case 'masterMerchant':
      return 'Nobody with more points holds cards';
    case 'merchant':
      return ck.merchant?.owner === seat ? 'The merchant is yours already, and there is nowhere else for it' : 'No hex next to your buildings';
    case 'merchantFleet':
      return 'You trade every card 2:1 already';
    default:
      return 'Not possible right now';
  }
}

// --- the Alchemist -------------------------------------------------------------------------------

export interface RollPreview {
  total: number;
  /** What each player would receive (bank shortages applied, as the engine does). */
  gets: Array<{ p: PlayerId; cards: CardCounts }>;
  /** Kinds the bank couldn't pay out. */
  short: Card[];
  /** Players with the Aqueduct who would get nothing (and so pick a resource). */
  aqueduct: PlayerId[];
  /** A 7: who would discard how many, and whether the robber moves. */
  seven: boolean;
  discards: Array<{ p: PlayerId; n: number }>;
  robber: boolean;
  /** If the event die shows a city gate: who draws a card of its colour, with this red die. */
  draws: Record<ImprovementTrack, PlayerId[]>;
}

/** What a roll of `dice` ([white, red]) would do, before the event die (the Alchemist's preview). */
export function rollPreview(view: GameView, dice: [number, number]): RollPreview {
  const total = dice[0] + dice[1];
  const n = view.players.length;
  const order = Array.from({ length: n }, (_, i) => (view.turn.current + i) % n);
  const draws = {} as Record<ImprovementTrack, PlayerId[]>;
  for (const t of TRACK_LIST) draws[t] = order.filter((p) => drawsOn(view.ck?.players[p]?.improvements[t] ?? 0, dice[1]));
  if (total === 7) {
    const discards = order
      .map((p) => ({ p, hand: view.players[p]?.resourceCount ?? 0 }))
      .filter(({ p, hand }) => hand > sevenLimitOf(view, p))
      .map(({ p, hand }) => ({ p, n: Math.floor(hand / 2) }));
    return { total, gets: [], short: [], aqueduct: [], seven: true, discards, robber: !!view.ck?.robberActive, draws };
  }
  const t = getTopologyFor(view.board.layoutKey);
  const demand = new Map<Card, Map<PlayerId, number>>();
  const add = (k: Card, p: PlayerId, x: number) => {
    const m = demand.get(k) ?? new Map<PlayerId, number>();
    m.set(p, (m.get(p) ?? 0) + x);
    demand.set(k, m);
  };
  for (const [id, hex] of Object.entries(view.board.hexes)) {
    if (hex.token !== total || id === view.board.robber) continue;
    const res = TERRAIN_RESOURCE[hex.terrain];
    if (!res) continue;
    const com = TERRAIN_COMMODITY[hex.terrain];
    for (const v of t.hexVertices[id] ?? []) {
      const b = view.board.buildings[v];
      if (!b) continue;
      if (b.type !== 'city') add(res, b.owner, 1);
      else if (com) {
        add(res, b.owner, 1);
        add(com, b.owner, 1);
      } else add(res, b.owner, 2);
    }
  }
  const bank = bankOfView(view);
  const got = new Map<PlayerId, CardCounts>();
  const short: Card[] = [];
  for (const k of CARDS) {
    const owed = demand.get(k);
    if (!owed) continue;
    const need = [...owed.values()].reduce((a, b) => a + b, 0);
    const have = bank[k] ?? 0;
    if (need > have) {
      short.push(k);
      if (owed.size > 1) continue;
      const [[p, x]] = [...owed.entries()];
      if (have > 0) got.set(p, { ...(got.get(p) ?? {}), [k]: Math.min(x, have) });
      continue;
    }
    for (const [p, x] of owed) got.set(p, { ...(got.get(p) ?? {}), [k]: x });
  }
  const gets = order.filter((p) => got.has(p)).map((p) => ({ p, cards: got.get(p)! }));
  const aqueduct = order.filter((p) => !got.has(p) && (view.ck?.players[p]?.improvements.science ?? 0) >= ABILITY_LEVEL);
  return { total, gets, short, aqueduct, seven: false, discards: [], robber: false, draws };
}

/** "2 brick, 1 paper" */
export function cardsText(c: CardCounts): string {
  const parts = CARDS.filter((k) => (c[k] ?? 0) > 0).map((k) => `${c[k]} ${CARD_INFO[k].label.toLowerCase()}`);
  return parts.length > 0 ? listText(parts) : 'nothing';
}

function listText(parts: string[]): string {
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** The preview as lines: production (yours first), shortages, the 7, and the progress cards the red die would draw. */
export function rollPreviewLines(view: GameView, seat: PlayerId, pv: RollPreview): { produce: string[]; draws: string[] } {
  const produce: string[] = [];
  if (pv.seven) {
    produce.push('A 7: nobody produces');
    for (const d of pv.discards) produce.push(`${cap(nameOf(view, d.p, seat))} ${d.p === seat ? 'discard' : 'discards'} ${d.n} card${d.n === 1 ? '' : 's'}`);
    produce.push(pv.robber ? 'You move the robber and steal a card' : 'The robber sleeps until the barbarians first attack');
  } else {
    const mine = pv.gets.find((g) => g.p === seat);
    produce.push(mine ? `You get ${cardsText(mine.cards)}` : 'You get nothing');
    for (const g of pv.gets) if (g.p !== seat) produce.push(`${view.players[g.p]?.name} gets ${cardsText(g.cards)}`);
    for (const p of pv.aqueduct) produce.push(`${cap(nameOf(view, p, seat))} ${p === seat ? 'take' : 'takes'} a resource (Aqueduct)`);
    if (pv.short.length > 0) produce.push(`The bank is short of ${listText(pv.short.map((k) => CARD_INFO[k].label.toLowerCase()))}`);
  }
  const draws = TRACK_LIST.map((t) => {
    const who = pv.draws[t];
    const gate = `${cap(TRACK_INFO[t].colorName)} gate`;
    return who.length === 0 ? `${gate}: nobody draws` : `${gate}: ${namesList(view, who, seat, false)} ${who.length === 1 && who[0] !== seat ? 'draws' : 'draw'} a ${t} card`;
  });
  return { produce, draws };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// --- picks on the board ------------------------------------------------------------------------------

/** The Inventor: hexes that take part in some legal swap. */
export function inventorHexes(plays: PlayAction[]): HexId[] {
  const out = new Set<HexId>();
  for (const a of plays) for (const h of (a.args?.hexes as HexId[] | undefined) ?? []) out.add(h);
  return [...out];
}

/** The Inventor: the swaps that include `first`, by the other hex. */
export function inventorPartners(plays: PlayAction[], first: HexId): Map<HexId, PlayAction> {
  const out = new Map<HexId, PlayAction>();
  for (const a of plays) {
    const hs = a.args?.hexes as HexId[] | undefined;
    if (!hs || !hs.includes(first)) continue;
    const other = hs[0] === first ? hs[1] : hs[0];
    out.set(other, a);
  }
  return out;
}

/**
 * The Smith: the knights that can still be promoted once `first` is (the
 * engine asks for the second after the first): every other knight it offers,
 * as long as a piece of the next strength is left in the supply.
 */
export function smithSeconds(view: GameView, seat: PlayerId, plays: PlayAction[], first: VertexId): VertexId[] {
  const k = view.ck?.knights[first];
  if (!k) return [];
  const onBoard: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
  for (const [, x] of knightsOf(view, seat)) onBoard[x.level]++;
  onBoard[k.level]--;
  onBoard[k.level + 1]++;
  return plays
    .map((a) => a.args?.vertex as VertexId)
    .filter((v) => {
      if (!v || v === first) return false;
      const level = view.ck?.knights[v]?.level;
      return level !== undefined && level < 3 && onBoard[level + 1] < KNIGHTS_PER_LEVEL;
    });
}

/** The dots under a number: how many of the 36 rolls bring it. */
const dots = (n: number | null) => (n === null ? 0 : 6 - Math.abs(7 - n));

/** How the Inventor's swap changes the dots on `p`'s buildings (a city counts twice). */
export function swapDots(view: GameView, p: PlayerId, h1: HexId, h2: HexId): number {
  const t = getTopologyFor(view.board.layoutKey);
  const weight = (h: HexId) =>
    (t.hexVertices[h] ?? []).reduce((n, v) => {
      const b = view.board.buildings[v];
      return n + (b?.owner === p ? (b.type === 'city' ? 2 : 1) : 0);
    }, 0);
  const a = dots(view.board.hexes[h1]?.token ?? null);
  const b = dots(view.board.hexes[h2]?.token ?? null);
  return weight(h1) * (b - a) + weight(h2) * (a - b);
}

// --- the confirmation ----------------------------------------------------------------------------

export interface PlayAsk {
  title: string;
  notes: string[];
  /** What it costs (Medicine). */
  cost: CardCounts | null;
  label: string;
}

const terrainWord = (t: Terrain) => TERRAIN_INFO[t]?.label.toLowerCase() ?? t;

/**
 * What the confirmation dialog says about playing `a` (with `second`, the
 * Smith's second knight).
 */
export function playAsk(view: GameView, seat: PlayerId, a: PlayAction, second?: VertexId): PlayAsk {
  const args = a.args ?? {};
  const title = progressTitle(a.card);
  const name = (p: PlayerId) => view.players[p]?.name ?? `Player ${p + 1}`;
  const notes: string[] = [];
  const play = (t = `Play the ${title}?`, label = 'Yes, play') => ({ title: t, notes, cost: null, label });
  const ck = view.ck!;
  switch (a.card) {
    case 'alchemist': {
      const dice = args.dice as [number, number];
      const pv = rollPreview(view, dice);
      const lines = rollPreviewLines(view, seat, pv);
      notes.push(`${dice[0]} + ${dice[1]} = ${pv.total}`, ...lines.produce.slice(0, 3));
      notes.push('Then the event die is rolled');
      return play(`Set the dice to ${dice[0]} and ${dice[1]}?`);
    }
    case 'crane': {
      notes.push('Your next city improvement this turn costs one commodity less');
      for (const t of TRACK_LIST) {
        const level = (ck.players[seat]?.improvements[t] ?? 0) + 1;
        if (level > MAX_IMPROVEMENT) continue;
        const full = improvementCost(level);
        notes.push(`${improvementName(t, level)}: ${Math.max(0, full - 1)} ${TRACK_INFO[t].commodity} instead of ${full}`);
      }
      return play();
    }
    case 'engineer': {
      const limit = sevenLimitOf(view, seat);
      notes.push(`Your hand limit on a 7 goes from ${limit} to ${limit + 2} cards`);
      if ((ck.players[seat]?.walls.length ?? 0) === MAX_CITY_WALLS - 1) notes.push('This is your last city wall');
      return play('Build a free city wall here?', 'Yes, build');
    }
    case 'inventor': {
      const [h1, h2] = args.hexes as [HexId, HexId];
      const x = view.board.hexes[h1];
      const y = view.board.hexes[h2];
      notes.push(`The ${terrainWord(x.terrain)} ${x.token} becomes a ${y.token}, the ${terrainWord(y.terrain)} ${y.token} a ${x.token}`);
      const gain = swapDots(view, seat, h1, h2);
      notes.push(gain === 0 ? 'No change for your buildings' : `Your buildings ${gain > 0 ? 'gain' : 'lose'} ${Math.abs(gain)} dot${Math.abs(gain) === 1 ? '' : 's'} of production`);
      if (view.board.robber === h1 || view.board.robber === h2) notes.push('The robber stays where it is');
      return play(`Swap the ${x.token} and the ${y.token}?`, 'Yes, swap');
    }
    case 'irrigation':
    case 'mining': {
      const h = harvestPreview(view, seat, a.card);
      notes.push(`2 for each of your ${h.hexes} ${a.card === 'irrigation' ? 'fields' : 'mountains'} hex${h.hexes === 1 ? '' : 'es'}`);
      if (h.short) notes.push(`The bank has only ${h.amount}`);
      return play(`Take ${h.amount} ${h.resource}?`, 'Yes, take');
    }
    case 'medicine': {
      notes.push('+1 victory point (a city is worth 2)');
      notes.push('2 cards instead of 1 from each tile around it');
      return { title: 'Upgrade this settlement to a city?', notes, cost: { ore: 2, grain: 1 }, label: 'Yes, upgrade' };
    }
    case 'roadBuilding':
      notes.push('Place 2 roads for free, one after the other');
      return play();
    case 'smith': {
      const vs = [args.vertex as VertexId, ...(second ? [second] : [])];
      for (const v of vs) {
        const k = ck.knights[v];
        if (!k) continue;
        notes.push(`${KNIGHT_LABEL[k.level]} → ${KNIGHT_LABEL[(k.level + 1) as KnightLevel].toLowerCase()} (${k.active ? 'stays active' : 'stays inactive'})`);
      }
      return play(vs.length === 2 ? 'Promote these 2 knights for free?' : 'Promote this knight for free?', 'Yes, promote');
    }
    case 'bishop':
      notes.push('Move the robber, then take a random card from every player next to its new hex');
      return play();
    case 'deserter': {
      const q = args.target as PlayerId;
      const n = knightsOf(view, q).length;
      notes.push(n === 1 ? `${name(q)} has one knight: it leaves the board` : `${name(q)} removes one of their ${n} knights`);
      notes.push('Then you may place one of yours of the same strength');
      return play(`Play the Deserter on ${name(q)}?`);
    }
    case 'diplomat': {
      const piece = view.board.pieces[args.edge as string];
      if (piece && piece.owner === seat) {
        notes.push('You may place it again somewhere else at once, for free');
        return play('Take up your road?', 'Yes, take it up');
      }
      if (piece) notes.push(`It goes back to ${name(piece.owner)}'s supply`);
      if (piece && view.longestRoute.holder === piece.owner) notes.push(`${name(piece.owner)} holds the longest road: it may change hands`);
      return play(piece ? `Remove ${name(piece.owner)}'s road?` : 'Remove this road?', 'Yes, remove');
    }
    case 'intrigue': {
      const k = ck.knights[args.vertex as VertexId];
      if (k) notes.push(`${name(k.owner)} moves it along their roads, or it leaves the board`);
      notes.push('No knight of yours is needed');
      return play(k ? `Drive off ${name(k.owner)}'s ${KNIGHT_LABEL[k.level].toLowerCase()}?` : 'Drive off this knight?', 'Yes, drive it off');
    }
    case 'saboteur':
      for (const v of saboteurVictims(view, seat)) notes.push(`${name(v.p)} discards ${v.n} card${v.n === 1 ? '' : 's'} of their choice`);
      return play();
    case 'spy': {
      const q = args.target as PlayerId;
      const n = ck.players[q]?.progressCount ?? 0;
      notes.push(`${name(q)} holds ${n} progress card${n === 1 ? '' : 's'}: you see them and may take one`);
      notes.push('Only you see them');
      return play(`Spy on ${name(q)}?`, 'Yes, spy');
    }
    case 'warlord': {
      const idle = knightsOf(view, seat).filter(([, k]) => !k.active).length;
      notes.push(idle === 1 ? '1 knight becomes active: it defends Catan' : `${idle} knights become active: they defend Catan`);
      notes.push('They can act from your next turn');
      return play();
    }
    case 'wedding':
      for (const g of weddingGuests(view, seat)) notes.push(`${name(g.p)} gives you ${g.n} card${g.n === 1 ? '' : 's'} of their choice`);
      return play();
    case 'commercialHarbor': {
      notes.push('This turn, offer each opponent one of your resources: they must give you a commodity of their choice for it');
      const with_ = opponents(view, seat).filter((p) => commodityCount(view, p) > 0);
      notes.push(`${listText(with_.map((p) => `${name(p)} (${commodityCount(view, p)})`))} ${with_.length === 1 ? 'holds' : 'hold'} commodities`);
      return play();
    }
    case 'masterMerchant': {
      const q = args.target as PlayerId;
      const n = view.players[q]?.resourceCount ?? 0;
      notes.push(`You see ${name(q)}'s ${n} card${n === 1 ? '' : 's'} and take ${Math.min(2, n)} of your choice`);
      notes.push('Only you see them');
      return play(`Take ${Math.min(2, n)} card${n === 1 ? '' : 's'} from ${name(q)}?`, 'Yes, play');
    }
    case 'merchant': {
      const hex = view.board.hexes[args.hex as HexId];
      const res = hex ? TERRAIN_RESOURCE[hex.terrain] : undefined;
      notes.push(res ? `You trade ${res} 2:1 with the bank while you hold it` : 'No resource here: no 2:1 trade, but the point');
      notes.push('+1 victory point while you hold it');
      if (ck.merchant && ck.merchant.owner !== seat) notes.push(`You take it from ${name(ck.merchant.owner)}`);
      return play('Place the merchant here?', 'Yes, place');
    }
    case 'merchantFleet': {
      const k = (args.resource ?? args.commodity) as Card;
      const rate = cardRates(asState(view), seat)[k];
      notes.push(`Now ${rate}:1; any number of times this turn`);
      return play(`Trade ${CARD_INFO[k].label.toLowerCase()} 2:1 this turn?`);
    }
    case 'resourceMonopoly': {
      const r = args.resource as Card;
      notes.push('Every other player gives you 2 of it (1 if they have only 1)');
      return play(`Name ${CARD_INFO[r].label.toLowerCase()}?`, 'Yes, name it');
    }
    case 'tradeMonopoly': {
      const c = args.commodity as Card;
      notes.push('Every other player gives you 1 of it');
      return play(`Name ${CARD_INFO[c].label.toLowerCase()}?`, 'Yes, name it');
    }
    default:
      return play();
  }
}

// --- who can be picked -----------------------------------------------------------------------------

export interface PlayerPick {
  p: PlayerId;
  action: PlayAction;
  /** What the sheet shows about them: knights, progress cards, cards in hand. */
  detail: string;
}

/** The Deserter, the Spy and the Master Merchant: the players the engine offers, with what matters for each. */
export function playerPicks(view: GameView, plays: PlayAction[]): PlayerPick[] {
  return plays
    .filter((a) => typeof a.args?.target === 'number')
    .map((a) => {
      const p = a.args!.target as PlayerId;
      let detail = '';
      if (a.card === 'deserter') {
        const ks = knightsOf(view, p);
        detail = `${ks.length} knight${ks.length === 1 ? '' : 's'}: ${ks.map(([, k]) => KNIGHT_LABEL[k.level].split(' ')[0].toLowerCase()).join(', ')}`;
      } else if (a.card === 'spy') {
        const n = view.ck?.players[p]?.progressCount ?? 0;
        detail = `${n} progress card${n === 1 ? '' : 's'}`;
      } else {
        const n = view.players[p]?.resourceCount ?? 0;
        detail = `${view.players[p]?.publicVP ?? 0} VP · ${n} card${n === 1 ? '' : 's'}`;
      }
      return { p, action: a, detail };
    });
}

/** Merchant Fleet and the Monopolies: the kinds offered, with your trade rate for each. */
export function kindPicks(view: GameView, seat: PlayerId, plays: PlayAction[]): Array<{ k: Card; action: PlayAction; rate: number }> {
  const rates = cardRates(asState(view), seat);
  return plays
    .map((a) => ({ k: (a.args?.resource ?? a.args?.commodity) as Card, action: a }))
    .filter((x) => !!x.k)
    .map((x) => ({ ...x, rate: rates[x.k] }));
}

// --- after the card: the steps that follow, the lasting effects -------------------------------------

/** Commercial Harbor: offers still open this turn, per opponent (the resources you could offer each). */
export function harborOffers(legal: Action[]): Map<PlayerId, ChoiceAction[]> {
  const out = new Map<PlayerId, ChoiceAction[]>();
  for (const a of legal) {
    if (a.type !== 'progressChoice' || a.args?.card !== 'commercialHarbor') continue;
    const to = a.args.to as PlayerId;
    out.set(to, [...(out.get(to) ?? []), a]);
  }
  return out;
}

export interface TurnChip {
  key: string;
  card: ProgressCardName;
  label: string;
  detail: string;
  /** The player whose turn it is holds it. */
  player: PlayerId;
}

/** The public effects of cards played this turn (ck.turnEffects, and the Warlord), as chips by the action panel. */
export function turnChips(view: GameView): TurnChip[] {
  const ck = view.ck;
  if (!ck || view.phase.kind === 'gameOver') return [];
  const out: TurnChip[] = [];
  const p = view.turn.actor;
  for (const e of ck.turnEffects) {
    if (e.player !== p) continue;
    if (e.effect === 'crane') out.push({ key: 'crane', card: 'crane', label: 'Crane', detail: 'next improvement −1', player: p });
    else if (e.effect === 'merchantFleet' && typeof e.data === 'string')
      out.push({ key: `fleet-${e.data}`, card: 'merchantFleet', label: 'Merchant Fleet', detail: `${CARD_INFO[e.data as Card]?.label.toLowerCase() ?? e.data} 2:1`, player: p });
    else if (e.effect === 'commercialHarbor') {
      const offered = ((e.data as { offered?: PlayerId[] } | undefined)?.offered ?? []).length;
      const open = opponents(view, p).filter((q) => commodityCount(view, q) > 0 && !((e.data as { offered?: PlayerId[] }).offered ?? []).includes(q)).length;
      out.push({
        key: 'harbor',
        card: 'commercialHarbor',
        label: 'Commercial Harbor',
        detail: open > 0 ? `${open} offer${open === 1 ? '' : 's'} open` : offered > 0 ? 'offers made' : 'no offers left',
        player: p,
      });
    }
  }
  const played = (ck.played ?? []).filter((x) => x.turn === view.turn.number && x.player === p);
  if (played.some((x) => x.card === 'warlord')) out.push({ key: 'warlord', card: 'warlord', label: 'Warlord', detail: 'knights activated', player: p });
  return out;
}

/** What a played card did, for the moment shown to everyone ("Ada plays Spy on you"): its target and a line about it. */
export function playedFx(a: PlayAction, before: GameView, seat: PlayerId | null = null): { target?: PlayerId; detail: string } {
  const args = a.args ?? {};
  const name = (p: PlayerId) => (p === seat ? 'you' : before.players[p]?.name ?? `Player ${p + 1}`);
  const whose = (p: PlayerId) => (p === seat ? 'your' : `${name(p)}'s`);
  switch (a.card) {
    case 'alchemist': {
      const d = args.dice as [number, number] | undefined;
      return { detail: d ? `Sets the dice to ${d[0]} and ${d[1]}: ${d[0] + d[1]}` : 'Sets both production dice' };
    }
    case 'deserter':
    case 'spy':
    case 'masterMerchant':
      return {
        target: args.target as PlayerId,
        detail:
          a.card === 'spy'
            ? `Looks at ${whose(args.target as PlayerId)} progress cards and may take one`
            : a.card === 'deserter'
              ? `${cap(name(args.target as PlayerId))} ${args.target === seat ? 'remove' : 'removes'} a knight`
              : `Takes 2 cards from ${name(args.target as PlayerId)}`,
      };
    case 'intrigue': {
      const k = before.ck?.knights[args.vertex as VertexId];
      return { target: k?.owner, detail: k ? `Drives off ${whose(k.owner)} ${KNIGHT_LABEL[k.level].toLowerCase()}` : 'Drives off a knight' };
    }
    case 'diplomat': {
      const piece = before.board.pieces[args.edge as string];
      if (piece && piece.owner !== a.player) return { target: piece.owner, detail: `Removes ${piece.owner === seat ? 'one of your roads' : `a road of ${name(piece.owner)}`}` };
      return { detail: 'Takes up one of their own roads' };
    }
    case 'inventor': {
      const hs = (args.hexes as HexId[] | undefined) ?? [];
      const nums = hs.map((h) => before.board.hexes[h]?.token);
      return { detail: nums.length === 2 ? `Swaps the ${nums[0]} and the ${nums[1]}` : 'Swaps two numbers' };
    }
    case 'merchant': {
      const hex = before.board.hexes[args.hex as HexId];
      const res = hex ? TERRAIN_RESOURCE[hex.terrain] : undefined;
      return { detail: res ? `Places the merchant: ${res} 2:1, and 1 VP` : 'Places the merchant: 1 VP' };
    }
    case 'merchantFleet': {
      const k = (args.resource ?? args.commodity) as Card;
      return { detail: `Trades ${CARD_INFO[k]?.label.toLowerCase() ?? k} 2:1 this turn` };
    }
    case 'resourceMonopoly':
      return { detail: `Everyone gives 2 ${CARD_INFO[args.resource as Card]?.label.toLowerCase() ?? ''}`.trim() };
    case 'tradeMonopoly':
      return { detail: `Everyone gives 1 ${CARD_INFO[args.commodity as Card]?.label.toLowerCase() ?? ''}`.trim() };
    case 'engineer':
      return { detail: `A free city wall at ${spotLabel(before, args.vertex as string)}` };
    case 'medicine':
      return { detail: 'Upgrades a settlement to a city for 2 ore and 1 grain' };
    default:
      return { detail: '' };
  }
}
