import { useEffect, useRef, useState } from 'react';
import { api, getToken } from '../api';

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

export type WsStatus = 'connecting' | 'live' | 'down';

/**
 * Opens a WebSocket connection to /ws and calls onEvent for each message.
 * Automatically reconnects on disconnect. Cleans up on unmount.
 * Returns a live connection status for surfacing in the UI.
 */
export function useWebSocket(onEvent: (e: WsEvent) => void): WsStatus {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;
  const [status, setStatus] = useState<WsStatus>('connecting');

  useEffect(() => {
    let ws: WebSocket;
    let retryTimer: ReturnType<typeof setTimeout>;
    let stopped = false;
    let retryMs = 2000;

    async function connect() {
      if (!getToken() || stopped) return;
      // Exchange the session JWT for a 30-second single-purpose nonce so the
      // real token never appears in the URL (or proxy access logs).
      let nonce: string;
      try {
        ({ token: nonce } = await api<{ token: string }>('/api/auth/ws-token', { method: 'POST' }));
      } catch {
        if (!stopped) { setStatus('down'); retryTimer = setTimeout(connect, retryMs); }
        return;
      }
      if (stopped) return;
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${location.host}/ws?token=${encodeURIComponent(nonce)}`);

      ws.onopen = () => { retryMs = 2000; setStatus('live'); };
      ws.onmessage = e => {
        try { handlerRef.current(JSON.parse(e.data)); } catch { /* ignore malformed */ }
      };
      ws.onclose = () => {
        if (stopped) return;
        setStatus('down');
        // Exponential backoff with jitter so a service restart doesn't get a
        // thundering herd of simultaneous reconnects.
        const delay = retryMs + Math.random() * retryMs;
        retryMs = Math.min(retryMs * 2, 30_000);
        retryTimer = setTimeout(connect, delay);
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

  return status;
}
