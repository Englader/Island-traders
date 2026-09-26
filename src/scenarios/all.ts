import { baseGame } from './base.js';
import { registerScenario } from './registry.js';
import { headingForNewShores, theFogIslands, theFourIslands, throughTheDesert } from './seafarers/islands.js';
import { newWorld } from './seafarers/newWorld.js';
import { thePirateIslands } from './seafarers/pirateIslands.js';
import { clothTrade, theForgottenTribe } from './seafarers/tribes.js';
import { theWonders } from './seafarers/wonders.js';

export const BUILT_IN_SCENARIOS = [
  baseGame,
  headingForNewShores,
  theFourIslands,
  theFogIslands,
  throughTheDesert,
  theForgottenTribe,
  clothTrade,
  thePirateIslands,
  theWonders,
  newWorld,
];

for (const s of BUILT_IN_SCENARIOS) registerScenario(s);
