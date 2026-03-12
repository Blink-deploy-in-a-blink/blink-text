import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'provider/browser': 'src/provider/browser.ts',
    'provider/node': 'src/provider/node.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  target: 'es2020',
  platform: 'neutral',
  esbuildOptions(options) {
    // Mark node builtins as external so the package stays platform-neutral
    options.external = ['crypto', 'node:crypto'];
  },
});
