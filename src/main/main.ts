// Electron main process: window, tray, IPC, and the Refresh button's work.
// All network access and file reading happens here, never in the renderer.

import { BrowserWindow, Menu, Tray, app, ipcMain, nativeImage, net, screen, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { StatusMessage, ViewModel, WindowMode } from '../shared/types.js';
import { isHttpUrl } from './config.js';
import { MockCvProvider, mockProviders } from './mock/mockData.js';
import { canonicalUrl, itemId } from './news/dedupe.js';
import { PoliteFetcher } from './news/fetcher.js';
import { HOST_INTERVALS_MS, LocalCvProvider, buildProviders } from './providers.js';
import { runRefresh } from './refresh.js';
import { BergamotTranslator, unpacked } from './translate/translator.js';
import { AppStores } from './state/appState.js';
import { ensureUserFiles, loadUserFiles, resolveHome, userFiles, type LoadedFiles } from './userFiles.js';
import { buildView, companyKey } from './view.js';
import { BUTTON_WINDOW, clampInto, panelBounds, restoreButtonPosition, type Rect } from './windowGeometry.js';

const MOCK = process.argv.includes('--mock');
const DEV = process.argv.includes('--dev');
const SEEN_RETENTION_MS = 120 * 24 * 60 * 60 * 1000;

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
          hostIntervalsMs: HOST_INTERVALS_MS,
        });
        messages = await runRefresh({
          config: files.config,
          cvFolder: files.cvFolder,
          stores,
          cv: MOCK ? new MockCvProvider() : new LocalCvProvider(),
          providers: MOCK ? mockProviders(files.config) : buildProviders(files.config, fetcher),
          isOnline: () => MOCK || net.isOnline(),
          translator: createTranslator(),
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

/**
 * The offline German→English translator. Its worker, engine and model are unpacked next to
 * app.asar in the installed app (see asarUnpack in package.json), because worker threads and the
 * WebAssembly engine read them as plain files.
 */
function createTranslator(): BergamotTranslator {
  const engineDir = join(dirname(require.resolve('@browsermt/bergamot-translator/package.json')), 'worker');
  return new BergamotTranslator(
    unpacked(join(__dirname, 'translate', 'worker.js')),
    unpacked(engineDir),
    unpacked(join(appRoot(), 'assets', 'translation', 'deen')),
  );
}

function openExternalSafe(url: unknown): void {
  if (isHttpUrl(url)) void shell.openExternal(url);
}

// ---- Window -------------------------------------------------------------------------------
//
// One frameless, transparent, always-on-top window with two states:
// - collapsed: just the round "E" button (a 72px window), anywhere on any screen;
// - expanded: a 420px panel, full work-area height, docked to the right edge of the screen the
//   button is on.
// The button is dragged manually over IPC (drag:start/move/end) because -webkit-app-region: drag
// swallows double-click events on Windows, and double-click is what expands the panel.

const displays = () => screen.getAllDisplays().map((d) => ({ id: d.id, workArea: d.workArea }));
const primary = () => {
  const p = screen.getPrimaryDisplay();
  return { id: p.id, workArea: p.workArea };
};

let buttonPos = { x: 0, y: 0 };

function buttonRect(): Rect {
  return { ...buttonPos, width: BUTTON_WINDOW, height: BUTTON_WINDOW };
}

function buttonCentre(): Electron.Point {
  return { x: Math.round(buttonPos.x + BUTTON_WINDOW / 2), y: Math.round(buttonPos.y + BUTTON_WINDOW / 2) };
}

function boundsFor(mode: WindowMode): Rect {
  return mode === 'collapsed' ? buttonRect() : panelBounds(screen.getDisplayNearestPoint(buttonCentre()).workArea);
}

function saveButton(): void {
  const display = screen.getDisplayNearestPoint(buttonCentre());
  buttonPos = clampInto(display.workArea, buttonPos.x, buttonPos.y);
  stores.ui.update((ui) => ({ ...ui, button: { ...buttonPos, displayId: display.id } }));
}

function setMode(mode: WindowMode): void {
  if (!win) return;
  stores.ui.update((ui) => ({ ...ui, mode }));
  if (mode === 'expanded') {
    // Resize first, then draw the panel into the larger window.
    win.setBounds(boundsFor('expanded'));
    pushView();
    showWindow();
  } else {
    // Draw the button first, then shrink, so the panel is never squeezed into the small window.
    pushView();
    setTimeout(() => win?.setBounds(boundsFor('collapsed')), 30);
  }
  tray?.setContextMenu(buildTrayMenu());
}

/** Screens added, removed or rearranged: bring the button back onto a screen and redock. */
function onDisplaysChanged(): void {
  if (!win) return;
  buttonPos = restoreButtonPosition({ ...buttonPos, displayId: null }, displays(), primary());
  win.setBounds(boundsFor(stores.ui.value.mode));
}

function createWindow(): void {
  buttonPos = restoreButtonPosition(stores.ui.value.button, displays(), primary());
  win = new BrowserWindow({
    ...boundsFor(stores.ui.value.mode),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    title: MOCK ? 'Expert Widget (mock data)' : 'Expert Widget',
    icon: join(appRoot(), 'assets', 'icon.png'),
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

  screen.on('display-added', onDisplaysChanged);
  screen.on('display-removed', onDisplaysChanged);
  screen.on('display-metrics-changed', onDisplaysChanged);

  void win.loadFile(indexHtml());
  if (DEV) win.webContents.openDevTools({ mode: 'detach' });
  if (!app.isPackaged) attachDevDiagnostics(win);
}

// Dragging the collapsed button: the main process reads the cursor itself, so the renderer only
// says "started", "moved" and "ended". setBounds (not setPosition) keeps the size fixed when the
// button crosses between screens with different scaling.
let drag: { cursor: Electron.Point; start: { x: number; y: number } } | null = null;

function dragStart(): void {
  if (!win || stores.ui.value.mode !== 'collapsed') return;
  drag = { cursor: screen.getCursorScreenPoint(), start: { ...buttonPos } };
}

function dragMove(): void {
  if (!win || !drag) return;
  const now = screen.getCursorScreenPoint();
  buttonPos = { x: drag.start.x + now.x - drag.cursor.x, y: drag.start.y + now.y - drag.cursor.y };
  win.setBounds(buttonRect());
}

function dragEnd(): void {
  if (!drag) return;
  drag = null;
  saveButton();
  win?.setBounds(buttonRect());
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
  const expanded = stores.ui.value.mode === 'expanded';
  return Menu.buildFromTemplate([
    { label: 'Show / Hide', click: toggleWindow },
    {
      label: expanded ? 'Collapse' : 'Expand',
      click: () => {
        setMode(expanded ? 'collapsed' : 'expanded');
        showWindow();
      },
    },
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

function fromOurPage(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
  const url = event.senderFrame?.url ?? '';
  return url === pathToFileURL(indexHtml()).toString();
}

function handle(channel: string, fn: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromOurPage(event)) throw new Error('IPC call from an unexpected page');
    return fn(...args);
  });
}

function on(channel: string, fn: () => void): void {
  ipcMain.on(channel, (event) => {
    if (fromOurPage(event)) fn();
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
  handle('feedback:remove', (id) => {
    if (!isShortString(id)) return;
    const card = currentView().news.find((n) => n.id === id);
    if (!card) return;
    stores.interactions.update((s) => {
      const { [id]: _dropped, ...useful } = s.useful;
      return { ...s, useful, removed: { ...s.removed, [canonicalUrl(card.url)]: Date.now() } };
    });
  });
  handle('feedback:undo-remove', (id) => {
    if (isShortString(id)) {
      stores.interactions.update((s) => ({ ...s, removed: Object.fromEntries(Object.entries(s.removed).filter(([url]) => itemId(url) !== id)) }));
    }
    return currentView();
  });
  handle('feedback:useful', (id) => {
    if (!isShortString(id)) return currentView();
    if (stores.interactions.value.useful[id]) {
      stores.interactions.update((s) => {
        const { [id]: _dropped, ...useful } = s.useful;
        return { ...s, useful };
      });
    } else {
      // The card is taken from the main process's own view, never from the renderer.
      const card = currentView().news.find((n) => n.id === id);
      if (card) {
        const { seenAt: _seenAt, useful: _useful, ...entry } = card;
        stores.interactions.update((s) => ({ ...s, useful: { ...s.useful, [id]: { ...entry, markedAt: Date.now() } } }));
      }
    }
    return currentView();
  });
  handle('shell:open', (url) => openExternalSafe(url));
  handle('ui:theme', (theme) => {
    if (theme !== 'day' && theme !== 'dark') return;
    stores.ui.update((ui) => ({ ...ui, theme }));
  });
  handle('window:mode', (mode) => {
    if (mode === 'collapsed' || mode === 'expanded') setMode(mode);
  });
  on('drag:start', dragStart);
  on('drag:move', dragMove);
  on('drag:end', dragEnd);
}

// ---- Start-up -----------------------------------------------------------------------------

function pruneSeen(): void {
  const cutoff = Date.now() - SEEN_RETENTION_MS;
  const { seen } = stores.interactions.value;
  const kept = Object.fromEntries(Object.entries(seen).filter(([, t]) => t >= cutoff));
  if (Object.keys(kept).length !== Object.keys(seen).length) stores.interactions.update((s) => ({ ...s, seen: kept }));
}

// Development aid: run against a throw-away state folder (ignored in the installed app).
if (!app.isPackaged && process.env.EXPERT_WIDGET_USER_DATA) app.setPath('userData', process.env.EXPERT_WIDGET_USER_DATA);

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
