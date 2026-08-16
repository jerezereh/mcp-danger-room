/**
 * Server entry point.
 *
 * One process, rooms held in memory. That is genuinely enough for a long while:
 * a two-player turn-based game is nearly free to host, and the moment it is not,
 * Colyseus scales to multiple processes with a Redis presence driver without
 * changing room code.
 */

import { createServer } from 'node:http';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';

import { GameRoom } from './GameRoom.js';

const port = Number(process.env.PORT ?? 2567);

const httpServer = createServer((req, res) => {
  // Health check for whatever platform ends up hosting this.
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define('game', GameRoom).enableRealtimeListing();

gameServer
  .listen(port)
  .then(() => console.log(`Danger Room server listening on :${port}`))
  .catch((error: unknown) => {
    console.error('Failed to start server', error);
    process.exit(1);
  });
