// =============================================================================
// TIPOS COMPARTIDOS - PR REVISOR
// =============================================================================

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics } from '@aws-lambda-powertools/metrics';

// Re-export from schemas
export type { CreateJobRequestOutput } from '../validation/schemas.js';

// =============================================================================
// TIPOS BASE AWS
// =============================================================================

export type LambdaHandler<TEvent = any, TResult = any> = (
  event: TEvent,
  context: Context
) => Promise<TResult>;

export type APIHandler = LambdaHandler<APIGatewayProxyEvent, APIGatewayProxyResult>;

// =============================================================================
// CONFIGURACIÓN
// =============================================================================

export interface LambdaConfig {
  logger: Logger;
  metrics: Metrics;
  context: Context;
}

export interface ServiceConfig {
  logger: Logger;
  metrics?: Metrics;
}

// =============================================================================
// DATOS DE PULL REQUEST
// =============================================================================

export interface PRData {
  repository: string;
  prNumber: number;
  action: GitHubAction;
  sha: string;
  title: string;
  author: string;
  githubDeliveryId: string | null;
  prUrl: string;
}

export type GitHubAction = 
  | 'opened'
  | 'closed'
  | 'reopened'
  | 'edited'
  | 'synchronize'
  | 'ready_for_review'
  | 'draft';

// =============================================================================
// JOB DE REVISIÓN
// =============================================================================

export interface ReviewJob {
  jobId: string;
  requestId: string;
  timestamp: string;
  repository: string;
  prNumber: number;
  action: GitHubAction;
  sha: string;
  title: string;
  author: string;
  prUrl: string;
  status: JobStatus;
  githubDeliveryId: string | null;
  createdAt: string;
  updatedAt: string;
  ttl: number;
  error?: string;
  retryCount?: number;
}

export type JobStatus = 
  | 'queued'
  | 'processing' 
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface CreateJobRequest extends PRData {
  jobId: string;
  requestId: string;
  timestamp: string;
}

// =============================================================================
// MENSAJES SQS
// =============================================================================

export interface SQSMessage<T = any> {
  requestId: string;
  timestamp: string;
  source: 'pr-receptor' | 'pr-processor';
  payload: T;
  metadata: {
    retryCount: number;
    correlationId: string;
    [key: string]: any;
  };
}

export interface PRProcessMessage extends SQSMessage<PRData & { jobId: string }> {
  source: 'pr-receptor';
}

// =============================================================================
// RESPUESTAS HTTP
// =============================================================================

export interface APIResponse<T = any> {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export interface PRReceptorResponse {
  job_id: string;
  message: string;
  status: JobStatus;
}

export interface ErrorResponse {
  error: string;
  message: string;
  requestId?: string;
  statusCode?: number;
}

// =============================================================================
// VALIDACIÓN
// =============================================================================

export interface ValidationError extends Error {
  statusCode: number;
}

export interface ValidationResult {
  isValid: boolean;
  errors?: string[];
}

// =============================================================================
// GITHUB WEBHOOK PAYLOADS
// =============================================================================

export interface GitHubWebhookEvent {
  action: GitHubAction;
  number: number;
  pull_request: GitHubPullRequest;
  repository: GitHubRepository;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed' | 'draft';
  html_url: string;
  user: GitHubUser;
  head: {
    sha: string;
    ref: string;
    repo: GitHubRepository;
  };
  base: {
    sha: string;
    ref: string;
    repo: GitHubRepository;
  };
  changed_files?: number;
  additions?: number;
  deletions?: number;
}

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  clone_url: string;
  ssh_url: string;
  owner: GitHubUser;
  default_branch: string;
}

export interface GitHubUser {
  id: number;
  login: string;
  avatar_url: string;
  html_url: string;
  type: 'User' | 'Bot' | 'Organization';
}

// =============================================================================
// ANÁLISIS IA
// =============================================================================

export interface AIAnalysisRequest {
  jobId: string;
  repository: string;
  prNumber: number;
  sha: string;
  prData: PRData;
  fileChanges: FileChange[];
}

export interface FileChange {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  additions: number;
  deletions: number;
  patch?: string;
  previous_filename?: string;
}

export interface AIAnalysisResult {
  jobId: string;
  analysis: {
    summary: string;
    issues: CodeIssue[];
    suggestions: CodeSuggestion[];
    riskLevel: 'low' | 'medium' | 'high';
    score: number;
  };
  processingTime: number;
  timestamp: string;
}

export interface CodeIssue {
  type: 'security' | 'performance' | 'maintainability' | 'bug' | 'style';
  severity: 'low' | 'medium' | 'high' | 'critical';
  file: string;
  line?: number;
  description: string;
  suggestion?: string;
}

export interface CodeSuggestion {
  type: 'improvement' | 'optimization' | 'refactor' | 'best-practice';
  file: string;
  line?: number;
  description: string;
  code?: string;
}

// =============================================================================
// MÉTRICAS
// =============================================================================

export interface MetricData {
  name: string;
  value: number;
  unit: 'Count' | 'Milliseconds' | 'Bytes' | 'Percent';
  timestamp?: string;
}

// =============================================================================
// ADAPTADORES
// =============================================================================

export interface DynamoAdapter {
  createJob(job: CreateJobRequest): Promise<void>;
  getJob(jobId: string, timestamp: string): Promise<ReviewJob | null>;
  updateJob(jobId: string, timestamp: string, updates: Partial<ReviewJob>): Promise<void>;
  listJobsByStatus(status: JobStatus): Promise<ReviewJob[]>;
}

export interface SQSAdapter {
  sendMessage<T>(message: SQSMessage<T>): Promise<void>;
  receiveMessages(maxMessages?: number): Promise<SQSMessage[]>;
  deleteMessage(receiptHandle: string): Promise<void>;
}

export interface GitHubAdapter {
  getPullRequest(repo: string, prNumber: number): Promise<GitHubPullRequest>;
  getFileChanges(repo: string, prNumber: number): Promise<FileChange[]>;
  createReviewComment(
    repo: string, 
    prNumber: number, 
    comment: ReviewComment
  ): Promise<void>;
}

export interface ReviewComment {
  body: string;
  path?: string;
  line?: number;
  side?: 'LEFT' | 'RIGHT';
  start_line?: number;
  start_side?: 'LEFT' | 'RIGHT';
}

// =============================================================================
// UTILIDADES DE TIPO
// =============================================================================

export type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type RequiredKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? never : K;
}[keyof T];

export type OptionalKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? K : never;
}[keyof T];