# Island Traders

An unofficial, data-driven rules engine for Catan-style island trading games.
It covers the base game (3–4 and 5–6 players) and the nine scenarios of the
Seafarers expansion, the first four and New World also for 5–6 players. It
is written in TypeScript and has no runtime dependencies. It is not
affiliated with or endorsed by Catan GmbH (see
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

- Base game (3–6 players) and the nine Seafarers scenarios; Heading for New
  Shores, The Four Islands (The Six Islands), The Fog Islands, Through the
  Desert and New World also take 5–6 players, on the Seafarers 5-6 maps
- Cities & Knights: turn it on under the base game for 3–6 players and 13
  VP, on the C&K beginners' map or a random one; with 5–6 players (the C&K
  5-6 extension: 18 of each commodity, 8 Defender of Catan cards, paired
  players or the special build phase) on the base game's 5–6 map or a
  random one. It also combines with the Seafarers scenarios its rulebook
  allows, to the scenario's VP + 2: Heading for New Shores and Through the
  Desert (3–6 players, 16 VP), Cloth for Catan (3–4, 16 VP) and The Wonders
  of Catan (3–4, 12 VP). Knights stand by your roads or ships, move along
  both and may end a move at sea on your ship; a ship route to your knight
  is closed; the robber and the pirate wait on the barbarian track until
  the first attack, and a knight next to the pirate chases it. The other
  five scenarios say on the new-game screen why the rulebook doesn't
  combine them (many small islands or hidden hexes).
  Three dice (the event die shows the barbarian ship or a city gate, and
  says what it did), commodities (paper, cloth and coin) in the hand, the
  trades and the discards, knights to hire, activate, promote, move, use to
  displace a weaker knight or chase the robber, city walls, a "flip chart" of
  the three city improvement tracks with their abilities and metropolises,
  and a barbarian track in the header with both sides' strength. The attack
  plays out in the middle of the screen: the ship lands, barbarians against
  knights, then who loses a city or becomes Defender of Catan. All 25
  progress cards have their own illustrated face; you draw them (with a card
  turning over), hold them and play them: each card's choices are made first
  (the Alchemist's two dice with a preview of the roll, a player, two
  numbers, a road or a hex picked on the board, the Commercial Harbor's
  offers), then confirmed with the card's face. A card you can't play yet
  says why. Played cards show to everyone in the middle of the screen
  ("Ada plays Spy on you"), and chips by the action buttons show what lasts
  the turn (Crane, Merchant Fleet, Commercial Harbor, Warlord)
- Pass-and-play on one device: a hand-over screen keeps hands hidden
- Computer players at three levels (easy, medium, hard), in Cities & Knights
  too, and an adjustable pace, with a feed of their moves
- Trading with players, including open offers ("who gives me a brick?" or
  "what will you give for my brick?") that the others answer with
  counter-offers; the trade menu shows your cards
- Official maps: every scenario starts on the set-up map printed in its
  rulebook, or pick **Random** for a new map generated in the scenario's
  style: the same kind of islands in new shapes, with the gold fields,
  numbers and harbors dealt anew. The new-game screen shows the exact board
  you will play on; 🎲 deals another
- Ask before building: tapping a spot for a road, ship, settlement or city,
  or buying a development card, brings up a "Yes or no?" dialog with the
  piece, its cost in cards, what your hand keeps ("You'll have 0 wool, 2
  grain and 3 ore left") and anything worth knowing (your last settlement
  piece, a harbor at the spot, the cards left in the deck). The piece waits
  on the board behind it; No goes back to picking a spot. Enter or Y says
  yes, Esc or N no. Starting pieces and free roads ask the same way, without
  a cost. Turned off in the menu, a card is bought with one tap and a spot is
  confirmed in a bar under the board
- Dice statistics: a bar chart of every total rolled against fair-dice odds,
  for everyone or one player
- End-of-game results you can close to look at the final map (a Results
  chip brings them back), and game stats: a VP breakdown per player, a
  VP-over-turns race chart, resources produced by type, cards stolen, lost
  and traded, and highlights such as the luckiest roller (dice production
  against what their numbers should have given)
- A game clock: the time played so far in the header, and the turn in play
  by the player whose turn it is (hide it from the menu). Only active play
  counts: it pauses while the game is off screen or closed, and every moment
  goes to the player whose turn it is. Online, the host keeps the time and
  everyone sees the same clock. The game stats end with the time: each
  player's total and share, their average turn, the longest turn, and the
  fastest and slowest players
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

`npm run bots:league -- [games] [scenarios] [official|random] [players] [paired|specialBuild]`
seats one player of each level at a table (with more players the levels
repeat round the table), rotates the seats and counts wins. Over 60 base
games, hard won 68%, medium 28% and easy 3%. Over the nine Seafarers
scenarios (30–60 games each), hard won 55%, medium 44% and easy 1%. On the
5–6 maps of scenarios 1–4 (30 games per scenario, player count and layout,
480 in all, every one finished), hard won 56%, medium 42% and easy 2%.

#### In Cities & Knights

The same three levels play the expansion with a strategy of their own
(`src/bots/ckBot.ts`, set by the `ck` part of each level's profile). Offers
and answers follow the table above, with every card valued by what the
player is saving for, commodities included; medium and hard trade with the
bank and harbors at their best rates (2:1 with the Merchant Guild, the
merchant or a Merchant Fleet) and discard the cards they need least.

| | Easy | Medium | Hard |
|---|---|---|---|
| Set-up | often not the best spot; a commodity counts as an ordinary card | its city where forest, pasture and mountains give commodities, sometimes not the best spot | the same, the best spot it sees, commodities weighted most |
| Barbarians | notices the ship only in its last two moves, and not always | from three moves out keeps a knight ready; wakes knights when an attack before its next turn is likely and it would lose a city as the weakest defender | from five moves out; weighs the odds of an attack before its next turn and the others' idle knights, and races for Defender of Catan (with 5–6 players only when one knight level wins it) |
| Knights | hires one when it has none; chases the robber off its hexes | also guards its best hexes against the robber | also moves knights into opponents' paths and displaces knights in its way |
| City improvements | whatever it can afford | one main track by commodity income, toward a metropolis; the cheap levels of the others | also weighs the level-3 abilities (Aqueduct for a weak producer, Merchant Guild for a heavy commodity producer, Fortress for strong knights) and the others' levels: a race it can win, level 5 to take or keep a metropolis, never a metropolis locked at level 5 |
| City walls | none | when its hand is large, under a metropolis first | the same |
| Progress cards | each card as soon as it can, with random choices | when a card plainly helps | when it matters most: the Alchemist for a big roll, Spy, Master Merchant, Bishop, Saboteur and Diplomat against the leader, the Deserter on the strongest knights |
| Near 13 VP | – | cities and settlements first | also Longest Road and Defender of Catan |

`npm run bots:league -- 120 ck official 3` (and `random`, and 4 players)
plays the levels against each other. Over 120 games per setting, 480 in
all, every one finished:

| Setting | Easy | Medium | Hard | Turns a game (all players) |
|---|---|---|---|---|
| 3 players, beginners' map | 1% | 32% | 68% | 65 |
| 3 players, random map | 0% | 26% | 74% | 65 |
| 4 players, beginners' map | 2% | 34% | 64% | 75 |
| 4 players, random map | 3% | 33% | 65% | 75 |

In all, hard won 68%, medium 31% and easy 1%. A computer move took 0.6 ms
on average and 34 ms at the slowest, the engine's own work included.

With 5–6 players the bots build, hire, wall, improve and wake knights in
the special build phase and play their whole C&K turn as paired player 2.
`npm run bots:league -- 120 ck official 5 paired` (and `random`, 6
players, `specialBuild`) over 120 games per setting, 960 in all, every one
finished:

| Setting | Easy | Medium | Hard | Turns a game (all players) |
|---|---|---|---|---|
| 5 players, paired, 5–6 beginners' map | 3% | 34% | 63% | 67 |
| 5 players, paired, random map | 1% | 37% | 63% | 65 |
| 5 players, special build, 5–6 beginners' map | 3% | 38% | 59% | 64 |
| 5 players, special build, random map | 0% | 36% | 64% | 62 |
| 6 players, paired, 5–6 beginners' map | 0% | 43% | 58% | 72 |
| 6 players, paired, random map | 0% | 35% | 65% | 69 |
| 6 players, special build, 5–6 beginners' map | 3% | 38% | 60% | 69 |
| 6 players, special build, random map | 0% | 41% | 59% | 71 |

In all, hard won 61%, medium 38% and easy 1%. A move took 1.4–1.7 ms on
average and 126 ms at the slowest.

On the Seafarers scenarios (section 16 of the spec) the bots also build
ships toward spots across the sea once their island is full (roads and
ships scored by what each can reach), value gold and island chits, chase the
pirate off their ships with a knight, claim and build a wonder, and (hard)
sail for Cloth villages. `npm run bots:league -- 60 ck:seafarers-1-new-shores official 3`
(any scenario that combines, `official` or `random`, 3–6 players) plays them;
60 games per setting (120 for Cloth for Catan), 1,680 in all, every one
finished:

| Scenario | Players | Map | Easy | Medium | Hard | Turns |
|---|---|---|---|---|---|---|
| Heading for New Shores | 3 | official / random | 0% / 3% | 25% / 25% | 75% / 72% | 74 / 76 |
| | 4 | official / random | 5% / 0% | 40% / 42% | 55% / 58% | 83 / 82 |
| | 5 | official / random | 0% / 0% | 38% / 43% | 62% / 57% | 71 / 71 |
| | 6 | official / random | 2% / 0% | 30% / 45% | 68% / 55% | 72 / 71 |
| Through the Desert | 3 | official / random | 2% / 0% | 33% / 37% | 65% / 63% | 72 / 72 |
| | 4 | official / random | 0% / 0% | 38% / 45% | 62% / 55% | 73 / 77 |
| | 5 | official / random | 0% / 0% | 42% / 40% | 58% / 60% | 68 / 75 |
| | 6 | official / random | 0% / 0% | 33% / 33% | 67% / 67% | 81 / 85 |
| Cloth for Catan | 3 | official / random | 2% / 3% | 32% / 38% | 67% / 58% | 68 / 74 |
| | 4 | official / random | 3% / 2% | 46% / 34% | 52% / 64% | 74 / 80 |
| The Wonders | 3 | official / random | 2% / 0% | 37% / 37% | 62% / 63% | 74 / 79 |
| | 4 | official / random | 2% / 2% | 35% / 40% | 63% / 58% | 78 / 86 |

In all, hard won 62%, medium 37% and easy 1%. A move took 1.4–2.5 ms on
average; the bot's choice alone took about 1 ms (median) and at most 43 ms.

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

Online games have a chat: the 💬 button over the board opens a small window
with quick phrases and emoji. The host stamps who sent each message (plain
text, up to 200 characters, 5 messages per 10 seconds per friend) and keeps
the last 50, which friends get again when they rejoin. Chat is not part of
the game state (`web/src/net/chat.ts`).

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
npm test                                  # 445 tests: golden positions, official and generated maps, scenarios, bots, fuzzing
npm run demo -- list                      # list scenarios
npm run demo -- seafarers-3-fog-islands 4 my-seed   # play a bot game and print the board (add "random" for a generated map)
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
  board/       axial hex math, topology (vertices/edges/adjacency), map format, map generator
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
- **Scenario = data + hooks.** A `ScenarioDef` holds two maps: the
  rulebook's (`officialMap`, ASCII rows with pools, harbors, printed scenario
  spots, robber and pirate start) and the random layout (`map`: the base
  game's variable set-up, or for Seafarers `styledMap(printed map, style)`,
  which generates new maps in the printed map's style). It also holds the VP target, setup rounds, allowed and forbidden
  zones, and island bonuses. `mapSpecFor` picks the map by `options.layout`.
  It can also add
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
- **Game statistics.** `state.stats` (`src/engine/stats.ts`) keeps per-player
  counters that the log can't give reliably: resources produced by type, what
  the dice should have produced, cards traded, stolen, discarded and spent,
  development cards, and everyone's VP after each turn. `applyAction` updates
  it from how each hand changed during the action. It is optional (older
  saves have none) and `viewFor` only shows it once the game is over, since
  steals are hidden information during play.

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

Harbors are `'auto'` (spread over the coasts), `'ring'` (the base frame) or
fixed spots: `harborAt('3,1', 'NE', 'grain')` puts a grain harbor on the
north-east side of the hex at column 3, row 1; leave out the type and it is
drawn from the shuffled pool. `marks` holds a map's printed scenario spots
(villages, gift paths, fortresses...) as a hex plus a corner or side, for the
scenario's `init` hook. A spec may instead be `procedural`: it builds the
concrete spec from the game's RNG when the board is generated.

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
| Cities & Knights | In the browser game, progress cards included: `citiesAndKnights: true` on the base game with 3–6 players (5–6: the 5-6 Player Extension's commodities and Defender cards, paired players with knights and progress cards for player 2, or the special build phase with knights, walls, improvements, activating and promoting). Commodities, the event die and the barbarians, knights, city improvements and metropolises, city walls, all 54 progress cards with their effects, and the beginners' map. With Seafarers (section 16 of the spec): Heading for New Shores and Through the Desert (3–6 players), Cloth for Catan and The Wonders (3–4), to the scenario's VP + 2; knights by roads and ships and at sea, closed routes to knights, the robber and pirate waiting on the barbarian track until the first attack, the pirate chased by knights; the other scenarios are refused with the rulebook's reason (`ckScenarioError`). [`docs/cities-and-knights.md`](docs/cities-and-knights.md) |
| Options | `layout` official (default)/random, `tradeBuildMode` combined/separate, `fiveSixMode`, `tokenPlacement` spiral/random, `noAdjacentRed` (on), `noAdjacent2and12`, `noAdjacentSameNumber`, `friendlyRobber`, `discardLimit`, `setupGoldYield`, `victoryPoints`, `firstPlayer`, `citiesAndKnights` |

### Scenarios

| id | Name | Players | VP | Special rules implemented |
|---|---|---|---|---|
| `base` | Base game | 3–6 | 10 | The beginners' set-up, or the variable set-up (A–R spiral or random tokens). The 5–6 board has 30 hexes and 11 harbors |
| `seafarers-1-new-shores` | Heading for New Shores | 3–6 | 14 | Start on the main island; +2 VP for the first settlement on each small island. With 5–6 players the main island is the CATAN 5-6 island, dealt at random as the rulebook says, with six small islands around it |
| `seafarers-2-four-islands` | The Four Islands (5–6 players: The Six Islands) | 3–6 | 13 | Home islands are chosen at setup; +2 VP per foreign island; no desert, the robber starts on a 12 (on the 5–6 map, on the pasture 2 as drawn) |
| `seafarers-3-fog-islands` | The Fog Islands (5–6 players: The Fog Island) | 3–6 | 12 | Hidden fog stack. Roads and ships reveal hexes; the discoverer is paid. The 5–6 map hides 25 hexes, with two gold islets among them |
| `seafarers-4-through-the-desert` | Through the Desert | 3–6 | 14 | Three deserts wall off a strip (with 5–6 players five deserts and two strips); +2 VP per foreign area |
| `seafarers-5-forgotten-tribe` | The Forgotten Tribe | 3–4 | 13 | 18 gift paths (8 VP chits, 4 dev cards, 6 harbors, which are the scenario's only harbors). Gifted harbors must be placed at once if possible. The robber only visits numbered hexes |
| `seafarers-6-cloth-trade` | Cloth Trade (rulebook: "Cloth for Catan") | 3–4 | 14 | 3 starting settlements. 8 villages on intersections with 5 cloth each plus a supply of 10. The pirate steals cloth. Ends when 3 or fewer villages have cloth |
| `seafarers-7-pirate-islands` | The Pirate Islands | 3–4 | 10 + fortress | Pre-placed pieces. The fleet moves and attacks every adjacent player by the lower die. A 7 lets the roller rob anyone. A single shortest route via a marked intersection. Warships from knights; fortress battles |
| `seafarers-8-wonders` | The Wonders (rulebook: "The Wonders of Catan") | 3–4 | 4 levels, or 10 + most levels | Theater, Great Bridge, Monument, Great Wall and Cathedral with their card requirements and costs; a ship marks the claim; +1 VP per small island |
| `seafarers-9-new-world` | New World | 3–6 | 12 | The map is dealt at random; players place the harbors first; +1 VP per foreign island; robber and pirate start off the board |

All scenario rules were checked against the official 5th-edition Seafarers
rulebook, the Seafarers 5-6 rules (2023), the base rules and the FAQs on
catan.com.
[`docs/rules.md`](docs/rules.md) lists the sources and every remaining engine
choice.

### Maps

`options.layout` picks the board:

- **`'official'`** (the default): the set-up map printed in the rulebook for
  the scenario and player count. That is the base game's beginners' set-up
  (3–4 players, and the 5–6 extension's), every Seafarers scenario's 3- and
  4-player map, and the Seafarers 5-6 maps of scenarios 1–4
  (`src/scenarios/seafarers/officialMaps.ts`, with the page each map comes
  from). Only what the rulebook itself shuffles varies: the unexplored fog
  hexes, harbors printed blank (every harbor of the 5–6 maps), the
  Forgotten Tribe's harbor gifts and cards, New Shores' main island with
  5–6 players (the CATAN 5-6 variable set-up), and New World, which the
  rulebook deals at random into its frame.
- **`'random'`**: for the base game, the rulebook's variable set-up (the
  19- or 30-hex island with shuffled tiles, the A–R spiral or random numbers).
  For Seafarers, a new map generated in the style of the printed one
  (`src/board/generator.ts`), described below.

#### Generated maps

The printed map is read as a template: its frame (kept, so the board fits the
screen the same way), its islands (a home island of so many hexes, outer
islands of so many, the fog area, the desert line), which tiles and numbers
each area holds, its harbors, and where the robber and pirate start. A new
map keeps all of that and draws the rest from the seed:

1. The template may be mirrored left-right or top-bottom.
2. Islands of one area trade a hex (their total stays). Each island grows from
   a seed near its printed place, hex by hex, compact but irregular, keeping
   to its own part of the map and at least one sea hex from every other
   island (so ships are needed). No lakes.
3. Each area's tiles are dealt onto its hexes (gold only where the printed map
   has gold, and so on), avoiding clumps of one terrain.
4. Each area's numbers are dealt by a small local search: never a 6 next to an
   8 (the game option), no equal numbers side by side, no intersection worth
   more than 11 pips, each island's average close to fair.
5. The printed harbors go on the coasts of the areas they serve, spread by
   farthest-point sampling, never two on one intersection and never on a
   scenario spot.
6. Scenario spots follow the map: the scenario places gifts and villages on
   the new islands, or they stay with the parts of the map they belong to.

Every candidate is checked: every player can make the starting placement in
the starting area (with the distance rule, and a coastal spot each), islands
stay apart, numbers and harbors match the template, marks lie where the
scenario's hooks look for them, the map fits the frame. A failed candidate
is redrawn from the next sub-seed, each round keeping a little closer to the
printed shapes; after 60 the printed map is re-dealt instead (the tests never
see that happen). Everything comes from the game's seed, so the preview, the
game and every online guest get the same board.

| Scenario | Generated | Kept as printed |
|---|---|---|
| Heading for New Shores | the main island and three small islands (shapes, sizes ±1, places), tiles (gold on the small islands), numbers, harbor spots; with 5–6 players the tiles, numbers and harbor spots | the frame; tile, number and harbor counts per area; with 5–6 players the shapes, mirrored (the main island and its six small islands fill the frame) |
| The Four Islands | four (5–6 players: six) islands, their shapes and sizes, tiles, numbers, harbor spots | as above |
| The Fog Islands | the home island(s) and the unexplored area (12 hexes; 25 with 5–6 players, the gold islets mostly among them) | the face-down stack |
| Through the Desert | the line of three deserts (five with 5–6 players), the strip beyond it (two strips), the home area before it, the islets | each strip's own tiles and numbers |
| The Forgotten Tribe | the main island, the tribe islets and their tiles, the 18 gift spots | (the frame leaves the islands little room to move) |
| Cloth Trade | the two big islands, the four village isles, which isle gets which pair of village numbers | each isle's two villages face the big islands |
| The Pirate Islands | mirrors; the main island's tiles and numbers, the numbered pirate-island hexes, harbor spots | the fortress route, marked intersections, starting pieces and fleet circuit (the rules depend on them) |
| The Wonders | mirrors; the main island's tiles and numbers; the small islands' tiles (and so the gold) | the main island with its strait and desert wasteland (the wonders need them) |
| New World | an archipelago of 4–6 islands in the rulebook's frame | the component mix |

The rulebook draws the Seafarers boards with flat-topped hexes; the engine
turns them a quarter turn, so the board looks exactly like the book when a
phone shows it upright. [`docs/rules.md`](docs/rules.md) lists the sources
and the differences between printings.

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
  constraints hold for every scenario, player count and layout.
- **Official maps:** every official board is compared hex by hex, harbor by
  harbor, with the printed map (written down column by column as the book
  shows it) and with the rulebook's component lists. Different seeds give
  the same board except where the rulebook shuffles.
- **Generated maps:** 300 seeds per Seafarers scenario and player count, each
  compared with the printed map it imitates: the same frame, islands, tiles,
  numbers and harbors per area, the red-number rule, harbors on coasts apart
  from each other, robber and pirate starts, the scenario's spots, and (every
  tenth seed) a whole starting placement played by the engine. Also:
  determinism, variety between seeds, and bots finishing games on them.
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
- **Regression fingerprints** (`test/regression.test.ts`): base and
  Seafarers games replay exactly as before Cities & Knights existed, and
  3–4 player Cities & Knights games as before its 5–6 extension (and
  before its Seafarers combination).
- **Cities & Knights with Seafarers** (`test/ckSeafarers.test.ts`,
  `test/ckSeafarersBots.test.ts`): which scenarios combine and the
  reasons for the others, the VP targets, the robber and pirate waiting
  until the first attack, knights hired on land by a ship and moved to
  sea, closed routes to knights, opponents' knights on routes, displacing
  and retreating at sea, chasing the pirate, Road Building, the Bishop,
  the Diplomat, Intrigue and the Deserter with ships, gold, the merchant,
  harbors, the set-up city, Cloth for Catan's villages and pirate, The
  Wonders' win and costs; and computer players finishing a game on every
  scenario that combines, at every player count.

- **Heuristic bots** finish a full game in every scenario, supported player
  count and layout, using only moves the engine accepts.
- **Game statistics** reconcile after whole bot games: every hand equals its
  gains minus its losses, the bank and the log agree, and trades and steals
  balance between players.
- **Game clock** (`web/src/game/clock.ts`, fake timers): time adds up only
  while the clock runs, each moment goes to the player whose turn it is,
  a hidden page pauses it (an online host's doesn't), a saved clock comes
  back paused, and a guest's reading matches the host's whatever the two
  devices think the time is.
- **Browser** (`npm run test:e2e`, Playwright, phone viewport): a game
  against the computer that is reloaded and continued, a Seafarers board,
  the pass-and-play hand-over, a random map whose preview (after a 🎲
  reroll) is the board the game starts with, a generated Seafarers map whose
  rerolls change the islands but not how many there are, the 5–6 maps (the
  preview, its full view and the game agree; a 6-player Through the Desert
  game on the rulebook's map played up to a paired turn), and online games between two
  browsers through a local PeerJS broker and a local relay broker
  (`scripts/mqtt-broker.mjs`): a direct link on the host's random map, a
  relay-only link, and a friend who joins while the host is away. The end
  of a game: the results popup, the final map with the Results chip, and
  the game stats with their charts and tables. The game clock: the live
  timer, hiding it from the menu, pausing while the page is hidden or
  closed, and a friend seeing the host's time. Cities & Knights: a game
  against the computer from the new-game screen (the beginners' map, a city
  to start, three dice), a knight hired and activated, a city improvement
  paid in commodities, the barbarian track advancing and an attack with the
  city the player loses, an online game where a friend sees their own
  commodities and only counts for the others, progress cards played
  from crafted saves: the Alchemist's dice before the roll, the Spy taking
  a card, the Inventor's swap, the Diplomat's road, the Merchant and the
  Commercial Harbor's offers, a card that says why it can't be played, and
  a friend playing the Spy online who alone sees the cards; a 6-player
  game on the 5–6 board played up to a special build phase with knights
  and improvements on offer; and Cities & Knights on Heading for New
  Shores: the new-game switch (16 VP, The Four Islands refused with the
  reason), the robber and pirate waiting on the barbarian track, the first
  attack bringing them onto the board, a ship and a knight built, and a
  knight chasing the pirate.

Set `SIM_STEPS` and `SIM_SEEDS` to run longer simulations.

## Roadmap

[`docs/ROADMAP.md`](docs/ROADMAP.md) records what was done (rule check
against the official rulebooks, browser game, online play, GitHub Pages)
and the next steps.

## Intellectual property

"Catan" and its artwork, names and maps are trademarks and copyrighted
material of Catan GmbH. Island Traders is an independent, non-commercial fan
project that implements game mechanics. It uses its own name and art, and
mentions Catan only to say which rules it follows. The official-map option
reproduces the rulebooks' set-up maps as game data (which terrain and number
go where); the random maps are generated by the engine. It is not
affiliated with or endorsed by Catan GmbH. A commercial release, or one that
uses the Catan name, art or rule text, needs a license from Catan GmbH
(ip@catan.com).
