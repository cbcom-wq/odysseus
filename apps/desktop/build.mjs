import { build } from 'esbuild';

/**
 * The main and preload scripts are bundled rather than compiled file by file, so they can import
 * workspace packages straight from TypeScript source like everything else in the repo. Electron
 * itself stays external — it is provided by the runtime, not the bundle.
 */
await build({
  entryPoints: ['src/main.ts', 'src/preload.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron'],
  outdir: 'dist',
  outExtension: { '.js': '.cjs' },
  sourcemap: true,
  logLevel: 'info',
});
