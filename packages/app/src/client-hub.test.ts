import { describe, expect, it } from "vitest";

import { createClientHub, type Client } from "./client-hub.ts";

type SpyClient = Client & {
  readonly frames: string[];
  readonly closes: number;
  throwOnSend?: boolean;
};

const spyClient = (): SpyClient => {
  const frames: string[] = [];
  let closes = 0;
  const client: SpyClient = {
    frames,
    get closes() {
      return closes;
    },
    send: (frame) => {
      if (client.throwOnSend === true) throw new Error("closed");
      frames.push(frame);
    },
    close: () => {
      closes += 1;
    },
  };
  return client;
};

describe("createClientHub", () => {
  it("broadcast sends the encoded frame to every open client", () => {
    const hub = createClientHub();
    const clients = [spyClient(), spyClient(), spyClient()];
    for (const client of clients) hub.add(client);

    hub.broadcast("frame");

    for (const client of clients) expect(client.frames).toEqual(["frame"]);
  });

  it("send targets one client only", () => {
    const hub = createClientHub();
    const first = spyClient();
    const second = spyClient();
    hub.add(first);
    hub.add(second);

    hub.sendTo(first, "private");

    expect(first.frames).toEqual(["private"]);
    expect(second.frames).toEqual([]);
  });

  it("drops a client whose send throws and keeps the rest", () => {
    const hub = createClientHub();
    const failing = spyClient();
    failing.throwOnSend = true;
    const healthy = spyClient();
    hub.add(failing);
    hub.add(healthy);

    hub.broadcast("frame");

    expect(healthy.frames).toEqual(["frame"]);
    expect(hub.size).toBe(1);
  });

  it("closeAll closes every client once", () => {
    const hub = createClientHub();
    const clients = [spyClient(), spyClient()];
    for (const client of clients) hub.add(client);

    hub.closeAll();

    for (const client of clients) expect(client.closes).toBe(1);
    expect(hub.size).toBe(0);
  });
});
