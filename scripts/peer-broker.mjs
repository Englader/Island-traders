// A local PeerJS broker for testing online play (`node scripts/peer-broker.mjs`).
// Open the game with ?peer=localhost:9000/broker to use it instead of the PeerJS cloud.
import { PeerServer } from 'peer';

const port = Number(process.env.PEER_PORT ?? 9000);
PeerServer({ port, host: process.env.PEER_HOST ?? '127.0.0.1', path: '/broker' }, () => {
  console.log(`PeerJS broker on http://127.0.0.1:${port}/broker`);
});
