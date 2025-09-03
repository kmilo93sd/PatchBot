// =============================================================================
// PR INDEX PROCESSOR - Core Logic
// =============================================================================
// Procesador principal que:
// 1. Clona repositorio en rama del PR
// 2. Ejecuta indexer de dependencias  
// 3. Sube código e índice a S3
// 4. Envía mensaje a cola SQS
// =============================================================================

import { v4 as uuidv4 } from 'uuid';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

import { GitCloner } from '../adapters/gitCloner.js';
import { Octokit } from 'octokit';
import { IndexBuilder } from '../dependency-indexer/core/IndexBuilder.js';
import { S3Storage } from '../dependency-indexer/storage/S3Storage.js';
import { JavaStrategy } from '../dependency-indexer/strategies/JavaStrategy.js';
import { ProcessingError } from '../shared/types/errors.js';

import type { LambdaConfig, PRProcessMessage } from '../shared/types/index.js';
import type { DependencyIndex } from '../dependency-indexer/types/DependencyTypes.js';

// =============================================================================
// TYPES
// =============================================================================

export interface PRIndexRequest {
  action: string;
  repository: string;
  prNumber: number;
}

export interface PRIndexResult {
  jobId: string;
  indexedFiles: number;
  s3Keys: {
    codeArchive: string;
    indexFile: string;
  };
}

// =============================================================================
// PR INDEX PROCESSOR CLASS
// =============================================================================

export class PRIndexProcessor {
  private readonly logger: LambdaConfig['logger'];
  private readonly metrics: LambdaConfig['metrics'];
  private readonly sqsClient: SQSClient;
  private readonly s3Client: S3Client;
  private readonly gitCloner: GitCloner;

  constructor(config: LambdaConfig) {
    this.logger = config.logger;
    this.metrics = config.metrics;
    
    // Initialize AWS clients
    this.sqsClient = new SQSClient({
      region: process.env.AWS_REGION || 'us-east-1'
    });
    
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1'
    });

    this.gitCloner = new GitCloner({
      logger: this.logger,
      tempDir: '/tmp'
    });
  }

  // =============================================================================
  // PROCESAMIENTO PRINCIPAL
  // =============================================================================

  async processPullRequest(request: PRIndexRequest): Promise<PRIndexResult> {
    const jobId = uuidv4();
    const startTime = Date.now();

    this.logger.info('Starting PR indexing process', {
      jobId,
      repository: request.repository,
      prNumber: request.prNumber,
      action: request.action
    });

    try {
      // 1. Obtener información del PR desde GitHub
      this.logger.info('Step 1: Fetching PR info from GitHub', { jobId });
      const prInfo = await this.fetchPullRequestInfo(request.repository, request.prNumber);
      
      // 2. Clonar repositorio en la rama del PR
      this.logger.info('Step 2: Cloning repository', { jobId });
      const cloneResult = await this.cloneRepository({
        ...request,
        sha: prInfo.sha,
        branch: prInfo.branch,
        cloneUrl: prInfo.cloneUrl
      });
      
      // 3. Ejecutar indexer de dependencias
      this.logger.info('Step 3: Building dependency index', { jobId });
      const indexResult = await this.buildDependencyIndex(
        cloneResult.localPath, 
        request.repository,
        jobId
      );

      // 3. Subir código e índice a S3
      this.logger.info('Step 3: Uploading to S3', { jobId });
      const s3Keys = await this.uploadToS3(
        cloneResult.localPath,
        indexResult,
        request,
        jobId
      );

      // 4. Enviar mensaje a cola SQS
      this.logger.info('Step 4: Sending message to SQS', { jobId });
      await this.sendToProcessingQueue(request, jobId, s3Keys);

      // 5. Limpiar archivos temporales
      await this.cleanup(cloneResult.localPath);

      const processingTime = Date.now() - startTime;
      
      this.logger.info('PR indexing completed successfully', {
        jobId,
        repository: request.repository,
        processingTime,
        indexedFiles: Object.keys(indexResult.index.files).length
      });

      // Métricas
      this.metrics?.addMetric('IndexBuildTime', 'Milliseconds', indexResult.metadata.indexingDuration);
      this.metrics?.addMetric('TotalProcessingTime', 'Milliseconds', processingTime);
      this.metrics?.addMetric('FilesIndexed', 'Count', Object.keys(indexResult.index.files).length);

      return {
        jobId,
        indexedFiles: Object.keys(indexResult.index.files).length,
        s3Keys
      };

    } catch (error) {
      this.logger.error('Error during PR indexing', {
        jobId,
        repository: request.repository,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });

      // Intentar limpiar en caso de error
      try {
        const tempPath = `/tmp/${jobId}`;
        await this.cleanup(tempPath);
      } catch (cleanupError) {
        this.logger.warn('Failed to cleanup temp files', { jobId, cleanupError });
      }

      throw error instanceof ProcessingError ? error : 
        new ProcessingError('Failed to process PR indexing', { jobId });
    }
  }

  // =============================================================================
  // PASO 1: OBTENER INFO DEL PR DESDE GITHUB
  // =============================================================================

  private async fetchPullRequestInfo(repository: string, prNumber: number): Promise<{
    sha: string;
    branch: string;
    cloneUrl: string;
  }> {
    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
      throw new ProcessingError('GITHUB_TOKEN not configured');
    }

    const octokit = new Octokit({ auth: githubToken });
    
    try {
      const [owner, repo] = repository.split('/');
      const { data: pr } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber
      });

      return {
        sha: pr.head.sha,
        branch: pr.head.ref,
        cloneUrl: `https://${githubToken}@github.com/${repository}.git`
      };
    } catch (error) {
      throw new ProcessingError('Failed to fetch PR info from GitHub', {
        repository,
        prNumber,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // =============================================================================
  // PASO 2: CLONAR REPOSITORIO
  // =============================================================================

  private async cloneRepository(request: PRIndexRequest & { sha: string; branch: string; cloneUrl: string }): Promise<{
    localPath: string;
    commitSha: string;
  }> {
    try {
      return await this.gitCloner.cloneBranch({
        repoUrl: request.cloneUrl,
        branch: request.branch,
        targetSha: request.sha,
        workingDir: `/tmp/${uuidv4()}`
      });
    } catch (error) {
      throw new ProcessingError('Failed to clone repository', {
        repository: request.repository,
        branch: request.branch,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // =============================================================================
  // PASO 2: CONSTRUIR ÍNDICE DE DEPENDENCIAS
  // =============================================================================

  private async buildDependencyIndex(
    repoPath: string, 
    repoName: string,
    jobId: string
  ): Promise<DependencyIndex> {
    try {
      // Usar storage temporal (no guardar aún en S3)
      const tempStorage = new TempStorage();
      const indexBuilder = new IndexBuilder(tempStorage);

      // Registrar estrategias de lenguaje
      indexBuilder.registerStrategy('java', new JavaStrategy());
      
      // TODO: Agregar más estrategias según necesidades
      // indexBuilder.registerStrategy('typescript', new TypeScriptStrategy());
      // indexBuilder.registerStrategy('javascript', new JavaScriptStrategy());

      this.logger.info('Building dependency index', {
        jobId,
        repoPath,
        repoName
      });

      const index = await indexBuilder.buildIndex(repoPath, repoName);

      this.logger.info('Dependency index built successfully', {
        jobId,
        totalClasses: Object.keys(index.index.classes).length,
        totalFiles: Object.keys(index.index.files).length,
        totalDependencies: Object.keys(index.index.dependencies).length,
        languages: index.metadata.languages,
        buildTime: index.metadata.indexingDuration
      });

      return index;

    } catch (error) {
      throw new ProcessingError('Failed to build dependency index', {
        repoPath,
        repoName,
        jobId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // =============================================================================
  // PASO 3: SUBIR A S3
  // =============================================================================

  private async uploadToS3(
    repoPath: string,
    index: DependencyIndex,
    request: PRIndexRequest,
    jobId: string
  ): Promise<PRIndexResult['s3Keys']> {
    try {
      const bucketName = process.env.PR_ARTIFACTS_BUCKET;
      if (!bucketName) {
        throw new ProcessingError('PR_ARTIFACTS_BUCKET environment variable not set');
      }

      const baseKey = `${request.repository}/${request.prNumber}/${jobId}`;

      // 1. Crear archivo tar.gz del código
      const codeArchivePath = await this.createCodeArchive(repoPath, jobId);
      const codeKey = `${baseKey}/code.tar.gz`;

      // 2. Subir archivo de código
      await this.uploadFileToS3(bucketName, codeKey, codeArchivePath);

      // 3. Subir índice JSON
      const indexKey = `${baseKey}/dependency-index.json`;
      await this.uploadJsonToS3(bucketName, indexKey, index);

      this.logger.info('Files uploaded to S3 successfully', {
        jobId,
        codeKey,
        indexKey,
        bucket: bucketName
      });

      return {
        codeArchive: codeKey,
        indexFile: indexKey
      };

    } catch (error) {
      throw new ProcessingError('Failed to upload to S3', {
        jobId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async createCodeArchive(repoPath: string, jobId: string): Promise<string> {
    const { execSync } = await import('child_process');
    const archivePath = `/tmp/${jobId}-code.tar.gz`;
    
    try {
      // Crear tar.gz excluyendo .git y otros directorios innecesarios
      execSync(
        `cd "${repoPath}" && tar -czf "${archivePath}" --exclude='.git' --exclude='node_modules' --exclude='target' --exclude='build' .`,
        { stdio: 'pipe' }
      );
      
      return archivePath;
    } catch (error) {
      throw new ProcessingError('Failed to create code archive', { 
        repoPath, 
        archivePath, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }

  private async uploadFileToS3(bucket: string, key: string, filePath: string): Promise<void> {
    const fs = await import('fs/promises');
    const fileContent = await fs.readFile(filePath);
    
    await this.s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fileContent,
      ContentType: 'application/gzip'
    }));
  }

  private async uploadJsonToS3(bucket: string, key: string, data: any): Promise<void> {
    await this.s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(data, null, 2),
      ContentType: 'application/json'
    }));
  }

  // =============================================================================
  // PASO 4: ENVIAR A COLA SQS
  // =============================================================================

  private async sendToProcessingQueue(
    request: PRIndexRequest, 
    jobId: string, 
    s3Keys: PRIndexResult['s3Keys']
  ): Promise<void> {
    try {
      const queueUrl = process.env.PR_PROCESS_QUEUE_URL;
      if (!queueUrl) {
        throw new ProcessingError('PR_PROCESS_QUEUE_URL environment variable not set');
      }

      const message: PRProcessMessage = {
        jobId,
        timestamp: new Date().toISOString(),
        payload: {
          jobId,
          action: request.action,
          repository: request.repository,
          prNumber: request.prNumber,
          sha: request.sha,
          branch: request.branch,
          artifacts: {
            codeArchive: s3Keys.codeArchive,
            dependencyIndex: s3Keys.indexFile
          }
        }
      };

      await this.sqsClient.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(message),
        MessageAttributes: {
          repository: {
            DataType: 'String',
            StringValue: request.repository
          },
          prNumber: {
            DataType: 'Number',
            StringValue: request.prNumber.toString()
          },
          jobType: {
            DataType: 'String',
            StringValue: 'pr-review'
          }
        }
      }));

      this.logger.info('Message sent to processing queue', {
        jobId,
        queueUrl,
        repository: request.repository,
        prNumber: request.prNumber
      });

    } catch (error) {
      throw new ProcessingError('Failed to send message to SQS', {
        jobId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // =============================================================================
  // UTILIDADES
  // =============================================================================

  private async cleanup(path: string): Promise<void> {
    try {
      const { execSync } = await import('child_process');
      execSync(`rm -rf "${path}"`, { stdio: 'ignore' });
      this.logger.info('Temp files cleaned up', { path });
    } catch (error) {
      this.logger.warn('Failed to cleanup temp files', { 
        path, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }
}

// =============================================================================
// TEMP STORAGE IMPLEMENTATION
// =============================================================================

class TempStorage {
  async save(key: string, data: any): Promise<void> {
    // No-op - no necesitamos guardar durante la construcción del índice
    return Promise.resolve();
  }

  async load(key: string): Promise<any> {
    // No-op - no necesitamos cargar durante la construcción del índice
    return Promise.resolve(null);
  }
}