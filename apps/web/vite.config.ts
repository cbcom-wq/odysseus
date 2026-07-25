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
  plugins: [react(), brandTitle()],
  server: { port: 5173 },
});
