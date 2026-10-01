import { PROGRESS_CARDS, type Action, type CardCounts, type DevCardType, type GameView, type ImprovementTrack, type PlayerId, type ProgressCardName } from 'engine';
import { barbarianState, namesList } from './ck';
import { playedFx } from './progress';
import { DEV_INFO, RESOURCE_INFO } from './names';

/*
 * The moments shown in the middle of the screen (ui/Fx.tsx draws them):
 * which move makes one, and what it shows. Plain data, so it can be tested
 * without a browser.
 */

/** Cities & Knights: one progress card drawn (its face known to its owner, and VP cards to all). */
export interface ProgressDraw {
  p: PlayerId;
  deck: ImprovementTrack;
  card: ProgressCardName | null;
}

/**
 * A moment worth showing in the middle of the screen: a trade or a
 * development card; in Cities & Knights the barbarians' attack, progress
 * cards drawn and city improvements.
 */
export type FxEvent =
  | { kind: 'trade'; a: PlayerId; b: PlayerId | 'bank'; give: CardCounts; get: CardCounts }
  | { kind: 'devBuy'; by: PlayerId; card: DevCardType | null }
  | { kind: 'devPlay'; by: PlayerId; card: DevCardType; detail: string }
  | {
      kind: 'attack';
      barbarians: number;
      knights: number;
      perPlayer: number[];
      won: boolean;
      /** What happened: who loses a city, who is Defender of Catan. */
      outcome: string;
      detail: string;
    }
  | { kind: 'draw'; draws: ProgressDraw[] }
  /** A progress card played (played cards are public): on whom, and what it does. */
  | { kind: 'progPlay'; by: PlayerId; card: ProgressCardName; target?: PlayerId; detail?: string }
  | { kind: 'improve'; by: PlayerId; track: ImprovementTrack; level: number; metropolis: boolean };

const PLAYS: Partial<Record<Action['type'], DevCardType>> = {
  playKnight: 'knight',
  playRoadBuilding: 'roadBuilding',
  playYearOfPlenty: 'yearOfPlenty',
  playMonopoly: 'monopoly',
};

function newCard(before: GameView, after: GameView, p: PlayerId): DevCardType | null {
  const had = before.players[p]?.devCards;
  const has = after.players[p]?.devCards;
  if (!had || !has) return null;
  const count = (list: typeof has, t: DevCardType) => list.filter((c) => c.type === t).length;
  return has.find((c) => count(has, c.type) > count(had, c.type))?.type ?? null;
}

const citiesOf = (v: GameView, p: PlayerId) => Object.values(v.board.buildings).filter((b) => b.owner === p && b.type === 'city').length;

/** The barbarians landed in this move: both sides' strength (from just before), and what came of it. */
function attackFx(before: GameView, after: GameView, seat: PlayerId | null): FxEvent | null {
  const b = barbarianState(before);
  const ca = after.ck;
  if (!b || !ca) return null;
  const won = b.knights >= b.barbarians;
  const n = after.players.length;
  const ids = after.players.map((p) => p.id);
  const list = (ps: PlayerId[], capital = true) => namesList(after, ps, seat, capital);
  let outcome: string;
  let detail: string;
  if (!won) {
    const lost = ids.filter((p) => citiesOf(after, p) < citiesOf(before, p));
    const ph = after.phase;
    const choosing = ph.kind === 'ck' && ph.step === 'pillage' ? Object.keys(ph.pending).map(Number) : [];
    if (lost.length === 0 && choosing.length === 0) {
      outcome = 'The barbarians win, but find no city to pillage';
      detail = 'Metropolises are safe from them';
    } else {
      const parts: string[] = [];
      if (lost.length > 0) parts.push(`${list(lost)} ${lost.length === 1 && lost[0] !== seat ? 'loses' : 'lose'} a city`);
      if (choosing.length > 0) parts.push(`${list(choosing, parts.length === 0)} ${choosing.length === 1 && choosing[0] !== seat ? 'chooses' : 'choose'} a city to lose`);
      outcome = `The barbarians win: ${parts.join('; ')}`;
      detail = 'The fewest active knights pay; a pillaged city becomes a settlement';
    }
  } else {
    const defender = ids.filter((p) => (ca.players[p]?.defenders ?? 0) > (before.ck?.players[p]?.defenders ?? 0));
    if (defender.length === 1) {
      outcome = `Catan is saved! ${list(defender)} ${defender[0] === seat ? 'are' : 'is'} the Defender of Catan`;
      detail = '+1 victory point';
    } else {
      const most = Math.max(...b.perPlayer);
      const top = ids.filter((p) => b.perPlayer[p] === most);
      outcome = top.length > 1 ? `Catan is saved! ${list(top)} tie as its best defenders` : 'Catan is saved!';
      detail = top.length > 1 ? 'Each draws a progress card of their choice' : 'No Defender of Catan card is left';
    }
  }
  return { kind: 'attack', barbarians: b.barbarians, knights: b.knights, perPlayer: b.perPlayer.slice(0, n), won, outcome, detail };
}

/** Progress cards drawn in this move (the event die's city gates, or a tied defender's draw). */
function drawsFx(action: Action, before: GameView, after: GameView): FxEvent | null {
  const cb = before.ck;
  const ca = after.ck;
  if (!cb || !ca) return null;
  const rolled = action.type === 'rollDice' || (action.type === 'playProgress' && action.card === 'alchemist');
  const gate = rolled && ca.event && ca.event !== 'ship' ? ca.event : null;
  const deckOf = action.type === 'drawProgress' ? action.deck : gate;
  if (!deckOf) return null;
  const draws: ProgressDraw[] = [];
  for (const pl of after.players) {
    const was = cb.players[pl.id];
    const now = ca.players[pl.id];
    if (!was || !now) continue;
    // VP cards are public
    for (const c of now.vpCards.slice(was.vpCards.length)) draws.push({ p: pl.id, deck: PROGRESS_CARDS[c]?.deck ?? deckOf, card: c });
    const more = now.progressCount - was.progressCount;
    if (more <= 0) continue;
    // your own new cards: what is in the hand now that wasn't before
    const left = [...(was.progress ?? [])];
    const fresh = (now.progress ?? []).filter((c) => {
      const i = left.indexOf(c);
      if (i >= 0) {
        left.splice(i, 1);
        return false;
      }
      return true;
    });
    for (let i = 0; i < more; i++) draws.push({ p: pl.id, deck: fresh[i] ? PROGRESS_CARDS[fresh[i]].deck : deckOf, card: fresh[i] ?? null });
  }
  return draws.length > 0 ? { kind: 'draw', draws } : null;
}

/** The event a move should show, if any; `before` is the view just before it. */
export function fxFor(action: Action, before: GameView, after: GameView, seat: PlayerId | null): FxEvent | null {
  if (after.ck && before.ck) {
    if (after.ck.attacks > before.ck.attacks) return attackFx(before, after, seat);
    if (action.type === 'rollDice' || action.type === 'drawProgress' || (action.type === 'playProgress' && action.card === 'alchemist')) {
      const d = drawsFx(action, before, after);
      if (d) return d;
    }
    if (action.type === 'playProgress') {
      const { target, detail } = playedFx(action, before, seat);
      return { kind: 'progPlay', by: action.player, card: action.card, ...(target !== undefined ? { target } : {}), detail };
    }
    if (action.type === 'improveCity') {
      const level = after.ck.players[action.player]?.improvements[action.track] ?? 0;
      return { kind: 'improve', by: action.player, track: action.track, level, metropolis: action.vertex !== undefined };
    }
  }
  switch (action.type) {
    case 'bankTrade':
      return { kind: 'trade', a: action.player, b: 'bank', give: action.give, get: action.get };
    case 'confirmTrade': {
      const t = before.turn.trades.find((x) => x.id === action.tradeId);
      return t ? { kind: 'trade', a: t.from, b: action.partner, give: t.give, get: t.get } : null;
    }
    case 'acceptTrade': {
      // only a counter-offer taken by the active player trades at once
      const t = before.turn.trades.find((x) => x.id === action.tradeId);
      if (!t || after.turn.trades.some((x) => x.id === t.id)) return null;
      return { kind: 'trade', a: t.from, b: action.player, give: t.give, get: t.get };
    }
    case 'buyDevCard':
      return { kind: 'devBuy', by: action.player, card: seat === action.player ? newCard(before, after, action.player) : null };
    default: {
      const card = PLAYS[action.type];
      if (!card) return null;
      let detail = DEV_INFO[card].text;
      if (action.type === 'playMonopoly') detail = `Takes every ${RESOURCE_INFO[action.resource].label.toLowerCase()} card.`;
      if (action.type === 'playYearOfPlenty') detail = `Takes ${action.resources.map((r) => RESOURCE_INFO[r].label.toLowerCase()).join(' and ')} from the bank.`;
      return { kind: 'devPlay', by: action.player, card, detail };
    }
  }
}
