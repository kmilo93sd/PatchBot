// =============================================================================
// ERROR HANDLER - PR RECEPTOR
// =============================================================================

import { 
  BaseError,
  ValidationError,
  AuthenticationError,
  ExternalServiceError,
  ProcessingError,
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

    // Errores de timeout
    if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
      return {
        ...baseDetails,
        code: 'TIMEOUT_ERROR',
        statusCode: HTTP_STATUS.GATEWAY_TIMEOUT
      };
    }

    // Errores de red
    if (errorMessage.includes('network') || errorMessage.includes('connection')) {
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

      case 'ConditionalCheckFailedException':
        return {
          ...baseDetails,
          code: 'CONDITIONAL_CHECK_FAILED',
          statusCode: HTTP_STATUS.CONFLICT
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

  static createErrorContext(
    requestId?: string,
    functionName?: string,
    additionalContext?: Record<string, any>
  ): Record<string, any> {
    return {
      requestId,
      functionName,
      timestamp: new Date().toISOString(),
      ...additionalContext
    };
  }

  // =============================================================================
  // FACTORY DE ERRORES
  // =============================================================================

  static createValidationError(message: string, details?: any): ValidationError {
    return new ValidationError(message, details);
  }

  static createAuthenticationError(message: string, details?: any): AuthenticationError {
    return new AuthenticationError(message, details);
  }

  static createExternalServiceError(service: string, message: string, details?: any): ExternalServiceError {
    return new ExternalServiceError(service, message, details);
  }

  static createProcessingError(message: string, details?: any): ProcessingError {
    return new ProcessingError(message, details);
  }
}