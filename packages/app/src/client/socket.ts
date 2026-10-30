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

export type SocketFactory = (url: string) => WebSocket;

export type ConnectOptions = {
  readonly onMessage: (message: ServerMessage) => void;
  readonly onClose?: () => void;
  readonly url?: string;
  /** The test seam; production uses the platform WebSocket. */
  readonly factory?: SocketFactory;
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
  const socket = (options.factory ?? ((url: string) => new WebSocket(url)))(
    options.url ?? defaultUrl(),
  );
  let closing = false;

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

  socket.addEventListener("close", () => {
    if (!closing) options.onClose?.();
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
    close: () => {
      closing = true;
      socket.close();
    },
  };
};
