// Detector de lenguajes de programación

export class LanguageDetector {
    private extensionMap: Map<string, string> = new Map([
        // Java
        ['.java', 'java'],
        ['.kt', 'kotlin'],
        ['.scala', 'scala'],
        
        // JavaScript/TypeScript
        ['.js', 'javascript'],
        ['.jsx', 'javascript'],
        ['.ts', 'typescript'],
        ['.tsx', 'typescript'],
        ['.mjs', 'javascript'],
        ['.cjs', 'javascript'],
        
        // Python
        ['.py', 'python'],
        ['.pyw', 'python'],
        ['.pyi', 'python'],
        
        // C#/.NET
        ['.cs', 'csharp'],
        ['.vb', 'vbnet'],
        ['.fs', 'fsharp'],
        
        // Go
        ['.go', 'go'],
        
        // Ruby
        ['.rb', 'ruby'],
        ['.rake', 'ruby'],
        
        // PHP
        ['.php', 'php'],
        
        // C/C++
        ['.c', 'c'],
        ['.h', 'c'],
        ['.cpp', 'cpp'],
        ['.cc', 'cpp'],
        ['.cxx', 'cpp'],
        ['.hpp', 'cpp'],
        
        // Rust
        ['.rs', 'rust'],
        
        // Swift
        ['.swift', 'swift'],
    ]);

    detectLanguage(filePath: string): string | null {
        const path = filePath.toLowerCase();
        
        // Buscar por extensión
        for (const [ext, lang] of this.extensionMap) {
            if (path.endsWith(ext)) {
                return lang;
            }
        }
        
        // Casos especiales por nombre de archivo
        if (path.endsWith('dockerfile')) return 'dockerfile';
        if (path.endsWith('makefile')) return 'makefile';
        if (path.endsWith('rakefile')) return 'ruby';
        if (path.endsWith('gemfile')) return 'ruby';
        if (path.endsWith('package.json')) return 'json';
        if (path.endsWith('pom.xml')) return 'maven';
        if (path.endsWith('build.gradle')) return 'gradle';
        
        return null;
    }

    isSourceFile(filePath: string): boolean {
        const language = this.detectLanguage(filePath);
        return language !== null && 
               language !== 'json' && 
               language !== 'maven' && 
               language !== 'gradle' &&
               language !== 'dockerfile' &&
               language !== 'makefile';
    }

    getLanguageStats(files: string[]): Map<string, number> {
        const stats = new Map<string, number>();
        
        for (const file of files) {
            const language = this.detectLanguage(file);
            if (language && this.isSourceFile(file)) {
                stats.set(language, (stats.get(language) || 0) + 1);
            }
        }
        
        return stats;
    }

    getPrimaryLanguage(files: string[]): string | null {
        const stats = this.getLanguageStats(files);
        
        if (stats.size === 0) return null;
        
        let maxCount = 0;
        let primaryLang: string | null = null;
        
        for (const [lang, count] of stats) {
            if (count > maxCount) {
                maxCount = count;
                primaryLang = lang;
            }
        }
        
        return primaryLang;
    }
}