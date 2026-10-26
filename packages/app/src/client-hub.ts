export type Client = {
  readonly send: (frame: string) => void;
  readonly close: () => void;
};

export type ClientHub = {
  readonly size: number;
  readonly add: (client: Client) => void;
  readonly remove: (client: Client) => void;
  readonly broadcast: (frame: string) => void;
  readonly sendTo: (client: Client, frame: string) => void;
  readonly closeAll: () => void;
};

/**
 * One place that owns connected sockets, fan-out, and removal of failed
 * clients. A send that throws removes that client and leaves the rest.
 */
export const createClientHub = (): ClientHub => {
  const clients = new Set<Client>();

  const remove = (client: Client): void => {
    clients.delete(client);
  };

  const sendTo = (client: Client, frame: string): void => {
    try {
      client.send(frame);
    } catch {
      remove(client);
    }
  };

  return {
    get size() {
      return clients.size;
    },
    add: (client) => {
      clients.add(client);
    },
    remove,
    broadcast: (frame) => {
      for (const client of clients) sendTo(client, frame);
    },
    sendTo,
    closeAll: () => {
      for (const client of clients) {
        try {
          client.close();
        } catch {
          // Closing a dead socket is a no-op.
        }
      }
      clients.clear();
    },
  };
};
