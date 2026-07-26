import { spawn } from 'node:child_process';
import electron from 'electron';

/**
 * Run the shell against the Vite dev server so the interface hot-reloads.
 *
 * Expects `npm run dev --workspace @odysseus/web` to already be running. Kept as a script rather
 * than an inline environment variable because those are not portable across shells.
 */
const url = process.env.ODYSSEUS_DEV_URL ?? 'http://localhost:5173';

spawn(electron, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, ODYSSEUS_DEV_URL: url },
}).on('exit', (code) => process.exit(code ?? 0));
