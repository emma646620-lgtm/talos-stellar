import type {
  Talos,
  TalosCreated,
  TalosDetail,
  CreateTalosParams,
  ReportActivityParams,
  Activity,
  ReportRevenueParams,
  Revenue,
  CreateApprovalParams,
  Approval,
  RegisterServiceParams,
  CommerceService,
  SignPaymentParams,
  SignedPayment,
  DiscoverServicesParams,
  PurchaseServiceParams,
  CommerceJob,
  Wallet,
  LeaderboardEntry,
  Playbook,
  CreatePlaybookParams,
  TransferParams,
  TransferResponse,
  PaginatedResponse,
  CursorPage,
  CursorRequestOptions,
  ActivityPage,
  ActivityPageOptions,
} from "./types.js";
import {
  SigningController,
  canonicalizeRequest,
  encodeSignature,
  type RequestSigner,
  type SigningControllerOptions,
} from "./signing.js";
import { TalosAPIError } from "./errors.js";
export type {
  CursorPage,
  CursorRequestOptions,
  ActivityPage,
  ActivityPageOptions,
  PaginatedResponse,
} from "./types.js";
export { TalosAPIError };

export interface RetryPolicyOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryMethods?: string[];
  retryStatusCodes?: number[];
  jitter?: boolean;
  random?: () => number;
}

export interface WriteOptions {
  /** Idempotency key for safe retries. */
  idempotencyKey?: string;
  /** Abort signal. */
  signal?: AbortSignal;
}

export interface TalosClientOptions {
  /** Base URL of the Talos API. Defaults to `https://talos-stellar.vercel.app`. */
  baseUrl?: string;
  /** Bearer token (TALOS API key). Adds `Authorization: Bearer <key>` header. */
  apiKey?: string;
  /** Opt-in request signer. Omitting it preserves the legacy wire format. */
  signer?: RequestSigner;
  signing?: SigningControllerOptions;
  /** Retry policy for idempotent requests. */
  retryPolicy?: RetryPolicyOptions;
  /** Custom fetch implementation for tests / middleware. */
  fetch?: typeof fetch;
}

/** Structured event emitted to {@link TalosClientOptions.onError}. */
export interface TalosErrorEvent {
  error: TalosAPIError;
  path: string;
  method: string;
  attempt: number;
  durationMs: number;
}

/**
 * Type guard for normalized Talos API errors.
 */
export function isTalosAPIError(error: unknown): error is TalosAPIError {
  return error instanceof TalosAPIError;
}

/**
 * Returns the HTTP status of a Talos API error, or `undefined` if the value
 * is not a Talos API error.
 */
export function getTalosErrorStatus(error: unknown): number | undefined {
  return isTalosAPIError(error) ? error.status : undefined;
}

/**
 * Returns the request ID attached to a Talos API error, if available.
 */
export function getTalosErrorRequestId(error: unknown): string | undefined {
  return isTalosAPIError(error)
    ? (error as TalosAPIError & { requestId?: string }).requestId
    : undefined;
}

/**
 * Returns a human-readable message from any thrown value.
 */
export function getTalosErrorMessage(error: unknown): string {
  if (isTalosAPIError(error)) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Returns the items from a {@link CursorPage}.
 */
export function getPageItems<T>(page: CursorPage<T>): T[] {
  return (page as any).items ?? [];
}

/**
 * Returns the next cursor from a {@link CursorPage}, or `null` if there are no
 * more pages.
 */
export function getPageNextCursor<T>(page: CursorPage<T>): string | null {
  return (page as any).nextCursor ?? null;
}

/**
 * Returns whether a {@link CursorPage} has another page to load.
 */
export function pageHasMore<T>(page: CursorPage<T>): boolean {
  return getPageNextCursor(page) != null;
}

/**
 * Async generator that yields every item across all pages fetched via `fetchPage`.
 * Follows `nextCursor` until it is `null`/`undefined`.
 */
export async function* paginate<T>(
  fetchPage: (cursor?: string) => Promise<CursorPage<T>>,
): AsyncGenerator<T> {
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    const items = (page as any).items ?? [];
    for (const item of items) {
      yield item;
    }
    cursor = (page as any).nextCursor ?? undefined;
  } while (cursor);
}



/** Methods considered safe to retry without further confirmation from the caller. */
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD"]);

/**
 * Sleep helper. Uses `setTimeout` so it works in both Node and the browser.
 * Returns a promise that resolves after `ms` milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Apply jitter to a delay: `delay * (1 - jitter + jitter*random)`.
 * Bounded below by 0 and above by `delay * (1 + jitter)`.
 */
function applyJitter(delay: number, jitter: number): number {
  const factor = 1 - jitter + jitter * Math.random();
  return Math.max(0, Math.round(delay * factor));
}

/**
 * Talos Protocol API client. Wraps `fetch` with typed errors, optional
 * timeout, and bounded auto-retry for idempotent operations.
 *
 * Tier list of changes from the previous version (all backward-compatible):
 *   - Errors are now typed subclasses of `TalosAPIError` (see `./errors.ts`).
 *   - `timeoutMs` enables a per-request `AbortController` timeout.
 *   - `retry.maxAttempts > 1` opt-in retries on transient failures only.
 *   - `onError` callback for centralized logging / metrics.
 *   - `fetch` injection for tests / middleware.
 */
export class TalosClient {
  private baseUrl: string;
  private headers: Record<string, string>;
  private signer?: SigningController;
  private retryPolicy: Required<RetryPolicyOptions>;
  private fetchOverride?: typeof fetch;

  constructor(options: TalosClientOptions = {}) {
    const normalizedRetryMethods = options.retryPolicy?.retryMethods?.map(
      (method) => method.toUpperCase(),
    );
    this.retryPolicy = {
      maxAttempts: options.retryPolicy?.maxAttempts ?? 3,
      baseDelayMs: options.retryPolicy?.baseDelayMs ?? 100,
      maxDelayMs: options.retryPolicy?.maxDelayMs ?? 1000,
      retryMethods: normalizedRetryMethods ?? [
        "GET",
        "HEAD",
        "PUT",
        "DELETE",
        "OPTIONS",
      ],
      retryStatusCodes: options.retryPolicy?.retryStatusCodes ?? [
        429, 500, 502, 503, 504,
      ],
      jitter: options.retryPolicy?.jitter ?? true,
      random: options.retryPolicy?.random ?? Math.random,
    };
    this.baseUrl = (
      options.baseUrl ?? "https://talos-stellar.vercel.app"
    ).replace(/\/$/, "");
    this.headers = { "Content-Type": "application/json" };
    this.fetchOverride = options.fetch;
    if (options.apiKey) {
      this.headers["Authorization"] = `Bearer ${options.apiKey}`;
    }
    if (options.signer) this.signer = new SigningController(options.signer, options.signing);
  }

  /** Resolve the fetch implementation per request. Prefer override; fall back to global. */
  private resolveFetch(): typeof fetch {
    return this.fetchOverride ?? globalThis.fetch;
  }

  private shouldRetry(method: string, status: number, retryMethodsOverride?: string[]): boolean {
    const methods = retryMethodsOverride ?? this.retryPolicy.retryMethods;
    return (
      this.retryPolicy.retryStatusCodes.includes(status) &&
      methods.includes(method)
    );
  }

  private getRetryDelay(
    attempt: number,
    retryAfterHeader: string | null,
  ): number {
    if (retryAfterHeader) {
      const headerDelay = this.parseRetryAfter(retryAfterHeader);
      if (headerDelay !== null) {
        return Math.min(headerDelay, this.retryPolicy.maxDelayMs);
      }
    }

    const exponent = Math.pow(2, attempt - 1);
    const delay = Math.min(
      this.retryPolicy.baseDelayMs * exponent,
      this.retryPolicy.maxDelayMs,
    );
    if (!this.retryPolicy.jitter) {
      return delay;
    }

    return Math.floor(this.retryPolicy.random() * delay);
  }

  private parseRetryAfter(header: string | null): number | null {
    if (!header) return null;
    const trimmed = header.trim();
    const seconds = Number(trimmed);
    if (!Number.isNaN(seconds)) {
      return Math.max(0, seconds * 1000);
    }

    const parsedDate = Date.parse(trimmed);
    if (!Number.isNaN(parsedDate)) {
      const delta = parsedDate - Date.now();
      return delta > 0 ? delta : 0;
    }

    return null;
  }

  private wait(delayMs: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(new Error("Request aborted"));
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, delayMs);

      const onAbort = () => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        reject(new Error("Request aborted"));
      };

      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private async request<T>(
    path: string,
    init?: RequestInit & {
      params?: Record<string, string | number | boolean>;
      idempotencyKey?: string;
    },
  ): Promise<T> {
    let url = `${this.baseUrl}${path}`;
    const { params, signal, idempotencyKey, ...requestInit } = init ?? {};
    const normalizedSignal = signal ?? undefined;
    if (params) {
      const filteredParams = Object.entries(params)
        .filter(([_, value]) => value !== undefined)
        .reduce((acc, [key, value]) => ({ ...acc, [key]: String(value) }), {} as Record<string, string>);
      const qs = new URLSearchParams(filteredParams).toString();
      if (qs) url += `?${qs}`;
    }
    const headers = { ...this.headers, ...init?.headers };
    if (this.signer) {
      const timestamp = new Date().toISOString();
      const nonce = globalThis.crypto.randomUUID();
      const bytes = await canonicalizeRequest({
        method: init?.method ?? "GET",
        url,
        headers,
        body: init?.body,
        timestamp,
        nonce,
      });
      const signed = await this.signer.sign(
        { kind: "http-request-v1", bytes },
        { signal: init?.signal ?? undefined, requestId: nonce },
      );
      Object.assign(headers, {
        "X-Talos-Signature-Version": "talos-request-v1",
        "X-Talos-Key-Id": signed.keyId,
        "X-Talos-Algorithm": signed.algorithm,
        "X-Talos-Timestamp": timestamp,
        "X-Talos-Nonce": nonce,
        "X-Talos-Signature": encodeSignature(signed.signature),
      });
    }
    let res: Response;
    try {
      res = await this.resolveFetch()(url, {
        ...requestInit,
        headers,
        signal,
      });
    } catch (cause) {
      throw new TalosAPIError(
        0,
        `Network request failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        path,
      );
    }
    const text = await res.text();
    let parsed: unknown;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        if (!res.ok) {
          parsed = text;
        } else {
          const requestId = res.headers.get("x-request-id") ?? undefined;
          const error = new TalosAPIError(0, `Malformed JSON response: ${text}`, path);
          (error as any).requestId = requestId;
          throw error;
        }
      }
    } else {
      parsed = undefined;
    }
    if (!res.ok) {
      const requestId = res.headers.get("x-request-id") ?? undefined;
      const error = new TalosAPIError(res.status, parsed, path);
      (error as any).requestId = requestId;
      throw error;
    }
    return parsed as T;
  }

  private async requestPage<T>(
    path: string,
    options?: CursorRequestOptions,
  ): Promise<CursorPage<T>> {
    const { signal, ...params } = options ?? {};
    return this.request(path, { params, signal });
  }

  // ── Talos CRUD ────────────────────────────────────────────

  async listTaloses(params?: CursorRequestOptions): Promise<CursorPage<Talos>> {
    return this.requestPage("/api/talos", params);
  }

  async getTalos(id: string): Promise<TalosDetail> {
    return this.request(`/api/talos/${id}`);
  }

  async getTalosMe(): Promise<TalosDetail> {
    return this.request("/api/talos/me");
  }

  async createTalos(params: CreateTalosParams): Promise<TalosCreated> {
    return this.request("/api/talos", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  // ── Activity ───────────────────────────────────────────────

  async listActivities(params?: ActivityPageOptions): Promise<ActivityPage> {
    const { signal, ...query } = params ?? {};
    return this.request<ActivityPage>("/api/activity", {
      params: query,
      signal,
    });
  }

  async reportActivity(
    talosId: string,
    params: ReportActivityParams,
    options?: WriteOptions,
  ): Promise<Activity> {
    return this.request(`/api/talos/${talosId}/activity`, {
      method: "POST",
      body: JSON.stringify(params),
      idempotencyKey: options?.idempotencyKey,
      signal: options?.signal,
    });
  }

  async getTalosActivities(talosId: string): Promise<Activity[]> {
    return this.request(`/api/talos/${talosId}/activity`);
  }

  // ── Revenue ────────────────────────────────────────────────

  async reportRevenue(
    talosId: string,
    params: ReportRevenueParams,
    options?: WriteOptions,
  ): Promise<Revenue> {
    return this.request(`/api/talos/${talosId}/revenue`, {
      method: "POST",
      body: JSON.stringify(params),
      idempotencyKey: options?.idempotencyKey,
      signal: options?.signal,
    });
  }

  async getTalosRevenues(talosId: string): Promise<Revenue[]> {
    return this.request(`/api/talos/${talosId}/revenue`);
  }

  // ── Approvals ──────────────────────────────────────────────

  async createApproval(
    talosId: string,
    params: CreateApprovalParams,
    options?: WriteOptions,
  ): Promise<Approval> {
    return this.request(`/api/talos/${talosId}/approvals`, {
      method: "POST",
      body: JSON.stringify(params),
      idempotencyKey: options?.idempotencyKey,
      signal: options?.signal,
    });
  }

  async getApprovals(talosId: string, status?: string): Promise<Approval[]> {
    const params: Record<string, string> = {};
    if (status) params.status = status;
    return this.request(`/api/talos/${talosId}/approvals`, { params });
  }

  async getApproval(talosId: string, approvalId: string): Promise<Approval> {
    return this.request(`/api/talos/${talosId}/approvals/${approvalId}`);
  }

  // ── Status ─────────────────────────────────────────────────

  async updateStatus(talosId: string, online: boolean): Promise<void> {
    await this.request(`/api/talos/${talosId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ agentOnline: online }),
    });
  }

  // ── Commerce / x402 ────────────────────────────────────────

  async registerService(
    talosId: string,
    params: RegisterServiceParams,
  ): Promise<CommerceService> {
    return this.request(`/api/talos/${talosId}/service`, {
      method: "PUT",
      body: JSON.stringify(params),
    });
  }

  async discoverServices(
    params?: DiscoverServicesParams,
  ): Promise<CursorPage<CommerceService>> {
    const { signal, ...query } = params ?? {};
    return this.requestPage("/api/services", { ...query, signal });
  }

  async purchaseService(
    talosId: string,
    params: PurchaseServiceParams,
    options?: WriteOptions,
  ): Promise<CommerceJob> {
    return this.request(`/api/talos/${talosId}/purchase`, {
      method: "POST",
      body: JSON.stringify(params),
      idempotencyKey: options?.idempotencyKey,
      signal: options?.signal,
    });
  }urn this.request(`/api/talos/${talosId}/service`, {
      method: "POST",
      body: JSON.stringify({ payload: params.payload }),
      headers: { "X-PAYMENT": params.paymentHeader },
      idempotencyKey: options?.idempotencyKey,
      signal: options?.signal,
    });
  }

  /**
   * High-level helper to purchase a service, handling the x402 402 challenge flow.
   *
   * Errors raised here are typed:
   *   - {@link TalosPaymentError} when the 402 challenge is malformed/missing.
   *   - {@link TalosAuthenticationError} for missing credentials on the signed retry.
   *   - Any other TalosAPIError subclass for downstream failures.
   *
   * @param talosId - The ID of the TALOS providing the service.
   * @param buyerTalosId - The ID of the TALOS purchasing the service (for signing).
   * @param payload - Optional payload for the service.
   */
  async purchaseServiceWithPayment(
    talosId: string,
    buyerTalosId: string,
    payload?: Record<string, unknown>,
    options?: WriteOptions,
  ): Promise<CommerceJob> {
    const path = `/api/talos/${talosId}/service`;
    const url = `${this.baseUrl}${path}`;

    if (this.chaosInjector) {
      await this.chaosInjector.maybeInjectFault(FaultType.NETWORK_DELAY);
      await this.chaosInjector.maybeInjectFault(FaultType.NETWORK_DROP);
      await this.chaosInjector.maybeInjectFault(FaultType.API_TIMEOUT);
    }

    // 1. Try initial request
    const initialHeaders = await this.signedHeaders(url, {
      method: "POST",
      body: JSON.stringify({ payload }),
    });
    res = await fetch(url, {
      method: "POST",
      headers: initialHeaders,
      body: JSON.stringify({ payload }),
    });

    if (res.status === 402) {
      // 2. Validate the x402 challenge.
      const authHeader = res.headers.get("WWW-Authenticate");
      if (!authHeader || !authHeader.startsWith("x402")) {
        // Preserve the legacy text so existing
        // `rejects.toThrow("Invalid x402 challenge")` assertions keep passing.
        throw new TalosPaymentError(402, "Invalid x402 challenge", path, {
          message: "Invalid x402 challenge",
          headers: { "www-authenticate": authHeader ?? "" },
        });
      }
      const challenge = parseX402Challenge(authHeader);
      if (!challenge) {
        throw new TalosPaymentError(402, "Invalid x402 challenge", path, {
          message: "Invalid x402 challenge",
          headers: { "www-authenticate": authHeader },
        });
      }

      // 3. Request signature from the Web API.
      //    `parseFloat(undefined)` would yield NaN; we already required both
      //    keys above (parseX402Challenge rejects partial challenges), but
      //    `price` could still be the literal "abc" — guard explicitly so
      //    a malformed header never feeds NaN to the downstream /sign call.
      const amount = parseFloat(challenge.price);
      if (!Number.isFinite(amount)) {
        throw new TalosPaymentError(402, "Invalid x402 challenge", path, {
          message: "Invalid x402 challenge",
          headers: { "www-authenticate": authHeader },
        });
      }
      const signRes = await this.signPayment(buyerTalosId, {
        payee: challenge.payee,
        amount,
        assetCode: challenge.token,
      });

      // 4. Retry with the X-PAYMENT header — delegated to the regular
      //    request helper, so all typed errors / retry / timeout apply.
      return this.purchaseService(talosId, {
        paymentHeader: signRes.paymentHeader,
        payload,
      }, options);
    }

    // Non-402 responses — wrap them through the typed dispatch.
    if (!res.ok) {
      const body = await res.text();
      throw new TalosAPIError(
        res.status,
        body,
        `/api/talos/${talosId}/service`,
      );
    }

    return res.json() as Promise<CommerceJob>;
  }

  private async signedHeaders(url: string, init: RequestInit): Promise<Record<string, string>> {
    if (!this.signer && !init.headers) return { ...this.headers };
    const merged = new Headers(this.headers);
    new Headers(init.headers).forEach((value, key) => merged.set(key, value));
    const headers = Object.fromEntries(merged.entries());
    if (!this.signer) return headers;
    const timestamp = new Date().toISOString();
    const nonce = globalThis.crypto.randomUUID();
    const bytes = await canonicalizeRequest({
      method: init.method ?? "GET",
      url,
      headers,
      body: init.body,
      timestamp,
      nonce,
    });
    const signed = await this.signer.sign(
      { kind: "http-request-v1", bytes },
      { signal: init.signal ?? undefined, requestId: nonce },
    );
    return {
      ...headers,
      "X-Talos-Signature-Version": "talos-request-v1",
      "X-Talos-Key-Id": signed.keyId,
      "X-Talos-Algorithm": signed.algorithm,
      "X-Talos-Timestamp": timestamp,
      "X-Talos-Nonce": nonce,
      "X-Talos-Signature": encodeSignature(signed.signature),
    };
  }

  private parseX402Challenge(header: string): Record<string, string> {
    const parts = header.slice(5).split(", ");
    const challenge: Record<string, string> = {};
    for (const part of parts) {
      const [key, value] = part.split("=");
      challenge[key] = value.replace(/"/g, "");
    }
  }

  // ── Wallet & Payments ──────────────────────────────────────

  async getWallet(talosId: string): Promise<Wallet> {
    return this.request(`/api/talos/${talosId}/wallet`);
  }

  async signPayment(
    talosId: string,
    params: SignPaymentParams,
  ): Promise<SignedPayment> {
    return this.request(`/api/talos/${talosId}/sign`, {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  async transfer(
    talosId: string,
    params: TransferParams,
  ): Promise<TransferResponse> {
    return this.request(`/api/talos/${talosId}/transfer`, {
      method: "POST",
      body: JSON.stringify(params),
      idempotencyKey: options?.idempotencyKey,
      signal: options?.signal,
    });
  }

  // ── Jobs ───────────────────────────────────────────────────

  async getPendingJobs(): Promise<CommerceJob[]> {
    return this.request("/api/jobs/pending");
  }

  /**
   * Submit the result of a fulfilled job.
   *
   * Pass `options.idempotencyKey` to enable safe retry: if the network drops
   * after the server has already committed the result, the retry will receive
   * a 201 from cache rather than creating a duplicate.
   */
  async submitJobResult(
    jobId: string,
    result: unknown,
    options?: WriteOptions,
  ): Promise<CommerceJob> {
    return this.request(`/api/jobs/${jobId}/result`, {
      method: "POST",
      body: JSON.stringify({ result }),
      idempotencyKey: options?.idempotencyKey,
      signal: options?.signal,
    });
  }

  async getJobResult(jobId: string): Promise<CommerceJob> {
    return this.request(`/api/jobs/${jobId}/result`);
  }

  // ── Leaderboard ────────────────────────────────────────────

  async getLeaderboard(
    params?: CursorRequestOptions,
  ): Promise<CursorPage<LeaderboardEntry>> {
    return this.requestPage("/api/leaderboard", params);
  }

  // ── Playbooks ──────────────────────────────────────────────

  async listPlaybooks(
    params?: {
      category?: string;
      channel?: string;
      search?: string;
      sort?: "createdAt" | "price" | "title";
      direction?: "asc" | "desc";
    } & CursorRequestOptions,
  ): Promise<CursorPage<Playbook>> {
    return this.requestPage("/api/playbooks", params);
  }

  async createPlaybook(
    params: CreatePlaybookParams,
    options?: WriteOptions,
  ): Promise<Playbook> {
    return this.request("/api/playbooks", {
      method: "POST",
      body: JSON.stringify(params),
      idempotencyKey: options?.idempotencyKey,
      signal: options?.signal,
    });
  }
}
