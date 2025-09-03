// =============================================================================
// ESQUEMAS DE VALIDACIÓN CON ZOD - PR REVISOR
// =============================================================================

import { z } from 'zod';

// =============================================================================
// ESQUEMAS BASE
// =============================================================================

export const UUIDSchema = z.string().uuid('Invalid UUID format');

export const TimestampSchema = z.string().datetime('Invalid timestamp format');

export const RequestIdSchema = z.string().min(1, 'Request ID cannot be empty');

// =============================================================================
// GITHUB SCHEMAS
// =============================================================================

export const GitHubActionSchema = z.enum([
  'opened',
  'closed', 
  'reopened',
  'edited',
  'synchronize',
  'ready_for_review',
  'draft'
]);

export const GitHubRepoSchema = z.string()
  .regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/, 'Invalid GitHub repository format');

export const SHASchema = z.string()
  .regex(/^[a-f0-9]{40}$/, 'Invalid SHA format');

export const PRNumberSchema = z.number()
  .int('PR number must be an integer')
  .positive('PR number must be positive');

// =============================================================================
// DATOS DE PULL REQUEST
// =============================================================================

export const PRDataSchema = z.object({
  repository: GitHubRepoSchema,
  prNumber: PRNumberSchema,
  action: GitHubActionSchema,
});

export type PRDataInput = z.input<typeof PRDataSchema>;
export type PRDataOutput = z.output<typeof PRDataSchema>;

// =============================================================================
// JOB SCHEMAS
// =============================================================================

export const JobStatusSchema = z.enum([
  'queued',
  'processing',
  'completed', 
  'failed',
  'cancelled'
]);

export const ReviewJobSchema = z.object({
  jobId: UUIDSchema,
  requestId: RequestIdSchema,
  timestamp: TimestampSchema,
  repository: GitHubRepoSchema,
  prNumber: PRNumberSchema,
  action: GitHubActionSchema,
  status: JobStatusSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  ttl: z.number().int().positive(),
  error: z.string().optional(),
  retryCount: z.number().int().min(0).optional(),
});

export const CreateJobRequestSchema = PRDataSchema.extend({
  jobId: UUIDSchema,
  requestId: RequestIdSchema,
  timestamp: TimestampSchema,
});

export type CreateJobRequestInput = z.input<typeof CreateJobRequestSchema>;
export type CreateJobRequestOutput = z.output<typeof CreateJobRequestSchema>;

// =============================================================================
// SQS MESSAGE SCHEMAS  
// =============================================================================

export const SQSMessageMetadataSchema = z.object({
  retryCount: z.number().int().min(0),
  correlationId: z.string().min(1),
}).catchall(z.any()); // Permite campos adicionales

export const BaseSQSMessageSchema = z.object({
  requestId: RequestIdSchema,
  timestamp: TimestampSchema,
  source: z.enum(['pr-receptor', 'pr-processor']),
  payload: z.record(z.any()), // Payload genérico
  metadata: SQSMessageMetadataSchema,
});

export const PRProcessMessageSchema = BaseSQSMessageSchema.extend({
  source: z.literal('pr-receptor'),
  payload: PRDataSchema.extend({
    jobId: UUIDSchema,
  }),
});

export type PRProcessMessageInput = z.input<typeof PRProcessMessageSchema>;
export type PRProcessMessageOutput = z.output<typeof PRProcessMessageSchema>;

// =============================================================================
// API GATEWAY SCHEMAS
// =============================================================================

export const APIGatewayHeadersSchema = z.record(z.string());

export const APIGatewayEventSchema = z.object({
  httpMethod: z.string(),
  path: z.string(),
  headers: APIGatewayHeadersSchema,
  body: z.string().nullable(),
  queryStringParameters: z.record(z.string()).nullable(),
  pathParameters: z.record(z.string()).nullable(),
  requestContext: z.object({
    requestId: z.string(),
    identity: z.object({
      sourceIp: z.string(),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

// =============================================================================
// GITHUB WEBHOOK SCHEMAS
// =============================================================================

export const GitHubUserSchema = z.object({
  id: z.number(),
  login: z.string(),
  avatar_url: z.string().url(),
  html_url: z.string().url(),
  type: z.enum(['User', 'Bot', 'Organization']),
});

export const GitHubRepositorySchema = z.object({
  id: z.number(),
  name: z.string(),
  full_name: GitHubRepoSchema,
  private: z.boolean(),
  html_url: z.string().url(),
  clone_url: z.string().url(),
  ssh_url: z.string(),
  owner: GitHubUserSchema,
  default_branch: z.string(),
});

export const GitHubPullRequestSchema = z.object({
  number: PRNumberSchema,
  title: z.string(),
  body: z.string().nullable(),
  state: z.enum(['open', 'closed', 'draft']),
  html_url: z.string().url(),
  user: GitHubUserSchema,
  head: z.object({
    sha: SHASchema,
    ref: z.string(),
    repo: GitHubRepositorySchema,
  }),
  base: z.object({
    sha: SHASchema,
    ref: z.string(),
    repo: GitHubRepositorySchema,
  }),
  changed_files: z.number().optional(),
  additions: z.number().optional(),
  deletions: z.number().optional(),
});

export const GitHubWebhookEventSchema = z.object({
  action: GitHubActionSchema,
  number: PRNumberSchema,
  pull_request: GitHubPullRequestSchema,
  repository: GitHubRepositorySchema,
});

export type GitHubWebhookEventInput = z.input<typeof GitHubWebhookEventSchema>;
export type GitHubWebhookEventOutput = z.output<typeof GitHubWebhookEventSchema>;

// =============================================================================
// ANÁLISIS IA SCHEMAS
// =============================================================================

export const FileChangeSchema = z.object({
  filename: z.string(),
  status: z.enum(['added', 'modified', 'removed', 'renamed']),
  additions: z.number().int().min(0),
  deletions: z.number().int().min(0),
  patch: z.string().optional(),
  previous_filename: z.string().optional(),
});

export const AIAnalysisRequestSchema = z.object({
  jobId: UUIDSchema,
  repository: GitHubRepoSchema,
  prNumber: PRNumberSchema,
  sha: SHASchema,
  prData: PRDataSchema,
  fileChanges: z.array(FileChangeSchema),
});

export const CodeIssueSchema = z.object({
  type: z.enum(['security', 'performance', 'maintainability', 'bug', 'style']),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  file: z.string(),
  line: z.number().int().positive().optional(),
  description: z.string().min(1),
  suggestion: z.string().optional(),
});

export const CodeSuggestionSchema = z.object({
  type: z.enum(['improvement', 'optimization', 'refactor', 'best-practice']),
  file: z.string(),
  line: z.number().int().positive().optional(),
  description: z.string().min(1),
  code: z.string().optional(),
});

export const AIAnalysisResultSchema = z.object({
  jobId: UUIDSchema,
  analysis: z.object({
    summary: z.string().min(1),
    issues: z.array(CodeIssueSchema),
    suggestions: z.array(CodeSuggestionSchema),
    riskLevel: z.enum(['low', 'medium', 'high']),
    score: z.number().min(0).max(100),
  }),
  processingTime: z.number().positive(),
  timestamp: TimestampSchema,
});

export type FileChangeInput = z.input<typeof FileChangeSchema>;
export type AIAnalysisRequestInput = z.input<typeof AIAnalysisRequestSchema>;
export type AIAnalysisResultInput = z.input<typeof AIAnalysisResultSchema>;

// =============================================================================
// RESPONSE SCHEMAS
// =============================================================================

export const PRReceptorResponseSchema = z.object({
  job_id: UUIDSchema,
  message: z.string(),
  status: JobStatusSchema,
});

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.any()).optional(),
    timestamp: TimestampSchema,
    requestId: z.string().optional(),
  }),
});

export type PRReceptorResponseInput = z.input<typeof PRReceptorResponseSchema>;
export type ErrorResponseInput = z.input<typeof ErrorResponseSchema>;

// =============================================================================
// REVIEW COMMENT SCHEMAS
// =============================================================================

export const ReviewCommentSchema = z.object({
  body: z.string().min(1),
  path: z.string().optional(),
  line: z.number().int().positive().optional(),
  side: z.enum(['LEFT', 'RIGHT']).optional(),
  start_line: z.number().int().positive().optional(),
  start_side: z.enum(['LEFT', 'RIGHT']).optional(),
});

export type ReviewCommentInput = z.input<typeof ReviewCommentSchema>;

// =============================================================================
// UTILIDADES DE VALIDACIÓN
// =============================================================================

export function createValidator<T extends z.ZodSchema>(schema: T) {
  return {
    parse: (data: unknown) => schema.parse(data),
    safeParse: (data: unknown) => schema.safeParse(data),
    validate: (data: unknown): data is z.output<T> => {
      return schema.safeParse(data).success;
    },
  };
}

// =============================================================================
// VALIDADORES PRE-CONSTRUIDOS
// =============================================================================

export const validators = {
  prData: createValidator(PRDataSchema),
  createJobRequest: createValidator(CreateJobRequestSchema),
  reviewJob: createValidator(ReviewJobSchema),
  prProcessMessage: createValidator(PRProcessMessageSchema),
  githubWebhookEvent: createValidator(GitHubWebhookEventSchema),
  aiAnalysisRequest: createValidator(AIAnalysisRequestSchema),
  aiAnalysisResult: createValidator(AIAnalysisResultSchema),
  prReceptorResponse: createValidator(PRReceptorResponseSchema),
  errorResponse: createValidator(ErrorResponseSchema),
  reviewComment: createValidator(ReviewCommentSchema),
};

// =============================================================================
// TRANSFORMACIONES
// =============================================================================

export function transformWebhookToPRData(webhook: GitHubWebhookEventOutput): PRDataOutput {
  return {
    repository: webhook.repository.full_name,
    prNumber: webhook.pull_request.number,
    action: webhook.action,
  };
}