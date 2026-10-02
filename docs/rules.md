# Rules coverage and engine decisions

This document maps the rules specification (5th-edition base rules and Almanac,
5th-edition Seafarers, the catan.com FAQs and the 2021 paired-player rule) to
the code. It says where scenario details come from, and lists the places
where the engine still had to choose because no source settles the point.
Each choice is a named constant, an option or scenario data, so it can be
changed without touching the state machine.

## 1–2. Components, board generation

| Rule | Where | Test |
|---|---|---|
| 19 terrain hexes, 18 tokens (no 7), 9 harbors (4×3:1, 5×2:1), 95 cards, 25 dev cards | `core/constants.ts`, `scenarios/base.ts` | `board.test.ts` |
| Piece caps 15/5/4 (+15 ships); a city returns its settlement piece | `PIECES_PER_PLAYER`, `buildCity` | `actions.test.ts`, simulation invariants |
| Hex graph: 54 intersections and 72 paths on the standard board | `board/topology.ts` | `board.test.ts` |
| Variable setup: A–R spiral from a random corner, counter-clockwise, skipping the desert | `placeSpiral` | spiral red-number check over all 19 desert spots × 6 corners |
| Random tokens with no adjacent 6/8 (toggle), plus optional 2/12 and same-number rules | `placeRandomTokens`, options | `board.test.ts` |
| 5–6 board: 30 hexes, 28 tokens, 11 harbors, 24 of each resource, 34 dev cards | `scenarios/base.ts` | `board.test.ts` |
| Official maps (default, `layout: 'official'`): the beginners' set-ups and the Seafarers set-up diagrams (3, 4 and, for scenarios 1–4 and 9, 5–6 players) | `scenarios/base.ts`, `scenarios/seafarers/officialMaps.ts` | `officialMaps.test.ts` |
| Random maps (`layout: 'random'`): the base game's variable set-up, and Seafarers maps generated in the style of the printed ones | `ScenarioDef.map`, `board/generator.ts` | `generator.test.ts`, `generatedGames.test.ts`, `board.test.ts`, simulations |

**Verified caveats from the spec.** The standard graph has exactly 54 land
intersections and 72 land paths. The A–R sequence
`5 2 6 3 8 10 9 12 11 4 8 10 9 4 5 6 3 11` laid in the spiral never places a 6
next to an 8, whichever hex is the desert and whichever corner the spiral
starts from.

**Decisions**
- The frame is modelled as explicit sea hexes (the base board is 19 land hexes
  plus an 18-hex sea ring). Edges exist only between two on-board hexes. On
  the official Seafarers maps the ring of sea around the printed hexes is the
  frame; the pirate hexes printed on the frame are part of it.
- Official maps keep the harbors where the rulebook prints them, with their
  printed types; harbors printed blank get shuffled types.
- On random maps, base harbors sit on alternating sea hexes of the ring,
  starting at a corner (the frame's harbor spots). Generated Seafarers maps
  keep the printed harbors (their number and types) and put them on coastal
  paths of producing land in the areas the printed ones serve, spread by
  farthest-point sampling from a random first spot: never two on one
  intersection, a free intersection between them where the coast allows, and
  never on a scenario spot. Harbor types are shuffled per game.
- When the map author fixes number tokens, they are exempt from the adjacency
  rules. Only randomly placed tokens are constrained.

## 3. Setup

| Rule | Where |
|---|---|
| Players roll; highest starts (re-roll among ties); `firstPlayer` option | `createGame` |
| Round 1 clockwise, round 2 counter-clockwise; second settlement need not connect | `setupOrder`, `setupSettlement` |
| Resources for the second settlement, one per adjacent terrain hex | `startingResources` |
| Starting road touches the settlement just placed; coastal settlements may take a ship; no ship next to the pirate | `roadError` / `shipError` with `setupVertex` |
| Robber starts on the desert, or off-board when there is none | `MapSpec.robber` |

**Decisions**
- Gold next to the second settlement pays one chosen resource per gold hex
  (option `setupGoldYield: 'choose' | 'none'`, default `choose`).
- If a crowded board leaves a player with no legal starting spot, that
  placement is skipped (logged) rather than deadlocking.

## 4. Turn structure

Phases: `preRoll → (discard → robber | gold) → main → endTurn`. Development
cards may be played in `preRoll` and `main`. `tradeBuildMode: 'combined'`
(the default) lets trading and building interleave. In `'separate'` mode,
trading ends at the first build, buy or ship move, so a harbor built this turn
can never be traded through.

Victory is checked after every successful action, for the player whose part of
the turn it is, and at the start of every turn and part. A player who already
has the target when their turn starts wins before rolling.

## 5. Production

- Hexes with the rolled number pay unless the robber is on them.
- **Bank shortage:** demand is totalled per resource first. If the bank can't
  cover it, nobody gets that resource, unless only one player is owed it, in
  which case they get what is left. Other resources are unaffected.
- **Gold:** after normal production, owners choose 1 card per settlement and 2
  per city (same or different). Choices are limited to what the bank holds and
  are resolved as they arrive. If the bank is empty, the choices lapse.

## 6. The 7 and the robber

- Every player with more than `discardLimit` (7) cards discards half, rounded
  down. Discards happen in parallel, once each. Nothing else can happen until
  all discards resolve.
- The robber must move to a different land hex (the desert is allowed). In
  Seafarers the player may move the pirate to a different sea hex instead.
- The mover chooses a victim among the opponents adjacent to the new hex
  (buildings for the robber, ships for the pirate). The steal is mandatory,
  uniformly random, and yields nothing from an empty hand. The stolen card
  is logged privately to the thief and the victim.

**Decisions**
- A player with no cards may still be chosen as the victim.
- `friendlyRobber` (house rule): hexes next to an opponent with 2 or fewer
  public VP are off limits, unless no other hex is available.

## 7. Trading

- `proposeTrade` / `acceptTrade` / `confirmTrade` / `rejectTrade` /
  `cancelTrade`. The active player may address one or more players, and the
  proposer confirms with one of the players who accepted. Non-active players
  may only make counter-offers to the active player; accepting a counter-offer
  completes it, and the active player can turn one down.
- **Open offers** (*engine addition*, a table-talk convenience): the active
  player may name only one side (`open: true`), e.g. "who gives me 1 brick?"
  or "what will you give for my brick?". Nobody can accept an open offer as
  it stands. The others answer with counter-offers (`replyTo`) that keep the
  named side, or decline. Answering counts as the player's reply. Taking one
  answer closes the open offer and the other answers; withdrawing it closes
  them too.
- Card-for-card only: no gifts, no same resource on both sides, no trades
  between two non-active players, no development cards. Offers are public.
  Holdings are validated again when the trade executes.
- Maritime trade: 4:1, 3:1 at an owned generic harbor, and 2:1 only for the
  harbor's own resource. Multiples and mixed lots are fine (e.g. 8 ore → 2
  cards).

## 8. Building

Costs, the distance rule (it applies across every path, straits included),
connectivity (you cannot extend through an opponent's building), and supply
limits live in `rules/queries.ts`. A building can never be moved.

## 9. Development cards

- One card per turn, never a card bought in the same part of the turn. VP
  cards are exempt and count automatically, including on purchase.
- **Knight:** robber or pirate move, with no discards; counts toward Largest
  Army.
- **Road Building:** two free roads or ships (Seafarers).
- **Year of Plenty:** any two cards; if the bank holds fewer than two, you take
  what is left.
- **Monopoly:** takes every card of the named resource.

**Decision:** Road Building may be ended early (`endRoadBuilding`). It also
ends automatically when there is no legal placement.

## 10. Longest Road / Longest Trade Route, Largest Army

`rules/longestRoute.ts` runs a depth-first search over edges from every piece
in both directions, marking visited edges.

- Opponent buildings stop the trail; it may end there but not pass through.
- A road↔ship change is allowed only at the owner's own building.
- Award logic:
  - the holder keeps the card while still (jointly) longest with at least 5
  - otherwise a unique leader with at least 5 takes it
  - otherwise the card is set aside

  It is re-evaluated after every road, ship, settlement and ship move.

Largest Army: the first player to 3 played knights takes it. Afterwards it
changes hands only for strictly more.

## 12. Seafarers

- **Ships.** A ship sits on a sea or coast path. It connects to your own
  coastal building or your own ship, never directly to a road; the only link
  between roads and ships is your own settlement or city. Ships let you settle
  a new coast.
- **Closed routes.** A route is closed when a chain of ships links two
  *different* own buildings. Opponent buildings are ignored here, so a closed
  route stays closed.
- **Moving ships.** You may move one ship per turn, during your build phase
  (never before rolling). It may not be a ship built this turn, it may not sit
  next to the pirate, and it must be the end of an open route. "End" means one
  endpoint touches none of your other ships or buildings, or the ship lies on
  a loop (a ring, or a line that returns to the same settlement), so lifting
  it strands nothing. The ship moves anywhere a new ship could legally be
  built.
- **Pirate.** The pirate blocks building and moving ships on its hex's paths.
  It robs ship owners only. It never blocks roads, settlements or harbors.
- **Island bonus** (`rules.islandBonus`). You get VP chits (the rulebook's "Catan chits") for your first
  settlement in each foreign zone. "Home" is either fixed zones or the zones
  of your starting settlements.

## 13. 5–6 players

- **Paired players (default).** After Player 1 ends their turn, Player 2 (seat
  +3) acts:
  - may trade with the supply, build, play one development card and (in
    Seafarers) move a ship
  - may not roll or trade with players
  - may win during this part

  Both markers then pass left. Cards bought in one part can be played in any
  later part.
- **Legacy Special Build Phase** (`fiveSixMode: 'specialBuild'`). After each
  turn, every other player in clockwise order may build or buy with the cards
  in hand. There is no trading, no card play and no ship moves, and nobody can
  win during it.

Both modes apply in every scenario that takes 5–6 players: the base game,
Seafarers scenarios 1–4 on the Seafarers 5-6 maps, and New World. With 5–6
players Seafarers uses the 5–6 bank (24 of each resource) and the 34-card
development deck, as in the base game.

## 14. Cities & Knights

The *Cities & Knights* expansion is a rules module (`GameOptions.citiesAndKnights`,
state in `GameState.ck`, code in `src/ck/`) rather than a scenario: it plays on
the base game with 3–6 players (5–6 with its 5-6 Player Extension) and on the
Seafarers scenarios its rulebooks combine it with (Heading for New Shores and
Through the Desert, 3–6 players; Cloth for Catan and The Wonders, 3–4), to the
scenario's VP + 2. It follows the 5th-edition *Game Rules & Almanac* (2020),
with the 2025 rulebook for unclear points. The rules as implemented, every
engine choice, the progress cards and how each is played, the beginners' map,
the 5–6 extension and the Seafarers combination (section 16: which scenarios
and why, knights at sea, closed routes, the pirate waiting by the barbarian
track) are in [`cities-and-knights.md`](cities-and-knights.md).

## Scenario rules and their sources

Scenarios 1–9 were checked against the official rulebooks on catan.com:

- the 5th-edition *Catan: Seafarers* rulebook (`catan-seafarers_2021_rule_book_201201.pdf`,
  rules as of December 1, 2020), including the five wonder cards printed with
  scenario 8
- the 2025 *CATAN – Seafarers* rulebook, used only where the 5th edition is
  ambiguous (it is marked where this happens)
- the *Seafarers 5-6* 2023 rules (catan.com, `Catan Seafarers 5-6 2023 Rules 220313.pdf`,
  uploaded March 2024): paired players, the 5–6 maps of scenarios 1–4
  (pages 6–13) and New World (pages 22–23). The June 2023 upload
  (`CATAN_ Seafarers 5-6 Player Extension_0.pdf`) has the same diagrams; the
  2020 printing (`catan_seafarers_5-6_2020_rules.pdf`) has the same maps
  without the robber and pirate figures. The 2025 *CATAN – Seafarers 5–6
  Player* rulebook has new maps and is not used, except that it says outright
  that New Shores' main island uses the CATAN 5–6 variable set-up
- the 5th-edition base rules and Almanac (2020), the 2022 *CATAN 5-6* rules and
  the Seafarers FAQ on catan.com

The rulebook's own names are "Cloth for Catan" and "The Wonders of Catan"; the
engine calls them **Cloth Trade** and **The Wonders**. Anything the rulebooks
leave open is marked *engine choice*.

### Maps

**Official maps** (the default) are the set-up diagrams of the 5th-edition
rulebook (pages 9–29), for 3 and for 4 players where the book has two, and
for 5–6 players the diagrams of the Seafarers 5-6 rules (scenarios 1–4 and
New World; see below). They
were read from the PDF's tile images and number tokens, compared with the
2007 (4th-edition) rulebook, and checked against each scenario's component
list. The book draws flat-topped hexes; the engine turns the map a quarter
turn counter-clockwise (the book's top edge on the left), and the web board
turns it back on a phone held upright.

- **What the rulebook shuffles, the engine shuffles:** the Fog Islands'
  face-down stack of 12 hexes and 10 numbers (the unexplored spots are
  fixed); the harbor types where the map prints blank harbors (Heading for
  New Shores with 4 players, Cloth, Pirate Islands, Wonders); the Forgotten
  Tribe's 6 harbors (placed face down, then turned over) and its 4
  development cards; and all of New World, which the rulebook deals at
  random into its frame of 42 hexes (63 for 5–6 players, from the Seafarers
  5-6 rules), with no two red numbers side by side.
- **Harbor types.** The 5th edition says the harbor tokens are "shuffled …
  and then placed randomly face up as shown in the scenario map" unless
  stated otherwise, yet most maps print specific types. The 2025 rulebook
  settles it: printed types are fixed, and "some scenarios have you place
  ports face up randomly … as shown by the question mark on a blank port".
  The engine follows that.
- **Printings differ for the Fog Islands with 4 players.** The 2007 and 2015
  printings have other numbers on some hexes and swap the 12 and the
  mountains 8; the 2020 rules' map (used here) matches the component list.
  Its text puts the robber on the 12; the drawing leaves the figure on the
  8, where the 12 used to be.
- **Printed spots** come with the maps: the villages and their numbers
  (Cloth), the 8 VP chits, 6 harbors and 4 development cards on the tribe
  islands' coasts (Forgotten Tribe), the fortresses, marked intersections,
  pre-placed settlements and ships, and the fleet circuit (Pirate Islands),
  and the two strait and five desert-wasteland intersections (Wonders).
- **Starting positions:** the robber and pirate start where the diagram and
  text put them. The beginners' base maps also show starting settlements;
  those are not pre-placed, the snake draft is played as usual.

**The 5–6 player maps** of scenarios 1–4 (Seafarers 5-6 rules, diagrams on
pages 7, 9, 11 and 13, component lists on pages 6, 8, 10 and 12) were read
the same way: tiles, number tokens, harbors and the robber and pirate
figures from the PDF, each checked against its component list. The book
draws them upright, seven columns of flat-topped hexes in the larger 5–6
frame; turned like the others, they show as printed on an upright phone.
One map serves 5 and 6 players. The rules text refers back to the 3–4
player scenarios, so the scenario rules and VP targets do not change.

- **Harbors:** "after you build the board, randomly place the harbor
  tokens" (pages 2–3): every 5–6 harbor is blank, its type drawn from the
  scenario's list. 11 tokens (6 special with 2 wool, 5 generic) for
  scenarios 1, 2 and 4; 9 (one of each special, 4 generic) for scenario 3.
  **Through the Desert lists 11 tokens but its diagram has 10 harbor
  spots:** the engine places 10, drawn from the 11 (one stays in the box).
- **1 Heading for New Shores:** the main island is drawn blank and built
  "according to the rules for CATAN 5-6" (the 2025 rulebook: "using the
  CATAN 5–6 Variable Setup rules"): its 30 hexes and 28 numbers are dealt
  at random in the official map too. *Engine choice:* the numbers are dealt
  as in the base game's 5–6 random set-up (at random, with the game's number
  rules: by default no 6 next to an 8) rather than by the alphabetical
  spiral. Six small islands (two of three hexes, four single hexes, 3
  gold), fixed. The robber starts on the hills 12, as drawn.
- **2 The Six Islands** (the 5–6 name of The Four Islands): six islands of
  5–6 hexes, no desert or gold. The 3–4 text puts the robber on "the hex
  with a 12"; this map has two 12s and the diagram stands the robber on the
  pasture 2, which the engine follows (a 2 is as unproductive as a 12).
- **3 The Fog Island:** 25 unexplored hexes with two face-up gold islets
  among them; the face-down stack holds 12 sea, 1 gold, 2 fields, 2 hills,
  2 mountains, 3 pasture and 3 forest with 13 numbers (2 2 3 4 5 5 6 8 9 9
  10 11 12). Unlike the 3–4 maps, the face-up island has a desert; the
  diagram puts the robber there.
- **4 Through the Desert:** five deserts in a line cut off two strips, a
  sea hex apart (fields 5, pasture 2, gold 4, mountains 6, hills 11; forest
  12, fields 5, mountains 3, hills 6). *Engine choice:* each strip is a
  foreign area of its own (2 VP each), as each is a separate land area
  outlined on its own on the diagram. The robber starts on the middle
  desert.

seafarers-generator.com was used as a cross-check: its "recommended"
layouts (the rulebook's example set-up, its site says), rendered several
times from its own page in a browser. It links the June 2023 rules. Where it
differs, the rulebook is followed:

| Map | seafarers-generator.com | Rulebook (followed) |
|---|---|---|
| New Shores 5–6 | the southern islets dealt at random (4–6 hexes over six spots, the robber anywhere); 3–4 deserts on its main island | four single-hex islets, fixed (gold 10, fields 3, hills 12 with the robber, mountains 6); the main island's 30 hexes of CATAN 5-6 with its 2 deserts |
| The Six Islands | the two southern islands dealt at random (the robber not on the pasture 2); on the eastern and western middle islands the hills 10 and forest 10 dealt at random and a 10 drawn on the sea hex between them | all 32 hexes fixed; the robber on the pasture 2 |
| The Fog Island | hills 2 where the book has fields 2; numbers 20 and 13 where it has 10 and 12; the harbor of the fields 6 on its south-east side, not north-east | as printed |
| Through the Desert 5–6 | the recommended layout does not load (a script error); the random one moves the islets between spots and has an 11th harbor, on the north-east side of the pasture 12 at the top | everything fixed; 10 harbor spots as drawn |
| all four | some harbor types fixed | all harbors blank, types drawn (pages 2–3) |

Everything else agrees: the frame, New Shores' northern islands and harbor
spots, the four northern islands of The Six Islands, the rest of the Fog
Island (fog hexes, gold islets, its other harbors), and the 10 harbor spots and the
desert line of Through the Desert.

**Random maps** (`layout: 'random'`) are the base game's variable set-up and,
for Seafarers, new maps generated in the style of the rulebook's
(`board/generator.ts`; the README describes the steps). The printed map is the
template: the frame, how many islands of what size and where, which tiles
and numbers each area holds (gold only where the printed map has it), the
harbors, the robber and pirate starts and the scenario's spots. Islands get
new shapes and places; tiles, numbers and harbors are dealt anew with the
red-number rule and a balance check; every map is checked before use (the
starting placement fits, islands a sea hex apart, the scenario's spots where
its rules look for them). *Engine choices* per scenario:

- **Through the Desert:** the deserts (three, or five with 5–6 players) stay
  a straight line that cuts the strip off from the home area (with 5–6
  players, both strips, each touching the line and neither the other); each
  strip keeps its printed tiles.
- **Heading for New Shores, 5–6 players:** the 30-hex main island, the sea
  around it and the small islands fill the 5–6 frame, so new maps keep the
  printed shapes (mirrored) and deal the tiles, numbers and harbors anew.
- **The Fog Island, 5–6 players:** the two gold islets may touch the
  unexplored hexes, as printed (on nine maps in ten they lie among them);
  every other island keeps a sea hex from the fog.
- **The Forgotten Tribe:** the 18 gift spots are spread over the new tribe
  islets' coasts and the gifts dealt onto them.
- **Cloth Trade:** each isle keeps two villages on the corners facing the big
  islands, with one of the printed pairs of numbers (9/10, 3/6, 8/11, 5/4).
- **The Pirate Islands:** the fortress route, marked intersections, starting
  pieces and fleet circuit stay as printed (mirrored with the map; the fleet
  still sails clockwise); the tiles and numbers of the main island and of the
  numbered pirate-island hexes are dealt anew, harbors placed anew.
- **The Wonders:** the main island stays as printed with its strait and
  wasteland (mirrored with the map); its tiles and numbers, apart from the
  deserts, are dealt anew. The frame leaves the small islands exactly their
  printed room, so they only move with the mirror; their tiles (and so the
  gold) are dealt anew.
- **New World:** an archipelago of 4–6 islands in the rulebook's frame, a sea
  hex apart.

| Scenario | VP | Rules implemented |
|---|---|---|
| 1 Heading for New Shores | 14 | Start on the main island. +2 VP for your first settlement on each small island. 8 harbors with 3 players, 9 with 4, 11 with 5–6. The 3-player text says the *pirate* starts on the hills 12; this is read as the robber, which the 3-player map draws there (the 4-player map puts it on the desert, the 5–6 map on a small island's hills 12). 3–6 players |
| 2 The Four Islands | 13 | Start on one or two islands; +2 VP for your first settlement on each other island. **No desert and no gold; the robber starts on a 12** (5–6 players: The Six Islands, the robber on the pasture 2 as drawn). 9 harbors, 11 with 5–6. 3–6 players |
| 3 The Fog Islands | 12 | A **road or ship** reaching an intersection of a fog hex reveals it (settlements do not). New land gets a number from the hidden stack and pays the discoverer 1 card of its type (gold: *engine choice*, a free pick). **No desert on the face-up island; the robber starts on its 12** (5–6 players: The Fog Island, 25 unexplored hexes, a desert with the robber). 8/9/9 harbors. 3–6 players |
| 4 Through the Desert | 14 | Three deserts cut off a strip (5–6 players: five deserts, two strips). +2 VP for your first settlement in each foreign area (a strip or an islet). Robber on a desert. 8/9/10 harbors. 3–6 players |
| 5 The Forgotten Tribe | 13 | 18 gift spots: 8 VP chits (1 VP each), 4 development cards taken from the top of the deck (face down), 6 harbors (face up). **The 6 harbors are the scenario's only harbors: one 2:1 per resource and one 3:1.** A ship built **or moved** onto a spot takes the gift. A card works like one bought this turn. A harbor must be placed at once next to your coastal settlement if possible, never on or next to another harbor; otherwise it is set aside and placed later on your turn. The tribe islands can't be settled. **The robber may only move to hexes with a number**, so never to the tribe islands or back to the desert |
| 6 Cloth Trade | 14 | See below |
| 7 The Pirate Islands | 10 + fortress | See below |
| 8 The Wonders | see below | See below |
| 9 New World | 12 | The map is dealt at random (official: the rulebook's frame; random layout: an archipelago of 4–6 islands in the same frame, a sea hex apart). **3–4 players: 23 land hexes, no desert and no gold, 9 harbors. 5–6 players: 42 land hexes incl. 3 deserts and 4 gold, 11 harbors.** Players place the harbor tokens before the starting placement, in turn order from the start player. Start on any island(s). +1 VP for your first settlement on each other island. **The robber and pirate start off the board** and enter when first moved |

**Cloth Trade**

- **Setup.** Three starting settlements: forward, reverse, forward. Only the
  third pays starting resources. Settlements may never go on the 4 village
  islands, and the robber may not enter them.
- **Villages.** 8 villages on intersections of 4 small islands (the left and
  right end of each), each with a distinct number and **5 cloth**, plus a
  **general supply of 10**.
- **Trade.** A ship reaching a village establishes trade and pays **1 cloth**
  from that village (nothing if it is empty). When the village's number is
  rolled, each trader gets 1 more (*engine choice*: current player first,
  then order of arrival). If the village runs short, the rest comes from the
  general supply; an empty village pays nothing.
- **Scoring.** 2 cloth = 1 VP. No Longest Trade Route.
- **Ships.** A route linking your settlement to a village is **closed**.
- **Pirate.** You can't move it until you have reached a village. It may
  steal a card **or a cloth**.
- **End.** 14 VP on your turn, or as soon as **3 or fewer villages still have
  cloth**: most VP wins, then most cloth (*engine choice* for further ties:
  turn order from the current player).

**Pirate Islands**

- **Setup.** There is no robber. Each player has a pre-placed coastal
  settlement and ship on the main (east) island, then places two more
  settlements in the snake draft. Each player's pirate fortress is one of
  their own settlements, stacked on 3 chits; it doesn't produce until it is
  conquered. 8 harbors (5 special, 3 generic).
- **Development cards.** With 3 players the VP cards are removed. With 4
  players they count as knights. Knights are used only to arm warships.
- **The pirate fleet.**
  - Every roll, before production and before handling a 7, it sails
    clockwise around the two desert islets by the **lower die**. That die is
    also its **strength**.
  - It attacks **every player with a building next to its hex** (in seat
    order from the roller). Their strength is their number of warships.
  - Stronger fleet: the player discards **1 random card plus 1 per city**.
  - Tie: nothing happens.
  - Weaker fleet: the player picks a free resource; on a 7 this happens
    before discards.
- **A 7.** Players discard as usual. Then the roller **may rob any player**
  or rob nobody.
- **Shipping route.** One unbranched route per player. It starts at a coastal
  building on the main island and passes the **marked intersection of your
  colour** on the way to your fortress. **Every new ship must bring the route
  one step closer along a shortest path** (first to the marked intersection,
  then to the fortress), so a route can't veer off to block others, and it
  can't continue past the fortress. The marked intersection is also a
  settlement spot open only to you. Ships can be moved within these limits.
- **Knights.** A knight turns the **rearmost normal ship** of the route
  (closest to its start) into a warship.
- **Fortress battles.** A battle is allowed once the route reaches the
  fortress, and it **ends your turn**. Roll one die:
  - more warships than the roll: remove a chit
  - equal: lose the ship next to the fortress
  - fewer: lose the **two** ships closest to it

  After 3 wins the fortress becomes your settlement, which produces and can
  be upgraded. When every fortress has fallen, the fleet leaves.
- **Winning.** 10 VP and your own fortress. There is no Longest Trade Route
  or Largest Army.
- The fleet circuit is the one drawn on the rulebook's map (14 sea hexes
  around the two desert islets); generated maps keep it.
  The 5th edition
  says you *can* attack at the end of your turn; the attack is an action you
  choose (the 2025 edition makes it automatic).

**Wonders**

| Wonder | Requirement to start | Cost per level |
|---|---|---|
| Theater | 2 cities | 1 brick, 3 wool, 1 lumber |
| Great Bridge | a settlement at the strait | 1 wool, 1 grain, 3 lumber |
| Monument | a city at a harbor and a trade route of at least 5 | 2 ore, 3 grain |
| Great Wall | a settlement at the desert wasteland | 3 brick, 1 grain, 1 lumber |
| Cathedral | a city and 6 VP | 1 brick, 3 ore, 1 grain |

- To claim a wonder, meet its requirement and **put one of your unplaced ships
  on its card**. One wonder per player, and nobody else may take it.
- Each wonder has four levels, and you may build several in one turn.
- **Your first settlement on each small island earns 1 VP.** (The 5th
  edition's wording could also be read as 1 VP per settlement; the 2025
  rulebook settles it as one per island.)
- You win by finishing all four levels, or with 10 VP and more levels than
  any other player.
- There is no pirate. The robber starts on a desert.
- Starting settlements may not go on the small islands, the wasteland, the
  strait intersections or the intersections next to them. All of these open
  up after setup. The wasteland is the five intersections marked around the
  deserts (brown squares) and the strait the two marked with purple squares;
  generated maps keep them. (Games saved from the older random maps, which
  had no marks, take every intersection next to a desert and every land
  intersection next to the strait's sea hex.)
