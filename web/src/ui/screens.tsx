import { COSTS, listScenarios, type GameOptions, type ScenarioDef } from 'engine';
import { useMemo, useState } from 'preact/hooks';
import { BOT_NAMES, PLAYER_COLORS, type BotSpeed, type Seat, type SeatKind } from '../game/seats';
import { loadJson } from '../game/storage';
import { Cost, Sheet, Stepper } from './common';

/** Builds for sandboxed previews (no WebSocket or WebRTC) set VITE_NO_ONLINE. */
export const ONLINE = !import.meta.env.VITE_NO_ONLINE;

export function Logo() {
  return (
    <svg class="logo" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M32 4 56 18v28L32 60 8 46V18Z" fill="#1d5f8a" />
      <path d="M32 10 51 21v22L32 54 13 43V21Z" fill="#e8c35a" />
      <path d="M32 17 45 24.5v15L32 47 19 39.5v-15Z" fill="#3f8f4a" />
      <path d="M25 38h14l-2.5 4h-9Z" fill="#fff" />
      <path d="M31 24h2v14h-2Z" fill="#fff" />
      <path d="M33 25c4.5 2.2 6.5 6.5 5.5 11H33Z" fill="#fff" />
    </svg>
  );
}

export function HomeScreen({
  saved,
  onContinue,
  onNew,
  onHost,
  onJoin,
  onRules,
}: {
  saved: { label: string } | null;
  onContinue(): void;
  onNew(): void;
  onHost(): void;
  onJoin(): void;
  onRules(): void;
}) {
  return (
    <main class="home">
      <div class="home-card">
        <Logo />
        <h1>Island Traders</h1>
        <p class="tagline">Settle islands, trade goods and sail for glory. Play on one device, against the computer, or online with friends.</p>
        <div class="home-buttons">
          {saved && (
            <button type="button" class="primary big" onClick={onContinue}>
              ▶ Continue
              <span class="btn-sub">{saved.label}</span>
            </button>
          )}
          <button type="button" class={saved ? 'big' : 'primary big'} onClick={onNew}>
            New game
            <span class="btn-sub">Pass-and-play and computer players</span>
          </button>
          {ONLINE ? (
            <>
              <button type="button" class="big" onClick={onHost}>
                Host online game
                <span class="btn-sub">Friends join with a room code</span>
              </button>
              <button type="button" class="big" onClick={onJoin}>
                Join online game
              </button>
            </>
          ) : (
            <p class="hint">Online play with friends is available on the hosted version of the game.</p>
          )}
          <button type="button" class="link" onClick={onRules}>
            How to play
          </button>
        </div>
      </div>
      <footer class="disclaimer">
        Island Traders is an unofficial, non-commercial fan project. It follows the rules of Catan and Catan: Seafarers but is not affiliated with or
        endorsed by Catan GmbH. Maps and art are original.
      </footer>
    </main>
  );
}

export interface NewGameConfig {
  scenario: string;
  seats: Seat[];
  options: Partial<GameOptions>;
  botSpeed: BotSpeed;
  seed: string;
}

function defaultSeats(n: number, online: boolean, prev: Seat[] = []): Seat[] {
  const out: Seat[] = [];
  for (let i = 0; i < n; i++) {
    if (prev[i]) {
      out.push(prev[i]);
      continue;
    }
    const kind: SeatKind = i === 0 ? 'human' : online ? 'remote' : 'bot';
    // Online, everyone sees the host's name, so "You" would be confusing.
    const hostName = online ? loadJson<string>('playerName') || 'Host' : 'You';
    out.push({ name: i === 0 ? hostName : kind === 'remote' ? `Friend ${i}` : BOT_NAMES[i - 1], kind, color: i });
  }
  return out;
}

export function NewGameScreen({ online, onStart, onBack }: { online: boolean; onStart(c: NewGameConfig): void; onBack(): void }) {
  const scenarios = useMemo(() => listScenarios(), []);
  const [scenarioId, setScenarioId] = useState('base');
  const sc = scenarios.find((s) => s.id === scenarioId) as ScenarioDef;
  const [count, setCount] = useState(online ? 3 : 4);
  const [seats, setSeats] = useState<Seat[]>(() => defaultSeats(online ? 3 : 4, online));
  const [vp, setVp] = useState<number | null>(null);
  const [friendly, setFriendly] = useState(false);
  const [separate, setSeparate] = useState(false);
  const [fiveSix, setFiveSix] = useState<'paired' | 'specialBuild'>('paired');
  const [tokens, setTokens] = useState<'spiral' | 'random'>('spiral');
  const [speed, setSpeed] = useState<BotSpeed>('normal');
  const [showOptions, setShowOptions] = useState(false);

  const n = Math.min(Math.max(count, sc.minPlayers), sc.maxPlayers);
  const activeSeats = defaultSeats(n, online, seats).slice(0, n);
  const target = vp ?? sc.victoryPoints(n);

  const setSeat = (i: number, patch: Partial<Seat>) => {
    const next = defaultSeats(Math.max(seats.length, n), online, seats);
    next[i] = { ...next[i], ...patch };
    setSeats(next);
  };
  const cycleColor = (i: number) => {
    const used = new Set(activeSeats.map((s) => s.color));
    let c = activeSeats[i].color;
    for (let k = 0; k < PLAYER_COLORS.length; k++) {
      c = (c + 1) % PLAYER_COLORS.length;
      if (!used.has(c)) break;
    }
    setSeat(i, { color: c });
  };
  const kinds: SeatKind[] = online ? ['human', 'bot', 'remote'] : ['human', 'bot'];
  const kindLabel: Record<SeatKind, string> = { human: online ? 'Here' : 'Human', bot: 'Computer', remote: 'Friend' };
  const humans = activeSeats.filter((s) => s.kind === 'human').length;
  const remotes = activeSeats.filter((s) => s.kind === 'remote').length;
  const valid = !online || (humans >= 1 && remotes >= 1) || (online && humans >= 1);

  return (
    <main class="setup">
      <header class="setup-head">
        <button type="button" class="icon-btn" onClick={onBack} aria-label="Back">
          ←
        </button>
        <h1>{online ? 'Host an online game' : 'New game'}</h1>
      </header>

      <section class="setup-section">
        <h2>Scenario</h2>
        <div class="scenario-list">
          {scenarios.map((s) => (
            <button
              type="button"
              key={s.id}
              class={s.id === scenarioId ? 'scenario-card on' : 'scenario-card'}
              onClick={() => {
                setScenarioId(s.id);
                setVp(null);
                setCount(Math.min(Math.max(count, s.minPlayers), s.maxPlayers));
              }}
            >
              <span class="scenario-title">{s.name}</span>
              <span class="scenario-meta">
                {s.expansion === 'seafarers' ? 'Seafarers' : 'Classic'} · {s.minPlayers}–{s.maxPlayers} players
              </span>
              {s.id === scenarioId && <span class="scenario-text">{s.description}</span>}
            </button>
          ))}
        </div>
      </section>

      <section class="setup-section">
        <h2>Players</h2>
        <div class="row">
          <span>Number of players</span>
          <Stepper value={n} min={sc.minPlayers} max={sc.maxPlayers} onChange={setCount} label="players" />
        </div>
        <div class="seat-list">
          {activeSeats.map((s, i) => (
            <div class="seat" key={i}>
              <button
                type="button"
                class="swatch"
                style={{ background: PLAYER_COLORS[s.color].fill, borderColor: PLAYER_COLORS[s.color].stroke }}
                aria-label={`Colour ${PLAYER_COLORS[s.color].label}, tap to change`}
                onClick={() => cycleColor(i)}
              />
              <input
                class="seat-name"
                value={s.name}
                maxLength={16}
                aria-label={`Player ${i + 1} name`}
                onInput={(e) => setSeat(i, { name: (e.target as HTMLInputElement).value })}
              />
              <div class="seg">
                {kinds.map((k) => (
                  <button
                    type="button"
                    key={k}
                    class={s.kind === k ? 'on' : ''}
                    onClick={() =>
                      setSeat(i, {
                        kind: k,
                        name:
                          s.kind === k
                            ? s.name
                            : k === 'bot'
                              ? BOT_NAMES[i] ?? `Bot ${i + 1}`
                              : k === 'remote'
                                ? `Friend ${i}`
                                : i === 0
                                  ? 'You'
                                  : `Player ${i + 1}`,
                      })
                    }
                  >
                    {kindLabel[k]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        {!online && humans > 1 && <p class="hint">Several humans share this device: it asks you to pass it on so hands stay hidden.</p>}
        {online && <p class="hint">"Friend" seats are filled by people who join with your room code. "Here" seats are played on this device.</p>}
      </section>

      <section class="setup-section">
        <button type="button" class="link" onClick={() => setShowOptions(!showOptions)}>
          {showOptions ? '▾' : '▸'} Options
        </button>
        {showOptions && (
          <div class="options">
            <div class="row">
              <span>Victory points</span>
              <Stepper value={target} min={3} max={25} onChange={(v) => setVp(v)} label="victory points" />
            </div>
            <label class="row check">
              <input type="checkbox" checked={friendly} onChange={(e) => setFriendly((e.target as HTMLInputElement).checked)} />
              Friendly robber (spares players with 2 or fewer points)
            </label>
            <label class="row check">
              <input type="checkbox" checked={separate} onChange={(e) => setSeparate((e.target as HTMLInputElement).checked)} />
              Trade before building (separate phases)
            </label>
            {sc.id === 'base' && n <= 4 && (
              <label class="row check">
                <input type="checkbox" checked={tokens === 'random'} onChange={(e) => setTokens((e.target as HTMLInputElement).checked ? 'random' : 'spiral')} />
                Random number tokens (instead of the spiral)
              </label>
            )}
            {n >= 5 && (
              <label class="row check">
                <input
                  type="checkbox"
                  checked={fiveSix === 'specialBuild'}
                  onChange={(e) => setFiveSix((e.target as HTMLInputElement).checked ? 'specialBuild' : 'paired')}
                />
                Special build phase instead of paired players
              </label>
            )}
            <div class="row">
              <span>Computer speed</span>
              <div class="seg">
                {(['slow', 'normal', 'fast'] as BotSpeed[]).map((s) => (
                  <button type="button" key={s} class={speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      <div class="setup-foot">
        <button
          type="button"
          class="primary big wide"
          disabled={!valid}
          onClick={() =>
            onStart({
              scenario: scenarioId,
              seats: activeSeats.map((s, i) => ({ ...s, name: s.name.trim() || `Player ${i + 1}` })),
              options: {
                ...(vp !== null ? { victoryPoints: vp } : {}),
                friendlyRobber: friendly,
                tradeBuildMode: separate ? 'separate' : 'combined',
                fiveSixMode: fiveSix,
                tokenPlacement: tokens,
              },
              botSpeed: speed,
              seed: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            })
          }
        >
          {online ? 'Open the room' : 'Start game'}
        </button>
      </div>
    </main>
  );
}

export function PassScreen({ name, color, reason, onReady }: { name: string; color: string; reason: string; onReady(): void }) {
  return (
    <main class="pass" style={{ '--pc': color } as Record<string, string>}>
      <div class="pass-card">
        <div class="pass-icon">📱</div>
        <h1>Pass the device to</h1>
        <div class="pass-name" style={{ color }}>
          {name}
        </div>
        <p>{reason}</p>
        <button type="button" class="primary big" onClick={onReady}>
          I'm {name}: show my cards
        </button>
      </div>
    </main>
  );
}

export function RulesSheet({ close }: { close(): void }) {
  return (
    <Sheet title="How to play" onClose={close} wide>
      <div class="rules">
        <p>
          Build settlements on the corners of the land hexes. When a hex's number is rolled, each adjacent settlement gets 1 resource and each city 2.
          The first player to reach the target victory points on their own turn wins.
        </p>
        <h3>Your turn</h3>
        <ol>
          <li>Roll the dice. Everyone collects resources.</li>
          <li>Trade with other players, or with the bank at 4:1 (3:1 or 2:1 at a harbor).</li>
          <li>Build, buy development cards and play one card, then end your turn.</li>
        </ol>
        <h3>Costs</h3>
        <ul class="costs">
          <li>
            Road <Cost cost={COSTS.road} />
          </li>
          <li>
            Ship (Seafarers) <Cost cost={COSTS.ship} />
          </li>
          <li>
            Settlement (1 VP) <Cost cost={COSTS.settlement} />
          </li>
          <li>
            City (2 VP) <Cost cost={COSTS.city} />
          </li>
          <li>
            Development card <Cost cost={COSTS.devCard} />
          </li>
        </ul>
        <h3>Placing</h3>
        <p>
          Settlements need two free paths between them and any other building, and (after the start) must touch your road or ship. Ships sail on
          sea paths and link to roads only through a settlement.
        </p>
        <h3>A 7</h3>
        <p>
          Nobody produces. Anyone with more than 7 cards discards half. The roller moves the robber (or the pirate at sea) and steals a card from a
          neighbour.
        </p>
        <h3>Awards</h3>
        <p>Longest road or trade route (5+) and largest army (3+ knights) are worth 2 VP each.</p>
        <p class="hint">Every scenario's special rules are shown in its description and under ⭐ Special during the game.</p>
      </div>
    </Sheet>
  );
}
