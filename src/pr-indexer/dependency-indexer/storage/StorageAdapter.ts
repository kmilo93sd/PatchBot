// Abstracción para almacenamiento de índices
// Permite usar archivos locales o S3 sin cambiar el código

import { DependencyIndex } from '../types/DependencyTypes.js';

export interface StorageAdapter {
    save(key: string, index: DependencyIndex): Promise<void>;
    load(key: string): Promise<DependencyIndex | null>;
    exists(key: string): Promise<boolean>;
    list(): Promise<string[]>;
}

// Implementación para archivos locales
export class LocalFileStorage implements StorageAdapter {
    private basePath: string;

    constructor(basePath: string = './indexes') {
        this.basePath = basePath;
    }

    async save(key: string, index: DependencyIndex): Promise<void> {
        const fs = await import('fs/promises');
        const path = await import('path');
        
        const filePath = path.join(this.basePath, `${key}.json`);
        const dir = path.dirname(filePath);
        
        // Crear directorio si no existe
        await fs.mkdir(dir, { recursive: true });
        
        // Guardar índice
        await fs.writeFile(
            filePath, 
            JSON.stringify(index, null, 2),
            'utf-8'
        );
        
        console.log(`Índice guardado en: ${filePath}`);
    }

    async load(key: string): Promise<DependencyIndex | null> {
        const fs = await import('fs/promises');
        const path = await import('path');
        
        const filePath = path.join(this.basePath, `${key}.json`);
        
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            return JSON.parse(content) as DependencyIndex;
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                return null;
            }
            throw error;
        }
    }

    async exists(key: string): Promise<boolean> {
        const fs = await import('fs/promises');
        const path = await import('path');
        
        const filePath = path.join(this.basePath, `${key}.json`);
        
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    async list(): Promise<string[]> {
        const fs = await import('fs/promises');
        const path = await import('path');
        
        try {
            const files = await fs.readdir(this.basePath);
            return files
                .filter(f => f.endsWith('.json'))
                .map(f => f.replace('.json', ''));
        } catch {
            return [];
        }
    }
}

// Implementación futura para S3
export class S3Storage implements StorageAdapter {
    private bucketName: string;
    private prefix: string;

    constructor(bucketName: string, prefix: string = 'indexes/') {
        this.bucketName = bucketName;
        this.prefix = prefix;
    }

    async save(key: string, index: DependencyIndex): Promise<void> {
        // TODO: Implementar con AWS SDK
        throw new Error('S3Storage not implemented yet');
    }

    async load(key: string): Promise<DependencyIndex | null> {
        // TODO: Implementar con AWS SDK
        throw new Error('S3Storage not implemented yet');
    }

    async exists(key: string): Promise<boolean> {
        // TODO: Implementar con AWS SDK
        throw new Error('S3Storage not implemented yet');
    }

    async list(): Promise<string[]> {
        // TODO: Implementar con AWS SDK
        throw new Error('S3Storage not implemented yet');
    }
}