// The user-editable files live next to the CV folder, by default in
// %USERPROFILE%\Documents\ExpertWidget (config.json, employers.json, CV\).
// Missing files are created from the bundled defaults on first run.

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expandEnvVars, parseJson, validateConfig, validateEmployers, type AppConfig, type EmployerSegment } from './config.js';

export interface UserFiles {
  home: string;
  configPath: string;
  employersPath: string;
}

export function userFiles(home: string): UserFiles {
  return { home, configPath: join(home, 'config.json'), employersPath: join(home, 'employers.json') };
}

/** EXPERT_WIDGET_HOME overrides the location (useful for testing a second setup). */
export function resolveHome(env: Record<string, string | undefined>, homeDir: string): string {
  return env.EXPERT_WIDGET_HOME ? resolve(env.EXPERT_WIDGET_HOME) : join(homeDir, 'Documents', 'ExpertWidget');
}

export type LoadedFiles =
  | { ok: true; config: AppConfig; employers: EmployerSegment[]; cvFolder: string }
  | { ok: false; error: string; cvFolder: string };

export function ensureUserFiles(files: UserFiles, defaultsDir: string): void {
  mkdirSync(files.home, { recursive: true });
  if (!existsSync(files.configPath)) copyFileSync(join(defaultsDir, 'config.json'), files.configPath);
  if (!existsSync(files.employersPath)) copyFileSync(join(defaultsDir, 'employers.json'), files.employersPath);
}

export function loadUserFiles(files: UserFiles, env: Record<string, string | undefined>): LoadedFiles {
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
  const config = validateConfig(configJson.value);
  if (!config.ok) return { ok: false, error: `${files.configPath} has problems:\n\n${config.errors.join('\n')}`, cvFolder: fallbackCv };

  const cvFolder = resolve(expandEnvVars(config.value.cvFolder, env));

  const employersText = read(files.employersPath);
  if (!employersText.ok) return { ok: false, error: employersText.error, cvFolder };
  const employersJson = parseJson(employersText.text, 'employers.json');
  if (!employersJson.ok) return { ok: false, error: `${files.employersPath}\n\n${employersJson.errors.join('\n')}`, cvFolder };
  const employers = validateEmployers(employersJson.value);
  if (!employers.ok) return { ok: false, error: `${files.employersPath} has problems:\n\n${employers.errors.join('\n')}`, cvFolder };

  return { ok: true, config: config.value, employers: employers.value, cvFolder };
}
