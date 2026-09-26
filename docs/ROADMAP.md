# Roadmap

The rules engine is done: all base and Seafarers rules, 10 scenarios, 5–6
player modes, redacted views, legal-move enumeration and 154 tests. These are
the next steps, in order.

## 1. Check the rules against the official rulebooks

This needs network access. The environment must allow these hosts:

- `www.catan.com` (5th-edition Seafarers and base rulebook PDFs, FAQs)
- `www.ultraboardgames.com`
- `boardgamegeek.com`
- optionally `www.catan.de` (German rulebooks)

Tasks:

- Read the 5th-edition Seafarers rulebook. Compare scenarios 1–9 with
  [`rules.md`](rules.md), which marks every rule taken from secondary
  sources and every remaining engine choice:
  - VP targets: the spec and this engine use 14/13/12/14/13/14/10/10/12.
    JSettlers2 uses 13 for New Shores, 12 for Four Islands and 12 for Through
    the Desert.
  - Pirate Islands dotted ship lines, Cloth tie-breaks, New World island
    bonus value (1 or 2 VP), and gold yield during setup.
- Base game: add the beginner setup (Illustration A) as a fixed map.
- Keep the maps original for anything published. The printed maps are Catan
  GmbH's copyrighted material.

## 2. Browser game on one device

The engine has no dependencies and runs in the browser as is.

- **Stack:** Vite + TypeScript in a `web/` folder, with an SVG board drawn
  using `hexCenter`, `vertexPoint` and `edgeMidpoint` from `src/board/hex.ts`.
- **Screens:**
  - new game: scenario, seats (human or bot), options
  - board: tap intersections and paths to build; legal spots are highlighted
    from `legalSettlements` / `legalRoads` / `legalShips`
  - player panel and action bar: roll, build, buy, trade, dev cards, end turn
  - dialogs: discard, gold choice, robber/pirate and victim, trade
    offer/accept, Year of Plenty, Monopoly, harbor placement, scenario
    actions (wonders, fortress, cloth, rob)
  - game log
- **Pass-and-play:** render `viewFor(state, seat)` for the seat that must act.
  Show a "pass the device to …" screen between seats so hands stay hidden.
- **Bots:** replace the weighted-random bot with a heuristic one. It should
  score settlement spots by pips and resource variety, and trade toward the
  next build.
- **Save and resume:** keep the JSON state in `localStorage`.
- Make it phone friendly (large tap targets, portrait layout).
- Add a Playwright smoke test that starts a game and plays a few turns.

## 3. Playing online with friends

The engine is already built for this: `applyAction` is pure, validates every
move and is deterministic from its seed, and `viewFor` hides secret
information per seat.

| Option | How | Cost | Trade-offs |
|---|---|---|---|
| **A. Peer-to-peer (recommended first)** | The host's browser runs the engine and friends join with a room code over WebRTC via [PeerJS](https://peerjs.com/). Friends send actions; the host checks them with `applyAction` and sends each seat its `viewFor`. | Free, and works on any static host. The PeerJS cloud handles signaling for free. | The host must keep the tab open. Some strict networks need a TURN relay, which isn't free at scale. The shared PeerJS server can be flaky; a self-hosted one is an option. |
| B. Cloudflare Worker + one Durable Object per room | A WebSocket server holds the authoritative state; clients only ever receive their `viewFor`. | [Durable Objects are on the Workers Free plan](https://developers.cloudflare.com/changelog/2025-04-07-durable-objects-free-tier/) (about 3M requests a month). | Games survive the host leaving and players can reconnect. Needs a Cloudflare account and API token. |
| C. Firebase / Supabase realtime | Shared database state. | Free tiers. | Hidden information (hands, deck) needs server functions, so it's a poor fit. |

Plan: build A first, then add B if games need to survive disconnects.

## 4. Free hosting

The repository is **private**. [GitHub Pages](https://docs.github.com/get-started/learning-about-github/githubs-products)
works from private repositories only on paid plans (GitHub Pro, Team,
Enterprise). On GitHub Free it works only for public repositories.

- **Keep the repo private:** use **Cloudflare Pages** on its free plan. It
  deploys from private GitHub repos, allows 500 builds a month, and has
  unmetered static bandwidth. Connect the repo once in the Cloudflare
  dashboard, with build command `npm ci && npm run build:web` and output
  `web/dist`. The same account can host the Durable Object server for
  option B.
- **Make the repo public:** GitHub Pages through a GitHub Actions workflow
  (`npm ci` → `npm test` → `vite build` → `actions/deploy-pages`). This is
  also free.
- **Before publishing:** a public site should not use the name "Catan" or
  its art. Pick a neutral title or keep the link private; see the IP notice
  in the README.

## 5. Engine follow-ups

- 5–6 player maps for the Seafarers scenarios (only the base game and New
  World support 5–6 players today).
- Let bots make domestic trade offers.
- Official maps as `MapSpec` data if they are verified and licensed.
