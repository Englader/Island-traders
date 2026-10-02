# Cities & Knights: rules as implemented

This is the specification the engine follows for the *Cities & Knights*
expansion, with the source page for each rule. Phase 1 built the engine core
in `src/ck/`; phase 2 added every progress card's effect (`src/ck/effects.ts`,
section 10).

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
- **For the progress cards, also:** catan.com's official *Cities & Knights
  FAQ* (`catan.com/faq/cities-knights`, cited as "FAQ n" by its question
  number), and the German *Almanach* of the current edition (KOSMOS 2022,
  catan.de `sites/default/files/2022-08/CATAN_SuR34_Manual.pdf`, pp.
  10–11), whose Intrigue and Diplomat texts settle two unclear English
  passages.
- **For 5–6 players (section 15):** the three printings of the *Cities &
  Knights 5-6 Player Extension* rules, 4 pages each: 2020 (catan.com
  `sites/default/files/2021-08/catan_c_k_5-6_2020_rules.pdf`, the special
  build phase), 2023 (`sites/default/files/2024-03/Catan C&K 5-6 2023
  Rules 240313.pdf`, paired players) and 2025 (`sites/default/files/2025-03/CN3088
  CATAN–Cities & Knights 5-6_ Rulebook.pdf`, paired players). They are
  cited as "5-6 2020 p. n" and so on.
- **For the Seafarers scenarios (section 16):** the combination rules of
  both C&K rulebooks (2020 p. 13, 2025 p. 12), catan.com's Cities & Knights
  page and the German 2025 rulebook (p. 16), with the Seafarers rulebooks
  and FAQs; section 16 lists them.

The engine enables the expansion with `GameOptions.citiesAndKnights: true`.
It is a rules module, not a scenario: its state lives in `GameState.ck`, and
every rule is keyed on that, so games without it are unchanged (a regression
test, `test/regression.test.ts`, replays base and Seafarers games recorded
before the expansion existed, and 3–4 player C&K games recorded before the
5–6 extension). It combines with the base game for 3–4 players, for 5–6
players with the 5-6 Player Extension (section 15), and with the Seafarers
scenarios the rulebook allows (section 16).

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

With 5–6 players the extension adds commodities and Defender cards
(section 15).

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

1. Roll all three dice (`rollDice`). The Alchemist is the only card played
   before the roll: it sets both production dice and only the event die is
   rolled (`playProgress`, section 10).
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
- Played after the roll on your own turn (p. 6, 9), any number per turn,
  also the turn they are drawn; the Alchemist only before rolling. Never on
  another player's turn and never in the middle of another decision (FAQ 95:
  not before the roll is resolved). They are never traded or stolen by the
  robber. A played card is shown to everyone (`ck.played`, the log) and goes
  face down under its deck.
- A card whose effect is known in advance to be nothing may not be played
  (FAQ 98: not Mining without a mountains hex, but Trade Monopoly, whose
  effect nobody can know): the engine neither offers nor accepts it
  (conditions per card below). Cards whose effect depends on
  hidden hands (the Monopolies) are always playable.

### The 54 cards

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
| Intrigue | 2 | Displace an opponent's knight standing on an intersection connected to your roads or ships, without a knight of your own (it retreats as usual, or is removed); playable with no knights. No free knight: see ambiguity 16. | 16 |
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

### How the engine plays them (`src/ck/effects.ts`)

- **`playProgress { card, args }`.** `args` carry the choices made as the
  card is played; `legalActions` lists every legal `args`, so a client can
  let the player pick and only then commit the card.
- **Choices that follow** wait in the phase `{ kind: 'ck', step: 'card',
  card, player, stage, target?, pending?, data?, resume }`: the `pending`
  players answer (each owes `pending[p]` cards), or `player` when there is no
  `pending`; `playersToAct` lists them. They answer with `progressChoice {
  args }`; `progressChoice` with no `args` declines an optional step. `data`
  is the card's and `viewFor` shows it to `player` only (what a Spy or Master
  Merchant sees); `stage` and `target` are public. A choice with only one
  possible answer is made at once (a single knight to remove, a hand of one
  kind of card, a single commodity kind).
- Some cards use the engine's own phases: the Bishop the `robber` phase with
  `reason: 'bishop'` (`moveRobber` with no `victim`), Road Building the
  `roadBuilding` phase (`buildRoad`/`buildShip`, `endRoadBuilding`), and
  Intrigue's displaced knight the `retreat` step (`retreatKnight`).
- **Turn effects** (`ck.turnEffects`, public): `crane`, `merchantFleet`
  (`data`: the card kind), `commercialHarbor` (`data.offered`). Commercial
  Harbor's offers are `progressChoice { card: 'commercialHarbor', to,
  resource }` in the main phase (`progressTurnChoices` lists them).

| Card | `args` to play | Then | Not playable when |
|---|---|---|---|
| Alchemist | `{ dice: [yellow, red] }` (1–6 each, 36 options) | the event die is rolled and resolved, then production, as after `rollDice`; the roll is recorded with `chosen: true` | after the roll |
| Crane | – | the next `improveCity` this turn costs one commodity less | a Crane is already waiting; no track can be improved (no city, all at 5, or beyond 3 without a metropolis site) |
| Engineer | `{ vertex }`: your city without a wall | – | 3 walls, or no city without one |
| Inventor | `{ hexes: [a, b] }` | – | fewer than two tokens other than 2, 12, 6, 8; equal numbers are not offered |
| Irrigation, Mining | – | – | no fields (mountains) hex next to your buildings, or none of that resource in the bank |
| Medicine | `{ vertex }`: a settlement you may upgrade | pays 2 ore, 1 grain | not those cards, or no settlement to upgrade (a pillaged city on its side first, as `buildCity`) |
| Road Building | – | `roadBuilding` phase, 2 free roads (or ships) | nowhere to build |
| Smith | `{ vertex }`: the first knight | stage `promote`: `{ vertex }`, or no args to stop | no knight can be promoted |
| Bishop | – | `robber` phase, reason `bishop` | before the first barbarian attack |
| Deserter | `{ target }` | stage `desert` (target): `{ vertex }` of their knight; stage `place` (you): `{ vertex }` or no args; `data: { level, active }` | no opponent has a knight |
| Diplomat | `{ edge }`: an open road (or ship), anyone's | your own: stage `rebuild`: `{ edge }` or no args | no open road |
| Intrigue | `{ vertex }`: an opposing knight touching your road | `retreat` step for its owner | no such knight |
| Saboteur | – | stage `discard` (each player with at least your VP): `{ cards }` | nobody would discard |
| Spy | `{ target }`: a player with progress cards | stage `take`, `data.cards`: `{ card }` or no args | nobody has progress cards |
| Warlord | – | – | no inactive knight |
| Wedding | – | stage `give` (each richer player with cards): `{ cards }` | nobody would give |
| Commercial Harbor | – | offers `{ card: 'commercialHarbor', to, resource }`; stage `exchange` (`to`): `{ commodity }` | no opponent holds a commodity |
| Master Merchant | `{ target }`: a richer player with cards | stage `take`, `data.hand`: `{ cards }` (2, or 1 if they hold one) | no such player |
| Merchant | `{ hex }` | – | where the merchant already is yours |
| Merchant Fleet | `{ resource }` or `{ commodity }` | 2:1 for it this turn | kinds already at 2:1 are not offered |
| Resource Monopoly | `{ resource }` | – | – |
| Trade Monopoly | `{ commodity }` | – | – |

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

The progress cards (phase 2):

16. **Intrigue** (Almanac p. 16) ends with a garbled sentence: "After the
    knight is displaced), you may place a basic knight instead, following the
    normal rules." Neither the card nor the 2025 rulebook ("Take the
    'Displace a Knight' action without using one of your knights") gives a
    free knight, and the official German Almanac (p. 11) reads: "Natürlich
    kann an der Stelle, an der der Ritter vertrieben wurde, ein neuer Ritter
    gebaut werden (von beiden Beteiligten)", i.e. *of course a new knight may
    then be built where the knight was driven off, by either player*. Engine:
    Intrigue only displaces (any strength, no knight of yours needed; it
    retreats along its owner's roads or leaves); the vacated intersection is
    open to a normal, paid `buildKnight`.
17. **Deserter's knight.** 2020 (and the German Almanac): a knight of the same
    strength, or a basic one when you have none of that strength left; 2025
    allows "the same strength or lower". Engine: 2020. It takes the removed
    knight's status and, if active, may act at once (FAQ 83). The target
    chooses the knight (FAQ 87); with a single knight it goes at once.
18. **An "open" road** (Diplomat): at one of its ends nothing of its colour is
    attached, no settlement, city, knight, road or ship (the German Almanac
    spells out the ship). An opponent's piece at the end or in the middle
    does not close it (FAQ 89), and a road whose removal would leave a knight
    of its colour without a road is not open (FAQ 90). The Seafarers FAQ's
    special cases for loops of ships are not applied to roads. A removed
    road of your own goes back "somewhere else" (p. 16): not on the same
    spot, as the same piece (FAQ 64, 92); Longest Road is settled once it is
    back (FAQ 88).
19. **Cards with no effect** (FAQ 98) are not playable; see the table above.
    The engine knows every count the table needs from public information
    (hand sizes, commodity counts, knights, VP).
20. **Commercial Harbor.** The offered resource is handed over face down (FAQ
    78), so the answering player chooses the commodity without seeing it;
    `data.resource` is the offerer's. Offers go only to players who hold a
    commodity (their count is public; to anyone else the offer would be
    void). Each card allows one offer per opponent; a second card played the
    same turn starts a new round.
21. **Irrigation and Mining** are not production: the robber does not stop
    them. With too few cards in the bank the player takes what is left
    (2025).
22. **Bishop:** the robber may go anywhere a 7 could send it, the desert and
    hexes with nobody next to them included (FAQ 75); the friendly-robber
    option applies. The cards stolen are logged to thief and victim only.
23. **Wedding, Saboteur, Master Merchant** compare VP, which are all public
    in Cities & Knights. The Saboteur's discards (FAQ 110) and the Wedding's
    gifts are chosen by the giving players, in parallel; a player with only
    one way to choose answers at once.
24. **Spy:** the target's hand is shown to the spy only (`data.cards`); taking
    nothing is allowed ("you may choose"). The card taken is logged to the
    two players only. The spy may go over 4 cards and then discards by the
    end of the turn (section 10).
25. **Statistics:** progress cards count as played cards (`devPlayed`), the
    Alchemist's dice as a roll (`expected36`), Commercial Harbor exchanges as
    trades, the Saboteur's cards as discards and the Wedding's, Master
    Merchant's, Bishop's and Monopolies' cards as stolen.

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

- **Phase 2, progress cards (done).** `src/ck/effects.ts` registers an
  effect per card with `registerProgressEffect(card, { options, play,
  choices?, respond?, turnChoices?, turnAct? })` (`src/ck/progress.ts`). The
  engine checks the timing, removes the card, records it in `ck.played`,
  puts it under its deck and calls `play`; `legalActions` lists `options`,
  the `card` step's `choices` for the players it waits on, and
  `turnChoices` in the main phase. Section 10 has the API per card;
  `test/progressCards.test.ts` covers each card, `test/progressStress.test.ts`
  plays whole games with every card.
- **Phase 3, bots (done).** `heuristicAction` hands every decision of a C&K
  game to `ckHeuristicAction` (`src/bots/ckBot.ts`); the level's profile
  (`ck` in `PROFILES`, `src/bots/heuristicBot.ts`) sets how it watches the
  barbarians, picks improvement tracks, plays progress cards and uses its
  knights. The README's "Computer players" section describes the levels and
  the league results (`npm run bots:league -- 60 ck`);
  `test/ckBot.test.ts` covers the key decisions.
- **Phase 4, UI (done).** `viewFor(...).ck` (`CkView`) has everything public plus the
  viewer's own commodities and progress cards, and `played`, the progress
  cards played so far. A card step's `data` (what a Spy or Master Merchant
  sees) is in `viewFor(...).phase` for its player only. `PlayerStats.producedCommodities`
  counts commodities; `expected36` counts all cards a roll should give, so
  compare it with resources plus commodities. The browser game (part 3,
  `web/src/ui/CkPanels.tsx`, `ckArt.tsx`, `web/src/game/ck.ts`, `fx.ts`)
  plays everything but a human's own progress cards: knights, walls,
  improvements, the barbarians, drawing, holding and discarding progress
  cards, and the answers to cards other players play (Wedding, Saboteur,
  Commercial Harbor, Deserter; any other card step gets a plain list of its
  `choices`). Part 4b plays your own cards (`web/src/game/progress.ts`,
  `web/src/ui/ProgressPlay.tsx`, the faces in `web/src/ui/progressArt.tsx`):
  only the cards and `args` `legalActions` lists can be picked; a card's
  choices are made before it is played (a player or a card kind in a sheet,
  a spot on the board, the Alchemist's dice with a preview of the roll),
  then confirmed with its face; the choices that follow (the Spy's and
  Master Merchant's `data`, the Smith's second knight, the Deserter's
  knight, the Diplomat's rebuild, the Commercial Harbor's offers) come after,
  and `ck.turnEffects` show as chips.
- **Phase 5, 5–6 players (done).** Section 15: `commodityBank` and
  `defenderCards` (`src/ck/constants.ts`) size the supply, `ckActionPart`
  (`src/ck/engine.ts`) opens knight actions and progress cards to paired
  player 2, and the special build phase offers the C&K builds
  (`ckBuildActions` in `engine/legal.ts`). `test/ck56.test.ts` covers it.
- **Phase 6, Seafarers (done).** Section 16: `src/ck/seafarers.ts` says
  which scenarios combine (`ckScenarioError`, `CK_BLOCKED_SCENARIOS`) and
  sets the VP target (`ckVictoryPoints`); `ck.asleep` holds the robber's
  and pirate's starting hexes until the first attack (`barbarianAttack`);
  own knights close ship routes (`routeEnd` in `src/rules/ships.ts`); the
  pirate chase follows the scenario's pirate rule (`chaseError`); the C&K
  roll runs the scenario's `afterRoll` (Cloth for Catan's villages). The
  bots (`ckBot.ts`) build ships, value gold and island chits, chase the
  pirate, claim and build wonders and sail for Cloth villages.
  `test/ckSeafarers.test.ts` and `test/ckSeafarersBots.test.ts` cover it.

## 15. Five and six players: the 5-6 Player Extension

The extension uses every Cities & Knights rule except where it says
otherwise (5-6 2020 p. 2; 2023 p. 2; 2025 p. 2). It changes the supply, the
board and the turn; nothing else. The 2020 printing plays the 5–6 turn with
the **special build phase**; the 2023 revision replaced it with **paired
players** (2023 p. 1: "These rules replace the 'special building phase'
found in previous rules versions"), and the 2025 edition keeps paired
players (p. 3). The engine plays both, following the base game's 5–6 option
`GameOptions.fiveSixMode`: `'paired'` (the default) plays the 2023/2025
rules, `'specialBuild'` the 2020 rules.

### Components (5-6 2020 p. 1; 2023 p. 1; 2025 p. 2)

| Component | 3–4 players | 5–6 players | Engine |
|---|---|---|---|
| Commodity cards | 12 of each | 18 of each: 6 coin, 6 paper, 6 cloth added | `commodityBank(n)` |
| "Defender of Catan" VP cards (2025: VP tokens) | 6 | 8: 2 added | `defenderCards(n)` |
| Knights per player | 2 basic, 2 strong, 2 mighty | the same for the two new colours (2020/2023: "12 knights, 6 of each color"; 2025: "4 basic, 4 strong, 4 mighty knights (2x each color)") | `KNIGHTS_PER_LEVEL` |
| City walls per player | 3 | the same ("6 city walls, 3 of each color") | `MAX_CITY_WALLS` |
| Flip-charts (2025: city improvement boards) | 1 per player | 1 per player: 2 added | – |
| Progress cards | 54 (18 per deck) | 54: the extension adds none | `newDecks` |
| Metropolises | 3 | 3: none added | `ck.metropolises` |
| Resource cards | 19 of each | 24 of each, from *CATAN 5-6* (2023 p. 2: "add the 25 resource cards from CATAN 5-6") | the base game's `BANK_5_6` |

No development cards, as in every C&K game (2020 p. 3: "the development
cards are not used when playing C&K").

### The board (5-6 2020 p. 2; 2023 p. 2; 2025 p. 3)

- "Set up the frame ... exactly as outlined in Catan 5-6 rules", put the
  barbarian tile next to it, and "construct the island following all of
  the rules in Catan 5-6" (2020 p. 2; 2023 p. 2 alike). 2025 p. 3:
  "Create the board as described in CATAN 5–6, being sure to use the sea
  frame from Cities & Knights that shows the barbarian track."
- **No map is printed.** None of the three printings shows a starting map,
  a beginners' set-up or starting positions for 5–6 players. The engine's
  official layout is therefore **the base game's 5–6 official map**, the
  "Starting Set-up for 5-6 New Players" of the *CATAN 5-6* rules (2022,
  page 5; `BEGINNERS_5_6` in `src/scenarios/base.ts`: 30 hexes, 2 deserts,
  28 numbers, 11 harbors). `ckMapSpec` returns no C&K map for 5–6 players
  and `mapSpecFor` gives the base game's. The random layout is the *CATAN
  5-6* variable set-up, generated as for the base game (`layout: 'random'`).
- **The robber:** "Place the robber in either desert" (2020 p. 2; 2023 p.
  2). The engine places it on the first desert (by hex id; on the official
  map the desert at the west end of the fourth row). It sleeps there until
  the first barbarian attack (section 5).
- The barbarian ship starts on its first space; the start is placed as in a
  3–4 player game (the second round places a city).

### The turn with paired players (5-6 2023 p. 3; 2025 pp. 3–4)

- **Player 1**, the player whose turn it is, plays a whole C&K turn: rolls
  all three dice, the event die and production, then the action phase.
- **Player 2** is "the third player to the left of the first player"
  (2025 p. 4; the base game's `(current + 3) % n`). After player 1's turn
  they take an **action phase** (2025 p. 3: "with one restriction: Player
  2 may not trade with other players"). The 2023 chart (p. 3) and the 2025
  turn summary (p. 4) list what player 2 may do:
  - trade with the supply only (the bank, harbors, the merchant's 2:1, the
    Merchant Guild, a Merchant Fleet played in this part);
  - build roads, settlements, cities, knights and city walls;
  - improve cities with commodities (and win a metropolis);
  - activate, promote and act with knights: move, displace, chase the
    robber;
  - play any number of progress cards.
  Player 2 does not roll, so never plays the Alchemist (played only before
  rolling), and neither proposes nor answers trades with players.
- **Knights activated in player 2's part** cannot act in it, but can on
  their owner's next turn (2023 p. 3: "A knight may be activated during
  the player 2 paired player turn. It is then able to perform actions
  during the controlling player's next turn"). The engine's per-part
  counter (`activatedPart`, `promotedPart`) does this for every part of a
  turn, so a knight may also be promoted once in each part its owner plays.
- **Winning:** player 1 wins on reaching 13 VP during their turn, "even
  before player 2 takes their Action phase"; player 2 wins on reaching 13
  during their part (2025 p. 3). A player who reaches 13 on someone else's
  part (a Defender card, a VP card drawn on another player's roll) wins at
  the start of their next part, as in 3–4 player games.

### The turn with the special build phase (5-6 2020 pp. 2–3)

- The turn is a normal C&K turn (roll, events, progress draws, production,
  then trade, build, knights and progress cards in any order). Then the
  special build phase begins: "in clockwise order (starting with the player
  who received the dice from you), the other players may build".
- In the special build phase a player **may**: "build roads, settlements,
  cities, knights, city walls, and/or city improvements" and "activate
  and/or promote knights", with the resources and commodities in their
  hand.
- They **may not**: "perform any actions with their knights; play any
  progress cards; or make any trades with other players and/or the bank".
  (No development cards either.)
- **Knights activated in the special build phase** act on their owner's
  next turn: "Since the special build phase is the last part of a turn,
  the knight could then perform an action during its controlling player's
  next turn" (2020 p. 3, with the example of Leif).
- **Winning:** as in C&K, only on your own turn: a player who reaches 13 VP
  in the special build phase wins when their own turn begins (the base
  game's 5–6 rule, which the engine already applies).

### Unchanged

- **Barbarian strength:** still every city on the board, metropolises
  included (section 6); none of the printings changes it. With more players
  there are simply more cities, and more knights against them.
- **Victory points:** 13 (2025 p. 3 says so for both paired players).
- **Hand limits:** the 7 with walls, and 4 progress cards (section 10).
- Everything else: production, the event die, improvements, metropolises,
  the merchant, the progress cards.

### Ambiguities and engine choices (5–6)

26. **The map.** No C&K 5–6 map is printed; the base game's 5–6 official
    map is used (above). Its harbors and numbers are the *CATAN 5-6*
    beginners' set-up's.
27. **Which desert.** "Either desert": the engine takes the first by hex id.
    It makes no difference before the first attack, when the robber first
    moves.
28. **Progress cards drawn on player 1's roll.** A player over 4 cards
    discards at once when it is not their turn (p. 9). Player 2 draws on
    player 1's roll, before their own action phase starts; the engine
    counts that as not yet their turn and has them discard at once. Within
    their own part (a Spy taking a card) they may hold more until they end
    it, like the player whose turn it is (section 10).
29. **Commercial Harbor for player 2.** Player 2 "may not trade with other
    players", but may "play any number of progress cards". The engine
    treats Commercial Harbor's forced exchange as the card's effect, not a
    trade, and lets player 2 play it; the Merchant Fleet and the merchant's
    2:1 are trades with the supply, which player 2 may make.
30. **Promotions per turn.** "Once per knight per turn" counts each part of
    a turn on its own (paired part, special build), so a knight promoted in
    another player's turn may be promoted again on its owner's own turn.
    Neither printing says otherwise.
31. **Effects that last a turn** (the Crane's discount, a Merchant Fleet,
    Commercial Harbor's offers) end with the part of the turn they were
    played in; they never carry over to player 2 or the special build phase.

The computer players (`src/bots/ckBot.ts`) play both structures: in the
special build phase and player 2's part they make the same build, knight
and card decisions as on their own turn, with what that part allows. Two
choices were measured (`npm run bots:league`, and the cities each level
lost to the barbarians over 36 games per setting):

- They plan their defence one roll per player ahead, as with 3–4 players.
  Planning only up to their next part (one roll ahead with the special
  build phase, two or three with paired players) woke their knights too
  late, often without the grain for it (the special build phase allows no
  trades): with six players a hard player lost 1.36 cities a game instead
  of 0.15 with the special build phase, and 0.67 instead of 0.40 with
  paired players.
- With 5–6 players the hard level races for Defender of Catan only when one
  knight level wins it (with 3–4 players up to three or four levels ahead).
  Against four or five rivals the race mostly defended Catan for everyone:
  hard and medium then won about as often (50% and 48% over 960 games).
  With the limit hard wins 61% (section "Computer players" of the README),
  and each level loses about as many cities as with 3–4 players (hard
  0.26–0.75 a game, medium 0.68–1.05, easy 1.08–1.42).

## 16. Cities & Knights with the Seafarers scenarios

`GameOptions.citiesAndKnights` also applies on top of a Seafarers scenario.
Every rule of sections 1–15 holds; this section lists what the combination
adds and where it comes from.

### Sources

- **C&K 2020 p. 13**, "Seafarers of Catan Variant" (*Game Rules & Almanac*,
  the primary source), and the Almanac: Road Building p. 15, Intrigue
  p. 16.
- **C&K 2025 p. 12**, "Combining with CATAN – Seafarers Expansion", with its
  two illustrated examples; the robber's start p. 6 ("The first time the
  barbarians attack, move the robber from its space by the barbarian track
  to the desert") and p. 7.
- **catan.com**, the *Cities & Knights* page (`catan.com/cities-knights`,
  tab "Seafarers", "Combination with the Seafarers Expansion"), cited as
  "catan.com"; its last line is cut off on the page. The **German 2025
  rulebook** (KOSMOS, catan.de
  `sites/default/files/2025-03/400205684754_CAT_NE_SuR_Manual_DE_web.pdf`,
  p. 16, "Städte & Ritter in Kombination mit Seefahrer") has the same text
  in full; cited as "German 2025 p. 16".
- **FAQs:** the Cities & Knights FAQ (catan.com, "FAQ n" as in section 10)
  and the Seafarers FAQ (`catan.com/faq/seafarers`, "Seafarers FAQ n").
- **Seafarers rulebooks:** the 5th edition (2020; `catan-seafarers_2021_rule_book_201201.pdf`,
  32 pages) for the scenarios' own rules, and the 2025 rulebook (20 pages).
  Neither says anything about Cities & Knights.
- **5–6 players:** none of the C&K 5-6 printings (2020, 2023, 2025) or the
  Seafarers 5-6 printings (2020, 2023, 2025) mentions the combination.

### Which scenarios (2020 p. 13; 2025 p. 12; catan.com; German 2025 p. 16)

2020: "The best scenarios to use are those that do not involve the
exploration of hidden portions of the board (such as 'The Fog Islands') or
many small islands (such as 'The Four Islands'), as these types of
scenarios may make it too difficult to combat the barbarian army.
Scenarios such as 'Heading for New Shores,' or 'Through the Desert' both
work very well". 2025 says the same ("they noticeably increase the impact
of the barbarian army"). catan.com and the German rulebook call those
scenarios unsuitable: "The exploratory scenarios and all other scenarios
with many smaller islands are unsuitable"; "Ungeeignet sind Szenarien, in
denen es viele kleinere Inseln gibt, und Szenarien mit verdeckten
Sechseckfeldern".

| Scenario | C&K | Why (`CK_BLOCKED_SCENARIOS`, `src/ck/seafarers.ts`) | VP |
|---|---|---|---|
| 1 Heading for New Shores | 3–6 players | named as working well | 14 + 2 = 16 |
| 2 The Four Islands | refused | named: many small islands | – |
| 3 The Fog Islands | refused | named: hidden hexes | – |
| 4 Through the Desert | 3–6 players | named as working well | 14 + 2 = 16 |
| 5 The Forgotten Tribe | refused | many small islands (the tribe's eight islets, explored for gifts), and four gifts are development cards, which C&K sets aside (p. 2) | – |
| 6 Cloth for Catan | 3–4 players | everyone settles the two big islands; no hidden hexes (engine reading, below) | 14 + 2 = 16 |
| 7 The Pirate Islands | refused | small pirate islands, and its warships are armed with Knight cards (Seafarers 2020 p. 24): C&K has no development cards | – |
| 8 The Wonders of Catan | 3–4 players | one main island everyone starts on, three small islands as in New Shores; no hidden hexes (engine reading) | 10 + 2 = 12 |
| 9 New World | refused | an unknown map of many small islands, explored | – |

The browser shows each refusal's reason on the new-game screen. The
player counts are the scenario's own; Cloth for Catan and The Wonders have
no 5–6 player maps.

### The combination rules

| Rule | Source | Engine |
|---|---|---|
| **Ships:** what C&K says of roads also applies to ships | 2020 p. 13; 2025 p. 12; catan.com | knights are hired on an intersection touching their owner's road **or ship** (`onOwnRoute`); opposing knights block ships as roads (`shipConnects`) and break trade routes (`longestRouteLength`, as in section 7) |
| **VP target:** the scenario's + 2 | 2025 p. 12; catan.com; German 2025 p. 16 | `ckVictoryPoints`: 16, 16, 16 and 12 (The Wonders' "10 VP and more levels than anyone" becomes 12); 13 on the base game as before |
| **Barbarians attack all islands at once,** counting every city and active knight on the board | 2020 p. 13; 2025 p. 12; catan.com | unchanged (`barbarianAttack` already counts the whole board) |
| **Moving a knight** along your roads **and ships**, also across the sea | 2020 p. 13; 2025 p. 12 ("along your continuous routes of roads and ships"); catan.com ("via roads and ships or via ships only") | `knightReach` follows the owner's roads and ships; displaced knights retreat the same way |
| **Knights at sea:** a knight may *move* to an intersection of sea hexes at the end of your line of ships ("the knight is considered to be on the adjacent ship"), **"but not place a new knight there"** | 2020 p. 13; 2025 p. 12; catan.com | `knightSiteError` keeps new knights (hired, or placed by the Deserter) on land; moves and retreats may end at sea |
| **Closed routes:** a knight must stay connected to its colour; a ship route to your knight is closed and its ships may not move | 2020 p. 13; 2025 p. 12 and its second example; catan.com; Seafarers FAQ 18 ("as soon as a shipping route connects two settlements (or cities or for Cities & Knights also knights), the shipping route is considered as closed") | `routeEnd` (`src/rules/ships.ts`): your knight ends a route like your settlement does, in `isShipOnClosedRoute` and `isShipAtRouteEnd` |
| **An opponent's knight on your route** interrupts it for the Longest Trade Route, but you may not break a closed route up by moving the ships next to it | catan.com; German 2025 p. 16 | opponents' pieces never open a closed route (as Seafarers FAQ 14 for settlements) |
| **Chasing the pirate:** an active knight next to the pirate's sea hex chases it like the robber | 2020 p. 13 ("a knight on a sea hex intersection"); 2025 p. 12; catan.com and German 2025 p. 16 ("an active knight adjacent to the sea hex occupied by the pirate") | `chaseRobber` with `piece: 'pirate'` from any intersection of the pirate's hex, on the coast or at sea; the pirate goes to another sea hex and robs a player with a ship next to it of a random resource or commodity |
| **The pirate waits until the first attack:** "Place the pirate on the final space of the barbarian track. The pirate does not enter play until after the first barbarian attack. At that point, follow the directions in the Seafarers scenario for initial pirate placement." | 2025 p. 12; catan.com and German 2025 p. 16 ("the rule that the robber may not be moved before the barbarians first reach Catan applies to the pirate too") | `ck.asleep` holds the robber's and pirate's scenario starts; both are off the board (`board.robber`, `board.pirate` null) until `barbarianAttack` places them (ambiguity 32) |
| **Gold fields** give resources only, never commodities: a city takes 2 of its choice | 2025 p. 12; catan.com | `produceCards` (already so) |
| **The merchant** never goes on a gold field | 2025 p. 12; catan.com | `merchantHexError` (already so) |
| **Road Building:** 2 roads, a road and a ship, or 2 ships | 2020 Almanac p. 15; Seafarers FAQ 1 | the `roadBuilding` phase (already so) |
| **Bishop (Taxation)** moves the robber only, never the pirate | 2025 p. 12; FAQ 63 | `bishop` (already so) |
| **Diplomat (Diplomacy):** a ship is "open" as a road is; your own removed ship is built again only as a ship, your road only as a road; an open ship next to the pirate may be removed | 2025 p. 12; FAQ 64–66, 94 | `openRoadError` and the `rebuild` stage (already so); the rebuilt ship follows the building rules, so not next to the pirate |
| **Intrigue** reaches a knight on an intersection "connected to at least one of your roads or shipping routes" | 2020 Almanac p. 16 | `onOwnRoute` (already so) |
| **Harbors and commodities:** a 3:1 harbor takes commodities, a 2:1 harbor only its resource | C&K p. 7; FAQ 36 | `cardRates`, as on the base map |

### The scenarios with C&K

- **Setting up.** The round that collects starting resources places the
  city (`setupPlacesCity`): the second round, and Cloth for Catan's third
  (its first two places are settlements). The scenario's start zones and
  forbidden spots apply to the city as to a settlement (New Shores: the main
  island; The Wonders: not the small islands, the wasteland, the strait or
  next to it). A coastal city may start with a ship instead of a road
  (Seafarers 2020 p. 6). The city takes one card per hex, never a
  commodity (section 2); a gold hex next to it gives one pick.
- **New Shores, Through the Desert:** the island chits (2 VP for the first
  settlement in each new area) are unchanged.
- **Cloth for Catan:** the villages' cloth (Catan chits worth 1 VP for 2) is
  not the C&K commodity cloth: they never mix. A village pays its traders
  after the roll's production (the event die, then production, then the
  villages: the scenario's `afterRoll`, which the C&K roll now runs). The
  pirate moves only for a player who has reached a village (Seafarers 2020
  p. 22), by a 7 or by a knight's chase, and only after the first attack;
  it robs a card (resource or commodity) or a cloth. No Longest Trade Route
  in this scenario, so none in C&K either.
- **The Wonders of Catan:** wonder levels are paid with the resources on
  the wonder cards; commodities never pay for them. Its "Theater" and
  "Cathedral" wonders have nothing to do with the C&K improvements of those
  names. There is no pirate; the robber waits by the track like the pirate
  elsewhere and then goes to its desert.

### Ambiguities and engine choices (Seafarers)

32. **The robber before the first attack.** 2020 p. 4 puts the robber on
    the desert, unmoved until the first attack; 2025 p. 6 keeps it beside
    the barbarian track and places it at the first attack; for the pirate
    2025 p. 12 says outright that it waits on the track and then takes its
    scenario start. Seafarers scenarios often start the robber on a numbered
    hex (the hills 12 of New Shores with 3 or 5–6 players, Cloth's fields
    12), where a sleeping robber would cost production that the C&K rule
    never takes. Engine: on a Seafarers map both wait off the board and
    go to their scenario starts at the first attack (`ck.asleep`), so before
    it ships may be built next to the pirate's starting hex. On the base
    map the robber still sleeps on the desert (the same effect).
33. **Which scenarios.** The rulebooks name two that work well and two
    kinds that do not. Cloth for Catan and The Wonders of Catan are not
    named. Both are played from big islands everyone starts on (one, or
    two for Cloth), with no hidden hexes; their small islands are no more
    than New Shores' four (Cloth's four tribe islets cannot even be
    settled). The engine allows them. The Forgotten Tribe and The Pirate
    Islands are refused: besides their many islets, each needs development
    cards (gifts; Knight cards for warships), which C&K removes, and no
    source says what replaces them.
34. **Knights at a road–ship junction.** 2025 moves knights "along your
    continuous routes of roads and ships", and Seafarers FAQ 16 says a road
    and a ship meeting without a settlement do not make one *trade route*.
    2020 lets a knight go wherever "roads and ships connect" its start and
    end. Engine: 2020; the knight passes where the owner's road and ship
    meet.
35. **The setup city in Cloth for Catan** is the third placement, the one
    that collects (the rulebooks do not combine the two; this follows C&K's
    "the second, resource-collecting placement is a city").
36. **Chasing the pirate from the coast.** 2020 and 2025 say "a knight on a
    sea hex intersection"; catan.com and the German rulebook say a knight
    "adjacent to the sea hex occupied by the pirate". Engine: any
    intersection of the pirate's hex, coastal ones included.
37. **5–6 players.** No rulebook covers C&K 5–6 with Seafarers 5–6; each
    5–6 extension says it uses every rule of the game it extends, so the
    engine composes them: the C&K 5–6 supply and turn (paired players or the
    special build phase, section 15) on the Seafarers 5–6 maps of New Shores
    and Through the Desert, to 16 VP.
38. **Fog Islands, Forgotten Tribe and Pirate Islands interactions** (fog
    discoveries paying commodities, development-card gifts, fortresses
    against the barbarians) need no rule: those scenarios are refused.

### The computer players (Seafarers)

`ckBot.ts` plays these scenarios with the same levels (section 14), plus:

- set-up and settlement spots value gold as a free pick (never a commodity)
  and the island chits of a new area;
- once its island is full, medium and hard save for a ship toward a spot
  across the sea; roads and ships are scored by what each can reach (a
  coastal road leads nowhere at sea);
- hard sails for a Cloth village with cloth while it trades with fewer
  than two and one is a few ships away (nearer villages, likelier numbers
  and fewer traders first);
- a knight next to the pirate chases it when the pirate holds the player's
  ships;
- The Wonders: claim the wonder whose costs fit the player's production,
  then build its levels, first of all once the VP are there and only a
  level more than everyone else wins;
- gold picks follow what the player is short of.

`npm run bots:league -- 60 ck:seafarers-1-new-shores official 3` (any
scenario that combines, `official` or `random`, 3–6 players) plays the
levels against each other; the README has the results.
