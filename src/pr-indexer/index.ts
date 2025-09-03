// =============================================================================
// PR INDEXER LAMBDA - Entry Point
// =============================================================================
// Lambda que recibe webhooks de GitHub, clona el repo, ejecuta indexer,
// sube resultados a S3 y envía mensaje a cola para PR Processor
// =============================================================================

import { SQSEvent, SQSRecord, Context, SQSBatchResponse } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics } from '@aws-lambda-powertools/metrics';

const logger = new Logger();
const metrics = new Metrics();

import { PRIndexProcessor } from './core/prIndexProcessor.js';
import { ValidationError, ProcessingError } from './shared/types/errors.js';
import { validators } from './shared/validation/schemas.js';

import type { LambdaConfig } from './shared/types/index.js';

// =============================================================================
// CONFIGURACIÓN
// =============================================================================

const config: LambdaConfig = {
  logger: logger,
  metrics: metrics,
  context: {} as Context
};

const processor = new PRIndexProcessor(config);

// =============================================================================
// HANDLER PRINCIPAL
// =============================================================================

export const handler = async (
  event: SQSEvent, 
  context: Context
): Promise<SQSBatchResponse> => {
  
  // Configurar contexto
  config.context = context;
  logger.addContext(context);
  
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  
  logger.info('PR Indexer Lambda initiated', {
    requestId: context.awsRequestId,
    recordCount: event.Records.length
  });

  // Procesar cada mensaje de la cola
  for (const record of event.Records) {
    const startTime = Date.now();
    
    try {
      // Parsear el mensaje de SQS
      const message = JSON.parse(record.body);
      
      logger.info('Processing SQS message', {
        messageId: record.messageId,
        payload: message
      });

      // Validar payload
      const validation = validators.prProcessMessage.safeParse(message);
      if (!validation.success) {
        throw new ValidationError('Invalid PR process message', {
          errors: validation.error.errors.map(err => ({
            path: err.path.join('.'),
            message: err.message,
          })),
        });
      }

      // Procesar el PR
      const result = await processor.processPullRequest({
        action: message.payload.action,
        repository: message.payload.repository,
        prNumber: message.payload.prNumber
      });

      // Métricas de éxito
      const processingTime = Date.now() - startTime;
      metrics.addMetric('ProcessingTime', 'Milliseconds', processingTime);
      metrics.addMetric('PRIndexed', 'Count', 1);

      logger.info('PR indexing completed successfully', {
        messageId: record.messageId,
        repository: message.payload.repository,
        prNumber: message.payload.prNumber,
        processingTime,
        indexedFiles: result.indexedFiles,
        s3Keys: result.s3Keys
      });

    } catch (error) {
      const processingTime = Date.now() - startTime;
      metrics.addMetric('ProcessingTime', 'Milliseconds', processingTime);
      metrics.addMetric('PRIndexingError', 'Count', 1);

      logger.error('Error processing SQS message', {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });

      // Agregar a la lista de fallos para retry
      batchItemFailures.push({
        itemIdentifier: record.messageId
      });
    }
  }

  // Retornar mensajes fallidos para retry
  return {
    batchItemFailures
  };
};

