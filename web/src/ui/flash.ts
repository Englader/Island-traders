import type { Action } from 'engine';

/** What to highlight on the board for the latest move, and whose it was. */
export interface Flash {
  kind: 'vertex' | 'edge' | 'hex' | 'roll';
  id: string;
  key: number;
  by: number;
}

export function flashOf(a: Action | undefined, key: number): Flash | null {
  if (!a) return null;
  const by = a.player;
  switch (a.type) {
    case 'placeSettlement':
    case 'buildSettlement':
    case 'buildCity':
    case 'buildKnight':
    case 'activateKnight':
    case 'promoteKnight':
    case 'buildCityWall':
    case 'pillageCity':
      return { kind: 'vertex', id: a.vertex, key, by };
    case 'moveKnight':
    case 'displaceKnight':
    case 'retreatKnight':
      return { kind: 'vertex', id: a.to, key, by };
    case 'improveCity':
      return a.vertex ? { kind: 'vertex', id: a.vertex, key, by } : null;
    case 'placeRoad':
    case 'placeShip':
    case 'buildRoad':
    case 'buildShip':
    case 'placeHarbor':
      return { kind: 'edge', id: a.edge, key, by };
    case 'moveShip':
      return { kind: 'edge', id: a.to, key, by };
    case 'moveRobber':
      return { kind: 'hex', id: a.hex, key, by };
    case 'rollDice':
      return { kind: 'roll', id: '', key, by };
    default:
      return null;
  }
}
