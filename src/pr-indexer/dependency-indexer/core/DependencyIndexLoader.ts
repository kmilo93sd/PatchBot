// Loader para cargar índices en memoria Lambda

import { DependencyIndex, ClassInfo, DependencyRelation } from '../types/DependencyTypes.js';
import { StorageAdapter } from '../storage/StorageAdapter.js';

export class DependencyIndexLoader {
    private index: DependencyIndex | null = null;
    private storage: StorageAdapter;
    private loadTime: number = 0;

    constructor(storage: StorageAdapter) {
        this.storage = storage;
    }

    async loadIndex(repoName: string): Promise<void> {
        const startTime = Date.now();
        const indexKey = repoName.replace(/\//g, '-');
        
        console.log(`📥 Cargando índice para ${repoName}...`);
        
        this.index = await this.storage.load(indexKey);
        
        if (!this.index) {
            throw new Error(`Índice no encontrado para ${repoName}`);
        }

        this.loadTime = Date.now() - startTime;
        
        console.log(`✅ Índice cargado en ${this.loadTime}ms`);
        console.log(`   - Clases: ${Object.keys(this.index.index.classes).length}`);
        console.log(`   - Dependencias: ${Object.keys(this.index.index.dependencies).length}`);
        console.log(`   - Archivos: ${Object.keys(this.index.index.files).length}`);
    }

    // Búsqueda de clases por nombre
    findClass(className: string): ClassInfo | null {
        if (!this.index) return null;
        return this.index.index.classes[className] || null;
    }

    // Búsqueda de todas las clases que dependen de una clase específica
    findDependents(className: string): string[] {
        if (!this.index) return [];
        
        const dependents: Set<string> = new Set();
        
        // Buscar en las relaciones de dependencia
        for (const [key, relation] of Object.entries(this.index.index.dependencies)) {
            if (relation.to === className) {
                dependents.add(relation.from);
            }
        }

        // También revisar la información de clase si existe
        const classInfo = this.findClass(className);
        if (classInfo?.dependents) {
            classInfo.dependents.forEach(d => dependents.add(d));
        }

        return Array.from(dependents);
    }

    // Búsqueda de dependencias de una clase
    findDependencies(className: string): string[] {
        if (!this.index) return [];
        
        const classInfo = this.findClass(className);
        return classInfo?.dependencies || [];
    }

    // Búsqueda de métodos en una clase
    findMethodsInClass(className: string): any[] {
        const classInfo = this.findClass(className);
        return classInfo?.publicMethods || [];
    }

    // Búsqueda de archivos por lenguaje
    findFilesByLanguage(language: string): string[] {
        if (!this.index) return [];
        
        return Object.entries(this.index.index.files)
            .filter(([_, meta]) => meta.language === language)
            .map(([path, _]) => path);
    }

    // Búsqueda de clases en un archivo
    findClassesInFile(filePath: string): string[] {
        if (!this.index) return [];
        
        const fileInfo = this.index.index.files[filePath];
        return fileInfo?.classes || [];
    }

    // Análisis de impacto: qué archivos se verían afectados si una clase cambia
    analyzeImpact(className: string): {
        directDependents: string[];
        affectedFiles: string[];
        totalImpact: number;
    } {
        if (!this.index) {
            return { directDependents: [], affectedFiles: [], totalImpact: 0 };
        }

        const directDependents = this.findDependents(className);
        const affectedFiles = new Set<string>();

        // Encontrar archivos de dependientes directos
        for (const dependent of directDependents) {
            const depClass = this.findClass(dependent);
            if (depClass) {
                affectedFiles.add(depClass.path);
            }
        }

        // Buscar dependientes indirectos (segundo nivel)
        const indirectDependents = new Set<string>();
        for (const dependent of directDependents) {
            const secondLevel = this.findDependents(dependent);
            secondLevel.forEach(d => {
                indirectDependents.add(d);
                const depClass = this.findClass(d);
                if (depClass) {
                    affectedFiles.add(depClass.path);
                }
            });
        }

        return {
            directDependents,
            affectedFiles: Array.from(affectedFiles),
            totalImpact: directDependents.length + indirectDependents.size
        };
    }

    // Obtener estadísticas del índice
    getStats(): any {
        if (!this.index) return null;

        return {
            repository: this.index.repository,
            lastUpdated: this.index.lastUpdated,
            totalClasses: Object.keys(this.index.index.classes).length,
            totalDependencies: Object.keys(this.index.index.dependencies).length,
            totalFiles: Object.keys(this.index.index.files).length,
            languages: this.index.metadata.languages,
            loadTimeMs: this.loadTime
        };
    }

    // Verificar si el índice está cargado
    isLoaded(): boolean {
        return this.index !== null;
    }

    // Limpiar el índice de memoria
    clear(): void {
        this.index = null;
        this.loadTime = 0;
    }
}