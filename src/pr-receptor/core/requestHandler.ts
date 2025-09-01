// =============================================================================
// REQUEST HANDLER - PR RECEPTOR
// =============================================================================

import { v4 as uuidv4 } from 'uuid';
import { APIGatewayProxyEvent } from 'aws-lambda';

import { WebhookValidator, ActionValidator } from '@shared/validation/validators.js';
import { JobManager } from './jobManager.js';
import { SQSAdapter } from '../adapters/sqsAdapter.js';
import { ValidationError } from '@shared/types/errors.js';
import { getCurrentTimestamp } from '@shared/utils/index.js';
import { MESSAGES } from '@shared/constants/index.js';

import type { 
  LambdaConfig, 
  PRReceptorResponse, 
  CreateJobRequestOutput,
  PRProcessMessage 
} from '@shared/types/index.js';

// =============================================================================
// REQUEST HANDLER CLASS
// =============================================================================

export class RequestHandler {
  private readonly logger: LambdaConfig['logger'];
  private readonly metrics: LambdaConfig['metrics'];
  private readonly context: LambdaConfig['context'];
  private readonly jobManager: JobManager;
  private readonly sqsAdapter: SQSAdapter;

  constructor(config: LambdaConfig) {
    this.logger = config.logger;
    this.metrics = config.metrics;
    this.context = config.context;
    
    this.jobManager = new JobManager({ 
      logger: this.logger 
    });
    
    this.sqsAdapter = new SQSAdapter({ 
      logger: this.logger 
    });
  }

  // =============================================================================
  // HANDLER PRINCIPAL
  // =============================================================================

  async handle(event: APIGatewayProxyEvent): Promise<PRReceptorResponse> {
    const requestId = this.context.awsRequestId;
    const timestamp = getCurrentTimestamp();

    // 1. Validar formato del webhook
    this.validateWebhookEvent(event);

    // 2. Parsear y validar webhook body
    const webhookData = WebhookValidator.parseWebhookBody(event.body!);
    
    // 3. Extraer datos del PR
    const githubDeliveryId = event.headers['X-GitHub-Delivery'] || 
                            event.headers['x-github-delivery'] || 
                            null;
    
    const prData = WebhookValidator.extractPRData(webhookData, githubDeliveryId || undefined);
    
    // 4. Validar si la acción debe ser procesada
    if (!ActionValidator.shouldProcessAction(prData.action)) {
      this.logger.info('Acción ignorada', {
        action: prData.action,
        repository: prData.repository,
        prNumber: prData.prNumber
      });

      return {
        job_id: 'ignored',
        message: `Action '${prData.action}' is not reviewable`,
        status: 'cancelled'
      };
    }

    // 5. Generar job ID único
    const jobId = uuidv4();

    this.logger.info('Procesando PR webhook', {
      jobId,
      repository: prData.repository,
      prNumber: prData.prNumber,
      action: prData.action
    });

    // 6. Crear job request
    const createJobRequest: CreateJobRequestOutput = {
      jobId,
      requestId,
      timestamp,
      ...prData
    };

    // 7. Crear job en DynamoDB
    await this.jobManager.createJob(createJobRequest);

    // 8. Crear mensaje SQS
    const sqsMessage: PRProcessMessage = {
      requestId,
      timestamp,
      source: 'pr-receptor',
      payload: {
        jobId,
        ...prData
      },
      metadata: {
        retryCount: 0,
        correlationId: requestId
      }
    };

    // 9. Enviar mensaje a SQS para procesamiento asíncrono
    await this.sqsAdapter.sendMessage(sqsMessage);

    // 10. Métricas
    this.metrics?.addMetric('JobCreated', 'Count', 1);

    // 11. Responder rápidamente (< 3 segundos)
    return {
      job_id: jobId,
      message: MESSAGES.JOB_CREATED,
      status: 'queued'
    };
  }

  // =============================================================================
  // VALIDACIONES
  // =============================================================================

  private validateWebhookEvent(event: APIGatewayProxyEvent): void {
    // Usar el validador compartido
    WebhookValidator.validateEvent(event);
    
    // Validación adicional de signature si está en producción
    // WebhookValidator.validateGitHubSignature(event, process.env.GITHUB_WEBHOOK_SECRET);
  }
}