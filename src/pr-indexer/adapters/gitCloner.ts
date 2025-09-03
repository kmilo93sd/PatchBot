// =============================================================================
// GIT CLONER ADAPTER
// =============================================================================
// Adaptador para clonar repositorios Git en una rama específica
// Optimizado para Lambda con timeouts y limpieza automática
// =============================================================================

import { execSync, spawn } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';
import { ProcessingError } from '../shared/types/errors.js';

// =============================================================================
// TYPES
// =============================================================================

export interface GitCloneConfig {
  logger: any; // Logger de Lambda Powertools
  tempDir: string;
  timeout?: number; // Timeout en ms (default 300000 = 5 min)
}

export interface CloneRequest {
  repoUrl: string;
  branch: string;
  targetSha?: string;
  workingDir: string;
}

export interface CloneResult {
  localPath: string;
  commitSha: string;
}

// =============================================================================
// GIT CLONER CLASS
// =============================================================================

export class GitCloner {
  private readonly logger: any;
  private readonly tempDir: string;
  private readonly timeout: number;

  constructor(config: GitCloneConfig) {
    this.logger = config.logger;
    this.tempDir = config.tempDir;
    this.timeout = config.timeout || 300000; // 5 minutos por defecto
  }

  // =============================================================================
  // CLONADO PRINCIPAL
  // =============================================================================

  async cloneBranch(request: CloneRequest): Promise<CloneResult> {
    const startTime = Date.now();
    let cleanupPaths: string[] = [];

    try {
      this.logger.info('Starting repository clone', {
        repoUrl: this.sanitizeUrl(request.repoUrl),
        branch: request.branch,
        targetSha: request.targetSha,
        workingDir: request.workingDir
      });

      // 1. Crear directorio de trabajo
      await this.ensureDirectory(request.workingDir);
      cleanupPaths.push(request.workingDir);

      // 2. Configurar Git (para evitar warnings)
      this.configureGit();

      // 3. Clonar repositorio (shallow clone para eficiencia)
      const clonePath = await this.performShallowClone(request);

      // 4. Cambiar a la rama específica
      await this.checkoutBranch(clonePath, request.branch);

      // 5. Si se especifica un SHA, hacer checkout a ese commit
      let finalSha = request.targetSha;
      if (request.targetSha) {
        finalSha = await this.checkoutSha(clonePath, request.targetSha);
      } else {
        finalSha = await this.getCurrentSha(clonePath);
      }

      const cloneTime = Date.now() - startTime;

      this.logger.info('Repository clone completed', {
        repoUrl: this.sanitizeUrl(request.repoUrl),
        branch: request.branch,
        finalSha,
        clonePath,
        cloneTime
      });

      return {
        localPath: clonePath,
        commitSha: finalSha
      };

    } catch (error) {
      // Limpiar en caso de error
      for (const path of cleanupPaths) {
        try {
          await this.cleanup(path);
        } catch (cleanupError) {
          this.logger.warn('Failed to cleanup after clone error', {
            path,
            cleanupError: cleanupError instanceof Error ? cleanupError.message : 'Unknown error'
          });
        }
      }

      throw new ProcessingError('Failed to clone repository', {
        repoUrl: this.sanitizeUrl(request.repoUrl),
        branch: request.branch,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // =============================================================================
  // OPERACIONES GIT
  // =============================================================================

  private async performShallowClone(request: CloneRequest): Promise<string> {
    const clonePath = join(request.workingDir, 'repo');
    
    try {
      // Shallow clone de la rama específica para reducir tiempo y espacio
      const cloneCommand = [
        'git', 'clone',
        '--depth', '1',
        '--branch', request.branch,
        '--single-branch',
        request.repoUrl,
        clonePath
      ].join(' ');

      this.logger.info('Executing git clone', {
        command: cloneCommand.replace(request.repoUrl, this.sanitizeUrl(request.repoUrl))
      });

      const result = execSync(cloneCommand, { 
        cwd: request.workingDir, 
        timeout: this.timeout,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8'
      });

      this.logger.info('Git clone completed successfully', {
        repoUrl: this.sanitizeUrl(request.repoUrl),
        branch: request.branch,
        clonePath
      });

      return clonePath;

    } catch (error: any) {
      this.logger.error('Git clone command failed', {
        repoUrl: this.sanitizeUrl(request.repoUrl),
        branch: request.branch,
        clonePath,
        error: error instanceof Error ? error.message : 'Unknown error',
        stderr: error.stderr?.toString(),
        stdout: error.stdout?.toString(),
        status: error.status,
        signal: error.signal
      });

      throw new ProcessingError('Git clone failed', {
        repoUrl: this.sanitizeUrl(request.repoUrl),
        branch: request.branch,
        clonePath,
        error: error instanceof Error ? error.message : 'Unknown error',
        stderr: error.stderr?.toString(),
        stdout: error.stdout?.toString()
      });
    }
  }

  private async checkoutBranch(repoPath: string, branch: string): Promise<void> {
    try {
      // Verificar si ya estamos en la rama correcta
      const currentBranch = execSync('git branch --show-current', {
        cwd: repoPath,
        encoding: 'utf8'
      }).trim();

      if (currentBranch === branch) {
        this.logger.info('Already on target branch', { branch });
        return;
      }

      // Cambiar a la rama
      execSync(`git checkout ${branch}`, {
        cwd: repoPath,
        timeout: this.timeout,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.logger.info('Checked out branch', { branch });

    } catch (error) {
      throw new ProcessingError('Failed to checkout branch', {
        branch,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async checkoutSha(repoPath: string, sha: string): Promise<string> {
    try {
      // Primero verificar si el SHA existe
      const fullSha = execSync(`git rev-parse ${sha}`, {
        cwd: repoPath,
        encoding: 'utf8',
        timeout: this.timeout
      }).trim();

      // Hacer checkout al SHA específico
      execSync(`git checkout ${fullSha}`, {
        cwd: repoPath,
        timeout: this.timeout,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.logger.info('Checked out specific SHA', { sha, fullSha });

      return fullSha;

    } catch (error) {
      // Si el SHA no existe en shallow clone, hacer fetch completo
      this.logger.warn('SHA not found in shallow clone, fetching full history', { sha });
      
      try {
        execSync('git fetch --unshallow', {
          cwd: repoPath,
          timeout: this.timeout,
          stdio: ['ignore', 'pipe', 'pipe']
        });

        const fullSha = execSync(`git rev-parse ${sha}`, {
          cwd: repoPath,
          encoding: 'utf8',
          timeout: this.timeout
        }).trim();

        execSync(`git checkout ${fullSha}`, {
          cwd: repoPath,
          timeout: this.timeout,
          stdio: ['ignore', 'pipe', 'pipe']
        });

        return fullSha;

      } catch (fetchError) {
        throw new ProcessingError('Failed to checkout SHA after fetch', {
          sha,
          error: fetchError instanceof Error ? fetchError.message : 'Unknown error'
        });
      }
    }
  }

  private async getCurrentSha(repoPath: string): Promise<string> {
    try {
      return execSync('git rev-parse HEAD', {
        cwd: repoPath,
        encoding: 'utf8',
        timeout: this.timeout
      }).trim();
    } catch (error) {
      throw new ProcessingError('Failed to get current SHA', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // =============================================================================
  // UTILIDADES
  // =============================================================================

  private configureGit(): void {
    try {
      // Configurar Git para evitar warnings y prompts
      execSync('git config --global user.email "pr-revisor@nubox.com"', { stdio: 'ignore' });
      execSync('git config --global user.name "PR Revisor"', { stdio: 'ignore' });
      execSync('git config --global init.defaultBranch main', { stdio: 'ignore' });
      execSync('git config --global advice.detachedHead false', { stdio: 'ignore' });
    } catch (error) {
      this.logger.warn('Failed to configure git', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async ensureDirectory(path: string): Promise<void> {
    try {
      await fs.mkdir(path, { recursive: true });
      this.logger.info('Working directory created', { path });
    } catch (error) {
      throw new ProcessingError('Failed to create working directory', {
        path,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async cleanup(path: string): Promise<void> {
    try {
      execSync(`rm -rf "${path}"`, { stdio: 'ignore' });
      this.logger.info('Cleaned up temporary files', { path });
    } catch (error) {
      this.logger.warn('Failed to cleanup path', {
        path,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private sanitizeUrl(url: string): string {
    // Remover credenciales de la URL para logs
    return url.replace(/\/\/([^@]+)@/, '//***:***@');
  }

  // =============================================================================
  // VALIDACIONES Y CHECKS
  // =============================================================================

  async validateRepository(repoUrl: string, branch: string): Promise<boolean> {
    try {
      // Hacer un ls-remote para verificar que el repositorio y rama existen
      const lsRemoteCommand = `git ls-remote --heads ${repoUrl} ${branch}`;
      
      const result = execSync(lsRemoteCommand, {
        encoding: 'utf8',
        timeout: 30000, // 30 segundos para validación
        stdio: ['ignore', 'pipe', 'pipe']
      });

      const hasRefs = result.trim().length > 0;
      
      this.logger.info('Repository validation result', {
        repoUrl: this.sanitizeUrl(repoUrl),
        branch,
        valid: hasRefs
      });

      return hasRefs;

    } catch (error) {
      this.logger.error('Repository validation failed', {
        repoUrl: this.sanitizeUrl(repoUrl),
        branch,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  // =============================================================================
  // INFORMACIÓN DEL REPOSITORIO
  // =============================================================================

  async getRepositoryInfo(repoPath: string): Promise<{
    currentBranch: string;
    currentSha: string;
    lastCommitMessage: string;
    fileCount: number;
  }> {
    try {
      const currentBranch = execSync('git branch --show-current', {
        cwd: repoPath,
        encoding: 'utf8'
      }).trim();

      const currentSha = await this.getCurrentSha(repoPath);

      const lastCommitMessage = execSync('git log -1 --pretty=%B', {
        cwd: repoPath,
        encoding: 'utf8'
      }).trim();

      // Contar archivos (excluyendo .git)
      const fileCount = execSync('find . -type f ! -path "./.git/*" | wc -l', {
        cwd: repoPath,
        encoding: 'utf8'
      }).trim();

      return {
        currentBranch,
        currentSha,
        lastCommitMessage,
        fileCount: parseInt(fileCount, 10)
      };

    } catch (error) {
      throw new ProcessingError('Failed to get repository info', {
        repoPath,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}