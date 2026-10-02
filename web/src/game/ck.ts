import {
  ABILITY_LEVEL,
  CK_COSTS,
  IMPROVEMENT_NAMES,
  MAX_IMPROVEMENT,
  METROPOLIS_LEVEL,
  PROGRESS_CARDS,
  TRACK_COMMODITY,
  drawsOn,
  getTopologyFor,
  type Commodity,
  type EventFace,
  type GameView,
  type ImprovementTrack,
  type KnightLevel,
  type PlayerId,
  type ProgressCardName,
  type VertexId,
} from 'engine';

/*
 * Cities & Knights in the browser: names, colours and plain-data summaries
 * of the expansion's state (see engine src/ck and docs/cities-and-knights.md).
 * No drawing here, so it can be tested without a browser.
 */

export const TRACK_LIST: ImprovementTrack[] = ['trade', 'politics', 'science'];

export interface TrackInfo {
  label: string;
  /** The colour of its flag, city gate and progress cards. */
  colorName: 'yellow' | 'blue' | 'green';
  fill: string;
  dark: string;
  light: string;
  commodity: Commodity;
  /** The level-3 improvement's ability, in a few words and in a sentence. */
  ability: string;
  abilityText: string;
}

export const TRACK_INFO: Record<ImprovementTrack, TrackInfo> = {
  trade: {
    label: 'Trade',
    colorName: 'yellow',
    fill: '#e9b726',
    dark: '#8a6410',
    light: '#fbe59a',
    commodity: TRACK_COMMODITY.trade,
    ability: '2:1 commodities',
    abilityText: 'Trade any commodity with the bank 2:1.',
  },
  politics: {
    label: 'Politics',
    colorName: 'blue',
    fill: '#3b78c9',
    dark: '#173a7a',
    light: '#b9d3f2',
    commodity: TRACK_COMMODITY.politics,
    ability: 'Mighty knights',
    abilityText: 'Promote strong knights to mighty knights.',
  },
  science: {
    label: 'Science',
    colorName: 'green',
    fill: '#3f9a4a',
    dark: '#1d5a26',
    light: '#bfe5b9',
    commodity: TRACK_COMMODITY.science,
    ability: 'Aqueduct',
    abilityText: 'A roll that gives you nothing (not a 7): take a resource of your choice.',
  },
};

export const KNIGHT_LABEL: Record<KnightLevel, string> = { 1: 'Basic knight', 2: 'Strong knight', 3: 'Mighty knight' };

export function improvementName(track: ImprovementTrack, level: number): string {
  return IMPROVEMENT_NAMES[track][level - 1] ?? '';
}

/** The highest red die result that draws a progress card at this level (0: none). */
export function drawLimit(level: number): number {
  return level >= 1 ? Math.min(6, level + 1) : 0;
}

/** "1–3" for the red results that draw at a level. */
export function drawRange(level: number): string {
  const top = drawLimit(level);
  return top === 0 ? '–' : top === 1 ? '1' : `1–${top}`;
}

/** What the next level of a track does for its buyer, line by line (for the confirmation dialog). */
export function unlocks(view: GameView, seat: PlayerId, track: ImprovementTrack, level: number): string[] {
  const out: string[] = [];
  const info = TRACK_INFO[track];
  out.push(`${info.colorName[0].toUpperCase()}${info.colorName.slice(1)} gate: you draw a ${track} card on a red ${drawRange(level)}`);
  if (level === ABILITY_LEVEL) out.push(`${improvementName(track, level)}: ${info.abilityText}`);
  if (level >= METROPOLIS_LEVEL) {
    const m = view.ck?.metropolises[track];
    if (m === null || m === undefined) out.push(`The ${track} metropolis is yours: +2 VP`);
    else if (m.owner === seat) out.push(level === MAX_IMPROVEMENT ? `Nobody can take your ${track} metropolis any more` : '');
    else if (level === MAX_IMPROVEMENT) out.push(`You take the ${track} metropolis from ${view.players[m.owner]?.name}: +2 VP`);
    else out.push(`${view.players[m.owner]?.name} holds the metropolis: level 5 takes it`);
  }
  return out.filter((x) => x !== '');
}

/** The short rule text of each progress card (the card effects come with phase 2). */
export const PROGRESS_TEXT: Record<ProgressCardName, string> = {
  alchemist: 'Before rolling: choose both production dice.',
  crane: 'One city improvement this turn costs a commodity less.',
  engineer: 'Build a city wall for free.',
  inventor: 'Swap two number tokens (not 2, 12, 6 or 8).',
  irrigation: '2 grain for each fields hex next to your buildings.',
  medicine: 'Upgrade a settlement to a city for 2 ore and 1 grain.',
  mining: '2 ore for each mountains hex next to your buildings.',
  printer: '1 victory point, played at once.',
  roadBuilding: 'Build 2 roads for free.',
  smith: 'Promote up to 2 knights for free.',
  bishop: 'Move the robber and take a card from each player next to it.',
  constitution: '1 victory point, played at once.',
  deserter: 'An opponent removes a knight; you may place one of yours.',
  diplomat: 'Remove an open road (yours you may move).',
  intrigue: "Displace an opponent's knight on your road.",
  saboteur: 'Players with at least your points discard half their cards.',
  spy: "Look at a player's progress cards and take one.",
  warlord: 'Activate all your knights for free.',
  wedding: 'Players with more points give you 2 cards each.',
  commercialHarbor: 'Swap a resource for a commodity with each opponent.',
  masterMerchant: 'Take 2 cards from a player with more points.',
  merchant: 'Place the merchant: 2:1 for its resource, and 1 VP.',
  merchantFleet: 'Trade one card kind 2:1 with the bank this turn.',
  resourceMonopoly: 'Name a resource: everyone gives you 2 of it.',
  tradeMonopoly: 'Name a commodity: everyone gives you 1 of it.',
};

export function progressDeck(card: ProgressCardName): ImprovementTrack {
  return PROGRESS_CARDS[card]?.deck ?? 'science';
}

/** Players who draw a progress card on a city gate of `track` with this red die, in turn order from the roller. */
export function drawersFor(view: GameView, track: ImprovementTrack, red: number): PlayerId[] {
  const ck = view.ck;
  if (!ck) return [];
  const n = view.players.length;
  const out: PlayerId[] = [];
  for (let i = 0; i < n; i++) {
    const p = (view.turn.current + i) % n;
    if (drawsOn(ck.players[p]?.improvements[track] ?? 0, red)) out.push(p);
  }
  return out;
}

/** "You", "Ada", "You and Ada", "Ada, Björn and you". */
export function namesList(view: GameView, players: PlayerId[], seat: PlayerId | null, capital = true): string {
  const names = players.map((p) => (p === seat ? 'you' : view.players[p]?.name ?? `Player ${p + 1}`));
  const text = names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return capital ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** What the event die did, in a headline and a line underneath. */
export function eventText(view: GameView, event: EventFace, red: number, seat: PlayerId | null): { title: string; sub: string } {
  if (event === 'ship') {
    const ck = view.ck;
    const pos = ck?.barbarians ?? 0;
    const track = ck?.track ?? 7;
    if (pos === 0 && (ck?.attacks ?? 0) > 0) return { title: 'The barbarians attack!', sub: 'The ship reached Catan' };
    return { title: 'Barbarians advance', sub: `The ship is ${track - pos} space${track - pos === 1 ? '' : 's'} from Catan` };
  }
  const info = TRACK_INFO[event];
  const who = drawersFor(view, event, red);
  const gate = `${info.colorName[0].toUpperCase()}${info.colorName.slice(1)} gate`;
  const min = Math.max(1, red - 1);
  const title = `${gate}: ${event} cards for level ${min}+`;
  const sub =
    who.length === 0
      ? `Red ${red}: nobody draws`
      : `Red ${red}: ${namesList(view, who, seat)} draw${who.length === 1 && who[0] !== seat ? 's' : ''} a ${info.label.toLowerCase()} card`;
  return { title, sub };
}

export interface BarbarianState {
  /** Spaces sailed (0 at the start), and the length of the track. */
  pos: number;
  track: number;
  /** Barbarian strength: every city on the board, metropolises included. */
  barbarians: number;
  /** The knights' strength: every active knight, whoever owns it. */
  knights: number;
  perPlayer: number[];
  /** Knights on the board per player: active and all. */
  active: number[];
  total: number[];
  attacks: number;
  robberActive: boolean;
  /**
   * Seafarers scenarios before the first attack: the robber and the pirate
   * wait at the end of the track, then take their scenario starting hexes
   * (2025 rulebook p. 12). Null when they are on the board (or the base game).
   */
  waiting: { robber: boolean; pirate: boolean } | null;
}

export function barbarianState(view: GameView): BarbarianState | null {
  const ck = view.ck;
  if (!ck) return null;
  const n = view.players.length;
  const perPlayer = Array<number>(n).fill(0);
  const active = Array<number>(n).fill(0);
  const total = Array<number>(n).fill(0);
  for (const k of Object.values(ck.knights)) {
    total[k.owner]++;
    if (k.active) {
      active[k.owner]++;
      perPlayer[k.owner] += k.level;
    }
  }
  const barbarians = Object.values(view.board.buildings).filter((b) => b.type === 'city').length;
  return {
    pos: ck.barbarians,
    track: ck.track,
    barbarians,
    knights: perPlayer.reduce((a, b) => a + b, 0),
    perPlayer,
    active,
    total,
    attacks: ck.attacks,
    robberActive: ck.robberActive,
    waiting: ck.asleep ? { robber: ck.asleep.robber !== null, pirate: ck.asleep.pirate !== null } : null,
  };
}

/** The numbers around an intersection, to tell cities apart: "6 · 9 · 11". */
export function spotLabel(view: GameView, v: VertexId): string {
  const t = getTopologyFor(view.board.layoutKey);
  const nums = (t.vertexHexes[v] ?? [])
    .map((h) => view.board.hexes[h])
    .filter((h) => h && h.token !== null)
    .map((h) => h!.token as number)
    .sort((a, b) => a - b);
  return nums.length > 0 ? nums.join(' · ') : 'the coast';
}

/** Victory points from the expansion, by kind (for the scores). */
export function ckPoints(view: GameView, p: PlayerId): { metropolis: number; defender: number; cards: number; merchant: number } {
  const ck = view.ck;
  if (!ck) return { metropolis: 0, defender: 0, cards: 0, merchant: 0 };
  const metropolis = TRACK_LIST.filter((t) => ck.metropolises[t]?.owner === p).length * 2;
  return {
    metropolis,
    defender: ck.players[p]?.defenders ?? 0,
    cards: ck.players[p]?.vpCards.length ?? 0,
    merchant: ck.merchant?.owner === p ? 1 : 0,
  };
}

/** The hand limit on a 7: 7, plus 2 for each city wall. */
export function sevenLimitOf(view: GameView, p: PlayerId): number {
  return view.options.discardLimit + (view.ck?.players[p]?.walls.length ?? 0) * 2;
}

export const KNIGHT_COST = CK_COSTS.knight;
export const ACTIVATE_COST = CK_COSTS.activate;
export const PROMOTE_COST = CK_COSTS.promote;
export const WALL_COST = CK_COSTS.cityWall;
