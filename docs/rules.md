# Rules coverage and engine decisions

This document maps the rules specification (5th-edition base rules and Almanac,
5th-edition Seafarers, the catan.com FAQs and the 2021 paired-player rule) to
the code, and lists every place where the engine had to choose because the
spec is silent or ambiguous. Each choice is a named constant, an option or
scenario data, so it can be changed without touching the state machine.

## 1–2. Components, board generation

| Rule | Where | Test |
|---|---|---|
| 19 terrain hexes, 18 tokens (no 7), 9 harbors (4×3:1, 5×2:1), 95 cards, 25 dev cards | `core/constants.ts`, `scenarios/base.ts` | `board.test.ts` |
| Piece caps 15/5/4 (+15 ships); a city returns its settlement piece | `PIECES_PER_PLAYER`, `buildCity` | `actions.test.ts`, simulation invariants |
| Hex graph: 54 intersections and 72 paths on the standard board | `board/topology.ts` | `board.test.ts` |
| Variable setup: A–R spiral from a random corner, counter-clockwise, skipping the desert | `placeSpiral` | spiral red-number check over all 19 desert spots × 6 corners |
| Random tokens with no adjacent 6/8 (toggle), plus optional 2/12 and same-number rules | `placeRandomTokens`, options | `board.test.ts` |
| 5–6 board: 30 hexes, 28 tokens, 11 harbors, 24 of each resource, 34 dev cards | `scenarios/base.ts` | `board.test.ts` |

**Verified caveats from the spec.** The standard graph has exactly 54 land
intersections and 72 land paths. The A–R sequence
`5 2 6 3 8 10 9 12 11 4 8 10 9 4 5 6 3 11` laid in the spiral never places a 6
next to an 8, whichever hex is the desert and whichever corner the spiral
starts from.

**Decisions**
- The frame is modelled as explicit sea hexes (the base board is 19 land hexes
  plus an 18-hex sea ring). Edges exist only between two on-board hexes.
- Base harbors sit on alternating sea hexes of the ring, starting at a corner.
  Seafarers maps place harbors with a deterministic farthest-point spread over
  coastal paths of producing land. Harbor types are shuffled per game.
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
  completes it.
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
- **Island bonus** (`rules.islandBonus`). You get Catan chits for your first
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

## Scenario-specific decisions

The spec summarises scenarios 5–8 without every number. These values are the
engine's choices, exported as constants or data:

| Scenario | Engine choice |
|---|---|
| Fog Islands | Placing a road or ship reveals every fog hex touching either end of it. The discoverer gets 1 card of the new land (a choice for gold). The fog stack and token stack are hidden |
| Forgotten Tribe | 10 gift paths (west and east coast of each tribe islet): 4 × 1-VP chits, 3 dev cards, 3 harbors. A ship built or moved onto the path collects the gift. Dev cards can't be played that turn. Harbors are held and placed on your own turn next to your own coastal building, never touching another harbor |
| Cloth for Catan | Villages are single-hex tribe islands with tokens 4/6/8/10 and 5 cloth each (`CLOTH_PER_VILLAGE`). You are connected by an own ship on the village's coast; cloth is paid in turn order from the roller until the village is empty. The third starting settlement goes clockwise with no resources. The game ends when 3 villages are empty (`EXHAUSTED_VILLAGES_TO_END`); most VP wins, then most cloth, then turn order |
| Pirate Islands | See below |
| Wonders | Five wonders (Great Wall: next to a desert; Great Bridge: buildings on 2 islands; Lighthouse: on a harbor; Colossus: 2 cities; Great Library: 6 public VP), 5 cards per level, 4 levels (`WONDERS`, `WONDER_LEVELS`). Claiming is free; one wonder per player. A point win needs 10 VP and a wonder level of at least 1 that is strictly higher than everyone else's |
| New World | Random archipelago with islands separated by sea. After setup, players place the 10 harbors (11 for 5–6) one at a time in turn order, on any coast not facing a desert and not touching another harbor. +1 VP per foreign island |
| New Shores (3p) | The rulebook's "pirate on hills 12" is read as the robber; this map starts the robber on the desert |

**Pirate Islands details:**
- No robber; a 7 only triggers discards.
- Every roll moves the fleet along a fixed 10-hex channel circuit by the lower
  die. The fleet then attacks each player with a building next to it, with
  strength equal to the higher die against that player's warship count.
  - Weaker defender: the defender loses a random card.
  - Stronger defender: the defender takes a free resource.
- Knights turn one of your ships into a warship.
- Ship routes: one unbranched line per player (no intersection with three of
  your ships), and ships cannot be moved.
- Fortress battles: at most once per turn. It needs a ship touching your
  fortress. Your warships face one die:
  - more warships: the fortress strength drops by one (it starts at 3)
  - fewer warships: you lose the ship at the fortress
  - a tie: nothing happens
- At strength 0 the fortress becomes your settlement.
- You win with 10 VP and your fortress captured.
