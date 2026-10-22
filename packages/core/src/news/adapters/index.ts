import type { AdapterId } from '../../config.js';
import type { SourceAdapter } from '../types.js';
import { parseEurofound, parseIngenieurRecruitingTag, parseMessenDe, parseProduktionDe } from './html.js';
import { parseFeed } from './rss.js';

export const ADAPTERS: Record<AdapterId, SourceAdapter> = {
  rss: parseFeed,
  'ingenieur-recruiting-tag': parseIngenieurRecruitingTag,
  'messen-de': parseMessenDe,
  'eurofound-erm': parseEurofound,
  'produktion-de': parseProduktionDe,
};
