// =============================================================================
// JOB MANAGER - PR RECEPTOR
// =============================================================================

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PutCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { DynamoDBError } from '@shared/types/errors.js';
import { AWS_CONFIG, calculateTTL } from '@shared/constants/index.js';
import { getCurrentTimestamp } from '@shared/utils/index.js';

import type { 
  ServiceConfig, 
  CreateJobRequestOutput, 
  ReviewJob 
} from '@shared/types/index.js';

// =============================================================================
// JOB MANAGER CLASS
// =============================================================================

export class JobManager {
  private readonly logger: ServiceConfig['logger'];
  private readonly docClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(config: ServiceConfig) {
    this.logger = config.logger;
    this.tableName = AWS_CONFIG.REVIEW_JOBS_TABLE;

    // Crear cliente DynamoDB
    const client = new DynamoDBClient({
      region: AWS_CONFIG.REGION
    });
    
    this.docClient = DynamoDBDocumentClient.from(client);
  }

  // =============================================================================
  // CREAR JOB
  // =============================================================================

  async createJob(request: CreateJobRequestOutput): Promise<void> {
    const now = getCurrentTimestamp();
    const ttl = calculateTTL(90); // 90 días

    const job: ReviewJob = {
      jobId: request.jobId,
      requestId: request.requestId,
      timestamp: request.timestamp,
      repository: request.repository,
      prNumber: request.prNumber,
      action: request.action,
      sha: request.sha,
      title: request.title,
      author: request.author,
      prUrl: request.prUrl,
      status: 'queued',
      githubDeliveryId: request.githubDeliveryId,
      createdAt: now,
      updatedAt: now,
      ttl,
      retryCount: 0
    };

    try {
      this.logger.info('Creando job en DynamoDB', {
        jobId: job.jobId,
        repository: job.repository,
        prNumber: job.prNumber,
        tableName: this.tableName
      });

      const command = new PutCommand({
        TableName: this.tableName,
        Item: job,
        ConditionExpression: 'attribute_not_exists(jobId)', // Evitar duplicados
      });

      await this.docClient.send(command);

      this.logger.info('Job creado exitosamente', {
        jobId: job.jobId,
        status: job.status
      });

    } catch (error) {
      this.logger.error('Error creando job en DynamoDB', {
        jobId: job.jobId,
        error: error instanceof Error ? error.message : 'Unknown error',
        tableName: this.tableName
      });

      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        throw new DynamoDBError(`Job ${job.jobId} already exists`, {
          jobId: job.jobId,
          operation: 'createJob'
        });
      }

      throw new DynamoDBError('Failed to create job', {
        jobId: job.jobId,
        operation: 'createJob',
        originalError: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // =============================================================================
  // VALIDACIONES
  // =============================================================================

  private validateTableName(): void {
    if (!this.tableName) {
      throw new DynamoDBError('DynamoDB table name not configured', {
        envVar: 'REVIEW_JOBS_TABLE'
      });
    }
  }
}