# Island Traders

An unofficial, data-driven rules engine for Catan-style island trading games.
It covers the base game (3–4 and 5–6 players) and the nine scenarios of the
Seafarers expansion. It is written in TypeScript and has no runtime
dependencies. It is not affiliated with or endorsed by Catan GmbH (see
[Intellectual property](#intellectual-property)).

The engine is a pure function:

```ts
applyAction(state, action) -> { ok: true, state } | { ok: false, error }
```

The state is plain JSON: the seeded RNG, the hidden deck order and the fog stack
all live inside it. That gives you replays, an authoritative server and bot
self-play without extra work. Each player gets a redacted view of the state.

## Play in the browser

**https://englader.github.io/Island-traders/** (deployed from `main` by
GitHub Actions)

- Base game (3–6 players) and the nine Seafarers scenarios
- Pass-and-play on one device: a hand-over screen keeps hands hidden
- Computer players at three levels (easy, medium, hard) and an adjustable
  pace, with a feed of their moves
- Trading with players, including open offers ("who gives me a brick?" or
  "what will you give for my brick?") that the others answer with
  counter-offers; the trade menu shows your cards
- A preview of each map on the new-game screen, and dice statistics: a bar
  chart of every total rolled against fair-dice odds, for everyone or one
  player
- Drawn resource icons that look the same on every device
- Illustrated cards: original painted scenes for the five resources and the
  development cards, in a parchment frame with a name ribbon
- Animations: new roads and ships pop into place, settlements and cities drop
  onto the board, trades show the cards sliding between the two sides, and
  development cards fly in and turn over when bought or played (tap to skip)
- Dice rolls are animated: two 3D dice tumble in the middle of the screen,
  show the total, then fly into the header (about 2 s; tap to skip)
- Online play with friends: the host opens a room and friends join with a
  5-letter code or an invite link
- Made for phones: tap-friendly board, portrait and sideways layouts, and
  "Add to Home Screen" for full-screen play
- Plays offline: after one visit with a connection, games on the device
  (against the computer and pass-and-play) start without internet. A service
  worker (`web/public/sw.js`) stores the game when it installs. Online play
  still needs a connection, and the home screen says so when there is none.
- The game is saved in the browser after every move

```bash
npm run web:dev        # dev server with hot reload
npm run web:build      # static site in web/dist (BASE_PATH=/Island-traders/ for Pages)
npm run test:e2e       # Playwright tests on a phone viewport (builds and serves the site)
```

### Computer players

A rule-based player (`src/bots/heuristicBot.ts`) that scores its options. It
doesn't look ahead by searching and doesn't see hidden cards, except that
when answering an open trade offer it prefers to ask for a card the
proposer actually holds. The level is chosen when starting a game and can
be changed from the menu:

| | Easy | Medium | Hard |
|---|---|---|---|
| Building spots | often not the best | sometimes not the best | the best it sees |
| Goals | none: builds whatever it can afford, roads to nowhere included | saves for a settlement, city, road or card and trades with the bank and harbors to get there | same, and trades a big hand down before a 7 can cost it |
| Robber | anyone, a bit at random | whoever it hurts most, leaning to the leader | the leader; plays knights to keep it there and to win Largest Army |
| Taking offers | takes even slightly bad deals | takes deals that help it | only clearly good deals |
| Near-winners | trades with anyone | no trades with someone 2 VP from winning | no trades with someone 3 VP from winning |
| Its own offers | none | one per turn, one card for the one it needs | up to two, the second one two cards for one |
| Answering open offers | generous, card for card | card for card when it gains | asks for up to one card more |

`npm run bots:league -- [games] [scenarios]` seats one player of
each level at a table, rotates the seats and counts wins. Over 60 base games,
hard won 68%, medium 28% and easy 3%. Over the nine Seafarers scenarios
(30–60 games each), hard won 55%, medium 44% and easy 1%.

### Dice

Each roll is two independent fair six-sided dice from a seeded random
number generator (mulberry32 in `src/core/rng.ts`). Every game gets a fresh
seed, so a 7 comes up 6 times in 36 on average and a 2 or 12 once in 36,
with the usual streaks. The generator's state lives inside the game state,
so a saved game continues with the same future rolls. It is stripped from
what players see, so nobody can predict a roll. Online, only the host's
browser rolls.

### Online play

The host's browser runs the engine. Friends send the moves they want to
make, the host checks every move with `applyAction` and sends each friend only
their own `viewFor` view plus their legal moves. Nobody can see hidden cards
or make an illegal move. The host must keep the game on screen; friends who
drop out rejoin with the same code and get their seat back, and the host can
hand an empty seat to a computer player.

A friend's phone reaches the host in one of two ways:

- **Direct**: a WebRTC link set up through [PeerJS](https://peerjs.com/).
- **Relay**: if no direct link opens within a few seconds, which is common on
  mobile data, messages go through a public MQTT broker over a secure
  WebSocket (EMQX, HiveMQ or Mosquitto, whichever the phone reaches). Every
  message is compressed and encrypted with a key derived from the room code,
  and topic names are hashes, so the broker sees neither the code nor the
  game. The client is `web/src/net/mqtt.ts`; the relay is `web/src/net/relay.ts`.

Guests send a heartbeat, so a dropped link is noticed within seconds and the
guest reconnects on its own. A host whose phone paused the page gets the same
room code back when it returns.

The free PeerJS cloud broker introduces the browsers. To use your own broker,
run `node scripts/peer-broker.mjs` (or `npx peer`) and open the game with
`?peer=host:port/path`, or build with `VITE_PEER_HOST`, `VITE_PEER_PORT`,
`VITE_PEER_PATH` and `VITE_PEER_SECURE`. `?mqtt=url,url` replaces the relay
brokers, and `?link=direct` or `?link=relay` forces one way (for testing).

The **Online check** workflow (`scripts/online-check.mjs`) plays a join
against the real PeerJS server and each public broker. It runs on pushes that
change the networking code, every week, and on demand.

## Quick start (engine)

```bash
npm install
npm test                                  # 180+ tests: golden positions, scenarios, bots, fuzzing
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
  bots/        heuristic bot, weighted-random bot and simulators (fuzzing)
web/           browser game: Vite + Preact, SVG board, pass-and-play, online (PeerJS)
e2e/           Playwright tests for the browser game
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
| `seafarers-2-four-islands` | The Four Islands | 13 | Home islands are chosen at setup; +2 VP per foreign island; no desert, the robber starts on a 12 |
| `seafarers-3-fog-islands` | The Fog Islands | 12 | Hidden fog stack. Roads and ships reveal hexes; the discoverer is paid |
| `seafarers-4-through-the-desert` | Through the Desert | 14 | Three deserts wall off a strip; +2 VP per foreign area |
| `seafarers-5-forgotten-tribe` | The Forgotten Tribe | 13 | 18 gift paths (8 VP chits, 4 dev cards, 6 harbors, which are the scenario's only harbors). Gifted harbors must be placed at once if possible. The robber only visits numbered hexes |
| `seafarers-6-cloth-trade` | Cloth Trade (rulebook: "Cloth for Catan") | 14 | 3 starting settlements. 8 villages on intersections with 5 cloth each plus a supply of 10. The pirate steals cloth. Ends when 3 or fewer villages have cloth |
| `seafarers-7-pirate-islands` | The Pirate Islands | 10 + fortress | Pre-placed pieces. The fleet moves and attacks every adjacent player by the lower die. A 7 lets the roller rob anyone. A single shortest route via a marked intersection. Warships from knights; fortress battles |
| `seafarers-8-wonders` | The Wonders (rulebook: "The Wonders of Catan") | 4 levels, or 10 + most levels | Theater, Great Bridge, Monument, Great Wall and Cathedral with their card requirements and costs; a ship marks the claim; +1 VP per small island |
| `seafarers-9-new-world` | New World | 12 | Random archipelago; players place the harbors first; +1 VP per foreign island; robber and pirate start off the board; 3–6 players |

All scenario rules were checked against the official 5th-edition Seafarers
rulebook, the base rules and the FAQs on catan.com.
[`docs/rules.md`](docs/rules.md) lists the sources and every remaining engine
choice.

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

- **Heuristic bots** finish a full game in every scenario and supported
  player count, using only moves the engine accepts.
- **Browser** (`npm run test:e2e`, Playwright, phone viewport): a game
  against the computer that is reloaded and continued, a Seafarers board,
  the pass-and-play hand-over, and online games between two browsers through
  a local PeerJS broker and a local relay broker (`scripts/mqtt-broker.mjs`):
  a direct link, a relay-only link, and a friend who joins while the host is
  away.

Set `SIM_STEPS` and `SIM_SEEDS` to run longer simulations.

## Roadmap

[`docs/ROADMAP.md`](docs/ROADMAP.md) records what was done (rule check
against the official rulebooks, browser game, online play, GitHub Pages)
and the next steps.

## Intellectual property

"Catan" and its artwork, names and maps are trademarks and copyrighted
material of Catan GmbH. Island Traders is an independent, non-commercial fan
project that implements game mechanics. It uses its own name and original
maps, and mentions Catan only to say which rules it follows. It is not
affiliated with or endorsed by Catan GmbH. A commercial release, or one that
uses the Catan name, art or rule text, needs a license from Catan GmbH
(ip@catan.com).
