// =============================================================================
// VALIDADORES PERSONALIZADOS - PR REVISOR
// =============================================================================

import { z } from 'zod';
import { ValidationError } from '../types/errors.js';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { 
  GitHubWebhookEventSchema,
  PRDataSchema,
  type GitHubWebhookEventOutput,
  type PRDataOutput 
} from './schemas.js';

// =============================================================================
// VALIDADOR DE WEBHOOK DE GITHUB
// =============================================================================

export class WebhookValidator {
  static validateEvent(event: APIGatewayProxyEvent): void {
    // Validar método HTTP
    if (event.httpMethod !== 'POST') {
      throw new ValidationError('Only POST method is allowed', {
        method: event.httpMethod,
      });
    }

    // Validar que tenga body
    if (!event.body) {
      throw new ValidationError('Request body is required');
    }

    // Validar headers requeridos
    const githubEvent = event.headers['X-GitHub-Event'] || event.headers['x-github-event'];
    if (!githubEvent) {
      throw new ValidationError('X-GitHub-Event header is required');
    }

    if (githubEvent !== 'pull_request') {
      throw new ValidationError('Only pull_request events are supported', {
        event: githubEvent,
      });
    }
  }

  static parseWebhookBody(body: string): GitHubWebhookEventOutput {
    let parsedBody: unknown;
    
    try {
      parsedBody = JSON.parse(body);
    } catch (error) {
      throw new ValidationError('Invalid JSON in request body', {
        error: error instanceof Error ? error.message : 'Unknown JSON error',
      });
    }

    const result = GitHubWebhookEventSchema.safeParse(parsedBody);
    
    if (!result.success) {
      throw new ValidationError('Invalid webhook payload structure', {
        errors: result.error.errors.map(err => ({
          path: err.path.join('.'),
          message: err.message,
        })),
      });
    }

    return result.data;
  }

  static extractPRData(
    webhook: GitHubWebhookEventOutput, 
    githubDeliveryId?: string
  ): PRDataOutput {
    const prData = {
      repository: webhook.repository.full_name,
      prNumber: webhook.pull_request.number,
      action: webhook.action,
      sha: webhook.pull_request.head.sha,
      title: webhook.pull_request.title,
      author: webhook.pull_request.user.login,
      githubDeliveryId: githubDeliveryId || null,
      prUrl: webhook.pull_request.html_url,
    };

    // Validar los datos extraídos
    const result = PRDataSchema.safeParse(prData);
    
    if (!result.success) {
      throw new ValidationError('Invalid PR data extracted from webhook', {
        errors: result.error.errors.map(err => ({
          path: err.path.join('.'),
          message: err.message,
        })),
      });
    }

    return result.data;
  }

  static validateGitHubSignature(event: APIGatewayProxyEvent, secret?: string): void {
    if (!secret) {
      // En desarrollo, permitir sin validación
      return;
    }

    const signature = event.headers['X-Hub-Signature-256'] || event.headers['x-hub-signature-256'];
    
    if (!signature) {
      throw new ValidationError('Missing GitHub signature header');
    }

    if (!event.body) {
      throw new ValidationError('Cannot validate signature without request body');
    }

    // TODO: Implementar validación HMAC
    // const expectedSignature = crypto
    //   .createHmac('sha256', secret)
    //   .update(event.body)
    //   .digest('hex');
    
    // if (!crypto.timingSafeEqual(
    //   Buffer.from(signature),
    //   Buffer.from(`sha256=${expectedSignature}`)
    // )) {
    //   throw new AuthenticationError('Invalid GitHub signature');
    // }
  }
}

// =============================================================================
// VALIDADOR DE ACCIONES SOPORTADAS
// =============================================================================

export class ActionValidator {
  private static readonly REVIEWABLE_ACTIONS = [
    'opened',
    'synchronize', 
    'ready_for_review'
  ] as const;

  private static readonly IGNORABLE_ACTIONS = [
    'closed',
    'edited',
    'reopened',
    'draft'
  ] as const;

  static isReviewable(action: string): boolean {
    return this.REVIEWABLE_ACTIONS.includes(action as any);
  }

  static isIgnorable(action: string): boolean {
    return this.IGNORABLE_ACTIONS.includes(action as any);
  }

  static validateAction(action: string): void {
    if (!this.isReviewable(action) && !this.isIgnorable(action)) {
      throw new ValidationError('Unsupported GitHub action', {
        action,
        supported: [...this.REVIEWABLE_ACTIONS, ...this.IGNORABLE_ACTIONS],
      });
    }
  }

  static shouldProcessAction(action: string): boolean {
    this.validateAction(action);
    return this.isReviewable(action);
  }
}

// =============================================================================
// VALIDADOR DE ARCHIVOS
// =============================================================================

export class FileValidator {
  private static readonly SUPPORTED_EXTENSIONS = [
    '.js', '.jsx', '.ts', '.tsx',
    '.py', '.java', '.cs', '.go',
    '.json', '.yaml', '.yml',
    '.md', '.txt', '.sql', '.sh',
    '.dockerfile'
  ];

  private static readonly IGNORED_PATTERNS = [
    'node_modules/',
    '.git/',
    'dist/',
    'build/',
    'coverage/',
    '.aws-sam/',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml'
  ];

  private static readonly MAX_FILE_SIZE_MB = 10;
  private static readonly MAX_FILES_COUNT = 50;

  static isSupportedFile(filename: string): boolean {
    const extension = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    return this.SUPPORTED_EXTENSIONS.includes(extension);
  }

  static shouldIgnoreFile(filename: string): boolean {
    return this.IGNORED_PATTERNS.some(pattern => filename.includes(pattern));
  }

  static isValidForAnalysis(filename: string): boolean {
    return this.isSupportedFile(filename) && !this.shouldIgnoreFile(filename);
  }

  static validateFileCount(files: unknown[]): void {
    if (files.length > this.MAX_FILES_COUNT) {
      throw new ValidationError(`Too many files to analyze. Maximum ${this.MAX_FILES_COUNT} files allowed`, {
        fileCount: files.length,
        maxAllowed: this.MAX_FILES_COUNT,
      });
    }
  }

  static validateFileSize(filename: string, sizeInBytes: number): void {
    const sizeInMB = sizeInBytes / (1024 * 1024);
    
    if (sizeInMB > this.MAX_FILE_SIZE_MB) {
      throw new ValidationError(`File too large for analysis: ${filename}`, {
        filename,
        sizeInMB: Math.round(sizeInMB * 100) / 100,
        maxSizeMB: this.MAX_FILE_SIZE_MB,
      });
    }
  }
}

// =============================================================================
// VALIDADOR DE CONFIGURACIÓN
// =============================================================================

export class ConfigValidator {
  static validateEnvironmentVariables(): void {
    const required = [
      'REVIEW_JOBS_TABLE',
      'PR_PROCESS_QUEUE_URL',
      'AWS_REGION'
    ];

    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      throw new ValidationError('Missing required environment variables', {
        missing,
        required,
      });
    }
  }

  static validateAWSRegion(region: string): void {
    const validRegions = [
      'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
      'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1',
      'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1'
    ];

    if (!validRegions.includes(region)) {
      throw new ValidationError('Invalid AWS region', {
        region,
        validRegions,
      });
    }
  }
}

// =============================================================================
// VALIDADOR DE ESTADO
// =============================================================================

export class StateValidator {
  private static readonly VALID_TRANSITIONS: Record<string, string[]> = {
    'queued': ['processing', 'failed', 'cancelled'],
    'processing': ['completed', 'failed'],
    'completed': [],
    'failed': ['queued'], // Permitir retry
    'cancelled': []
  };

  static canTransition(from: string, to: string): boolean {
    const allowedTransitions = this.VALID_TRANSITIONS[from];
    return allowedTransitions?.includes(to) ?? false;
  }

  static validateTransition(from: string, to: string): void {
    if (!this.canTransition(from, to)) {
      throw new ValidationError('Invalid state transition', {
        from,
        to,
        allowedTransitions: this.VALID_TRANSITIONS[from] || [],
      });
    }
  }
}

// =============================================================================
// UTILDAD DE SANITIZACIÓN
// =============================================================================

export class SanitizationUtils {
  static sanitizeString(input: string): string {
    return input
      .trim()
      .replace(/\s+/g, ' ') // Normalizar espacios
      .replace(/[<>]/g, ''); // Remover caracteres potencialmente peligrosos
  }

  static sanitizeFilename(filename: string): string {
    return filename
      .replace(/[^a-zA-Z0-9._/-]/g, '_') // Solo caracteres seguros
      .replace(/_{2,}/g, '_') // Evitar múltiples underscores
      .toLowerCase();
  }

  static truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  static removeSecrets(obj: any): any {
    const sensitiveKeys = [
      'password', 'token', 'secret', 'key', 'authorization',
      'x-hub-signature-256', 'x-github-token'
    ];

    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.removeSecrets(item));
    }

    const sanitized = { ...obj };
    
    for (const [key, value] of Object.entries(sanitized)) {
      const lowerKey = key.toLowerCase();
      
      if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.removeSecrets(value);
      }
    }

    return sanitized;
  }
}

// =============================================================================
// FACTORY DE VALIDADORES
// =============================================================================

export const createValidationPipeline = <T>(...validators: Array<(data: T) => void | T>) => {
  return (data: T): T => {
    let result = data;
    
    for (const validator of validators) {
      const validated = validator(result);
      if (validated !== undefined) {
        result = validated;
      }
    }
    
    return result;
  };
};