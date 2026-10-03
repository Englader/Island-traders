import { isResource, payingVillages, producingHexes, productionClaims, type GameView, type HexId, type ProductionSource, type VertexId } from 'engine';

/** What a roll paid out from: lit for a moment once the dice have landed. */
export interface RollLight {
  /** Hexes that paid: their number came up, the robber is elsewhere, a building touches them and the bank could pay. */
  hexes: HexId[];
  /** Cloth for Catan: villages that paid cloth. */
  villages: VertexId[];
  /** The robber's hex, when the robber was all that kept it from paying. */
  blocked: HexId | null;
}

export const NO_LIGHT: RollLight = { hexes: [], villages: [], blocked: null };

/**
 * What the latest roll (`after.turn.dice`) paid out from, worked out by the
 * engine's own production rules (`producingHexes`) from public information,
 * so a guest's screen agrees with the host's.
 *
 * `before` is the view from just before the roll: its banks and Cloth
 * villages are what the roll was dealt from. The board is `after`'s: in Cities
 * & Knights the barbarians land before production and may pillage a city or
 * wake the robber. (One thing a view cannot show: a Pirate Islands raid on the
 * same roll puts cards back in the bank just before production.)
 *
 * Without `before` (the screen opened after the roll) the bank is taken as it
 * was if everything claimed was dealt, which only misses a bank shortage.
 */
export function rollLight(before: GameView | null, after: GameView): RollLight {
  const dice = after.turn.dice;
  if (!dice || dice[0] + dice[1] === 7) return NO_LIGHT;
  const roll = dice[0] + dice[1];
  const src: ProductionSource = before ? { board: after.board, bank: before.bank, ck: before.ck } : undealt(after, roll);
  const hexes = producingHexes(src, roll);
  const robber = after.board.robber;
  const blocked =
    robber !== null && !hexes.includes(robber) && producingHexes({ ...src, board: { ...src.board, robber: null } }, roll).includes(robber) ? robber : null;
  return { hexes, villages: payingVillages((before ?? after).ext, roll), blocked };
}

/** `after` with the roll's claims put back in the bank. */
function undealt(after: GameView, roll: number): ProductionSource {
  const bank = { ...after.bank };
  const ck = after.ck ? { bank: { ...after.ck.bank } } : undefined;
  for (const c of productionClaims(after, roll)) {
    if (c.card === 'gold') continue;
    if (isResource(c.card)) bank[c.card] += c.n;
    else if (ck) ck.bank[c.card] += c.n;
  }
  return { board: after.board, bank, ck };
}
