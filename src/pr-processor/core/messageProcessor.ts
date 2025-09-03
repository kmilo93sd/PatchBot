// =============================================================================
// MESSAGE PROCESSOR - PR PROCESSOR
// =============================================================================

import { SQSRecord } from 'aws-lambda';

import { ValidationError, ProcessingError } from '@shared/types/errors.js';
import { validators } from '@shared/validation/schemas.js';
import { JobManager } from './jobManager.js';
import { AIAnalyzer } from './aiAnalyzer.js';
import { DependencyAnalyzer } from './dependencyAnalyzer.js';
import { GitHubAdapter } from '../adapters/githubAdapter.js';

import type { 
  LambdaConfig, 
  PRProcessMessage,
  AIAnalysisResult 
} from '@shared/types/index.js';

// =============================================================================
// MESSAGE PROCESSOR CLASS
// =============================================================================

export class MessageProcessor {
  private readonly logger: LambdaConfig['logger'];
  private readonly metrics: LambdaConfig['metrics'];
  private readonly context: LambdaConfig['context'];
  private readonly jobManager: JobManager;
  private readonly aiAnalyzer: AIAnalyzer;
  private readonly dependencyAnalyzer: DependencyAnalyzer;
  private readonly githubAdapter: GitHubAdapter;

  constructor(config: LambdaConfig) {
    this.logger = config.logger;
    this.metrics = config.metrics;
    this.context = config.context;
    
    this.jobManager = new JobManager({ 
      logger: this.logger 
    });
    
    this.aiAnalyzer = new AIAnalyzer({ 
      logger: this.logger,
      metrics: this.metrics 
    });
    
    this.dependencyAnalyzer = new DependencyAnalyzer({
      logger: this.logger,
      metrics: this.metrics
    });
    
    this.githubAdapter = new GitHubAdapter({ 
      logger: this.logger 
    });
  }

  // =============================================================================
  // PROCESADOR PRINCIPAL
  // =============================================================================

  async processMessage(record: SQSRecord): Promise<void> {
    // 1. Parsear y validar mensaje SQS
    const message = this.parseMessage(record);
    
    const { jobId } = message.payload;
    
    this.logger.info('Iniciando procesamiento de PR', {
      jobId,
      repository: message.payload.repository,
      prNumber: message.payload.prNumber,
      action: message.payload.action
    });

    try {
      // 2. Actualizar estado del job a 'processing'
      await this.jobManager.updateJobStatus(jobId, 'processing');

      // 3. Obtener datos del PR desde GitHub
      const prData = await this.githubAdapter.getPullRequest(
        message.payload.repository,
        message.payload.prNumber
      );

      // 4. Obtener cambios de archivos
      const fileChanges = await this.githubAdapter.getFileChanges(
        message.payload.repository,
        message.payload.prNumber
      );

      this.logger.info('Datos obtenidos de GitHub', {
        jobId,
        filesChanged: fileChanges.length,
        additions: fileChanges.reduce((sum, file) => sum + file.additions, 0),
        deletions: fileChanges.reduce((sum, file) => sum + file.deletions, 0)
      });

      // 5. Analizar con IA si hay archivos para revisar
      if (fileChanges.length === 0) {
        await this.jobManager.updateJobStatus(jobId, 'completed', 'No files to analyze');
        return;
      }

      // 6. Realizar análisis de dependencias
      const dependencyAnalysis = await this.dependencyAnalyzer.analyzeChanges({
        repository: message.payload.repository,
        fileChanges: fileChanges,
        prNumber: message.payload.prNumber
      });

      this.logger.info('Dependency analysis completed', {
        jobId,
        breakingChanges: dependencyAnalysis.breakingChanges.length,
        affectedFiles: dependencyAnalysis.affectedFiles.length,
        riskLevel: dependencyAnalysis.riskLevel
      });

      // 7. Realizar análisis con IA (mejorado con contexto de dependencias)
      const analysisResult = await this.aiAnalyzer.analyzeCode({
        jobId,
        repository: message.payload.repository,
        prNumber: message.payload.prNumber,
        sha: message.payload.sha,
        prData: message.payload,
        fileChanges,
        dependencyContext: dependencyAnalysis
      });

      // 8. Crear comentarios de revisión en GitHub (incluyendo breaking changes)
      await this.createReviewComments(
        message.payload.repository, 
        message.payload.prNumber, 
        analysisResult,
        dependencyAnalysis
      );

      // 8. Actualizar estado del job a 'completed'
      await this.jobManager.updateJobStatus(jobId, 'completed');

      // 9. Métricas de éxito
      this.metrics?.addMetric('JobCompleted', 'Count', 1);
      this.metrics?.addMetric('FilesAnalyzed', 'Count', fileChanges.length);
      this.metrics?.addMetric('IssuesFound', 'Count', analysisResult.analysis.issues.length);

      this.logger.info('PR procesado exitosamente', {
        jobId,
        issuesFound: analysisResult.analysis.issues.length,
        suggestionsCount: analysisResult.analysis.suggestions.length,
        riskLevel: analysisResult.analysis.riskLevel
      });

    } catch (error) {
      // Actualizar estado del job a 'failed'
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.jobManager.updateJobStatus(jobId, 'failed', errorMessage);

      // Métricas de error
      this.metrics?.addMetric('JobFailed', 'Count', 1);

      this.logger.error('Error procesando PR', {
        jobId,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined
      });

      throw error;
    }
  }

  // =============================================================================
  // UTILIDADES PRIVADAS
  // =============================================================================

  private parseMessage(record: SQSRecord): PRProcessMessage {
    let parsedBody: unknown;
    
    try {
      parsedBody = JSON.parse(record.body);
    } catch (error) {
      throw new ValidationError('Invalid JSON in SQS message body', {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : 'Unknown JSON error'
      });
    }

    // Validar estructura del mensaje
    const result = validators.prProcessMessage.safeParse(parsedBody);
    
    if (!result.success) {
      throw new ValidationError('Invalid SQS message structure', {
        messageId: record.messageId,
        errors: result.error.errors.map(err => ({
          path: err.path.join('.'),
          message: err.message
        }))
      });
    }

    return result.data;
  }

  private async createReviewComments(
    repository: string, 
    prNumber: number, 
    analysisResult: AIAnalysisResult,
    dependencyAnalysis?: any
  ): Promise<void> {
    const { issues, suggestions } = analysisResult.analysis;

    // Crear comentario de resumen
    const summaryComment = this.createSummaryComment(analysisResult);
    await this.githubAdapter.createReviewComment(repository, prNumber, {
      body: summaryComment
    });

    // Crear comentarios por issue crítico
    for (const issue of issues.filter(i => i.severity === 'high' || i.severity === 'critical')) {
      if (issue.file && issue.line) {
        await this.githubAdapter.createReviewComment(repository, prNumber, {
          body: `**${issue.type.toUpperCase()} - ${issue.severity.toUpperCase()}**\n\n${issue.description}${issue.suggestion ? '\n\n**Sugerencia:**\n' + issue.suggestion : ''}`,
          path: issue.file,
          line: issue.line
        });
      }
    }

    // Crear comentarios por mejores sugerencias
    for (const suggestion of suggestions.slice(0, 3)) { // Limitar a top 3
      if (suggestion.file && suggestion.line) {
        await this.githubAdapter.createReviewComment(repository, prNumber, {
          body: `**💡 ${suggestion.type.replace('-', ' ').toUpperCase()}**\n\n${suggestion.description}${suggestion.code ? '\n\n```\n' + suggestion.code + '\n```' : ''}`,
          path: suggestion.file,
          line: suggestion.line
        });
      }
    }
  }

  private createSummaryComment(analysisResult: AIAnalysisResult): string {
    const { analysis } = analysisResult;
    const riskEmoji = analysis.riskLevel === 'high' ? '🔴' : analysis.riskLevel === 'medium' ? '🟡' : '🟢';
    
    return `## 🤖 Revisión Automática de PR

${riskEmoji} **Nivel de Riesgo:** ${analysis.riskLevel.toUpperCase()}
📊 **Puntuación:** ${analysis.score}/100

### Resumen
${analysis.summary}

### Estadísticas
- **Issues encontrados:** ${analysis.issues.length}
  - Críticos: ${analysis.issues.filter(i => i.severity === 'critical').length}
  - Altos: ${analysis.issues.filter(i => i.severity === 'high').length}
  - Medios: ${analysis.issues.filter(i => i.severity === 'medium').length}
  - Bajos: ${analysis.issues.filter(i => i.severity === 'low').length}
- **Sugerencias de mejora:** ${analysis.suggestions.length}

---
*Esta revisión fue generada automáticamente por PR Revisor IA*`;
  }
}