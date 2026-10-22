// Finds the single CV file in the CV folder. Never guesses: zero or several candidates is an error
// that names the folder.

import { promises as fs } from 'node:fs';
import { extname, join } from 'node:path';

export const CV_EXTENSIONS = ['.pdf', '.docx', '.txt'] as const;

export type CvLookup =
  | { kind: 'ok'; path: string; fileName: string; modifiedMs: number; sizeBytes: number }
  | { kind: 'empty'; folder: string }
  | { kind: 'multiple'; folder: string; fileNames: string[] }
  | { kind: 'folder-error'; folder: string; reason: string };

function isCandidate(name: string): boolean {
  // Skip hidden files and Office lock files such as "~$Lebenslauf.docx".
  if (name.startsWith('.') || name.startsWith('~$')) return false;
  return (CV_EXTENSIONS as readonly string[]).includes(extname(name).toLowerCase());
}

/** Creates the folder if it is missing, then looks for exactly one CV file. */
export async function findCv(folder: string): Promise<CvLookup> {
  try {
    await fs.mkdir(folder, { recursive: true });
    const entries = await fs.readdir(folder, { withFileTypes: true });
    const names = entries.filter((e) => e.isFile() && isCandidate(e.name)).map((e) => e.name).sort();
    if (names.length === 0) return { kind: 'empty', folder };
    if (names.length > 1) return { kind: 'multiple', folder, fileNames: names };
    const path = join(folder, names[0]);
    const stat = await fs.stat(path);
    return { kind: 'ok', path, fileName: names[0], modifiedMs: Math.round(stat.mtimeMs), sizeBytes: stat.size };
  } catch (err) {
    return { kind: 'folder-error', folder, reason: err instanceof Error ? err.message : String(err) };
  }
}

export function describeCvLookupProblem(lookup: Exclude<CvLookup, { kind: 'ok' }>): string {
  switch (lookup.kind) {
    case 'empty':
      return `No CV found. Put one CV (.pdf, .docx or .txt) in ${lookup.folder}`;
    case 'multiple':
      return `Found ${lookup.fileNames.length} CV files (${lookup.fileNames.join(', ')}) in ${lookup.folder}. Keep exactly one.`;
    case 'folder-error':
      return `Cannot open the CV folder ${lookup.folder}: ${lookup.reason}`;
  }
}
