// Desktop widget entry point: mounts the UI with the preload bridge (see apps/desktop/src/preload.ts).

import type { ExpertApi } from '../../core/src/shared/types.js';
import { mountExpert } from './app.js';

declare global {
  interface Window {
    expert: ExpertApi;
  }
}

mountExpert(document.getElementById('app') as HTMLElement, window.expert, { display: 'widget', host: document.documentElement });
