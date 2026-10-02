import type { GameState } from '../core/types.js';
import type { ScenarioDef } from '../scenarios/types.js';
import { CK_VICTORY_POINTS } from './constants.js';

/**
 * Cities & Knights with the Seafarers scenarios (docs/cities-and-knights.md,
 * section 16). Sources: the 2020 Game Rules & Almanac p. 13 ("Seafarers of
 * Catan Variant"), the 2025 rulebook p. 12 ("Combining with CATAN –
 * Seafarers"), catan.com's Cities & Knights page and the 2025 German
 * rulebook p. 16 (catan.de), and the catan.com FAQs.
 *
 * Which scenarios combine: the rulebooks name Heading for New Shores and
 * Through the Desert as working well, and advise against scenarios that
 * explore hidden hexes (The Fog Islands) or many small islands (The Four
 * Islands); catan.com and the German rulebook call those "unsuitable"
 * (ungeeignet). Cloth for Catan and The Wonders of Catan are played, like
 * New Shores, from big islands everyone starts on, with no hidden hexes, so
 * they combine (an engine reading, section 16). The others stay blocked.
 */

/** Each Seafarers scenario's VP target goes up by 2 (2025 rulebook p. 12; catan.com). */
export const CK_SEAFARERS_VP_BONUS = 2;

const SMALL_ISLANDS = 'its many small islands make the barbarians too hard to fight (Cities & Knights rules, p. 13)';

/**
 * Why Cities & Knights cannot be played with this Seafarers scenario, keyed by
 * scenario id; scenarios missing here combine. Every reason starts with the
 * rulebook's verdict.
 */
export const CK_BLOCKED_SCENARIOS: Readonly<Record<string, string>> = {
  'seafarers-2-four-islands': `The rulebook doesn't combine Cities & Knights with this scenario: ${SMALL_ISLANDS}.`,
  'seafarers-3-fog-islands':
    "The rulebook doesn't combine Cities & Knights with this scenario: exploring hidden hexes makes the barbarians too hard to fight (Cities & Knights rules, p. 13).",
  'seafarers-5-forgotten-tribe':
    "The rulebook doesn't combine Cities & Knights with scenarios of many small islands, and the tribe's gifts include development cards, which Cities & Knights sets aside.",
  'seafarers-7-pirate-islands':
    "The rulebook doesn't combine Cities & Knights with scenarios of many small islands, and this one arms its warships with Knight cards: Cities & Knights has no development cards.",
  'seafarers-9-new-world':
    "The rulebook doesn't combine Cities & Knights with this scenario: it explores a new map of many small islands (Cities & Knights rules, p. 13).",
};

/** Why Cities & Knights cannot be played on this scenario, or null when it can. */
export function ckScenarioError(scenario: Pick<ScenarioDef, 'id' | 'expansion'>): string | null {
  if (scenario.expansion === 'base') return null;
  return CK_BLOCKED_SCENARIOS[scenario.id] ?? null;
}

/** Whether Cities & Knights can be played on this scenario. */
export function ckCombines(scenario: Pick<ScenarioDef, 'id' | 'expansion'>): boolean {
  return ckScenarioError(scenario) === null;
}

/** The VP target of a Cities & Knights game: 13 on the base game, the scenario's + 2 on a Seafarers scenario. */
export function ckVictoryPoints(scenario: Pick<ScenarioDef, 'expansion' | 'victoryPoints'>, players: number): number {
  return scenario.expansion === 'base' ? CK_VICTORY_POINTS : scenario.victoryPoints(players) + CK_SEAFARERS_VP_BONUS;
}

/** A Cities & Knights game on a Seafarers scenario. */
export function ckSeafarers(s: GameState): boolean {
  return !!s.ck && s.scenario !== 'base';
}
