// =============================================================================
// TIPOS DE ERRORES - PR REVISOR
// =============================================================================

// =============================================================================
// ERRORES BASE
// =============================================================================

export interface BaseError extends Error {
  statusCode: number;
  code: string;
  context?: Record<string, any>;
}

// =============================================================================
// ERRORES DE VALIDACIÓN
// =============================================================================

export class ValidationError extends Error implements BaseError {
  public readonly statusCode = 400;
  public readonly code = 'VALIDATION_ERROR';
  public context?: Record<string, any>;

  constructor(message: string, context?: Record<string, any>) {
    super(message);
    this.name = 'ValidationError';
    this.context = context;
  }
}

export class SchemaValidationError extends Error implements BaseError {
  public readonly statusCode = 400;
  public readonly code = 'SCHEMA_VALIDATION_ERROR';
  public context?: Record<string, any>;

  constructor(message: string, schemaErrors: string[]) {
    super(message);
    this.name = 'SchemaValidationError';
    this.context = { schemaErrors };
  }
}

// =============================================================================
// ERRORES DE AUTENTICACIÓN/AUTORIZACIÓN
// =============================================================================

export class AuthenticationError extends Error implements BaseError {
  public readonly statusCode = 401;
  public readonly code = 'AUTHENTICATION_ERROR';
  public context?: Record<string, any>;

  constructor(message: string, context?: Record<string, any>) {
    super(message);
    this.name = 'AuthenticationError';
    this.context = context;
  }
}

export class AuthorizationError extends Error implements BaseError {
  public readonly statusCode = 403;
  public readonly code = 'AUTHORIZATION_ERROR';
  public context?: Record<string, any>;

  constructor(message: string, context?: Record<string, any>) {
    super(message);
    this.name = 'AuthorizationError';
    this.context = context;
  }
}

// =============================================================================
// ERRORES DE RECURSO NO ENCONTRADO
// =============================================================================

export class NotFoundError extends Error implements BaseError {
  public readonly statusCode = 404;
  public readonly code = 'NOT_FOUND_ERROR';
  public context?: Record<string, any>;

  constructor(resource: string, identifier?: string) {
    const message = identifier 
      ? `${resource} with identifier ${identifier} not found`
      : `${resource} not found`;
    
    super(message);
    this.name = 'NotFoundError';
    this.context = { resource, identifier };
  }
}

// =============================================================================
// ERRORES DE CONFLICTO/ESTADO
// =============================================================================

export class ConflictError extends Error implements BaseError {
  public readonly statusCode = 409;
  public readonly code = 'CONFLICT_ERROR';
  public context?: Record<string, any>;

  constructor(message: string, context?: Record<string, any>) {
    super(message);
    this.name = 'ConflictError';
    this.context = context;
  }
}

export class InvalidStateError extends Error implements BaseError {
  public readonly statusCode = 400;
  public readonly code = 'INVALID_STATE_ERROR';
  public context?: Record<string, any>;

  constructor(currentState: string, expectedState: string, context?: Record<string, any>) {
    super(`Invalid state: expected ${expectedState}, got ${currentState}`);
    this.name = 'InvalidStateError';
    this.context = { currentState, expectedState, ...context };
  }
}

// =============================================================================
// ERRORES DE SERVICIO EXTERNO
// =============================================================================

export class ExternalServiceError extends Error implements BaseError {
  public readonly statusCode = 502;
  public readonly code = 'EXTERNAL_SERVICE_ERROR';
  public context?: Record<string, any>;

  constructor(service: string, message: string, context?: Record<string, any>) {
    super(`${service} error: ${message}`);
    this.name = 'ExternalServiceError';
    this.context = { service, ...context };
  }
}

export class GitHubAPIError extends Error implements BaseError {
  public readonly code = 'GITHUB_API_ERROR';
  public statusCode: number = 502;
  public context?: Record<string, any>;

  constructor(message: string, statusCode?: number, context?: Record<string, any>) {
    super(`GitHub API error: ${message}`);
    this.name = 'GitHubAPIError';
    this.context = { service: 'GitHub API', ...context };
    if (statusCode) {
      this.statusCode = statusCode;
    }
  }
}

export class DynamoDBError extends Error implements BaseError {
  public readonly statusCode = 502;
  public readonly code = 'DYNAMODB_ERROR';
  public context?: Record<string, any>;

  constructor(message: string, context?: Record<string, any>) {
    super(`DynamoDB error: ${message}`);
    this.name = 'DynamoDBError';
    this.context = { service: 'DynamoDB', ...context };
  }
}

export class SQSError extends Error implements BaseError {
  public readonly statusCode = 502;
  public readonly code = 'SQS_ERROR';
  public context?: Record<string, any>;

  constructor(message: string, context?: Record<string, any>) {
    super(`SQS error: ${message}`);
    this.name = 'SQSError';
    this.context = { service: 'SQS', ...context };
  }
}

export class BedrockError extends Error implements BaseError {
  public readonly statusCode = 502;
  public readonly code = 'BEDROCK_ERROR';
  public context?: Record<string, any>;

  constructor(message: string, context?: Record<string, any>) {
    super(`AWS Bedrock error: ${message}`);
    this.name = 'BedrockError';
    this.context = { service: 'AWS Bedrock', ...context };
  }
}

// =============================================================================
// ERRORES DE PROCESAMIENTO
// =============================================================================

export class ProcessingError extends Error implements BaseError {
  public readonly statusCode = 500;
  public readonly code = 'PROCESSING_ERROR';
  public context?: Record<string, any>;

  constructor(message: string, context?: Record<string, any>) {
    super(message);
    this.name = 'ProcessingError';
    this.context = context;
  }
}

export class TimeoutError extends Error implements BaseError {
  public readonly statusCode = 408;
  public readonly code = 'TIMEOUT_ERROR';
  public context?: Record<string, any>;

  constructor(operation: string, timeoutMs: number, context?: Record<string, any>) {
    super(`Operation ${operation} timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
    this.context = { operation, timeoutMs, ...context };
  }
}

export class RateLimitError extends Error implements BaseError {
  public readonly statusCode = 429;
  public readonly code = 'RATE_LIMIT_ERROR';
  public context?: Record<string, any>;

  constructor(service: string, resetTime?: Date, context?: Record<string, any>) {
    super(`Rate limit exceeded for ${service}`);
    this.name = 'RateLimitError';
    this.context = { service, resetTime: resetTime?.toISOString(), ...context };
  }
}

// =============================================================================
// UTILIDADES DE ERROR
// =============================================================================

export type ErrorConstructor = new (...args: any[]) => BaseError;

export interface ErrorContext {
  requestId?: string;
  functionName?: string;
  correlationId?: string;
  timestamp?: string;
  userId?: string;
  operation?: string;
  [key: string]: any;
}

export interface ErrorDetails {
  name: string;
  message: string;
  code: string;
  statusCode: number;
  context?: ErrorContext;
  stack?: string;
}

// =============================================================================
// RESPUESTAS DE ERROR ESTRUCTURADAS
// =============================================================================

export interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, any>;
    timestamp: string;
    requestId?: string;
  };
}

// =============================================================================
// MAPEO DE ERRORES
// =============================================================================

export const ERROR_STATUS_CODES = {
  ValidationError: 400,
  SchemaValidationError: 400,
  AuthenticationError: 401,
  AuthorizationError: 403,
  NotFoundError: 404,
  ConflictError: 409,
  InvalidStateError: 400,
  TimeoutError: 408,
  RateLimitError: 429,
  ExternalServiceError: 502,
  GitHubAPIError: 502,
  DynamoDBError: 502,
  SQSError: 502,
  BedrockError: 502,
  ProcessingError: 500,
} as const;

export type ErrorType = keyof typeof ERROR_STATUS_CODES;