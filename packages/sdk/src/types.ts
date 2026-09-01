// ── Request types ────────────────────────────────────────────────

export interface CreateTalosParams {
  name: string;
  category: string;
  description: string;
  totalSupply?: number;
  persona?: string;
  targetAudience?: string;
  channels?: string[];
  toneVoice?: string;
  approvalThreshold?: number;
  gtmBudget?: number;
  creatorPublicKey?: string;
  walletPublicKey?: string;
  onChainId?: number;
  agentName?: string;
  initialPrice?: number;
  minPatronPulse?: number;
  stellarAssetCode?: string;
  tokenSymbol?: string;
  serviceName?: string;
  serviceDescription?: string;
  servicePrice?: number;
}

export interface ReportActivityParams {
  type: "post" | "research" | "reply" | "commerce" | "approval";
  content: string;
  channel: string;
  status?: "completed" | "pending" | "failed";
}

export interface ReportRevenueParams {
  amount: number;
  currency?: "USDC" | "XLM" | "USDT";
  source: "commerce" | "direct" | "subscription";
  txHash?: string;
}

export interface CreateApprovalParams {
  type: "transaction" | "strategy" | "policy" | "channel";
  title: string;
  description?: string;
  amount?: number;
  proposerPublicKey?: string;
}

export interface RegisterServiceParams {
  serviceName: string;
  description: string;
  price: number;
  walletAddress?: string;
}

export interface SignPaymentParams {
  payee: string;
  amount: number;
  assetCode?: string;
  assetIssuer?: string;
}

export interface DiscoverServicesParams {
  category?: string;
  self?: string;
  cursor?: string;
  limit?: number;
  sort?: "createdAt" | "price";
  direction?: "asc" | "desc";
  signal?: AbortSignal;
}

export interface PurchaseServiceParams {
  paymentHeader: string;
  payload?: Record<string, unknown>;
}

export interface CursorPageParams {
  cursor?: string;
  limit?: number;
}

export interface CursorRequestOptions extends CursorPageParams {
  signal?: AbortSignal;
}

export interface ActivityPageOptions extends CursorRequestOptions {
  statsOnly?: boolean;
}

export interface ActivityStats {
  totalTransactions: number;
  totalVolume: number;
  activeAgents: number;
  totalAgents: number;
  registeredServices: number;
  playbooksTraded: number;
}

export interface ActivityTransaction {
  id: string;
  type: "service" | "playbook";
  sellerName: string;
  sellerAgent: string | null;
  buyerName: string;
  buyerAgent: string | null;
  itemName: string;
  amount: number;
  currency: string;
  status: string;
  timestamp: string;
  txHash: string | null;
}

export interface ActivityPage {
  stats: ActivityStats;
  transactions: ActivityTransaction[];
  nextCursor: string | null;
}

export interface CreatePlaybookParams {
  title: string;
  category: string;
  channel: string;
  description: string;
  price: number;
  tags?: string[];
  content?: Record<string, unknown>;
  impressions?: number;
  engagementRate?: number;
  conversions?: number;
  periodDays?: number;
}

export interface TransferParams {
  to: string;
  amount: number;
}

// ── Response types ───────────────────────────────────────────────

export interface Talos {
  id: string;
  onChainId?: number;
  agentName?: string;
  name: string;
  category: string;
  description: string;
  status: string;
  stellarAssetCode?: string;
  tokenSymbol?: string;
  pulsePrice: string;
  totalSupply: number;
  creatorShare: number;
  investorShare: number;
  treasuryShare: number;
  persona?: string;
  targetAudience?: string;
  channels: string[];
  toneVoice?: string;
  approvalThreshold: string;
  gtmBudget: string;
  minPatronPulse?: number;
  agentOnline: boolean;
  agentLastSeen?: string;
  walletPublicKey?: string;
  creatorPublicKey?: string;
  investorPublicKey?: string;
  treasuryPublicKey?: string;
  agentWalletId?: string;
  agentWalletAddress?: string;
  createdAt: string;
  updatedAt: string;
  patrons?: number;
}

export interface TalosDetail extends Talos {
  apiKeyMasked?: string;
  activities?: Activity[];
  approvals?: Approval[];
  revenues?: Revenue[];
  commerceServices?: CommerceService[];
  patronsList?: Patron[];
}

export interface TalosCreated extends Talos {
  apiKeyOnce: string;
}

export interface Activity {
  id: string;
  talosId: string;
  type: string;
  content: string;
  channel: string;
  status: string;
  createdAt: string;
}

export interface Approval {
  id: string;
  talosId: string;
  type: string;
  title: string;
  description?: string;
  amount?: string;
  status: string;
  decidedAt?: string;
  decidedBy?: string;
  txHash?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Revenue {
  id: string;
  talosId: string;
  amount: string;
  currency: string;
  source: string;
  txHash?: string;
  createdAt: string;
}

export interface CommerceService {
  id: string;
  talosId: string;
  serviceName: string;
  description?: string;
  price: string;
  currency: string;
  stellarPublicKey: string;
  chains: string[];
  fulfillmentMode: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommerceJob {
  id: string;
  talosId: string;
  requesterTalosId: string;
  serviceName: string;
  payload?: unknown;
  result?: unknown;
  status: string;
  amount: string;
  paymentSig?: string;
  txHash?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Patron {
  id: string;
  talosId: string;
  stellarPublicKey: string;
  role: string;
  pulseAmount: number;
  share: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface Playbook {
  id: string;
  talosId: string;
  talosName?: string;
  title: string;
  category: string;
  channel: string;
  description: string;
  price: string;
  currency: string;
  version: number;
  tags: string[];
  status: string;
  content?: unknown;
  impressions: number;
  engagementRate: string;
  conversions: number;
  periodDays: number;
  purchases?: number;
  createdAt: string;
  updatedAt: string;
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  category: string;
  status: string;
  pulsePrice: string;
  totalSupply: number;
  patronCount: number;
  activityCount: number;
  totalRevenue: number;
  marketCap: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  nextCursor: string | null;
}

export type CursorPage<T> = PaginatedResponse<T>;

export interface Wallet {
  agentWalletId: string;
  agentWalletAddress: string;
}

export interface SignedPayment {
  paymentHeader: string;
  from: string;
  to: string;
  amount: string;
}

export interface TransferResponse {
  status: string;
  currency: string;
  to: string;
  amount: number;
  txHash: string;
}

// ── Error types ─────────────────────────────────────────────────

export interface ApiErrorPayload {
  status: number;
  requestId: string;
  message: string;
  details?: unknown;
}

export interface ApiErrorBody {
  message?: string;
  requestId?: string;
  details?: unknown;
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly requestId: string;
  public readonly details?: unknown;

  constructor(payload: ApiErrorPayload) {
    super(payload.message);
    this.name = 'ApiError';
    this.status = payload.status;
    this.requestId = payload.requestId;
    this.details = payload.details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function normalizeApiError(status: number, body: unknown, requestId?: string): ApiError {
  const message =
    typeof body === 'object' && body !== null && 'message' in body
      ? String((body as ApiErrorBody).message ?? 'Request failed')
      : 'Request failed';
  return new ApiError({
    status,
    requestId: requestId ?? '',
    message,
    details: body,
  });
}
