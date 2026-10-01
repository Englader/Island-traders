import { CK_COSTS, CK_VICTORY_POINTS, COSTS, listScenarios, type GameOptions, type MapLayout, type ScenarioDef } from 'engine';
import { Fragment } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { BOT_NAMES, LEVEL_HINT, LEVEL_LABEL, PLAYER_COLORS, type BotLevel, type BotSpeed, type Seat, type SeatKind } from '../game/seats';
import { loadJson, saveJson } from '../game/storage';
import { Cost, Sheet, Stepper } from './common';
import { MapPreview } from './MapPreview';
import { GateGlyph, KnightGlyph } from './ckArt';

/** Builds for sandboxed previews (no WebSocket or WebRTC) set VITE_NO_ONLINE. */
export const ONLINE = !import.meta.env.VITE_NO_ONLINE;

export function Logo() {
  return (
    <svg class="logo" viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <radialGradient id="logo-sea" cx="50%" cy="38%" r="72%">
          <stop offset="0" stop-color="#4c9dd8" />
          <stop offset="1" stop-color="#16497a" />
        </radialGradient>
        <linearGradient id="logo-land" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stop-color="#8fd06e" />
          <stop offset="1" stop-color="#3f8f45" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#logo-sea)" />
      <ellipse cx="32" cy="36" rx="25" ry="15" fill="#9fdcf7" opacity="0.35" />
      <path d="M11 30 21 17h22l10 13v6L43 49H21L11 36Z" fill="#245a2a" />
      <path d="M11 30 21 17h22l10 13-10 13H21Z" fill="url(#logo-land)" stroke="#d9f5c8" stroke-opacity="0.5" stroke-width="0.8" />
      <path d="M19 34l3-5 3 5ZM41 26l3-5 3 5ZM38 38l2.5-4 2.5 4Z" fill="#1d4f25" opacity="0.6" />
      <path d="M36.5 35v-8l-4.8-4.8-4.8 4.8v8Z" fill="#e0453b" stroke="#7c1d18" stroke-width="0.8" stroke-linejoin="round" />
      <path d="M36.5 35l3-2v-7.5l-3 1.5ZM31.7 22.2l3.2-1.8 4.6 5.1-3 1.5Z" fill="#a52a22" stroke="#7c1d18" stroke-width="0.8" stroke-linejoin="round" />
    </svg>
  );
}

/** Phones not yet running the game as an installed app get a one-line tip. */
function installTip(): string | null {
  try {
    const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
    const touch = matchMedia('(pointer: coarse)').matches;
    if (standalone || !touch || !ONLINE) return null;
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    return ios
      ? 'Tip: tap Share → "Add to Home Screen" to play full screen, even offline.'
      : 'Tip: use the browser menu → "Add to Home screen" to play full screen, even offline.';
  } catch {
    return null;
  }
}

/** Whether the device has a network connection, kept up to date. */
function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
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
  const online = useOnline();
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
              <button type="button" class="big" onClick={onHost} disabled={!online}>
                Host online game
                <span class="btn-sub">{online ? 'Friends join with a room code' : 'Needs an internet connection'}</span>
              </button>
              <button type="button" class="big" onClick={onJoin} disabled={!online}>
                Join online game
              </button>
              {!online && <p class="hint">You're offline. Games on this device, against the computer or pass-and-play, still work.</p>}
            </>
          ) : (
            <p class="hint">Online play with friends is available on the hosted version of the game.</p>
          )}
          <button type="button" class="link" onClick={onRules}>
            How to play
          </button>
          {installTip() && <p class="install-tip">{installTip()}</p>}
        </div>
      </div>
      <footer class="disclaimer">
        Island Traders is an unofficial, non-commercial fan project. It follows the rules of Catan and Catan: Seafarers but is not affiliated with or
        endorsed by Catan GmbH. The art is original; the official maps follow the rulebooks.
      </footer>
    </main>
  );
}

export interface NewGameConfig {
  scenario: string;
  seats: Seat[];
  options: Partial<GameOptions>;
  botSpeed: BotSpeed;
  botLevel: BotLevel;
  seed: string;
}

/** A fresh game seed: it deals the map shown in the preview, and the game is started with it. */
function newSeed(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultSeats(n: number, online: boolean, prev: Seat[] = []): Seat[] {
  const out: Seat[] = [];
  for (let i = 0; i < n; i++) {
    if (prev[i]) {
      out.push(prev[i]);
      continue;
    }
    const kind: SeatKind = i === 0 ? 'human' : online ? 'remote' : 'bot';
    // The log reads "<name> rolls 8", so the first seat gets a real name: the one used last time.
    const hostName = loadJson<string>('playerName') || (online ? 'Host' : 'Player 1');
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
  const [layout, setLayout] = useState<MapLayout>(() => (loadJson<MapLayout>('mapLayout') === 'random' ? 'random' : 'official'));
  const [seed, setSeed] = useState(newSeed);
  const [speed, setSpeed] = useState<BotSpeed>('normal');
  const [level, setLevel] = useState<BotLevel>(() => loadJson<BotLevel>('botLevel') ?? 'medium');
  const [showOptions, setShowOptions] = useState(false);
  // Cities & Knights: on the base game, 3-6 players (5-6 with the C&K 5-6 extension)
  const [ckOn, setCkOn] = useState(() => loadJson<boolean>('citiesAndKnights') === true);
  const ck = ckOn && scenarioId === 'base';

  const n = Math.min(Math.max(count, sc.minPlayers), sc.maxPlayers);
  const activeSeats = defaultSeats(n, online, seats).slice(0, n);
  const target = vp ?? (ck ? CK_VICTORY_POINTS : sc.victoryPoints(n));
  // The preview is built with exactly these options and seed, so it shows the board the game will use.
  const options: Partial<GameOptions> = {
    ...(vp !== null ? { victoryPoints: vp } : {}),
    layout,
    friendlyRobber: friendly,
    tradeBuildMode: separate ? 'separate' : 'combined',
    fiveSixMode: fiveSix,
    tokenPlacement: tokens,
    ...(ck ? { citiesAndKnights: true } : {}),
  };

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
            <Fragment key={s.id}>
              <button
                type="button"
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
              {s.id === scenarioId && (
                <div class="map-block">
                  {s.id === 'base' && (
                    <label class={ck ? 'ck-toggle on' : 'ck-toggle'}>
                      <span class="ck-toggle-art" aria-hidden="true">
                        <KnightGlyph level={2} active fill="#d8433b" stroke="#7c1d18" />
                      </span>
                      <span class="ck-toggle-text">
                        <b>Cities &amp; Knights</b>
                        <span>Knights, barbarians, city improvements · 13 VP</span>
                      </span>
                      <input
                        type="checkbox"
                        role="switch"
                        class="switch"
                        checked={ck}
                        aria-label="Play with Cities & Knights"
                        onChange={(e) => {
                          const on = (e.target as HTMLInputElement).checked;
                          setCkOn(on);
                          setVp(null);
                        }}
                      />
                    </label>
                  )}
                  <div class="row map-row">
                    <span>Map</span>
                    <div class="seg" role="group" aria-label="Map">
                      {(['official', 'random'] as MapLayout[]).map((l) => (
                        <button type="button" key={l} class={layout === l ? 'on' : ''} aria-pressed={layout === l} onClick={() => setLayout(l)}>
                          {l === 'official' ? 'Official' : 'Random'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <MapPreview
                    scenario={scenarioId}
                    name={ck ? `${sc.name} · Cities & Knights` : sc.name}
                    players={n}
                    options={options}
                    seed={seed}
                    onReroll={() => setSeed(newSeed())}
                  />
                </div>
              )}
            </Fragment>
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
                              ? BOT_NAMES.find((n) => !activeSeats.some((o, j) => j !== i && o.name === n)) ?? `Bot ${i + 1}`
                              : k === 'remote'
                                ? `Friend ${i}`
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
        {activeSeats.some((s) => s.kind === 'bot') && (
          <div class="level-pick">
            <div class="row">
              <span>Computer players</span>
              <div class="seg">
                {(['easy', 'medium', 'hard'] as BotLevel[]).map((l) => (
                  <button type="button" key={l} class={level === l ? 'on' : ''} onClick={() => setLevel(l)}>
                    {LEVEL_LABEL[l]}
                  </button>
                ))}
              </div>
            </div>
            <p class="hint">{LEVEL_HINT[level]}</p>
          </div>
        )}
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
            {sc.id === 'base' && n <= 4 && layout === 'random' && (
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
          onClick={() => {
            if (activeSeats[0]?.kind === 'human' && activeSeats[0].name.trim()) saveJson('playerName', activeSeats[0].name.trim());
            saveJson('botLevel', level);
            saveJson('mapLayout', layout);
            if (scenarioId === 'base') saveJson('citiesAndKnights', ckOn);
            onStart({
              scenario: scenarioId,
              seats: activeSeats.map((s, i) => ({ ...s, name: s.name.trim() || `Player ${i + 1}` })),
              options,
              botSpeed: speed,
              botLevel: level,
              // the seed of the preview: the game gets the board shown there
              seed,
            });
          }}
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
        <h3 class="rules-ck">
          <KnightGlyph level={2} active fill="#2f6fe0" stroke="#173a7a" /> Cities &amp; Knights
        </h3>
        <p>
          Played to 13 VP. Your second starting piece is a city. Three dice: the white and red production dice and the event die. There are no
          development cards: progress cards take their place.
        </p>
        <ul class="rules-ck-list">
          <li>
            <b>Commodities.</b> A city on forest, pasture or mountains takes 1 resource and 1 commodity: paper, cloth or coin. They count in your hand,
            can be traded (4:1, 3:1 at a generic harbor) and stolen.
          </li>
          <li>
            <b>City improvements</b> cost 1–5 of a commodity: <GateGlyph track="trade" /> trade (cloth), <GateGlyph track="politics" /> politics (coin) and{' '}
            <GateGlyph track="science" /> science (paper). Level 3 gives an ability (2:1 commodities, mighty knights, the Aqueduct); the first to level 4
            builds the metropolis (+2 VP). Tap <b>Improve</b> (key I) for the three tracks.
          </li>
          <li>
            <b>The event die.</b> A ship moves the barbarians one space; a city gate draws progress cards for players whose improvement of its colour
            shows the red die (level 1: red 1–2, each level one more).
          </li>
          <li>
            <b>Progress cards.</b> You hold up to 4 (victory point cards count at once). Play any number on your turn after the roll, under{' '}
            <b>Cards</b> (key C): pick its choices (a player, a spot on the board, a resource), then confirm. The <b>Alchemist</b> is played
            before the roll, from the button beside <b>Roll</b> (key A): you choose both production dice. A card you can't play yet says why.
          </li>
          <li>
            <b>Knights</b> <Cost cost={CK_COSTS.knight} /> stand on your roads and block others. Activate one <Cost cost={CK_COSTS.activate} />, promote it{' '}
            <Cost cost={CK_COSTS.promote} />; an active knight can move, displace a weaker knight or chase the robber. Tap <b>Knights</b> (key K),
            then a knight.
          </li>
          <li>
            <b>The barbarians</b> land after 7 ship rolls: all cities against all active knights. If they are stronger, whoever defended least loses a
            city; otherwise the best defender becomes Defender of Catan (1 VP). The robber sleeps until the first attack. The track in the header
            shows the ship and both sides' strength: tap it for more.
          </li>
          <li>
            <b>City walls</b> <Cost cost={CK_COSTS.cityWall} /> raise your hand limit on a 7 by 2 each.
          </li>
          <li>
            <b>5–6 players</b> add commodities (18 of each) and Defender of Catan cards (8). After each turn the player three seats on takes a paired
            turn: build, improve cities, use knights, play progress cards and trade with the bank, but not with players. With the special build phase
            (an option) the others may instead build, hire, activate and promote knights and improve cities: no knight moves, cards or trades.
          </li>
        </ul>
        <p class="hint">Every scenario's special rules are shown in its description and under ⭐ Special during the game.</p>
      </div>
    </Sheet>
  );
}
