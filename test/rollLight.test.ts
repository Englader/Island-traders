import { describe, expect, it } from 'vitest';
import {
  COMMODITIES,
  RESOURCES,
  TERRAIN_COMMODITY,
  TERRAIN_RESOURCE,
  applyAction,
  createGame,
  payingVillages,
  producingHexes,
  seedRng,
  simulate,
  topo,
  viewFor,
  type Card,
  type GameConfig,
  type GameState,
  type HexId,
  type Phase,
  type PlayerId,
  type VertexId,
} from '../src/index.js';
import { NO_LIGHT, rollLight } from '../web/src/game/rollLight.js';
import { C, H, act, blank, put, setHex, withDice } from './helpers.js';

/**
 * Only the tiles that pay out on a roll light up (web/src/game/rollLight.ts,
 * `producingHexes` in src/rules/production.ts): the number came up, the
 * robber is elsewhere, a settlement or city touches the tile and the bank
 * could pay.
 */

/** (0,0) forest 8, (1,0) hills 8, (1,-1) mountains 5, (-1,0) pasture 6, (-1,1) fields 3; every other number is a 12. */
function board(ck = false): GameState {
  const s = blank('base', 3, ck ? { citiesAndKnights: true } : {});
  for (const h of Object.values(s.board.hexes)) if (h.token !== null) h.token = 12;
  setHex(s, 0, 0, 'forest', 8);
  setHex(s, 1, 0, 'hills', 8);
  setHex(s, 1, -1, 'mountains', 5);
  setHex(s, -1, 0, 'pasture', 6);
  setHex(s, -1, 1, 'fields', 3);
  s.board.robber = H(2, -2);
  s.phase = { kind: 'preRoll' };
  return s;
}

// C(0,0,0) touches the forest, the hills and the mountains; C(0,0,3) the forest, the pasture and the fields.
const NE = C(0, 0, 0);
const W = C(0, 0, 3);

const sorted = (xs: Iterable<string>) => [...xs].sort();
const lit = (s: GameState, roll: number) => sorted(producingHexes(s, roll));
const rollOf = (s: GameState) => s.turn.dice![0] + s.turn.dice![1];

function roll(s: GameState, a: number, b: number): GameState {
  return act(withDice(s, a, b), { type: 'rollDice', player: 0 });
}

describe('the tiles a roll pays out from', () => {
  it('a tile with the number but no settlement or city stays dark', () => {
    const s = board();
    setHex(s, -1, 0, 'pasture', 8); // nobody next to it
    put(s, NE, 0);
    expect(lit(s, 8)).toEqual(sorted([H(0, 0), H(1, 0)]));
    expect(lit(s, 6)).toEqual([]);
    expect(lit(s, 3)).toEqual([]);
    const after = roll(s, 4, 4);
    expect(after.players[0].resources).toMatchObject({ lumber: 1, brick: 1 });
    expect(after.players.every((p) => p.resources.wool === 0)).toBe(true);
  });

  it("the robber's tile stays dark (and the screen says the robber blocked it)", () => {
    const s = board();
    put(s, NE, 0);
    s.board.robber = H(0, 0);
    expect(lit(s, 8)).toEqual([H(1, 0)]);
    const after = roll(s, 4, 4);
    expect(after.players[0].resources).toMatchObject({ lumber: 0, brick: 1 });
    expect(rollLight(viewFor(s, 1), viewFor(after, 1))).toEqual({ hexes: [H(1, 0)], villages: [], blocked: H(0, 0) });
    // a robber on a tile nobody touches blocked nothing
    s.board.robber = H(-1, 0);
    setHex(s, -1, 0, 'pasture', 8);
    expect(rollLight(viewFor(s, 1), viewFor(roll(s, 4, 4), 1)).blocked).toBe(null);
  });

  it('bank shortage: when the bank cannot pay every player owed a resource, its tiles stay dark', () => {
    const s = board();
    put(s, NE, 0);
    put(s, W, 1, 'city');
    s.bank.lumber = 2; // 1 + 2 owed
    expect(lit(s, 8)).toEqual([H(1, 0)]);
    const after = roll(s, 4, 4);
    expect(after.players[0].resources).toMatchObject({ lumber: 0, brick: 1 });
    expect(after.players[1].resources.lumber).toBe(0);
    // with enough lumber the forest pays both
    s.bank.lumber = 3;
    expect(lit(s, 8)).toEqual(sorted([H(0, 0), H(1, 0)]));
  });

  it('bank shortage: a single player owed a resource takes what is left, so the tile lights', () => {
    const s = board();
    put(s, NE, 0, 'city');
    s.bank.lumber = 1; // 2 owed
    expect(lit(s, 8)).toEqual(sorted([H(0, 0), H(1, 0)]));
    expect(roll(s, 4, 4).players[0].resources.lumber).toBe(1);
    // nothing left at all: dark
    s.bank.lumber = 0;
    expect(lit(s, 8)).toEqual([H(1, 0)]);
    expect(roll(s, 4, 4).players[0].resources.lumber).toBe(0);
  });

  it('gold fields light up: they pay free picks', () => {
    const s = board();
    setHex(s, 0, 0, 'gold', 8);
    put(s, NE, 0);
    expect(lit(s, 8)).toEqual(sorted([H(0, 0), H(1, 0)]));
    expect(roll(s, 4, 4).phase).toMatchObject({ kind: 'gold', pending: { 0: 1 } });
  });

  it('gold stays dark when the roll leaves the bank empty: the picks lapse', () => {
    const s = board();
    setHex(s, 0, 0, 'gold', 8);
    put(s, NE, 0);
    for (const r of RESOURCES) s.bank[r] = 0;
    s.bank.brick = 1; // the hills take the last card
    expect(lit(s, 8)).toEqual([H(1, 0)]);
    const after = roll(s, 4, 4);
    expect(after.phase.kind).toBe('main');
    expect(after.log.some((e) => /gold choices lapse/.test(e.msg))).toBe(true);
  });

  it('fog, desert and sea never pay', () => {
    const s = board();
    setHex(s, 0, 0, 'fog', 8);
    setHex(s, 1, -1, 'desert', 8);
    put(s, NE, 0);
    expect(lit(s, 8)).toEqual([H(1, 0)]);
    const after = roll(s, 4, 4);
    expect(after.players[0].resources).toMatchObject({ lumber: 0, brick: 1, ore: 0 });
    expect(after.phase.kind).toBe('main');
  });

  it('nothing lights on a 7', () => {
    const s = board();
    for (const h of [H(0, 0), H(1, 0)]) s.board.hexes[h].token = 7;
    put(s, NE, 0);
    expect(lit(s, 7)).toEqual([]);
    const after = roll(s, 3, 4);
    expect(rollLight(viewFor(s, 0), viewFor(after, 0))).toEqual(NO_LIGHT);
  });

  it('Cities & Knights: a city on forest takes paper, so its forest lights even when the lumber runs short', () => {
    const s = board(true);
    put(s, NE, 0, 'city');
    put(s, W, 1);
    s.bank.lumber = 1; // 2 owed, to two players: nobody gets lumber
    expect(lit(s, 8)).toEqual(sorted([H(0, 0), H(1, 0)]));
    const after = roll(s, 4, 4);
    expect(after.players[0].resources).toMatchObject({ lumber: 0, brick: 2 });
    expect(after.ck!.players[0].commodities.paper).toBe(1);
    expect(after.players[1].resources.lumber).toBe(0);
    // no paper either: the forest stays dark
    s.ck!.bank.paper = 0;
    expect(lit(s, 8)).toEqual([H(1, 0)]);
  });

  it('Cities & Knights: commodities alone light their tile', () => {
    const s = board(true);
    put(s, NE, 0, 'city');
    s.bank.ore = 0;
    s.ck!.bank.coin = 1;
    // the mountains (5) pay the city a coin but no ore
    expect(lit(s, 5)).toEqual([H(1, -1)]);
    const after = roll(s, 2, 3);
    expect(after.players[0].resources.ore).toBe(0);
    expect(after.ck!.players[0].commodities.coin).toBe(1);
  });
});

describe('Cloth for Catan: villages that pay cloth light up', () => {
  type Cloth = { villages: Record<string, { token: number; cloth: number; traders: number[] }>; general: number; cloth: number[] };
  const clothOf = (s: GameState) => s.ext.cloth as Cloth;

  it('a village pays on its number once someone has reached it, while it has cloth', () => {
    const s = blank('seafarers-6-cloth-trade', 3);
    s.phase = { kind: 'preRoll' };
    const villages = clothOf(s).villages;
    const village = Object.keys(villages).find((v) => villages[v].token === 8)!;
    // nobody has reached it yet
    expect(payingVillages(s.ext, 8)).toEqual([]);
    villages[village].traders.push(1);
    expect(payingVillages(s.ext, 8)).toEqual([village]);
    expect(payingVillages(s.ext, 7)).toEqual([]);
    const after = roll(s, 4, 4);
    expect(clothOf(after).cloth[1]).toBe(1);
    expect(rollLight(viewFor(s, 2), viewFor(after, 2)).villages).toEqual([village]);
    // out of cloth: it pays no more (not even from the general supply)
    villages[village].cloth = 0;
    expect(payingVillages(s.ext, 8)).toEqual([]);
    expect(clothOf(roll(s, 4, 4)).cloth[1]).toBe(0);
  });

  it('other scenarios have no villages', () => {
    expect(payingVillages(board().ext, 8)).toEqual([]);
  });
});

describe('the roll as the screen sees it', () => {
  it('works from the bank before the roll: the bank after it may be empty because the roll emptied it', () => {
    const s = board();
    put(s, NE, 0);
    put(s, W, 1, 'city');
    s.bank.lumber = 3; // exactly enough
    const after = roll(s, 4, 4);
    expect(after.bank.lumber).toBe(0);
    // after the roll alone it looks like a shortage; the bank before the roll says otherwise
    expect(lit(after, 8)).toEqual([H(1, 0)]);
    expect(sorted(rollLight(viewFor(s, 2), viewFor(after, 2)).hexes)).toEqual(sorted([H(0, 0), H(1, 0)]));
    // a screen that opens after the roll puts the roll's cards back
    expect(sorted(rollLight(null, viewFor(after, 2)).hexes)).toEqual(sorted([H(0, 0), H(1, 0)]));
  });

  it('every seat sees the same tiles: only public information is used', () => {
    const s = board();
    put(s, NE, 0);
    put(s, W, 1, 'city');
    s.bank.lumber = 2;
    const after = roll(s, 4, 4);
    const seen = [0, 1, 2, null].map((p) => rollLight(viewFor(s, p), viewFor(after, p)));
    for (const x of seen) expect(x).toEqual({ hexes: [H(1, 0)], villages: [], blocked: null });
  });
});

// --- a property: the tiles lit are the tiles that paid --------------------------------

/** Cards each player was dealt by production in the move from `pre` to `post` (from the statistics). */
function dealtOf(pre: GameState, post: GameState): Array<Partial<Record<Card, number>>> {
  return post.players.map((_, p) => {
    const a = pre.stats!.players[p];
    const b = post.stats!.players[p];
    const got: Partial<Record<Card, number>> = {};
    for (const r of RESOURCES) if (b.produced[r] > a.produced[r]) got[r] = b.produced[r] - a.produced[r];
    for (const k of COMMODITIES) {
      const n = (b.producedCommodities?.[k] ?? 0) - (a.producedCommodities?.[k] ?? 0);
      if (n > 0) got[k] = n;
    }
    return got;
  });
}

/** The tiles that contributed to what was dealt: a building on them got one of their cards (or a gold pick). */
function paidHexes(pre: GameState, post: GameState): HexId[] {
  const roll = rollOf(post);
  const dealt = dealtOf(pre, post);
  const picks = post.phase.kind === 'gold' ? post.phase.pending : {};
  const t = topo(post);
  const out: HexId[] = [];
  for (const [id, hex] of Object.entries(post.board.hexes)) {
    if (hex.token !== roll || id === post.board.robber) continue;
    const res = TERRAIN_RESOURCE[hex.terrain];
    if (!res && hex.terrain !== 'gold') continue;
    const com = post.ck ? TERRAIN_COMMODITY[hex.terrain] : undefined;
    const paid = t.hexVertices[id].some((v) => {
      const b = post.board.buildings[v];
      if (!b) return false;
      if (!res) return (picks[b.owner] ?? 0) > 0;
      const kinds: Card[] = b.type === 'city' && com ? [res, com] : [res];
      return kinds.some((k) => (dealt[b.owner][k] ?? 0) > 0);
    });
    if (paid) out.push(id);
  }
  return sorted(out);
}

/** The banks as production found them: what is left plus what it dealt. */
function bankBefore(pre: GameState, post: GameState) {
  const bank = { ...post.bank };
  const ck = post.ck ? { bank: { ...post.ck.bank } } : undefined;
  dealtOf(pre, post).forEach((got) => {
    for (const r of RESOURCES) bank[r] += got[r] ?? 0;
    if (ck) for (const k of COMMODITIES) ck.bank[k] += got[k] ?? 0;
  });
  return { board: post.board, bank, ck };
}

function villagesPaid(pre: GameState, post: GameState): VertexId[] {
  const a = (pre.ext.cloth as { villages: Record<string, { cloth: number }> } | undefined)?.villages ?? {};
  const b = (post.ext.cloth as { villages: Record<string, { cloth: number }> } | undefined)?.villages ?? {};
  return sorted(Object.keys(a).filter((v) => b[v].cloth < a[v].cloth));
}

/** Cities & Knights: production waits while players pillage, draw or discard after the event die. */
function productionWaits(ph: Phase): boolean {
  for (let p: Phase | undefined = ph; p; p = 'resume' in p ? (p.resume as Phase) : undefined) {
    if (p.kind === 'ck' && p.step === 'production') return true;
  }
  return false;
}

interface Tally {
  rolls: number;
  lit: number;
  dark: number;
  short: number;
  gold: number;
  commodity: number;
  villages: number;
  blocked: number;
  raids: number;
  attacks: number;
}

/** Checks one roll (the move from `pre` to `post`) both ways: the engine's helper and the screen's. */
function check(pre: GameState, post: GameState, tally: Tally, label: string): void {
  if ((post.rolls?.length ?? 0) <= (pre.rolls?.length ?? 0) || productionWaits(post.phase)) return;
  // a game won on the roll never asks for its gold picks
  if (post.phase.kind === 'gameOver') return;
  const roll = rollOf(post);
  const seat: PlayerId = (post.turn.current + 1) % post.players.length;
  const view = rollLight(viewFor(pre, seat), viewFor(post, seat));
  if (roll === 7) {
    expect(view, label).toEqual(NO_LIGHT);
    return;
  }
  tally.rolls++;
  const expected = paidHexes(pre, post);
  expect(sorted(producingHexes(bankBefore(pre, post), roll)), label).toEqual(expected);
  expect(sorted(payingVillages(pre.ext, roll)), label).toEqual(villagesPaid(pre, post));
  const fresh = post.log.slice(pre.log.length).map((e) => e.msg);
  // A Pirate Islands raid on this roll returns cards to the bank just before production, out of the views' sight.
  const raid = fresh.some((m) => /raids/.test(m));
  if (raid) tally.raids++;
  else expect(sorted(view.hexes), label).toEqual(expected);
  expect(sorted(view.villages), label).toEqual(villagesPaid(pre, post));
  // the tally: which rules came up
  const numbered = Object.entries(post.board.hexes).filter(
    ([id, h]) => h.token === roll && id !== post.board.robber && topo(post).hexVertices[id].some((v) => post.board.buildings[v]),
  );
  tally.lit += expected.length;
  tally.dark += Object.values(post.board.hexes).filter((h) => h.token === roll).length - expected.length;
  if (numbered.some(([id]) => !expected.includes(id))) tally.short++;
  if (expected.some((id) => post.board.hexes[id].terrain === 'gold')) tally.gold++;
  if (fresh.some((m) => /receives .*(paper|cloth|coin)/.test(m))) tally.commodity++;
  if (view.villages.length > 0) tally.villages++;
  if (view.blocked) tally.blocked++;
  // Cities & Knights: the barbarians landed before production (a city pillaged, the robber woken)
  if (fresh.some((m) => /barbarians attack/.test(m))) tally.attacks++;
}

const GAMES: Array<{ name: string; config: Omit<GameConfig, 'seed'> }> = [
  { name: 'base, 4 players', config: { scenario: 'base', players: 4 } },
  { name: 'Cities & Knights, 3 players', config: { scenario: 'base', players: 3, options: { citiesAndKnights: true } } },
  { name: 'Heading for New Shores', config: { scenario: 'seafarers-1-new-shores', players: 4 } },
  { name: 'The Fog Islands', config: { scenario: 'seafarers-3-fog-islands', players: 3 } },
  { name: 'Cloth for Catan', config: { scenario: 'seafarers-6-cloth-trade', players: 4 } },
  { name: 'The Pirate Islands', config: { scenario: 'seafarers-7-pirate-islands', players: 4 } },
  { name: 'Cloth for Catan + C&K', config: { scenario: 'seafarers-6-cloth-trade', players: 3, options: { citiesAndKnights: true } } },
  { name: 'New Shores + C&K', config: { scenario: 'seafarers-1-new-shores', players: 4, options: { citiesAndKnights: true } } },
];

describe('the tiles lit are exactly the tiles that paid, over random games', () => {
  for (const g of GAMES) {
    it(g.name, () => {
      const tally: Tally = { rolls: 0, lit: 0, dark: 0, short: 0, gold: 0, commodity: 0, villages: 0, blocked: 0, raids: 0, attacks: 0 };
      const waiting: GameState[] = [];
      for (const seed of [1, 2]) {
        let pre = createGame({ ...g.config, seed: `roll-light-${seed}` });
        simulate(pre, seedRng(`roll-light-${g.name}-${seed}`), g.config.options?.citiesAndKnights ? 1200 : 2500, (post) => {
          check(pre, post, tally, `${g.name} #${seed}, turn ${post.turn.number}`);
          if (post.phase.kind === 'preRoll') waiting.push(post);
          pre = post;
        });
      }
      // The same positions with a nearly empty bank and other dice (shortages, lapsed gold picks),
      // and now and then a building on a gold field whose number comes up.
      waiting.forEach((s, i) => {
        if (i % 3 !== 0) return;
        const pre = structuredClone(s);
        RESOURCES.forEach((r, k) => (pre.bank[r] = (i + k * 3) % 4));
        if (pre.ck) COMMODITIES.forEach((c, k) => (pre.ck!.bank[c] = (i + k) % 3));
        pre.rng = { s: 1000 + i * 37 };
        const gold = Object.keys(pre.board.hexes).filter((h) => pre.board.hexes[h].terrain === 'gold' && pre.board.hexes[h].token && h !== pre.board.robber);
        const v = gold.length > 0 && i % 2 === 0 ? topo(pre).hexVertices[gold[i % gold.length]].find((x) => !pre.board.buildings[x]) : undefined;
        if (v) {
          pre.board.buildings[v] = { owner: pre.turn.actor, type: i % 4 === 0 ? 'city' : 'settlement' };
          const token = pre.board.hexes[gold[i % gold.length]].token!;
          withDice(pre, Math.max(1, token - 6), Math.min(6, token - 1));
        }
        const r = applyAction(pre, { type: 'rollDice', player: pre.turn.actor });
        if (r.ok) check(pre, r.state, tally, `${g.name}, low bank, position ${i}`);
      });
      // every rule came up
      expect(tally.rolls).toBeGreaterThan(50);
      expect(tally.lit).toBeGreaterThan(0);
      expect(tally.dark).toBeGreaterThan(0);
      expect(tally.short).toBeGreaterThan(0);
      if (g.config.scenario !== 'seafarers-7-pirate-islands') expect(tally.blocked).toBeGreaterThan(0);
      if (/new-shores|fog-islands|pirate-islands/.test(g.config.scenario)) expect(tally.gold).toBeGreaterThan(0);
      if (g.config.options?.citiesAndKnights) expect(tally.commodity).toBeGreaterThan(0);
      if (g.config.options?.citiesAndKnights) expect(tally.attacks).toBeGreaterThan(0);
      if (g.config.scenario === 'seafarers-6-cloth-trade') expect(tally.villages).toBeGreaterThan(0);
    });
  }
});
