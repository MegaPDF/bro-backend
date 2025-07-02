import { CoturnServerInfo } from './call';

export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  code?: string;
  timestamp: Date;
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface SearchQuery extends PaginationQuery {
  q?: string;
  filters?: Record<string, any>;
}

export interface PaginationResponse {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface ListResponse<T> extends PaginationResponse {
  data: T[];
}

// Authentication Headers
export interface AuthHeaders {
  authorization: string;
  'x-device-id': string;
  'x-app-version': string;
  'x-platform': string;
}

// API Error Types
export interface APIError {
  code: string;
  message: string;
  details?: any;
  field?: string;
}

export interface ValidationError extends APIError {
  field: string;
  value: any;
}

// Bulk Operations
export interface BulkOperation<T> {
  action: 'create' | 'update' | 'delete';
  data: T[];
}

export interface BulkResponse<T> {
  success: T[];
  failed: Array<{
    data: T;
    error: APIError;
  }>;
  total: number;
  successCount: number;
  failedCount: number;
}

// File Upload Types
export interface FileUploadResponse {
  url: string;
  filename: string;
  size: number;
  mimeType: string;
  mediaId: string;
}

// Health Check
export interface HealthCheckResponse {
  status: 'healthy' | 'unhealthy';
  timestamp: Date;
  uptime: number;
  version: string;
  services: {
    database: 'healthy' | 'unhealthy';
    redis: 'healthy' | 'unhealthy';
    s3: 'healthy' | 'unhealthy';
    socket: 'healthy' | 'unhealthy';
  };
}

// Rate Limiting
export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: Date;
  retryAfter?: number;
}

// Analytics Types
export interface AnalyticsQuery {
  startDate: Date;
  endDate: Date;
  granularity: 'hour' | 'day' | 'week' | 'month';
  metrics: string[];
  dimensions?: string[];
  filters?: Record<string, any>;
}

export interface AnalyticsResponse {
  data: Array<{
    timestamp: Date;
    metrics: Record<string, number>;
    dimensions?: Record<string, string>;
  }>;
  summary: {
    total: Record<string, number>;
    average: Record<string, number>;
    change: Record<string, number>;
  };
}

// Export all types for easy importing
export * from './user';
export * from './auth';
export * from './chat';
export * from './message';
export * from './group';
export * from './call';
export * from './status';
export * from './media';
export * from './notification';
export * from './admin';
export * from './settings';
export * from './socket';

// Common utility types
export type ID = string;
export type Timestamp = Date;
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;

// Database operation types
export type CreateInput<T> = Omit<T, '_id' | 'createdAt' | 'updatedAt'>;
export type UpdateInput<T> = Partial<Omit<T, '_id' | 'createdAt' | 'updatedAt'>>;

// Filter types for database queries
export interface DateFilter {
  $gte?: Date;
  $lte?: Date;
  $gt?: Date;
  $lt?: Date;
}

export interface StringFilter {
  $regex?: string;
  $options?: string;
  $in?: string[];
  $nin?: string[];
}

export interface NumberFilter {
  $gte?: number;
  $lte?: number;
  $gt?: number;
  $lt?: number;
  $in?: number[];
  $nin?: number[];
}

export interface BooleanFilter {
  $eq?: boolean;
  $ne?: boolean;
}

// Generic filter type
export type FilterQuery<T> = {
  [K in keyof T]?: T[K] extends string
    ? string | StringFilter
    : T[K] extends number
    ? number | NumberFilter
    : T[K] extends boolean
    ? boolean | BooleanFilter
    : T[K] extends Date
    ? Date | DateFilter
    : any;
};

// Socket room types
export type SocketRoom = `user:${string}` | `chat:${string}` | `call:${string}` | `admin:${string}`;

// Event types for real-time updates
export interface RealtimeEvent<T = any> {
  type: string;
  data: T;
  timestamp: Date;
  userId?: string;
  chatId?: string;
}

// Webhook types
export interface WebhookEvent {
  id: string;
  type: string;
  data: any;
  timestamp: Date;
  signature: string;
}

// Configuration types
export interface AppConfig {
  database: {
    url: string;
    name: string;
  };
  redis: {
    url: string;
  };
  aws: {
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    s3Bucket: string;
  };
  coturn: {
    servers: CoturnServerInfo[];
  };
  jwt: {
    secret: string;
    expiresIn: string;
  };
  socket: {
    port: number;
    corsOrigin: string;
  };
}

// Feature flags
export interface FeatureFlags {
  voiceCalls: boolean;
  videoCalls: boolean;
  groupCalls: boolean;
  statusUpdates: boolean;
  disappearingMessages: boolean;
  messageReactions: boolean;
  messageEditing: boolean;
  fileSharing: boolean;
  locationSharing: boolean;
  contactSharing: boolean;
  endToEndEncryption: boolean;
  twoFactorAuth: boolean;
  businessFeatures: boolean;
  broadcastLists: boolean;
}

export default APIResponse;