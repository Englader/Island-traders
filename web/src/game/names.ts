import type { Action, DevCardType, GameView, HarborType, Resource, Terrain } from 'engine';

export const RESOURCE_LIST: Resource[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];

export const RESOURCE_INFO: Record<Resource, { label: string; icon: string; color: string }> = {
  brick: { label: 'Brick', icon: '🧱', color: '#c65a32' },
  lumber: { label: 'Lumber', icon: '🪵', color: '#2f7d3a' },
  wool: { label: 'Wool', icon: '🐑', color: '#8ccf55' },
  grain: { label: 'Grain', icon: '🌾', color: '#e2b93b' },
  ore: { label: 'Ore', icon: '🪨', color: '#7d8491' },
};

export const TERRAIN_INFO: Record<Terrain, { label: string; fill: string; icon: string }> = {
  hills: { label: 'Hills', fill: '#c96a3d', icon: '🧱' },
  forest: { label: 'Forest', fill: '#3b8a45', icon: '🌲' },
  pasture: { label: 'Pasture', fill: '#9fd05f', icon: '🐑' },
  fields: { label: 'Fields', fill: '#e8c24b', icon: '🌾' },
  mountains: { label: 'Mountains', fill: '#8e939c', icon: '⛰️' },
  desert: { label: 'Desert', fill: '#e4d3a0', icon: '🌵' },
  gold: { label: 'Gold field', fill: '#f3c623', icon: '✨' },
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
  return h === 'generic' ? '3:1' : `2:1 ${RESOURCE_INFO[h].icon}`;
}

export function countsText(c: Partial<Record<Resource, number>>): string {
  const parts = RESOURCE_LIST.filter((r) => (c[r] ?? 0) > 0).map((r) => `${c[r]}${RESOURCE_INFO[r].icon}`);
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
      return 'Place your settlement here?';
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
      const who = a.victim === undefined ? '' : a.take === 'cloth' ? ` and take cloth from ${name(a.victim)}` : ` and rob ${name(a.victim)}`;
      return `Move the ${a.piece} here${who}?`;
    }
    default:
      return 'Confirm?';
  }
}
