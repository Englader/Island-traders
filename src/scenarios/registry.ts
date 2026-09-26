import type { MapSpec } from '../board/mapSpec.js';
import type { GameOptions, GameState } from '../core/types.js';
import type { ScenarioDef } from './types.js';

const scenarios = new Map<string, ScenarioDef>();

export function registerScenario(def: ScenarioDef): void {
  scenarios.set(def.id, def);
}

export function getScenario(id: string): ScenarioDef {
  const s = scenarios.get(id);
  if (!s) throw new Error(`unknown scenario "${id}"`);
  return s;
}

export function scenarioOf(state: GameState): ScenarioDef {
  return getScenario(state.scenario);
}

export function listScenarios(): ScenarioDef[] {
  return [...scenarios.values()];
}

/**
 * The map a new game is built from, by `options.layout`: the rulebook's
 * printed map ('official', falling back to the random layout where the
 * rulebook has none) or the random layout ('random': the base game's variable
 * set-up, or a new map generated in the scenario's style).
 */
export function mapSpecFor(def: ScenarioDef, players: number, options: GameOptions): MapSpec {
  if (options.layout !== 'random') {
    const official = def.officialMap?.(players, options);
    if (official) return official;
  }
  return def.map(players, options);
}

/** Whether the scenario has a printed map for this player count. */
export function hasOfficialMap(def: ScenarioDef, players: number, options: GameOptions): boolean {
  return !!def.officialMap?.(players, options);
}
