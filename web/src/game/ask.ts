import { COSTS, getTopologyFor, type Action, type GameView, type PartialCounts, type PlayerId, type Resource } from 'engine';
import { RESOURCE_INFO, RESOURCE_LIST, WONDER_INFO, harborLabel } from './names';

/*
 * "Ask before building": what the confirmation dialog says about a build, a
 * purchase or a placement (see ui/ConfirmDialog.tsx). Plain data, so it can
 * be tested without a browser.
 */

/** The picture in the dialog: a piece in the player's colours, a face-down card or a wonder. */
export type AskArt = 'road' | 'ship' | 'settlement' | 'city' | 'dev' | 'wonder';

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
  cost: PartialCounts | null;
  /** Each resource paid, and how many of it the hand keeps. */
  left: Array<{ r: Resource; n: number }>;
  /** Anything worth knowing first ("This is your last settlement piece"). */
  notes: string[];
}

/** The wonder a player has claimed and how far it is built (The Wonders scenario). */
interface Wonders {
  owned: Array<string | null>;
  levels: number[];
}

/** A wonder is finished, and the game won, at its fourth level (engine: WONDER_LEVELS). */
const WONDER_TOP = 4;

const lower = (r: Resource) => RESOURCE_INFO[r].label.toLowerCase();

/** "a, b and c" */
export function listText(parts: string[]): string {
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** "You'll have 0 wool, 2 grain and 3 ore left." */
export function leftText(left: Array<{ r: Resource; n: number }>): string {
  return `You'll have ${listText(left.map((x) => `${x.n} ${lower(x.r)}`))} left.`;
}

/** The harbor a settlement at this spot would use, if any ("2:1 wool", "3:1"). */
function harborAt(view: GameView, vertex: string): string | null {
  const t = getTopologyFor(view.board.layoutKey);
  const h = view.board.harbors.find((x) => t.edgeVertices[x.edge]?.includes(vertex));
  return h ? harborLabel(h.type) : null;
}

function one(a: Action, view: GameView, seat: PlayerId): { title: string; choice: AskChoice; cost: PartialCounts | null; notes: string[] } | null {
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
    case 'placeSettlement':
      harbor(a.vertex);
      return { title: 'Place your settlement here?', choice: { action: a, art: 'settlement', label: 'Yes, place' }, cost: null, notes };
    case 'placeRoad':
      return { title: 'Place your road here?', choice: { action: a, art: 'road', label: 'Yes, place' }, cost: null, notes };
    case 'placeShip':
      return { title: 'Place your ship here?', choice: { action: a, art: 'ship', label: 'Yes, place' }, cost: null, notes };
    case 'moveShip':
      notes.push('You can move one ship per turn');
      return { title: 'Move your ship here?', choice: { action: a, art: 'ship', label: 'Yes, move' }, cost: null, notes };
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
const STARTS_BUILDING = new Set<Action['type']>(['buyDevCard', 'buildRoad', 'buildShip', 'buildSettlement', 'buildCity', 'moveShip']);

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
  const cost = parts.length === 1 ? first.cost : null;
  const hand: PartialCounts = view.players[seat]?.resources ?? {};
  const left = cost ? RESOURCE_LIST.filter((r) => (cost[r] ?? 0) > 0).map((r) => ({ r, n: Math.max(0, (hand[r] ?? 0) - (cost[r] ?? 0)) })) : [];
  const notes = parts.length === 1 ? [...first.notes] : [];
  const ph = view.phase.kind;
  if (view.options.tradeBuildMode === 'separate' && ph === 'main' && !view.turn.buildingStarted && actions.some((a) => STARTS_BUILDING.has(a.type)))
    notes.push("After this you can't trade any more this turn");
  if (parts.length === 1) return { title: first.title, choices: [first.choice], cost, left, notes };
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
