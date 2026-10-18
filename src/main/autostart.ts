// "Start at login" on Linux. Electron's app.setLoginItemSettings covers Windows and macOS only, so
// on Linux the widget writes a desktop entry into the XDG autostart folder (~/.config/autostart),
// which GNOME, KDE, Xfce and the other common desktops read at login.

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function linuxAutostartPath(env: Record<string, string | undefined>, homeDir: string): string {
  const configHome = env.XDG_CONFIG_HOME?.trim() || join(homeDir, '.config');
  return join(configHome, 'autostart', 'expert-widget.desktop');
}

/** Quotes one argument for the Exec key (Desktop Entry Specification, "The Exec key"). */
export function quoteExecArg(arg: string): string {
  const escaped = arg.replace(/%/g, '%%');
  if (!/[\s"'\\><~|&;$*?#()`]/.test(escaped)) return escaped;
  return `"${escaped.replace(/(["`$\\])/g, '\\$1')}"`;
}

export function desktopEntry(command: readonly string[]): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Expert Widget',
    `Exec=${command.map(quoteExecArg).join(' ')}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

export function isLinuxAutostartOn(path: string): boolean {
  return existsSync(path);
}

export function setLinuxAutostart(path: string, on: boolean, command: readonly string[]): void {
  if (on) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, desktopEntry(command), 'utf8');
  } else {
    rmSync(path, { force: true });
  }
}
