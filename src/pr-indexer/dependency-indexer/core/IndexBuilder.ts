// Constructor principal del índice de dependencias

import { LanguageStrategy } from '../types/DependencyTypes.js';
import { LanguageDetector } from './LanguageDetector.js';
import { StorageAdapter } from '../storage/StorageAdapter.js';
import { DependencyIndex, FileInfo, ClassInfo, DependencyRelation } from '../types/DependencyTypes.js';

export class IndexBuilder {
    private strategies: Map<string, LanguageStrategy> = new Map();
    private languageDetector: LanguageDetector;
    private storage: StorageAdapter;

    constructor(storage: StorageAdapter) {
        this.languageDetector = new LanguageDetector();
        this.storage = storage;
    }

    registerStrategy(language: string, strategy: LanguageStrategy): void {
        this.strategies.set(language, strategy);
        console.log(`Estrategia registrada para: ${language}`);
    }

    async buildIndex(repoPath: string, repoName: string): Promise<DependencyIndex> {
        console.log(`\n🔍 Iniciando indexación para ${repoName}`);
        console.log(`📁 Path: ${repoPath}`);

        const files = await this.discoverFiles(repoPath);
        console.log(`📊 Archivos encontrados: ${files.length}`);

        const index: DependencyIndex = {
            repository: repoName,
            lastUpdated: new Date().toISOString(),
            index: {
                classes: {},
                dependencies: {},
                files: {}
            },
            metadata: {
                totalFiles: files.length,
                languages: [],
                indexingDuration: 0
            }
        };

        const startTime = Date.now();
        const languageStats = new Map<string, number>();
        let processedFiles = 0;

        for (const file of files) {
            const language = this.languageDetector.detectLanguage(file.path);
            if (!language || !this.languageDetector.isSourceFile(file.path)) continue;

            languageStats.set(language, (languageStats.get(language) || 0) + 1);

            const strategy = this.strategies.get(language);
            if (!strategy) {
                continue; // Silenciosamente omitir lenguajes sin estrategia
            }

            try {
                processedFiles++;
                process.stdout.write(`\r⚙️  Procesando archivo ${processedFiles}/${files.length}`);
                
                const fileAnalysis = await strategy.analyzeFile(file);
                this.mergeAnalysisIntoIndex(index, fileAnalysis, file, language);
            } catch (error) {
                console.error(`\n❌ Error analizando archivo ${file.relativePath}:`, error);
            }
        }

        console.log('\n');

        index.metadata.indexingDuration = Date.now() - startTime;
        index.metadata.languages = Array.from(languageStats.keys());

        // Guardar el índice
        const indexKey = repoName.replace(/\//g, '-');
        await this.storage.save(indexKey, index);

        console.log(`✅ Indexación completa en ${index.metadata.indexingDuration}ms`);
        console.log(`📈 Estadísticas por lenguaje:`);
        for (const [lang, count] of languageStats) {
            console.log(`   - ${lang}: ${count} archivos`);
        }
        console.log(`📦 Clases encontradas: ${Object.keys(index.index.classes).length}`);
        console.log(`🔗 Dependencias mapeadas: ${Object.keys(index.index.dependencies).length}`);

        return index;
    }

    private async discoverFiles(repoPath: string): Promise<FileInfo[]> {
        const fs = await import('fs/promises');
        const path = await import('path');
        const files: FileInfo[] = [];

        async function walkDir(dir: string): Promise<void> {
            const entries = await fs.readdir(dir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);

                if (entry.isDirectory()) {
                    // Skip common ignore patterns
                    const ignoreDirs = [
                        'node_modules', '.git', 'target', 'build', 'dist', 
                        '.idea', '.vscode', 'out', 'bin', '.gradle', '.mvn',
                        '__pycache__', '.pytest_cache', 'venv', '.env'
                    ];
                    
                    if (ignoreDirs.includes(entry.name)) {
                        continue;
                    }
                    await walkDir(fullPath);
                } else if (entry.isFile()) {
                    try {
                        const stats = await fs.stat(fullPath);
                        const content = await fs.readFile(fullPath, 'utf-8');
                        
                        files.push({
                            path: fullPath,
                            relativePath: path.relative(repoPath, fullPath).replace(/\\/g, '/'),
                            content,
                            size: stats.size,
                            lastModified: stats.mtime
                        });
                    } catch (error) {
                        // Ignorar archivos que no se pueden leer (binarios, etc.)
                    }
                }
            }
        }

        await walkDir(repoPath);
        return files;
    }

    private mergeAnalysisIntoIndex(
        index: DependencyIndex, 
        analysis: any, 
        file: FileInfo,
        language: string
    ): void {
        // Store file info
        index.index.files[file.relativePath] = {
            path: file.relativePath,
            language,
            size: file.size,
            lastModified: file.lastModified.toISOString(),
            classes: analysis.classes ? analysis.classes.map((c: any) => c.name) : []
        };

        // Merge classes
        if (analysis.classes) {
            for (const classInfo of analysis.classes) {
                const className = classInfo.name;
                index.index.classes[className] = {
                    ...classInfo,
                    path: file.relativePath
                };
            }
        }

        // Merge dependencies
        if (analysis.dependencies) {
            for (const dep of analysis.dependencies) {
                const key = `${dep.from} -> ${dep.to}`;
                index.index.dependencies[key] = {
                    ...dep,
                    file: file.relativePath
                };
            }
        }
    }

    async loadIndex(repoName: string): Promise<DependencyIndex | null> {
        const indexKey = repoName.replace(/\//g, '-');
        return await this.storage.load(indexKey);
    }
}