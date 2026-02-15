import { getCurrentWindow, availableMonitors } from "@tauri-apps/api/window";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { getSetting, setSetting } from "./store";

const WINDOW_STATE_KEY = "windowState";
const SAVE_DEBOUNCE_MS = 500;

interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

/**
 * Check whether at least a portion of the window rect is visible on any monitor.
 * Returns true if the window overlaps any monitor by at least `margin` pixels.
 */
async function isPositionOnScreen(
  x: number,
  y: number,
  width: number,
  height: number,
  margin = 100,
): Promise<boolean> {
  const monitors = await availableMonitors();
  if (monitors.length === 0) return false;

  for (const m of monitors) {
    const mx = m.position.x;
    const my = m.position.y;
    const mw = m.size.width;
    const mh = m.size.height;

    // Check overlap: the window must have at least `margin` px inside the monitor
    const overlapX = Math.min(x + width, mx + mw) - Math.max(x, mx);
    const overlapY = Math.min(y + height, my + mh) - Math.max(y, my);

    if (overlapX >= margin && overlapY >= margin) {
      return true;
    }
  }
  return false;
}

/**
 * Restore the window position, size, and maximized state from the store.
 * Window is already visible (no hidden-start) — this just repositions it.
 */
export async function restoreWindowState(): Promise<void> {
  try {
    const win = getCurrentWindow();
    const state = await getSetting<WindowState | null>(WINDOW_STATE_KEY, null);
    if (!state) return;

    const onScreen = await isPositionOnScreen(state.x, state.y, state.width, state.height);
    if (onScreen) {
      await win.setPosition(new PhysicalPosition(state.x, state.y));
      await win.setSize(new PhysicalSize(state.width, state.height));
    }

    if (state.isMaximized) {
      await win.maximize();
    }
  } catch (e) {
    console.warn("Failed to restore window state:", e);
  }
}

/**
 * Start listening for move/resize events and persist window state.
 * Returns a cleanup function to remove listeners.
 */
export function startWindowStateTracking(): () => void {
  const win = getCurrentWindow();
  let debounceTimer: number | undefined;

  const saveState = async () => {
    try {
      const isMaximized = await win.isMaximized();

      if (isMaximized) {
        // When maximized, preserve the pre-maximized position/size
        // and just flip the maximized flag
        const existing = await getSetting<WindowState | null>(WINDOW_STATE_KEY, null);
        if (existing) {
          await setSetting(WINDOW_STATE_KEY, { ...existing, isMaximized: true });
        }
        return;
      }

      const position = await win.outerPosition();
      const size = await win.outerSize();

      await setSetting<WindowState>(WINDOW_STATE_KEY, {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        isMaximized: false,
      });
    } catch (e) {
      console.warn("Failed to save window state:", e);
    }
  };

  const debouncedSave = () => {
    clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(saveState, SAVE_DEBOUNCE_MS);
  };

  // Listen to window move and resize events
  const unlistenMove = win.onMoved(debouncedSave);
  const unlistenResize = win.onResized(debouncedSave);

  return () => {
    clearTimeout(debounceTimer);
    unlistenMove.then((fn) => fn());
    unlistenResize.then((fn) => fn());
  };
}
