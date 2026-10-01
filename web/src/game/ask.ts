import {
  COSTS,
  KNIGHTS_PER_LEVEL,
  MAX_CITY_WALLS,
  getScenario,
  getTopologyFor,
  improvementCost,
  type Action,
  type Card,
  type CardCounts,
  type GameView,
  type ImprovementTrack,
  type KnightLevel,
  type PlayerId,
  type ProgressCardName,
} from 'engine';
import { ACTIVATE_COST, KNIGHT_COST, KNIGHT_LABEL, PROMOTE_COST, TRACK_INFO, WALL_COST, improvementName, sevenLimitOf, spotLabel, unlocks } from './ck';
import { CARD_INFO, CARD_LIST, WONDER_INFO, handOfView, harborLabel } from './names';
import { hasCrane, improvementPriceOf, playAsk, type PlayAction } from './progress';

/*
 * "Ask before building": what the confirmation dialog says about a build, a
 * purchase or a placement (see ui/ConfirmDialog.tsx). Plain data, so it can
 * be tested without a browser.
 */

/**
 * The picture in the dialog: a piece in the player's colours, a face-down
 * card or a wonder; in Cities & Knights a knight (its strength, `-on` when
 * active), a city wall, a city gate or a metropolis tower of a track.
 */
export type AskArt =
  | 'road'
  | 'ship'
  | 'settlement'
  | 'city'
  | 'dev'
  | 'wonder'
  | `knight-${KnightLevel}`
  | `knight-${KnightLevel}-on`
  | 'wall'
  | `gate-${ImprovementTrack}`
  | `metro-${ImprovementTrack}`
  | 'robber'
  /** A progress card being played: the dialog shows its face (`Ask.card`). */
  | 'progress';

export interface AskChoice {
  action: Action;
  art: AskArt;
  /** The button: "Yes, build", or the piece's name when there is a choice ("Road", "Ship"). */
  label: string;
}

export interface Ask {
  title: string;
  /** One per move possible at the spot (a coast can take a road or a ship). */
  choices: AskChoice[];
  /** What it costs (null: free, e.g. the starting pieces or the Road Building card). */
  cost: CardCounts | null;
  /** Each card paid (a resource or a commodity), and how many of it the hand keeps. */
  left: Array<{ r: Card; n: number }>;
  /** Anything worth knowing first ("This is your last settlement piece"). */
  notes: string[];
  /** Playing a progress card: its face is shown. */
  card?: ProgressCardName;
}

/** The wonder a player has claimed and how far it is built (The Wonders scenario). */
interface Wonders {
  owned: Array<string | null>;
  levels: number[];
}

/** A wonder is finished, and the game won, at its fourth level (engine: WONDER_LEVELS). */
const WONDER_TOP = 4;

const lower = (r: Card) => CARD_INFO[r].label.toLowerCase();

/** "a, b and c" */
export function listText(parts: string[]): string {
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** "You'll have 0 wool, 2 grain and 3 ore left." */
export function leftText(left: Array<{ r: Card; n: number }>): string {
  return `You'll have ${listText(left.map((x) => `${x.n} ${lower(x.r)}`))} left.`;
}

/** The harbor a settlement at this spot would use, if any ("2:1 wool", "3:1"). */
function harborAt(view: GameView, vertex: string): string | null {
  const t = getTopologyFor(view.board.layoutKey);
  const h = view.board.harbors.find((x) => t.edgeVertices[x.edge]?.includes(vertex));
  return h ? harborLabel(h.type) : null;
}

/** Basic, strong or mighty knights the player still has in their supply. */
function knightsLeft(view: GameView, seat: PlayerId, level: KnightLevel): number {
  return KNIGHTS_PER_LEVEL - Object.values(view.ck?.knights ?? {}).filter((k) => k.owner === seat && k.level === level).length;
}

function one(a: Action, view: GameView, seat: PlayerId): { title: string; choice: AskChoice; cost: CardCounts | null; notes: string[] } | null {
  const me = view.players[seat];
  const free = view.phase.kind === 'roadBuilding';
  const notes: string[] = [];
  const last = (n: number | undefined, what: string) => {
    if (n === 1) notes.push(`This is your last ${what}`);
  };
  const harbor = (v: string) => {
    const h = harborAt(view, v);
    if (h) notes.push(`This spot has a ${h} harbor`);
  };
  switch (a.type) {
    case 'buyDevCard': {
      const n = view.devDeckCount;
      notes.push(n === 1 ? 'This is the last card in the deck' : `${n} development cards left in the deck`);
      notes.push("You can't play it this turn");
      return { title: 'Buy a development card?', choice: { action: a, art: 'dev', label: 'Yes, buy' }, cost: COSTS.devCard, notes };
    }
    case 'buildRoad':
    case 'buildShip': {
      const piece = a.type === 'buildRoad' ? 'road' : 'ship';
      last(piece === 'road' ? me?.supply.roads : me?.supply.ships, piece);
      if (free && view.phase.kind === 'roadBuilding') {
        const more = view.phase.remaining - 1;
        notes.push(more > 0 ? `${more} more free piece${more === 1 ? '' : 's'} from the Road Building card after this` : 'The last free piece from the Road Building card');
        return { title: `Place a free ${piece} here?`, choice: { action: a, art: piece, label: 'Yes, place' }, cost: null, notes };
      }
      return { title: `Build a ${piece} here?`, choice: { action: a, art: piece, label: 'Yes, build' }, cost: COSTS[piece], notes };
    }
    case 'buildSettlement':
      notes.push('+1 victory point');
      harbor(a.vertex);
      last(me?.supply.settlements, 'settlement piece');
      return { title: 'Build a settlement here?', choice: { action: a, art: 'settlement', label: 'Yes, build' }, cost: COSTS.settlement, notes };
    case 'buildCity':
      notes.push('+1 victory point (a city is worth 2)');
      notes.push('2 cards instead of 1 from each tile around it');
      last(me?.supply.cities, 'city');
      return { title: 'Upgrade this settlement to a city?', choice: { action: a, art: 'city', label: 'Yes, build' }, cost: COSTS.city, notes };
    case 'placeSettlement': {
      harbor(a.vertex);
      // Cities & Knights: the second starting piece is a city
      const ph = view.phase;
      if (view.ck && ph.kind === 'setup' && getScenario(view.scenario).rules.setupRounds[ph.round]?.collect) {
        notes.unshift('It brings 1 card from each tile around it');
        return { title: 'Place your city here?', choice: { action: a, art: 'city', label: 'Yes, place' }, cost: null, notes };
      }
      return { title: 'Place your settlement here?', choice: { action: a, art: 'settlement', label: 'Yes, place' }, cost: null, notes };
    }
    case 'placeRoad':
      return { title: 'Place your road here?', choice: { action: a, art: 'road', label: 'Yes, place' }, cost: null, notes };
    case 'placeShip':
      return { title: 'Place your ship here?', choice: { action: a, art: 'ship', label: 'Yes, place' }, cost: null, notes };
    case 'moveShip':
      notes.push('You can move one ship per turn');
      return { title: 'Move your ship here?', choice: { action: a, art: 'ship', label: 'Yes, move' }, cost: null, notes };
    // --- Cities & Knights ---
    case 'buildKnight': {
      const n = knightsLeft(view, seat, 1);
      notes.push('It starts inactive: activate it (1 grain) to defend Catan and to act');
      notes.push('Other players cannot build roads past it');
      if (n === 1) notes.push('This is your last basic knight');
      return { title: 'Hire a basic knight here?', choice: { action: a, art: 'knight-1', label: 'Yes, hire' }, cost: KNIGHT_COST, notes };
    }
    case 'activateKnight': {
      const k = view.ck?.knights[a.vertex];
      if (!k) return null;
      notes.push(`It defends against the barbarians with strength ${k.level}`);
      notes.push('It can move, displace or chase the robber from your next turn');
      return { title: `Activate this ${KNIGHT_LABEL[k.level].toLowerCase()}?`, choice: { action: a, art: `knight-${k.level}-on`, label: 'Yes, activate' }, cost: ACTIVATE_COST, notes };
    }
    case 'promoteKnight': {
      const k = view.ck?.knights[a.vertex];
      if (!k || k.level === 3) return null;
      const next = (k.level + 1) as KnightLevel;
      notes.push(`Strength ${k.level} → ${next}`);
      notes.push(k.active ? 'It stays active' : 'It stays inactive');
      if (knightsLeft(view, seat, next) === 1) notes.push(`This is your last ${KNIGHT_LABEL[next].toLowerCase()}`);
      return {
        title: `Promote it to a ${KNIGHT_LABEL[next].toLowerCase()}?`,
        choice: { action: a, art: k.active ? `knight-${next}-on` : `knight-${next}`, label: 'Yes, promote' },
        cost: PROMOTE_COST,
        notes,
      };
    }
    case 'moveKnight':
    case 'displaceKnight': {
      const k = view.ck?.knights[a.from];
      if (!k) return null;
      if (a.type === 'displaceKnight') {
        const victim = view.ck?.knights[a.to];
        const who = victim ? view.players[victim.owner]?.name ?? 'Its owner' : 'Its owner';
        notes.push('Your knight takes its place and becomes inactive');
        notes.push(`${who} moves it away along their roads (or it leaves the board)`);
        return {
          title: victim ? `Displace ${who}'s ${KNIGHT_LABEL[victim.level].toLowerCase()}?` : 'Displace this knight?',
          choice: { action: a, art: `knight-${k.level}`, label: 'Yes, displace' },
          cost: null,
          notes,
        };
      }
      notes.push('It becomes inactive (1 grain activates it again)');
      return { title: `Move your ${KNIGHT_LABEL[k.level].toLowerCase()} here?`, choice: { action: a, art: `knight-${k.level}`, label: 'Yes, move' }, cost: null, notes };
    }
    case 'chaseRobber': {
      const k = view.ck?.knights[a.vertex];
      if (!k) return null;
      notes.push('The knight becomes inactive');
      notes.push('Then move the robber to a numbered hex and steal a card');
      return { title: 'Chase the robber away?', choice: { action: a, art: 'robber', label: 'Yes, chase it' }, cost: null, notes };
    }
    case 'buildCityWall': {
      const walls = view.ck?.players[seat]?.walls.length ?? 0;
      const limit = sevenLimitOf(view, seat);
      notes.push(`Your hand limit on a 7 goes from ${limit} to ${limit + 2} cards`);
      notes.push('The wall falls with the city if the barbarians pillage it');
      if (walls === MAX_CITY_WALLS - 1) notes.push('This is your last city wall');
      return { title: 'Build a city wall here?', choice: { action: a, art: 'wall', label: 'Yes, build' }, cost: WALL_COST, notes };
    }
    case 'improveCity': {
      const level = (view.ck?.players[seat]?.improvements[a.track] ?? 0) + 1;
      const info = TRACK_INFO[a.track];
      const name = improvementName(a.track, level);
      notes.push(...unlocks(view, seat, a.track, level));
      const cost = { [info.commodity]: improvementPriceOf(view, seat, level) } as CardCounts;
      if (hasCrane(view, seat)) notes.push(`The Crane takes 1 off: ${improvementPriceOf(view, seat, level)} instead of ${improvementCost(level)}`);
      if (a.vertex !== undefined)
        return {
          title: `Build the ${name} and a metropolis?`,
          choice: { action: a, art: `metro-${a.track}`, label: spotLabel(view, a.vertex) },
          cost,
          notes,
        };
      return { title: `Build the ${name}?`, choice: { action: a, art: `gate-${a.track}`, label: 'Yes, build' }, cost, notes: [`${info.label} level ${level}`, ...notes] };
    }
    case 'scenario': {
      if (a.name !== 'buildWonder') return null;
      const w = view.ext.wonders as Wonders | undefined;
      const id = w?.owned[seat];
      const info = id ? WONDER_INFO[id] : undefined;
      if (!w || !info) return null;
      const level = (w.levels[seat] ?? 0) + 1;
      notes.push(level >= WONDER_TOP ? `Level ${WONDER_TOP} finishes the wonder: you win the game` : `Level ${level} of ${WONDER_TOP}`);
      return { title: `Build level ${level} of the ${info.name}?`, choice: { action: a, art: 'wonder', label: 'Yes, build' }, cost: info.cost, notes };
    }
    default:
      return null;
  }
}

/** Moves that pay for something, and so end the trading in the "trade, then build" mode. */
const STARTS_BUILDING = new Set<Action['type']>([
  'buyDevCard',
  'buildRoad',
  'buildShip',
  'buildSettlement',
  'buildCity',
  'moveShip',
  'buildKnight',
  'activateKnight',
  'promoteKnight',
  'buildCityWall',
  'improveCity',
]);

/**
 * What to ask before one of these moves (all at one spot, or a single buy),
 * or null when they aren't builds (the robber, a harbor), which keep the
 * confirm bar.
 */
export function askFor(actions: Action[], view: GameView, seat: PlayerId): Ask | null {
  if (actions.length === 0) return null;
  const each = actions.map((a) => one(a, view, seat));
  if (each.some((x) => x === null)) return null;
  const parts = each as NonNullable<ReturnType<typeof one>>[];
  const first = parts[0];
  // a city improvement that wins a metropolis: one choice per city, all at the same price
  const metropolis = actions.every((a) => a.type === 'improveCity');
  const cost = parts.length === 1 || metropolis ? first.cost : null;
  const hand = handOfView(view, seat);
  const left = cost ? CARD_LIST.filter((r) => (cost[r] ?? 0) > 0).map((r) => ({ r, n: Math.max(0, (hand[r] ?? 0) - (cost[r] ?? 0)) })) : [];
  const notes = parts.length === 1 || metropolis ? [...first.notes] : [];
  const ph = view.phase.kind;
  if (view.options.tradeBuildMode === 'separate' && ph === 'main' && !view.turn.buildingStarted && actions.some((a) => STARTS_BUILDING.has(a.type)))
    notes.push("After this you can't trade any more this turn");
  if (parts.length === 1) return { title: first.title, choices: [first.choice], cost, left, notes };
  if (metropolis) return { title: `${first.title.replace(/\?$/, '')}: on which city?`, choices: parts.map((p) => p.choice), cost, left, notes };
  // a coast: a road or a ship (both free: the starting pieces, or the Road Building card)
  const names = parts.map((p) => p.choice.art);
  const title = ph === 'roadBuilding' ? `Place a free ${names.join(' or ')} here?` : `Place your ${names.join(' or ')} here?`;
  return {
    title,
    choices: parts.map((p) => ({ ...p.choice, label: p.choice.art === 'road' ? 'Road' : p.choice.art === 'ship' ? 'Ship' : p.choice.label })),
    cost,
    left,
    notes,
  };
}

/**
 * Playing a progress card, always confirmed: the card's face, what it will
 * do with the choices made, and (Medicine) what it costs. `second`: the
 * Smith's second knight.
 */
export function progressAsk(a: PlayAction, view: GameView, seat: PlayerId, second?: string): Ask {
  const p = playAsk(view, seat, a, second);
  const hand = handOfView(view, seat);
  const cost = p.cost;
  const left = cost ? CARD_LIST.filter((r) => (cost[r] ?? 0) > 0).map((r) => ({ r, n: Math.max(0, (hand[r] ?? 0) - (cost[r] ?? 0)) })) : [];
  const notes = [...p.notes];
  if (a.card === 'medicine' && view.options.tradeBuildMode === 'separate' && !view.turn.buildingStarted) notes.push("After this you can't trade any more this turn");
  return { title: p.title, choices: [{ action: a, art: 'progress', label: p.label }], cost, left, notes, card: a.card };
}
