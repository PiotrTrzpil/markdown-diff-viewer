/**
 * The slice of the Language Server Protocol this server speaks: JSON-RPC 2.0 messages
 * framed with `Content-Length` headers over stdin/stdout.
 * @module
 */

import type { Readable, Writable } from "node:stream";

export interface Message {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
}

type RequestHandler = (params: unknown) => Promise<unknown>;
type NotificationHandler = (params: unknown) => void;

const HEADER_END = "\r\n\r\n";
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

/** Splits a byte stream into the JSON bodies of `Content-Length` framed messages. */
export class MessageReader {
  private buffer = Buffer.alloc(0);

  constructor(private readonly onMessage: (message: Message) => void) {}

  push(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf(HEADER_END);
      if (headerEnd === -1) return;
      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const length = header.match(/Content-Length: *(\d+)/i);
      if (!length) {
        throw new Error(`Message header without Content-Length: ${JSON.stringify(header)}`);
      }
      const bodyStart = headerEnd + HEADER_END.length;
      const bodyEnd = bodyStart + Number(length[1]);
      if (this.buffer.length < bodyEnd) return;
      const body = this.buffer.subarray(bodyStart, bodyEnd).toString("utf8");
      this.buffer = this.buffer.subarray(bodyEnd);
      this.onMessage(JSON.parse(body) as Message);
    }
  }
}

export function frame(message: Message): string {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}${HEADER_END}${body}`;
}

/** Routes requests and notifications to handlers and writes their replies. */
export class Connection {
  private readonly requests = new Map<string, RequestHandler>();
  private readonly notifications = new Map<string, NotificationHandler>();

  constructor(
    private readonly input: Readable,
    private readonly output: Writable,
  ) {}

  onRequest(method: string, handler: RequestHandler): void {
    this.requests.set(method, handler);
  }

  onNotification(method: string, handler: NotificationHandler): void {
    this.notifications.set(method, handler);
  }

  notify(method: string, params: unknown): void {
    this.output.write(frame({ jsonrpc: "2.0", method, params }));
  }

  listen(): void {
    const reader = new MessageReader((message) => void this.dispatch(message));
    this.input.on("data", (chunk: Buffer) => reader.push(chunk));
  }

  private async dispatch(message: Message): Promise<void> {
    const { id, method, params } = message;
    if (method === undefined) return; // a reply to a request this server never sends
    if (id === undefined) {
      this.notifications.get(method)?.(params);
      return;
    }
    const handler = this.requests.get(method);
    if (!handler) {
      this.reply(id, { error: { code: METHOD_NOT_FOUND, message: `Unhandled request ${method}` } });
      return;
    }
    try {
      this.reply(id, { result: (await handler(params)) ?? null });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.reply(id, { error: { code: INTERNAL_ERROR, message: `${method} failed: ${text}` } });
    }
  }

  private reply(id: number | string, outcome: { result: unknown } | { error: unknown }): void {
    this.output.write(frame({ jsonrpc: "2.0", id, ...outcome } as Message));
  }
}
