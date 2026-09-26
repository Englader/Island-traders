import type { Action } from 'engine';
import type { PickKind } from '../board/Board';

/** The board spot to flash for the latest move. */
export function flashOf(a: Action | undefined, key: number): { kind: PickKind; id: string; key: number } | null {
  if (!a) return null;
  switch (a.type) {
    case 'placeSettlement':
    case 'buildSettlement':
    case 'buildCity':
      return { kind: 'vertex', id: a.vertex, key };
    case 'placeRoad':
    case 'placeShip':
    case 'buildRoad':
    case 'buildShip':
    case 'placeHarbor':
      return { kind: 'edge', id: a.edge, key };
    case 'moveShip':
      return { kind: 'edge', id: a.to, key };
    case 'moveRobber':
      return { kind: 'hex', id: a.hex, key };
    default:
      return null;
  }
}
