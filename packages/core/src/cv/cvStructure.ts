// Reads the structure of a German or English CV: its sections (Berufserfahrung / Work experience,
// Ausbildung / Education, Kenntnisse / Skills, Zertifikate / Certifications, Projekte / Projects,
// Sprachen / Languages) and, inside experience and education, the entries with their date ranges
// ("01/2020 – heute", "2016 - 2020", "seit März 2021", "Jan 2019 – Present"). Works on folded
// text (lower case, umlauts as ae/oe/ue), never keeps the text beyond the call.

import { foldText } from '../text/keywords.js';

export type SectionKind = 'header' | 'profile' | 'experience' | 'education' | 'certifications' | 'skills' | 'projects' | 'languages' | 'other';

const HEADINGS: Record<Exclude<SectionKind, 'header'>, string[]> = {
  profile: ['profil', 'kurzprofil', 'persoenliches profil', 'berufsprofil', 'ueber mich', 'zusammenfassung', 'summary', 'profile', 'professional summary', 'about me', 'personal profile', 'career objective', 'objective'],
  experience: [
    'berufserfahrung', 'berufliche erfahrung', 'berufliche erfahrungen', 'berufliche taetigkeiten', 'beruflicher werdegang', 'werdegang', 'berufspraxis',
    'praxiserfahrung', 'praktische erfahrung', 'praktische erfahrungen', 'beschaeftigungsverlauf', 'arbeitserfahrung', 'berufstaetigkeit',
    'work experience', 'professional experience', 'experience', 'employment', 'employment history', 'work history', 'career history', 'career', 'relevant experience', 'professional background',
  ],
  education: [
    'ausbildung', 'schulbildung', 'schulische ausbildung', 'studium', 'bildungsweg', 'akademische ausbildung', 'hochschulbildung', 'berufsausbildung', 'bildung', 'schul- und berufsausbildung',
    'education', 'academic background', 'academic education', 'qualifications', 'education and training', 'academic qualifications',
  ],
  certifications: [
    'zertifikate', 'zertifizierungen', 'weiterbildung', 'weiterbildungen', 'fortbildung', 'fortbildungen', 'fort- und weiterbildungen', 'fort- und weiterbildung', 'lizenzen', 'qualifikationen',
    'certifications', 'certificates', 'licenses', 'licences', 'training', 'trainings', 'courses', 'kurse', 'further education', 'professional development',
  ],
  skills: [
    'kenntnisse', 'faehigkeiten', 'fachkenntnisse', 'kompetenzen', 'fachkompetenzen', 'edv-kenntnisse', 'it-kenntnisse', 'edv', 'besondere kenntnisse', 'faehigkeiten und kenntnisse', 'kenntnisse und faehigkeiten', 'schwerpunkte',
    'skills', 'technical skills', 'core skills', 'key skills', 'competencies', 'core competencies', 'expertise', 'tools', 'software', 'it skills', 'skills and tools',
  ],
  projects: ['projekte', 'projekterfahrung', 'ausgewaehlte projekte', 'projects', 'selected projects', 'project experience', 'key projects'],
  languages: ['sprachen', 'sprachkenntnisse', 'fremdsprachen', 'languages', 'language skills'],
  other: [
    'persoenliche daten', 'kontakt', 'kontaktdaten', 'hobbys', 'hobbies', 'interessen', 'ehrenamt', 'ehrenamtliches engagement', 'engagement', 'publikationen', 'veroeffentlichungen', 'referenzen', 'auszeichnungen',
    'personal details', 'personal information', 'contact', 'interests', 'volunteering', 'volunteer work', 'publications', 'references', 'awards', 'achievements', 'sonstiges', 'other',
  ],
};

const HEADING_LOOKUP = new Map<string, Exclude<SectionKind, 'header'>>(
  (Object.entries(HEADINGS) as Array<[Exclude<SectionKind, 'header'>, string[]]>).flatMap(([kind, list]) => list.map((h) => [h, kind] as const)),
);

/** The section a line starts, or null when it is not a heading. "Ausbildung & Studium:" is education. */
export function headingOf(foldedLine: string): Exclude<SectionKind, 'header'> | null {
  const line = foldedLine
    .replace(/^[\s\d.)•▪■●*#|–—-]+/u, '')
    .replace(/[\s:|•▪■●*#–—-]+$/u, '')
    .trim();
  if (line.length === 0 || line.length > 45) return null;
  const exact = HEADING_LOOKUP.get(line);
  if (exact) return exact;
  // Combined headings such as "Ausbildung & Studium", "Skills and Tools", "Kenntnisse / Sprachen".
  const parts = line.split(/\s*(?:&|\+|\/|,|\bund\b|\band\b)\s*/u).filter(Boolean);
  if (parts.length > 1 && parts.every((p) => HEADING_LOOKUP.has(p))) return HEADING_LOOKUP.get(parts[0]) ?? null;
  return null;
}

// ---- Dates ----------------------------------------------------------------------------------

const MONTHS: Array<[RegExp, number]> = [
  [/^jan/, 1], [/^feb/, 2], [/^(maer|mar|mrz)/, 3], [/^apr/, 4], [/^(mai|may)/, 5], [/^jun/, 6],
  [/^jul/, 7], [/^aug/, 8], [/^sep/, 9], [/^(okt|oct)/, 10], [/^nov/, 11], [/^(dez|dec)/, 12],
];

const MONTH_WORD = '(?:jan(?:uar|uary)?|feb(?:ruar|ruary)?|maerz|mar(?:ch)?|mrz|apr(?:il)?|mai|may|jun[ie]?|jul[iy]?|aug(?:ust)?|sep(?:t(?:ember)?)?|okt(?:ober)?|oct(?:ober)?|nov(?:ember)?|dez(?:ember)?|dec(?:ember)?)\\.?';
const YEAR = '(?:19[5-9]\\d|20\\d\\d)';
const POINT = `(?:(?:\\d{1,2}[./])?\\d{1,2}[./]${YEAR}|${MONTH_WORD}\\s*${YEAR}|${YEAR}(?:[./-]\\d{1,2})?)`;
const PRESENT = '(?:heute|bis heute|aktuell|jetzt|derzeit|dato|laufend|gegenwaertig|present|current|currently|now|today|ongoing|date|to date)';
const DASH = '\\s*(?:-|–|—|bis|to|until|till)\\s*';
const RANGE = new RegExp(`(${POINT})${DASH}(${POINT}|${PRESENT})`, 'u');
const SINCE = new RegExp(`(?:seit|since|ab)\\s+(${POINT})`, 'u');
const SINGLE = new RegExp(`^\\s*(${POINT})(?![\\d])`, 'u');

/** A date as a fractional year (2021.5 is mid-2021). */
export function pointToYear(text: string): number | null {
  const t = text.trim();
  let m = /^(?:(\d{1,2})[./])?(\d{1,2})[./]((?:19|20)\d\d)$/.exec(t);
  if (m) return Number(m[3]) + (Math.min(12, Math.max(1, Number(m[2]))) - 1) / 12;
  m = /^([a-z]+)\.?\s*((?:19|20)\d\d)$/.exec(t);
  if (m) {
    const month = MONTHS.find(([re]) => re.test(m![1]))?.[1] ?? 1;
    return Number(m[2]) + (month - 1) / 12;
  }
  m = /^((?:19|20)\d\d)(?:[./-](\d{1,2}))?$/.exec(t);
  if (m) return Number(m[1]) + (m[2] ? (Math.min(12, Math.max(1, Number(m[2]))) - 1) / 12 : 0);
  return null;
}

export interface DateRange {
  start: number;
  end: number;
  present: boolean;
  /** The line without the dates. */
  rest: string;
}

/** The date range a (folded) line names, if any. A year alone counts as that year. */
export function dateRangeOf(foldedLine: string, nowYear: number): DateRange | null {
  let m = RANGE.exec(foldedLine);
  if (m) {
    const start = pointToYear(m[1]);
    const present = new RegExp(`^${PRESENT}$`, 'u').test(m[2].trim());
    // A plain year as the end means "until the end of that year".
    const endPoint = present ? nowYear : pointToYear(m[2]);
    if (start === null || endPoint === null) return null;
    const end = present ? nowYear : /^\d{4}$/.test(m[2].trim()) ? endPoint + 11 / 12 : endPoint;
    if (end < start - 0.01 || start > nowYear + 1) return null;
    return { start, end: Math.min(end, nowYear), present, rest: clean(foldedLine.replace(m[0], ' ')) };
  }
  m = SINCE.exec(foldedLine);
  if (m) {
    const start = pointToYear(m[1]);
    if (start === null || start > nowYear + 1) return null;
    return { start, end: nowYear, present: true, rest: clean(foldedLine.replace(m[0], ' ')) };
  }
  m = SINGLE.exec(foldedLine);
  if (m) {
    const point = pointToYear(m[1]);
    if (point === null || point > nowYear + 1) return null;
    const end = /^\d{4}$/.test(m[1].trim()) ? point + 11 / 12 : point;
    return { start: point, end: Math.min(end, nowYear), present: false, rest: clean(foldedLine.replace(m[0], ' ')) };
  }
  return null;
}

function clean(s: string): string {
  return s.replace(/^[\s,;:|•·–—-]+|[\s,;:|•·–—-]+$/gu, '').replace(/\s+/g, ' ');
}

// ---- Structure ------------------------------------------------------------------------------

export interface CvEntry {
  section: 'experience' | 'education' | 'projects' | 'certifications';
  range: DateRange | null;
  /** Where the job title or degree usually is: the date line and the lines right before or after it. */
  head: string;
  /** All lines of the entry, head included. */
  body: string;
}

export interface CvSection {
  kind: SectionKind;
  text: string;
}

export interface ParsedCv {
  /** Folded text of the whole CV. */
  folded: string;
  wordCount: number;
  /** True when at least one known heading was found. */
  structured: boolean;
  sections: CvSection[];
  entries: CvEntry[];
}

const ENTRY_SECTIONS = new Set<SectionKind>(['experience', 'education', 'projects', 'certifications']);

export function parseCv(text: string, nowYear: number): ParsedCv {
  const lines = text
    .split(/\r?\n/)
    .map((l) => foldText(l).trim())
    .filter((l) => l.length > 0);
  const folded = lines.join('\n');
  const wordCount = (folded.match(/\p{L}{2,}/gu) ?? []).length;

  const sections: Array<{ kind: SectionKind; lines: string[] }> = [{ kind: 'header', lines: [] }];
  let structured = false;
  for (const line of lines) {
    const heading = headingOf(line);
    if (heading) {
      structured = true;
      sections.push({ kind: heading, lines: [] });
    } else {
      sections[sections.length - 1].lines.push(line);
    }
  }

  const entries: CvEntry[] = [];
  for (const section of sections) {
    if (!ENTRY_SECTIONS.has(section.kind)) continue;
    const kind = section.kind as CvEntry['section'];
    const dated = section.lines.map((l) => dateRangeOf(l, nowYear));
    const starts = dated.flatMap((r, i) => (r ? [i] : []));
    if (starts.length === 0) {
      if (section.lines.length > 0) {
        entries.push({ section: kind, range: null, head: section.lines.slice(0, 2).join('\n'), body: section.lines.join('\n') });
      }
      continue;
    }
    starts.forEach((start, n) => {
      const next = starts[n + 1] ?? section.lines.length;
      const previousEnd = n === 0 ? 0 : starts[n - 1] + 1;
      const range = dated[start] as DateRange;
      // "Title / Company / 2020 – heute" puts the title above the dates; "2020 – heute Title" on the line.
      const before = range.rest === '' ? section.lines.slice(Math.max(previousEnd, start - 2), start) : [];
      const after = section.lines.slice(start + 1, Math.min(next, start + 2));
      const head = [range.rest, ...before, ...after].filter(Boolean).join('\n');
      const body = [...before, range.rest, ...section.lines.slice(start + 1, next)].filter(Boolean).join('\n');
      entries.push({ section: kind, range, head, body });
    });
  }

  return {
    folded,
    wordCount,
    structured,
    sections: sections.filter((s) => s.lines.length > 0).map((s) => ({ kind: s.kind, text: s.lines.join('\n') })),
    entries,
  };
}

/** "2021 to now", "2016 to 2020" or "2019", for evidence labels. */
export function periodLabel(range: DateRange | null): string | null {
  if (!range) return null;
  const from = Math.floor(range.start + 1e-9);
  if (range.present) return `${from} to now`;
  const to = Math.floor(range.end + 1e-9);
  return from === to ? String(from) : `${from} to ${to}`;
}
