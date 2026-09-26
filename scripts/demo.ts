/**
 * Plays one bot game and prints the board and the end of the log.
 *
 *   npm run demo -- [scenario-id] [players] [seed] [official|random]
 *   npm run demo -- list
 */
import { createGame, listScenarios, publicVP, renderAscii, seedRng, simulate, totalVP } from '../src/index.js';

const [scenario = 'base', players = '4', seed = 'demo', layout = 'official'] = process.argv.slice(2);

if (scenario === 'list') {
  for (const s of listScenarios()) {
    console.log(`${s.id.padEnd(34)} ${s.minPlayers}-${s.maxPlayers}p  ${s.name}: ${s.description}`);
  }
  process.exit(0);
}

const game = createGame({ scenario, players: Number(players), seed, options: { layout: layout === 'random' ? 'random' : 'official' } });
console.log(`${scenario}, ${players} players, seed "${seed}", ${game.options.layout} map, target ${game.victoryTarget} VP\n`);
console.log(renderAscii(game.board.hexes));
console.log('\nLegend: h hills  f forest  p pasture  g fields  m mountains  d desert  $ gold  ~ sea  x fog\n');

const result = simulate(game, seedRng(`${seed}-bots`), 20000);
const s = result.state;
console.log(s.log.filter((l) => !l.visibleTo).slice(-15).map((l) => `  ${l.msg}`).join('\n'));
console.log(`\nAfter ${result.steps} actions over ${s.turn.number} turns: ${s.phase.kind === 'gameOver' ? s.phase.reason : 'unfinished'}`);
for (const p of s.players) {
  console.log(`  ${p.name}: ${totalVP(s, p.id)} VP (${publicVP(s, p.id)} public), knights ${p.playedKnights}`);
}
