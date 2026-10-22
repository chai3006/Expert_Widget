// Local text extraction for PDF, DOCX and TXT CVs. Runs in the main process only; the text never
// leaves this machine and is never written to disk.

import { promises as fs } from 'node:fs';
import { extname } from 'node:path';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

export class CvReadError extends Error {
  override name = 'CvReadError';
}

export async function extractCvText(path: string): Promise<string> {
  const ext = extname(path).toLowerCase();
  let data: Buffer;
  try {
    data = await fs.readFile(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    throw new CvReadError(code === 'EBUSY' || code === 'EPERM' ? 'the file is locked by another program' : `the file cannot be read (${code ?? 'unknown error'})`);
  }
  if (data.length === 0) throw new CvReadError('the file is empty');

  let text: string;
  try {
    if (ext === '.pdf') text = await extractPdf(data);
    else if (ext === '.docx') text = await extractDocx(data);
    else if (ext === '.txt') text = decodeText(data);
    else throw new CvReadError(`unsupported file type ${ext}`);
  } catch (err) {
    if (err instanceof CvReadError) throw err;
    const what = ext === '.pdf' ? 'PDF' : ext === '.docx' ? 'Word document' : 'text file';
    throw new CvReadError(`the ${what} could not be read (${err instanceof Error ? err.message : String(err)})`);
  }

  if (text.replace(/\s+/g, '').length < 20) {
    throw new CvReadError(ext === '.pdf' ? 'no text found in the PDF (is it a scanned image?)' : 'the file contains almost no text');
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
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(data).replace(/^\uFEFF/, '');
  if (!utf8.includes('\uFFFD')) return utf8;
  return new TextDecoder('windows-1252').decode(data);
}
