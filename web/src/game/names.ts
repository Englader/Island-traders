import { PROGRESS_CARDS, type Action, type Card, type Commodity, type DevCardType, type GameView, type HarborType, type Resource, type Terrain } from 'engine';

export const RESOURCE_LIST: Resource[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];
/** Cities & Knights: the commodities, in the engine's order. */
export const COMMODITY_LIST: Commodity[] = ['paper', 'cloth', 'coin'];
/** Every card a hand can hold (commodities only in Cities & Knights games). */
export const CARD_LIST: Card[] = [...RESOURCE_LIST, ...COMMODITY_LIST];

/** The kinds of card this game uses: resources, plus commodities in Cities & Knights. */
export function cardKindsOf(view: GameView): Card[] {
  return view.ck ? CARD_LIST : RESOURCE_LIST;
}

/** A seat's whole hand as counts (commodities included in Cities & Knights); empty when hidden. */
export function handOfView(view: GameView, seat: number): Partial<Record<Card, number>> {
  const res = view.players[seat]?.resources;
  if (!res) return {};
  const com = view.ck?.players[seat]?.commodities;
  return com ? { ...res, ...com } : { ...res };
}

/** The bank's cards (commodities included in Cities & Knights). */
export function bankOfView(view: GameView): Partial<Record<Card, number>> {
  return view.ck ? { ...view.bank, ...view.ck.bank } : { ...view.bank };
}

export const RESOURCE_INFO: Record<Resource, { label: string; icon: string; color: string }> = {
  brick: { label: 'Brick', icon: '🧱', color: '#c65a32' },
  lumber: { label: 'Lumber', icon: '🌲', color: '#2f7d3a' },
  wool: { label: 'Wool', icon: '🐑', color: '#8ccf55' },
  grain: { label: 'Grain', icon: '🌾', color: '#e2b93b' },
  ore: { label: 'Ore', icon: '⛰️', color: '#7d8491' },
};

/** Commodities (Cities & Knights): made by cities on forest, pasture and mountains. */
export const COMMODITY_INFO: Record<Commodity, { label: string; icon: string; color: string; from: string }> = {
  paper: { label: 'Paper', icon: '📜', color: '#d6c193', from: 'forest' },
  cloth: { label: 'Cloth', icon: '🧶', color: '#a24f9a', from: 'pasture' },
  coin: { label: 'Coin', icon: '🪙', color: '#a8742a', from: 'mountains' },
};

/** Any card's name, icon and chart colour. */
export const CARD_INFO: Record<Card, { label: string; icon: string; color: string }> = { ...RESOURCE_INFO, ...COMMODITY_INFO };

export const TERRAIN_INFO: Record<Terrain, { label: string; fill: string; icon: string }> = {
  hills: { label: 'Hills', fill: '#c96a3d', icon: '🧱' },
  forest: { label: 'Forest', fill: '#3b8a45', icon: '🌲' },
  pasture: { label: 'Pasture', fill: '#9fd05f', icon: '🐑' },
  fields: { label: 'Fields', fill: '#e8c24b', icon: '🌾' },
  mountains: { label: 'Mountains', fill: '#8e939c', icon: '⛰️' },
  desert: { label: 'Desert', fill: '#e4d3a0', icon: '🌵' },
  gold: { label: 'Gold field', fill: '#4a4544', icon: '⛏️' },
  sea: { label: 'Sea', fill: '#3a86c8', icon: '' },
  fog: { label: 'Unexplored', fill: '#b9c2cc', icon: '❔' },
};

export const DEV_INFO: Record<DevCardType, { label: string; icon: string; text: string }> = {
  knight: { label: 'Knight', icon: '⚔️', text: 'Move the robber (or pirate) and steal a card.' },
  victoryPoint: { label: 'Victory point', icon: '🏆', text: 'Worth 1 VP. It counts automatically.' },
  roadBuilding: { label: 'Road Building', icon: '🛤️', text: 'Build 2 roads or ships for free.' },
  yearOfPlenty: { label: 'Year of Plenty', icon: '🎁', text: 'Take any 2 resources from the bank.' },
  monopoly: { label: 'Monopoly', icon: '💰', text: 'Every player gives you all their cards of one resource.' },
};

export function harborLabel(h: HarborType): string {
  return h === 'generic' ? '3:1' : `2:1 ${RESOURCE_INFO[h].label.toLowerCase()}`;
}

export function countsText(c: Partial<Record<Card, number>>): string {
  const parts = CARD_LIST.filter((r) => (c[r] ?? 0) > 0).map((r) => `${c[r]} ${CARD_INFO[r].label.toLowerCase()}`);
  return parts.length ? parts.join(' ') : 'nothing';
}

export const WONDER_INFO: Record<string, { name: string; requirement: string; cost: Partial<Record<Resource, number>> }> = {
  theater: { name: 'Theater', requirement: '2 cities', cost: { brick: 1, wool: 3, lumber: 1 } },
  greatBridge: { name: 'Great Bridge', requirement: 'a settlement at the strait', cost: { wool: 1, grain: 1, lumber: 3 } },
  monument: { name: 'Monument', requirement: 'a city at a harbor and a trade route of 5', cost: { ore: 2, grain: 3 } },
  greatWall: { name: 'Great Wall', requirement: 'a settlement at the desert wasteland', cost: { brick: 3, grain: 1, lumber: 1 } },
  cathedral: { name: 'Cathedral', requirement: 'a city and 6 victory points', cost: { brick: 1, ore: 3, grain: 1 } },
};

/** Short text for the confirm bar. */
export function describeAction(a: Action, view: GameView): string {
  const name = (p: number) => view.players[p]?.name ?? `Player ${p + 1}`;
  switch (a.type) {
    case 'placeSettlement':
      return view.ck && view.phase.kind === 'setup' && view.phase.round === 1 ? 'Place your city here?' : 'Place your settlement here?';
    case 'placeRoad':
      return 'Place a road here?';
    case 'placeShip':
      return 'Place a ship here?';
    case 'buildRoad':
      return view.phase.kind === 'roadBuilding' ? 'Place a free road here?' : 'Build a road here?';
    case 'buildShip':
      return view.phase.kind === 'roadBuilding' ? 'Place a free ship here?' : 'Build a ship here?';
    case 'buildSettlement':
      return 'Build a settlement here?';
    case 'buildCity':
      return 'Upgrade to a city?';
    case 'moveShip':
      return 'Move your ship here?';
    case 'placeHarbor':
      return 'Place the harbor here?';
    case 'moveRobber': {
      if (view.phase.kind === 'robber' && view.phase.reason === 'bishop') return 'Move the robber here and take a card from everyone next to it?';
      const cloth = view.ck ? 'village cloth' : 'cloth';
      const who = a.victim === undefined ? '' : a.take === 'cloth' ? ` and take ${cloth} from ${name(a.victim)}` : ` and rob ${name(a.victim)}`;
      return `Move the ${a.piece} here${who}?`;
    }
    case 'pillageCity':
      return 'Let the barbarians pillage this city?';
    case 'retreatKnight':
      return 'Move your knight here?';
    case 'buildKnight':
      return 'Hire a knight here?';
    case 'buildCityWall':
      return 'Build a city wall here?';
    case 'moveKnight':
      return 'Move your knight here?';
    case 'displaceKnight': {
      const k = view.ck?.knights[a.to];
      return k ? `Displace ${name(k.owner)}'s knight?` : 'Displace this knight?';
    }
    case 'improveCity':
      return 'Put the metropolis on this city?';
    case 'progressChoice': {
      const ph = view.phase;
      const stage = ph.kind === 'ck' && ph.step === 'card' ? ph.stage : undefined;
      if (stage === 'desert') return 'Remove this knight?';
      if (stage === 'promote') return 'Promote this knight for free?';
      if (stage === 'place') return 'Place your knight here?';
      if (stage === 'rebuild') return 'Place your road here again?';
      return 'Choose this?';
    }
    default:
      return 'Confirm?';
  }
}

/** Progress card names (Cities & Knights) for the log and the cards. */
export function progressTitle(card: string): string {
  return (PROGRESS_CARDS as Record<string, { title: string }>)[card]?.title ?? card;
}
