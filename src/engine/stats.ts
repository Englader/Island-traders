import { COMMODITIES, RESOURCES, TERRAIN_RESOURCE } from '../core/constants.js';
import { emptyCounts } from '../core/resources.js';
import type { Action, Commodity, GameState, GameStats, PartialCounts, PlayerId, PlayerStats } from '../core/types.js';
import { topo, totalVP } from '../rules/queries.js';

/**
 * End-of-game statistics. applyAction calls `recordStats` after every
 * successful action. Most counters come from how each hand changed during
 * the action, sorted by the kind of action; dice production is noted exactly
 * as it is dealt (`noteProduction`). Games saved before statistics existed
 * have no `stats` and are left alone.
 */
export function emptyStats(players: number): GameStats {
  return { players: Array.from({ length: players }, emptyPlayerStats) };
}

function emptyPlayerStats(): PlayerStats {
  return {
    produced: emptyCounts(),
    expected36: 0,
    tradeIn: 0,
    tradeOut: 0,
    bankIn: 0,
    bankOut: 0,
    stole: 0,
    stolen: 0,
    discarded: 0,
    lost: 0,
    spent: 0,
    other: 0,
    trades: 0,
    bankTrades: 0,
    devBought: 0,
    devPlayed: 0,
    knights: 0,
    vp: [],
  };
}

/** Ways to roll each total with two dice (out of 36). */
const WAYS = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1];

/** Each player's expected cards per roll in 36ths, from the buildings on the board (robbed hexes excluded). */
function expectedPerRoll(s: GameState): number[] {
  const out = s.players.map(() => 0);
  const t = topo(s);
  for (const [id, hex] of Object.entries(s.board.hexes)) {
    if (hex.token === null || id === s.board.robber) continue;
    if (!TERRAIN_RESOURCE[hex.terrain] && hex.terrain !== 'gold') continue;
    for (const v of t.hexVertices[id]) {
      const b = s.board.buildings[v];
      if (b) out[b.owner] += (b.type === 'city' ? 2 : 1) * (WAYS[hex.token] ?? 0);
    }
  }
  return out;
}

/** Cities & Knights: the commodities a roll dealt. */
export function noteCommodityProduction(s: GameState, dealt: Record<number, Partial<Record<Commodity, number>>>): void {
  if (!s.stats) return;
  for (const [p, got] of Object.entries(dealt)) {
    const produced = (s.stats.players[Number(p)].producedCommodities ??= { paper: 0, cloth: 0, coin: 0 });
    for (const k of COMMODITIES) produced[k] += got[k] ?? 0;
  }
}

/** Called with the cards a roll dealt, as they are dealt. */
export function noteProduction(s: GameState, dealt: Record<number, PartialCounts>): void {
  if (!s.stats) return;
  for (const [p, got] of Object.entries(dealt)) {
    const produced = s.stats.players[Number(p)].produced;
    for (const r of RESOURCES) produced[r] += got[r] ?? 0;
  }
}

type Bucket = 'other' | 'tradeIn' | 'tradeOut' | 'bankIn' | 'bankOut' | 'stole' | 'stolen' | 'discarded' | 'lost' | 'spent';

/** Updates `next.stats` for the action that turned `prev` into `next`. */
export function recordStats(prev: GameState, next: GameState, a: Action): void {
  const st = next.stats;
  const before = prev.stats;
  if (!st || !before || st.players.length !== next.players.length) return;
  const n = next.players.length;
  const actor: PlayerId = a.player;

  // Cards each player gained and lost in this action, dice production aside.
  const gain: number[] = [];
  const loss: number[] = [];
  const gained: PartialCounts[] = [];
  for (let p = 0; p < n; p++) {
    let g = 0;
    let l = 0;
    const by: PartialCounts = {};
    for (const r of RESOURCES) {
      const dealt = st.players[p].produced[r] - before.players[p].produced[r];
      const d = next.players[p].resources[r] - prev.players[p].resources[r] - dealt;
      if (d > 0) {
        g += d;
        by[r] = d;
      } else l -= d;
    }
    // Cities & Knights: commodity cards move like resources (production aside).
    if (next.ck && prev.ck) {
      const now = st.players[p].producedCommodities;
      const was = before.players[p].producedCommodities;
      for (const k of COMMODITIES) {
        const dealt = (now?.[k] ?? 0) - (was?.[k] ?? 0);
        const d = next.ck.players[p].commodities[k] - prev.ck.players[p].commodities[k] - dealt;
        if (d > 0) g += d;
        else l -= d;
      }
    }
    gain.push(g);
    loss.push(l);
    gained.push(by);
  }
  // Cities & Knights: a progress card's effect (a choice answered for it counts for the card's player).
  const ph = prev.phase;
  const answered = a.type === 'progressChoice' && ph.kind === 'ck' && ph.step === 'card';
  const card = a.type === 'playProgress' ? a.card : answered ? ph.card : a.type === 'progressChoice' ? a.args?.card : undefined;
  const taker: PlayerId = answered ? ph.player : actor;
  const othersLost = loss.reduce((sum, l, p) => (p === taker ? sum : sum + l), 0);

  for (let p = 0; p < n; p++) {
    const ps = st.players[p];
    let g = gain[p];
    let gainTo: Bucket = 'other';
    let lossTo: Bucket = 'lost';
    switch (a.type) {
      case 'chooseGold':
        // gold-field picks are production (the free picks of the setup are starting resources)
        if (p === actor && prev.turn.number > 0) {
          for (const r of RESOURCES) ps.produced[r] += gained[p][r] ?? 0;
          g = 0;
        }
        break;
      case 'discard':
        lossTo = 'discarded';
        break;
      case 'acceptTrade':
      case 'confirmTrade':
        gainTo = 'tradeIn';
        lossTo = 'tradeOut';
        if (gain[p] + loss[p] > 0) ps.trades++;
        break;
      case 'bankTrade':
        gainTo = 'bankIn';
        lossTo = 'bankOut';
        if (p === actor) ps.bankTrades++;
        break;
      case 'moveRobber':
      case 'playMonopoly':
      case 'playProgress':
      case 'progressChoice':
      case 'scenario':
        if (card === 'commercialHarbor') {
          gainTo = 'tradeIn';
          lossTo = 'tradeOut';
          if (gain[p] + loss[p] > 0) ps.trades++;
          break;
        }
        if (card === 'saboteur') {
          lossTo = 'discarded';
          break;
        }
        // cards the actor (or the card's player) took from the others
        if (othersLost > 0 && othersLost <= gain[taker]) {
          if (p === taker) {
            ps.stole += othersLost;
            g -= othersLost;
          } else lossTo = 'stolen';
        }
        if (p === taker) lossTo = 'spent';
        break;
      case 'buildRoad':
      case 'buildShip':
      case 'buildSettlement':
      case 'buildCity':
      case 'buyDevCard':
      case 'buildKnight':
      case 'activateKnight':
      case 'promoteKnight':
      case 'buildCityWall':
      case 'improveCity':
        lossTo = 'spent';
        break;
      default:
        break;
    }
    ps[gainTo] += g;
    ps[lossTo] += loss[p];
  }

  const me = st.players[actor];
  const rolled = () => {
    const exp = expectedPerRoll(prev);
    for (let p = 0; p < n; p++) st.players[p].expected36 += exp[p];
  };
  switch (a.type) {
    case 'rollDice':
      rolled();
      break;
    case 'playProgress':
      // Cities & Knights: progress cards count as played cards; the Alchemist's dice are a roll
      me.devPlayed++;
      if (a.card === 'alchemist') rolled();
      break;
    case 'buyDevCard':
      me.devBought++;
      break;
    case 'playKnight':
      me.knights++;
      me.devPlayed++;
      break;
    case 'playRoadBuilding':
    case 'playYearOfPlenty':
    case 'playMonopoly':
      me.devPlayed++;
      break;
    default:
      break;
  }

  // VP after each turn (a new turn has begun), and the final score.
  const ended = next.phase.kind === 'gameOver' && prev.phase.kind !== 'gameOver';
  if (next.turn.number > prev.turn.number) for (let p = 0; p < n; p++) st.players[p].vp.push(totalVP(next, p));
  if (ended) for (let p = 0; p < n; p++) st.players[p].vp.push(totalVP(next, p));
}
