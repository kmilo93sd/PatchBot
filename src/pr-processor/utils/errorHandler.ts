// =============================================================================
// ERROR HANDLER - PR PROCESSOR
// =============================================================================

import { 
  BaseError,
  ValidationError,
  ProcessingError,
  ExternalServiceError,
  TimeoutError,
  type ErrorDetails
} from '@shared/types/errors.js';

import { HTTP_STATUS } from '@shared/constants/index.js';
import { sanitizeLogData } from '@shared/utils/index.js';

// =============================================================================
// ERROR HANDLER CLASS
// =============================================================================

export class ErrorHandler {
  
  // =============================================================================
  // HANDLER PRINCIPAL
  // =============================================================================

  static handle(error: Error, context?: Record<string, any>): ErrorDetails {
    const baseDetails = {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...context
    };

    // Si es un BaseError (nuestros errores customizados)
    if (this.isBaseError(error)) {
      return {
        ...baseDetails,
        code: error.code,
        statusCode: error.statusCode,
        context: {
          ...error.context,
          ...context
        }
      };
    }

    // Mapear errores conocidos de librerías externas
    return this.mapExternalError(error, baseDetails);
  }

  // =============================================================================
  // MAPEO DE ERRORES EXTERNOS
  // =============================================================================

  private static mapExternalError(error: Error, baseDetails: any): ErrorDetails {
    const errorName = error.name.toLowerCase();
    const errorMessage = error.message.toLowerCase();

    // Errores de AWS SDK
    if (this.isAWSError(error)) {
      return this.handleAWSError(error, baseDetails);
    }

    // Errores de GitHub API
    if (this.isGitHubError(error)) {
      return this.handleGitHubError(error, baseDetails);
    }

    // Errores de timeout
    if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
      return {
        ...baseDetails,
        code: 'TIMEOUT_ERROR',
        statusCode: HTTP_STATUS.GATEWAY_TIMEOUT
      };
    }

    // Errores de red
    if (errorMessage.includes('network') || errorMessage.includes('connection') || 
        errorMessage.includes('econnreset') || errorMessage.includes('enotfound')) {
      return {
        ...baseDetails,
        code: 'NETWORK_ERROR',
        statusCode: HTTP_STATUS.BAD_GATEWAY
      };
    }

    // Errores de JSON
    if (errorName === 'syntaxerror' && errorMessage.includes('json')) {
      return {
        ...baseDetails,
        code: 'JSON_PARSE_ERROR',
        statusCode: HTTP_STATUS.BAD_REQUEST
      };
    }

    // Errores de memoria/recursos
    if (errorMessage.includes('out of memory') || errorMessage.includes('heap')) {
      return {
        ...baseDetails,
        code: 'RESOURCE_EXHAUSTED',
        statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE
      };
    }

    // Error genérico
    return {
      ...baseDetails,
      code: 'INTERNAL_ERROR',
      statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR
    };
  }

  // =============================================================================
  // MANEJO DE ERRORES AWS
  // =============================================================================

  private static handleAWSError(error: any, baseDetails: any): ErrorDetails {
    const awsErrorCode = error.Code || error.$metadata?.errorCode || error.name;

    switch (awsErrorCode) {
      case 'ResourceNotFoundException':
        return {
          ...baseDetails,
          code: 'RESOURCE_NOT_FOUND',
          statusCode: HTTP_STATUS.NOT_FOUND
        };

      case 'ValidationException':
        return {
          ...baseDetails,
          code: 'AWS_VALIDATION_ERROR',
          statusCode: HTTP_STATUS.BAD_REQUEST
        };

      case 'AccessDeniedException':
      case 'UnauthorizedOperation':
        return {
          ...baseDetails,
          code: 'ACCESS_DENIED',
          statusCode: HTTP_STATUS.FORBIDDEN
        };

      case 'ThrottlingException':
      case 'RequestLimitExceeded':
        return {
          ...baseDetails,
          code: 'THROTTLING_ERROR',
          statusCode: HTTP_STATUS.TOO_MANY_REQUESTS
        };

      case 'ServiceUnavailableException':
        return {
          ...baseDetails,
          code: 'SERVICE_UNAVAILABLE',
          statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE
        };

      case 'ModelTimeoutException':
      case 'ModelNotReadyException':
        return {
          ...baseDetails,
          code: 'MODEL_TIMEOUT',
          statusCode: HTTP_STATUS.GATEWAY_TIMEOUT
        };

      case 'ModelErrorException':
        return {
          ...baseDetails,
          code: 'MODEL_ERROR',
          statusCode: HTTP_STATUS.BAD_GATEWAY
        };

      default:
        return {
          ...baseDetails,
          code: 'AWS_ERROR',
          statusCode: HTTP_STATUS.BAD_GATEWAY,
          context: {
            awsErrorCode,
            ...baseDetails.context
          }
        };
    }
  }

  // =============================================================================
  // MANEJO DE ERRORES GITHUB
  // =============================================================================

  private static handleGitHubError(error: any, baseDetails: any): ErrorDetails {
    const status = error.status || error.response?.status;

    switch (status) {
      case 401:
        return {
          ...baseDetails,
          code: 'GITHUB_AUTH_ERROR',
          statusCode: HTTP_STATUS.UNAUTHORIZED
        };

      case 403:
        if (error.message?.includes('rate limit')) {
          return {
            ...baseDetails,
            code: 'GITHUB_RATE_LIMIT',
            statusCode: HTTP_STATUS.TOO_MANY_REQUESTS
          };
        }
        return {
          ...baseDetails,
          code: 'GITHUB_FORBIDDEN',
          statusCode: HTTP_STATUS.FORBIDDEN
        };

      case 404:
        return {
          ...baseDetails,
          code: 'GITHUB_NOT_FOUND',
          statusCode: HTTP_STATUS.NOT_FOUND
        };

      case 422:
        return {
          ...baseDetails,
          code: 'GITHUB_VALIDATION_ERROR',
          statusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
        };

      default:
        return {
          ...baseDetails,
          code: 'GITHUB_API_ERROR',
          statusCode: HTTP_STATUS.BAD_GATEWAY,
          context: {
            githubStatus: status,
            ...baseDetails.context
          }
        };
    }
  }

  // =============================================================================
  // UTILIDADES DE VALIDACIÓN
  // =============================================================================

  private static isBaseError(error: Error): error is BaseError {
    return 'statusCode' in error && 'code' in error;
  }

  private static isAWSError(error: any): boolean {
    return error.$metadata || 
           error.Code || 
           error.name?.includes('Exception') ||
           error.constructor?.name?.includes('Error');
  }

  private static isGitHubError(error: any): boolean {
    return error.status !== undefined || 
           error.response?.status !== undefined ||
           error.name === 'HttpError' ||
           error.constructor?.name === 'RequestError';
  }

  // =============================================================================
  // UTILIDADES DE PROCESAMIENTO
  // =============================================================================

  static shouldRetry(error: Error): boolean {
    if (this.isBaseError(error)) {
      const baseError = error as BaseError;
      // Retry en errores temporales
      return baseError.statusCode >= 500 || 
             baseError.code === 'TIMEOUT_ERROR' ||
             baseError.code === 'THROTTLING_ERROR' ||
             baseError.code === 'NETWORK_ERROR';
    }

    // Retry en errores de red o timeout
    const message = error.message.toLowerCase();
    return message.includes('timeout') ||
           message.includes('network') ||
           message.includes('connection') ||
           message.includes('econnreset');
  }

  static getRetryDelay(retryCount: number): number {
    // Exponential backoff: 2s, 4s, 8s, 16s, max 60s
    const baseDelay = 2000;
    const maxDelay = 60000;
    const delay = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
    
    // Add jitter
    return delay + Math.random() * 1000;
  }

  // =============================================================================
  // UTILIDADES DE LOG
  // =============================================================================

  static sanitizeErrorForLogging(error: Error, context?: Record<string, any>): any {
    const errorData = {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...context
    };

    return sanitizeLogData(errorData);
  }

  static createProcessingErrorContext(
    jobId?: string,
    messageId?: string,
    additionalContext?: Record<string, any>
  ): Record<string, any> {
    return {
      jobId,
      messageId,
      timestamp: new Date().toISOString(),
      ...additionalContext
    };
  }

  // =============================================================================
  // FACTORY DE ERRORES
  // =============================================================================

  static createProcessingError(message: string, details?: any): ProcessingError {
    return new ProcessingError(message, details);
  }

  static createTimeoutError(operation: string, timeoutMs: number, details?: any): TimeoutError {
    return new TimeoutError(operation, timeoutMs, details);
  }

  static createExternalServiceError(service: string, message: string, details?: any): ExternalServiceError {
    return new ExternalServiceError(service, message, details);
  }
}