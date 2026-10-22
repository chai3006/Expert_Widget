// Local state files in Electron's userData folder (or a sub-folder for mock mode, or the CLI's
// --state folder). Each file is versioned plain JSON; anything that does not look right is treated
// as corrupt and set aside.

import { join } from 'node:path';
import {
  INITIAL_STATE,
  SANITIZERS,
  type AppStores,
  type FeedCache,
  type HealthState,
  type Interactions,
  type ProfileState,
  type UiState,
} from '../../../core/src/state/appState.js';
import { JsonStore } from './jsonStore.js';

export class FileStores implements AppStores {
  readonly feed: JsonStore<FeedCache>;
  readonly profile: JsonStore<ProfileState>;
  readonly interactions: JsonStore<Interactions>;
  readonly ui: JsonStore<UiState>;
  readonly health: JsonStore<HealthState>;

  constructor(readonly dir: string) {
    this.feed = new JsonStore(join(dir, 'feed-cache.json'), INITIAL_STATE.feed, SANITIZERS.feed);
    this.profile = new JsonStore(join(dir, 'profile.json'), INITIAL_STATE.profile, SANITIZERS.profile);
    this.interactions = new JsonStore(join(dir, 'interactions.json'), INITIAL_STATE.interactions, SANITIZERS.interactions);
    this.ui = new JsonStore(join(dir, 'ui.json'), INITIAL_STATE.ui, SANITIZERS.ui);
    this.health = new JsonStore(join(dir, 'health.json'), INITIAL_STATE.health, SANITIZERS.health);
  }

  get httpCacheDir(): string {
    return join(this.dir, 'http-cache');
  }

  /** Files that were corrupt at start-up and moved aside. */
  recoveredFiles(): string[] {
    return [this.feed, this.profile, this.interactions, this.ui, this.health].flatMap((s) => (s.recoveredFrom ? [s.recoveredFrom] : []));
  }
}
