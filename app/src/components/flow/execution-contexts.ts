import { createContext } from "react";
import type { NodeExecInfo, EdgeExecInfo } from "../../hooks/useFlowExecution";

/**
 * Context that provides per-node execution state to node components.
 * This decouples the React Flow nodes array (layout, stable) from the
 * rapidly-changing execution state so React Flow's internal store stays intact.
 */
export const ExecNodeStatesContext = createContext<Record<string, NodeExecInfo>>({});

/**
 * Context that provides per-edge execution data to custom edge components.
 */
export const ExecEdgeStatesContext = createContext<Record<string, EdgeExecInfo>>({});
