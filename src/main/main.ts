// Electron main process: window, tray, IPC, and the Refresh button's work.
// All network access and file reading happens here, never in the renderer.

import { BrowserWindow, Menu, Tray, app, ipcMain, nativeImage, net, screen, shell, type IpcMainInvokeEvent } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { StatusMessage, Theme, ViewModel } from '../shared/types.js';
import { isHttpUrl } from './config.js';
import { MockCvProvider, MockNewsProvider } from './mock/mockData.js';
import { PoliteFetcher } from './news/fetcher.js';
import { LocalCvProvider, WebNewsProvider } from './providers.js';
import { runRefresh } from './refresh.js';
import { AppStores, type Bounds } from './state/appState.js';
import { ensureUserFiles, loadUserFiles, resolveHome, userFiles, type LoadedFiles } from './userFiles.js';
import { buildView, companyKey } from './view.js';

const MOCK = process.argv.includes('--mock');
const DEV = process.argv.includes('--dev');
const WIDTH = 420;
const SEEN_RETENTION_MS = 120 * 24 * 60 * 60 * 1000;
const BACKGROUND: Record<Theme, string> = { day: '#F6F5F1', dark: '#12181D' };

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let stores: AppStores;
let files: LoadedFiles;
let messages: StatusMessage[] = [];
let refreshing: Promise<ViewModel> | null = null;
let isRefreshing = false;

const appRoot = () => app.getAppPath();
const defaultsDir = () => join(appRoot(), 'defaults');
// Mock mode reads the bundled defaults (no CV, no user files) and keeps its own state folder.
const files_ = () => userFiles(MOCK ? defaultsDir() : resolveHome(process.env, homedir()));
const indexHtml = () => join(__dirname, '..', 'ui', 'renderer', 'index.html');

function loadFiles(): LoadedFiles {
  if (!MOCK) {
    try {
      ensureUserFiles(files_(), defaultsDir());
    } catch (err) {
      return { ok: false, error: `Cannot create ${files_().home}: ${err instanceof Error ? err.message : String(err)}`, cvFolder: join(files_().home, 'CV') };
    }
  }
  const loaded = loadUserFiles(files_(), process.env);
  if (!MOCK) {
    try {
      mkdirSync(loaded.cvFolder, { recursive: true });
    } catch {
      /* reported on Refresh when the folder is read */
    }
  }
  return loaded;
}

function currentView(): ViewModel {
  const recovered = stores.recoveredFiles();
  const notes: StatusMessage[] = recovered.length
    ? [{ level: 'info', text: `A damaged state file was set aside and started fresh: ${recovered.join(', ')}` }]
    : [];
  return buildView({
    mock: MOCK,
    config: files.ok ? files.config : null,
    employers: files.ok ? files.employers : [],
    configError: files.ok ? null : files.error,
    stores,
    cvFolder: files.cvFolder,
    messages: [...notes, ...messages],
    refreshing: isRefreshing,
    now: Date.now(),
  });
}

function pushView(): void {
  if (win && !win.isDestroyed()) win.webContents.send('view:update', currentView());
}

function refresh(): Promise<ViewModel> {
  if (refreshing) return refreshing;
  isRefreshing = true;
  pushView();
  refreshing = (async () => {
    files = loadFiles(); // pick up edits to config.json and employers.json
    if (!files.ok) {
      messages = [];
    } else {
      try {
        const fetcher = new PoliteFetcher({
          userAgent: `ExpertWidget/${app.getVersion()} (personal desktop widget; manual refresh only)`,
          cacheDir: stores.httpCacheDir,
          fetchImpl: (url, init) => net.fetch(url, init),
        });
        messages = await runRefresh({
          config: files.config,
          cvFolder: files.cvFolder,
          stores,
          cv: MOCK ? new MockCvProvider() : new LocalCvProvider(),
          news: MOCK ? new MockNewsProvider() : new WebNewsProvider(fetcher, () => net.isOnline()),
          now: Date.now,
          mock: MOCK,
        });
      } catch (err) {
        messages = [{ level: 'error', text: `Refresh failed: ${err instanceof Error ? err.message : String(err)}` }];
      }
    }
  })()
    .finally(() => {
      isRefreshing = false;
      refreshing = null;
    })
    .then(() => {
      const view = currentView();
      pushView();
      return view;
    });
  return refreshing;
}

function openExternalSafe(url: unknown): void {
  if (isHttpUrl(url)) void shell.openExternal(url);
}

// ---- Window -------------------------------------------------------------------------------

function defaultBounds(): Bounds {
  const area = screen.getPrimaryDisplay().workArea;
  return { width: WIDTH, height: area.height, x: area.x + area.width - WIDTH, y: area.y };
}

function isOnScreen(b: Bounds): boolean {
  return screen.getAllDisplays().some(({ workArea: a }) => {
    const overlapX = Math.min(b.x + b.width, a.x + a.width) - Math.max(b.x, a.x);
    const overlapY = Math.min(b.y + b.height, a.y + a.height) - Math.max(b.y, a.y);
    return overlapX >= 100 && overlapY >= 100;
  });
}

function createWindow(): void {
  const saved = stores.ui.value.bounds;
  const bounds = saved && isOnScreen(saved) ? saved : defaultBounds();
  win = new BrowserWindow({
    ...bounds,
    minWidth: 340,
    minHeight: 420,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    title: MOCK ? 'Expert Widget (mock data)' : 'Expert Widget',
    icon: join(appRoot(), 'assets', 'icon.png'),
    backgroundColor: BACKGROUND[stores.ui.value.theme],
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    openExternalSafe(url);
  });
  win.once('ready-to-show', () => win?.show());
  win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      win?.hide();
    }
  });

  let saveTimer: NodeJS.Timeout | undefined;
  const saveBounds = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (win && !win.isDestroyed() && !win.isMinimized()) stores.ui.update((ui) => ({ ...ui, bounds: win!.getBounds() }));
    }, 500);
  };
  win.on('moved', saveBounds);
  win.on('resized', saveBounds);

  void win.loadFile(indexHtml());
  if (DEV) win.webContents.openDevTools({ mode: 'detach' });
  if (!app.isPackaged) attachDevDiagnostics(win);
}

/**
 * Development aid (never active in the installed app): forwards renderer console output to the
 * terminal and, when EXPERT_WIDGET_CAPTURE=<file.png> is set, saves an image of the window's own
 * page after it has loaded (optionally after running EXPERT_WIDGET_CAPTURE_JS in the page).
 */
function attachDevDiagnostics(w: BrowserWindow): void {
  w.webContents.on('console-message', (event) => {
    console.log(`[renderer:${event.level}] ${event.message}`);
  });
  const target = process.env.EXPERT_WIDGET_CAPTURE;
  if (!target) return;
  w.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      const script = process.env.EXPERT_WIDGET_CAPTURE_JS;
      if (script) {
        await w.webContents.executeJavaScript(script);
        await new Promise((r) => setTimeout(r, 400));
      }
      const image = await w.webContents.capturePage();
      writeFileSync(target, image.toPNG());
      console.log(`[dev] captured ${target}`);
    }, Number(process.env.EXPERT_WIDGET_CAPTURE_DELAY ?? 2500));
  });
}

function showWindow(): void {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function toggleWindow(): void {
  if (win?.isVisible()) win.hide();
  else showWindow();
}

// ---- Tray ---------------------------------------------------------------------------------

function loginItemArgs(): string[] {
  // In development the executable is electron.exe, which needs the app folder as argument.
  return app.isPackaged ? [] : [appRoot()];
}

function buildTrayMenu(): Menu {
  const startWithWindows = app.getLoginItemSettings({ args: loginItemArgs() }).openAtLogin;
  return Menu.buildFromTemplate([
    { label: 'Show / Hide', click: toggleWindow },
    { label: 'Refresh now', click: () => void refresh() },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: startWithWindows,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked, path: process.execPath, args: loginItemArgs() });
        tray?.setContextMenu(buildTrayMenu());
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

function createTray(): void {
  const image = nativeImage.createFromPath(join(appRoot(), 'assets', 'tray.png'));
  tray = new Tray(image);
  tray.setToolTip(MOCK ? 'Expert Widget (mock data)' : 'Expert Widget');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', toggleWindow);
}

// ---- IPC ----------------------------------------------------------------------------------

function fromOurPage(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? '';
  return url === pathToFileURL(indexHtml()).toString();
}

function handle(channel: string, fn: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromOurPage(event)) throw new Error('IPC call from an unexpected page');
    return fn(...args);
  });
}

const isShortString = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 300;

function registerIpc(): void {
  handle('view:get', () => currentView());
  handle('view:refresh', () => refresh());
  handle('interact:visited', (key) => {
    if (!isShortString(key)) return;
    // Clicking again moves the company to the very end again.
    stores.interactions.update((s) => ({ ...s, visited: { ...s.visited, [companyKey(key)]: Date.now() } }));
  });
  handle('interact:seen', (id) => {
    if (!isShortString(id)) return;
    stores.interactions.update((s) => (s.seen[id] ? s : { ...s, seen: { ...s.seen, [id]: Date.now() } }));
  });
  handle('shell:open', (url) => openExternalSafe(url));
  handle('ui:theme', (theme) => {
    if (theme !== 'day' && theme !== 'dark') return;
    stores.ui.update((ui) => ({ ...ui, theme }));
    win?.setBackgroundColor(BACKGROUND[theme]);
  });
  handle('window:hide', () => win?.hide());
}

// ---- Start-up -----------------------------------------------------------------------------

function pruneSeen(): void {
  const cutoff = Date.now() - SEEN_RETENTION_MS;
  const { seen } = stores.interactions.value;
  const kept = Object.fromEntries(Object.entries(seen).filter(([, t]) => t >= cutoff));
  if (Object.keys(kept).length !== Object.keys(seen).length) stores.interactions.update((s) => ({ ...s, seen: kept }));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('window-all-closed', () => {
    /* stay in the tray */
  });

  void app.whenReady().then(() => {
    app.setAppUserModelId('de.expertwidget.app');
    stores = new AppStores(MOCK ? join(app.getPath('userData'), 'mock-state') : app.getPath('userData'));
    pruneSeen();
    files = loadFiles();
    registerIpc();
    createWindow();
    createTray();
    // Mock mode exists to work on the design, so it fills itself once instead of starting empty.
    if (MOCK && stores.feed.value.lastUpdated === null) void refresh();
  });
}
