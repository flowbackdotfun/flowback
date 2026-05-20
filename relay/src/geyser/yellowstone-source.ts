import { createRequire } from "node:module";
import type Client from "@triton-one/yellowstone-grpc";

import { AsyncQueue } from "./queue.js";
import type {
  GeyserSource,
  GeyserSubscription,
  SubscribeRequest,
  SubscribeUpdate,
} from "./types.js";

/**
 * `GeyserSource` backed by a real Yellowstone gRPC endpoint.
 *
 * Connection liveness is delegated to the native client's HTTP/2 keepalive
 * (configured below); a dropped stream surfaces as an `error`/`end` on the
 * queue, which the indexer's reconnect loop handles.
 */

const MAX_DECODING_MESSAGE_SIZE = 64 * 1024 * 1024; // 64 MiB
const HTTP2_KEEPALIVE_INTERVAL_SECONDS = 30;

// The package declares `"type": "git"`, which breaks static ESM value imports
// under some loaders; pull the `Client` constructor from the CJS build instead.
// The `import type Client` above stays — purely for the instance type.
const nodeRequire = createRequire(import.meta.url);
const GeyserGrpcClient: new (
  endpoint: string,
  xToken: string | undefined,
  channelOptions: Record<string, unknown> | undefined,
) => Client = nodeRequire("@triton-one/yellowstone-grpc").default;

export interface YellowstoneConfig {
  endpoint: string;
  xToken?: string;
}

export class YellowstoneGeyserSource implements GeyserSource {
  constructor(private readonly config: YellowstoneConfig) {}

  async subscribe(request: SubscribeRequest): Promise<GeyserSubscription> {
    const client = new GeyserGrpcClient(this.config.endpoint, this.config.xToken, {
      grpcMaxDecodingMessageSize: MAX_DECODING_MESSAGE_SIZE,
      grpcHttp2KeepAliveInterval: HTTP2_KEEPALIVE_INTERVAL_SECONDS,
      grpcKeepAliveWhileIdle: true,
    });
    await client.connect();

    const stream = await client.subscribe();
    const queue = new AsyncQueue<SubscribeUpdate>();

    stream.on("data", (update: SubscribeUpdate) => queue.push(update));
    stream.on("error", (error: Error) => queue.fail(error));
    stream.on("end", () => queue.end());
    stream.on("close", () => queue.end());

    const write = (req: SubscribeRequest): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        stream.write(req, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

    // Send the initial subscription before handing the stream to the consumer.
    await write(request);

    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      queue.end();
      try {
        stream.end();
      } catch {
        // stream already torn down
      }
      try {
        stream.destroy();
      } catch {
        // stream already torn down
      }
    };

    return { updates: queue, write, close };
  }
}
