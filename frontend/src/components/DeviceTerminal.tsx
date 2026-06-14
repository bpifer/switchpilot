// Live SSH terminal in the browser. No external terminal library - a small
// built-in emulator handles the subset of control sequences a switch CLI uses
// (\r\n newlines, bare \r line-redraw, backspace, and ANSI escape stripping).
// Keystrokes are sent raw to the backend /ws/terminal bridge.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Modal, Button } from './ui';

// strip ANSI CSI (colors, cursor) and OSC sequences we don't emulate
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

export default function DeviceTerminal({ deviceId, hostname, onClose }: {
  deviceId: string; hostname: string; onClose: () => void;
}) {
  const [lines, setLines] = useState<string[]>(['']);
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const rawLog = useRef('');

  // Append a chunk through the mini emulator.
  function write(chunk: string) {
    rawLog.current += chunk;
    const clean = chunk.replace(ANSI, '').replace(/\r\n/g, '\n');
    setLines(prev => {
      const out = prev.slice();
      for (const ch of clean) {
        if (ch === '\n') out.push('');
        else if (ch === '\r') out[out.length - 1] = '';            // bare CR redraws the line
        else if (ch === '\b' || ch === '\x7f') out[out.length - 1] = out[out.length - 1].slice(0, -1);
        else if (ch >= ' ' || ch === '\t') out[out.length - 1] += ch;
      }
      // cap scrollback
      return out.length > 2000 ? out.slice(out.length - 2000) : out;
    });
  }

  useEffect(() => {
    let stopped = false;
    (async () => {
      let token: string;
      try { ({ token } = await api<{ token: string }>('/api/auth/ws-token', { method: 'POST' })); }
      catch { write('\n[could not authorize terminal session]\n'); setStatus('closed'); return; }
      if (stopped) return;
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${location.host}/ws/terminal?token=${encodeURIComponent(token)}&deviceId=${deviceId}`);
      wsRef.current = ws;
      ws.onopen = () => { setStatus('open'); screenRef.current?.focus(); };
      ws.onmessage = e => write(typeof e.data === 'string' ? e.data : '');
      ws.onclose = () => { setStatus('closed'); write('\n[session closed]\n'); };
      ws.onerror = () => setStatus('closed');
    })();
    return () => { stopped = true; wsRef.current?.close(); };
  }, [deviceId]);

  // autoscroll to bottom on new output
  useEffect(() => { const s = screenRef.current; if (s) s.scrollTop = s.scrollHeight; }, [lines]);

  function sendKey(e: React.KeyboardEvent) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) return;
    const k = e.key;
    let data = '';
    if (e.ctrlKey && k.length === 1 && /[a-z]/i.test(k)) data = String.fromCharCode(k.toUpperCase().charCodeAt(0) & 0x1f);
    else if (k === 'Enter') data = '\r';
    else if (k === 'Backspace') data = '\x7f';
    else if (k === 'Tab') data = '\t';
    else if (k === 'Escape') data = '\x1b';
    else if (k === 'ArrowUp') data = '\x1b[A';
    else if (k === 'ArrowDown') data = '\x1b[B';
    else if (k === 'ArrowRight') data = '\x1b[C';
    else if (k === 'ArrowLeft') data = '\x1b[D';
    else if (k.length === 1 && !e.metaKey) data = k;
    else return;
    e.preventDefault();
    ws.send(data);
  }

  function onPaste(e: React.ClipboardEvent) {
    const ws = wsRef.current;
    if (ws?.readyState === 1) { e.preventDefault(); ws.send(e.clipboardData.getData('text')); }
  }

  function download() {
    const blob = new Blob([rawLog.current.replace(ANSI, '')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${hostname || 'device'}-terminal-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Modal title={`Terminal — ${hostname}`} onClose={onClose}>
      <div className="mb-2 flex items-center justify-between">
        <span className={`text-xs font-medium ${status === 'open' ? 'text-green-600' : status === 'connecting' ? 'text-amber-600' : 'text-slate-400'}`}>
          {status === 'open' ? '● connected' : status === 'connecting' ? '○ connecting…' : '○ disconnected'}
        </span>
        <Button variant="secondary" onClick={download}>Download log</Button>
      </div>
      <div
        ref={screenRef}
        tabIndex={0}
        onKeyDown={sendKey}
        onPaste={onPaste}
        className="h-[60vh] w-full cursor-text overflow-auto rounded-lg bg-gray-950 p-3 font-mono text-xs leading-snug text-green-200 outline-none focus:ring-2 focus:ring-brand-500/40"
      >
        {lines.map((l, i) => <div key={i} className="whitespace-pre-wrap break-all">{l || ' '}</div>)}
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Click the screen and type. Keystrokes go straight to the switch (Tab, ↑ history, Ctrl-C all work).
        This session is audited.
      </p>
    </Modal>
  );
}
