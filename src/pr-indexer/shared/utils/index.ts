// =============================================================================
// UTILIDADES COMPARTIDAS - PR REVISOR
// =============================================================================

import { APIGatewayProxyResult } from 'aws-lambda';
import { ErrorResponseBody, BaseError, ErrorDetails } from '../types/errors.js';
import { HTTP_STATUS, CONTENT_TYPES } from '../constants/index.js';

// =============================================================================
// RESPUESTAS HTTP
// =============================================================================

export function createSuccessResponse<T>(
  data: T,
  statusCode: number = HTTP_STATUS.OK,
  headers: Record<string, string> = {}
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      [CONTENT_TYPES.JSON]: CONTENT_TYPES.JSON,
      ...headers,
    },
    body: JSON.stringify(data),
  };
}

export function createErrorResponse(
  error: BaseError | Error,
  requestId?: string,
  additionalHeaders: Record<string, string> = {}
): APIGatewayProxyResult {
  const isBaseError = 'statusCode' in error && 'code' in error;
  
  const statusCode = isBaseError 
    ? (error as BaseError).statusCode 
    : HTTP_STATUS.INTERNAL_SERVER_ERROR;
    
  const code = isBaseError 
    ? (error as BaseError).code 
    : 'INTERNAL_ERROR';

  const errorBody: ErrorResponseBody = {
    error: {
      code,
      message: error.message,
      details: isBaseError ? (error as BaseError).context : undefined,
      timestamp: new Date().toISOString(),
      requestId,
    },
  };

  return {
    statusCode,
    headers: {
      'Content-Type': CONTENT_TYPES.JSON,
      ...(requestId && { 'X-Request-ID': requestId }),
      ...additionalHeaders,
    },
    body: JSON.stringify(errorBody),
  };
}

// =============================================================================
// VALIDACIONES
// =============================================================================

export function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

export function isValidGitHubRepo(repo: string): boolean {
  const repoRegex = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
  return repoRegex.test(repo);
}

export function isValidSHA(sha: string): boolean {
  const shaRegex = /^[a-f0-9]{40}$/;
  return shaRegex.test(sha);
}

export function isValidPRNumber(prNumber: string | number): boolean {
  const num = typeof prNumber === 'string' ? parseInt(prNumber, 10) : prNumber;
  return Number.isInteger(num) && num > 0;
}

// =============================================================================
// MANEJO DE FECHAS
// =============================================================================

export function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

export function getTimestampFromDate(date: Date): string {
  return date.toISOString();
}

export function parseTimestamp(timestamp: string): Date {
  return new Date(timestamp);
}

export function addDaysToDate(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function getUnixTimestamp(date?: Date): number {
  return Math.floor((date || new Date()).getTime() / 1000);
}

// =============================================================================
// MANEJO DE TTL
// =============================================================================

export function calculateTTL(days: number = 90): number {
  return getUnixTimestamp() + (days * 24 * 60 * 60);
}

// =============================================================================
// UTILIDADES DE STRING
// =============================================================================

export function sanitizeString(str: string): string {
  return str.trim().replace(/\s+/g, ' ');
}

export function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

export function toCamelCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, chr) => chr.toUpperCase());
}

export function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '');
}

// =============================================================================
// UTILIDADES DE OBJETO
// =============================================================================

export function removeUndefinedFields<T extends Record<string, any>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([_, value]) => value !== undefined)
  ) as T;
}

export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj.getTime()) as T;
  if (Array.isArray(obj)) return obj.map(item => deepClone(item)) as T;
  
  if (typeof obj === 'object' && obj !== null) {
    return Object.keys(obj as Record<string, any>).reduce((cloned, key) => {
      (cloned as any)[key] = deepClone((obj as any)[key]);
      return cloned;
    }, {} as T);
  }
  
  return obj;
}

export function pick<T extends Record<string, any>, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  return keys.reduce((result, key) => {
    if (key in obj) {
      result[key] = obj[key];
    }
    return result;
  }, {} as Pick<T, K>);
}

export function omit<T extends Record<string, any>, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const result = { ...obj };
  keys.forEach(key => delete result[key]);
  return result;
}

// =============================================================================
// UTILIDADES DE ARRAY
// =============================================================================

export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

export function unique<T>(array: T[]): T[] {
  return [...new Set(array)];
}

export function groupBy<T, K extends string | number | symbol>(
  array: T[],
  keyFn: (item: T) => K
): Record<K, T[]> {
  return array.reduce((groups, item) => {
    const key = keyFn(item);
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(item);
    return groups;
  }, {} as Record<K, T[]>);
}

// =============================================================================
// UTILIDADES DE RETRY
// =============================================================================

export interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter: boolean;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  jitter: true,
};

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const { 
    maxAttempts, 
    baseDelay, 
    maxDelay, 
    backoffMultiplier, 
    jitter 
  } = { ...DEFAULT_RETRY_CONFIG, ...config };

  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === maxAttempts) {
        throw lastError;
      }
      
      // Calcular delay con backoff exponencial
      let delay = Math.min(baseDelay * Math.pow(backoffMultiplier, attempt - 1), maxDelay);
      
      // Agregar jitter aleatorio
      if (jitter) {
        delay = delay * (0.5 + Math.random() * 0.5);
      }
      
      await sleep(delay);
    }
  }
  
  throw lastError!;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// UTILIDADES DE LOG
// =============================================================================

export function createLogContext(
  requestId?: string,
  correlationId?: string,
  additional: Record<string, any> = {}
): Record<string, any> {
  return removeUndefinedFields({
    requestId,
    correlationId,
    timestamp: getCurrentTimestamp(),
    ...additional,
  });
}

export function sanitizeLogData(data: any): any {
  if (typeof data !== 'object' || data === null) {
    return data;
  }

  const sensitiveFields = [
    'password', 'token', 'secret', 'key', 'authorization',
    'x-hub-signature-256', 'x-github-token'
  ];

  const sanitized = Array.isArray(data) ? [...data] : { ...data };

  for (const [key, value] of Object.entries(sanitized)) {
    const lowerKey = key.toLowerCase();
    
    if (sensitiveFields.some(field => lowerKey.includes(field))) {
      (sanitized as any)[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      (sanitized as any)[key] = sanitizeLogData(value);
    }
  }

  return sanitized;
}

// =============================================================================
// UTILIDADES DE HASH
// =============================================================================

export function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

// =============================================================================
// UTILIDADES DE ARCHIVO
// =============================================================================

export function getFileExtension(filename: string): string {
  return filename.toLowerCase().substring(filename.lastIndexOf('.'));
}

export function isTextFile(filename: string): boolean {
  const textExtensions = [
    '.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.cs', '.go',
    '.json', '.yaml', '.yml', '.xml', '.html', '.css', '.scss',
    '.md', '.txt', '.sql', '.sh', '.dockerfile'
  ];
  
  const ext = getFileExtension(filename);
  return textExtensions.includes(ext);
}

export function shouldIgnoreFile(filename: string): boolean {
  const ignoredPatterns = [
    'node_modules/',
    '.git/',
    'dist/',
    'build/',
    'coverage/',
    '.aws-sam/',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml'
  ];
  
  return ignoredPatterns.some(pattern => filename.includes(pattern));
}

// =============================================================================
// UTILIDADES DE MÉTRICA
// =============================================================================

export function formatMetricValue(value: number, decimals: number = 2): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

export function calculatePercentage(part: number, total: number): number {
  if (total === 0) return 0;
  return formatMetricValue((part / total) * 100);
}