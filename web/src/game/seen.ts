import { COMMODITIES, RESOURCES, commodityBank, getScenario, seenHands, type Card, type GameView, type PlayerId, type SeenHand } from 'engine';
import { handSplit } from './ck';
import { bankOfView, handOfView } from './names';

/**
 * What this seat has seen of the other hands (see seenHands in
 * src/bots/tracker.ts, the computer players' own card tracker), from its
 * view alone: the log it sees, the hand sizes and the bank. Never another
 * hand: the view doesn't hold one. Null for the seat itself.
 */
export function seenOfView(view: GameView, me: PlayerId): Array<SeenHand | null> {
  const sizes = view.players.map((p) => handSplit(view, p.id) ?? { resources: p.resourceCount, commodities: 0 });
  const mine = handOfView(view, me);
  const bank = bankOfView(view);
  const n = view.players.length;
  // the cards out of the bank and out of this hand are in the others' hands
  let held: Partial<Record<Card, number>> | null = {};
  const families: Array<[readonly Card[], number, 'resources' | 'commodities']> = [[RESOURCES, getScenario(view.scenario).bankSize(n), 'resources']];
  if (view.ck) families.push([COMMODITIES, commodityBank(n), 'commodities']);
  for (const [kinds, supply, side] of families) {
    let sum = 0;
    for (const k of kinds) {
      held[k] = supply - (bank[k] ?? 0) - (mine[k] ?? 0);
      sum += held[k]!;
    }
    // (they always add up; if they ever didn't, the bank says nothing)
    const others = sizes.reduce((m, z, q) => m + (q === me ? 0 : z[side]), 0);
    if (sum !== others || kinds.some((k) => held![k]! < 0)) held = null;
    if (!held) break;
  }
  return seenHands(view, me, { sizes, held });
}
