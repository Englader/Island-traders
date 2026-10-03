import { getTopologyFor } from '../board/topology.js';
import { TERRAIN_COMMODITY } from '../ck/constants.js';
import { RESOURCES, TERRAIN_RESOURCE } from '../core/constants.js';
import { isResource } from '../core/resources.js';
import type { BoardState, Card, CommodityCounts, GameState, HexId, PlayerId, Resource, ResourceCounts } from '../core/types.js';
import { log, nameOf } from './helpers.js';
import { topo } from './queries.js';

export interface ProductionResult {
  /** Cards dealt per player. */
  dealt: Record<number, Partial<Record<Resource, number>>>;
  /** Resources nobody received because the bank ran short. */
  shortages: Resource[];
  /** Free choices owed from gold fields. */
  gold: Record<number, number>;
}

/**
 * What production reads, all of it public: a GameState fits, and so does any
 * seat's GameView (so a guest's screen works it out as the host's engine does).
 */
export interface ProductionSource {
  board: Pick<BoardState, 'layoutKey' | 'hexes' | 'buildings' | 'robber'>;
  bank: ResourceCounts;
  /** Cities & Knights: the commodity bank (and cities take commodities). */
  ck?: { bank: CommodityCounts };
}

/** One building's share of a hex on a roll: `n` cards of `card`, or `n` free picks from a gold field. */
export interface Claim {
  hex: HexId;
  owner: PlayerId;
  card: Card | 'gold';
  n: number;
}

/**
 * Everything a roll of `roll` (not 7) claims from the bank, hex by hex. Every
 * hex showing the number, unless the robber sits on it, pays 1 card per
 * adjacent settlement and 2 per city; in Cities & Knights a city on forest,
 * pasture or mountains takes 1 resource and 1 commodity instead (p. 5). Gold
 * fields pay the same amounts as free picks. Fog, desert and sea pay nothing.
 */
export function productionClaims(s: ProductionSource, roll: number): Claim[] {
  const t = getTopologyFor(s.board.layoutKey);
  const out: Claim[] = [];
  for (const id of Object.keys(s.board.hexes)) {
    const hex = s.board.hexes[id];
    if (hex.token !== roll || id === s.board.robber) continue;
    const res = TERRAIN_RESOURCE[hex.terrain];
    if (!res && hex.terrain !== 'gold') continue;
    const com = s.ck ? TERRAIN_COMMODITY[hex.terrain] : undefined;
    for (const v of t.hexVertices[id]) {
      const b = s.board.buildings[v];
      if (!b) continue;
      const city = b.type === 'city';
      if (!res) {
        out.push({ hex: id, owner: b.owner, card: 'gold', n: city ? 2 : 1 });
      } else if (city && com) {
        out.push({ hex: id, owner: b.owner, card: res, n: 1 }, { hex: id, owner: b.owner, card: com, n: 1 });
      } else {
        out.push({ hex: id, owner: b.owner, card: res, n: city ? 2 : 1 });
      }
    }
  }
  return out;
}

/**
 * The bank-shortage rule for one kind of card: if the bank (holding `have`)
 * cannot cover what every player is `owed`, nobody receives it, except when
 * only one player is owed it, who then gets whatever is left. Returns the
 * amounts paid (none of them 0) and whether some of the claim went unpaid.
 */
export function shareOut(owed: Map<PlayerId, number>, have: number): { paid: Array<[PlayerId, number]>; short: boolean } {
  let need = 0;
  for (const n of owed.values()) need += n;
  if (need <= have) return { paid: [...owed.entries()], short: false };
  if (owed.size !== 1) return { paid: [], short: true };
  const [[p, n]] = [...owed.entries()];
  const give = Math.min(n, have);
  return { paid: give > 0 ? [[p, give]] : [], short: true };
}

/**
 * The hexes that pay out on a roll of `roll`, given the board and the banks as
 * production finds them (`produce`, and Cities & Knights' `produceCards`, deal
 * from the same claims under the same shortage rule). A hex pays when it shows
 * the number, the robber is not on it, a settlement or city touches it and at
 * least one of its cards gets through the bank-shortage rule. A gold field
 * pays its free picks, unless the bank holds no resource at all once the
 * roll's cards are dealt (the picks then lapse). Nothing pays on a 7.
 * In hex order, without repeats.
 */
export function producingHexes(s: ProductionSource, roll: number): HexId[] {
  if (roll === 7) return [];
  const claims = productionClaims(s, roll);
  const bank: Partial<Record<Card, number>> = { ...s.bank, ...s.ck?.bank };
  const owed = new Map<Card, Map<PlayerId, number>>();
  for (const c of claims) {
    if (c.card === 'gold') continue;
    const m = owed.get(c.card) ?? new Map<PlayerId, number>();
    m.set(c.owner, (m.get(c.owner) ?? 0) + c.n);
    owed.set(c.card, m);
  }
  const paidTo = new Map<Card, Set<PlayerId>>();
  let resourcesLeft = 0;
  for (const r of RESOURCES) resourcesLeft += s.bank[r];
  for (const [k, m] of owed) {
    const { paid } = shareOut(m, bank[k] ?? 0);
    paidTo.set(k, new Set(paid.map(([p]) => p)));
    if (isResource(k)) for (const [, n] of paid) resourcesLeft -= n;
  }
  const lit = new Set<HexId>();
  for (const c of claims) {
    if (c.card === 'gold' ? resourcesLeft > 0 : paidTo.get(c.card)!.has(c.owner)) lit.add(c.hex);
  }
  return [...lit];
}

/**
 * Resource production for a roll of `roll` (not 7).
 *
 * Every hex showing the number, unless the robber sits on it, pays 1 card per
 * adjacent settlement and 2 per city (`productionClaims`). Demand is totalled
 * per resource before dealing: if the bank cannot cover a resource, nobody
 * receives it, except when only one player is owed it, who then gets whatever
 * is left (`shareOut`). Gold fields pay the same amounts as free choices,
 * resolved afterwards.
 */
export function produce(state: GameState, roll: number, onlyHexes?: HexId[]): ProductionResult {
  const only = onlyHexes ? new Set(onlyHexes) : null;
  const demand: Record<Resource, Map<PlayerId, number>> = {
    brick: new Map(),
    lumber: new Map(),
    wool: new Map(),
    grain: new Map(),
    ore: new Map(),
  };
  const gold: Record<number, number> = {};
  for (const c of productionClaims(state, roll)) {
    if (only && !only.has(c.hex)) continue;
    if (c.card === 'gold') gold[c.owner] = (gold[c.owner] ?? 0) + c.n;
    else demand[c.card as Resource].set(c.owner, (demand[c.card as Resource].get(c.owner) ?? 0) + c.n);
  }

  const dealt: ProductionResult['dealt'] = {};
  const shortages: Resource[] = [];
  for (const r of RESOURCES) {
    const owed = demand[r];
    if (owed.size === 0) continue;
    const { paid, short } = shareOut(owed, state.bank[r]);
    for (const [p, n] of paid) {
      state.bank[r] -= n;
      state.players[p].resources[r] += n;
      (dealt[p] ??= {})[r] = n;
    }
    if (short) shortages.push(r);
  }

  for (const [p, got] of Object.entries(dealt)) {
    const parts = Object.entries(got).map(([r, n]) => `${n} ${r}`);
    log(state, `${nameOf(state, Number(p))} receives ${parts.join(', ')}`);
  }
  for (const r of shortages) log(state, `The bank is short of ${r}: it is not paid out`);
  return { dealt, shortages, gold };
}

/** Starting resources: one card per terrain hex adjacent to the vertex (gold handled by caller). */
export function startingResources(state: GameState, p: PlayerId, vertex: string): { gold: number } {
  let gold = 0;
  for (const id of topo(state).vertexHexes[vertex]) {
    const hex = state.board.hexes[id];
    const res = TERRAIN_RESOURCE[hex.terrain];
    if (res) {
      if (state.bank[res] > 0) {
        state.bank[res]--;
        state.players[p].resources[res]++;
      }
    } else if (hex.terrain === 'gold') {
      gold++;
    }
  }
  return { gold };
}
