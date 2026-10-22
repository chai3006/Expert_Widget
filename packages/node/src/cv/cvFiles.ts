// Finds the single CV file in the CV folder. Never guesses: zero or several candidates is an error
// that names the folder.

import { promises as fs } from 'node:fs';
import { extname, join } from 'node:path';

export const CV_EXTENSIONS = ['.pdf', '.docx', '.txt'] as const;

/** Files people often take for a CV that Expert cannot read; named in the message instead of "no CV". */
const OTHER_DOCUMENTS = ['.doc', '.odt', '.rtf', '.pages', '.jpg', '.jpeg', '.png', '.heic', '.tif', '.tiff', '.html', '.htm', '.md', '.xps'];

export type CvLookup =
  | { kind: 'ok'; path: string; fileName: string; modifiedMs: number; sizeBytes: number }
  | { kind: 'empty'; folder: string }
  | { kind: 'multiple'; folder: string; fileNames: string[] }
  | { kind: 'unsupported'; folder: string; fileNames: string[] }
  | { kind: 'no-permission'; folder: string }
  | { kind: 'folder-error'; folder: string; reason: string };

function visible(name: string): boolean {
  // Skip hidden files and Office lock files such as "~$Lebenslauf.docx".
  return !name.startsWith('.') && !name.startsWith('~$');
}

function isCandidate(name: string): boolean {
  return visible(name) && (CV_EXTENSIONS as readonly string[]).includes(extname(name).toLowerCase());
}

/** Creates the folder if it is missing, then looks for exactly one CV file. */
export async function findCv(folder: string): Promise<CvLookup> {
  try {
    await fs.mkdir(folder, { recursive: true });
    const entries = await fs.readdir(folder, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile()).map((e) => e.name);
    const names = files.filter(isCandidate).sort();
    if (names.length === 0) {
      const others = files.filter((n) => visible(n) && OTHER_DOCUMENTS.includes(extname(n).toLowerCase())).sort();
      return others.length > 0 ? { kind: 'unsupported', folder, fileNames: others } : { kind: 'empty', folder };
    }
    if (names.length > 1) return { kind: 'multiple', folder, fileNames: names };
    const path = join(folder, names[0]);
    const stat = await fs.stat(path);
    return { kind: 'ok', path, fileName: names[0], modifiedMs: Math.round(stat.mtimeMs), sizeBytes: stat.size };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') return { kind: 'no-permission', folder };
    return { kind: 'folder-error', folder, reason: err instanceof Error ? err.message : String(err) };
  }
}

export function describeCvLookupProblem(lookup: Exclude<CvLookup, { kind: 'ok' }>): string {
  switch (lookup.kind) {
    case 'empty':
      return `No CV found in ${lookup.folder}. Put one CV (.pdf, .docx or .txt, German or English) there and press Refresh.`;
    case 'multiple':
      return `Found ${lookup.fileNames.length} CV files (${lookup.fileNames.join(', ')}) in ${lookup.folder}. Keep exactly one and press Refresh.`;
    case 'unsupported':
      return `${lookup.fileNames.join(', ')} in ${lookup.folder} cannot be read: Expert reads .pdf, .docx and .txt. Save your CV in one of these formats there and press Refresh.`;
    case 'no-permission':
      return `Expert is not allowed to open the CV folder ${lookup.folder}. Choose another folder, or allow access (on a Mac: System Settings › Privacy & Security › Files and Folders) and press Refresh.`;
    case 'folder-error':
      return `Cannot open the CV folder ${lookup.folder}: ${lookup.reason}. Choose another folder and press Refresh.`;
  }
}

/** The problem kind for the UI. */
export function lookupProblemKind(lookup: Exclude<CvLookup, { kind: 'ok' }>): 'no-file' | 'multiple' | 'unsupported' | 'no-permission' | 'unreadable' {
  switch (lookup.kind) {
    case 'empty':
      return 'no-file';
    case 'multiple':
      return 'multiple';
    case 'unsupported':
      return 'unsupported';
    case 'no-permission':
      return 'no-permission';
    case 'folder-error':
      return 'unreadable';
  }
}
