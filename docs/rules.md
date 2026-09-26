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

## Scenario rules and their sources

The rules spec summarises scenarios 5–8 in one line each. The official
rulebook PDFs on catan.com could not be read from the build environment (its
network policy blocks the host). The details below were therefore taken from:

- [UltraBoardGames scenario pages](https://www.ultraboardgames.com/catan/seafarers-game-rules.php)
  (seen through search-result excerpts)
- BoardGameGeek rules threads
- the source code of [JSettlers2](https://github.com/jdmonin/JSettlers2), a
  long-running open-source implementation of these scenarios (`SOCScenario`,
  `SOCSpecialItem`, `SOCGame`, `SOCVillage`, `SOCBoardAtServer`)

Where sources give a number it is used. Where none do, the choice is marked
*engine choice*. Maps are original layouts built to each scenario's structure.

| Scenario | Rules implemented | Source |
|---|---|---|
| Fog Islands | A road, ship **or settlement** touching a fog hex reveals it. New land gets a random number and pays the discoverer 1 card (gold: a free choice). Stacks are hidden | spec; JSettlers2 (settlements also reveal) |
| Forgotten Tribe | **18 gift spots:** 8 VP chits (1 VP each), 4 development cards set aside face down from the deck, 6 harbors. A ship built **or moved** onto a marked path takes the gift. A card works like a bought one. A harbor **must be placed at once** next to your coastal settlement/city if possible (a mandatory placement step), otherwise it is set aside and placed later on your turn. The tribe islands can't be settled | UltraBoardGames excerpts; JSettlers2 |
| Cloth Trade ("Cloth for Catan") | **8 villages on intersections** of 4 small islands (left and right end of each), each with a distinct number and **5 cloth**, plus a **general supply of 10**. A ship reaching a village establishes trade and pays **1 cloth at once**. The village's number pays each trader 1 more (current player first, then order of arrival); when the village is short, cloth comes from the general supply. 2 cloth = 1 VP. A route linking your settlement to a village is **closed**. You can't move the pirate until you have reached a village; **the pirate may steal cloth** instead of a card. **3 starting settlements** (forward, reverse, forward; resources for the third). No Longest Trade Route. The game ends **as soon as fewer than 4 villages have cloth**: most VP wins, then most cloth (*engine choice* for further ties: turn order from the current player) | UltraBoardGames excerpts; JSettlers2 |
| Pirate Islands | See below | UltraBoardGames excerpts; BoardGameGeek; JSettlers2 |
| The Wonders ("The Wonders of Catan") | See below | UltraBoardGames excerpts; JSettlers2 `SOCSpecialItem` |
| New World | Random archipelago; **players place the harbor tokens before the starting placement**, in turn order from the start player; start on any island(s); +1 VP per foreign island; 12 VP | spec; UltraBoardGames excerpt |
| New Shores (3p) | The rulebook's "pirate on hills 12" is read as the robber; this map starts the robber on the desert | spec |

**Pirate Islands**

- **Setup.** There is no robber. Each player has a pre-placed coastal
  settlement and ship on the main (east) island, then places two more
  settlements in the snake draft. Each player's pirate fortress is one of
  their own settlements, stacked on 3 chits.
- **Development cards.** With 3 players the VP cards are removed. With 4
  players they count as knights.
- **The pirate fleet.**
  - Every roll, before production and before handling a 7, it sails
    clockwise around the two desert islets by the **lower die**. That die is
    also its **strength**.
  - It attacks only if **exactly one** player has buildings next to it.
  - Stronger fleet: the player discards **1 random card plus 1 per city**.
  - Tie: nothing happens.
  - Weaker fleet: the player picks a free resource; on a 7 this happens
    before discards.
- **A 7.** Players discard as usual. Then the roller **may rob any player**
  or rob nobody.
- **Shipping route.** One unbranched route per player. It starts at a coastal
  building on the main island and passes the **marked intersection of your
  colour** on the way to your fortress. That intersection is also a
  settlement spot open only to you. Ships can be moved, within these limits.
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
- *Engine choice:* the fleet circuit on this original map.

**Wonders**

| Wonder | Requirement to start | Cost per level |
|---|---|---|
| Theater | 2 cities | 1 brick, 3 wool, 1 lumber |
| Great Bridge | a settlement at the strait | 1 wool, 1 grain, 3 lumber |
| Monument | a city at a harbor and a trade route of at least 5 | 2 ore, 3 grain |
| Great Wall | a settlement at the desert wasteland | 3 brick, 1 grain, 1 lumber |
| Cathedral | a city and 6 VP | 1 brick, 3 ore, 1 grain |

- To claim a wonder, meet its requirement and **put one of your unplaced ships
  on its card**. One wonder per player.
- Each wonder has four levels, and you may build several in one turn.
- You win by finishing all four levels, or with 10 VP and more levels than
  any other player.
- There is no pirate.
- Starting settlements may not go on the small islands, the wasteland, the
  strait intersections or the intersections next to them. All of these open
  up after setup.
