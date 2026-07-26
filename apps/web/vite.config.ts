import { WINDOW_TITLE } from '@odysseus/brand';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The tab title comes from the brand module rather than being typed into index.html, so renaming
 * the product does not leave the old name sitting in the browser tab.
 */
function brandTitle() {
  return {
    name: 'brand-title',
    transformIndexHtml(html: string) {
      return html.replace(/%APP_TITLE%/g, WINDOW_TITLE);
    },
  };
}

export default defineConfig({
  // Relative asset paths, so the same build works both served over HTTP and loaded from disk by the
  // desktop shell. With the default absolute paths, `file://` resolves /assets against the
  // filesystem root and the window comes up blank with nothing in the log to explain it.
  base: './',
  plugins: [react(), brandTitle()],
  server: { port: 5173 },
});
