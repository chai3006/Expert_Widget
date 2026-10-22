// The user-editable files live next to the CV folder, by default in ExpertWidget in the user's
// Documents folder as the system names it (Electron's app.getPath('documents'), which follows a
// moved or OneDrive-redirected Documents folder): config.json, employers.json, watchlist.json, CV/.
// Missing files are created from the bundled defaults on first run.

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AppData } from '../../core/src/newsData.js';
import { loadAppData } from './appData.js';
import {
  expandPath,
  parseJson,
  validateConfig,
  validateEmployers,
  validateWatchlist,
  type AppConfig,
  type EmployerSegment,
  type WatchlistEntry,
} from '../../core/src/config.js';

export interface UserFiles {
  home: string;
  configPath: string;
  employersPath: string;
  watchlistPath: string;
}

export function userFiles(home: string): UserFiles {
  return { home, configPath: join(home, 'config.json'), employersPath: join(home, 'employers.json'), watchlistPath: join(home, 'watchlist.json') };
}

/**
 * The folder with the user's files. EXPERT_WIDGET_HOME overrides it (useful for testing a second
 * setup). Earlier versions used <home>/Documents/ExpertWidget; where that differs from the real
 * Documents folder and already has a config.json, it stays in use so nothing is lost.
 */
export function resolveHome(env: Record<string, string | undefined>, documentsDir: string, homeDir?: string): string {
  if (env.EXPERT_WIDGET_HOME) return resolve(env.EXPERT_WIDGET_HOME);
  const home = join(documentsDir, 'ExpertWidget');
  if (homeDir) {
    const legacy = join(homeDir, 'Documents', 'ExpertWidget');
    if (resolve(legacy) !== resolve(home) && !existsSync(join(home, 'config.json')) && existsSync(join(legacy, 'config.json'))) return legacy;
  }
  return home;
}

/** The cvFolder value of earlier default config files; it means the default folder too. */
export const LEGACY_DEFAULT_CV_FOLDER = '~/Documents/ExpertWidget/CV';

/** The CV folder: config.json's cvFolder, or the CV folder next to config.json when it is "" or the old default. */
export function cvFolderFor(files: UserFiles, setting: string, env: Record<string, string | undefined>, homeDir: string, platform: NodeJS.Platform = process.platform): string {
  const value = setting.trim();
  if (value === '' || value === LEGACY_DEFAULT_CV_FOLDER) return join(files.home, 'CV');
  return resolve(expandPath(value, env, homeDir, platform));
}

export type LoadedFiles =
  | { ok: true; config: AppConfig; employers: EmployerSegment[]; watchlist: WatchlistEntry[]; cvFolder: string }
  | { ok: false; error: string; cvFolder: string };

export function ensureUserFiles(files: UserFiles, defaultsDir: string): void {
  mkdirSync(files.home, { recursive: true });
  if (!existsSync(files.configPath)) copyFileSync(join(defaultsDir, 'config.json'), files.configPath);
  if (!existsSync(files.employersPath)) copyFileSync(join(defaultsDir, 'employers.json'), files.employersPath);
  if (!existsSync(files.watchlistPath)) copyFileSync(join(defaultsDir, 'watchlist.json'), files.watchlistPath);
}

export function loadUserFiles(
  files: UserFiles,
  env: Record<string, string | undefined>,
  homeDir: string,
  data: AppData,
  platform: NodeJS.Platform = process.platform,
): LoadedFiles {
  const fallbackCv = join(files.home, 'CV');
  const read = (path: string) => {
    try {
      return { ok: true as const, text: readFileSync(path, 'utf8') };
    } catch (err) {
      return { ok: false as const, error: `Cannot read ${path}: ${err instanceof Error ? err.message : String(err)}` };
    }
  };

  const configText = read(files.configPath);
  if (!configText.ok) return { ok: false, error: configText.error, cvFolder: fallbackCv };
  const configJson = parseJson(configText.text, 'config.json');
  if (!configJson.ok) return { ok: false, error: `${files.configPath}\n\n${configJson.errors.join('\n')}`, cvFolder: fallbackCv };
  const config = validateConfig(configJson.value, data);
  if (!config.ok) return { ok: false, error: `${files.configPath} has problems:\n\n${config.errors.join('\n')}`, cvFolder: fallbackCv };

  const cvFolder = cvFolderFor(files, config.value.cvFolder, env, homeDir, platform);

  const employersText = read(files.employersPath);
  if (!employersText.ok) return { ok: false, error: employersText.error, cvFolder };
  const employersJson = parseJson(employersText.text, 'employers.json');
  if (!employersJson.ok) return { ok: false, error: `${files.employersPath}\n\n${employersJson.errors.join('\n')}`, cvFolder };
  const employers = validateEmployers(employersJson.value, data.domains);
  if (!employers.ok) return { ok: false, error: `${files.employersPath} has problems:\n\n${employers.errors.join('\n')}`, cvFolder };

  const watchlistText = read(files.watchlistPath);
  if (!watchlistText.ok) return { ok: false, error: watchlistText.error, cvFolder };
  const watchlistJson = parseJson(watchlistText.text, 'watchlist.json');
  if (!watchlistJson.ok) return { ok: false, error: `${files.watchlistPath}\n\n${watchlistJson.errors.join('\n')}`, cvFolder };
  const watchlist = validateWatchlist(watchlistJson.value);
  if (!watchlist.ok) return { ok: false, error: `${files.watchlistPath} has problems:\n\n${watchlist.errors.join('\n')}`, cvFolder };

  return { ok: true, config: config.value, employers: employers.value, watchlist: watchlist.value, cvFolder };
}

/** Loads the app data from `dataDir` (data/), then the user files validated against it. */
export function loadInputs(files: UserFiles, dataDir: string, env: Record<string, string | undefined>, homeDir: string): LoadedFiles {
  const data = loadAppData(dataDir);
  if (!data.ok) return { ok: false, error: `The data files in ${dataDir} have problems:\n\n${data.errors.join('\n')}`, cvFolder: join(files.home, 'CV') };
  return loadUserFiles(files, env, homeDir, data.value);
}
