// =============================================================================
// JOB MANAGER - PR PROCESSOR
// =============================================================================

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { UpdateCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { DynamoDBError, NotFoundError } from '@shared/types/errors.js';
import { AWS_CONFIG } from '@shared/constants/index.js';
import { getCurrentTimestamp } from '@shared/utils/index.js';

import type { 
  ServiceConfig, 
  JobStatus 
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

    this.validateConfiguration();
  }

  // =============================================================================
  // ACTUALIZAR STATUS DE JOB
  // =============================================================================

  async updateJobStatus(
    jobId: string, 
    status: JobStatus, 
    error?: string
  ): Promise<void> {
    const now = getCurrentTimestamp();
    
    try {
      this.logger.info('Actualizando status de job', {
        jobId,
        newStatus: status,
        hasError: !!error,
        tableName: this.tableName
      });

      const updateExpression = error
        ? 'SET #status = :status, updatedAt = :updatedAt, #error = :error'
        : 'SET #status = :status, updatedAt = :updatedAt REMOVE #error';

      const expressionAttributeNames: Record<string, string> = {
        '#status': 'status'
      };

      const expressionAttributeValues: Record<string, any> = {
        ':status': status,
        ':updatedAt': now
      };

      if (error) {
        expressionAttributeNames['#error'] = 'error';
        expressionAttributeValues[':error'] = error;
      } else {
        expressionAttributeNames['#error'] = 'error';
      }

      const command = new UpdateCommand({
        TableName: this.tableName,
        Key: {
          jobId: jobId,
          // Note: Necesitamos el timestamp como sort key, pero como no lo tenemos aquí
          // usaremos un GSI o buscaremos por jobId solamente si la tabla lo permite
          // Para simplicidad, asumiremos que jobId es único
        },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ConditionExpression: 'attribute_exists(jobId)', // Verificar que el job existe
        ReturnValues: 'ALL_NEW'
      });

      const result = await this.docClient.send(command);

      this.logger.info('Job status actualizado exitosamente', {
        jobId,
        previousAttributes: result.Attributes,
        newStatus: status
      });

    } catch (error) {
      this.logger.error('Error actualizando job status', {
        jobId,
        status,
        error: error instanceof Error ? error.message : 'Unknown error',
        tableName: this.tableName
      });

      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        throw new NotFoundError('ReviewJob', jobId);
      }

      throw new DynamoDBError('Failed to update job status', {
        jobId,
        status,
        operation: 'updateJobStatus',
        originalError: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // =============================================================================
  // INCREMENTAR RETRY COUNT
  // =============================================================================

  async incrementRetryCount(jobId: string): Promise<number> {
    const now = getCurrentTimestamp();
    
    try {
      this.logger.info('Incrementando retry count', {
        jobId,
        tableName: this.tableName
      });

      const command = new UpdateCommand({
        TableName: this.tableName,
        Key: {
          jobId: jobId
        },
        UpdateExpression: 'ADD retryCount :increment SET updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':increment': 1,
          ':updatedAt': now
        },
        ConditionExpression: 'attribute_exists(jobId)',
        ReturnValues: 'ALL_NEW'
      });

      const result = await this.docClient.send(command);
      const newRetryCount = result.Attributes?.retryCount || 0;

      this.logger.info('Retry count incrementado', {
        jobId,
        newRetryCount
      });

      return newRetryCount;

    } catch (error) {
      this.logger.error('Error incrementando retry count', {
        jobId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        throw new NotFoundError('ReviewJob', jobId);
      }

      throw new DynamoDBError('Failed to increment retry count', {
        jobId,
        operation: 'incrementRetryCount',
        originalError: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // =============================================================================
  // VALIDACIONES
  // =============================================================================

  private validateConfiguration(): void {
    if (!this.tableName) {
      throw new DynamoDBError('DynamoDB table name not configured', {
        envVar: 'REVIEW_JOBS_TABLE'
      });
    }
  }
}