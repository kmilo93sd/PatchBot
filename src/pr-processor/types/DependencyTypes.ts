// Tipos para el sistema de índices de dependencias
// Copiado de dependency-indexer para evitar dependencias externas

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