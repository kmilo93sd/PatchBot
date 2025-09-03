// Estrategia de análisis para Java usando Tree-sitter

import Parser from 'tree-sitter';
import Java from 'tree-sitter-java';
import { 
    LanguageStrategy, 
    FileInfo, 
    FileAnalysis, 
    ClassInfo, 
    MethodInfo, 
    DependencyRelation,
    BreakingChange 
} from '../types/DependencyTypes.js';

export class JavaStrategy implements LanguageStrategy {
    private parser: Parser;

    constructor() {
        this.parser = new Parser();
        this.parser.setLanguage(Java);
    }

    async analyzeFile(file: FileInfo): Promise<FileAnalysis> {
        const tree = this.parser.parse(file.content);
        const rootNode = tree.rootNode;

        const analysis: FileAnalysis = {
            classes: [],
            dependencies: [],
            imports: [],
            exports: []
        };

        // Extraer el paquete
        const packageName = this.extractPackage(rootNode, file.content);

        // Extraer imports
        analysis.imports = this.extractImports(rootNode, file.content);

        // Extraer clases e interfaces
        const classNodes = this.findNodes(rootNode, ['class_declaration', 'interface_declaration']);
        
        for (const classNode of classNodes) {
            const classInfo = this.extractClassInfo(classNode, file, packageName);
            if (classInfo) {
                // Detectar anotaciones importantes de la clase
                const classAnnotations = this.extractAnnotations(classNode, file.content);
                
                // Si tiene @Data de Lombok, agregar getters/setters para todos los campos
                if (this.hasLombokData(classAnnotations)) {
                    this.addLombokMethods(classNode, classInfo, file.content);
                }
                
                analysis.classes!.push(classInfo);
                analysis.exports!.push(classInfo.name);

                // Extraer dependencias de la clase
                const deps = this.extractClassDependencies(classNode, file.content, classInfo.name);
                analysis.dependencies!.push(...deps);
            }
        }

        return analysis;
    }

    private extractPackage(node: Parser.SyntaxNode, content: string): string {
        const packageNodes = this.findNodes(node, ['package_declaration']);
        if (packageNodes.length > 0) {
            const packageNode = packageNodes[0];
            if (packageNode) {
                // El campo 'name' podría ser un scoped_identifier
                for (let i = 0; i < packageNode.childCount; i++) {
                    const child = packageNode.child(i);
                    if (child && (child.type === 'scoped_identifier' || child.type === 'identifier')) {
                        return content.substring(child.startIndex, child.endIndex);
                    }
                }
            }
        }
        return '';
    }

    private extractImports(node: Parser.SyntaxNode, content: string): string[] {
        const imports: string[] = [];
        const importNodes = this.findNodes(node, ['import_declaration']);
        
        for (const importNode of importNodes) {
            const text = content.substring(importNode.startIndex, importNode.endIndex);
            const match = text.match(/import\s+(?:static\s+)?([^;]+);/);
            if (match && match[1]) {
                imports.push(match[1].trim());
            }
        }
        
        return imports;
    }

    private extractClassInfo(
        classNode: Parser.SyntaxNode, 
        file: FileInfo, 
        packageName: string
    ): ClassInfo | null {
        const content = file.content;
        
        // Obtener nombre de la clase
        const nameNode = classNode.childForFieldName('name');
        if (!nameNode) return null;
        
        const className = content.substring(nameNode.startIndex, nameNode.endIndex);
        
        // Extraer métodos públicos
        const methods = this.extractPublicMethods(classNode, content);
        
        // Extraer dependencias directas (extends, implements)
        const dependencies = this.extractDirectDependencies(classNode, content);
        
        return {
            name: className,
            path: file.relativePath,
            package: packageName,
            publicMethods: methods,
            dependencies: dependencies,
            dependents: [] // Se llenará durante el análisis cruzado
        };
    }

    private extractPublicMethods(classNode: Parser.SyntaxNode, content: string): MethodInfo[] {
        const methods: MethodInfo[] = [];
        const isInterface = classNode.type === 'interface_declaration';
        
        // Buscar el cuerpo de la clase/interfaz
        const bodyNode = classNode.childForFieldName('body');
        if (!bodyNode) return methods;
        
        // Buscar métodos en el cuerpo
        for (let i = 0; i < bodyNode.childCount; i++) {
            const child = bodyNode.child(i);
            if (!child) continue;
            
            if (child.type === 'method_declaration' || child.type === 'constructor_declaration') {
                // En interfaces, todos los métodos son públicos por defecto
                let isPublic = isInterface;
                
                // Detectar anotaciones del método (Spring Boot endpoints)
                const methodAnnotations = this.extractMethodAnnotations(child, content);
                const hasEndpointAnnotation = this.hasSpringEndpointAnnotation(methodAnnotations);
                
                // En clases, verificar modificadores
                if (!isInterface) {
                    // Los modifiers pueden estar como campo o como primer hijo
                    let modifiersNode = child.childForFieldName('modifiers');
                    
                    // Si no está como campo, buscar como primer hijo
                    if (!modifiersNode && child.childCount > 0) {
                        const firstChild = child.child(0);
                        if (firstChild && firstChild.type === 'modifiers') {
                            modifiersNode = firstChild;
                        }
                    }
                    
                    if (modifiersNode) {
                        const modifierText = content.substring(modifiersNode.startIndex, modifiersNode.endIndex);
                        isPublic = modifierText.includes('public');
                    }
                    // Si es un constructor sin modificadores explícitos, asumir que es público
                    else if (child.type === 'constructor_declaration') {
                        isPublic = true; // Los constructores sin modificador son públicos por defecto en Java
                    }
                    
                    // Si tiene anotación de endpoint Spring, es efectivamente público
                    if (hasEndpointAnnotation) {
                        isPublic = true;
                    }
                }
                
                if (!isPublic) continue;
            
                // Extraer información del método
                const nameNode = child.childForFieldName('name');
                if (!nameNode) continue;
                
                const methodName = content.substring(nameNode.startIndex, nameNode.endIndex);
                
                // Extraer tipo de retorno
                let returnType = 'void';
                const typeNode = child.childForFieldName('type');
                if (typeNode) {
                    returnType = content.substring(typeNode.startIndex, typeNode.endIndex);
                } else if (child.type === 'constructor_declaration') {
                    returnType = '';
                }
                
                // Extraer parámetros
                const parameters = this.extractParameters(child, content);
                
                // Construir signature
                const paramString = parameters.map(p => `${p.type} ${p.name}`).join(', ');
                const signature = returnType ? 
                    `${returnType} ${methodName}(${paramString})` : 
                    `${methodName}(${paramString})`;
                
                methods.push({
                    name: methodName,
                    signature: signature,
                    line: child.startPosition.row + 1,
                    returnType: returnType,
                    parameters: parameters
                });
            }
        }
        
        return methods;
    }

    private extractParameters(methodNode: Parser.SyntaxNode, content: string): any[] {
        const parameters: any[] = [];
        const paramsNode = methodNode.childForFieldName('parameters');
        
        if (paramsNode) {
            const paramNodes = this.findNodes(paramsNode, ['formal_parameter']);
            
            for (const paramNode of paramNodes) {
                const typeNode = paramNode.childForFieldName('type');
                const nameNode = paramNode.childForFieldName('name');
                
                if (typeNode && nameNode) {
                    parameters.push({
                        type: content.substring(typeNode.startIndex, typeNode.endIndex),
                        name: content.substring(nameNode.startIndex, nameNode.endIndex)
                    });
                }
            }
        }
        
        return parameters;
    }

    private extractDirectDependencies(classNode: Parser.SyntaxNode, content: string): string[] {
        const dependencies: string[] = [];
        
        // Extraer extends
        const superclass = classNode.childForFieldName('superclass');
        if (superclass) {
            const name = content.substring(superclass.startIndex, superclass.endIndex);
            dependencies.push(name);
        }
        
        // Extraer implements
        const interfaces = classNode.childForFieldName('interfaces');
        if (interfaces) {
            const interfaceNodes = this.findNodes(interfaces, ['type_identifier']);
            for (const interfaceNode of interfaceNodes) {
                const name = content.substring(interfaceNode.startIndex, interfaceNode.endIndex);
                dependencies.push(name);
            }
        }
        
        return dependencies;
    }

    private extractClassDependencies(
        classNode: Parser.SyntaxNode, 
        content: string,
        className: string
    ): DependencyRelation[] {
        const dependencies: DependencyRelation[] = [];
        
        // Extraer campos (field injection)
        const fieldNodes = this.findNodes(classNode, ['field_declaration']);
        for (const fieldNode of fieldNodes) {
            const typeNode = fieldNode.childForFieldName('type');
            if (typeNode) {
                const typeName = this.extractTypeName(typeNode, content);
                if (typeName && this.isCustomType(typeName)) {
                    dependencies.push({
                        from: className,
                        to: typeName,
                        type: 'field_injection',
                        file: '',  // Se llenará por el IndexBuilder
                        line: fieldNode.startPosition.row + 1,
                        usage: [`Field at line ${fieldNode.startPosition.row + 1}`]
                    });
                }
            }
        }
        
        // Extraer extends
        const superclass = classNode.childForFieldName('superclass');
        if (superclass) {
            const name = content.substring(superclass.startIndex, superclass.endIndex);
            dependencies.push({
                from: className,
                to: name,
                type: 'extends',
                file: '',
                line: superclass.startPosition.row + 1
            });
        }
        
        // Extraer implements
        const interfaces = classNode.childForFieldName('interfaces');
        if (interfaces) {
            const interfaceNodes = this.findNodes(interfaces, ['type_identifier']);
            for (const interfaceNode of interfaceNodes) {
                const name = content.substring(interfaceNode.startIndex, interfaceNode.endIndex);
                dependencies.push({
                    from: className,
                    to: name,
                    type: 'implements',
                    file: '',
                    line: interfaceNode.startPosition.row + 1
                });
            }
        }
        
        return dependencies;
    }

    private extractTypeName(typeNode: Parser.SyntaxNode, content: string): string {
        // Manejar tipos genéricos como List<String>
        const text = content.substring(typeNode.startIndex, typeNode.endIndex);
        const match = text.match(/^([A-Z][a-zA-Z0-9]*)/);
        return match && match[1] ? match[1] : text;
    }

    private isCustomType(typeName: string): boolean {
        // Filtrar tipos primitivos y clases de Java estándar
        const standardTypes = [
            'String', 'Integer', 'Long', 'Double', 'Float', 'Boolean',
            'List', 'Map', 'Set', 'Collection', 'ArrayList', 'HashMap',
            'HashSet', 'Optional', 'Stream', 'Date', 'LocalDate',
            'BigDecimal', 'UUID', 'Object'
        ];
        
        return !standardTypes.includes(typeName) && 
               typeName.length > 0 && typeName[0] === typeName[0].toUpperCase();
    }

    detectBreakingChanges(oldAnalysis: FileAnalysis, newAnalysis: FileAnalysis): BreakingChange[] {
        const changes: BreakingChange[] = [];
        
        // Detectar clases eliminadas
        const oldClasses = new Map(oldAnalysis.classes?.map(c => [c.name, c]));
        const newClasses = new Map(newAnalysis.classes?.map(c => [c.name, c]));
        
        for (const [className, oldClass] of oldClasses) {
            if (!newClasses.has(className)) {
                changes.push({
                    type: 'class_removed',
                    severity: 'critical',
                    description: `Clase '${className}' eliminada`,
                    location: {
                        file: oldClass.path,
                        line: 0
                    }
                });
                continue;
            }
            
            const newClass = newClasses.get(className)!;
            
            // Detectar métodos eliminados o con firma cambiada
            const oldMethods = new Map(oldClass.publicMethods.map(m => [m.name, m]));
            const newMethods = new Map(newClass.publicMethods.map(m => [m.name, m]));
            
            for (const [methodName, oldMethod] of oldMethods) {
                if (!newMethods.has(methodName)) {
                    changes.push({
                        type: 'method_removed',
                        severity: 'major',
                        description: `Método público '${methodName}' eliminado de ${className}`,
                        location: {
                            file: oldClass.path,
                            line: oldMethod.line
                        }
                    });
                } else {
                    const newMethod = newMethods.get(methodName)!;
                    if (oldMethod.signature !== newMethod.signature) {
                        changes.push({
                            type: 'signature_changed',
                            severity: 'major',
                            description: `Firma del método '${methodName}' cambiada en ${className}`,
                            location: {
                                file: newClass.path,
                                line: newMethod.line
                            }
                        });
                    }
                }
            }
        }
        
        return changes;
    }

    private findNodes(node: Parser.SyntaxNode, types: string[]): Parser.SyntaxNode[] {
        const results: Parser.SyntaxNode[] = [];
        
        function traverse(n: Parser.SyntaxNode) {
            if (types.includes(n.type)) {
                results.push(n);
            }
            for (let i = 0; i < n.childCount; i++) {
                traverse(n.child(i)!);
            }
        }
        
        traverse(node);
        return results;
    }

    private extractAnnotations(node: Parser.SyntaxNode, content: string): string[] {
        const annotations: string[] = [];
        
        // Buscar anotaciones antes del nodo
        let prevSibling = node.previousSibling;
        while (prevSibling && prevSibling.type === 'marker_annotation' || prevSibling?.type === 'annotation') {
            const text = content.substring(prevSibling.startIndex, prevSibling.endIndex);
            annotations.push(text);
            prevSibling = prevSibling.previousSibling;
        }
        
        // También buscar modifiers con anotaciones
        const modifiers = node.childForFieldName('modifiers');
        if (modifiers) {
            for (let i = 0; i < modifiers.childCount; i++) {
                const child = modifiers.child(i);
                if (child && (child.type === 'marker_annotation' || child.type === 'annotation')) {
                    const text = content.substring(child.startIndex, child.endIndex);
                    annotations.push(text);
                }
            }
        }
        
        return annotations;
    }

    private extractMethodAnnotations(methodNode: Parser.SyntaxNode, content: string): string[] {
        const annotations: string[] = [];
        
        // Buscar anotaciones en los primeros hijos
        for (let i = 0; i < methodNode.childCount; i++) {
            const child = methodNode.child(i);
            if (!child) continue;
            
            if (child.type === 'modifiers') {
                // Buscar anotaciones dentro de modifiers
                for (let j = 0; j < child.childCount; j++) {
                    const modChild = child.child(j);
                    if (modChild && (modChild.type === 'marker_annotation' || modChild.type === 'annotation')) {
                        const text = content.substring(modChild.startIndex, modChild.endIndex);
                        annotations.push(text);
                    }
                }
            } else if (child.type === 'marker_annotation' || child.type === 'annotation') {
                const text = content.substring(child.startIndex, child.endIndex);
                annotations.push(text);
            }
        }
        
        return annotations;
    }

    private hasLombokData(annotations: string[]): boolean {
        return annotations.some(a => 
            a.includes('@Data') || 
            a.includes('@Getter') || 
            a.includes('@Setter')
        );
    }

    private hasSpringEndpointAnnotation(annotations: string[]): boolean {
        const springAnnotations = [
            '@GetMapping', '@PostMapping', '@PutMapping', '@DeleteMapping', '@PatchMapping',
            '@RequestMapping', '@RestController', '@Controller'
        ];
        
        return annotations.some(a => 
            springAnnotations.some(sa => a.includes(sa))
        );
    }

    private addLombokMethods(classNode: Parser.SyntaxNode, classInfo: ClassInfo, content: string): void {
        // Encontrar todos los campos
        const bodyNode = classNode.childForFieldName('body');
        if (!bodyNode) return;
        
        for (let i = 0; i < bodyNode.childCount; i++) {
            const child = bodyNode.child(i);
            if (!child || child.type !== 'field_declaration') continue;
            
            const typeNode = child.childForFieldName('type');
            const declaratorNode = child.childForFieldName('declarator');
            
            if (typeNode && declaratorNode) {
                const type = content.substring(typeNode.startIndex, typeNode.endIndex);
                
                // Extraer nombre del campo
                let fieldName = '';
                for (let j = 0; j < declaratorNode.childCount; j++) {
                    const declChild = declaratorNode.child(j);
                    if (declChild && declChild.type === 'identifier') {
                        fieldName = content.substring(declChild.startIndex, declChild.endIndex);
                        break;
                    }
                }
                
                if (fieldName) {
                    // Agregar getter
                    const getterName = 'get' + fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
                    classInfo.publicMethods.push({
                        name: getterName,
                        signature: `${type} ${getterName}()`,
                        line: child.startPosition.row + 1,
                        returnType: type,
                        parameters: []
                    });
                    
                    // Agregar setter
                    const setterName = 'set' + fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
                    classInfo.publicMethods.push({
                        name: setterName,
                        signature: `void ${setterName}(${type} ${fieldName})`,
                        line: child.startPosition.row + 1,
                        returnType: 'void',
                        parameters: [{
                            type: type,
                            name: fieldName
                        }]
                    });
                }
            }
        }
    }
}