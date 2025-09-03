// =============================================================================
// CONSTANTES - PR REVISOR
// =============================================================================

// =============================================================================
// CONFIGURACIÓN AWS
// =============================================================================

export const AWS_CONFIG = {
  REGION: process.env.AWS_REGION || 'us-east-1',
  REVIEW_JOBS_TABLE: process.env.REVIEW_JOBS_TABLE || '',
  PR_INDEX_QUEUE_URL: process.env.PR_INDEX_QUEUE_URL || '',
  REQUEST_ID_HEADER: process.env.REQUEST_ID_HEADER || 'x-request-id',
} as const;

// =============================================================================
// CONFIGURACIÓN DE LOGGING
// =============================================================================

export const LOGGING_CONFIG = {
  LEVEL: process.env.LOG_LEVEL || 'info',
  FORMAT: process.env.LOG_FORMAT || 'json',
  SAMPLE_RATE: parseFloat(process.env.LOG_SAMPLE_RATE || '1.0'),
  ENABLE_REQUEST_LOGGING: process.env.ENABLE_REQUEST_LOGGING === 'true',
} as const;

// =============================================================================
// CONFIGURACIÓN DE POWERTOOLS
// =============================================================================

export const POWERTOOLS_CONFIG = {
  SERVICE_NAME: process.env.POWERTOOLS_SERVICE_NAME || 'pr-revisor',
  METRICS_NAMESPACE: process.env.POWERTOOLS_METRICS_NAMESPACE || 'PRRevisor',
} as const;

// =============================================================================
// CONFIGURACIÓN DE NEW RELIC
// =============================================================================

export const NEW_RELIC_CONFIG = {
  ACCOUNT_ID: process.env.NEW_RELIC_ACCOUNT_ID || '',
  TRUSTED_ACCOUNT_KEY: process.env.NEW_RELIC_TRUSTED_ACCOUNT_KEY || '',
  LAMBDA_HANDLER: process.env.NEW_RELIC_LAMBDA_HANDLER || '',
  SEND_FUNCTION_LOGS: process.env.NEW_RELIC_EXTENSION_SEND_FUNCTION_LOGS === 'true',
  LOG_LEVEL: process.env.NEW_RELIC_EXTENSION_LOG_LEVEL || 'INFO',
  SERVERLESS_MODE: process.env.NEW_RELIC_SERVERLESS_MODE_ENABLED === 'true',
} as const;

// =============================================================================
// TIMEOUTS Y LÍMITES
// =============================================================================

export const TIMEOUTS = {
  RECEPTOR_LAMBDA: 180000, // 3 minutos
  PROCESSOR_LAMBDA: 900000, // 15 minutos
  WEBHOOK_RESPONSE: 3000, // 3 segundos máximo
  GITHUB_API_REQUEST: 30000, // 30 segundos
  BEDROCK_REQUEST: 300000, // 5 minutos
  DYNAMODB_REQUEST: 10000, // 10 segundos
  SQS_REQUEST: 30000, // 30 segundos
} as const;

export const LIMITS = {
  MAX_RETRY_COUNT: 3,
  MAX_FILES_TO_ANALYZE: 50,
  MAX_FILE_SIZE_MB: 10,
  MAX_PR_CHANGES: 500,
  SQS_BATCH_SIZE: 1,
  SQS_VISIBILITY_TIMEOUT: 900, // 15 minutos
  DYNAMODB_TTL_DAYS: 90,
} as const;

// =============================================================================
// ESTADOS Y ACCIONES
// =============================================================================

export const JOB_STATUSES = {
  QUEUED: 'queued',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export const GITHUB_ACTIONS = {
  OPENED: 'opened',
  CLOSED: 'closed',
  REOPENED: 'reopened',
  EDITED: 'edited',
  SYNCHRONIZE: 'synchronize',
  READY_FOR_REVIEW: 'ready_for_review',
  DRAFT: 'draft',
} as const;

export const REVIEWABLE_ACTIONS = [
  GITHUB_ACTIONS.OPENED,
  GITHUB_ACTIONS.SYNCHRONIZE,
  GITHUB_ACTIONS.READY_FOR_REVIEW,
] as const;

// =============================================================================
// MÉTRICAS
// =============================================================================

export const METRICS = {
  // Contadores
  REQUEST_SUCCESS: 'RequestSuccess',
  REQUEST_ERROR: 'RequestError',
  JOB_CREATED: 'JobCreated',
  JOB_COMPLETED: 'JobCompleted',
  JOB_FAILED: 'JobFailed',
  GITHUB_API_CALL: 'GitHubAPICall',
  BEDROCK_API_CALL: 'BedrockAPICall',
  
  // Tiempos
  PROCESSING_TIME: 'ProcessingTime',
  GITHUB_API_RESPONSE_TIME: 'GitHubAPIResponseTime',
  BEDROCK_RESPONSE_TIME: 'BedrockResponseTime',
  DYNAMODB_RESPONSE_TIME: 'DynamoDBResponseTime',
  
  // Tamaños
  PR_FILES_COUNT: 'PRFilesCount',
  PR_CHANGES_COUNT: 'PRChangesCount',
  ANALYSIS_SIZE: 'AnalysisSize',
} as const;

export const METRIC_UNITS = {
  COUNT: 'Count',
  MILLISECONDS: 'Milliseconds',
  BYTES: 'Bytes',
  PERCENT: 'Percent',
} as const;

// =============================================================================
// HEADERS HTTP
// =============================================================================

export const HTTP_HEADERS = {
  CONTENT_TYPE: 'Content-Type',
  AUTHORIZATION: 'Authorization',
  USER_AGENT: 'User-Agent',
  X_REQUEST_ID: 'X-Request-ID',
  X_GITHUB_EVENT: 'X-GitHub-Event',
  X_GITHUB_DELIVERY: 'X-GitHub-Delivery',
  X_HUB_SIGNATURE_256: 'X-Hub-Signature-256',
} as const;

export const CONTENT_TYPES = {
  JSON: 'application/json',
  TEXT: 'text/plain',
  HTML: 'text/html',
} as const;

// =============================================================================
// CÓDIGOS DE ESTADO HTTP
// =============================================================================

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
} as const;

// =============================================================================
// PATRONES DE VALIDACIÓN
// =============================================================================

export const VALIDATION_PATTERNS = {
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  GITHUB_REPO: /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/,
  SHA: /^[a-f0-9]{40}$/,
  PR_NUMBER: /^\d+$/,
  REQUEST_ID: /^[a-zA-Z0-9-_]+$/,
} as const;

// =============================================================================
// ANÁLISIS IA
// =============================================================================

export const AI_CONFIG = {
  MODEL_ID: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
  MAX_TOKENS: 4000,
  TEMPERATURE: 0.1,
  TOP_P: 0.9,
} as const;

export const ANALYSIS_TYPES = {
  SECURITY: 'security',
  PERFORMANCE: 'performance',
  MAINTAINABILITY: 'maintainability',
  BUG: 'bug',
  STYLE: 'style',
} as const;

export const SEVERITY_LEVELS = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
} as const;

export const RISK_LEVELS = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
} as const;

// =============================================================================
// ARCHIVOS Y EXTENSIONES
// =============================================================================

export const SUPPORTED_FILE_EXTENSIONS = [
  '.js', '.jsx', '.ts', '.tsx',
  '.py', '.java', '.cs',
  '.json', '.yaml', '.yml',
  '.md', '.txt',
  '.sql', '.sh',
] as const;

export const IGNORED_FILES = [
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'node_modules/',
  '.git/',
  'dist/',
  'build/',
  'coverage/',
  '.aws-sam/',
] as const;

// =============================================================================
// MENSAJES ESTÁNDAR
// =============================================================================

export const MESSAGES = {
  JOB_CREATED: 'PR review job created successfully',
  JOB_PROCESSING: 'Job is being processed',
  JOB_COMPLETED: 'Job completed successfully',
  JOB_FAILED: 'Job processing failed',
  INVALID_REQUEST: 'Invalid request format',
  WEBHOOK_RECEIVED: 'PR Webhook received',
  NOT_PR_EVENT: 'Not a pull request event',
  UNSUPPORTED_ACTION: 'Unsupported GitHub action',
} as const;

// =============================================================================
// CONFIGURACIÓN DE ENTORNOS
// =============================================================================

export const ENVIRONMENTS = {
  INTERNAL: 'internal',
  DEVELOPMENT: 'development',
  STAGING: 'staging',
  PRODUCTION: 'production',
} as const;

export const ENVIRONMENT = process.env.NODE_ENV || ENVIRONMENTS.INTERNAL;

export const IS_PRODUCTION = ENVIRONMENT === ENVIRONMENTS.PRODUCTION;
export const IS_DEVELOPMENT = ENVIRONMENT === ENVIRONMENTS.DEVELOPMENT;
export const IS_INTERNAL = ENVIRONMENT === ENVIRONMENTS.INTERNAL;

// =============================================================================
// TTL CALCULATION
// =============================================================================

export const calculateTTL = (days: number = LIMITS.DYNAMODB_TTL_DAYS): number => {
  return Math.floor(Date.now() / 1000) + (days * 24 * 60 * 60);
};