import { config as loadDotenv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Loads the project `.env` from the repository root.
 * `moduleUrl` must be the `import.meta.url` of a file in `src/` or `scripts/`.
 * Existing environment variables win. Missing files are ignored.
 */
export function loadProjectEnv(moduleUrl) {
  const root = resolve(dirname(fileURLToPath(moduleUrl)), '..');
  return loadDotenv({ path: resolve(root, '.env'), quiet: true });
}
