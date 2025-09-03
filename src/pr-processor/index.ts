// =============================================================================
// PR PROCESSOR - HANDLER PRINCIPAL
// =============================================================================

import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics } from '@aws-lambda-powertools/metrics';
import { SQSEvent, SQSRecord, Context, SQSBatchResponse } from 'aws-lambda';

import { MessageProcessor } from './core/messageProcessor.js';
import { ErrorHandler } from './utils/errorHandler.js';
import { POWERTOOLS_CONFIG } from './shared/constants/index.js';

import type { LambdaHandler } from './shared/types/index.js';

// =============================================================================
// CONFIGURACIÓN DE POWERTOOLS
// =============================================================================

const logger = new Logger({ serviceName: POWERTOOLS_CONFIG.SERVICE_NAME });
const metrics = new Metrics({ 
  namespace: POWERTOOLS_CONFIG.METRICS_NAMESPACE, 
  serviceName: 'pr-processor' 
});

// =============================================================================
// HANDLER PRINCIPAL
// =============================================================================

export const handler: LambdaHandler<SQSEvent, SQSBatchResponse> = async (
  event: SQSEvent,
  context: Context
): Promise<SQSBatchResponse> => {
  const startTime = Date.now();
  
  // Agregar contexto de logging
  logger.addContext(context);
  logger.addPersistentLogAttributes({
    requestId: context.awsRequestId,
    functionName: context.functionName
  });

  logger.info('PR Processor iniciado', {
    recordCount: event.Records.length,
    records: event.Records.map(r => ({
      messageId: r.messageId,
      receiptHandle: r.receiptHandle?.substring(0, 20) + '...' // Truncar para logs
    }))
  });

  const messageProcessor = new MessageProcessor({
    logger,
    metrics,
    context
  });

  const batchItemFailures: string[] = [];

  // Procesar cada mensaje SQS
  for (const record of event.Records) {
    const messageStartTime = Date.now();
    
    try {
      logger.info('Procesando mensaje SQS', {
        messageId: record.messageId,
        source: record.eventSource
      });

      await messageProcessor.processMessage(record);

      // Métricas de éxito por mensaje
      const messageProcessingTime = Date.now() - messageStartTime;
      metrics.addMetric('MessageProcessingTime', 'Milliseconds', messageProcessingTime);
      metrics.addMetric('MessageSuccess', 'Count', 1);

      logger.info('Mensaje procesado exitosamente', {
        messageId: record.messageId,
        processingTime: messageProcessingTime
      });

    } catch (error) {
      const messageProcessingTime = Date.now() - messageStartTime;
      
      // Métricas de error por mensaje
      metrics.addMetric('MessageProcessingTime', 'Milliseconds', messageProcessingTime);
      metrics.addMetric('MessageError', 'Count', 1);
      metrics.addMetadata('errorType', error instanceof Error ? error.constructor.name : 'Unknown');

      // Manejar error
      const errorDetails = ErrorHandler.handle(error as Error, {
        messageId: record.messageId,
        requestId: context.awsRequestId,
        functionName: context.functionName,
        processingTime: messageProcessingTime
      });

      logger.error('Error procesando mensaje SQS', {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        ...errorDetails
      });

      // Agregar a batch failures para retry automático
      batchItemFailures.push(record.messageId);
    }
  }

  // Métricas globales
  const totalProcessingTime = Date.now() - startTime;
  metrics.addMetric('BatchProcessingTime', 'Milliseconds', totalProcessingTime);
  metrics.addMetric('BatchSize', 'Count', event.Records.length);
  metrics.addMetric('BatchFailures', 'Count', batchItemFailures.length);

  logger.info('PR Processor completado', {
    totalRecords: event.Records.length,
    successCount: event.Records.length - batchItemFailures.length,
    failureCount: batchItemFailures.length,
    totalProcessingTime
  });

  // Publicar métricas
  metrics.publishStoredMetrics();

  // Retornar batch response para SQS
  return {
    batchItemFailures: batchItemFailures.map(messageId => ({ itemIdentifier: messageId }))
  };
};