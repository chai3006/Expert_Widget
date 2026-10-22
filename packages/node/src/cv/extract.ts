// Local text extraction for PDF, DOCX and TXT CVs. Runs in the main process only; the text never
// leaves this machine and is never written to disk.

import { promises as fs } from 'node:fs';
import { extname } from 'node:path';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import type { CvProblemKind } from '../../../core/src/ports.js';

/** Larger files are refused before reading: a CV is rarely more than a few megabytes. */
export const MAX_CV_BYTES = 20 * 1024 * 1024;

export class CvReadError extends Error {
  override name = 'CvReadError';
  constructor(
    message: string,
    readonly kind: CvProblemKind = 'unreadable',
  ) {
    super(message);
  }
}

export async function extractCvText(path: string): Promise<string> {
  const ext = extname(path).toLowerCase();
  let data: Buffer;
  try {
    const stat = await fs.stat(path);
    if (stat.size > MAX_CV_BYTES) throw new CvReadError(`the file is larger than ${MAX_CV_BYTES / 1024 / 1024} MB`, 'too-large');
    data = await fs.readFile(path);
  } catch (err) {
    if (err instanceof CvReadError) throw err;
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EBUSY' || code === 'EPERM') throw new CvReadError('the file is locked by another program', 'locked');
    if (code === 'EACCES') throw new CvReadError('Expert is not allowed to read the file', 'no-permission');
    throw new CvReadError(`the file cannot be read (${code ?? 'unknown error'})`);
  }
  if (data.length === 0) throw new CvReadError('the file is empty', 'empty');

  let text: string;
  try {
    if (ext === '.pdf') text = await extractPdf(data);
    else if (ext === '.docx') text = await extractDocx(data);
    else if (ext === '.txt') text = decodeText(data);
    else throw new CvReadError(`unsupported file type ${ext}`, 'unsupported');
  } catch (err) {
    if (err instanceof CvReadError) throw err;
    if ((err as { name?: string }).name === 'PasswordException') throw new CvReadError('the PDF is protected with a password', 'password');
    const what = ext === '.pdf' ? 'PDF' : ext === '.docx' ? 'Word document' : 'text file';
    throw new CvReadError(`the ${what} could not be read (${err instanceof Error ? err.message : String(err)})`);
  }

  if (text.replace(/\s+/g, '').length < 20) {
    if (ext === '.pdf') throw new CvReadError('no text found in the PDF (is it a scanned image?)', 'scanned');
    throw new CvReadError('the file contains almost no text', 'empty');
  }
  return text;
}

async function extractPdf(data: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(data) });
  try {
    const result = await parser.getText();
    // pdf-parse adds "-- 1 of 2 --" page markers; they are not CV content.
    return result.text.replace(/^-- \d+ of \d+ --$/gm, '');
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(data: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer: data });
  return result.value;
}

/** UTF-8 (with or without BOM), UTF-16 LE with BOM (Notepad "Unicode"), else Windows-1252. */
export function decodeText(data: Buffer): string {
  if (data[0] === 0xff && data[1] === 0xfe) return data.subarray(2).toString('utf16le');
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(data).replace(/^﻿/, '');
  if (!utf8.includes('�')) return utf8;
  return new TextDecoder('windows-1252').decode(data);
}

/** What to do next, in plain words, for each problem with the CV file. */
export const NEXT_STEP: Record<CvProblemKind, string> = {
  'no-file': 'Put one CV (.pdf, .docx or .txt, German or English) in the folder and press Refresh.',
  multiple: 'Keep exactly one and press Refresh.',
  unsupported: 'Save your CV as PDF, Word (.docx) or text (.txt) in the same folder and press Refresh.',
  password: 'Save a copy without a password (for example print it to a new PDF) and press Refresh.',
  scanned: 'It is probably a scan. Save your CV as PDF from your word processor, or as .docx or .txt, and press Refresh.',
  empty: 'Save your CV again with its text and press Refresh.',
  'too-large': 'Save a smaller version, for example without photos, and press Refresh.',
  locked: 'Close it in the other program and press Refresh.',
  'no-permission': 'Choose another folder, or allow Expert to open it (on a Mac: System Settings › Privacy & Security › Files and Folders) and press Refresh.',
  unreadable: 'Save your CV again (as PDF, .docx or .txt) and press Refresh.',
};
