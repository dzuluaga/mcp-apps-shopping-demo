import { Redis } from "@upstash/redis";

export interface CartStore {
  read(): Promise<Map<string, number>>;
  write(cart: Map<string, number>): Promise<void>;
}

export class MemoryCartStore implements CartStore {
  private cart = new Map<string, number>();
  async read(): Promise<Map<string, number>> {
    return new Map(this.cart);
  }
  async write(cart: Map<string, number>): Promise<void> {
    this.cart = new Map(cart);
  }
}

const CART_KEY = "product-picker:cart";

export class RedisCartStore implements CartStore {
  private redis: Redis;
  constructor(url: string, token: string) {
    this.redis = new Redis({ url, token });
  }
  async read(): Promise<Map<string, number>> {
    const obj = (await this.redis.get<Record<string, number>>(CART_KEY)) ?? {};
    return new Map(Object.entries(obj));
  }
  async write(cart: Map<string, number>): Promise<void> {
    await this.redis.set(CART_KEY, Object.fromEntries(cart));
  }
}

export function selectCartStore(env: NodeJS.ProcessEnv): CartStore {
  const url = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return new RedisCartStore(url, token);
  return new MemoryCartStore();
}

export const cartStore: CartStore = selectCartStore(process.env);
