// =============================================================================
// DEPENDENCY ANALYZER - PR PROCESSOR
// =============================================================================

import { DependencyIndexLoader } from '../../dependency-indexer/core/DependencyIndexLoader.js';
import { S3Storage } from '../../dependency-indexer/storage/S3Storage.js';
import type { 
    DependencyIndex, 
    ClassInfo, 
    MethodInfo,
    BreakingChange,
    FileAnalysis
} from '../../dependency-indexer/types/DependencyTypes.js';
import type { FileChange } from '../shared/types/index.js';
import type { ServiceConfig } from '../shared/types/index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface DependencyAnalysisRequest {
    repository: string;
    fileChanges: FileChange[];
    prNumber: number;
}

export interface DependencyAnalysisResult {
    breakingChanges: BreakingChange[];
    affectedFiles: string[];
    affectedClasses: string[];
    affectedMethods: string[];
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    dependencies: {
        added: string[];
        removed: string[];
        modified: string[];
    };
    summary: string;
}

// =============================================================================
// DEPENDENCY ANALYZER CLASS
// =============================================================================

export class DependencyAnalyzer {
    private readonly logger: ServiceConfig['logger'];
    private indexLoader: DependencyIndexLoader;
    private currentIndex: DependencyIndex | null = null;
    private currentRepository: string | null = null;

    constructor(config: ServiceConfig) {
        this.logger = config.logger;
        
        // Inicializar con S3Storage para producción
        const storage = new S3Storage(process.env.DEPENDENCY_INDEX_BUCKET);
        this.indexLoader = new DependencyIndexLoader(storage);
    }

    // =============================================================================
    // INICIALIZACIÓN
    // =============================================================================

    async initialize(repository: string): Promise<void> {
        // Solo cargar si es un repositorio diferente o no hay índice cargado
        if (this.currentRepository === repository && this.currentIndex) {
            this.logger.info('Index already loaded for repository', { repository });
            return;
        }

        try {
            this.logger.info('Loading dependency index', { repository });
            const startTime = Date.now();
            
            // Generar key basado en el nombre del repositorio
            const indexKey = repository.replace('/', '-').toLowerCase();
            this.currentIndex = await this.indexLoader.loadIndex(indexKey);
            
            if (!this.currentIndex) {
                this.logger.warn('No dependency index found for repository', { repository });
                return;
            }

            this.currentRepository = repository;
            const loadTime = Date.now() - startTime;
            
            this.logger.info('Dependency index loaded successfully', {
                repository,
                loadTime,
                classCount: Object.keys(this.currentIndex.index.classes).length,
                fileCount: Object.keys(this.currentIndex.index.files).length
            });
        } catch (error) {
            this.logger.error('Error loading dependency index', {
                repository,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            // No fallar si no se puede cargar el índice
            this.currentIndex = null;
        }
    }

    // =============================================================================
    // ANÁLISIS PRINCIPAL
    // =============================================================================

    async analyzeChanges(request: DependencyAnalysisRequest): Promise<DependencyAnalysisResult> {
        // Asegurar que tenemos el índice cargado
        await this.initialize(request.repository);

        // Si no hay índice, retornar análisis vacío
        if (!this.currentIndex) {
            return this.createEmptyAnalysis();
        }

        const startTime = Date.now();
        
        try {
            this.logger.info('Starting dependency analysis', {
                repository: request.repository,
                prNumber: request.prNumber,
                filesChanged: request.fileChanges.length
            });

            // 1. Analizar breaking changes
            const breakingChanges = this.detectBreakingChanges(request.fileChanges);
            
            // 2. Encontrar archivos afectados
            const affectedFiles = this.findAffectedFiles(request.fileChanges);
            
            // 3. Encontrar clases y métodos afectados
            const affectedClasses = this.findAffectedClasses(request.fileChanges);
            const affectedMethods = this.findAffectedMethods(request.fileChanges);
            
            // 4. Analizar cambios en dependencias
            const dependencyChanges = this.analyzeDependencyChanges(request.fileChanges);
            
            // 5. Calcular nivel de riesgo
            const riskLevel = this.calculateRiskLevel(breakingChanges, affectedFiles);
            
            // 6. Generar resumen
            const summary = this.generateSummary(
                breakingChanges, 
                affectedFiles, 
                dependencyChanges,
                riskLevel
            );

            const analysisTime = Date.now() - startTime;
            
            this.logger.info('Dependency analysis completed', {
                repository: request.repository,
                prNumber: request.prNumber,
                breakingChangesCount: breakingChanges.length,
                affectedFilesCount: affectedFiles.length,
                riskLevel,
                analysisTime
            });

            return {
                breakingChanges,
                affectedFiles,
                affectedClasses,
                affectedMethods,
                riskLevel,
                dependencies: dependencyChanges,
                summary
            };
        } catch (error) {
            this.logger.error('Error during dependency analysis', {
                repository: request.repository,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            
            return this.createEmptyAnalysis();
        }
    }

    // =============================================================================
    // DETECCIÓN DE BREAKING CHANGES
    // =============================================================================

    private detectBreakingChanges(fileChanges: FileChange[]): BreakingChange[] {
        if (!this.currentIndex) return [];
        
        const breakingChanges: BreakingChange[] = [];
        
        for (const change of fileChanges) {
            // Solo analizar archivos Java por ahora
            if (!change.filename.endsWith('.java')) continue;
            
            const fileInfo = this.currentIndex.index.files[change.filename];
            if (!fileInfo) continue;
            
            // Analizar el patch para detectar cambios
            if (change.patch) {
                const removedLines = this.extractRemovedLines(change.patch);
                
                // Detectar métodos públicos eliminados
                for (const line of removedLines) {
                    if (line.includes('public') && (line.includes('(') || line.includes('{'))) {
                        const methodName = this.extractMethodName(line);
                        if (methodName) {
                            breakingChanges.push({
                                type: 'method-removed',
                                severity: 'critical',
                                file: change.filename,
                                description: `Public method '${methodName}' was removed`,
                                suggestion: 'Consider deprecating the method first before removal'
                            });
                        }
                    }
                }
                
                // Detectar cambios en signatures de métodos
                const modifiedMethods = this.detectModifiedMethodSignatures(change.patch);
                for (const method of modifiedMethods) {
                    breakingChanges.push({
                        type: 'signature-changed',
                        severity: 'high',
                        file: change.filename,
                        description: `Method signature changed: ${method}`,
                        suggestion: 'Ensure all callers are updated'
                    });
                }
                
                // Detectar clases renombradas o eliminadas
                if (change.status === 'removed') {
                    const className = this.extractClassNameFromFile(change.filename);
                    breakingChanges.push({
                        type: 'class-removed',
                        severity: 'critical',
                        file: change.filename,
                        description: `Class '${className}' was removed`,
                        suggestion: 'Check all references to this class'
                    });
                }
            }
        }
        
        return breakingChanges;
    }

    // =============================================================================
    // BÚSQUEDA DE ARCHIVOS AFECTADOS
    // =============================================================================

    private findAffectedFiles(fileChanges: FileChange[]): string[] {
        if (!this.currentIndex) return [];
        
        const affectedFiles = new Set<string>();
        
        for (const change of fileChanges) {
            // Buscar qué archivos dependen del archivo modificado
            const className = this.extractClassNameFromFile(change.filename);
            
            if (className) {
                // Buscar en todas las clases cuáles importan o usan esta clase
                for (const [file, metadata] of Object.entries(this.currentIndex.index.files)) {
                    if (file === change.filename) continue;
                    
                    // Aquí buscaríamos en el índice de dependencias
                    // Por ahora, simularemos encontrando archivos relacionados
                    if (metadata && file.includes(className.toLowerCase())) {
                        affectedFiles.add(file);
                    }
                }
            }
        }
        
        return Array.from(affectedFiles);
    }

    // =============================================================================
    // BÚSQUEDA DE CLASES Y MÉTODOS AFECTADOS
    // =============================================================================

    private findAffectedClasses(fileChanges: FileChange[]): string[] {
        if (!this.currentIndex) return [];
        
        const affectedClasses = new Set<string>();
        
        for (const change of fileChanges) {
            const className = this.extractClassNameFromFile(change.filename);
            if (className) {
                affectedClasses.add(className);
                
                // Buscar clases que extienden o implementan esta clase
                const classInfo = this.currentIndex.index.classes[className];
                if (classInfo && classInfo.dependencies) {
                    classInfo.dependencies.forEach(dep => affectedClasses.add(dep));
                }
            }
        }
        
        return Array.from(affectedClasses);
    }

    private findAffectedMethods(fileChanges: FileChange[]): string[] {
        if (!this.currentIndex) return [];
        
        const affectedMethods = new Set<string>();
        
        for (const change of fileChanges) {
            if (!change.patch) continue;
            
            // Extraer nombres de métodos del patch
            const lines = change.patch.split('\n');
            for (const line of lines) {
                if (line.includes('public') || line.includes('protected')) {
                    const methodName = this.extractMethodName(line);
                    if (methodName) {
                        affectedMethods.add(methodName);
                    }
                }
            }
        }
        
        return Array.from(affectedMethods);
    }

    // =============================================================================
    // ANÁLISIS DE CAMBIOS EN DEPENDENCIAS
    // =============================================================================

    private analyzeDependencyChanges(fileChanges: FileChange[]): DependencyAnalysisResult['dependencies'] {
        const dependencies = {
            added: [] as string[],
            removed: [] as string[],
            modified: [] as string[]
        };
        
        for (const change of fileChanges) {
            // Analizar cambios en archivos de configuración de dependencias
            if (change.filename === 'pom.xml' || 
                change.filename === 'build.gradle' || 
                change.filename === 'package.json') {
                
                if (change.patch) {
                    const addedDeps = this.extractAddedDependencies(change.patch);
                    const removedDeps = this.extractRemovedDependencies(change.patch);
                    
                    dependencies.added.push(...addedDeps);
                    dependencies.removed.push(...removedDeps);
                }
            }
        }
        
        return dependencies;
    }

    // =============================================================================
    // CÁLCULO DE NIVEL DE RIESGO
    // =============================================================================

    private calculateRiskLevel(
        breakingChanges: BreakingChange[], 
        affectedFiles: string[]
    ): DependencyAnalysisResult['riskLevel'] {
        const criticalChanges = breakingChanges.filter(c => c.severity === 'critical').length;
        const highChanges = breakingChanges.filter(c => c.severity === 'high').length;
        
        if (criticalChanges > 0) return 'critical';
        if (highChanges >= 3 || affectedFiles.length > 10) return 'high';
        if (highChanges > 0 || affectedFiles.length > 5) return 'medium';
        
        return 'low';
    }

    // =============================================================================
    // UTILIDADES PRIVADAS
    // =============================================================================

    private extractRemovedLines(patch: string): string[] {
        return patch.split('\n')
            .filter(line => line.startsWith('-') && !line.startsWith('---'))
            .map(line => line.substring(1));
    }

    private extractMethodName(line: string): string | null {
        const methodMatch = line.match(/(\w+)\s*\(/);
        return methodMatch ? methodMatch[1] : null;
    }

    private extractClassNameFromFile(filename: string): string {
        const parts = filename.split('/');
        const fileName = parts[parts.length - 1];
        return fileName.replace('.java', '').replace('.ts', '').replace('.js', '');
    }

    private detectModifiedMethodSignatures(patch: string): string[] {
        const modified: string[] = [];
        const lines = patch.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith('-') && (line.includes('public') || line.includes('protected'))) {
                const nextLine = lines[i + 1];
                if (nextLine && nextLine.startsWith('+') && (nextLine.includes('public') || nextLine.includes('protected'))) {
                    const methodName = this.extractMethodName(line);
                    if (methodName) {
                        modified.push(methodName);
                    }
                }
            }
        }
        
        return modified;
    }

    private extractAddedDependencies(patch: string): string[] {
        const added: string[] = [];
        const lines = patch.split('\n').filter(line => line.startsWith('+'));
        
        for (const line of lines) {
            // Maven
            if (line.includes('<dependency>') || line.includes('<artifactId>')) {
                const match = line.match(/<artifactId>(.*?)<\/artifactId>/);
                if (match) added.push(match[1]);
            }
            // Gradle
            if (line.includes('implementation') || line.includes('compile')) {
                const match = line.match(/['"]([^'"]+)['"]/);
                if (match) added.push(match[1]);
            }
            // NPM
            if (line.includes('"') && line.includes(':')) {
                const match = line.match(/"([^"]+)":\s*"[^"]+"/);
                if (match && !match[1].startsWith('@')) added.push(match[1]);
            }
        }
        
        return added;
    }

    private extractRemovedDependencies(patch: string): string[] {
        const removed: string[] = [];
        const lines = patch.split('\n').filter(line => line.startsWith('-'));
        
        for (const line of lines) {
            // Similar lógica que extractAddedDependencies pero para líneas removidas
            if (line.includes('<artifactId>')) {
                const match = line.match(/<artifactId>(.*?)<\/artifactId>/);
                if (match) removed.push(match[1]);
            }
        }
        
        return removed;
    }

    private generateSummary(
        breakingChanges: BreakingChange[],
        affectedFiles: string[],
        dependencies: DependencyAnalysisResult['dependencies'],
        riskLevel: DependencyAnalysisResult['riskLevel']
    ): string {
        const parts: string[] = [];
        
        if (breakingChanges.length > 0) {
            parts.push(`${breakingChanges.length} breaking changes detected`);
        }
        
        if (affectedFiles.length > 0) {
            parts.push(`${affectedFiles.length} files potentially affected`);
        }
        
        if (dependencies.added.length > 0) {
            parts.push(`${dependencies.added.length} new dependencies added`);
        }
        
        if (dependencies.removed.length > 0) {
            parts.push(`${dependencies.removed.length} dependencies removed`);
        }
        
        parts.push(`Risk level: ${riskLevel}`);
        
        return parts.join('. ');
    }

    private createEmptyAnalysis(): DependencyAnalysisResult {
        return {
            breakingChanges: [],
            affectedFiles: [],
            affectedClasses: [],
            affectedMethods: [],
            riskLevel: 'low',
            dependencies: {
                added: [],
                removed: [],
                modified: []
            },
            summary: 'No dependency index available for analysis'
        };
    }
}