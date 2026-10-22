// Rules that keep the widget from getting lost. Pure functions, so they can be tested without
// Electron; main.ts wires them to the window, the tray, the hotkey and the single-instance lock.

import type { WindowMode } from '../../../packages/core/src/shared/types.js';

export { isValidHotkey } from '../../../packages/core/src/hotkey.js';

/**
 * Command-line flag of the start-at-login entry, so a start at login can be recognised. macOS
 * login items cannot pass arguments, so there a start at login looks like any other start.
 */
export const AUTOSTART_FLAG = '--autostart';

/** The tray menu's start-at-login entry, in each system's own words. */
export function autostartLabel(platform: NodeJS.Platform): string {
  if (platform === 'win32') return 'Start with Windows';
  if (platform === 'darwin') return 'Open at Login';
  return 'Start at Login';
}

/** A hotkey as the user knows it: "CommandOrControl+Alt+E" is "Ctrl+Alt+E" on Windows, "Cmd+Option+E" on a Mac. */
export function hotkeyLabel(hotkey: string, platform: NodeJS.Platform): string {
  const mac = platform === 'darwin';
  const names: Record<string, string> = {
    commandorcontrol: mac ? 'Cmd' : 'Ctrl',
    cmdorctrl: mac ? 'Cmd' : 'Ctrl',
    command: 'Cmd',
    cmd: 'Cmd',
    control: 'Ctrl',
    ctrl: 'Ctrl',
    alt: mac ? 'Option' : 'Alt',
    option: mac ? 'Option' : 'Alt',
    super: mac ? 'Cmd' : 'Super',
    meta: mac ? 'Cmd' : 'Super',
  };
  return hotkey
    .split('+')
    .map((p) => names[p.trim().toLowerCase()] ?? p.trim())
    .join('+');
}

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

/** After a start at login the widget is the small button; otherwise as it was left. */
export function startupMode(argv: readonly string[], saved: WindowMode): WindowMode {
  return argv.includes(AUTOSTART_FLAG) ? 'collapsed' : saved;
}

/**
 * Start at login is switched on once, the first time the installed app runs. After that
 * only the tray toggle changes it, so turning it off sticks.
 */
export function shouldApplyAutostartDefault(isPackaged: boolean, alreadyApplied: boolean): boolean {
  return isPackaged && !alreadyApplied;
}

export type HotkeyState = { status: 'off' } | { status: 'active'; hotkey: string } | { status: 'taken'; hotkey: string };

/** Line shown in the tray menu, or null when there is nothing to say. */
export function hotkeyMenuNote(state: HotkeyState): string | null {
  return state.status === 'taken' ? `Hotkey ${state.hotkey} is used by another program (change "hotkey" in config.json)` : null;
}
