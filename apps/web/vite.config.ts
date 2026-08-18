import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const SCANS = resolve(__dirname, '../../assets/card-scans');

/**
 * Serve card scans at /cards without putting them in `public/`.
 *
 * The full corpus is ~410MB. Anything under `public/` is copied into `dist` on
 * every build, which made a 3-second build produce 413MB of output — so the
 * scans live outside it and are streamed from disk instead. They are fetched
 * on demand (`npm run fetch:images`) and gitignored; a missing file is a plain
 * 404 that the card UI already handles.
 */
function cardScans(): Plugin {
  const handler = (req: any, res: any, next: () => void) => {
    const url = (req.url ?? '').split('?')[0] as string;
    if (!url.startsWith('/cards/')) return next();

    // decodeURIComponent then basename: the name comes from card data, but
    // path traversal must not be reachable from a URL regardless.
    const name = decodeURIComponent(url.slice('/cards/'.length)).replace(/^.*[/\\]/, '');
    const file = resolve(SCANS, name);
    if (!name || !file.startsWith(SCANS) || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404;
      return res.end('not found');
    }

    res.setHeader('Content-Type', name.endsWith('.jpg') ? 'image/jpeg' : 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    createReadStream(file).pipe(res);
  };

  return {
    name: 'card-scans',
    configureServer: server => void server.middlewares.use(handler),
    configurePreviewServer: server => void server.middlewares.use(handler),
  };
}

export default defineConfig({
  plugins: [react(), cardScans()],
  resolve: {
    alias: {
      // Workspace packages are consumed as TypeScript source, not built output.
      // One less build step in the dev loop, and edits to the rules engine hot
      // reload in the client immediately.
      '@danger-room/rules': resolve(__dirname, '../../packages/rules/src/index.ts'),
      '@danger-room/data': resolve(__dirname, '../../packages/data/src/index.ts'),
      '@danger-room/protocol': resolve(__dirname, '../../packages/protocol/src/index.ts'),
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
  },
});
