import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isLinuxAutostartOn, linuxAutostartPath, quoteExecArg, setLinuxAutostart } from '../apps/desktop/src/autostart.js';
import { validateConfig } from '../packages/core/src/config.js';
import { FileStores as AppStores } from '../packages/node/src/state/fileStores.js';
import {
  AUTOSTART_FLAG,
  autostartLabel,
  hotkeyLabel,
  hotkeyMenuNote,
  isValidHotkey,
  onCloseRequest,
  secondInstanceAction,
  shouldApplyAutostartDefault,
  startupMode,
  toggleAction,
} from '../apps/desktop/src/windowBehaviour.js';
import { defaultConfigJson, registry } from './helpers/config.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'expert-findable-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('hide on close', () => {
  it('closing only hides the widget unless Quit was chosen', () => {
    expect(onCloseRequest(false)).toBe('hide');
    expect(onCloseRequest(true)).toBe('close');
  });

  it('tray left-click and the hotkey toggle visibility', () => {
    expect(toggleAction(true)).toBe('hide');
    expect(toggleAction(false)).toBe('show');
  });
});

describe('single instance', () => {
  it('a second start brings the running widget to the front, expanded', () => {
    expect(secondInstanceAction()).toEqual({ show: true, mode: 'expanded' });
  });
});

describe('start at login', () => {
  // Changed on purpose: one neutral label on every system instead of "Start with Windows".
  it('uses the same neutral words in the tray menu on every system', () => {
    for (const p of ['win32', 'darwin', 'linux'] as const) expect(autostartLabel(p)).toBe('Start at login');
  });

  it('on Linux, writes and removes an XDG autostart entry', () => {
    const path = linuxAutostartPath({ XDG_CONFIG_HOME: join(dir, 'cfg') }, '/home/me');
    expect(path).toBe(join(dir, 'cfg', 'autostart', 'expert-widget.desktop'));
    expect(linuxAutostartPath({}, '/home/me')).toBe(join('/home/me', '.config', 'autostart', 'expert-widget.desktop'));

    expect(isLinuxAutostartOn(path)).toBe(false);
    setLinuxAutostart(path, true, ['/opt/Expert Widget/expert-widget', '--ozone-platform=x11', AUTOSTART_FLAG]);
    expect(isLinuxAutostartOn(path)).toBe(true);
    const entry = readFileSync(path, 'utf8');
    expect(entry).toContain('[Desktop Entry]');
    expect(entry).toContain('Exec="/opt/Expert Widget/expert-widget" --ozone-platform=x11 --autostart\n');
    setLinuxAutostart(path, false, []);
    expect(isLinuxAutostartOn(path)).toBe(false);
    setLinuxAutostart(path, false, []); // already off: no error
  });

  it('quotes Exec arguments as the desktop entry spec asks', () => {
    expect(quoteExecArg('/usr/bin/app')).toBe('/usr/bin/app');
    expect(quoteExecArg('/a b/c')).toBe('"/a b/c"');
    expect(quoteExecArg('/a "b"/$c')).toBe('"/a \\"b\\"/\\$c"');
    expect(quoteExecArg('100%')).toBe('100%%');
  });
});

describe('start with Windows', () => {
  it('a start at login shows the small button, other starts keep the saved state', () => {
    expect(startupMode(['Expert Widget.exe', AUTOSTART_FLAG], 'expanded')).toBe('collapsed');
    expect(startupMode(['Expert Widget.exe'], 'expanded')).toBe('expanded');
    expect(startupMode(['Expert Widget.exe'], 'collapsed')).toBe('collapsed');
  });

  it('is switched on once by default in the installed app, never in development', () => {
    expect(shouldApplyAutostartDefault(true, false)).toBe(true);
    expect(shouldApplyAutostartDefault(true, true)).toBe(false);
    expect(shouldApplyAutostartDefault(false, false)).toBe(false);
  });

  it('remembers that the default was applied, so turning it off sticks', () => {
    const stores = new AppStores(dir);
    expect(stores.ui.value.autostartDefaultApplied).toBe(false);
    stores.ui.update((u) => ({ ...u, autostartDefaultApplied: true }));
    expect(new AppStores(dir).ui.value.autostartDefaultApplied).toBe(true);
  });

  it('older ui.json files without the flag still load', () => {
    writeFileSync(join(dir, 'ui.json'), JSON.stringify({ version: 2, theme: 'dark', mode: 'expanded', button: null }));
    const stores = new AppStores(dir);
    // cvFolder and watchlistSearch were added later; older files get the defaults.
    expect(stores.ui.value).toEqual({ version: 2, theme: 'dark', mode: 'expanded', button: null, autostartDefaultApplied: false, cvFolder: null, watchlistSearch: true });
    expect(stores.recoveredFiles()).toEqual([]);
  });
});

describe('global hotkey', () => {
  it('accepts key combinations Electron understands', () => {
    expect(isValidHotkey('Ctrl+Alt+E')).toBe(true);
    expect(isValidHotkey('Control+Shift+F12')).toBe(true);
    expect(isValidHotkey('CmdOrCtrl+Alt+Space')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isValidHotkey('E')).toBe(false);
    expect(isValidHotkey('Ctrl+')).toBe(false);
    expect(isValidHotkey('Ctrl+Ctrl+E')).toBe(false);
    expect(isValidHotkey('Hyper+E')).toBe(false);
    expect(isValidHotkey('Ctrl+Alt+Enterprise')).toBe(false);
  });

  it('is CommandOrControl+Alt+E by default, configurable, and "" switches it off', () => {
    const raw = defaultConfigJson();
    expect(raw.hotkey).toBe('CommandOrControl+Alt+E');
    const ok = validateConfig({ ...raw, hotkey: 'Ctrl+Shift+X' }, registry());
    expect(ok.ok && ok.value.hotkey).toBe('Ctrl+Shift+X');
    const off = validateConfig({ ...raw, hotkey: '' }, registry());
    expect(off.ok && off.value.hotkey).toBe('');
    const missing = { ...raw };
    delete missing.hotkey;
    const fallback = validateConfig(missing, registry());
    expect(fallback.ok && fallback.value.hotkey).toBe('CommandOrControl+Alt+E');
  });

  it('reports a malformed hotkey in config.json with its path', () => {
    const bad = validateConfig({ ...defaultConfigJson(), hotkey: 'Strg+E' }, registry());
    expect(!bad.ok && bad.errors[0]).toMatch(/^hotkey: must be a key combination like "CommandOrControl\+Alt\+E"/);
  });

  it('is shown in each system\'s own words', () => {
    expect(hotkeyLabel('CommandOrControl+Alt+E', 'win32')).toBe('Ctrl+Alt+E');
    expect(hotkeyLabel('CommandOrControl+Alt+E', 'linux')).toBe('Ctrl+Alt+E');
    expect(hotkeyLabel('CommandOrControl+Alt+E', 'darwin')).toBe('Cmd+Option+E');
    expect(hotkeyLabel('Ctrl+Shift+F12', 'darwin')).toBe('Ctrl+Shift+F12');
    expect(hotkeyLabel('cmdorctrl+alt+space', 'win32')).toBe('Ctrl+Alt+space');
  });

  it('a hotkey taken by another program becomes a note in the tray menu, not an error', () => {
    expect(hotkeyMenuNote({ status: 'taken', hotkey: 'Ctrl+Alt+E' })).toBe('Hotkey Ctrl+Alt+E is used by another program (change "hotkey" in config.json)');
    expect(hotkeyMenuNote({ status: 'active', hotkey: 'Ctrl+Alt+E' })).toBeNull();
    expect(hotkeyMenuNote({ status: 'off' })).toBeNull();
  });
});
