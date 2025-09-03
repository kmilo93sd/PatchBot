// =============================================================================
// SQS ADAPTER - PR RECEPTOR
// =============================================================================

import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

import { SQSError } from '../shared/types/errors.js';
import { AWS_CONFIG } from '../shared/constants/index.js';
import { validators } from '../shared/validation/schemas.js';

import type { 
  ServiceConfig,
  SQSMessage,
  PRProcessMessage 
} from '../shared/types/index.js';

// =============================================================================
// SQS ADAPTER CLASS
// =============================================================================

export class SQSAdapter {
  private readonly logger: ServiceConfig['logger'];
  private readonly sqsClient: SQSClient;
  private readonly queueUrl: string;

  constructor(config: ServiceConfig) {
    this.logger = config.logger;
    this.queueUrl = AWS_CONFIG.PR_INDEX_QUEUE_URL;

    // Crear cliente SQS
    this.sqsClient = new SQSClient({
      region: AWS_CONFIG.REGION
    });

    this.validateConfiguration();
  }

  // =============================================================================
  // ENVIAR MENSAJE
  // =============================================================================

  async sendMessage<T extends SQSMessage>(message: T): Promise<void> {
    try {
      // Validar mensaje antes de enviar
      if (message.source === 'pr-receptor') {
        const validationResult = validators.prProcessMessage.safeParse(message);
        if (!validationResult.success) {
          throw new SQSError('Invalid message format', {
            errors: validationResult.error.errors.map(err => ({
              path: err.path.join('.'),
              message: err.message
            }))
          });
        }
      }

      this.logger.info('Enviando mensaje a SQS', {
        queueUrl: this.queueUrl,
        messageSource: message.source,
        requestId: message.requestId,
        correlationId: message.metadata.correlationId
      });

      const command = new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(message),
        MessageAttributes: {
          'source': {
            DataType: 'String',
            StringValue: message.source
          },
          'requestId': {
            DataType: 'String',
            StringValue: message.requestId
          },
          'correlationId': {
            DataType: 'String',
            StringValue: message.metadata.correlationId
          }
        },
        // Agregar delay si es retry
        DelaySeconds: this.calculateDelay(message.metadata.retryCount)
      });

      const result = await this.sqsClient.send(command);

      this.logger.info('Mensaje enviado exitosamente a SQS', {
        messageId: result.MessageId,
        requestId: message.requestId,
        queueUrl: this.queueUrl
      });

    } catch (error) {
      this.logger.error('Error enviando mensaje a SQS', {
        error: error instanceof Error ? error.message : 'Unknown error',
        queueUrl: this.queueUrl,
        requestId: message.requestId
      });

      throw new SQSError('Failed to send message to queue', {
        queueUrl: this.queueUrl,
        requestId: message.requestId,
        originalError: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // =============================================================================
  // UTILIDADES PRIVADAS
  // =============================================================================

  private calculateDelay(retryCount: number): number {
    // Exponential backoff: 0s, 2s, 4s, 8s, max 60s
    if (retryCount === 0) return 0;
    
    const baseDelay = 2;
    const maxDelay = 60;
    const delay = Math.min(baseDelay * Math.pow(2, retryCount - 1), maxDelay);
    
    return delay;
  }

  private validateConfiguration(): void {
    if (!this.queueUrl) {
      throw new SQSError('SQS queue URL not configured', {
        envVar: 'PR_PROCESS_QUEUE_URL'
      });
    }

    // Validar formato de URL de SQS
    if (!this.queueUrl.includes('sqs.') || !this.queueUrl.includes('.amazonaws.com')) {
      throw new SQSError('Invalid SQS queue URL format', {
        queueUrl: this.queueUrl
      });
    }
  }
}