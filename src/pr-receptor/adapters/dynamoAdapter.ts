// =============================================================================
// DYNAMO ADAPTER - PR RECEPTOR
// =============================================================================

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { 
    DynamoDBDocumentClient, 
    PutCommand, 
    GetCommand, 
    UpdateCommand, 
    QueryCommand,
    PutCommandInput,
    GetCommandInput,
    UpdateCommandInput,
    QueryCommandInput
} from '@aws-sdk/lib-dynamodb';

import { DynamoDBError } from '@shared/types/errors.js';
import { AWS_CONFIG } from '@shared/constants/index.js';

import type { ServiceConfig, ReviewJob } from '@shared/types/index.js';

// =============================================================================
// DYNAMO ADAPTER CLASS
// =============================================================================

export class DynamoAdapter {
    private readonly logger: ServiceConfig['logger'];
    private readonly tableName: string;
    private readonly client: DynamoDBClient;
    private readonly docClient: DynamoDBDocumentClient;

    constructor(config: ServiceConfig & { tableName: string }) {
        this.logger = config.logger;
        this.tableName = config.tableName;
        
        // Cliente DynamoDB con configuración optimizada
        this.client = new DynamoDBClient({
            region: process.env.AWS_REGION || AWS_CONFIG.REGION
        });
        
        this.docClient = DynamoDBDocumentClient.from(this.client, {
            marshallOptions: {
                convertEmptyValues: false,
                removeUndefinedValues: true,
                convertClassInstanceToMap: true
            },
            unmarshallOptions: {
                wrapNumbers: false
            }
        });
    }

    // =============================================================================
    // MÉTODOS PÚBLICOS
    // =============================================================================

    async putItem(item: Partial<ReviewJob>): Promise<Partial<ReviewJob>> {
        const params: PutCommandInput = {
            TableName: this.tableName,
            Item: item,
            ConditionExpression: 'attribute_not_exists(jobId)' // Prevenir duplicados
        };

        try {
            await this.docClient.send(new PutCommand(params));
            
            this.logger.info('Item guardado en DynamoDB', {
                tableName: this.tableName,
                jobId: item.jobId
            });
            
            return item;
        } catch (error) {
            if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
                throw new DynamoDBError(`Job ${item.jobId} already exists`, {
                    operation: 'PutItem',
                    tableName: this.tableName,
                    jobId: item.jobId
                });
            }
            
            this.logger.error('Error guardando en DynamoDB', {
                tableName: this.tableName,
                error: error instanceof Error ? error.message : 'Unknown error',
                jobId: item.jobId
            });
            
            throw new DynamoDBError('Failed to save item to DynamoDB', {
                operation: 'PutItem',
                tableName: this.tableName,
                originalError: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    async getItem(key: { jobId: string }): Promise<ReviewJob | null> {
        const params: GetCommandInput = {
            TableName: this.tableName,
            Key: key
        };

        try {
            const response = await this.docClient.send(new GetCommand(params));
            
            this.logger.debug('Item obtenido de DynamoDB', {
                tableName: this.tableName,
                jobId: key.jobId,
                found: !!response.Item
            });
            
            return (response.Item as ReviewJob) || null;
        } catch (error) {
            this.logger.error('Error obteniendo de DynamoDB', {
                tableName: this.tableName,
                error: error instanceof Error ? error.message : 'Unknown error',
                key
            });
            
            throw new DynamoDBError('Failed to get item from DynamoDB', {
                operation: 'GetItem',
                tableName: this.tableName,
                originalError: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    async updateItem(
        key: { jobId: string }, 
        updateData: Partial<ReviewJob>
    ): Promise<ReviewJob> {
        // Construir expresión de actualización dinámicamente
        const updateExpression: string[] = [];
        const expressionAttributeNames: Record<string, string> = {};
        const expressionAttributeValues: Record<string, any> = {};

        Object.entries(updateData).forEach(([field, value], index) => {
            const nameKey = `#${field}`;
            const valueKey = `:value${index}`;
            
            updateExpression.push(`${nameKey} = ${valueKey}`);
            expressionAttributeNames[nameKey] = field;
            expressionAttributeValues[valueKey] = value;
        });

        const params: UpdateCommandInput = {
            TableName: this.tableName,
            Key: key,
            UpdateExpression: `SET ${updateExpression.join(', ')}`,
            ExpressionAttributeNames: expressionAttributeNames,
            ExpressionAttributeValues: expressionAttributeValues,
            ReturnValues: 'ALL_NEW'
        };

        try {
            const response = await this.docClient.send(new UpdateCommand(params));
            
            this.logger.info('Item actualizado en DynamoDB', {
                tableName: this.tableName,
                jobId: key.jobId,
                updatedFields: Object.keys(updateData)
            });
            
            return response.Attributes as ReviewJob;
        } catch (error) {
            this.logger.error('Error actualizando en DynamoDB', {
                tableName: this.tableName,
                error: error instanceof Error ? error.message : 'Unknown error',
                key,
                updateData
            });
            
            throw new DynamoDBError('Failed to update item in DynamoDB', {
                operation: 'UpdateItem',
                tableName: this.tableName,
                originalError: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    async queryByStatus(
        status: ReviewJob['status'], 
        limit: number = 50
    ): Promise<ReviewJob[]> {
        const params: QueryCommandInput = {
            TableName: this.tableName,
            IndexName: 'StatusIndex',
            KeyConditionExpression: '#status = :status',
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ':status': status
            },
            Limit: limit,
            ScanIndexForward: false // Más recientes primero
        };

        try {
            const response = await this.docClient.send(new QueryCommand(params));
            
            this.logger.debug('Query ejecutado en DynamoDB', {
                tableName: this.tableName,
                status,
                count: response.Items?.length || 0
            });
            
            return (response.Items as ReviewJob[]) || [];
        } catch (error) {
            this.logger.error('Error ejecutando query en DynamoDB', {
                tableName: this.tableName,
                error: error instanceof Error ? error.message : 'Unknown error',
                status
            });
            
            throw new DynamoDBError('Failed to query items from DynamoDB', {
                operation: 'Query',
                tableName: this.tableName,
                originalError: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
}