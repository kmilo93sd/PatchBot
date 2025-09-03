// =============================================================================
// S3 INDEX LOADER ADAPTER
// =============================================================================
// Adaptador para cargar índices de dependencias precomputados desde S3
// Reemplaza la generación en tiempo real del DependencyAnalyzer
// =============================================================================

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import type { DependencyIndex } from '../types/DependencyTypes.js';
import { ProcessingError } from '../shared/types/errors.js';

// =============================================================================
// TYPES
// =============================================================================

export interface S3IndexLoaderConfig {
  logger: any;
  bucket?: string;
}

export interface LoadIndexRequest {
  indexKey: string;
  repository: string;
  jobId: string;
}

// =============================================================================
// S3 INDEX LOADER CLASS
// =============================================================================

export class S3IndexLoader {
  private readonly logger: any;
  private readonly s3Client: S3Client;
  private readonly bucket: string;

  constructor(config: S3IndexLoaderConfig) {
    this.logger = config.logger;
    this.bucket = config.bucket || process.env.PR_ARTIFACTS_BUCKET || '';
    
    if (!this.bucket) {
      throw new ProcessingError('S3 bucket not configured for index loading');
    }

    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1'
    });
  }

  // =============================================================================
  // CARGA DE ÍNDICES
  // =============================================================================

  async loadDependencyIndex(request: LoadIndexRequest): Promise<DependencyIndex> {
    const startTime = Date.now();

    try {
      this.logger.info('Loading dependency index from S3', {
        bucket: this.bucket,
        indexKey: request.indexKey,
        repository: request.repository,
        jobId: request.jobId
      });

      // 1. Obtener el archivo del índice desde S3
      const indexData = await this.getIndexFromS3(request.indexKey);

      // 2. Parsear y validar el índice
      const dependencyIndex = this.parseAndValidateIndex(indexData);

      // 3. Verificar que el índice corresponde al repositorio correcto
      this.validateRepository(dependencyIndex, request.repository);

      const loadTime = Date.now() - startTime;

      this.logger.info('Dependency index loaded successfully from S3', {
        jobId: request.jobId,
        repository: request.repository,
        loadTime,
        totalClasses: Object.keys(dependencyIndex.index.classes).length,
        totalFiles: Object.keys(dependencyIndex.index.files).length,
        totalDependencies: Object.keys(dependencyIndex.index.dependencies).length,
        languages: dependencyIndex.metadata.languages,
        lastUpdated: dependencyIndex.lastUpdated
      });

      return dependencyIndex;

    } catch (error) {
      const loadTime = Date.now() - startTime;

      this.logger.error('Failed to load dependency index from S3', {
        jobId: request.jobId,
        repository: request.repository,
        bucket: this.bucket,
        indexKey: request.indexKey,
        loadTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      if (error instanceof ProcessingError) {
        throw error;
      }

      throw new ProcessingError('Failed to load dependency index from S3', {
        jobId: request.jobId,
        repository: request.repository,
        indexKey: request.indexKey,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // =============================================================================
  // OPERACIONES S3
  // =============================================================================

  private async getIndexFromS3(key: string): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key
      });

      const response = await this.s3Client.send(command);

      if (!response.Body) {
        throw new ProcessingError('Empty response from S3');
      }

      // Convertir stream a string
      const chunks: Uint8Array[] = [];
      const reader = response.Body.transformToWebStream().getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const buffer = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0));
      let offset = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.length;
      }

      return new TextDecoder().decode(buffer);

    } catch (error) {
      if (error instanceof Error && error.name === 'NoSuchKey') {
        throw new ProcessingError('Dependency index not found in S3', { key });
      }

      throw new ProcessingError('Failed to retrieve index from S3', {
        key,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private parseAndValidateIndex(jsonData: string): DependencyIndex {
    try {
      const parsed = JSON.parse(jsonData);

      // Validaciones básicas de estructura
      if (!parsed.repository || !parsed.index || !parsed.metadata) {
        throw new ProcessingError('Invalid dependency index structure');
      }

      if (!parsed.index.classes || !parsed.index.dependencies || !parsed.index.files) {
        throw new ProcessingError('Missing required index sections');
      }

      return parsed as DependencyIndex;

    } catch (error) {
      if (error instanceof ProcessingError) {
        throw error;
      }

      throw new ProcessingError('Failed to parse dependency index JSON', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private validateRepository(index: DependencyIndex, expectedRepository: string): void {
    if (index.repository !== expectedRepository) {
      throw new ProcessingError('Repository mismatch in dependency index', {
        expected: expectedRepository,
        actual: index.repository
      });
    }
  }

  // =============================================================================
  // ANÁLISIS DE DEPENDENCIAS
  // =============================================================================

  async analyzeDependencyChanges(
    index: DependencyIndex,
    fileChanges: any[],
    jobId: string
  ): Promise<{
    breakingChanges: any[];
    affectedFiles: string[];
    affectedClasses: string[];
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    summary: string;
  }> {
    try {
      this.logger.info('Analyzing dependency changes using precomputed index', {
        jobId,
        repository: index.repository,
        filesChanged: fileChanges.length
      });

      const breakingChanges: any[] = [];
      const affectedFiles = new Set<string>();
      const affectedClasses = new Set<string>();

      // Analizar cambios usando el índice precomputado
      for (const fileChange of fileChanges) {
        // Solo analizar archivos de código fuente
        if (!this.isSourceFile(fileChange.filename)) continue;

        // Buscar clases en el archivo modificado
        const classesInFile = this.findClassesInFile(index, fileChange.filename);
        
        for (const className of classesInFile) {
          affectedClasses.add(className);

          // Buscar dependientes de esta clase
          const dependents = this.findDependents(index, className);
          dependents.forEach(dep => {
            affectedClasses.add(dep);
            const depClass = index.index.classes[dep];
            if (depClass) {
              affectedFiles.add(depClass.path);
            }
          });

          // Analizar si hay cambios que podrían ser breaking
          if (fileChange.patch) {
            const potentialBreaking = this.detectPotentialBreaking(
              fileChange.patch, 
              className,
              index.index.classes[className]
            );
            breakingChanges.push(...potentialBreaking);
          }
        }

        affectedFiles.add(fileChange.filename);
      }

      // Calcular nivel de riesgo
      const riskLevel = this.calculateRiskLevel(breakingChanges, Array.from(affectedFiles));

      // Generar resumen
      const summary = this.generateSummary(
        breakingChanges,
        Array.from(affectedFiles),
        Array.from(affectedClasses),
        riskLevel
      );

      this.logger.info('Dependency analysis completed', {
        jobId,
        breakingChanges: breakingChanges.length,
        affectedFiles: affectedFiles.size,
        affectedClasses: affectedClasses.size,
        riskLevel
      });

      return {
        breakingChanges,
        affectedFiles: Array.from(affectedFiles),
        affectedClasses: Array.from(affectedClasses),
        riskLevel,
        summary
      };

    } catch (error) {
      this.logger.error('Error analyzing dependency changes', {
        jobId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        breakingChanges: [],
        affectedFiles: [],
        affectedClasses: [],
        riskLevel: 'low',
        summary: 'Failed to analyze dependencies - using basic analysis'
      };
    }
  }

  // =============================================================================
  // UTILIDADES DE ANÁLISIS
  // =============================================================================

  private findClassesInFile(index: DependencyIndex, filePath: string): string[] {
    const fileInfo = index.index.files[filePath];
    return fileInfo ? fileInfo.classes : [];
  }

  private findDependents(index: DependencyIndex, className: string): string[] {
    const dependents = new Set<string>();

    // Buscar en las relaciones de dependencia
    for (const [key, relation] of Object.entries(index.index.dependencies)) {
      if (relation.to === className) {
        dependents.add(relation.from);
      }
    }

    return Array.from(dependents);
  }

  private detectPotentialBreaking(patch: string, className: string, classInfo: any): any[] {
    const breakingChanges: any[] = [];
    
    if (!patch || !classInfo) return breakingChanges;

    const removedLines = patch.split('\n')
      .filter(line => line.startsWith('-') && !line.startsWith('---'))
      .map(line => line.substring(1));

    for (const line of removedLines) {
      // Detectar métodos públicos eliminados
      if (line.includes('public') && (line.includes('(') || line.includes('{'))) {
        const methodMatch = line.match(/public[^(]*(\w+)\s*\(/);
        if (methodMatch) {
          breakingChanges.push({
            type: 'method-removed',
            severity: 'high',
            className,
            methodName: methodMatch[1],
            description: `Public method '${methodMatch[1]}' was removed from ${className}`,
            file: classInfo.path
          });
        }
      }
    }

    return breakingChanges;
  }

  private calculateRiskLevel(breakingChanges: any[], affectedFiles: string[]): 'low' | 'medium' | 'high' | 'critical' {
    const criticalChanges = breakingChanges.filter(c => c.severity === 'critical').length;
    const highChanges = breakingChanges.filter(c => c.severity === 'high').length;
    
    if (criticalChanges > 0) return 'critical';
    if (highChanges >= 3 || affectedFiles.length > 15) return 'high';
    if (highChanges > 0 || affectedFiles.length > 5) return 'medium';
    
    return 'low';
  }

  private generateSummary(
    breakingChanges: any[],
    affectedFiles: string[],
    affectedClasses: string[],
    riskLevel: string
  ): string {
    const parts: string[] = [];

    if (breakingChanges.length > 0) {
      parts.push(`${breakingChanges.length} potential breaking changes detected`);
    }

    if (affectedFiles.length > 0) {
      parts.push(`${affectedFiles.length} files potentially affected`);
    }

    if (affectedClasses.length > 0) {
      parts.push(`${affectedClasses.length} classes impacted`);
    }

    parts.push(`Risk level: ${riskLevel}`);

    return parts.join('. ');
  }

  private isSourceFile(filename: string): boolean {
    const sourceExtensions = ['.java', '.ts', '.js', '.py', '.go', '.cs', '.cpp', '.c'];
    return sourceExtensions.some(ext => filename.endsWith(ext));
  }

  // =============================================================================
  // INFORMACIÓN DEL ÍNDICE
  // =============================================================================

  async getIndexStats(index: DependencyIndex): Promise<{
    repository: string;
    lastUpdated: string;
    totalFiles: number;
    totalClasses: number;
    totalDependencies: number;
    languages: string[];
    indexingDuration: number;
  }> {
    return {
      repository: index.repository,
      lastUpdated: index.lastUpdated,
      totalFiles: Object.keys(index.index.files).length,
      totalClasses: Object.keys(index.index.classes).length,
      totalDependencies: Object.keys(index.index.dependencies).length,
      languages: index.metadata.languages,
      indexingDuration: index.metadata.indexingDuration
    };
  }
}