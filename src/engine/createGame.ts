import { generateMap } from '../board/mapSpec.js';
import { initCk } from '../ck/engine.js';
import { ckMapSpec } from '../ck/map.js';
import { ckScenarioError, ckVictoryPoints } from '../ck/seafarers.js';
import { layoutKeyFor } from '../board/topology.js';
import { PIECES_PER_PLAYER } from '../core/constants.js';
import { emptyCounts, filledCounts } from '../core/resources.js';
import { rollDie, seedRng, shuffle } from '../core/rng.js';
import type { DevCardType, GameConfig, GameOptions, GameState, PlayerId, PlayerState, RngState } from '../core/types.js';
import { getScenario, mapSpecFor } from '../scenarios/registry.js';
import { emptyStats } from './stats.js';
import '../scenarios/all.js';

export const DEFAULT_OPTIONS: GameOptions = {
  layout: 'official',
  tradeBuildMode: 'combined',
  fiveSixMode: 'paired',
  tokenPlacement: 'spiral',
  noAdjacentRed: true,
  noAdjacent2and12: false,
  noAdjacentSameNumber: false,
  friendlyRobber: false,
  discardLimit: 7,
  setupGoldYield: 'choose',
};

/** Each player rolls; the highest roll starts, ties re-roll among the tied players. */
function rollForFirstPlayer(rng: RngState, n: number, logLines: string[], names: string[]): PlayerId {
  let contenders = Array.from({ length: n }, (_, i) => i);
  for (;;) {
    const rolls = contenders.map(() => rollDie(rng) + rollDie(rng));
    logLines.push(contenders.map((p, i) => `${names[p]} rolls ${rolls[i]}`).join(', '));
    const best = Math.max(...rolls);
    contenders = contenders.filter((_, i) => rolls[i] === best);
    if (contenders.length === 1) return contenders[0];
  }
}

export function createGame(config: GameConfig): GameState {
  const scenario = getScenario(config.scenario);
  const names =
    typeof config.players === 'number'
      ? Array.from({ length: config.players }, (_, i) => `Player ${i + 1}`)
      : [...config.players];
  const n = names.length;
  if (n < scenario.minPlayers || n > scenario.maxPlayers) {
    throw new Error(`${scenario.name} supports ${scenario.minPlayers}-${scenario.maxPlayers} players, got ${n}`);
  }
  const options: GameOptions = { ...DEFAULT_OPTIONS, ...(config.options ?? {}) };
  const ck = options.citiesAndKnights === true;
  // 3-6 players: 5-6 with the C&K 5-6 Player Extension (src/ck/constants.ts, docs/cities-and-knights.md section 15);
  // the Seafarers scenarios the rulebook combines with it (src/ck/seafarers.ts, section 16)
  const ckError = ck ? ckScenarioError(scenario) : null;
  if (ckError) throw new Error(`${scenario.name}: ${ckError}`);
  const seed = String(config.seed);
  const rng = seedRng(seed);

  const map = generateMap(
    (ck ? ckMapSpec(scenario, n, options) : null) ?? mapSpecFor(scenario, n, options),
    rng,
    {
      noAdjacentRed: options.noAdjacentRed,
      noAdjacent2and12: options.noAdjacent2and12,
      noAdjacentSameNumber: options.noAdjacentSameNumber,
    },
    options.tokenPlacement === 'spiral',
  );

  // Cities & Knights replaces the development cards with progress cards.
  const deckCounts: Partial<Record<DevCardType, number>> = ck ? {} : scenario.devDeck(n);
  const deck: DevCardType[] = [];
  for (const [type, count] of Object.entries(deckCounts)) for (let i = 0; i < count; i++) deck.push(type as DevCardType);
  shuffle(rng, deck);

  const players: PlayerState[] = names.map((name, id) => ({
    id,
    name,
    resources: emptyCounts(),
    devCards: [],
    playedKnights: 0,
    playedProgress: [],
    supply: {
      roads: PIECES_PER_PLAYER.roads,
      ships: scenario.rules.ships ? PIECES_PER_PLAYER.ships : 0,
      settlements: PIECES_PER_PLAYER.settlements,
      cities: PIECES_PER_PLAYER.cities,
    },
    bonusVP: 0,
    bonusZones: [],
    homeZones: [],
  }));

  const logLines: string[] = [];
  let firstPlayer: PlayerId;
  if (options.firstPlayer !== undefined) {
    if (options.firstPlayer < 0 || options.firstPlayer >= n) throw new Error('firstPlayer out of range');
    firstPlayer = options.firstPlayer;
  } else {
    firstPlayer = rollForFirstPlayer(rng, n, logLines, names);
  }
  logLines.push(`${names[firstPlayer]} starts`);

  const state: GameState = {
    version: 1,
    scenario: scenario.id,
    seed,
    options,
    victoryTarget: options.victoryPoints ?? (ck ? ckVictoryPoints(scenario, n) : scenario.victoryPoints(n)),
    rng,
    board: {
      layoutKey: layoutKeyFor(Object.keys(map.hexes)),
      hexes: map.hexes,
      harbors: map.harbors,
      buildings: {},
      pieces: {},
      robber: scenario.rules.robber ? map.robber : null,
      pirate: map.pirate,
    },
    players,
    bank: filledCounts(scenario.bankSize(n)),
    devDeck: deck,
    longestRoute: { holder: null, lengths: names.map(() => 0) },
    largestArmy: { holder: null },
    turn: {
      number: 0,
      current: firstPlayer,
      actor: firstPlayer,
      role: 'active',
      part: 0,
      dice: null,
      devCardPlayed: false,
      shipMoved: false,
      buildingStarted: false,
      trades: [],
      nextTradeId: 1,
      offers: 0,
    },
    phase: { kind: 'setup', round: 0, index: 0, step: 'settlement', vertex: null },
    firstPlayer,
    ext: {},
    log: logLines.map((msg) => ({ turn: 0, msg })),
    rolls: [],
    stats: emptyStats(n),
  };
  if (map.fogStack) state.ext.fog = map.fogStack;
  scenario.hooks.init?.(state, map);
  if (ck) {
    state.ck = initCk(state);
    for (const ps of state.stats!.players) ps.producedCommodities = { paper: 0, cloth: 0, coin: 0 };
    // Seafarers: the robber and the pirate wait by the barbarian track until the first attack (2025 rulebook p. 12)
    if (scenario.expansion !== 'base') {
      state.ck.asleep = { robber: state.board.robber, pirate: state.board.pirate };
      state.board.robber = null;
      state.board.pirate = null;
    }
  }
  // New World: players place the harbor tokens before the starting placement.
  const pool = state.ext.harborPool as unknown[] | undefined;
  if (scenario.rules.playersPlaceHarbors && pool && pool.length > 0) {
    const queue = Array.from({ length: pool.length }, (_, i) => (firstPlayer + i) % n);
    state.phase = { kind: 'harborPlacement', queue };
    state.log.push({ turn: 0, msg: 'Players place the harbors' });
  }
  return state;
}
