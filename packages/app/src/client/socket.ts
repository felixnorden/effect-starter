import {
  decodeServerMessage,
  encodeClientMessage,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from "@mdv/core/protocol";
import { Result } from "effect";

export type ClientSocket = {
  readonly send: (message: ClientMessage) => void;
  readonly close: () => void;
};

export type ConnectOptions = {
  readonly onMessage: (message: ServerMessage) => void;
  readonly url?: string;
};

const defaultUrl = (): string => {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}/ws`;
};

/**
 * The page's socket edge. It sends `hello` on open, then `ack` (readiness only)
 * and `requestSnapshot` (the sole snapshot trigger) once mounted. A reload runs
 * the same sequence.
 */
export const connectClient = (options: ConnectOptions): ClientSocket => {
  const socket = new WebSocket(options.url ?? defaultUrl());

  const send = (message: ClientMessage): void => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(encodeClientMessage(message));
    }
  };

  socket.addEventListener("open", () => {
    send({ _tag: "hello", protocolVersion: PROTOCOL_VERSION });
    send({ _tag: "ack" });
    send({ _tag: "requestSnapshot" });
  });

  socket.addEventListener("message", (event) => {
    const decoded = decodeServerMessage(String(event.data));
    if (!Result.isSuccess(decoded)) return;
    options.onMessage(decoded.success);
    // PF-4 reads the last mark to the next paint.
    performance.mark("preview:patch");
  });

  return {
    send,
    close: () => socket.close(),
  };
};
