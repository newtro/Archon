import { useContext } from "react";
import {
  BaseEdge,
  getBezierPath,
  type EdgeProps,
  type Edge,
} from "@xyflow/react";
import { ExecEdgeStatesContext } from "./execution-contexts";

type ExecutionEdgeData = {
  signal: string;
  isActive: boolean;
  isCompleted: boolean;
  [key: string]: unknown;
};

export function ExecutionEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  data,
}: EdgeProps<Edge<ExecutionEdgeData>>) {
  const edgeStates = useContext(ExecEdgeStatesContext);
  const hasData = !!edgeStates[id];
  const isActive = data?.isActive ?? false;
  const isCompleted = data?.isCompleted ?? false;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <>
      <BaseEdge path={edgePath} style={style} />
      {/* Data indicator dot at edge midpoint — shows when data has traversed */}
      {hasData && (isActive || isCompleted) && (
        <circle
          cx={labelX}
          cy={labelY}
          r={4}
          fill={isActive ? "#6366f1" : "#22c55e"}
          stroke="var(--bg-primary)"
          strokeWidth={1.5}
          style={{ pointerEvents: "none", transition: "r 0.15s" }}
        />
      )}
    </>
  );
}
