import { createContext, useContext } from "react";
import type { DockviewApi } from "dockview-react";

const DockviewContext = createContext<DockviewApi | null>(null);

export function useDockview(): DockviewApi | null {
  return useContext(DockviewContext);
}

export { DockviewContext };
