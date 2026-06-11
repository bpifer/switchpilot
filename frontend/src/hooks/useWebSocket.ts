import { useEffect, useRef } from 'react';
import { getToken } from '../api';

export type WsEvent =
  | { type: 'alert'; data: { deviceId: string; kind: string; severity: string; message: string; ts: string } }
  | { type: 'job_progress'; data: {
      jobId: string;
      deviceId?: string;
      status: 'running' | 'done' | 'failed' | 'pending';
      attempt?: number;
      error?: string;
      retryAt?: string;
      recurring?: boolean;
      reaped?: boolean;
      manualRetry?: boolean;
    } };

/**
 * Opens a WebSocket connection to /ws and calls onEvent for each message.
 * Automatically reconnects on disconnect. Cleans up on unmount.
 */
export function useWebSocket(onEvent: (e: WsEvent) => void): void {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    let ws: WebSocket;
    let retryTimer: ReturnType<typeof setTimeout>;
    let stopped = false;

    function connect() {
      const token = getToken();
      if (!token || stopped) return;
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${location.host}/ws`);

      ws.onmessage = e => {
        try { handlerRef.current(JSON.parse(e.data)); } catch { /* ignore malformed */ }
      };
      ws.onclose = () => {
        if (!stopped) retryTimer = setTimeout(connect, 5000);
      };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      ws?.close();
    };
  }, []);
}
