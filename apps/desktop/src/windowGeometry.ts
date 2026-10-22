// Where the window goes in its two states. Pure functions so they can be tested without Electron.
//
// Collapsed: a small window holding the round button (plus room for the badge), anywhere on any
// screen. Expanded: a 420px panel, full work-area height, docked to the right edge of the screen
// the button is on.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayInfo {
  id: number;
  workArea: Rect;
}

export const PANEL_WIDTH = 420;
/** The window around the 56px button: 8px on each side for the badge and the focus ring. */
export const BUTTON_WINDOW = 72;

export function panelBounds(workArea: Rect): Rect {
  const width = Math.min(PANEL_WIDTH, workArea.width);
  return { x: workArea.x + workArea.width - width, y: workArea.y, width, height: workArea.height };
}

/** First start: right edge of the primary screen, a little above the middle. */
export function defaultButtonPosition(workArea: Rect): { x: number; y: number } {
  return {
    x: workArea.x + workArea.width - BUTTON_WINDOW - 16,
    y: Math.round(workArea.y + workArea.height * 0.4),
  };
}

function contains(area: Rect, x: number, y: number): boolean {
  return x >= area.x && x < area.x + area.width && y >= area.y && y < area.y + area.height;
}

/**
 * Restores a saved button position. If its screen is gone, or the centre of the button is no
 * longer on any screen, it goes back to the default spot on the primary screen. Otherwise it is
 * nudged fully inside the work area of the screen it is on.
 */
export function restoreButtonPosition(
  saved: { x: number; y: number; displayId: number | null } | null,
  displays: readonly DisplayInfo[],
  primary: DisplayInfo,
): { x: number; y: number } {
  if (!saved) return defaultButtonPosition(primary.workArea);
  const cx = saved.x + BUTTON_WINDOW / 2;
  const cy = saved.y + BUTTON_WINDOW / 2;
  const display = displays.find((d) => contains(d.workArea, cx, cy));
  const sameScreen = saved.displayId === null || displays.some((d) => d.id === saved.displayId);
  if (!display || !sameScreen) return defaultButtonPosition(primary.workArea);
  return clampInto(display.workArea, saved.x, saved.y);
}

export function clampInto(area: Rect, x: number, y: number): { x: number; y: number } {
  return {
    x: Math.min(Math.max(x, area.x), area.x + area.width - BUTTON_WINDOW),
    y: Math.min(Math.max(y, area.y), area.y + area.height - BUTTON_WINDOW),
  };
}
