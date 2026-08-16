import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
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
