import { createGame, getScenario } from 'engine';
import { useEffect, useMemo, useReducer, useState } from 'preact/hooks';
import { GameController, SAVE_KEY, newGameId, type GameRecord } from './game/controller';
import { PLAYER_COLORS, mustAct, type BotSpeed } from './game/seats';
import { loadJson } from './game/storage';
import { Sheet } from './ui/common';
import { GameScreen } from './ui/GameScreen';
import { flashOf } from './ui/flash';
import { HomeScreen, NewGameScreen, ONLINE, PassScreen, RulesSheet, type NewGameConfig } from './ui/screens';
import { GuestScreen, HostLobby, JoinScreen, useHostNetwork } from './net/online';

type Route =
  | { name: 'home' }
  | { name: 'new'; online: boolean }
  | { name: 'game' }
  | { name: 'lobby' }
  | { name: 'join'; code: string }
  | { name: 'guest'; code: string; playerName: string };

function initialRoute(): Route {
  const m = ONLINE ? /join=([A-Za-z0-9]+)/.exec(location.hash) : null;
  if (m) return { name: 'join', code: m[1].toUpperCase() };
  return { name: 'home' };
}

function savedLabel(r: GameRecord | null): { label: string } | null {
  if (!r || r.state.phase.kind === 'gameOver') return null;
  let name = r.state.scenario;
  try {
    name = getScenario(r.state.scenario).name;
  } catch {
    return null;
  }
  return { label: `${name} · turn ${r.state.turn.number} · ${r.seats.length} players` };
}

function recordFrom(config: NewGameConfig, mode: 'local' | 'host', room?: string): GameRecord {
  const state = createGame({
    scenario: config.scenario,
    players: config.seats.map((s) => s.name),
    seed: config.seed,
    options: config.options,
  });
  return { v: 1, id: newGameId(), mode, seats: config.seats, state, botSpeed: config.botSpeed, room, savedAt: Date.now() };
}

export function App() {
  const [route, setRoute] = useState<Route>(initialRoute);
  const [ctrl, setCtrl] = useState<GameController | null>(null);
  const [lastConfig, setLastConfig] = useState<NewGameConfig | null>(null);
  const [rules, setRules] = useState(false);
  const [menu, setMenu] = useState(false);
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => (ctrl ? ctrl.subscribe(() => force(undefined)) : undefined), [ctrl]);
  useEffect(() => () => ctrl?.destroy(), [ctrl]);

  const host = useHostNetwork(ctrl && ctrl.record.mode === 'host' ? ctrl : null);

  const startController = (record: GameRecord) => {
    ctrl?.destroy();
    const c = new GameController(record);
    c.save();
    setCtrl(c);
    return c;
  };

  const goHome = () => {
    ctrl?.destroy();
    setCtrl(null);
    setMenu(false);
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    setRoute({ name: 'home' });
  };

  const localSave = useMemo(() => (route.name === 'home' ? loadJson<GameRecord>(SAVE_KEY.local) : null), [route]);
  const hostSave = useMemo(() => (route.name === 'home' ? loadJson<GameRecord>(SAVE_KEY.host) : null), [route]);

  let body;
  if (route.name === 'home') {
    const saved = savedLabel(localSave) ?? (hostSave && savedLabel(hostSave) ? { label: `Online · ${savedLabel(hostSave)!.label}` } : null);
    body = (
      <HomeScreen
        saved={saved}
        onContinue={() => {
          const rec = savedLabel(localSave) ? localSave! : hostSave!;
          startController(rec);
          setRoute(rec.mode === 'host' ? { name: 'lobby' } : { name: 'game' });
        }}
        onNew={() => setRoute({ name: 'new', online: false })}
        onHost={() => setRoute({ name: 'new', online: true })}
        onJoin={() => setRoute({ name: 'join', code: '' })}
        onRules={() => setRules(true)}
      />
    );
  } else if (route.name === 'new') {
    body = (
      <NewGameScreen
        online={route.online}
        onBack={() => setRoute({ name: 'home' })}
        onStart={(config) => {
          setLastConfig(config);
          if (route.online) {
            startController(recordFrom(config, 'host', host.newRoomCode()));
            setRoute({ name: 'lobby' });
          } else {
            startController(recordFrom(config, 'local'));
            setRoute({ name: 'game' });
          }
        }}
      />
    );
  } else if (route.name === 'join') {
    body = (
      <JoinScreen
        initialCode={route.code}
        onBack={goHome}
        onJoin={(code, playerName) => setRoute({ name: 'guest', code, playerName })}
      />
    );
  } else if (route.name === 'guest') {
    body = <GuestScreen code={route.code} playerName={route.playerName} onHome={goHome} onRules={() => setRules(true)} />;
  } else if (route.name === 'lobby' && ctrl) {
    body = (
      <HostLobby
        ctrl={ctrl}
        net={host}
        onPlay={() => setRoute({ name: 'game' })}
        onHome={goHome}
      />
    );
  } else if (route.name === 'game' && ctrl) {
    const seat = ctrl.viewer;
    const colors = ctrl.seats.map((s) => PLAYER_COLORS[s.color]);
    if (ctrl.handoff !== null) {
      const p = ctrl.handoff;
      const need = mustAct(ctrl.state);
      const ph = ctrl.state.phase;
      const reason =
        ph.kind === 'discard'
          ? 'to discard cards'
          : ph.kind === 'gold'
            ? 'to choose resources'
            : ph.kind === 'setup'
              ? 'to place their starting pieces'
              : ph.kind === 'main' && ctrl.state.turn.actor !== p
                ? 'to answer a trade offer'
                : need[0] === p
                  ? 'for their turn'
                  : 'to continue';
      body = <PassScreen name={ctrl.seats[p].name} color={colors[p].fill} reason={reason} onReady={() => ctrl.takeDevice(p)} />;
    } else {
      const snap = ctrl.snapshot(seat);
      body = (
        <GameScreen
          view={snap.view}
          legal={snap.legal}
          seat={seat}
          colors={colors}
          kinds={ctrl.seats.map((s) => s.kind)}
          send={(a) => {
            ctrl.act(a);
            if (ctrl.record.mode === 'host') host.broadcast();
          }}
          error={ctrl.error}
          clearError={() => ctrl.clearError()}
          flash={flashOf(ctrl.last?.action, ctrl.last?.at ?? 0)}
          onMenu={() => setMenu(true)}
          onHome={goHome}
          onRematch={
            lastConfig && ctrl.record.mode === 'local'
              ? () => {
                  const cfg = { ...lastConfig, seed: `${Date.now()}` };
                  startController(recordFrom(cfg, 'local'));
                }
              : undefined
          }
          note={ctrl.record.mode === 'host' ? host.status : undefined}
        />
      );
    }
  } else {
    body = <HomeScreen saved={null} onContinue={goHome} onNew={() => setRoute({ name: 'new', online: false })} onHost={() => setRoute({ name: 'new', online: true })} onJoin={() => setRoute({ name: 'join', code: '' })} onRules={() => setRules(true)} />;
  }

  return (
    <>
      {body}
      {rules && <RulesSheet close={() => setRules(false)} />}
      {menu && ctrl && (
        <GameMenu
          speed={ctrl.record.botSpeed}
          room={ctrl.record.room}
          onSpeed={(s) => ctrl.setBotSpeed(s)}
          onRules={() => {
            setMenu(false);
            setRules(true);
          }}
          onRoom={
            ctrl.record.mode === 'host'
              ? () => {
                  setMenu(false);
                  setRoute({ name: 'lobby' });
                }
              : undefined
          }
          onClose={() => setMenu(false)}
          onQuit={goHome}
          onAbandon={() => {
            ctrl.discardSave();
            goHome();
          }}
        />
      )}
    </>
  );
}

function GameMenu({
  speed,
  room,
  onSpeed,
  onRules,
  onRoom,
  onClose,
  onQuit,
  onAbandon,
}: {
  speed: BotSpeed;
  room?: string;
  onSpeed(s: BotSpeed): void;
  onRules(): void;
  onRoom?: () => void;
  onClose(): void;
  onQuit(): void;
  onAbandon(): void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <Sheet title="Menu" onClose={onClose}>
      <div class="menu">
        {room && (
          <p class="room-line">
            Room code: <strong class="code">{room}</strong>
          </p>
        )}
        <div class="row">
          <span>Computer speed</span>
          <div class="seg">
            {(['slow', 'normal', 'fast'] as BotSpeed[]).map((s) => (
              <button type="button" key={s} class={speed === s ? 'on' : ''} onClick={() => onSpeed(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <button type="button" class="wide" onClick={onClose}>
          Back to the game
        </button>
        {onRoom && (
          <button type="button" class="wide" onClick={onRoom}>
            Room and players
          </button>
        )}
        <button type="button" class="wide" onClick={onRules}>
          How to play
        </button>
        <button type="button" class="wide" onClick={onQuit}>
          Save and go to the home screen
        </button>
        {confirm ? (
          <button type="button" class="wide danger" onClick={onAbandon}>
            Really delete this game?
          </button>
        ) : (
          <button type="button" class="wide danger-outline" onClick={() => setConfirm(true)}>
            Abandon game
          </button>
        )}
        <p class="hint">The game is saved in this browser after every move.</p>
      </div>
    </Sheet>
  );
}
