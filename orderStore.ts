import { Redis } from "@upstash/redis";

// A completed-purchase record. The checkout hand-off page authorizes a payment
// mandate; on success the gate writes one of these so the agent can later poll
// it (MCP has no server->client push) and confirm the purchase to the user.
export interface CompletedOrder {
  orderId: string;
  mandateId: string;
  amount: number;
  currency: string;
  method: string;
  instrument: { issuer: string | null; maskedAccount: string | null; holder: string | null } | null;
  gates: { gate: string; pass: boolean; detail: string }[];
  completedAt: string;
}

export interface OrderStore {
  read(): Promise<CompletedOrder | null>;
  write(order: CompletedOrder): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryOrderStore implements OrderStore {
  private order: CompletedOrder | null = null;
  async read(): Promise<CompletedOrder | null> {
    return this.order;
  }
  async write(order: CompletedOrder): Promise<void> {
    this.order = order;
  }
  async clear(): Promise<void> {
    this.order = null;
  }
}

const ORDER_KEY = "product-picker:last-order";

export class RedisOrderStore implements OrderStore {
  private redis: Redis;
  constructor(url: string, token: string) {
    this.redis = new Redis({ url, token });
  }
  async read(): Promise<CompletedOrder | null> {
    return (await this.redis.get<CompletedOrder>(ORDER_KEY)) ?? null;
  }
  async write(order: CompletedOrder): Promise<void> {
    await this.redis.set(ORDER_KEY, order);
  }
  async clear(): Promise<void> {
    await this.redis.del(ORDER_KEY);
  }
}

export function selectOrderStore(env: NodeJS.ProcessEnv): OrderStore {
  const url = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return new RedisOrderStore(url, token);
  return new MemoryOrderStore();
}

export const orderStore: OrderStore = selectOrderStore(process.env);
