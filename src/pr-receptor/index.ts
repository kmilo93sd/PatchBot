// =============================================================================
// PR RECEPTOR - HANDLER PRINCIPAL
// =============================================================================

import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics } from '@aws-lambda-powertools/metrics';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';

import { RequestHandler } from './core/requestHandler.js';
import { ErrorHandler } from './utils/errorHandler.js';
import { createErrorResponse } from './shared/utils/index.js';
import { POWERTOOLS_CONFIG } from './shared/constants/index.js';
import type { APIHandler } from './shared/types/index.js';

// =============================================================================
// CONFIGURACIÓN DE POWERTOOLS
// =============================================================================

const logger = new Logger({ serviceName: POWERTOOLS_CONFIG.SERVICE_NAME });
const metrics = new Metrics({ 
  namespace: POWERTOOLS_CONFIG.METRICS_NAMESPACE, 
  serviceName: 'pr-receptor' 
});

// =============================================================================
// HANDLER PRINCIPAL
// =============================================================================

export const handler: APIHandler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  const startTime = Date.now();
  
  // Agregar contexto de logging
  logger.addContext(context);
  logger.addPersistentLogAttributes({
    requestId: context.awsRequestId,
    functionName: context.functionName
  });

  try {
    logger.info('PR Webhook recibido', {
      httpMethod: event.httpMethod,
      path: event.path,
      headers: event.headers
    });

    // Crear handler de request
    const requestHandler = new RequestHandler({
      logger,
      metrics,
      context
    });

    // Procesar request
    const result = await requestHandler.handle(event);

    // Métricas de éxito
    const processingTime = Date.now() - startTime;
    metrics.addMetric('ProcessingTime', 'Milliseconds', processingTime);
    metrics.addMetric('RequestSuccess', 'Count', 1);

    logger.info('PR Webhook procesado exitosamente', {
      jobId: result.job_id,
      processingTime
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': context.awsRequestId
      },
      body: JSON.stringify(result)
    };

  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    // Métricas de error
    metrics.addMetric('ProcessingTime', 'Milliseconds', processingTime);
    metrics.addMetric('RequestError', 'Count', 1);
    metrics.addMetadata('errorType', error instanceof Error ? error.constructor.name : 'Unknown');

    // Manejar error
    const errorResponse = ErrorHandler.handle(error as Error, {
      requestId: context.awsRequestId,
      functionName: context.functionName,
      processingTime
    });

    logger.error('Error procesando PR Webhook', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      ...errorResponse
    });

    return createErrorResponse(
      error as Error,
      context.awsRequestId
    );

  } finally {
    // Publicar métricas
    metrics.publishStoredMetrics();
  }
};