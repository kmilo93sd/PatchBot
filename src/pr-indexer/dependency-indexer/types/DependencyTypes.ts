// Tipos base para el sistema de indexación de dependencias

export interface DependencyIndex {
    repository: string;
    lastUpdated: string;
    index: {
        classes: Record<string, ClassInfo>;
        dependencies: Record<string, DependencyRelation>;
        files: Record<string, FileMetadata>;
    };
    metadata: {
        totalFiles: number;
        languages: string[];
        indexingDuration: number;
    };
}

export interface ClassInfo {
    name: string;
    path: string;
    package?: string;
    publicMethods: MethodInfo[];
    dependencies: string[];
    dependents: string[];
}

export interface MethodInfo {
    name: string;
    signature: string;
    line: number;
    returnType?: string;
    parameters?: ParameterInfo[];
}

export interface ParameterInfo {
    name: string;
    type: string;
}

export interface DependencyRelation {
    from: string;
    to: string;
    type: 'import' | 'extends' | 'implements' | 'field_injection' | 'method_call';
    file: string;
    line: number;
    usage?: string[];
}

export interface FileMetadata {
    path: string;
    language: string;
    size: number;
    lastModified: string;
    classes: string[];
}

export interface FileInfo {
    path: string;
    relativePath: string;
    content: string;
    size: number;
    lastModified: Date;
}

// Interface para estrategias de lenguaje
export interface LanguageStrategy {
    analyzeFile(file: FileInfo): Promise<FileAnalysis>;
    detectBreakingChanges(oldAnalysis: FileAnalysis, newAnalysis: FileAnalysis): BreakingChange[];
}

export interface FileAnalysis {
    classes?: ClassInfo[];
    dependencies?: DependencyRelation[];
    exports?: string[];
    imports?: string[];
}

export interface BreakingChange {
    type: 'method_removed' | 'signature_changed' | 'class_removed' | 'interface_changed';
    severity: 'critical' | 'major' | 'minor';
    description: string;
    affectedFiles?: string[];
    location: {
        file: string;
        line: number;
    };
}