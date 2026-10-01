// Development page showing every card and board tile (npm run web:dev, then /gallery.html).
import { render } from 'preact';
import { PROGRESS_CARDS, PROGRESS_CARD_NAMES, createGame, hexCenter, parseHexId, viewFor, type DevCardType, type GameView, type KnightLevel, type Terrain } from 'engine';
import { Board, NO_TARGETS } from './board/Board';
import { COMMODITY_LIST, DEV_INFO, RESOURCE_LIST } from './game/names';
import { TRACK_LIST } from './game/ck';
import { PLAYER_COLORS } from './game/seats';
import { DevCardView, ResourceCard } from './ui/cards';
import { EventDie, GateGlyph, KnightGlyph, ProgressCardView, ShipGlyph, TowerGlyph, WallGlyph } from './ui/ckArt';
import { ResGlyph } from './ui/icons';
import './ui/ck.css';
import './styles.css';

const DEVS = Object.keys(DEV_INFO) as DevCardType[];

/** A wide map (turned on tall screens) with a gold field ringed by every other terrain. */
function tileBoard(): GameView {
  const view = viewFor(createGame({ scenario: 'seafarers-1-new-shores', players: 3, seed: 'gallery' }), null);
  const hexes = view.board.hexes;
  const land = Object.keys(hexes).filter((h) => hexes[h].zone === 'main');
  const cx = land.reduce((s, h) => s + hexCenter(parseHexId(h)).x, 0) / land.length;
  const cy = land.reduce((s, h) => s + hexCenter(parseHexId(h)).y, 0) / land.length;
  const near = [...land].sort((a, b) => {
    const pa = hexCenter(parseHexId(a));
    const pb = hexCenter(parseHexId(b));
    return Math.hypot(pa.x - cx, pa.y - cy) - Math.hypot(pb.x - cx, pb.y - cy);
  });
  const ring: Terrain[] = ['gold', 'mountains', 'hills', 'fields', 'desert', 'forest', 'pasture'];
  near.slice(0, ring.length).forEach((h, i) => (hexes[h] = { ...hexes[h], terrain: ring[i] }));
  // two more on the rim, one with the robber on it
  hexes[near[near.length - 1]] = { ...hexes[near[near.length - 1]], terrain: 'gold' };
  hexes[near[near.length - 3]] = { ...hexes[near[near.length - 3]], terrain: 'gold' };
  view.board.robber = near[near.length - 3];
  return view;
}

const noPick = () => {};

function Tiles() {
  const view = tileBoard();
  // turned in the tall box and flat in the others, whatever the screen
  const box = (w: number, h: number) => (
    <div class="board-area" style={{ width: `${w}px`, height: `${h}px`, position: 'relative', borderRadius: '12px', overflow: 'hidden' }}>
      <Board view={view} colors={PLAYER_COLORS} targets={NO_TARGETS} accent="#ffffff" ghost={null} flash={null} onPick={noPick} turned={h > w} />
    </div>
  );
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-start' }}>
      {box(380, 640)}
      {box(640, 380)}
      {box(330, 210)}
    </div>
  );
}

function Gallery() {
  return (
    <main style={{ padding: '16px', display: 'grid', gap: '18px' }}>
      <h2>Board tiles</h2>
      <Tiles />
      <h2>Resource cards</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
        {RESOURCE_LIST.map((r) => (
          <span key={r} style={{ width: '120px', display: 'flex' }}>
            <ResourceCard r={r} />
          </span>
        ))}
      </div>
      <h2>Development cards</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
        {DEVS.map((d) => (
          <span key={d} style={{ width: '120px', display: 'flex' }}>
            <DevCardView type={d} text={DEV_INFO[d].text} />
          </span>
        ))}
        <span style={{ width: '120px', display: 'flex' }}>
          <DevCardView type={null} back />
        </span>
      </div>
      <h2>Cities &amp; Knights: commodities</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
        {COMMODITY_LIST.map((r) => (
          <span key={r} style={{ width: '120px', display: 'flex' }}>
            <ResourceCard r={r} />
          </span>
        ))}
        {COMMODITY_LIST.map((r) => (
          <span key={`g${r}`} style={{ fontSize: '40px' }}>
            <ResGlyph r={r} />
          </span>
        ))}
      </div>
      <h2>Cities &amp; Knights: progress cards</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
        {TRACK_LIST.map((t) => (
          <span key={t} style={{ width: '120px', display: 'flex' }}>
            <ProgressCardView deck={t} back />
          </span>
        ))}
      </div>
      {TRACK_LIST.map((t) => (
        <div key={t} class="gallery-deck" data-deck={t} style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
          {PROGRESS_CARD_NAMES.filter((c) => PROGRESS_CARDS[c].deck === t).map((c) => (
            <span key={c} style={{ width: '132px', display: 'flex' }}>
              <ProgressCardView card={c} text />
            </span>
          ))}
        </div>
      ))}
      <h3>Small (the hand, the dialogs) and on a dark table</h3>
      <div class="gallery-minis" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '12px', borderRadius: '12px', background: '#1d2330' }}>
        {PROGRESS_CARD_NAMES.map((c) => (
          <span key={c} style={{ width: '52px', height: '73px', display: 'flex' }}>
            <ProgressCardView card={c} look="mini" />
          </span>
        ))}
      </div>
      <h2>Cities &amp; Knights: pieces, gates and the event die</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'flex-end' }}>
        {PLAYER_COLORS.slice(0, 4).map((c) =>
          ([1, 2, 3] as KnightLevel[]).flatMap((l) =>
            [false, true].map((on) => (
              <span key={`${c.id}${l}${on}`} style={{ width: '64px', height: '60px', display: 'flex' }}>
                <KnightGlyph level={l} active={on} fill={c.fill} stroke={c.stroke} />
              </span>
            )),
          ),
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'flex-end' }}>
        {PLAYER_COLORS.slice(0, 3).map((c, i) => (
          <span key={c.id} style={{ width: '50px', height: '90px', display: 'flex' }}>
            <TowerGlyph track={TRACK_LIST[i]} fill={c.fill} stroke={c.stroke} />
          </span>
        ))}
        {PLAYER_COLORS.slice(0, 3).map((c) => (
          <span key={`w${c.id}`} style={{ width: '90px', height: '80px', display: 'flex' }}>
            <WallGlyph fill={c.fill} stroke={c.stroke} />
          </span>
        ))}
        {TRACK_LIST.map((t) => (
          <span key={t} style={{ fontSize: '56px' }}>
            <GateGlyph track={t} />
          </span>
        ))}
        <span style={{ fontSize: '56px' }}>
          <ShipGlyph />
        </span>
        <span class="dice three" style={{ display: 'flex', gap: '6px' }}>
          {(['ship', 'trade', 'politics', 'science'] as const).map((f) => (
            <span key={f} style={{ width: '56px', height: '56px', display: 'flex' }}>
              <EventDie face={f} />
            </span>
          ))}
        </span>
      </div>
      <h2>Hand</h2>
      <div class="hand" style={{ maxWidth: '380px' }}>
        {RESOURCE_LIST.map((r, i) => (
          <ResourceCard key={r} r={r} n={i} look="tile" empty={i === 0} />
        ))}
      </div>
    </main>
  );
}

render(<Gallery />, document.getElementById('app')!);
