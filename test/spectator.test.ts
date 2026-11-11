import { describe, expect, it } from 'vitest';
import { applyAction, createGame, heuristicAction, legalActions, playersToAct, type Action, type GameOptions, type GameState } from '../src/index.js';
import { GameController, type GameRecord } from '../web/src/game/controller.js';
import { ChatHub } from '../web/src/net/chat.js';
import { messageFor, publicAction } from '../web/src/net/hostView.js';
import type { HostMessage } from '../web/src/net/protocol.js';

/*
 * Spectators in online games: what the host sends someone watching must
 * hold nothing a player keeps hidden (hands, development and progress cards,
 * deck order, the dice's random state, scenario secrets such as the fog).
 */

const NAMES = ['Sam', 'Ada', 'Björn'];

/** Plays the computer's moves for everyone until `done` says stop. */
function playUntil(s: GameState, done: (s: GameState) => boolean, limit = 4000): GameState {
  let state = s;
  for (let i = 0; i < limit && !done(state); i++) {
    const p = playersToAct(state)[0];
    if (p === undefined) break;
    const a = heuristicAction(state, p, 'medium') ?? legalActions(state, p)[0];
    if (!a) break;
    const r = applyAction(state, a);
    if (!r.ok) throw new Error(`${a.type}: ${r.error}`);
    state = r.state;
  }
  return state;
}

/** A game well under way: turn 12 (or the end, if it comes sooner). */
function midGame(scenario: string, options: Partial<GameOptions> = {}): GameState {
  const s = createGame({ scenario, players: NAMES, seed: `spectate-${scenario}`, options: { firstPlayer: 0, ...options } });
  return playUntil(s, (x) => x.turn.number >= 12 || x.phase.kind === 'gameOver');
}

/** The host's controller for an online game with this state: Sam hosts, Ada and Björn play from their phones. */
function hostWith(state: GameState, last?: Action): GameController {
  const record: GameRecord = {
    v: 1,
    id: 'spectate',
    mode: 'host',
    seats: NAMES.map((name, i) => ({ name, kind: i === 0 ? 'human' : 'remote', color: i })),
    state,
    botSpeed: 'normal',
    room: 'WATCH',
    claims: { ada: 1, bjorn: 2 },
    started: true,
    savedAt: 0,
  };
  const ctrl = new GameController(record);
  if (last) ctrl.last = { action: last, by: last.player, at: 1 };
  ctrl.destroy();
  return ctrl;
}

/** What the host sends someone watching (at a fixed clock reading). */
function forSpectator(ctrl: GameController): HostMessage {
  const msg = messageFor(ctrl, null, new Set([1, 2]), ['Wanda']);
  return JSON.parse(JSON.stringify(msg)) as HostMessage;
}

/**
 * The same game with every hidden detail changed (and every public one
 * kept): other cards in each hand (the same number), other development and
 * progress cards, another deck order and random state, the fog stack the
 * other way round, other private log lines.
 */
function shuffledSecrets(state: GameState): GameState {
  const s = structuredClone(state);
  for (const p of s.players) {
    const total = Object.values(p.resources).reduce((a, b) => a + b, 0);
    const keys = Object.keys(p.resources) as (keyof typeof p.resources)[];
    for (const k of keys) p.resources[k] = 0;
    // all in the type it had least of
    p.resources[keys[(p.id + 1) % keys.length]] = total;
    p.devCards = p.devCards.map((c) => ({ ...c, type: c.type === 'knight' ? 'monopoly' : 'knight' }));
  }
  s.devDeck.reverse();
  s.rng = structuredClone(s.rng);
  (s.rng as unknown as Record<string, unknown>).secretChanged = 1;
  for (const e of s.log) if (e.visibleTo) e.msg = `(something else entirely ${e.msg.length})`;
  if (s.ck) {
    for (const cp of s.ck.players) {
      cp.progress = cp.progress.map((c) => (c === 'spy' ? 'bishop' : 'spy'));
      const total = Object.values(cp.commodities).reduce((a, b) => a + b, 0);
      const keys = Object.keys(cp.commodities) as (keyof typeof cp.commodities)[];
      for (const k of keys) cp.commodities[k] = 0;
      cp.commodities[keys[0]] = total;
    }
    for (const d of Object.values(s.ck.decks)) d.reverse();
  }
  const fog = s.ext.fog as { terrains: unknown[]; tokens: unknown[] } | undefined;
  if (fog) {
    fog.terrains.reverse();
    fog.tokens.reverse();
  }
  return s;
}

/** Gives players cards to hide, whatever the bots did. */
function withSecrets(state: GameState): GameState {
  const s = structuredClone(state);
  s.players[1].resources.ore += 2;
  s.players[1].resources.wool += 1;
  s.players[2].devCards.push({ type: 'victoryPoint', boughtPart: 0 }, { type: 'knight', boughtPart: 0 });
  if (s.ck) {
    s.ck.players[1].progress.push('spy');
    s.ck.players[2].progress.push('alchemist');
    s.ck.players[2].commodities.coin += 1;
  }
  return s;
}

const GAMES: [string, string, Partial<GameOptions>][] = [
  ['the base game', 'base', {}],
  ['Cities & Knights', 'base', { citiesAndKnights: true }],
  ['Seafarers: the Fog Islands', 'seafarers-3-fog-islands', {}],
  ['Seafarers: the Forgotten Tribe', 'seafarers-5-forgotten-tribe', {}],
];

describe('spectators in online games', () => {
  for (const [label, scenario, options] of GAMES) {
    it(`${label}: someone watching gets no hand, no cards, no legal moves`, () => {
      const state = withSecrets(midGame(scenario, options));
      expect(state.phase.kind).not.toBe('gameOver');
      const msg = forSpectator(hostWith(state));
      expect(msg.t).toBe('state');
      if (msg.t !== 'state') return;
      expect(msg.snap.seat).toBeNull();
      expect(msg.snap.legal).toEqual([]);
      expect(msg.snap.view.viewer).toBeNull();
      expect(msg.watching).toEqual(['Wanda']);
      for (const p of msg.snap.view.players) {
        expect(p).not.toHaveProperty('resources');
        expect(p).not.toHaveProperty('devCards');
        expect(p).not.toHaveProperty('totalVP');
        // the counts are public
        expect(p.resourceCount).toBeGreaterThanOrEqual(0);
      }
      for (const cp of msg.snap.view.ck?.players ?? []) {
        expect(cp).not.toHaveProperty('progress');
        expect(cp).not.toHaveProperty('commodities');
      }
      expect(msg.snap.view.log.every((e) => !e.visibleTo)).toBe(true);
      const json = JSON.stringify(msg);
      for (const key of ['"rng"', '"devDeck"', '"devCards"', '"progress"', '"commodities"', '"terrains"', '"visibleTo"']) expect(json).not.toContain(key);

      // and the test can tell: a seated player does get their own hand
      const seated = messageFor(hostWith(state), 1, new Set([1, 2]), []);
      expect(seated.t === 'state' && seated.snap.view.players[1].resources).toEqual(state.players[1].resources);
    });

    it(`${label}: changing every hidden detail changes nothing a spectator receives`, () => {
      const state = withSecrets(midGame(scenario, options));
      const a = forSpectator(hostWith(state));
      const b = forSpectator(hostWith(shuffledSecrets(state)));
      // the game clock isn't kept in these records, so the messages compare whole
      expect(b).toEqual(a);
    });
  }

  it('the fog stays fog: only how many tiles are left', () => {
    const state = midGame('seafarers-3-fog-islands');
    const msg = forSpectator(hostWith(state));
    if (msg.t !== 'state') throw new Error('expected a state message');
    const fog = msg.snap.view.ext.fog as Record<string, unknown>;
    expect(Object.keys(fog).sort()).toEqual(['terrainsLeft', 'tokensLeft']);
  });

  it('the latest move leaves out the cards only its player knows', () => {
    const state = withSecrets(midGame('base', { citiesAndKnights: true }));
    const put: Action = { type: 'discardProgress', player: 1, card: 'spy' };
    const msg = forSpectator(hostWith(state, put));
    if (msg.t !== 'state') throw new Error('expected a state message');
    expect(msg.last?.action).toEqual({ type: 'discardProgress', player: 1 });
    expect(JSON.stringify(msg)).not.toContain('"spy"');
    // the player who made it gets it whole
    expect(publicAction(put, 1)).toEqual(put);
    const answer: Action = { type: 'progressChoice', player: 2, args: { cards: { ore: 1, grain: 1 } } };
    expect(publicAction(answer, null)).toEqual({ type: 'progressChoice', player: 2 });
    expect(publicAction(answer, 0)).toEqual({ type: 'progressChoice', player: 2 });
    // public moves go out as they were
    const build: Action = { type: 'buildRoad', player: 1, edge: 'e1' };
    expect(publicAction(build, null)).toBe(build);
  });

  it('before the start, someone watching gets the lobby: seats and names only', () => {
    const state = createGame({ scenario: 'base', players: NAMES, seed: 'lobby', options: { firstPlayer: 0 } });
    const ctrl = hostWith(state);
    ctrl.record = { ...ctrl.record, started: false };
    const msg = messageFor(ctrl, null, new Set([1]), ['Wanda', 'Walt']);
    expect(msg).toEqual({
      t: 'lobby',
      scenario: 'base',
      seats: [
        { name: 'Sam', kind: 'human', color: 0, taken: false, online: true },
        { name: 'Ada', kind: 'remote', color: 1, taken: true, online: true },
        { name: 'Björn', kind: 'remote', color: 2, taken: true, online: false },
      ],
      started: false,
      host: 'Sam',
      watching: ['Wanda', 'Walt'],
    });
  });

  it("a spectator's chat line is marked as watching, whatever it claims", () => {
    const hub = new ChatHub([], () => 1000);
    const r = hub.fromGuest({ client: 'w1', seat: null, name: 'Wanda' }, { text: 'nice road!', seat: 1, name: 'Ada' }, () => 'Ada');
    expect(r.ok && r.message).toMatchObject({ seat: null, name: 'Wanda (watching)', text: 'nice road!' });
  });
});
