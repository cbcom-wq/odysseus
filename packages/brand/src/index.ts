/**
 * What the product is called.
 *
 * The name is early and may not survive. Everything user-facing reads from here so changing it is a
 * one-line edit rather than an archaeology exercise — see the note on renaming at the bottom.
 */

/** The product name, wherever a person will read it. Safe to change. */
export const PRODUCT_NAME = 'Odysseus';

/** What this part of the product is called. The workspace is one surface; others will follow. */
export const SURFACE_NAME = 'Workspace';

/** Window and browser-tab title. */
export const WINDOW_TITLE = `${PRODUCT_NAME} ${SURFACE_NAME}`;

/**
 * Where saved data lives: the IndexedDB database name in a browser, the folder name on disk.
 *
 * Deliberately a separate constant from PRODUCT_NAME, and deliberately lowercase and boring.
 * Storage identity is not branding. If these were the same string, renaming the product would point
 * the app at an empty database and every saved trip would appear to vanish — the data would still
 * be there, under the old name, with nothing looking for it.
 *
 * So: rename PRODUCT_NAME freely. Only change this with a migration that moves existing data across.
 */
export const STORAGE_NAMESPACE = 'odysseus';

/**
 * Renaming the product
 * --------------------
 * 1. Change PRODUCT_NAME above. That covers the interface, the window title, and the shell.
 * 2. Leave STORAGE_NAMESPACE alone unless you are prepared to migrate saved trips.
 * 3. The `@odysseus/*` npm scope is an internal identifier that no user ever sees. It can stay as
 *    it is; if you want it to match, it is a single find-and-replace across package.json files and
 *    imports, and it touches nothing at runtime.
 */
