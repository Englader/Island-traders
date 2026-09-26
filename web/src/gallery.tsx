// Development page showing every card (npm run web:dev, then /gallery.html).
import { render } from 'preact';
import { DEV_INFO, RESOURCE_LIST } from './game/names';
import { DevCardView, ResourceCard } from './ui/cards';
import type { DevCardType } from 'engine';
import './styles.css';

const DEVS = Object.keys(DEV_INFO) as DevCardType[];

function Gallery() {
  return (
    <main style={{ padding: '16px', display: 'grid', gap: '18px' }}>
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
