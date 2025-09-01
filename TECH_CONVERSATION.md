
En otra conversaxion gabkabamos sobre un pr reviewer recuefdas

Veo que mencionas que hablamos sobre un PR reviewer en otra conversación. Déjame buscar en nuestras conversaciones anteriores para encontrar esa discusión.


Relevant chats
4 resultados





¡Sí, encontré nuestras conversaciones anteriores sobre PR reviewers! Hablamos sobre:

Implementación de un sistema de revisión automatizada de PRs - Donde discutimos cómo extraer datos de pull requests de GitHub, crear una clase PullRequestChanges para estructurar la información, y cómo exportar funciones para reutilizarlas en otros archivos.
Sistema asíncrono de revisión de PRs con IA - Desarrollamos una especificación para un sistema que procesa reviews de manera asíncrona, con comentarios iniciales, procesamiento en background, y actualizaciones finales.
Script de Python para automatizar revisiones - Creamos código usando la API de GitHub y modelos de lenguaje para generar resúmenes automáticos y comentarios de revisión basados en los cambios del código.
¿Sobre cuál de estos aspectos querías continuar trabajando? ¿O hay algo específico del PR reviewer que necesitas desarrollar o mejorar?

Ok el scrypt es una lamvda en nodejs ok

Ah, perfecto! Entonces estás trabajando con una Lambda en Node.js para el PR reviewer. Déjame buscar si hablamos específicamente sobre implementaciones en Node.js.


Relevant chats
5 resultados






Perfecto! Ya veo que estás trabajando con una Lambda en Node.js para el PR reviewer. Basándome en nuestras conversaciones anteriores, parece que has estado desarrollando:

Una Lambda con Express en Node.js (usando serverless-http)
Integración con GitHub Actions que dispara la Lambda cuando hay eventos de PR
Conexión con AWS Bedrock (o similar) para el análisis de código con IA
Para un PR reviewer en Lambda Node.js, la arquitectura típica sería:

javascript
// handler.js - Ejemplo básico de Lambda para PR review
const { Octokit } = require("@octokit/rest");
const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");

exports.handler = async (event) => {
    // 1. Parsear el webhook de GitHub
    const payload = JSON.parse(event.body);
    const { pull_request, action } = payload;
    
    // 2. Validar que es un evento relevante
    if (!['opened', 'synchronize'].includes(action)) {
        return { statusCode: 200, body: 'Event ignored' };
    }
    
    // 3. Obtener el diff del PR
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const diff = await octokit.pulls.get({
        owner: pull_request.base.repo.owner.login,
        repo: pull_request.base.repo.name,
        pull_number: pull_request.number,
        mediaType: { format: "diff" }
    });
    
    // 4. Enviar a IA para análisis
    const bedrock = new BedrockRuntimeClient({ region: "us-east-1" });
    const aiResponse = await analyzeCode(diff.data, bedrock);
    
    // 5. Publicar comentarios en el PR
    await postReviewComments(octokit, pull_request, aiResponse);
    
    return { statusCode: 200, body: 'Review completed' };
};
¿Qué parte específica del PR reviewer necesitas desarrollar o mejorar? ¿El manejo de webhooks, la integración con la IA, o el procesamiento de los comentarios?

Ok la duda que tengo es como sera el proceso de revision? Que le enviare al llm? Como sabra como se conectan los archivos para que no evalue arhicos sin contexto de los demas? Hay varios problemas para que esto aea util pensemps en eso

Excelente pregunta. Tienes razón, hay varios desafíos importantes para hacer un PR reviewer útil. Vamos a pensar en los problemas principales y sus soluciones:

🔴 Problemas Principales
1. Contexto Limitado
El LLM no conoce la arquitectura del proyecto
No entiende las dependencias entre archivos
No sabe las convenciones del equipo
No conoce el propósito del PR
2. Límites de Tokens
PRs grandes pueden exceder el contexto del LLM
No puedes enviar todo el repositorio
Diffs extensos son problemáticos
3. Relevancia de Comentarios
Sin contexto, genera comentarios genéricos
Puede señalar "problemas" que son decisiones intencionales
No entiende el dominio del negocio
💡 Estrategias de Solución
1. Enfoque por Capas de Contexto
javascript
// Estructura de lo que enviarías al LLM
const reviewContext = {
  // CAPA 1: Contexto del PR
  prContext: {
    title: "Add payment processing module",
    description: "Implements Stripe integration for subscriptions",
    targetBranch: "main",
    labels: ["feature", "payments"]
  },
  
  // CAPA 2: Arquitectura relevante
  projectContext: {
    type: "Node.js API",
    framework: "NestJS",
    mainDependencies: ["stripe", "typeorm"],
    relevantPatterns: "Repository pattern, DTOs for validation"
  },
  
  // CAPA 3: Archivos relacionados (no modificados pero importantes)
  relatedFiles: {
    "src/payments/payment.service.ts": "// Interfaz existente...",
    "src/common/interfaces/payment.interface.ts": "// Tipos compartidos..."
  },
  
  // CAPA 4: Los cambios actuales
  changes: {
    "src/payments/stripe.service.ts": {
      diff: "...",
      imports: ["PaymentService", "UserRepository"],
      exports: ["StripeService"]
    }
  }
};
2. Análisis Inteligente de Dependencias
javascript
async function buildContextualDiff(pr, octokit) {
  const changes = await getPRFiles(pr);
  
  // 1. Identificar qué archivos importan/exportan
  const dependencyGraph = await analyzeDependencies(changes);
  
  // 2. Obtener archivos relacionados (no modificados)
  const relatedFiles = await getRelatedFiles(dependencyGraph, octokit);
  
  // 3. Priorizar qué incluir según límites de tokens
  return prioritizeContext(changes, relatedFiles, MAX_TOKENS);
}

function analyzeDependencies(files) {
  const graph = {};
  
  for (const file of files) {
    // Extraer imports/exports con regex o AST
    const imports = extractImports(file.content);
    const exports = extractExports(file.content);
    
    graph[file.path] = {
      imports,
      exports,
      dependents: [], // Quién usa este archivo
      dependencies: imports // De quién depende
    };
  }
  
  return graph;
}
3. Estrategia de Revisión por Chunks
javascript
async function reviewPR(pr, llm) {
  const strategies = [
    {
      name: "critical_files",
      filter: (file) => isCritical(file), // auth, payments, db
      prompt: "Focus on security and data integrity"
    },
    {
      name: "api_changes", 
      filter: (file) => file.path.includes("controller"),
      prompt: "Check backwards compatibility and REST conventions"
    },
    {
      name: "business_logic",
      filter: (file) => file.path.includes("service"),
      prompt: "Verify business rules and error handling"
    }
  ];
  
  const reviews = [];
  
  for (const strategy of strategies) {
    const relevantFiles = pr.files.filter(strategy.filter);
    if (relevantFiles.length > 0) {
      const review = await llm.review({
        files: relevantFiles,
        context: await getContextForFiles(relevantFiles),
        instructions: strategy.prompt
      });
      reviews.push(review);
    }
  }
  
  return mergeReviews(reviews);
}
4. Prompt Engineering Específico
javascript
const REVIEW_PROMPT = `
You are reviewing a PR for a ${projectType} project.

PROJECT CONTEXT:
- Architecture: ${architecture}
- Key patterns: ${patterns}
- Team conventions: ${conventions}

PR CONTEXT:
- Purpose: ${pr.description}
- Type: ${pr.labels}

RELATED CODE (unchanged but relevant):
${relatedCode}

CHANGES TO REVIEW:
${changes}

FOCUS ON:
1. Does this change break existing functionality?
2. Are there security implications?
3. Is error handling adequate?
4. Are the changes consistent with existing patterns?

DO NOT comment on:
- Code style (we have linters)
- Missing tests (separate check)
- Documentation (unless critical)

Provide only HIGH-VALUE comments that a senior developer would make.
`;
5. Sistema de Configuración por Proyecto
yaml
# .github/ai-review-config.yml
review:
  enabled: true
  
  context:
    type: "REST API"
    framework: "NestJS"
    database: "PostgreSQL"
    
  rules:
    - name: "Security Review"
      paths: ["**/auth/**", "**/payment/**"]
      context_depth: "deep"  # Incluir más archivos relacionados
      
    - name: "API Review"
      paths: ["**/controller/**"]
      include_schemas: true
      
  ignore:
    - "*.test.ts"
    - "*.spec.ts"
    - "migrations/*"
    
  max_context_size: 8000  # tokens
  
  focus_areas:
    - security
    - performance
    - error_handling
6. Implementación Práctica
javascript
class PRReviewer {
  async review(webhookPayload) {
    const pr = webhookPayload.pull_request;
    
    // 1. Cargar configuración del proyecto
    const config = await this.loadProjectConfig(pr.base.repo);
    
    // 2. Obtener cambios con contexto
    const contextualChanges = await this.buildContext(pr, config);
    
    // 3. Si es muy grande, dividir en chunks
    if (this.exceedsTokenLimit(contextualChanges)) {
      return this.reviewInChunks(contextualChanges, config);
    }
    
    // 4. Revisión completa
    return this.performReview(contextualChanges, config);
  }
  
  async buildContext(pr, config) {
    // Obtener diff
    const diff = await this.github.getPRDiff(pr);
    
    // Analizar qué archivos son importantes
    const impactAnalysis = await this.analyzeImpact(diff);
    
    // Obtener archivos relacionados según el impacto
    const relatedFiles = await this.getRelatedFiles(
      impactAnalysis.dependencies,
      config.context_depth
    );
    
    return {
      changes: diff,
      related: relatedFiles,
      impact: impactAnalysis,
      metadata: {
        pr_title: pr.title,
        pr_description: pr.body,
        target_branch: pr.base.ref
      }
    };
  }
}
📋 Recomendaciones Clave
No intentes revisar todo: Enfócate en cambios críticos
Usa un archivo de configuración: Cada proyecto es diferente
Construye contexto incremental: No envíes todo al LLM
Prioriza por impacto: Revisa primero lo más crítico
Permite feedback: Aprende qué comentarios son útiles
¿Qué aspectos te parecen más importantes para tu caso de uso? ¿Tienes algún tipo específico de proyecto en mente?

Ok mira expande mas como vamos a encontrat archivos relacioonasoa y lo que mencionaa en el 1 y 2? Esos pasos son los q mas necesito tener clato

Excelente, vamos a profundizar en cómo encontrar archivos relacionados y construir el contexto. Estos son los pasos más críticos para que el LLM entienda realmente el código.

🔍 1. Análisis de Dependencias - Extracción
A. Parser de Imports/Exports
javascript
// dependency-analyzer.js
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const fs = require('fs').promises;
const path = require('path');

class DependencyAnalyzer {
  
  // Analizar un archivo y extraer sus dependencias
  async analyzeFile(filePath, fileContent) {
    const fileInfo = {
      path: filePath,
      imports: [],
      exports: [],
      classes: [],
      functions: [],
      interfaces: [],
      dependencies: {
        internal: [],  // Archivos del proyecto
        external: []   // Librerías npm
      }
    };

    try {
      // Parsear el archivo según su tipo
      if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
        return this.analyzeTypeScript(fileContent, fileInfo);
      } else if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) {
        return this.analyzeJavaScript(fileContent, fileInfo);
      }
    } catch (error) {
      console.error(`Error parsing ${filePath}:`, error);
      // Fallback a análisis por regex si el parser falla
      return this.analyzeWithRegex(fileContent, fileInfo);
    }
  }

  analyzeTypeScript(content, fileInfo) {
    const ast = parser.parse(content, {
      sourceType: 'module',
      plugins: ['typescript', 'decorators-legacy', 'jsx']
    });

    traverse(ast, {
      // Capturar imports
      ImportDeclaration(path) {
        const source = path.node.source.value;
        const specifiers = path.node.specifiers.map(spec => {
          if (spec.type === 'ImportDefaultSpecifier') {
            return { name: spec.local.name, type: 'default' };
          } else if (spec.type === 'ImportSpecifier') {
            return { 
              name: spec.imported.name, 
              alias: spec.local.name,
              type: 'named' 
            };
          } else if (spec.type === 'ImportNamespaceSpecifier') {
            return { name: spec.local.name, type: 'namespace' };
          }
        });

        const importInfo = {
          source,
          specifiers,
          isRelative: source.startsWith('.'),
          resolvedPath: this.resolvePath(fileInfo.path, source)
        };

        fileInfo.imports.push(importInfo);
        
        // Clasificar como interno o externo
        if (importInfo.isRelative) {
          fileInfo.dependencies.internal.push(importInfo.resolvedPath);
        } else {
          fileInfo.dependencies.external.push(source);
        }
      },

      // Capturar exports
      ExportNamedDeclaration(path) {
        if (path.node.declaration) {
          if (path.node.declaration.type === 'FunctionDeclaration') {
            fileInfo.exports.push({
              name: path.node.declaration.id.name,
              type: 'function'
            });
            fileInfo.functions.push(path.node.declaration.id.name);
          } else if (path.node.declaration.type === 'ClassDeclaration') {
            fileInfo.exports.push({
              name: path.node.declaration.id.name,
              type: 'class'
            });
            fileInfo.classes.push(path.node.declaration.id.name);
          } else if (path.node.declaration.type === 'TSInterfaceDeclaration') {
            fileInfo.exports.push({
              name: path.node.declaration.id.name,
              type: 'interface'
            });
            fileInfo.interfaces.push(path.node.declaration.id.name);
          }
        }
      },

      ExportDefaultDeclaration(path) {
        fileInfo.exports.push({
          name: 'default',
          type: 'default'
        });
      },

      // Capturar clases
      ClassDeclaration(path) {
        const className = path.node.id?.name;
        if (className && !fileInfo.classes.includes(className)) {
          fileInfo.classes.push(className);
        }
      },

      // Capturar interfaces (TypeScript)
      TSInterfaceDeclaration(path) {
        const interfaceName = path.node.id.name;
        if (!fileInfo.interfaces.includes(interfaceName)) {
          fileInfo.interfaces.push(interfaceName);
        }
      }
    });

    return fileInfo;
  }

  // Resolver rutas relativas
  resolvePath(currentFile, importPath) {
    if (!importPath.startsWith('.')) return importPath;
    
    const dir = path.dirname(currentFile);
    let resolved = path.join(dir, importPath);
    
    // Agregar extensión si no la tiene
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.json'];
    for (const ext of extensions) {
      if (fs.existsSync(resolved + ext)) {
        return resolved + ext;
      }
    }
    
    // Verificar si es una carpeta con index
    const indexPath = path.join(resolved, 'index');
    for (const ext of extensions) {
      if (fs.existsSync(indexPath + ext)) {
        return indexPath + ext;
      }
    }
    
    return resolved;
  }

  // Fallback: análisis con regex cuando el parser falla
  analyzeWithRegex(content, fileInfo) {
    // Buscar imports
    const importRegex = /import\s+(?:{([^}]+)}|(\w+)|(\*\s+as\s+\w+))\s+from\s+['"]([^'"]+)['"]/g;
    let match;
    
    while ((match = importRegex.exec(content)) !== null) {
      const source = match[4];
      fileInfo.imports.push({
        source,
        isRelative: source.startsWith('.'),
        resolvedPath: this.resolvePath(fileInfo.path, source)
      });
    }

    // Buscar exports
    const exportRegex = /export\s+(?:default\s+)?(?:class|function|interface|const|let|var)\s+(\w+)/g;
    while ((match = exportRegex.exec(content)) !== null) {
      fileInfo.exports.push({
        name: match[1],
        type: 'unknown'
      });
    }

    return fileInfo;
  }
}
🗺️ 2. Construcción del Grafo de Dependencias
javascript
// dependency-graph.js
class DependencyGraph {
  constructor() {
    this.nodes = new Map(); // filepath -> FileNode
    this.edges = new Map(); // filepath -> Set of dependencies
    this.reverseEdges = new Map(); // filepath -> Set of dependents
  }

  async buildFromPR(prFiles, githubClient, repoInfo) {
    const analyzer = new DependencyAnalyzer();
    
    // 1. Analizar archivos modificados en el PR
    console.log('📊 Analyzing modified files...');
    for (const file of prFiles) {
      const analysis = await analyzer.analyzeFile(file.filename, file.content);
      this.addNode(file.filename, analysis);
    }

    // 2. Encontrar dependencias de primer nivel
    console.log('🔍 Finding first-level dependencies...');
    const firstLevelDeps = await this.findDirectDependencies(githubClient, repoInfo);
    
    // 3. Opcionalmente, buscar dependencias de segundo nivel
    console.log('🔎 Finding second-level dependencies...');
    const secondLevelDeps = await this.findSecondLevelDependencies(
      firstLevelDeps, 
      githubClient, 
      repoInfo
    );

    // 4. Construir el grafo inverso (qué archivos dependen de cada archivo)
    this.buildReverseEdges();
    
    return this;
  }

  async findDirectDependencies(githubClient, repoInfo) {
    const dependencies = new Set();
    
    for (const [filePath, node] of this.nodes) {
      // Para cada archivo interno que importa
      for (const dep of node.dependencies.internal) {
        if (!this.nodes.has(dep)) {
          // Este archivo no está en el PR, necesitamos obtenerlo
          dependencies.add(dep);
        }
      }
    }

    // Obtener estos archivos de GitHub
    const fetchedFiles = await this.fetchFilesFromGitHub(
      Array.from(dependencies),
      githubClient,
      repoInfo
    );

    // Analizar los archivos obtenidos
    const analyzer = new DependencyAnalyzer();
    for (const file of fetchedFiles) {
      const analysis = await analyzer.analyzeFile(file.path, file.content);
      this.addNode(file.path, analysis);
    }

    return dependencies;
  }

  async findSecondLevelDependencies(firstLevelPaths, githubClient, repoInfo) {
    const secondLevel = new Set();
    
    // Para cada dependencia de primer nivel
    for (const filePath of firstLevelPaths) {
      const node = this.nodes.get(filePath);
      if (!node) continue;
      
      // Ver qué archivos importa
      for (const dep of node.dependencies.internal) {
        if (!this.nodes.has(dep) && !firstLevelPaths.has(dep)) {
          secondLevel.add(dep);
        }
      }
    }

    // Limitar para no traer demasiados archivos
    const LIMITED_SECOND_LEVEL = Array.from(secondLevel).slice(0, 10);
    
    if (LIMITED_SECOND_LEVEL.length > 0) {
      const fetchedFiles = await this.fetchFilesFromGitHub(
        LIMITED_SECOND_LEVEL,
        githubClient,
        repoInfo
      );

      const analyzer = new DependencyAnalyzer();
      for (const file of fetchedFiles) {
        const analysis = await analyzer.analyzeFile(file.path, file.content);
        this.addNode(file.path, analysis, 2); // Marcar como nivel 2
      }
    }

    return secondLevel;
  }

  async fetchFilesFromGitHub(filePaths, githubClient, repoInfo) {
    const files = [];
    
    for (const filePath of filePaths) {
      try {
        const response = await githubClient.repos.getContent({
          owner: repoInfo.owner,
          repo: repoInfo.repo,
          path: filePath,
          ref: repoInfo.baseBranch
        });
        
        if (response.data.content) {
          const content = Buffer.from(response.data.content, 'base64').toString();
          files.push({
            path: filePath,
            content
          });
        }
      } catch (error) {
        console.warn(`Could not fetch ${filePath}:`, error.message);
      }
    }
    
    return files;
  }

  buildReverseEdges() {
    // Construir grafo inverso: qué archivos son usados por otros
    for (const [filePath, node] of this.nodes) {
      for (const dep of node.dependencies.internal) {
        if (!this.reverseEdges.has(dep)) {
          this.reverseEdges.set(dep, new Set());
        }
        this.reverseEdges.get(dep).add(filePath);
      }
    }
  }

  // Encontrar archivos que podrían verse afectados
  findAffectedFiles(modifiedFile) {
    const affected = new Set();
    const visited = new Set();
    const queue = [modifiedFile];
    
    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);
      
      // Obtener archivos que dependen de este
      const dependents = this.reverseEdges.get(current) || new Set();
      for (const dep of dependents) {
        affected.add(dep);
        queue.push(dep);
      }
    }
    
    return Array.from(affected);
  }
}
🎯 3. Extracción de Contexto Relevante
javascript
// context-builder.js
class ContextBuilder {
  constructor(dependencyGraph, config = {}) {
    this.graph = dependencyGraph;
    this.config = {
      maxTokens: config.maxTokens || 8000,
      includeTests: config.includeTests || false,
      maxDepth: config.maxDepth || 2,
      priorityPatterns: config.priorityPatterns || [
        'service', 'controller', 'repository', 'model', 'interface'
      ]
    };
  }

  async buildContext(prFiles) {
    const context = {
      // Archivos modificados
      modifiedFiles: [],
      
      // Archivos relacionados (no modificados pero importantes)
      relatedFiles: [],
      
      // Interfaces y tipos compartidos
      sharedTypes: [],
      
      // Resumen de impacto
      impactSummary: {},
      
      // Metadatos del proyecto
      projectInfo: {}
    };

    // 1. Procesar archivos modificados
    for (const file of prFiles) {
      const fileContext = await this.extractFileContext(file);
      context.modifiedFiles.push(fileContext);
    }

    // 2. Identificar archivos críticos relacionados
    const criticalRelated = await this.findCriticalRelatedFiles(prFiles);
    
    // 3. Extraer solo las partes relevantes de archivos relacionados
    for (const relatedFile of criticalRelated) {
      const relevantParts = await this.extractRelevantParts(relatedFile, prFiles);
      if (relevantParts) {
        context.relatedFiles.push(relevantParts);
      }
    }

    // 4. Extraer interfaces y tipos compartidos
    context.sharedTypes = await this.extractSharedTypes(prFiles);

    // 5. Calcular impacto
    context.impactSummary = this.calculateImpact(prFiles);

    // 6. Optimizar para tokens
    return this.optimizeForTokenLimit(context);
  }

  async extractFileContext(file) {
    const node = this.graph.nodes.get(file.filename);
    
    return {
      path: file.filename,
      type: this.detectFileType(file.filename),
      changes: file.patch, // El diff
      
      // Metadatos importantes
      metadata: {
        imports: node?.imports.map(imp => imp.source) || [],
        exports: node?.exports.map(exp => exp.name) || [],
        classes: node?.classes || [],
        functions: node?.functions || [],
        interfaces: node?.interfaces || []
      },
      
      // Dependencias afectadas
      affects: this.graph.findAffectedFiles(file.filename),
      
      // Nivel de criticidad
      criticality: this.calculateCriticality(file.filename)
    };
  }

  async findCriticalRelatedFiles(modifiedFiles) {
    const related = new Map(); // path -> priority
    
    for (const file of modifiedFiles) {
      const node = this.graph.nodes.get(file.filename);
      if (!node) continue;
      
      // Dependencias directas (alta prioridad)
      for (const dep of node.dependencies.internal) {
        const priority = this.calculateFilePriority(dep);
        related.set(dep, Math.max(related.get(dep) || 0, priority));
      }
      
      // Archivos que dependen de este (prioridad media)
      const affectedFiles = this.graph.findAffectedFiles(file.filename);
      for (const affected of affectedFiles) {
        const priority = this.calculateFilePriority(affected) * 0.7;
        related.set(affected, Math.max(related.get(affected) || 0, priority));
      }
    }
    
    // Ordenar por prioridad y tomar los más importantes
    return Array.from(related.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([path]) => path);
  }

  async extractRelevantParts(filePath, modifiedFiles) {
    const node = this.graph.nodes.get(filePath);
    if (!node) return null;
    
    // Determinar qué partes son relevantes
    const relevantParts = {
      path: filePath,
      reason: this.determineRelevanceReason(filePath, modifiedFiles),
      content: {}
    };
    
    // Extraer solo las partes que son referenciadas
    const referencedItems = this.findReferencedItems(filePath, modifiedFiles);
    
    if (referencedItems.classes.length > 0) {
      relevantParts.content.classes = await this.extractClasses(
        filePath, 
        referencedItems.classes
      );
    }
    
    if (referencedItems.functions.length > 0) {
      relevantParts.content.functions = await this.extractFunctions(
        filePath,
        referencedItems.functions
      );
    }
    
    if (referencedItems.interfaces.length > 0) {
      relevantParts.content.interfaces = await this.extractInterfaces(
        filePath,
        referencedItems.interfaces
      );
    }
    
    return relevantParts;
  }

  findReferencedItems(filePath, modifiedFiles) {
    const referenced = {
      classes: [],
      functions: [],
      interfaces: []
    };
    
    const fileNode = this.graph.nodes.get(filePath);
    if (!fileNode) return referenced;
    
    // Ver qué exporta este archivo
    const exports = new Set(fileNode.exports.map(e => e.name));
    
    // Ver qué importan los archivos modificados
    for (const modFile of modifiedFiles) {
      const modNode = this.graph.nodes.get(modFile.filename);
      if (!modNode) continue;
      
      for (const imp of modNode.imports) {
        if (imp.resolvedPath === filePath) {
          // Este archivo modificado importa algo del archivo relacionado
          for (const specifier of imp.specifiers || []) {
            const name = specifier.name;
            
            if (fileNode.classes.includes(name)) {
              referenced.classes.push(name);
            } else if (fileNode.functions.includes(name)) {
              referenced.functions.push(name);
            } else if (fileNode.interfaces.includes(name)) {
              referenced.interfaces.push(name);
            }
          }
        }
      }
    }
    
    return referenced;
  }

  calculateFilePriority(filePath) {
    let priority = 1;
    
    // Archivos más importantes
    if (filePath.includes('service')) priority *= 2;
    if (filePath.includes('controller')) priority *= 1.8;
    if (filePath.includes('repository')) priority *= 1.6;
    if (filePath.includes('model')) priority *= 1.5;
    if (filePath.includes('interface')) priority *= 1.5;
    if (filePath.includes('dto')) priority *= 1.4;
    if (filePath.includes('entity')) priority *= 1.4;
    
    // Archivos menos importantes
    if (filePath.includes('test')) priority *= 0.3;
    if (filePath.includes('spec')) priority *= 0.3;
    if (filePath.includes('mock')) priority *= 0.4;
    if (filePath.includes('.config')) priority *= 0.5;
    
    return priority;
  }

  optimizeForTokenLimit(context) {
    // Estimar tokens (aproximado: 1 token ≈ 4 caracteres)
    const estimateTokens = (obj) => {
      return JSON.stringify(obj).length / 4;
    };
    
    let currentTokens = estimateTokens(context);
    
    // Si excede el límite, recortar progresivamente
    while (currentTokens > this.config.maxTokens) {
      // Primero, eliminar archivos relacionados menos importantes
      if (context.relatedFiles.length > 5) {
        context.relatedFiles = context.relatedFiles.slice(0, 5);
      }
      
      // Luego, recortar contenido de archivos relacionados
      context.relatedFiles = context.relatedFiles.map(file => ({
        ...file,
        content: this.truncateContent(file.content)
      }));
      
      // Si aún excede, recortar los diffs largos
      context.modifiedFiles = context.modifiedFiles.map(file => ({
        ...file,
        changes: this.truncateDiff(file.changes)
      }));
      
      currentTokens = estimateTokens(context);
      
      // Evitar loop infinito
      if (context.relatedFiles.length === 0) break;
    }
    
    return context;
  }
}
🚀 4. Uso Completo en la Lambda
javascript
// lambda-handler.js
exports.handler = async (event) => {
  const payload = JSON.parse(event.body);
  const { pull_request } = payload;
  
  // 1. Obtener archivos del PR
  const prFiles = await github.getPRFiles(pull_request);
  
  // 2. Construir grafo de dependencias
  const graph = new DependencyGraph();
  await graph.buildFromPR(prFiles, github, {
    owner: pull_request.base.repo.owner.login,
    repo: pull_request.base.repo.name,
    baseBranch: pull_request.base.ref
  });
  
  // 3. Construir contexto
  const contextBuilder = new ContextBuilder(graph, {
    maxTokens: 8000,
    maxDepth: 2
  });
  
  const context = await contextBuilder.buildContext(prFiles);
  
  // 4. Preparar prompt para el LLM
  const prompt = `
    PROJECT STRUCTURE:
    ${JSON.stringify(context.projectInfo, null, 2)}
    
    MODIFIED FILES:
    ${context.modifiedFiles.map(f => `
      File: ${f.path}
      Type: ${f.type}
      Imports: ${f.metadata.imports.join(', ')}
      Exports: ${f.metadata.exports.join(', ')}
      Affects: ${f.affects.join(', ')}
      
      CHANGES:
      ${f.changes}
    `).join('\n---\n')}
    
    RELATED CONTEXT (unchanged but important):
    ${context.relatedFiles.map(f => `
      File: ${f.path}
      Reason: ${f.reason}
      Relevant parts:
      ${JSON.stringify(f.content, null, 2)}
    `).join('\n')}
    
    SHARED TYPES/INTERFACES:
    ${JSON.stringify(context.sharedTypes, null, 2)}
    
    IMPACT ANALYSIS:
    ${JSON.stringify(context.impactSummary, null, 2)}
    
    Please review these changes considering:
    1. Breaking changes in interfaces
    2. Proper error handling
    3. Consistency with existing patterns
    4. Security implications
  `;
  
  // 5. Enviar al LLM
  const review = await llm.generateReview(prompt);
  
  // 6. Publicar comentarios
  await github.postReviewComments(pull_request, review);
};
📊 Ejemplo de Contexto Generado
json
{
  "modifiedFiles": [
    {
      "path": "src/payments/stripe.service.ts",
      "type": "service",
      "metadata": {
        "imports": ["PaymentRepository", "UserService", "stripe"],
        "exports": ["StripeService"],
        "classes": ["StripeService"],
        "functions": ["processPayment", "refund"]
      },
      "affects": [
        "src/controllers/payment.controller.ts",
        "src/services/order.service.ts"
      ],
      "criticality": "high"
    }
  ],
  
  "relatedFiles": [
    {
      "path": "src/repositories/payment.repository.ts",
      "reason": "Direct dependency of modified service",
      "content": {
        "interfaces": [
          {
            "name": "PaymentRepository",
            "methods": ["save", "findById", "updateStatus"]
          }
        ]
      }
    },
    {
      "path": "src/interfaces/payment.interface.ts",
      "reason": "Shared types used in changes",
      "content": {
        "interfaces": [
          {
            "name": "Payment",
            "properties": ["id", "amount", "status", "customerId"]
          }
        ]
      }
    }
  ],
  
  "sharedTypes": [
    {
      "name": "PaymentStatus",
      "type": "enum",
      "values": ["pending", "completed", "failed", "refunded"]
    }
  ],
  
  "impactSummary": {
    "affectedServices": 2,
    "affectedControllers": 1,
    "breakingChanges": false,
    "criticalPaths": ["payment processing", "order completion"]
  }
}
Con este enfoque, el LLM recibe:

Los cambios específicos (diffs)
El contexto necesario (interfaces, tipos)
Las dependencias (qué afecta a qué)
Solo las partes relevantes de archivos no modificados
¿Te gustaría que profundice en alguna parte específica o que agreguemos algún caso especial?

Pero le enviamos codigo de archivos rekacionados? O solo nombres?

Excelente pregunta. SÍ, debemos enviar código real de archivos relacionados, pero SOLO las partes relevantes, no el archivo completo. Esto es crítico para que el LLM entienda el contexto.

🎯 ¿Qué Código Enviar de Archivos Relacionados?
❌ NO hacer esto:
javascript
// MAL: Solo enviar nombres
{
  "relatedFiles": [
    "src/interfaces/payment.interface.ts",
    "src/repositories/payment.repository.ts"
  ]
}
// El LLM no sabe qué contienen estos archivos
✅ SÍ hacer esto:
javascript
// BIEN: Enviar las partes relevantes del código
{
  "relatedFiles": [
    {
      "path": "src/interfaces/payment.interface.ts",
      "relevantCode": `
        export interface Payment {
          id: string;
          amount: number;
          currency: string;
          status: PaymentStatus;
          customerId: string;
          metadata?: Record<string, any>;
        }
        
        export enum PaymentStatus {
          PENDING = 'pending',
          COMPLETED = 'completed',
          FAILED = 'failed'
        }
      `
    }
  ]
}
📋 Estrategia de Extracción Selectiva
javascript
class SmartCodeExtractor {
  
  // Extraer solo lo que los archivos modificados están usando
  async extractRelevantCode(relatedFile, modifiedFiles) {
    const fileContent = await this.getFileContent(relatedFile);
    const relevantParts = [];
    
    // 1. ¿Qué están importando los archivos modificados de este archivo?
    const importedItems = this.findImportedItems(relatedFile, modifiedFiles);
    
    // 2. Extraer SOLO esas partes
    for (const item of importedItems) {
      const code = await this.extractSpecificItem(fileContent, item);
      if (code) {
        relevantParts.push(code);
      }
    }
    
    return relevantParts.join('\n\n');
  }
  
  // Ejemplo: Extraer una interfaz específica
  extractInterface(fileContent, interfaceName) {
    const regex = new RegExp(
      `export\\s+interface\\s+${interfaceName}\\s*{[^}]+}`,
      'gs'
    );
    const match = fileContent.match(regex);
    return match ? match[0] : null;
  }
  
  // Ejemplo: Extraer una clase con sus métodos públicos
  extractClass(fileContent, className) {
    // Usar AST para extraer la clase
    const ast = parser.parse(fileContent, {
      sourceType: 'module',
      plugins: ['typescript', 'decorators-legacy']
    });
    
    let classCode = '';
    
    traverse(ast, {
      ClassDeclaration(path) {
        if (path.node.id.name === className) {
          // Extraer solo la firma de la clase y métodos públicos
          classCode = this.buildClassSignature(path.node);
        }
      }
    });
    
    return classCode;
  }
  
  buildClassSignature(classNode) {
    const signatures = [];
    
    // Nombre y decoradores de la clase
    signatures.push(`export class ${classNode.id.name} {`);
    
    // Solo métodos públicos y sus firmas (no implementación)
    for (const method of classNode.body.body) {
      if (method.type === 'ClassMethod' && !method.private) {
        const params = method.params.map(p => this.paramToString(p)).join(', ');
        const returnType = method.returnType ? `: ${this.typeToString(method.returnType)}` : '';
        
        signatures.push(`  ${method.key.name}(${params})${returnType};`);
      }
    }
    
    signatures.push('}');
    return signatures.join('\n');
  }
}
🔍 Ejemplos Concretos de Qué Enviar
Caso 1: Archivo Modificado usa una Interface
javascript
// ARCHIVO MODIFICADO: payment.service.ts
import { Payment, PaymentStatus } from '../interfaces/payment.interface';

class PaymentService {
  async processPayment(data: Payment) {
    // ... nuevo código
  }
}
Lo que enviamos al LLM:

javascript
{
  "modifiedFiles": [{
    "path": "src/services/payment.service.ts",
    "changes": "... el diff completo ..."
  }],
  
  "relatedFiles": [{
    "path": "src/interfaces/payment.interface.ts",
    "reason": "Interface imported by modified file",
    "code": `
      // Solo las interfaces que realmente se usan
      export interface Payment {
        id: string;
        amount: number;
        currency: string;
        status: PaymentStatus;
        customerId: string;
      }
      
      export enum PaymentStatus {
        PENDING = 'pending',
        COMPLETED = 'completed',
        FAILED = 'failed'
      }
    `
    // NO enviamos otras interfaces del mismo archivo que no se usan
  }]
}
Caso 2: Archivo Modificado extiende una Clase
javascript
// ARCHIVO MODIFICADO: stripe.service.ts
export class StripeService extends BasePaymentService {
  async charge(amount: number) {
    // ... nuevo código
  }
}
Lo que enviamos al LLM:

javascript
{
  "relatedFiles": [{
    "path": "src/services/base-payment.service.ts",
    "reason": "Parent class of modified service",
    "code": `
      // Solo la firma de la clase, no toda la implementación
      export abstract class BasePaymentService {
        protected logger: Logger;
        protected repository: PaymentRepository;
        
        constructor(repository: PaymentRepository);
        
        // Métodos que el hijo podría sobrescribir
        abstract charge(amount: number): Promise<ChargeResult>;
        abstract refund(paymentId: string): Promise<RefundResult>;
        
        // Métodos protegidos que el hijo podría usar
        protected validateAmount(amount: number): boolean;
        protected logTransaction(data: any): void;
      }
    `
  }]
}
Caso 3: Archivo que Depende del Modificado
javascript
// ARCHIVO RELACIONADO: payment.controller.ts (no modificado)
// Este archivo USA el PaymentService que SÍ fue modificado
Lo que enviamos al LLM:

javascript
{
  "relatedFiles": [{
    "path": "src/controllers/payment.controller.ts",
    "reason": "This controller depends on the modified PaymentService",
    "code": `
      // Solo el método que usa el servicio modificado
      @Controller('payments')
      export class PaymentController {
        @Post('/process')
        async processPayment(@Body() dto: ProcessPaymentDto) {
          // Mostrar cómo se usa actualmente el servicio
          const payment = await this.paymentService.processPayment({
            amount: dto.amount,
            currency: dto.currency,
            customerId: dto.customerId
          });
          
          return { success: true, paymentId: payment.id };
        }
      }
    `
  }]
}
📦 Implementación Completa para Extraer Código Relevante
javascript
class ContextualCodeExtractor {
  constructor(maxCodeLength = 2000) {
    this.maxCodeLength = maxCodeLength;
  }
  
  async buildContextForLLM(prFiles, dependencyGraph) {
    const context = {
      modifiedFiles: [],
      relatedCode: [],
      interfaces: [],
      summary: {}
    };
    
    // Para cada archivo modificado
    for (const file of prFiles) {
      // 1. Agregar el diff completo
      context.modifiedFiles.push({
        path: file.filename,
        diff: file.patch,
        additions: file.additions,
        deletions: file.deletions
      });
      
      // 2. Encontrar qué importa este archivo
      const imports = await this.extractImports(file.content);
      
      // 3. Para cada import interno, extraer el código relevante
      for (const imp of imports.internal) {
        const relevantCode = await this.extractRelevantImportedCode(
          imp.source,
          imp.items,
          dependencyGraph
        );
        
        if (relevantCode) {
          context.relatedCode.push({
            path: imp.source,
            reason: `Imported by ${file.filename}: ${imp.items.join(', ')}`,
            code: relevantCode
          });
        }
      }
      
      // 4. Encontrar quién usa este archivo (impacto)
      const dependents = dependencyGraph.findDependents(file.filename);
      for (const dependent of dependents.slice(0, 3)) { // Limitar a 3
        const usage = await this.extractUsageCode(dependent, file.filename);
        if (usage) {
          context.relatedCode.push({
            path: dependent,
            reason: `Uses modified file ${file.filename}`,
            code: usage
          });
        }
      }
    }
    
    // 5. Deduplicar y optimizar
    context.relatedCode = this.deduplicateAndOptimize(context.relatedCode);
    
    return context;
  }
  
  async extractRelevantImportedCode(filePath, importedItems, graph) {
    const fileContent = await this.readFile(filePath);
    if (!fileContent) return null;
    
    const extracted = [];
    
    for (const item of importedItems) {
      // Determinar qué tipo de elemento es
      const itemType = await this.detectItemType(fileContent, item);
      
      switch (itemType) {
        case 'interface':
          extracted.push(await this.extractInterface(fileContent, item));
          break;
          
        case 'class':
          // Para clases, solo extraer la firma
          extracted.push(await this.extractClassSignature(fileContent, item));
          break;
          
        case 'function':
          // Para funciones, solo la firma
          extracted.push(await this.extractFunctionSignature(fileContent, item));
          break;
          
        case 'const':
        case 'enum':
          // Para constantes y enums, el valor completo
          extracted.push(await this.extractConstOrEnum(fileContent, item));
          break;
          
        case 'type':
          extracted.push(await this.extractTypeDefinition(fileContent, item));
          break;
      }
    }
    
    const code = extracted.filter(Boolean).join('\n\n');
    
    // Truncar si es muy largo
    if (code.length > this.maxCodeLength) {
      return code.substring(0, this.maxCodeLength) + '\n// ... truncated';
    }
    
    return code;
  }
  
  async extractUsageCode(dependentFile, modifiedFile) {
    const content = await this.readFile(dependentFile);
    if (!content) return null;
    
    // Buscar métodos que usan el archivo modificado
    const ast = parser.parse(content, {
      sourceType: 'module',
      plugins: ['typescript', 'decorators-legacy']
    });
    
    const usages = [];
    
    traverse(ast, {
      CallExpression(path) {
        // Buscar llamadas a métodos del archivo modificado
        const callee = path.node.callee;
        if (this.isCallingModifiedFile(callee, modifiedFile)) {
          // Extraer el método completo que contiene esta llamada
          const methodCode = this.extractContainingMethod(path);
          if (methodCode) {
            usages.push(methodCode);
          }
        }
      }
    });
    
    return usages.slice(0, 2).join('\n\n'); // Máximo 2 ejemplos de uso
  }
  
  deduplicateAndOptimize(relatedCode) {
    // Eliminar duplicados
    const seen = new Set();
    const unique = [];
    
    for (const item of relatedCode) {
      const key = `${item.path}:${item.code.substring(0, 50)}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(item);
      }
    }
    
    // Ordenar por relevancia
    return unique.sort((a, b) => {
      // Priorizar interfaces y types
      if (a.code.includes('interface') && !b.code.includes('interface')) return -1;
      if (b.code.includes('interface') && !a.code.includes('interface')) return 1;
      
      // Luego clases base
      if (a.reason.includes('Parent class')) return -1;
      if (b.reason.includes('Parent class')) return 1;
      
      // Luego imports directos
      if (a.reason.includes('Imported by')) return -1;
      if (b.reason.includes('Imported by')) return 1;
      
      return 0;
    });
  }
}
🎨 Resultado Final para el LLM
javascript
const contextForLLM = {
  // CAMBIOS ACTUALES (diffs completos)
  "changes": [
    {
      "file": "src/services/payment.service.ts",
      "diff": "+ async processPayment(data: Payment): Promise<PaymentResult> {\n+   if (!this.validateAmount(data.amount)) {\n+     throw new Error('Invalid amount');\n+   }\n+   return await this.repository.save(data);\n+ }"
    }
  ],
  
  // CÓDIGO RELEVANTE (no archivos completos, solo lo necesario)
  "context": [
    {
      "file": "src/interfaces/payment.interface.ts",
      "reason": "Types used in modified service",
      "code": "export interface Payment {\n  id: string;\n  amount: number;\n  status: PaymentStatus;\n}\n\nexport interface PaymentResult {\n  success: boolean;\n  transactionId: string;\n}"
    },
    {
      "file": "src/repositories/payment.repository.ts", 
      "reason": "Repository methods called by service",
      "code": "export class PaymentRepository {\n  async save(payment: Payment): Promise<PaymentResult>;\n  async findById(id: string): Promise<Payment>;\n}"
    },
    {
      "file": "src/controllers/payment.controller.ts",
      "reason": "Controller that uses the modified service",
      "code": "@Post('/process')\nasync processPayment(@Body() dto: ProcessPaymentDto) {\n  // This shows how the service is currently being used\n  return await this.paymentService.processPayment(dto);\n}"
    }
  ]
};
Esto le da al LLM:

✅ Los cambios exactos (diffs)
✅ Las interfaces/tipos que se usan
✅ Las firmas de métodos relacionados
✅ Ejemplos de cómo se usa el código
❌ NO le damos implementaciones completas innecesarias
❌ NO le damos archivos enteros
❌ NO le damos código no relacionado
