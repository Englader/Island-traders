# Claude-catan

A data-driven rules engine for Catan-style games: the base game (3–4 and 5–6
players) and the Seafarers expansion with nine scenarios. It is written in
TypeScript and has no runtime dependencies.

The engine is a pure function:

```ts
applyAction(state, action) -> { ok: true, state } | { ok: false, error }
```

The state is plain JSON: the seeded RNG, the hidden deck order and the fog stack
all live inside it. That gives you replays, an authoritative server and bot
self-play without extra work. Each player gets a redacted view of the state.

## Quick start

```bash
npm install
npm test                                  # 150+ tests: golden positions, scenarios, fuzzing
npm run demo -- list                      # list scenarios
npm run demo -- seafarers-3-fog-islands 4 my-seed   # play a bot game and print the board
npm run build                             # emit dist/ (ESM + .d.ts)
```

```ts
import { applyAction, createGame, legalActions, viewFor } from './src/index.js';

let state = createGame({ scenario: 'base', players: ['Ann', 'Bo', 'Cy'], seed: 42 });

const moves = legalActions(state, 0);            // every legal action for seat 0
const result = applyAction(state, moves[0]);
if (result.ok) state = result.state;
else console.log(result.error);                  // e.g. "distance rule: intersection or a neighbour is occupied"

const view = viewFor(state, 1);                  // what seat 1 may see (no hands, deck order, RNG...)
```

## Architecture

```
src/
  core/        types, constants, seeded RNG (mulberry32), resource helpers
  board/       axial hex math, topology (vertices/edges/adjacency), map format + generator
  rules/       legality queries, production, longest route, ship rules, mutation helpers
  engine/      createGame, applyAction (turn state machine), legal actions, player views
  scenarios/   base game + 9 Seafarers scenarios as data + rule hooks
  bots/        weighted-random bot and a simulator (doubles as a fuzzer)
```

- **Board = graph.** Each hex has axial coordinates. A vertex is the set of 3
  hexes that meet at it and an edge is the set of 2 hexes that share it, both
  including sea hexes. Adjacency is precomputed once per layout and cached
  outside the state. The standard board has 54 intersections and 72 paths
  touching land; a test checks this.
- **Edge types follow from terrain.** A road needs land on at least one side. A
  ship needs sea on at least one side. A coastal path takes either a road or a
  ship, never both.
- **Scenario = data + hooks.** A `ScenarioDef` holds the map (ASCII rows or
  generated), pools, harbors, robber and pirate start, VP target, setup
  rounds, allowed and forbidden zones, and island bonuses. It can also add
  hooks: `afterSettlement`, `afterEdge` (fog, tribe gifts), `afterRoll` (cloth,
  pirate fleet), `onKnight` (warships), `shipAllowed`, `extraVP`, `canWin`,
  `instantWin`, `checkEnd`, `action`, `legalActions` and `redact`. The base
  game is "scenario 0". Custom scenarios can be added with
  `registerScenario`.
- **Turn state machine.** The phases are `setup`, `harborPlacement` (New
  World), `preRoll`, `discard`, `robber`, `gold`, `main`, `roadBuilding`,
  `specialBuild`, `scenario` and `gameOver`. Interrupt phases carry a
  `resume` phase. A `part` counter drives "not on the turn it was bought" and
  "ships built this turn". It also handles the 5–6 player parts cleanly.

### Map format

```
'~  ~  ~  ~  ~  ~  ~',
'~  ~  ?  ?  $4 ~  ~',       // ? = random terrain from the default pool, $4 = gold with token 4
'~  ?  ?@main ?  ?b ~  ~',   // @main tags a zone; ?b draws from pool "b"
```

Rows use odd-r offset coordinates. The cell codes are: `~` sea, `h` hills,
`f` forest, `p` pasture, `g` fields, `m` mountains, `d` desert, `$` gold,
`x` fog, `.` no hex. A cell may add a number token (`m8`) or `#` for a random
one. Untagged land inherits the zone of its island; islands without a tag are
named `island-N`. `renderAscii()` prints a board in the same format.

## Rules coverage

[`docs/rules.md`](docs/rules.md) maps each section of the spec to the code and
tests. It also lists every decision the engine makes where the spec is silent.
In summary:

| Area | Implemented |
|---|---|
| Setup | Roll for the first player, snake draft, second-settlement resources, starting ships, zone restrictions, a 3rd round (Cloth) |
| Production | 1/2 cards per settlement/city, robber block, **bank shortage** rule, gold choices |
| 7 / robber | Players with more than 7 cards discard half (in parallel, once). The robber must move to a *different* hex; random steal from a chosen adjacent opponent; pirate alternative |
| Trading | Offers, counter-offers, accept/reject/confirm; no gifts, like-for-like or triangular trades. Maritime 4:1 / 3:1 / 2:1 with multiples |
| Building | Costs, piece caps, distance rule (across straits too), connectivity (no building through opponents), city returns the settlement piece |
| Dev cards | 25-card deck (34 for 5–6). One card per turn, not on the turn it was bought, may be played before rolling. VP cards win on purchase |
| Awards | Longest Road / Trade Route (single-trail DFS, cut by opponents, road↔ship only at your own building, set-aside logic). Largest Army (3+, strictly more) |
| Victory | Only on your own turn (or part); checked after every action and at the start of every turn and part |
| Seafarers | Ships, moving one open-ended ship per turn, closed routes, pirate (blocks and robs ships), gold, fog, island bonuses |
| 5–6 players | 2021 **paired players** (default: P2 is the 3rd player to the left, supply trades only, no roll) and the legacy **Special Build Phase** |
| Options | `tradeBuildMode` combined/separate, `fiveSixMode`, `tokenPlacement` spiral/random, `noAdjacentRed` (on), `noAdjacent2and12`, `noAdjacentSameNumber`, `friendlyRobber`, `discardLimit`, `setupGoldYield`, `victoryPoints`, `firstPlayer` |

### Scenarios

| id | Name | VP | Special rules implemented |
|---|---|---|---|
| `base` | Base game | 10 | Official A–R spiral or random tokens. The 5–6 board has 30 hexes and 11 harbors |
| `seafarers-1-new-shores` | Heading for New Shores | 14 | Start on the main island; +2 VP for the first settlement on each small island |
| `seafarers-2-four-islands` | The Four Islands | 13 | Home islands are chosen at setup; +2 VP per foreign island |
| `seafarers-3-fog-islands` | The Fog Islands | 12 | Hidden fog stack. Roads, ships and settlements reveal hexes; the discoverer is paid |
| `seafarers-4-through-the-desert` | Through the Desert | 14 | Three deserts wall off a strip; +2 VP per foreign area |
| `seafarers-5-forgotten-tribe` | The Forgotten Tribe | 13 | 18 gift paths (8 VP chits, 4 dev cards, 6 harbors). Gifted harbors must be placed at once if possible |
| `seafarers-6-cloth-for-catan` | Cloth for Catan | 14 | 3 starting settlements. 8 villages on intersections with 5 cloth each plus a supply of 10. The pirate steals cloth. Ends when fewer than 4 villages have cloth |
| `seafarers-7-pirate-islands` | The Pirate Islands | 10 + fortress | Pre-placed pieces. Fleet moves and attacks by the lower die. A 7 lets the roller rob anyone. Single route via a marked intersection. Warships from knights; fortress battles |
| `seafarers-8-wonders` | The Wonders of Catan | 4 levels, or 10 + most levels | Theater, Great Bridge, Monument, Great Wall and Cathedral with their card requirements and costs; a ship marks the claim |
| `seafarers-9-new-world` | New World | 12 | Random archipelago; players place the harbors first; +1 VP per foreign island; 3–6 players |

The rules for scenarios 5–9 come from rules summaries and the open-source
JSettlers2 implementation. [`docs/rules.md`](docs/rules.md) lists the source
for each rule.

The maps are original layouts that follow each scenario's structure. They are
not the printed maps. Official layouts can be added as `MapSpec` data with no
code changes.

## Testing

- **Golden positions** follow the spec's recommendation list:
  - a hexagonal ring road counts 6
  - an opponent settlement breaks a road
  - a three-way tie sets Longest Road aside
  - bank shortage with one owed player versus several
  - pirate-blocked ship moves
  - a closed route stays closed after an opponent settles on it
  - a VP card wins on purchase
  - the FAQ ship cases (a loop back to the same settlement, a ring touching no settlement)
- **Board checks:** 54/72 topology. The A–R spiral never puts a 6 next to an
  8, for every desert position and every start corner. Token and harbor
  constraints hold for every scenario and player count.
- **Simulations:** random bot games run in every scenario and every supported
  player count. Invariants are checked as they play:
  - resources and dev cards are conserved
  - piece supply matches the board
  - distance rule and placement legality
  - award thresholds
  - robber on land, pirate at sea

  Every move that `legalActions` returns must be accepted by the engine, so
  the simulations double as a fuzzer.
- **Purity and determinism:** inputs are never mutated, and the same seed and
  actions always produce the same state.

Set `SIM_STEPS` and `SIM_SEEDS` to run longer simulations.

## Intellectual property

"Catan" and its artwork, names and maps are trademarks and copyrighted material
of Catan GmbH. This project implements game mechanics for private and
educational use. A public or commercial release that uses the name, art or
rule text needs a license from Catan GmbH (ip@catan.com).
