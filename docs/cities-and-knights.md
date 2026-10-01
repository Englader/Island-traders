# Cities & Knights: rules as implemented

This is the specification the engine follows for the *Cities & Knights*
expansion, with the source page for each rule. Phase 1 (this document and the
engine core in `src/ck/`) covers everything except the progress-card effects,
which are listed in full below for phase 2.

## Sources

- **Primary:** *Catan: Cities & Knights, Game Rules & Almanac*, 5th English
  edition (copyright 2020; catan.com
  `sites/default/files/2021-06/catan_c_k_2020_rule_book_200708.pdf`, 20
  pages). Page numbers below are this booklet's. It matches the 5th-edition
  era of the Seafarers rules the engine already follows.
- **Cross-check, used only where the 2020 text is unclear:** the 2025
  *CATAN – Cities & Knights* rulebook (6th edition; catan.com
  `sites/default/files/2025-03/CN3087 CATAN–Cities&Knights_ Rulebook.pdf`,
  16 pages). It renames several improvements and progress cards and moves
  some rules (noted where it matters).
- **For phase 5:** the *Cities & Knights 5-6 Player Extension* rules (2020;
  catan.com `sites/default/files/2021-08/catan_c_k_5-6_2020_rules.pdf`, 4
  pages).

The engine enables the expansion with `GameOptions.citiesAndKnights: true`.
It is a rules module, not a scenario: its state lives in `GameState.ck`, and
every rule is keyed on that, so games without it are unchanged (a regression
test, `test/regression.test.ts`, replays base and Seafarers games recorded
before the expansion existed). For now it combines with the base game for 3–4
players; Seafarers scenarios and 5–6 players come later (see "Seams").

## 1. Components (p. 2, p. 4)

| Component | Count | Engine |
|---|---|---|
| Commodity cards: paper (forest), cloth (pasture), coin (mountains) | 12 each | `ck.bank`, `COMMODITY_BANK` |
| Progress cards: trade (yellow), politics (blue), science (green) | 18 each, 54 | `ck.decks`, `PROGRESS_CARDS` |
| "Defender of Catan" VP cards | 6 | `ck.defenderCards`, `DEFENDER_CARDS` |
| Knights per player: 2 basic, 2 strong, 2 mighty | 6 | `ck.knights`, `KNIGHTS_PER_LEVEL` |
| City walls per player | 3 | `ck.players[p].walls`, `MAX_CITY_WALLS` |
| Metropolises (trade, politics, science) | 3 | `ck.metropolises` |
| Merchant | 1 | `ck.merchant` |
| Barbarian ship and track | 1 | `ck.barbarians`, `BARBARIAN_TRACK` |
| Event die: 3 ship faces, a blue, a green and a yellow city gate | 1 | `EVENT_DIE` |
| Production dice: 1 yellow, 1 red | 2 | `turn.dice = [yellow, red]` |

From the base game: the board, robber, harbors, 5 settlements, 4 cities and
15 roads per player, the resource cards and the Longest Road card. **Set
aside:** the development cards, Largest Army and the building cost cards
(p. 2). The engine builds no development deck in a C&K game, and
`buyDevCard` is refused.

The barbarian tile (p. 4, illustration) has the ship's starting space and 7
more spaces; the seventh is the landing. The ship attacks on its 7th move.

## 2. Setting up (pp. 3–4, p. 20)

- **Board.** "Normally, you play Cities & Knights on a random, variable game
  board", but the rulebook recommends its beginners' map for a first game
  (p. 3). The engine's official layout (`layout: 'official'`, the default) is
  that map; `layout: 'random'` is the base game's variable set-up.
- **Supply.** Commodities in three stacks; the three progress decks shuffled
  separately, face down (`newDecks`, from the game's seeded RNG). The robber
  starts on the desert (p. 4). The barbarian ship starts on its first space.
- **Placement.** Round 1, clockwise from the first player: a settlement and a
  road. Round 2, counter-clockwise: **a city** and a road, with the distance
  rule (p. 4). The player places the city with `placeSettlement`
  (`setupPlacesCity` says which round places a city).
- **Starting resources:** 1 resource per terrain hex next to the city (p. 4),
  never commodities (the 2025 rulebook: "During setup, only take 1 card for
  each hex").
- The player who placed the last city, i.e. the first player, starts (p. 5).

### The beginners' map (`CK_BEGINNERS`, `src/ck/map.ts`)

"Starting Map for Beginners", Illustration D (p. 4), repeated on the Game
Overview (p. 20). It prints no starting positions. Pointy-top hexes, rows of
3-4-5-4-3 from the top:

| Row | Hexes (terrain number) |
|---|---|
| 1 | hills 6, mountains 2, hills 5 |
| 2 | forest 3, mountains 9, desert (robber), forest 10 |
| 3 | forest 8, fields 4, hills 11, pasture 3, fields 8 |
| 4 | pasture 10, fields 5, mountains 6, pasture 4 |
| 5 | fields 9, pasture 12, forest 11 |

Harbors (9, on the same frame spots as the base game's beginners' map),
clockwise from the top left:

| Hex | Side | Harbor |
|---|---|---|
| hills 6 | north-west | brick 2:1 |
| mountains 2 | north-east | ore 2:1 |
| forest 10 | north-east | lumber 2:1 |
| fields 8 | east | grain 2:1 |
| pasture 4 | south-east | 3:1 |
| pasture 12 | south-east | 3:1 |
| fields 9 | south-west | 3:1 |
| pasture 10 | west | wool 2:1 |
| forest 3 | west | 3:1 |

In the engine's odd-r rows (`src/ck/map.ts`):

```
.   .   ~   ~   ~   ~
.   ~   h6  m2  h5  ~
.   ~   f3  m9  d   f10 ~
~   f8  g4  h11 p3  g8  ~
.   ~   p10 g5  m6  p4  ~
.   ~   g9  p12 f11 ~
.   .   ~   ~   ~   ~
```

The 2025 rulebook's map (p. 4) has the same hexes and numbers; its frame
prints different harbors and is not used.

## 3. The turn (p. 5, p. 20)

1. Roll all three dice (`rollDice`). The Alchemist (phase 2) is the only card
   played before the roll.
2. **The event die first.**
   - **Ship:** the barbarian ship moves one space; on reaching the end of the
     track the barbarians attack (section 6).
   - **City gate** (yellow trade, blue politics, green science): every player
     whose improvement in that colour shows the red die's number draws the
     top card of that colour's deck, in turn order from the roller (p. 5,
     p. 9). Level 1 of a track shows two red dice (1–2), each level one more:
     **a player at level L draws when the red die is at most L + 1**
     (`drawsOn`; examples on p. 5, p. 8 and p. 9).
3. **Production** with the yellow and red dice (section 4), or the 7.
4. Then, in any order: trade; build roads, settlements, cities, knights, city
   walls and city improvements; activate, promote and act with knights; play
   any number of progress cards (p. 5–6). Trading and building interleave
   (p. 6).

The engine runs steps 2–3 as a chain of phases: decisions the event die
causes (a city to lose, a progress deck to draw from, progress cards to
discard) come first, then the `production` step resolves the roll
(`ckRollDice`, `ckSettle` in `src/ck/engine.ts`).

## 4. Production and commodities (p. 5, p. 7)

- A settlement takes 1 resource from its hex.
- A city takes **2 brick** on hills and **2 grain** on fields, and **1
  resource + 1 commodity** on forest (lumber + paper), pasture (wool + cloth)
  and mountains (ore + coin) (p. 5 Illustration G, p. 20).
- The robber's hex produces nothing, commodities included (p. 5).
- Bank shortage (base rule): demand is totalled per kind of card; if the bank
  cannot cover it nobody gets that card, unless only one player is owed it.
  The engine applies this to each resource and each commodity separately.
- **Commodities** are cards in hand: they count toward the hand on a 7, can be
  stolen by the robber and discarded (p. 7).
- **Aqueduct** (science level 3): a player who gets nothing from a production
  roll may take one resource of their choice from the bank; not on a 7 (p. 8).
  The engine offers it as the `aqueduct` phase step (`aqueduct` action with a
  resource, or none to decline). A gold-field pick counts as receiving.

## 5. The 7 and the robber (p. 5, p. 6)

- Everyone holding more than 7 cards (resources and commodities) discards half,
  rounded down; **each city wall raises that player's limit by 2** (p. 6
  example: two walls, safe up to 11). `sevenLimit`.
- **The robber is inactive until the first barbarian attack** (p. 5): before
  it, a 7 still forces the discards, but the robber stays on the desert,
  nobody steals, and knights cannot chase it. `robberActive` (`ck.attacks >
  0`).
- Once active: the roller moves the robber and steals one random card
  (resource or commodity) from a player with a building next to it
  (`stealRandomCard`).

## 6. The barbarians (p. 5, p. 11)

- Each ship face moves the ship one space; it attacks on the 7th move.
- **Barbarian strength:** the number of cities on the board, metropolises
  included. **Knights' strength:** the sum of every active knight (basic 1,
  strong 2, mighty 3), whoever owns it.
- **Barbarians stronger:** among players with a city that can be pillaged
  (players with no city or only metropolises are immune), those who
  contributed the least active strength each lose one city: it becomes a
  settlement and its city wall is removed (p. 11, p. 6). A player with no
  active knights contributed 0.
- **Knights at least as strong:** the player with the highest contribution
  receives a Defender of Catan card (1 VP, face up). If several tie, nobody
  does; instead each tied player, clockwise from the roller, draws the top
  card of a progress deck of their choice (`drawProgress`).
- Then the ship returns to its start and **every knight is deactivated**.
  After the first attack the robber can move.

## 7. Knights (p. 6, pp. 9–10)

| Action | Cost | Rules |
|---|---|---|
| `buildKnight` | 1 wool, 1 ore | A basic knight, inactive, on an empty intersection touching your road. No distance rule. Only basic knights are hired (2025: with none left, promote one first). |
| `activateKnight` | 1 grain | Same cost at every level. A knight activated this turn cannot act this turn. |
| `promoteKnight` | 1 wool, 1 ore | One level, once per knight per turn, status kept; a strong knight becomes mighty only with the Fortress (politics 3). The old token returns to the supply (2 of each level). |
| `moveKnight` | – | An active knight moves along your connected roads, passing your own buildings and knights but not other players' pieces, to an empty intersection. |
| `displaceKnight` | – | An active knight moves (as above) onto a **weaker** opposing knight. Its owner moves the displaced knight along *their* roads to an empty intersection (`retreatKnight`), status unchanged; with nowhere to go it returns to their supply. You cannot displace your own knights; a basic knight displaces nobody. |
| `chaseRobber` | – | An active knight next to the robber's hex chases it: move it ("to any numbered hex") and steal as on a 7. Only once the robber is active. |

- Each knight acts at most once per turn, on its owner's turn after the roll;
  acting turns it inactive. It may be activated again the same turn but then
  cannot act again (p. 9–10). The engine stores `activatedPart` and
  `promotedPart` per knight.
- **Blocking:** a knight occupies its intersection: nobody builds a
  settlement there (your own knight must move away first, p. 10), other
  players cannot build a road past it, and it breaks their Longest Road
  (p. 9). The engine treats an opposing knight like an opposing building in
  `roadConnects`, `shipConnects` and `longestRouteLength`.

## 8. City improvements and metropolises (pp. 7–8)

| Level | Trade (yellow, cloth) | Politics (blue, coin) | Science (green, paper) | Cost |
|---|---|---|---|---|
| 1 | Market | Town Hall | Abbey | 1 |
| 2 | Trading House | Church | Library | 2 |
| 3 | Merchant Guild: commodities 2:1 | Fortress: mighty knights | Aqueduct: a resource on a roll that gave nothing | 3 |
| 4 | Bank | Cathedral | Theater | 4 |
| 5 | Great Exchange | High Assembly | University | 5 |

- Level n costs n commodities of the track's kind (p. 7). You need at least
  one city on the board to buy any improvement; improvements are kept when
  the last city is lost (p. 12).
- Level-3 abilities last the rest of the game, for everyone who reaches them
  (p. 8).
- **Metropolis:** the first player to reach level 4 of a track places its
  metropolis on one of their cities without one; another player who reaches
  level 5 first takes it (piece and token); a player at level 5 keeps it for
  good (p. 8). +2 VP (a metropolis city is worth 4). Immune to the
  barbarians, but it counts toward their strength. A player may hold several,
  each on a different city. **Beyond level 3 a player needs a city where a
  metropolis could stand.** `improveCity` takes the city as `vertex` when the
  improvement wins a metropolis.

## 9. City walls (p. 3, p. 6)

`buildCityWall`: 2 brick, under one of your cities (metropolises included),
one per city, at most 3 per player. +2 to the hand limit on a 7 each. A wall
is removed with its city when the barbarians pillage it.

## 10. Progress cards (p. 9, Almanac pp. 14–18)

- Drawn from the event die (section 3) or as a tied best defender. Kept
  secret.
- **VP cards** (Constitution, Printer) are played face up at once, even on
  another player's turn; they do not count toward the hand limit and cannot be
  stolen.
- **Hand limit 4.** A player over the limit outside their turn discards at
  once, face down under the matching deck (`progressDiscard` phase step,
  `discardProgress`). The player whose turn it is may keep more until the end
  of their turn (2025 rulebook: "until the end of your Action phase"): the
  engine refuses `endTurn` until they are back to 4.
- Played after the roll on your own turn, any number per turn, also the turn
  they are drawn; the Alchemist only before rolling. They are never traded or
  stolen by the robber. A played card goes face down under its deck.
- Phase 1 has no card effects: `playProgress` refuses every card and
  `legalActions` offers none, so bots discard down to the limit.

### The 54 cards (for phase 2)

Names are the 2020 booklet's; the 2025 name follows where it differs.

**Science (green), 18**

| Card | # | Effect | Page |
|---|---|---|---|
| Alchemist (Alchemy) | 2 | Before rolling: choose both production dice, then roll the event die and resolve it first. The only card played before the roll; a 7 may be chosen. | 14 |
| Crane | 2 | One city improvement this turn costs one commodity less (a level 1 becomes free). Not two Cranes on one improvement. | 14 |
| Engineer (Engineering) | 1 | Build one city wall for free (normal wall limits). | 14 |
| Inventor (Invention) | 2 | Swap two number tokens, never a 2, 12, 6 or 8; no building needed next to them; the robber's hex may be chosen (2025: the robber stays on its hex). | 14 |
| Irrigation | 2 | 2 grain per fields hex next to at least one of your buildings (cities do not double it; 2025: as many as the bank has). | 14 |
| Medicine | 2 | Upgrade a settlement to a city for 2 ore and 1 grain. Not combinable. | 14 |
| Mining | 2 | 2 ore per mountains hex next to at least one of your buildings. | 15 |
| Printer (Printing) | 1 | 1 VP, played at once face up; not stolen by the Spy; outside the hand limit. | 15 |
| Road Building | 2 | Build 2 roads for free (Seafarers: roads or ships). | 15 |
| Smith (Smithing) | 2 | Promote up to 2 knights one level for free; active or inactive, status kept; strong to mighty only with the Fortress; once per knight per turn; mighty knights no further. | 15 |

**Politics (blue), 18**

| Card | # | Effect | Page |
|---|---|---|---|
| Bishop (Taxation) | 2 | Move the robber (normal rules) and steal 1 random resource/commodity from every player with a building next to its new hex (1 per player). Not before the first barbarian attack (p. 5; 2025 says so on the card). Robber only, not the pirate (2025). | 16 |
| Constitution | 1 | 1 VP, played at once face up. | 16 |
| Deserter (Treason) | 2 | An opponent removes one knight of their choice; you may place one of yours of equal strength (2025: equal or lower) with the same status, following the placement rules. If you have none of that strength left you may place a basic one; a mighty one even without the Fortress. The opponent removes the knight even if you cannot place one. | 16 |
| Diplomat (Diplomacy) | 2 | Remove an "open" road: at the end of a chain, with no knight, settlement or city of its colour at one end (2025: also not part of a route linking two of your buildings/knights). An opponent's road returns to them; your own you may rebuild at once for free (Seafarers: a removed ship is rebuilt as a ship). | 16 |
| Intrigue | 2 | Displace an opponent's knight standing on an intersection connected to your roads or ships, without a knight of your own (it retreats as usual, or is removed); playable with no knights. **Open for phase 2:** the Almanac's last sentence ("After the knight is displaced), you may place a basic knight instead, following the normal rules") is garbled, and neither the card nor the 2025 rulebook mentions a free knight. | 16 |
| Saboteur (Sabotage) | 2 | Every other player with at least as many VP as you discards half (rounded down) of their resource/commodity cards, of their choice. | 17 |
| Spy (Espionage) | 3 | Look at another player's progress cards and take one (not a VP card; a Spy may be taken). | 17 |
| Warlord (Encouragement) | 2 | Activate all your knights for free (they still cannot act the turn they are activated). | 17 |
| Wedding | 2 | Every player with more VP than you gives you 2 resource/commodity cards of their choice (1 if that is all they have). | 17 |

**Trade (yellow), 18**

| Card | # | Effect | Page |
|---|---|---|---|
| Commercial Harbor | 2 | During this turn, offer each opponent one resource card from your hand; each must give you a commodity of their choice for it, or you take it back if they have none. Once per opponent. | 17 |
| Master Merchant (Guild Dues) | 2 | Look at the hand of a player with more VP than you and take any 2 resource/commodity cards. | 17 |
| Merchant | 6 | Place the merchant on a land hex next to your building: while you control it you trade that hex's resource 2:1 with the bank (resources only; they may buy commodities) and hold 1 VP. Another Merchant card moves it and its control. The robber does not affect it; not on gold (2025, Seafarers). | 17–18 |
| Merchant Fleet | 2 | For the rest of the turn, trade one resource or commodity of your choice 2:1 with the bank, any number of times. | 18 |
| Resource Monopoly | 4 | Name a resource: each other player gives you 2 of it (1 if they have only 1). | 18 |
| Trade Monopoly | 2 | Name a commodity: each other player gives you 1 of it. | 18 |

## 11. Trading (p. 6, p. 7, p. 8, p. 12)

- With players: any mix of resources and commodities, card for card, as in
  the base game. Progress cards are never traded.
- With the bank (`cardRates`): 4 of a commodity for any card; 3:1 at a
  generic harbor; 4 (3, or 2 at the matching harbor) of a resource for a
  commodity. **The 2:1 resource harbors do not apply to commodities.** With
  the Merchant Guild (trade level 3) any commodity trades 2:1 (p. 8). The
  merchant's owner trades its hex's resource 2:1 (p. 12).

## 12. Victory (p. 12)

13 VP, on your own turn (the engine also lets a player who reached 13 on
someone else's turn win at the start of their own, as it does in the base
game). VP: settlement 1, city 2, metropolis +2, Longest Road 2, each Defender
of Catan card 1, each VP progress card 1, the merchant 1. No development
cards, no Largest Army. Longest Road stays.

## 13. Ambiguities and engine choices

1. **Which red numbers draw.** The flip-chart shows two red dice at level 1
   and one more per level (p. 8–9, three examples): a player at level L
   draws on a red die of at most **L + 1**, not L.
2. **Name of the trade ability.** The text calls it "Trading House (yellow)"
   (p. 8), but its flip-chart (Illustration L) shows the 2:1 commodity
   ability on level 3, the Merchant Guild, with the Trading House on level 2;
   the 2025 board agrees. The engine uses the flip-chart's names; the ability
   is at level 3 either way.
3. **Where a chased robber goes.** p. 10: "move it to any numbered hex",
   followed by "as if you had played a knight card". Followed literally: a
   chased robber goes to a hex with a number (not the desert)
   (`CHASED_ROBBER_NEEDS_NUMBER`). The 2025 rulebook uses the normal robber
   move.
4. **Who picks the pillaged city.** The rulebook says each such player loses
   "1 of their own cities". The owner chooses (`pillageCity`); with one
   pillageable city it is taken at once.
5. **Hand limit on your own turn.** 2020: a fifth card drawn when it is not
   your turn is discarded at once (p. 9). 2025 adds that on your own turn you
   have until the end of it. Engine: as 2025.
6. **Several players over the limit at once.** All draws of an event resolve
   first, in turn order; then the players over the limit (other than the one
   whose turn it is) discard, in parallel.
7. **Buying level 4 or 5.** "You may not purchase any improvements beyond the
   third level ... unless you have a city where you could build a
   metropolis" (p. 8). Engine: a city without a metropolis, or you already
   hold that track's metropolis.
8. **Nothing to fight.** With no cities and no active knights (0 against 0)
   the knights win (they need only equal strength) and every player ties as
   best defender, so each draws a progress card. Literal reading.
9. **Defender cards run out:** the best defender gets nothing.
10. **Pillaged with no settlement left.** 2020 is silent; 2025: the city piece
    lies on its side as a settlement and must be the next one upgraded
    (`ck.tipped`; it is rebuilt without a city from the supply).
11. **The robber before the first attack** stays on the desert (2020, p. 4–5).
    The 2025 rulebook keeps it beside the track and puts it on the desert at
    the first attack; the effect on play is the same.
12. **Knight movement** passes the mover's own buildings and knights but no
    other player's pieces (implied by p. 10; explicit in 2025). A displaced
    knight retreats along its own owner's roads (Illustration P; 2025).
13. **Aqueduct** is optional ("you may take"): the engine lets the player
    decline.
14. **The dice.** 2020: a yellow and a red production die, and the event die
    (whose turn-sequence box calls it "white"). The engine stores `[yellow,
    red]` in `turn.dice` and the event in `ck.event` and `rolls[].event`.
15. **Players with no city** still defend with their active knights and can
    be best defender (p. 11).

## 14. Engine design and seams for later phases

State (`src/core/types.ts`):

- `GameOptions.citiesAndKnights?: boolean`; `GameState.ck?: CkState` holding
  the commodity bank, barbarian position and attack count, the three decks,
  knights by intersection, metropolises, the merchant, tipped cities, the last
  event and per-turn effects, and per player: commodities, improvements,
  walls, progress hand, VP cards and Defender cards.
- New phase kind `'ck'` with steps `production` (automatic), `pillage`,
  `defenderDraw`, `progressDiscard`, `aqueduct`, `retreat` and `card`.
- New actions: `buildKnight`, `activateKnight`, `promoteKnight`,
  `moveKnight`, `displaceKnight`, `retreatKnight`, `chaseRobber`,
  `buildCityWall`, `improveCity`, `pillageCity`, `drawProgress`,
  `discardProgress`, `aqueduct`, `playProgress`, `progressChoice`. Trades,
  discards and bank trades take `CardCounts`, which include commodities in
  C&K games.

Modules (`src/ck/`): `constants.ts` (data), `basics.ts` (VP, hand size,
knights on paths, used by the core rules), `cards.ts` (hands, bank, rates),
`knights.ts`, `progress.ts` (decks and the effect registry), `engine.ts`
(roll, barbarians, production, action handlers), `legal.ts`, `view.ts`,
`map.ts`. `engine/apply.ts`, `legal.ts`, `view.ts` and `stats.ts` call into
them only when `state.ck` exists.

- **Phase 2, progress cards.** Register an effect per card with
  `registerProgressEffect(card, { options, play, respond?, choices? })` in
  `src/ck/progress.ts`. The engine already checks timing, removes the card,
  puts it under its deck and calls `play`; `legalActions` lists
  `options(...)`. Cards that need other players' choices set the phase to
  `{ kind: 'ck', step: 'card', ... }` and answer `progressChoice`. Ready for
  them: `ckRollDice(s, p, fixed)` (Alchemist), `turnEffects` with `crane`
  (already honoured by `improvementPrice`) and `merchantFleet` (honoured by
  `cardRates`), `placeMerchant`, `pillage`-style helpers, knight queries
  (`knightPlacementError`, `promoteError`, `retreatSpots`) and the robber
  phase's `reason: 'chase'` / `piece` (Bishop moves the robber only).
- **Phase 3, bots.** `src/bots/ckBot.ts` is a simple fallback (improvements,
  knights when the ship is near, walls, legal answers to every decision).
- **Phase 4, UI.** `viewFor(...).ck` (`CkView`) has everything public plus the
  viewer's own commodities and progress cards. `PlayerStats.producedCommodities`
  counts commodities; `expected36` counts all cards a roll should give, so
  compare it with resources plus commodities.
- **Phase 5, 5–6 players and Seafarers.** `createGame` refuses C&K with
  Seafarers scenarios or more than 4 players for now. Hooks for them:
  `COMMODITY_BANK`/`DEFENDER_CARDS` (5–6: +6 each commodity, +2 Defender
  cards), builds already allowed in the special build phase
  (`buildError`), knights already reach along ships (`knightReach`) and can
  chase the pirate (`chaseRobber` with `piece: 'pirate'`), `robberActive`
  gates the pirate too, and the setup city is the round that collects
  (`setupPlacesCity`). Still to do there: the pirate start on the track,
  knights at sea and closed routes, +2 VP for Seafarers scenarios (2025),
  gold fields never giving commodities (already so) and no merchant on gold
  (already in `merchantHexError`).
