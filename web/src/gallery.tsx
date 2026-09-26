// Development page showing every card and board tile (npm run web:dev, then /gallery.html).
import { render } from 'preact';
import { createGame, hexCenter, parseHexId, viewFor, type DevCardType, type GameView, type Terrain } from 'engine';
import { Board, NO_TARGETS } from './board/Board';
import { DEV_INFO, RESOURCE_LIST } from './game/names';
import { PLAYER_COLORS } from './game/seats';
import { DevCardView, ResourceCard } from './ui/cards';
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
  const board = <Board view={view} colors={PLAYER_COLORS} targets={NO_TARGETS} accent="#ffffff" ghost={null} flash={null} onPick={noPick} />;
  const box = (w: number, h: number) => (
    <div class="board-area" style={{ width: `${w}px`, height: `${h}px`, position: 'relative', borderRadius: '12px', overflow: 'hidden' }}>
      {board}
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
