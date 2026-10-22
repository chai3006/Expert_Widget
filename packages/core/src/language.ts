// Language hints from function words. Used to decide which news texts to translate and whether a
// CV is in German or English.

const GERMAN = new Set(
  'der die das den dem des und oder mit für von vom zu zum zur im ist sind ein eine einen einer eines auf bei nicht sich wird werden wurde über nach aus auch als noch nur mehr neue neuen neues bis ab um durch gegen ohne wie was wer wo hat haben kann soll dass'.split(' '),
);
// Words used in both languages ("in", "an", "will") are left out of both lists.
const ENGLISH = new Set('the and of to for with is are on at by from as its it be has have new more over after into than that this which who'.split(' '));

/**
 * True when a text looks German: more German than English function words, or umlauts/ß and at
 * least as many German as English function words. Short names (e.g. "VDI nachrichten Recruiting Tag Hamburg") stay as they are.
 */
export function looksGerman(text: string): boolean {
  const words = text.toLowerCase().match(/[\p{L}]+/gu) ?? [];
  let de = 0;
  let en = 0;
  for (const w of words) {
    if (GERMAN.has(w)) de++;
    if (ENGLISH.has(w)) en++;
  }
  if (de > en) return true;
  return de >= en && /[äöüß]/i.test(text) && words.length >= 3;
}
