// @ts-check
/**
 * ESLint, flat config.
 *
 * There was no config file at all until #31 — `eslint` and `typescript-eslint`
 * were in devDependencies and `npm run lint` had never linted a line. The
 * baseline below is deliberately close to stock: the point of the first pass is
 * that the command runs in CI, not that it has opinions. It found seven real
 * problems on first contact, including a comparison that was always true.
 *
 * The one non-stock rule is the import restriction on `packages/rules`, which
 * turns ARCHITECTURE §2's "non-negotiable constraint" from a paragraph into a
 * failing build.
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.vite/**',
      'coverage/**',
      // Import-pipeline scratch and the generated corpus: neither is authored.
      'packages/data/.import/**',
      'packages/data/src/characters.json',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    /**
     * `packages/rules` imports nothing.
     *
     * The same code runs in the browser for local play, on the server as the
     * authority, and in a Web Worker as the AI's simulator. Anything that
     * breaks the constraint breaks all three at once, which is why
     * ARCHITECTURE §2 calls it non-negotiable — and why it is worth more than a
     * comment. A denylist rather than an allowlist because ESLint has no
     * allowlist without another plugin; it covers what is actually reachable
     * from this monorepo.
     *
     * Tests are exempt: they import `vitest`, and they do not ship.
     */
    files: ['packages/rules/src/**/*.ts'],
    ignores: ['packages/rules/src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'node:*',
                'fs',
                'path',
                'http',
                'react',
                'react-*',
                'three',
                '@react-three/*',
                '@danger-room/*',
                'zod',
              ],
              message:
                'packages/rules imports nothing — see ARCHITECTURE §2. It has to run in the browser, on the server, and in a Worker.',
            },
          ],
        },
      ],
    },
  },
);
