# Roadmap

The rules engine is done: all base and Seafarers rules, 10 scenarios, 5–6
player modes, redacted views and legal-move enumeration, checked against the
official rulebooks. The browser game, online play and hosting (sections 2–4)
are done too. Section 5 lists what is next.

## 1. Check the rules against the official rulebooks (done)

Scenarios 1–9 were compared with the 5th-edition Seafarers rulebook, the 2025
Seafarers rulebook (for ambiguities), the Seafarers 5-6 and CATAN 5-6 rules,
the base rules and the catan.com FAQs. [`rules.md`](rules.md) lists what
changed and which choices remain. The VP targets (14/13/12/14/13/14/10/10/12)
already matched. Fixed:

- Pirate Islands: the fleet attacks every adjacent player; routes must take a
  shortest path and stop at the fortress; 8 harbors.
- Forgotten Tribe: the 6 harbors are all gifts (5 special + 1 generic) and
  lie face up; the robber only moves to numbered hexes.
- Wonders: +1 VP for the first settlement on each small island.
- New World: the rulebook's component mix (no desert or gold for 3–4
  players, 42 land hexes for 5–6), 9/11 harbors, robber and pirate off-board.
- Four Islands / Fog Islands: no desert, the robber starts on a 12. Fog is
  revealed by roads and ships only. Harbor counts per player count.

Official maps (later): every scenario now starts on its rulebook's set-up
map by default, including the base game's beginners' set-ups; the shuffled
set-ups stay available as the random layout.

Generated maps (later still): the random layout of every Seafarers scenario
is now a new map generated in the style of its printed one (the same frame,
the same kind of islands in new shapes, tiles, numbers and harbors dealt
anew), instead of a fixed original layout with shuffled tiles.

5–6 player maps (later again): Heading for New Shores, The Four Islands (The
Six Islands), The Fog Islands (The Fog Island) and Through the Desert take
3–6 players, on the maps of the Seafarers 5-6 rules (2023), with paired
players, the 5–6 bank and deck, and generated maps in their style.
seafarers-generator.com served as a cross-check; [`rules.md`](rules.md)
lists where it differs from the rulebook.

## 2. Browser game on one device (done)

`web/` is a Vite + Preact app with an SVG board drawn from
`hexCenter` / `vertexPoint`.

- **Screens:** home, new game (scenario, seats human or computer, options),
  the board, pass-the-device, and game over.
- **Board:** legal spots from `legalActions` are highlighted; a tap selects
  and a Yes/No dialog commits a piece ("Ask before building" in the menu;
  turned off, or for the robber and harbors, a confirm bar). Pinch/drag/wheel zoom. Wide Seafarers maps
  rotate 90° on tall screens. Scenario markers: fog, tribe gifts (face up
  except cards), cloth villages, fortresses, the fleet circuit, the strait.
- **Actions and dialogs:** roll, build, trade (bank, and player offers with
  counter-offers), development cards, move ship, scenario actions (wonders,
  fortress attacks, gifted harbors), discard, gold, robber/pirate with a
  victim choice, robbing anyone (Pirate Islands), the log.
- **Pass-and-play:** with several humans on one device, a hand-over screen
  hides each hand.
- **Bots:** `src/bots/heuristicBot.ts` scores spots by pips, missing
  resources, harbors and island bonuses; heads roads and ships for the best
  reachable spot or scenario target; saves for the nearest build and trades
  with the bank only to complete it; answers trade offers. Heuristic bots
  finish games in every scenario (tested).
- **Save and resume:** the whole game record is in `localStorage` after
  every move.
- **Phones:** taps snap to the nearest highlighted spot; a sideways layout;
  installable to the home screen with a service worker that stores the game
  on the first visit, so games against the computer and pass-and-play work
  offline; the screen stays awake during a game.
- **Tests:** Playwright on a phone viewport (`npm run test:e2e`).

## 3. Playing online with friends (done: peer-to-peer)

Option A is built: the host's browser runs the engine and friends join with
a room code over WebRTC via PeerJS. The host validates every move and sends
each seat its `viewFor` view and legal moves. Seats survive reconnects; empty
seats can go to computer players. The broker is configurable
(`?peer=host:port/path`, `VITE_PEER_*`) and `scripts/peer-broker.mjs` runs one
locally, which the online Playwright test uses.

Friends on mobile data often couldn't join: the free TURN servers that relay
WebRTC between phones behind strict NATs no longer work, and the guest waited
forever. Online play now falls back to an encrypted relay through public MQTT
brokers when no direct link opens within a few seconds. Guests retry with
clear messages and send a heartbeat. A host whose page was paused (e.g. while
sending the code in a chat app) gets the room back when it returns. The
**Online check** workflow tests all of this against the real services.

| Option | How | Cost | Trade-offs |
|---|---|---|---|
| **A. Peer-to-peer (built)** | Host browser + PeerJS, public MQTT relay as fallback | Free | The host must keep the game on screen. Relies on free public services (PeerJS broker, MQTT brokers); the Online check workflow watches them. |
| B. Cloudflare Worker + one Durable Object per room | A WebSocket server holds the authoritative state; clients only ever receive their `viewFor`. | [Durable Objects are on the Workers Free plan](https://developers.cloudflare.com/changelog/2025-04-07-durable-objects-free-tier/) | Games survive the host leaving. Needs a Cloudflare account. |
| C. Firebase / Supabase realtime | Shared database state. | Free tiers. | Hidden information needs server functions, so it's a poor fit. |

Next: B if games need to survive the host closing the tab.

## 4. Free hosting (done: public repo + GitHub Pages)

The site is `https://englader.github.io/Island-traders/`.

- Setting: **Settings → Pages → Source: GitHub Actions**.
- `.github/workflows/pages.yml` runs on every push to `main`: `npm ci`,
  typecheck, `npm test`, the Vite build of `web/` with
  `BASE_PATH=/Island-traders/`, then `actions/upload-pages-artifact` and
  `actions/deploy-pages`.
- `.github/workflows/ci.yml` runs the same checks plus the Playwright tests
  on pull requests.
- Branding: **Island Traders** everywhere users see it. "Catan" appears only
  as a factual reference to the rules it follows, with the not-affiliated
  notice. No official art; the official maps are game data (which terrain
  and number go where), drawn with the game's own art.
- Fallback if the repo goes private again: Cloudflare Pages.

## 5. Next steps

- Cities & Knights, in phases: (1) rules spec and engine core (done:
  [`cities-and-knights.md`](cities-and-knights.md)), (2) the progress-card
  effects (done), (3) computer players for it (done), (4) the browser UI and
  art, progress cards included (done), (5) the 5–6 player extension (done:
  section 15 of the spec, with paired players or the special build phase),
  (6) Seafarers combinations (done: section 16 of the spec; Heading for New
  Shores and Through the Desert with 3–6 players, Cloth for Catan and The
  Wonders with 3–4; the other five scenarios stay refused, as the rulebook
  advises against small islands and hidden hexes).
- 5–6 player maps for Seafarers scenarios 5–8 (The Forgotten Tribe, Cloth
  for Catan, The Pirate Islands, The Wonders of Catan): the base game, New
  World and scenarios 1–4 take 5–6 players today.
- Let bots make domestic trade offers (they only answer them now).
- Online option B (a server that keeps games alive without the host).
