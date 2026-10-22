// Electron main process: window, tray, IPC, and the Refresh button's work.
// All network access and file reading happens here, never in the renderer.

import { BrowserWindow, Menu, Tray, app, globalShortcut, ipcMain, nativeImage, net, screen, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { StatusMessage, ViewModel, WindowMode } from '../../../packages/core/src/shared/types.js';
import { isLinuxAutostartOn, linuxAutostartPath, setLinuxAutostart } from './autostart.js';
import { DEFAULT_HOTKEY, isHttpUrl } from '../../../packages/core/src/config.js';
import { MockCvProvider, mockProviders } from '../../../packages/core/src/mock/mockData.js';
import { canonicalUrl, itemId } from '../../../packages/core/src/news/dedupe.js';
import { PoliteFetcher } from '../../../packages/node/src/fetcher.js';
import { HOST_INTERVALS_MS, buildProviders } from '../../../packages/core/src/news/providers.js';
import { LocalCvProvider } from '../../../packages/node/src/cv/folderCvSource.js';
import { runRefresh, translateNew } from '../../../packages/core/src/refresh.js';
import { BergamotTranslator, TRANSLATOR_WORKER, unpacked } from '../../../packages/node/src/translate/translator.js';
import { FileStores } from '../../../packages/node/src/state/fileStores.js';
import { ensureUserFiles, loadUserFiles, resolveHome, userFiles, type LoadedFiles } from '../../../packages/node/src/userFiles.js';
import { buildView, companyKey } from '../../../packages/core/src/view.js';
import {
  AUTOSTART_FLAG,
  autostartLabel,
  hotkeyLabel,
  hotkeyMenuNote,
  onCloseRequest,
  secondInstanceAction,
  shouldApplyAutostartDefault,
  startupMode,
  toggleAction,
  type HotkeyState,
} from './windowBehaviour.js';
import { BUTTON_WINDOW, clampInto, panelBounds, restoreButtonPosition, type Rect } from './windowGeometry.js';

const MOCK = process.argv.includes('--mock');
const DEV = process.argv.includes('--dev');
const MAC = process.platform === 'darwin';
const LINUX = process.platform === 'linux';
const SEEN_RETENTION_MS = 120 * 24 * 60 * 60 * 1000;

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let stores: FileStores;
let files: LoadedFiles;
let messages: StatusMessage[] = [];
let refreshing: Promise<ViewModel> | null = null;
let isRefreshing = false;

const appRoot = () => app.getAppPath();
const defaultsDir = () => join(appRoot(), 'defaults');
// Mock mode reads the bundled defaults (no CV, no user files) and keeps its own state folder.
const files_ = () => userFiles(MOCK ? defaultsDir() : resolveHome(process.env, homedir()));
const indexHtml = () => join(__dirname, '..', '..', '..', 'ui', 'packages', 'ui', 'src', 'index.html');

function loadFiles(): LoadedFiles {
  if (!MOCK) {
    try {
      ensureUserFiles(files_(), defaultsDir());
    } catch (err) {
      return { ok: false, error: `Cannot create ${files_().home}: ${err instanceof Error ? err.message : String(err)}`, cvFolder: join(files_().home, 'CV') };
    }
  }
  const loaded = loadUserFiles(files_(), process.env, homedir());
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
    watchlist: files.ok ? files.watchlist : [],
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

/**
 * Translates news that is already cached but has no English version yet (for example news loaded
 * before translation existed). Runs once at start-up, on this PC only: nothing is fetched, so it is
 * not a refresh.
 */
const itemKey = (i: { url: string; headline: string; excerpt: string }) => JSON.stringify([i.url, i.headline, i.excerpt]);

async function translateCached(): Promise<void> {
  const sources = Object.fromEntries(
    Object.entries(stores.feed.value.sources).map(([id, s]) => [id, { ...s, items: s.items.map((i) => ({ ...i })) }]),
  );
  const translator = createTranslator();
  try {
    const count = await translateNew(sources, translator);
    if (count === 0) return;
    // Merge into the current cache rather than replacing it: a Refresh may have finished meanwhile.
    const done = new Map(Object.values(sources).flatMap((s) => s.items.map((i) => [itemKey(i), i.translation] as const)));
    stores.feed.update((f) => ({
      ...f,
      sources: Object.fromEntries(
        Object.entries(f.sources).map(([id, s]) => [
          id,
          { ...s, items: s.items.map((i) => (i.translation ? i : { ...i, translation: done.get(itemKey(i)) ?? i.translation })) },
        ]),
      ),
    }));
    pushView();
  } catch (err) {
    console.warn(`[translate] cached news not translated: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await translator.close().catch(() => undefined);
  }
}

function refresh(): Promise<ViewModel> {
  if (refreshing) return refreshing;
  isRefreshing = true;
  pushView();
  refreshing = (async () => {
    files = loadFiles(); // pick up edits to config.json and employers.json
    registerHotkey();
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
          watchlist: files.watchlist.map((w) => w.name),
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
    unpacked(TRANSLATOR_WORKER),
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
  updateTrayMenu();
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
  // X, Alt+F4 and the taskbar only hide the widget; only Quit in the tray menu exits.
  win.on('close', (event) => {
    if (onCloseRequest(quitting) === 'hide') {
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

/** Tray left-click and the global hotkey. */
function toggleWindow(): void {
  if (!win) return;
  if (toggleAction(win.isVisible()) === 'hide') win.hide();
  else showWindow();
}

// ---- Global hotkey ------------------------------------------------------------------------

let hotkey: HotkeyState = { status: 'off' };

/** (Re-)registers the show/hide hotkey from config.json; a taken hotkey only adds a tray note. */
function registerHotkey(): void {
  const wanted = files.ok ? files.config.hotkey : DEFAULT_HOTKEY;
  // Unchanged and working: nothing to do. A taken hotkey is tried again on every Refresh.
  if (hotkey.status === 'active' && hotkey.hotkey === wanted) return;
  globalShortcut.unregisterAll();
  if (!wanted) {
    hotkey = { status: 'off' };
  } else {
    let ok = false;
    try {
      ok = globalShortcut.register(wanted, toggleWindow);
    } catch {
      ok = false;
    }
    hotkey = ok ? { status: 'active', hotkey: wanted } : { status: 'taken', hotkey: wanted };
  }
  updateTrayMenu();
}

// ---- Start at login -----------------------------------------------------------------------

function loginItemArgs(): string[] {
  // In development the executable is electron(.exe), which needs the app folder as argument.
  // The flag tells a start at login apart from a start from the Start menu.
  return app.isPackaged ? [AUTOSTART_FLAG] : [appRoot(), AUTOSTART_FLAG];
}

/** Linux: the AppImage file itself, not the temporary folder it runs from. */
const linuxExecutable = () => process.env.APPIMAGE ?? process.execPath;
/**
 * Linux: run under X11 (XWayland on Wayland desktops). Wayland does not let a window place itself,
 * and the widget must put its button where it was left and dock the panel to the right edge.
 * Same switch as linux.executableArgs in package.json, which the menu entry uses.
 */
const LINUX_SWITCHES = ['--ozone-platform=x11'];

function isStartAtLogin(): boolean {
  if (LINUX) return isLinuxAutostartOn(linuxAutostartPath(process.env, homedir()));
  return app.getLoginItemSettings({ args: loginItemArgs() }).openAtLogin;
}

function setStartAtLogin(on: boolean): void {
  if (LINUX) {
    try {
      setLinuxAutostart(linuxAutostartPath(process.env, homedir()), on, [linuxExecutable(), ...LINUX_SWITCHES, ...loginItemArgs()]);
    } catch (err) {
      console.warn(`[autostart] not changed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }
  // path and args are used on Windows only; macOS login items take neither.
  app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args: loginItemArgs() });
}

// ---- Tray ---------------------------------------------------------------------------------

/**
 * Windows and Linux keep the menu attached to the icon. On macOS a menu attached to the icon
 * would also open on left-click, so there it is built fresh on each right-click instead.
 */
function updateTrayMenu(): void {
  if (!MAC) tray?.setContextMenu(buildTrayMenu());
}

function buildTrayMenu(): Menu {
  const startAtLogin = isStartAtLogin();
  const expanded = stores.ui.value.mode === 'expanded';
  const note = hotkeyMenuNote(hotkey);
  const keys = hotkey.status === 'active' ? hotkeyLabel(hotkey.hotkey, process.platform) : '';
  // A tab right-aligns the hotkey in Windows menus; elsewhere it would show as a gap.
  const showHide = !keys ? 'Show / Hide' : process.platform === 'win32' ? `Show / Hide\t${keys}` : `Show / Hide (${keys})`;
  return Menu.buildFromTemplate([
    { label: showHide, click: toggleWindow },
    {
      label: expanded ? 'Collapse' : 'Expand',
      click: () => {
        setMode(expanded ? 'collapsed' : 'expanded');
        showWindow();
      },
    },
    { label: 'Refresh now', click: () => void refresh() },
    {
      label: autostartLabel(process.platform),
      type: 'checkbox',
      checked: startAtLogin,
      click: (item) => {
        setStartAtLogin(item.checked);
        updateTrayMenu();
      },
    },
    ...(note ? [{ type: 'separator' as const }, { label: note, enabled: false }] : []),
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

function createTray(): void {
  const image = nativeImage.createFromPath(join(appRoot(), 'assets', 'tray.png'));
  tray = new Tray(image);
  tray.setToolTip(MOCK ? 'Expert Widget (mock data)' : 'Expert Widget');
  // Right-click opens the menu (Windows shows a context menu only on right-click);
  // left-click shows or hides the widget. Many Linux desktops only ever open the menu, which is
  // why Show / Hide is its first entry.
  updateTrayMenu();
  tray.on('click', toggleWindow);
  if (MAC) tray.on('right-click', () => tray?.popUpContextMenu(buildTrayMenu()));
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
  handle('window:hide', () => win?.hide());
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
  // A second start (Start menu, desktop icon) brings this widget to the front, expanded.
  const bringToFront = () => {
    const action = secondInstanceAction();
    if (!win) return;
    setMode(action.mode);
    showWindow();
  };
  app.on('second-instance', bringToFront);
  // macOS does not start a second copy at all: opening the app again only sends "activate". The
  // first launch sends one too, so listening starts only once the widget is on screen.
  if (MAC) {
    app.once('browser-window-created', (_event, w) => {
      w.once('show', () => setTimeout(() => app.on('activate', bringToFront), 1000));
    });
  }
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('window-all-closed', () => {
    /* stay in the tray */
  });

  void app.whenReady().then(() => {
    app.setAppUserModelId('de.expertwidget.app');
    stores = new FileStores(MOCK ? join(app.getPath('userData'), 'mock-state') : app.getPath('userData'));
    pruneSeen();
    files = loadFiles();
    // After a start at login the widget is the small button (no refresh either way).
    const mode = startupMode(process.argv, stores.ui.value.mode);
    if (mode !== stores.ui.value.mode) stores.ui.update((ui) => ({ ...ui, mode }));
    // Start at login is on by default: switched on once, the first time the installed app runs.
    if (shouldApplyAutostartDefault(app.isPackaged && !MOCK, stores.ui.value.autostartDefaultApplied)) {
      setStartAtLogin(true);
      stores.ui.update((ui) => ({ ...ui, autostartDefaultApplied: true }));
    }
    registerIpc();
    createWindow();
    createTray();
    registerHotkey();
    void translateCached();
    // Mock mode exists to work on the design, so it fills itself once instead of starting empty.
    if (MOCK && stores.feed.value.lastUpdated === null) void refresh();
  });
}
