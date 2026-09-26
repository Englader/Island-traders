import type { GameState } from '../core/types.js';
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
