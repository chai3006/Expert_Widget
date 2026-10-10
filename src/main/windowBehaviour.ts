// Rules that keep the widget from getting lost. Pure functions, so they can be tested without
// Electron; main.ts wires them to the window, the tray, the hotkey and the single-instance lock.

import type { WindowMode } from '../shared/types.js';

/** Command-line flag of the "Start with Windows" entry, so a start at login can be recognised. */
export const AUTOSTART_FLAG = '--autostart';

/** Closing the window (X button, Alt+F4, taskbar) only hides it; only Quit in the tray exits. */
export function onCloseRequest(quitting: boolean): 'hide' | 'close' {
  return quitting ? 'close' : 'hide';
}

/** Tray left-click and the global hotkey: hide when showing, otherwise show. */
export function toggleAction(visible: boolean): 'hide' | 'show' {
  return visible ? 'hide' : 'show';
}

/**
 * Starting the app again (Start menu, desktop icon) while it runs: no second copy; the running
 * widget comes to the front, expanded.
 */
export function secondInstanceAction(): { show: true; mode: WindowMode } {
  return { show: true, mode: 'expanded' };
}

/** After a start at Windows login the widget is the small button; otherwise as it was left. */
export function startupMode(argv: readonly string[], saved: WindowMode): WindowMode {
  return argv.includes(AUTOSTART_FLAG) ? 'collapsed' : saved;
}

/**
 * "Start with Windows" is switched on once, the first time the installed app runs. After that
 * only the tray toggle changes it, so turning it off sticks.
 */
export function shouldApplyAutostartDefault(isPackaged: boolean, alreadyApplied: boolean): boolean {
  return isPackaged && !alreadyApplied;
}

const MODIFIERS = new Set(['ctrl', 'control', 'alt', 'shift', 'super', 'meta', 'cmdorctrl', 'commandorcontrol', 'altgr', 'option', 'cmd', 'command']);
const KEY = /^([a-z0-9]|f([1-9]|1[0-9]|2[0-4])|space|tab|insert|delete|home|end|pageup|pagedown|up|down|left|right|plus|=|-|,|\.|\/|;|')$/i;

/** An Electron accelerator such as "Ctrl+Alt+E": one or more modifiers, then one key. */
export function isValidHotkey(value: string): boolean {
  const parts = value.split('+').map((p) => p.trim());
  if (parts.length < 2 || parts.some((p) => p === '')) return false;
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1).map((m) => m.toLowerCase());
  return mods.every((m) => MODIFIERS.has(m)) && new Set(mods).size === mods.length && KEY.test(key);
}

export type HotkeyState = { status: 'off' } | { status: 'active'; hotkey: string } | { status: 'taken'; hotkey: string };

/** Line shown in the tray menu, or null when there is nothing to say. */
export function hotkeyMenuNote(state: HotkeyState): string | null {
  return state.status === 'taken' ? `Hotkey ${state.hotkey} is used by another program (change "hotkey" in config.json)` : null;
}
