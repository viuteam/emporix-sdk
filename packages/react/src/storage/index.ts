/** Pluggable customer-token store. SSR-safe by default (memory). */
export interface TokenStorage {
  getCustomerToken(): string | null;
  setCustomerToken(token: string | null): void;
  subscribe?(listener: (token: string | null) => void): () => void;
}

export { createMemoryStorage } from "./memory";
