// Validation of the show/hide hotkey setting (an Electron accelerator string). Kept in the core so
// config.json can be validated anywhere; the desktop app registers the hotkey.

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
