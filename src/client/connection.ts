import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PORT, type MethodName, type ParamsOf, type ResultOf, type RpcErrorShape } from '../shared/protocol.ts';

export function configPath(): string {
  return process.env.MELVOR2_SCRIPT_CONFIG ?? join(homedir(), '.melvor2-scripting', 'config.json');
}

export interface ConnectionConfig {
  host: string;
  port: number;
  token: string;
}

/** Reads ~/.melvor2-scripting/config.json, which the game writes on its first start with the mod. */
export function readConfig(): ConnectionConfig {
  let file: Partial<ConnectionConfig> = {};
  try {
    file = JSON.parse(readFileSync(configPath(), 'utf8'));
  } catch {
    throw new Error(`No ${configPath()} yet. Start Melvor Idle 2 with the mod installed once; it writes the token there.`);
  }
  if (!file.token) throw new Error(`${configPath()} has no token`);
  return { host: '127.0.0.1', port: file.port ?? DEFAULT_PORT, token: file.token };
}

/** An error the game sent back. `code` says what kind (see ErrorCode in protocol.ts). */
export class MelvorError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = `MelvorError(${code})`;
  }
}

type Pending = { resolve(v: unknown): void; reject(e: unknown): void };

/** JSON-RPC over WebSocket to the game. Low level: scripts use `run()` / `Melvor` instead. */
export class Connection {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private listeners = new Set<(method: string, params: any) => void>();
  private closeListeners = new Set<(reason: string) => void>();
  closed: string | null = null;

  private constructor(private ws: WebSocket) {
    ws.addEventListener('message', (ev) => this.onMessage(String(ev.data)));
    ws.addEventListener('close', (ev) => {
      const reason = ev.code === 1006 ? 'the game closed or stopped responding' : `connection closed (${ev.code} ${ev.reason})`;
      this.closed = reason;
      for (const p of this.pending.values()) p.reject(new MelvorError('DISCONNECTED', reason));
      this.pending.clear();
      for (const l of this.closeListeners) l(reason);
    });
  }

  static async open(cfg: ConnectionConfig = readConfig(), timeoutMs = 5000): Promise<Connection> {
    const url = `ws://${cfg.host}:${cfg.port}/ws?token=${encodeURIComponent(cfg.token)}`;
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no answer from the game on port ${cfg.port} (is it running with the mod?)`)), timeoutMs);
      ws.addEventListener('open', () => (clearTimeout(timer), resolve()), { once: true });
      ws.addEventListener(
        'error',
        () => (clearTimeout(timer), reject(new Error(`can't reach the game on port ${cfg.port}: is Melvor Idle 2 running with the mod?`))),
        { once: true },
      );
    });
    return new Connection(ws);
  }

  call<M extends MethodName>(method: M, ...params: ParamsOf<M> extends void ? [] : [ParamsOf<M>]): Promise<ResultOf<M>> {
    if (this.closed) return Promise.reject(new MelvorError('DISCONNECTED', this.closed));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws.send(JSON.stringify({ id, method, params: params[0] }));
    });
  }

  /** Untyped call, for the CLI. */
  callRaw(method: string, params?: unknown): Promise<unknown> {
    return (this.call as any)(method, params);
  }

  onNotification(fn: (method: string, params: any) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onClose(fn: (reason: string) => void): () => void {
    this.closeListeners.add(fn);
    return () => this.closeListeners.delete(fn);
  }

  close(): void {
    this.ws.close(1000, 'bye');
  }

  private onMessage(text: string) {
    const msg = JSON.parse(text) as { id?: number; result?: unknown; error?: RpcErrorShape; method?: string; params?: unknown };
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new MelvorError(msg.error.code, msg.error.message, msg.error.data));
      else p.resolve(msg.result);
    } else if (msg.method) {
      for (const l of this.listeners) l(msg.method, msg.params);
    }
  }
}
