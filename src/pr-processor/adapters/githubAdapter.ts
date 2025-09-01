// =============================================================================
// GITHUB ADAPTER - PR PROCESSOR
// =============================================================================

import { Octokit } from 'octokit';

import { GitHubAPIError, NotFoundError } from '@shared/types/errors.js';
import { TIMEOUTS } from '@shared/constants/index.js';

import type { 
  ServiceConfig,
  GitHubPullRequest,
  FileChange,
  ReviewComment
} from '@shared/types/index.js';

// =============================================================================
// GITHUB ADAPTER CLASS
// =============================================================================

export class GitHubAdapter {
  private readonly logger: ServiceConfig['logger'];
  private readonly octokit: Octokit;

  constructor(config: ServiceConfig) {
    this.logger = config.logger;
    
    // Crear cliente GitHub
    this.octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN,
      request: {
        timeout: TIMEOUTS.GITHUB_API_REQUEST
      }
    });
  }

  // =============================================================================
  // OBTENER PULL REQUEST
  // =============================================================================

  async getPullRequest(repository: string, prNumber: number): Promise<GitHubPullRequest> {
    const [owner, repo] = repository.split('/');
    
    try {
      this.logger.info('Obteniendo datos del PR desde GitHub', {
        repository,
        prNumber,
        owner,
        repo
      });

      const response = await this.octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber
      });

      const pr = response.data;

      const result: GitHubPullRequest = {
        number: pr.number,
        title: pr.title,
        body: pr.body,
        state: pr.state as 'open' | 'closed' | 'draft',
        html_url: pr.html_url,
        user: {
          id: pr.user?.id || 0,
          login: pr.user?.login || 'unknown',
          avatar_url: pr.user?.avatar_url || '',
          html_url: pr.user?.html_url || '',
          type: (pr.user?.type as 'User' | 'Bot' | 'Organization') || 'User'
        },
        head: {
          sha: pr.head.sha,
          ref: pr.head.ref,
          repo: {
            id: pr.head.repo?.id || 0,
            name: pr.head.repo?.name || '',
            full_name: pr.head.repo?.full_name || repository,
            private: pr.head.repo?.private || false,
            html_url: pr.head.repo?.html_url || '',
            clone_url: pr.head.repo?.clone_url || '',
            ssh_url: pr.head.repo?.ssh_url || '',
            owner: {
              id: pr.head.repo?.owner?.id || 0,
              login: pr.head.repo?.owner?.login || '',
              avatar_url: pr.head.repo?.owner?.avatar_url || '',
              html_url: pr.head.repo?.owner?.html_url || '',
              type: (pr.head.repo?.owner?.type as 'User' | 'Bot' | 'Organization') || 'User'
            },
            default_branch: pr.head.repo?.default_branch || 'main'
          }
        },
        base: {
          sha: pr.base.sha,
          ref: pr.base.ref,
          repo: {
            id: pr.base.repo?.id || 0,
            name: pr.base.repo?.name || '',
            full_name: pr.base.repo?.full_name || repository,
            private: pr.base.repo?.private || false,
            html_url: pr.base.repo?.html_url || '',
            clone_url: pr.base.repo?.clone_url || '',
            ssh_url: pr.base.repo?.ssh_url || '',
            owner: {
              id: pr.base.repo?.owner?.id || 0,
              login: pr.base.repo?.owner?.login || '',
              avatar_url: pr.base.repo?.owner?.avatar_url || '',
              html_url: pr.base.repo?.owner?.html_url || '',
              type: (pr.base.repo?.owner?.type as 'User' | 'Bot' | 'Organization') || 'User'
            },
            default_branch: pr.base.repo?.default_branch || 'main'
          }
        },
        changed_files: pr.changed_files,
        additions: pr.additions,
        deletions: pr.deletions
      };

      this.logger.info('PR obtenido exitosamente', {
        prNumber: result.number,
        title: result.title,
        changedFiles: result.changed_files,
        additions: result.additions,
        deletions: result.deletions
      });

      return result;

    } catch (error) {
      this.logger.error('Error obteniendo PR desde GitHub', {
        repository,
        prNumber,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      if (error instanceof Error && error.message.includes('404')) {
        throw new NotFoundError('Pull Request', `${repository}#${prNumber}`);
      }

      throw new GitHubAPIError('Failed to fetch pull request', undefined, {
        repository,
        prNumber,
        originalError: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // =============================================================================
  // OBTENER CAMBIOS DE ARCHIVOS
  // =============================================================================

  async getFileChanges(repository: string, prNumber: number): Promise<FileChange[]> {
    const [owner, repo] = repository.split('/');
    
    try {
      this.logger.info('Obteniendo cambios de archivos', {
        repository,
        prNumber,
        owner,
        repo
      });

      const response = await this.octokit.rest.pulls.listFiles({
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100 // GitHub máximo
      });

      const fileChanges: FileChange[] = response.data.map((file: any) => ({
        filename: file.filename,
        status: file.status as 'added' | 'modified' | 'removed' | 'renamed',
        additions: file.additions,
        deletions: file.deletions,
        patch: file.patch,
        previous_filename: file.previous_filename || undefined
      }));

      this.logger.info('Cambios de archivos obtenidos', {
        repository,
        prNumber,
        filesCount: fileChanges.length,
        totalAdditions: fileChanges.reduce((sum, file) => sum + file.additions, 0),
        totalDeletions: fileChanges.reduce((sum, file) => sum + file.deletions, 0)
      });

      return fileChanges;

    } catch (error) {
      this.logger.error('Error obteniendo cambios de archivos', {
        repository,
        prNumber,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      if (error instanceof Error && error.message.includes('404')) {
        throw new NotFoundError('Pull Request files', `${repository}#${prNumber}`);
      }

      throw new GitHubAPIError('Failed to fetch file changes', undefined, {
        repository,
        prNumber,
        originalError: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // =============================================================================
  // CREAR COMENTARIO DE REVISIÓN
  // =============================================================================

  async createReviewComment(
    repository: string, 
    prNumber: number, 
    comment: ReviewComment
  ): Promise<void> {
    const [owner, repo] = repository.split('/');
    
    try {
      this.logger.info('Creando comentario de revisión', {
        repository,
        prNumber,
        hasPath: !!comment.path,
        hasLine: !!comment.line,
        bodyLength: comment.body.length
      });

      if (comment.path && comment.line) {
        // Comentario en línea específica
        await this.octokit.rest.pulls.createReviewComment({
          owner,
          repo,
          pull_number: prNumber,
          body: comment.body,
          path: comment.path,
          line: comment.line,
          side: comment.side || 'RIGHT',
          start_line: comment.start_line,
          start_side: comment.start_side
        });
      } else {
        // Comentario general en el PR
        await this.octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: prNumber,
          body: comment.body
        });
      }

      this.logger.info('Comentario creado exitosamente', {
        repository,
        prNumber,
        commentType: comment.path ? 'line-comment' : 'general-comment'
      });

    } catch (error) {
      this.logger.error('Error creando comentario', {
        repository,
        prNumber,
        error: error instanceof Error ? error.message : 'Unknown error',
        path: comment.path,
        line: comment.line
      });

      // No fallar todo el procesamiento por un comentario
      // Solo logear el error y continuar
      this.logger.warn('Comentario omitido debido a error', {
        repository,
        prNumber,
        path: comment.path,
        line: comment.line
      });
    }
  }

  // =============================================================================
  // VALIDACIÓN DE CONFIGURACIÓN
  // =============================================================================

  private validateConfiguration(): void {
    if (!process.env.GITHUB_TOKEN) {
      throw new GitHubAPIError('GitHub token not configured', undefined, {
        envVar: 'GITHUB_TOKEN'
      });
    }
  }
}