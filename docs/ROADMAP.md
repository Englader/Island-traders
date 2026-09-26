# Roadmap

The rules engine is done: all base and Seafarers rules, 10 scenarios, 5–6
player modes, redacted views, legal-move enumeration and 154 tests. These are
the next steps, in order.

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

The beginner setup (Illustration A) was not added: it is a printed map, and
published maps stay original.

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
