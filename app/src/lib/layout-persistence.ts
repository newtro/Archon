import type { DockviewApi } from "dockview-react";
import { getSetting, setSetting } from "./store";

const LAYOUT_KEY = "dockviewLayout";

// Panels that must keep their DOM alive when hidden
const ALWAYS_RENDER = new Set(["chat", "flows", "flowExec"]);

/** Panel metadata for titles and renderer modes */
export const PANEL_META: Record<string, { title: string; singleton: boolean }> = {
  chat: { title: "Chat", singleton: true },
  flows: { title: "Flow Designer", singleton: true },
  flowExec: { title: "Execution", singleton: true },
  fileTree: { title: "Explorer", singleton: true },
  codeViewer: { title: "Editor", singleton: false },
  git: { title: "Source Control", singleton: true },
  diffViewer: { title: "Diff", singleton: false },
  logs: { title: "Logs", singleton: true },
  registry: { title: "Registry", singleton: true },
  settings: { title: "Settings", singleton: true },
  startup: { title: "Welcome", singleton: true },
  gateway: { title: "Gateway", singleton: true },
};

export function getRenderer(component: string): "always" | "onlyWhenVisible" {
  return ALWAYS_RENDER.has(component) ? "always" : "onlyWhenVisible";
}

/** Save current layout to store (debounce externally) */
export async function saveLayout(api: DockviewApi): Promise<void> {
  try {
    const state = api.toJSON();
    await setSetting(LAYOUT_KEY, state);
  } catch (e) {
    console.error("Failed to save layout:", e);
  }
}

/** Restore layout from store. Returns true if restored. */
export async function restoreLayout(api: DockviewApi): Promise<boolean> {
  try {
    const state = await getSetting<unknown>(LAYOUT_KEY, null);
    if (state) {
      api.fromJSON(state as Parameters<DockviewApi["fromJSON"]>[0]);
      return true;
    }
  } catch (e) {
    console.warn("Failed to restore layout, using default:", e);
  }
  return false;
}

/** Create the default layout (Chat + Execution side by side) */
export function createDefaultLayout(api: DockviewApi): void {
  api.addPanel({
    id: "chat",
    component: "chat",
    title: "Chat",
    renderer: "always",
  });
  api.addPanel({
    id: "flowExec",
    component: "flowExec",
    title: "Execution",
    renderer: "always",
    position: { referencePanel: "chat", direction: "right" },
  });
}

/** Layout presets (replace WorkspaceContext) */
export function applyPreset(api: DockviewApi, preset: "chat" | "flow" | "review"): void {
  // Clear existing panels
  api.clear();

  switch (preset) {
    case "chat":
      api.addPanel({ id: "chat", component: "chat", title: "Chat", renderer: "always" });
      api.addPanel({
        id: "flowExec",
        component: "flowExec",
        title: "Execution",
        renderer: "always",
        position: { referencePanel: "chat", direction: "right" },
      });
      break;

    case "flow":
      api.addPanel({ id: "flows", component: "flows", title: "Flow Designer", renderer: "always" });
      break;

    case "review":
      api.addPanel({ id: "chat", component: "chat", title: "Chat", renderer: "always" });
      api.addPanel({
        id: "flows",
        component: "flows",
        title: "Flow Designer",
        renderer: "always",
        position: { referencePanel: "chat", direction: "right" },
      });
      break;
  }
}

/** Open or focus a singleton panel. For multi-instance panels, always creates a new one. */
export function openOrFocusPanel(
  api: DockviewApi,
  component: string,
  options?: { id?: string; title?: string; params?: Record<string, unknown>; referencePanel?: string; direction?: "left" | "right" | "above" | "below" | "within" },
): void {
  const meta = PANEL_META[component];
  const panelId = options?.id ?? component;
  const title = options?.title ?? meta?.title ?? component;

  // For singletons, focus existing panel if present
  if (meta?.singleton) {
    const existing = api.getPanel(panelId);
    if (existing) {
      existing.api.setActive();
      if (options?.params) {
        existing.api.updateParameters(options.params);
      }
      return;
    }
  }

  const addOptions: Parameters<DockviewApi["addPanel"]>[0] = {
    id: panelId,
    component,
    title,
    renderer: getRenderer(component),
    params: options?.params,
  };

  if (options?.referencePanel) {
    addOptions.position = {
      referencePanel: options.referencePanel,
      direction: options.direction ?? "within",
    };
  }

  api.addPanel(addOptions);
}
