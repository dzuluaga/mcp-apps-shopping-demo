import { Redis } from "@upstash/redis";

// Per-order age + loyalty verification state. Scoped by orderId so that, on a
// shared deployment (Vercel + Redis, demo-global cart), one shopper verifying
// (or clicking the demo button) never flips another shopper's order to verified.
// The orderId is threaded in from the order token already present in every gate
// and checkout URL.
export interface Verification {
  ageVerified: boolean;
  loyalty: { applied: boolean; membershipNumber: string | null };
}

function defaults(): Verification {
  return { ageVerified: false, loyalty: { applied: false, membershipNumber: null } };
}

export interface VerificationStore {
  read(orderId: string): Promise<Verification>;
  write(orderId: string, patch: Partial<Verification>): Promise<void>;
  clear(orderId: string): Promise<void>;
}

export class MemoryVerificationStore implements VerificationStore {
  private byOrder = new Map<string, Verification>();
  async read(orderId: string): Promise<Verification> {
    const v = this.byOrder.get(orderId) ?? defaults();
    return { ageVerified: v.ageVerified, loyalty: { ...v.loyalty } };
  }
  async write(orderId: string, patch: Partial<Verification>): Promise<void> {
    const current = this.byOrder.get(orderId) ?? defaults();
    this.byOrder.set(orderId, { ...current, ...patch });
  }
  async clear(orderId: string): Promise<void> {
    this.byOrder.delete(orderId);
  }
}

function keyFor(orderId: string): string {
  return `product-picker:verification:${orderId}`;
}

export class RedisVerificationStore implements VerificationStore {
  private redis: Redis;
  constructor(url: string, token: string) {
    this.redis = new Redis({ url, token });
  }
  async read(orderId: string): Promise<Verification> {
    return (await this.redis.get<Verification>(keyFor(orderId))) ?? defaults();
  }
  async write(orderId: string, patch: Partial<Verification>): Promise<void> {
    const current = await this.read(orderId);
    await this.redis.set(keyFor(orderId), { ...current, ...patch });
  }
  async clear(orderId: string): Promise<void> {
    await this.redis.del(keyFor(orderId));
  }
}

export function selectVerificationStore(env: NodeJS.ProcessEnv): VerificationStore {
  const url = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return new RedisVerificationStore(url, token);
  return new MemoryVerificationStore();
}

export const verificationStore: VerificationStore = selectVerificationStore(process.env);
