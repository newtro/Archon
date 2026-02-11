import { useState, useEffect, useCallback, useRef } from "react";

export interface SidecarHealth {
  status: "healthy" | "degraded" | "disconnected";
  lastPing: number | null;
  latencyMs: number | null;
  reconnectAttempts: number;
  uptime: number | null;
}

export interface SidecarHealthResult extends SidecarHealth {
  handlePong: () => void;
}

interface UseSidecarHealthOptions {
  isConnected: boolean;
  send: (msg: { type: string }) => void;
  pingIntervalMs?: number;
  maxReconnectAttempts?: number;
}

export function useSidecarHealth({
  isConnected,
  send,
  pingIntervalMs = 30000,
  maxReconnectAttempts = 10,
}: UseSidecarHealthOptions): SidecarHealthResult {
  const [health, setHealth] = useState<SidecarHealth>({
    status: "disconnected",
    lastPing: null,
    latencyMs: null,
    reconnectAttempts: 0,
    uptime: null,
  });
  const pingSentAt = useRef<number | null>(null);
  const connectedSince = useRef<number | null>(null);

  // Track connection state
  useEffect(() => {
    if (isConnected) {
      connectedSince.current = Date.now();
      setHealth((prev) => ({
        ...prev,
        status: "healthy",
        reconnectAttempts: 0,
      }));
    } else {
      connectedSince.current = null;
      setHealth((prev) => ({
        ...prev,
        status: "disconnected",
        uptime: null,
        reconnectAttempts: prev.reconnectAttempts + 1,
      }));
    }
  }, [isConnected]);

  // Periodic ping
  useEffect(() => {
    if (!isConnected) return;

    const interval = setInterval(() => {
      pingSentAt.current = Date.now();
      send({ type: "ping" });
    }, pingIntervalMs);

    return () => clearInterval(interval);
  }, [isConnected, send, pingIntervalMs]);

  // Update uptime periodically
  useEffect(() => {
    if (!isConnected) return;

    const interval = setInterval(() => {
      if (connectedSince.current) {
        setHealth((prev) => ({
          ...prev,
          uptime: Date.now() - connectedSince.current!,
        }));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isConnected]);

  const handlePong = useCallback(() => {
    if (pingSentAt.current) {
      const latency = Date.now() - pingSentAt.current;
      setHealth((prev) => ({
        ...prev,
        status: latency > 5000 ? "degraded" : "healthy",
        lastPing: Date.now(),
        latencyMs: latency,
      }));
      pingSentAt.current = null;
    }
  }, []);

  const isOverMaxRetries = health.reconnectAttempts >= maxReconnectAttempts;

  return {
    ...health,
    status: isOverMaxRetries ? "disconnected" : health.status,
    handlePong,
  };
}
