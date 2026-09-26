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

## 4. Free hosting (decided: public repo + GitHub Pages)

The repository is `Englader/Island-traders` and is public. GitHub
Pages is free for public repositories, so the site will live at
`https://englader.github.io/Island-traders/`.

- One-time setting: **Settings → Pages → Source: GitHub Actions**.
- Workflow `.github/workflows/pages.yml`, on every push to `main`: `npm ci`,
  then `npm test`, then the Vite build of `web/`, then `actions/upload-pages-artifact`
  and `actions/deploy-pages`.
- Set Vite's `base` to `/Island-traders/` (it must match the repository name exactly) so asset paths work under the
  repository path.
- Branding: the game is called **Island Traders** everywhere users see it
  (site title, UI, README). "Catan" appears only as a factual reference to
  the rules it follows, with the not-affiliated notice. No official maps or
  art.
- Fallback if the repo goes private again: Cloudflare Pages (free, deploys
  from private repos).

## 5. Engine follow-ups

- 5–6 player maps for the Seafarers scenarios (only the base game and New
  World support 5–6 players today).
- Let bots make domestic trade offers.
- Official maps as `MapSpec` data if they are verified and licensed.
