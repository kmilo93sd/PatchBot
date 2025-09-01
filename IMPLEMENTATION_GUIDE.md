# Guía de Implementación - Sistema de Índice de Dependencias

## Descripción General

Esta guía proporciona instrucciones paso a paso para implementar el Sistema de Índice de Dependencias con ChromaDB integrado en el proyecto PR Revisor existente. La implementación está dividida en fases para facilitar el desarrollo incremental y la validación progresiva.

## Pre-requisitos

### Herramientas Requeridas
```bash
# Node.js y npm
node --version  # >= 18.x
npm --version   # >= 8.x

# AWS CLI configurado
aws --version   # >= 2.x
aws sts get-caller-identity  # Verificar credenciales

# SAM CLI
sam --version   # >= 1.100.x

# Docker (para ChromaDB local)
docker --version  # >= 20.x
docker-compose --version  # >= 2.x
```

### Variables de Entorno Base
```bash
# .env.local (para desarrollo)
export AWS_REGION=us-east-1
export AWS_PROFILE=default
export ENVIRONMENT=internal
export CHROMADB_HOST=localhost
export CHROMADB_PORT=8000
export CHROMADB_SSL=false
export NODE_ENV=development
export LOG_LEVEL=debug
```

## Fase 1: Configuración ChromaDB Local

### Paso 1.1: Configurar ChromaDB con Docker

Crear archivo `docker-compose.chromadb.yml`:
```yaml
version: '3.8'
services:
  chromadb:
    image: ghcr.io/chroma-core/chroma:latest
    ports:
      - "8000:8000"
    volumes:
      - chromadb-data:/chroma/chroma
    environment:
      - CHROMA_SERVER_AUTH_PROVIDER=chromadb.auth.token.TokenAuthServerProvider
      - CHROMA_SERVER_AUTH_TOKEN_TRANSPORT_HEADER=X-Chroma-Token
      - CHROMA_SERVER_AUTH_CREDENTIALS=test-token-dev
      - CHROMA_SERVER_HTTP_PORT=8000
      - CHROMA_SERVER_HOST=0.0.0.0
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/api/v1/heartbeat"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

volumes:
  chromadb-data:
    driver: local
```

Iniciar ChromaDB local:
```bash
# Iniciar ChromaDB
docker-compose -f docker-compose.chromadb.yml up -d

# Verificar que esté funcionando
curl http://localhost:8000/api/v1/heartbeat

# Verificar logs
docker-compose -f docker-compose.chromadb.yml logs -f chromadb
```

### Paso 1.2: Crear Capa Lambda ChromaDB

```bash
# Crear directorio para la capa
mkdir -p layers/chromadb-layer/nodejs

# Crear package.json para la capa
cat > layers/chromadb-layer/nodejs/package.json << 'EOF'
{
  "name": "chromadb-layer",
  "version": "1.0.0",
  "description": "ChromaDB client layer para PR Revisor",
  "dependencies": {
    "chromadb": "^1.8.1",
    "@huggingface/inference": "^2.6.4",
    "sentence-transformers": "^1.0.0",
    "crypto": "^1.0.1",
    "lru-cache": "^10.0.1"
  }
}
EOF

# Instalar dependencias de la capa
cd layers/chromadb-layer/nodejs
npm install
cd ../../../
```

### Paso 1.3: Configurar Cliente ChromaDB Base

Crear `src/common/chromadb/chromaClient.js`:
```javascript
const { ChromaApi } = require('chromadb');
const { Configuration } = require('chromadb');
const crypto = require('crypto');
const LRUCache = require('lru-cache');

class ChromaDBClient {
  constructor(config = {}) {
    this.config = {
      host: process.env.CHROMADB_HOST || 'localhost',
      port: process.env.CHROMADB_PORT || 8000,
      ssl: process.env.CHROMADB_SSL === 'true',
      auth: {
        token: process.env.CHROMADB_AUTH_TOKEN || 'test-token-dev'
      },
      ...config
    };

    const configuration = new Configuration({
      basePath: `http${this.config.ssl ? 's' : ''}://${this.config.host}:${this.config.port}`,
      apiKey: this.config.auth.token
    });

    this.client = new ChromaApi(configuration);
    this.cache = new LRUCache({ max: 500, ttl: 1000 * 60 * 10 }); // 10 min cache
    this.logger = this.initLogger();
  }

  initLogger() {
    return {
      info: (msg, meta = {}) => console.log(JSON.stringify({ level: 'info', message: msg, ...meta })),
      error: (msg, error = {}) => console.error(JSON.stringify({ level: 'error', message: msg, error: error.message, stack: error.stack })),
      debug: (msg, meta = {}) => process.env.LOG_LEVEL === 'debug' && console.log(JSON.stringify({ level: 'debug', message: msg, ...meta }))
    };
  }

  async getOrCreateCollection(params) {
    const { name, metadata = {}, embeddingFunction = null } = params;
    const cacheKey = `collection-${name}`;
    
    try {
      // Check cache first
      if (this.cache.has(cacheKey)) {
        return this.cache.get(cacheKey);
      }

      // Try to get existing collection
      let collection;
      try {
        collection = await this.client.getCollection({ name });
        this.logger.info(`Found existing collection: ${name}`);
      } catch (error) {
        if (error.status === 404 || error.response?.status === 404) {
          // Collection doesn't exist, create it
          this.logger.info(`Creating new collection: ${name}`);
          
          collection = await this.client.createCollection({
            name,
            metadata: {
              ...metadata,
              createdAt: new Date().toISOString(),
              version: '1.0.0'
            },
            embeddingFunction
          });
        } else {
          throw error;
        }
      }

      // Cache the collection reference
      this.cache.set(cacheKey, collection);
      return collection;
    } catch (error) {
      this.logger.error(`Error getting/creating collection ${name}`, error);
      throw error;
    }
  }

  async addDocuments(params) {
    const {
      collectionName,
      documents,
      metadatas,
      ids,
      embeddings = null
    } = params;

    try {
      const collection = await this.getOrCreateCollection({ name: collectionName });
      
      const result = await collection.add({
        documents,
        metadatas,
        ids,
        embeddings
      });

      this.logger.info(`Added ${documents.length} documents to ${collectionName}`);
      return result;
    } catch (error) {
      this.logger.error(`Error adding documents to ${collectionName}`, error);
      throw error;
    }
  }

  async semanticSearch(params) {
    const {
      collectionName,
      queryTexts,
      nResults = 10,
      where = {},
      include = ['documents', 'metadatas', 'distances']
    } = params;

    try {
      const collection = await this.getOrCreateCollection({ name: collectionName });
      
      const startTime = Date.now();
      const results = await collection.query({
        queryTexts,
        nResults,
        where,
        include
      });
      
      const duration = Date.now() - startTime;
      this.logger.debug(`Query completed in ${duration}ms`, {
        collection: collectionName,
        resultsCount: results.ids?.[0]?.length || 0,
        duration
      });

      return this.processSearchResults(results, include.includes('distances'));
    } catch (error) {
      this.logger.error(`Error in semantic search for ${collectionName}`, error);
      throw error;
    }
  }

  processSearchResults(rawResults, includeDistance = true) {
    if (!rawResults.ids || !rawResults.ids[0]) {
      return [];
    }

    const results = [];
    const ids = rawResults.ids[0];
    
    for (let i = 0; i < ids.length; i++) {
      const result = {
        id: ids[i],
        document: rawResults.documents?.[0]?.[i] || null,
        metadata: rawResults.metadatas?.[0]?.[i] || {}
      };
      
      if (includeDistance && rawResults.distances?.[0]) {
        result.distance = rawResults.distances[0][i];
        result.similarity = 1 - result.distance; // Convert distance to similarity
      }
      
      results.push(result);
    }

    return results;
  }

  async updateDocuments(params) {
    const {
      collectionName,
      ids,
      documents = null,
      metadatas = null,
      embeddings = null
    } = params;

    try {
      const collection = await this.getOrCreateCollection({ name: collectionName });
      
      const result = await collection.update({
        ids,
        documents,
        metadatas,
        embeddings
      });

      this.logger.info(`Updated ${ids.length} documents in ${collectionName}`);
      return result;
    } catch (error) {
      this.logger.error(`Error updating documents in ${collectionName}`, error);
      throw error;
    }
  }

  async deleteDocuments(params) {
    const { collectionName, ids = null, where = null } = params;

    try {
      const collection = await this.getOrCreateCollection({ name: collectionName });
      
      const result = await collection.delete({
        ids,
        where
      });

      this.logger.info(`Deleted documents from ${collectionName}`, { ids, where });
      return result;
    } catch (error) {
      this.logger.error(`Error deleting documents from ${collectionName}`, error);
      throw error;
    }
  }

  async getCollectionInfo(collectionName) {
    try {
      const collection = await this.getOrCreateCollection({ name: collectionName });
      const count = await collection.count();
      
      return {
        name: collectionName,
        count,
        metadata: collection.metadata || {}
      };
    } catch (error) {
      this.logger.error(`Error getting collection info for ${collectionName}`, error);
      throw error;
    }
  }

  async listCollections() {
    try {
      const collections = await this.client.listCollections();
      return collections.map(collection => ({
        name: collection.name,
        metadata: collection.metadata || {}
      }));
    } catch (error) {
      this.logger.error('Error listing collections', error);
      throw error;
    }
  }

  // Utility methods
  generateId(prefix = 'doc') {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  generateQueryHash(params) {
    return crypto
      .createHash('md5')
      .update(JSON.stringify(params))
      .digest('hex');
  }
}

module.exports = ChromaDBClient;
```

## Fase 2: Implementar Dependency Indexer Lambda

### Paso 2.1: Crear Estructura Base

```bash
# Crear directorios para la función indexer
mkdir -p src/dependency-indexer/{core,adapters,utils,config}
```

### Paso 2.2: Crear Handler Principal

Crear `src/dependency-indexer/app.js`:
```javascript
const ChromaDBClient = require('../common/chromadb/chromaClient');
const DependencyIndexer = require('./core/indexer');
const GitHubAdapter = require('./adapters/githubAdapter');
const { logger } = require('./utils/logger');
const { validateIndexerEvent } = require('./utils/validator');

// Global clients (reuse across warm invocations)
let chromaClient;
let dependencyIndexer;

const initializeClients = () => {
  if (!chromaClient) {
    chromaClient = new ChromaDBClient({
      host: process.env.CHROMADB_HOST,
      port: process.env.CHROMADB_PORT,
      ssl: process.env.CHROMADB_SSL === 'true',
      auth: {
        token: process.env.CHROMADB_AUTH_TOKEN
      }
    });
  }

  if (!dependencyIndexer) {
    dependencyIndexer = new DependencyIndexer({
      chromaClient,
      logger
    });
  }
};

exports.lambdaHandler = async (event, context) => {
  const requestId = context.awsRequestId;
  const startTime = Date.now();
  
  logger.addPersistentLogAttributes({
    requestId,
    functionName: context.functionName,
    functionVersion: context.functionVersion
  });

  try {
    logger.info('Dependency indexer started', { event });
    
    // Initialize clients
    initializeClients();
    
    // Validate event
    const validationResult = validateIndexerEvent(event);
    if (!validationResult.isValid) {
      throw new Error(`Invalid event: ${validationResult.errors.join(', ')}`);
    }

    const { repositoryUrl, repositoryId, indexType = 'full', options = {} } = event;
    
    // Process indexing
    const result = await dependencyIndexer.indexRepository({
      repositoryUrl,
      repositoryId,
      indexType,
      options,
      requestId
    });

    const duration = Date.now() - startTime;
    logger.info('Dependency indexing completed', {
      repositoryId,
      duration,
      result: {
        dependenciesIndexed: result.dependenciesIndexed,
        codeFragmentsIndexed: result.codeFragmentsIndexed,
        collectionsCreated: result.collectionsCreated
      }
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        requestId,
        duration,
        result
      })
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Dependency indexing failed', error, {
      duration,
      event
    });

    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        requestId,
        duration,
        error: {
          message: error.message,
          type: error.constructor.name
        }
      })
    };
  }
};
```

### Paso 2.3: Implementar Core Indexer

Crear `src/dependency-indexer/core/indexer.js`:
```javascript
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const os = require('os');

const DependencyParser = require('./parser');
const CodeFragmentExtractor = require('./fragmentExtractor');

class DependencyIndexer {
  constructor(config = {}) {
    this.chromaClient = config.chromaClient;
    this.logger = config.logger;
    this.parser = new DependencyParser();
    this.fragmentExtractor = new CodeFragmentExtractor();
    this.tempDir = null;
  }

  async indexRepository(params) {
    const {
      repositoryUrl,
      repositoryId,
      indexType = 'full',
      options = {},
      requestId
    } = params;

    this.logger.info(`Starting ${indexType} indexing for repository`, {
      repositoryUrl,
      repositoryId,
      requestId
    });

    try {
      // Clone repository
      const repoPath = await this.cloneRepository(repositoryUrl, requestId);
      
      // Initialize collections
      await this.initializeCollections(repositoryId);
      
      // Analyze repository structure
      const repoInfo = await this.analyzeRepository(repoPath);
      
      // Parse dependencies
      const dependencies = await this.parser.parseDependencies(repoPath, repoInfo.language);
      
      // Extract code fragments
      const codeFragments = await this.fragmentExtractor.extractFragments(repoPath, repoInfo);
      
      // Index dependencies in ChromaDB
      const dependenciesResult = await this.indexDependencies(repositoryId, dependencies);
      
      // Index code fragments in ChromaDB
      const fragmentsResult = await this.indexCodeFragments(repositoryId, codeFragments);
      
      // Cleanup
      await this.cleanup(repoPath);
      
      return {
        repositoryId,
        repositoryUrl,
        indexType,
        collectionsCreated: [`dependencies-${repositoryId}`, `code-fragments-${repositoryId}`],
        dependenciesIndexed: dependenciesResult.count,
        codeFragmentsIndexed: fragmentsResult.count,
        repoInfo
      };

    } catch (error) {
      this.logger.error('Repository indexing failed', error, {
        repositoryUrl,
        repositoryId,
        requestId
      });
      
      // Ensure cleanup happens even on error
      if (this.tempDir) {
        await this.cleanup(this.tempDir);
      }
      
      throw error;
    }
  }

  async cloneRepository(repositoryUrl, requestId) {
    this.tempDir = path.join(os.tmpdir(), `repo-${requestId}`);
    
    try {
      this.logger.info('Cloning repository', { repositoryUrl, tempDir: this.tempDir });
      
      // Create temp directory
      await fs.mkdir(this.tempDir, { recursive: true });
      
      // Clone repository (shallow clone for performance)
      const cloneCmd = `git clone --depth 1 "${repositoryUrl}" "${this.tempDir}"`;
      execSync(cloneCmd, { 
        stdio: 'pipe',
        timeout: 300000 // 5 minutes timeout
      });
      
      this.logger.info('Repository cloned successfully', { tempDir: this.tempDir });
      return this.tempDir;
      
    } catch (error) {
      this.logger.error('Failed to clone repository', error, { repositoryUrl });
      throw new Error(`Failed to clone repository: ${error.message}`);
    }
  }

  async initializeCollections(repositoryId) {
    const collections = [
      {
        name: `dependencies-${repositoryId}`,
        metadata: {
          purpose: 'dependencies',
          repository: repositoryId,
          schema: 'dependency-v1'
        }
      },
      {
        name: `code-fragments-${repositoryId}`,
        metadata: {
          purpose: 'code-fragments',
          repository: repositoryId,
          schema: 'fragment-v1'
        }
      }
    ];

    for (const collection of collections) {
      await this.chromaClient.getOrCreateCollection(collection);
      this.logger.info(`Initialized collection: ${collection.name}`);
    }
  }

  async analyzeRepository(repoPath) {
    const packageFiles = [
      'package.json',      // JavaScript/Node.js
      'requirements.txt',  // Python pip
      'Pipfile',          // Python pipenv
      'pyproject.toml',   // Python modern
      'pom.xml',          // Java Maven
      'build.gradle',     // Java Gradle
      'Cargo.toml',       // Rust
      'go.mod',           // Go
      '*.csproj',         // C#
      'composer.json'     // PHP
    ];

    const detectedFiles = [];
    let primaryLanguage = 'unknown';

    for (const pattern of packageFiles) {
      const files = await this.findFiles(repoPath, pattern);
      detectedFiles.push(...files);
    }

    // Determine primary language
    if (detectedFiles.some(f => f.endsWith('package.json'))) {
      primaryLanguage = 'javascript';
    } else if (detectedFiles.some(f => f.includes('requirements.txt') || f.includes('pyproject.toml'))) {
      primaryLanguage = 'python';
    } else if (detectedFiles.some(f => f.includes('pom.xml') || f.includes('build.gradle'))) {
      primaryLanguage = 'java';
    } else if (detectedFiles.some(f => f.includes('go.mod'))) {
      primaryLanguage = 'go';
    } else if (detectedFiles.some(f => f.includes('.csproj'))) {
      primaryLanguage = 'csharp';
    }

    return {
      language: primaryLanguage,
      packageFiles: detectedFiles,
      rootPath: repoPath
    };
  }

  async findFiles(basePath, pattern) {
    try {
      if (pattern.includes('*')) {
        // Handle glob patterns
        const cmd = `find "${basePath}" -name "${pattern}" -type f`;
        const output = execSync(cmd, { encoding: 'utf8' });
        return output.trim().split('\n').filter(line => line.length > 0);
      } else {
        // Handle exact filenames
        const fullPath = path.join(basePath, pattern);
        try {
          await fs.access(fullPath);
          return [fullPath];
        } catch {
          return [];
        }
      }
    } catch (error) {
      this.logger.debug(`No files found for pattern: ${pattern}`, { error: error.message });
      return [];
    }
  }

  async indexDependencies(repositoryId, dependencies) {
    const collectionName = `dependencies-${repositoryId}`;
    
    if (dependencies.length === 0) {
      this.logger.info('No dependencies found to index');
      return { count: 0 };
    }

    const documents = [];
    const metadatas = [];
    const ids = [];

    for (const dep of dependencies) {
      const id = this.chromaClient.generateId('dep');
      const document = this.createDependencyDocument(dep);
      const metadata = this.createDependencyMetadata(dep, repositoryId);

      ids.push(id);
      documents.push(document);
      metadatas.push(metadata);
    }

    await this.chromaClient.addDocuments({
      collectionName,
      documents,
      metadatas,
      ids
    });

    this.logger.info(`Indexed ${dependencies.length} dependencies`, {
      repositoryId,
      collectionName
    });

    return { count: dependencies.length };
  }

  createDependencyDocument(dependency) {
    // Create searchable text document
    const parts = [
      dependency.name,
      dependency.description || '',
      dependency.keywords?.join(' ') || '',
      dependency.category || '',
      dependency.type || ''
    ];
    
    return parts.filter(part => part.length > 0).join(' ');
  }

  createDependencyMetadata(dependency, repositoryId) {
    return {
      id: dependency.id || this.chromaClient.generateId('dep'),
      name: dependency.name,
      version: dependency.version,
      type: dependency.type, // dependency, devDependency, peerDependency
      category: dependency.category || 'unknown',
      language: dependency.language,
      license: dependency.license || 'unknown',
      repository: repositoryId,
      filePath: dependency.filePath,
      lastUpdated: new Date().toISOString(),
      isDirect: dependency.isDirect !== false,
      isDeprecated: dependency.isDeprecated || false,
      hasVulnerabilities: dependency.vulnerabilities?.length > 0 || false,
      vulnerabilityCount: dependency.vulnerabilities?.length || 0,
      downloadCount: dependency.downloadCount || 0
    };
  }

  async indexCodeFragments(repositoryId, fragments) {
    const collectionName = `code-fragments-${repositoryId}`;
    
    if (fragments.length === 0) {
      this.logger.info('No code fragments found to index');
      return { count: 0 };
    }

    // Process in batches to avoid memory issues
    const batchSize = 100;
    let totalIndexed = 0;

    for (let i = 0; i < fragments.length; i += batchSize) {
      const batch = fragments.slice(i, i + batchSize);
      
      const documents = [];
      const metadatas = [];
      const ids = [];

      for (const fragment of batch) {
        const id = this.chromaClient.generateId('frag');
        const document = this.createFragmentDocument(fragment);
        const metadata = this.createFragmentMetadata(fragment, repositoryId);

        ids.push(id);
        documents.push(document);
        metadatas.push(metadata);
      }

      await this.chromaClient.addDocuments({
        collectionName,
        documents,
        metadatas,
        ids
      });

      totalIndexed += batch.length;
      this.logger.debug(`Indexed batch of ${batch.length} fragments`, {
        totalIndexed,
        repositoryId
      });
    }

    this.logger.info(`Indexed ${totalIndexed} code fragments`, {
      repositoryId,
      collectionName
    });

    return { count: totalIndexed };
  }

  createFragmentDocument(fragment) {
    // Normalize code for better semantic search
    const normalizedCode = fragment.code
      .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
      .replace(/\/\/.*$/gm, '') // Remove line comments
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
    
    return `${fragment.functionName || ''} ${normalizedCode}`.trim();
  }

  createFragmentMetadata(fragment, repositoryId) {
    return {
      id: fragment.id || this.chromaClient.generateId('frag'),
      filePath: fragment.filePath,
      startLine: fragment.startLine,
      endLine: fragment.endLine,
      language: fragment.language,
      functionName: fragment.functionName || null,
      className: fragment.className || null,
      dependencies: fragment.dependencies || [],
      repository: repositoryId,
      complexity: fragment.complexity || 'unknown',
      linesOfCode: fragment.endLine - fragment.startLine + 1,
      lastModified: new Date().toISOString(),
      isTestFile: fragment.filePath.includes('test') || fragment.filePath.includes('spec'),
      hasComments: (fragment.code.match(/\/\/|\/\*/g) || []).length > 0
    };
  }

  async cleanup(repoPath) {
    if (repoPath && this.tempDir) {
      try {
        await fs.rm(this.tempDir, { recursive: true, force: true });
        this.logger.info('Cleanup completed', { tempDir: this.tempDir });
        this.tempDir = null;
      } catch (error) {
        this.logger.error('Cleanup failed', error, { tempDir: this.tempDir });
      }
    }
  }
}

module.exports = DependencyIndexer;
```

### Paso 2.4: Crear Parser de Dependencias

Crear `src/dependency-indexer/core/parser.js`:
```javascript
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class DependencyParser {
  constructor() {
    this.parsers = {
      javascript: this.parseJavaScriptDependencies.bind(this),
      python: this.parsePythonDependencies.bind(this),
      java: this.parseJavaDependencies.bind(this),
      go: this.parseGoDependencies.bind(this),
      csharp: this.parseCSharpDependencies.bind(this)
    };
  }

  async parseDependencies(repoPath, language) {
    const parser = this.parsers[language];
    if (!parser) {
      throw new Error(`Unsupported language: ${language}`);
    }

    try {
      const dependencies = await parser(repoPath);
      return dependencies.map(dep => ({
        ...dep,
        id: this.generateDependencyId(dep),
        language,
        parsedAt: new Date().toISOString()
      }));
    } catch (error) {
      throw new Error(`Failed to parse ${language} dependencies: ${error.message}`);
    }
  }

  async parseJavaScriptDependencies(repoPath) {
    const dependencies = [];
    const packageJsonPath = path.join(repoPath, 'package.json');

    try {
      const packageContent = await fs.readFile(packageJsonPath, 'utf8');
      const packageJson = JSON.parse(packageContent);

      // Parse production dependencies
      if (packageJson.dependencies) {
        for (const [name, version] of Object.entries(packageJson.dependencies)) {
          dependencies.push({
            name,
            version,
            type: 'dependency',
            category: this.categorizeDependency(name),
            filePath: 'package.json',
            isDirect: true,
            description: null,
            license: null
          });
        }
      }

      // Parse dev dependencies
      if (packageJson.devDependencies) {
        for (const [name, version] of Object.entries(packageJson.devDependencies)) {
          dependencies.push({
            name,
            version,
            type: 'devDependency',
            category: this.categorizeDependency(name),
            filePath: 'package.json',
            isDirect: true,
            description: null,
            license: null
          });
        }
      }

      // Parse peer dependencies
      if (packageJson.peerDependencies) {
        for (const [name, version] of Object.entries(packageJson.peerDependencies)) {
          dependencies.push({
            name,
            version,
            type: 'peerDependency',
            category: this.categorizeDependency(name),
            filePath: 'package.json',
            isDirect: true,
            description: null,
            license: null
          });
        }
      }

      // Try to get package-lock.json for more details
      await this.enrichWithLockFile(dependencies, repoPath, 'package-lock.json');

    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    return dependencies;
  }

  async parsePythonDependencies(repoPath) {
    const dependencies = [];

    // Try requirements.txt
    await this.parseRequirementsTxt(repoPath, dependencies);
    
    // Try Pipfile
    await this.parsePipfile(repoPath, dependencies);
    
    // Try pyproject.toml
    await this.parsePyprojectToml(repoPath, dependencies);

    return dependencies;
  }

  async parseRequirementsTxt(repoPath, dependencies) {
    const requirementsPath = path.join(repoPath, 'requirements.txt');
    
    try {
      const content = await fs.readFile(requirementsPath, 'utf8');
      const lines = content.split('\n').filter(line => 
        line.trim() && !line.startsWith('#') && !line.startsWith('-')
      );

      for (const line of lines) {
        const match = line.match(/^([a-zA-Z0-9\-_.]+)(?:\s*([><=!]+)\s*(.+))?/);
        if (match) {
          const [, name, operator, version] = match;
          dependencies.push({
            name,
            version: operator && version ? `${operator}${version}` : '*',
            type: 'dependency',
            category: this.categorizeDependency(name),
            filePath: 'requirements.txt',
            isDirect: true
          });
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async parsePipfile(repoPath, dependencies) {
    const pipfilePath = path.join(repoPath, 'Pipfile');
    
    try {
      const content = await fs.readFile(pipfilePath, 'utf8');
      // Basic TOML parsing for dependencies
      const lines = content.split('\n');
      let inPackagesSection = false;
      let inDevPackagesSection = false;

      for (const line of lines) {
        if (line.trim() === '[packages]') {
          inPackagesSection = true;
          inDevPackagesSection = false;
          continue;
        }
        if (line.trim() === '[dev-packages]') {
          inDevPackagesSection = true;
          inPackagesSection = false;
          continue;
        }
        if (line.trim().startsWith('[') && line.trim().endsWith(']')) {
          inPackagesSection = false;
          inDevPackagesSection = false;
          continue;
        }

        if ((inPackagesSection || inDevPackagesSection) && line.includes('=')) {
          const [name, version] = line.split('=').map(s => s.trim().replace(/"/g, ''));
          if (name && version) {
            dependencies.push({
              name,
              version,
              type: inDevPackagesSection ? 'devDependency' : 'dependency',
              category: this.categorizeDependency(name),
              filePath: 'Pipfile',
              isDirect: true
            });
          }
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async parsePyprojectToml(repoPath, dependencies) {
    // Implementation for pyproject.toml parsing
    // This would require a proper TOML parser
    // For now, we'll skip this or implement basic parsing
  }

  async parseJavaDependencies(repoPath) {
    const dependencies = [];

    // Parse Maven pom.xml
    await this.parseMavenPom(repoPath, dependencies);
    
    // Parse Gradle build.gradle
    await this.parseGradleBuild(repoPath, dependencies);

    return dependencies;
  }

  async parseMavenPom(repoPath, dependencies) {
    const pomPath = path.join(repoPath, 'pom.xml');
    
    try {
      const content = await fs.readFile(pomPath, 'utf8');
      
      // Basic XML parsing for Maven dependencies
      // This is a simplified implementation - production should use proper XML parser
      const dependencyMatches = content.match(/<dependency>[\s\S]*?<\/dependency>/g);
      
      if (dependencyMatches) {
        for (const depXml of dependencyMatches) {
          const groupId = this.extractXmlValue(depXml, 'groupId');
          const artifactId = this.extractXmlValue(depXml, 'artifactId');
          const version = this.extractXmlValue(depXml, 'version');
          const scope = this.extractXmlValue(depXml, 'scope') || 'compile';

          if (groupId && artifactId) {
            dependencies.push({
              name: `${groupId}:${artifactId}`,
              version: version || '*',
              type: scope === 'test' ? 'testDependency' : 'dependency',
              category: this.categorizeDependency(artifactId),
              filePath: 'pom.xml',
              isDirect: true,
              groupId,
              artifactId
            });
          }
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async parseGradleBuild(repoPath, dependencies) {
    const buildGradlePath = path.join(repoPath, 'build.gradle');
    
    try {
      const content = await fs.readFile(buildGradlePath, 'utf8');
      
      // Parse Gradle dependencies - simplified regex approach
      const depMatches = content.match(/(implementation|api|compile|testImplementation|testCompile)\s+['"]([^'"]+)['"]/g);
      
      if (depMatches) {
        for (const match of depMatches) {
          const [, scope, dependency] = match.match(/(implementation|api|compile|testImplementation|testCompile)\s+['"]([^'"]+)['"]/);
          const parts = dependency.split(':');
          
          if (parts.length >= 2) {
            const groupId = parts[0];
            const artifactId = parts[1];
            const version = parts[2] || '*';
            
            dependencies.push({
              name: `${groupId}:${artifactId}`,
              version,
              type: scope.includes('test') ? 'testDependency' : 'dependency',
              category: this.categorizeDependency(artifactId),
              filePath: 'build.gradle',
              isDirect: true,
              groupId,
              artifactId,
              scope
            });
          }
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async parseGoDependencies(repoPath) {
    const dependencies = [];
    const goModPath = path.join(repoPath, 'go.mod');
    
    try {
      const content = await fs.readFile(goModPath, 'utf8');
      const lines = content.split('\n');
      
      let inRequireSection = false;
      
      for (const line of lines) {
        if (line.trim() === 'require (') {
          inRequireSection = true;
          continue;
        }
        
        if (inRequireSection && line.trim() === ')') {
          inRequireSection = false;
          continue;
        }
        
        if (line.trim().startsWith('require ') || inRequireSection) {
          const cleanLine = line.replace('require ', '').trim();
          const match = cleanLine.match(/^([^\s]+)\s+([^\s]+)/);
          
          if (match) {
            const [, name, version] = match;
            dependencies.push({
              name,
              version,
              type: 'dependency',
              category: this.categorizeDependency(name),
              filePath: 'go.mod',
              isDirect: !line.includes('// indirect')
            });
          }
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    return dependencies;
  }

  async parseCSharpDependencies(repoPath) {
    const dependencies = [];
    
    // Find .csproj files
    const csprojFiles = await this.findCsprojFiles(repoPath);
    
    for (const csprojFile of csprojFiles) {
      await this.parseCsprojFile(csprojFile, dependencies);
    }

    return dependencies;
  }

  async findCsprojFiles(repoPath) {
    const { execSync } = require('child_process');
    try {
      const output = execSync(`find "${repoPath}" -name "*.csproj" -type f`, { encoding: 'utf8' });
      return output.trim().split('\n').filter(line => line.length > 0);
    } catch {
      return [];
    }
  }

  async parseCsprojFile(filePath, dependencies) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const packageRefMatches = content.match(/<PackageReference[^>]*>/g);
      
      if (packageRefMatches) {
        for (const match of packageRefMatches) {
          const include = this.extractAttribute(match, 'Include');
          const version = this.extractAttribute(match, 'Version');
          
          if (include) {
            dependencies.push({
              name: include,
              version: version || '*',
              type: 'dependency',
              category: this.categorizeDependency(include),
              filePath: path.relative(process.cwd(), filePath),
              isDirect: true
            });
          }
        }
      }
    } catch (error) {
      // Skip files that can't be read
    }
  }

  // Helper methods
  extractXmlValue(xml, tag) {
    const match = xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`));
    return match ? match[1] : null;
  }

  extractAttribute(xml, attribute) {
    const match = xml.match(new RegExp(`${attribute}="([^"]+)"`));
    return match ? match[1] : null;
  }

  categorizeDependency(name) {
    // Simple categorization based on common patterns
    if (name.includes('test') || name.includes('junit') || name.includes('jest')) {
      return 'testing';
    }
    if (name.includes('express') || name.includes('fastapi') || name.includes('spring')) {
      return 'web-framework';
    }
    if (name.includes('react') || name.includes('vue') || name.includes('angular')) {
      return 'frontend-framework';
    }
    if (name.includes('database') || name.includes('mysql') || name.includes('postgres')) {
      return 'database';
    }
    if (name.includes('aws') || name.includes('azure') || name.includes('gcp')) {
      return 'cloud';
    }
    return 'library';
  }

  async enrichWithLockFile(dependencies, repoPath, lockFileName) {
    const lockPath = path.join(repoPath, lockFileName);
    
    try {
      const lockContent = await fs.readFile(lockPath, 'utf8');
      const lockData = JSON.parse(lockContent);
      
      // Enrich dependencies with information from lock file
      // This is simplified - production implementation would be more thorough
      if (lockData.dependencies) {
        for (const dep of dependencies) {
          const lockInfo = lockData.dependencies[dep.name];
          if (lockInfo) {
            dep.resolvedVersion = lockInfo.version;
            dep.integrity = lockInfo.integrity;
          }
        }
      }
    } catch (error) {
      // Lock file not found or invalid - skip enrichment
    }
  }

  generateDependencyId(dependency) {
    const key = `${dependency.name}-${dependency.version}-${dependency.type}`;
    return crypto.createHash('md5').update(key).digest('hex');
  }
}

module.exports = DependencyParser;
```

### Paso 2.5: Actualizar Template SAM

Agregar al `template.yml`:
```yaml
# Agregar después de PRProcessorFunction
DependencyIndexerFunction:
  Type: AWS::Serverless::Function
  Properties:
    FunctionName: !Join ["-", [!Ref envName, "nbx", "dependency-indexer", "lambda"]]
    CodeUri: src/dependency-indexer/
    Handler: app.lambdaHandler
    Runtime: nodejs20.x
    Timeout: 900  # 15 minutos para indexación completa
    MemorySize: 2048  # Más memoria para procesamiento de repos grandes
    Layers:
      - !Ref AwsSdkLayer
      - !Ref ChromaDBLayer
    Environment:
      Variables:
        # Variables ChromaDB
        CHROMADB_HOST: !Ref ChromaDBHost
        CHROMADB_PORT: !Ref ChromaDBPort
        CHROMADB_SSL: !Ref ChromaDBSSL
        CHROMADB_AUTH_TOKEN: !Ref ChromaDBAuthToken
        # Variables de aplicación
        DEPENDENCY_INDEX_QUEUE_URL: !Ref DependencyIndexQueue
        GITHUB_TOKEN: !Ref GitHubToken
        TEMP_STORAGE_BUCKET: !Ref TempStorageBucket
    Policies:
      # Permisos DynamoDB
      - DynamoDBCrudPolicy:
          TableName: !Ref ReviewJobsTable
      # Permisos S3 para almacenamiento temporal
      - S3CrudPolicy:
          BucketName: !Ref TempStorageBucket
      # Permisos Secrets Manager para tokens
      - AWSSecretsManagerGetSecretValuePolicy:
          SecretArn: !Ref GitHubTokenSecret
    Events:
      IndexingQueue:
        Type: SQS
        Properties:
          Queue: !GetAtt DependencyIndexQueue.Arn
          BatchSize: 1
          FunctionResponseTypes:
            - ReportBatchItemFailures
      IndexingAPI:
        Type: Api
        Properties:
          RestApiId: !Ref PRRevisorApi
          Path: /index-repository
          Method: POST

# Agregar nueva capa ChromaDB
ChromaDBLayer:
  Type: AWS::Serverless::LayerVersion
  Properties:
    LayerName: !Sub "${envName}-chromadb-layer"
    Description: ChromaDB client and utilities layer
    ContentUri: layers/chromadb-layer/
    CompatibleRuntimes:
      - nodejs20.x
    RetentionPolicy: Retain

# Cola para trabajos de indexación
DependencyIndexQueue:
  Type: AWS::SQS::Queue
  Properties:
    QueueName: !Sub "dependency-index-queue-${envName}"
    VisibilityTimeout: 900  # 15 minutos
    MessageRetentionPeriod: 1209600  # 14 días
    ReceiveMessageWaitTimeSeconds: 20
    RedrivePolicy:
      deadLetterTargetArn: !GetAtt DependencyIndexDLQ.Arn
      maxReceiveCount: 3

DependencyIndexDLQ:
  Type: AWS::SQS::Queue
  Properties:
    QueueName: !Sub "dependency-index-queue-dlq-${envName}"
    MessageRetentionPeriod: 1209600  # 14 días

# S3 bucket para almacenamiento temporal
TempStorageBucket:
  Type: AWS::S3::Bucket
  Properties:
    BucketName: !Sub "${envName}-pr-revisor-temp-${AWS::AccountId}"
    BucketEncryption:
      ServerSideEncryptionConfiguration:
        - ServerSideEncryptionByDefault:
            SSEAlgorithm: AES256
    LifecycleConfiguration:
      Rules:
        - Id: DeleteTempFiles
          Status: Enabled
          ExpirationInDays: 1  # Limpiar archivos después de 1 día

# Parámetros adicionales
Parameters:
  ChromaDBHost:
    Type: String
    Default: localhost
    Description: ChromaDB host endpoint

  ChromaDBPort:
    Type: String
    Default: "8000"
    Description: ChromaDB port

  ChromaDBSSL:
    Type: String
    Default: "false"
    AllowedValues: ["true", "false"]
    Description: Use SSL for ChromaDB connection

  ChromaDBAuthToken:
    Type: String
    Default: test-token-dev
    Description: ChromaDB authentication token
```

## Fase 3: Testing y Validación

### Paso 3.1: Crear Eventos de Prueba

Crear `events/dependency-indexer-event.json`:
```json
{
  "repositoryUrl": "https://github.com/expressjs/express.git",
  "repositoryId": "express-test-repo",
  "indexType": "full",
  "options": {
    "includeDevDependencies": true,
    "includeCodeFragments": true,
    "maxFileSize": 1048576
  }
}
```

### Paso 3.2: Crear Script de Testing

Crear `scripts/test-dependency-indexer.js`:
```javascript
#!/usr/bin/env node

const ChromaDBClient = require('../src/common/chromadb/chromaClient');
const { execSync } = require('child_process');

async function testChromaDBConnection() {
  console.log('🔍 Testing ChromaDB connection...');
  
  const client = new ChromaDBClient({
    host: 'localhost',
    port: 8000,
    ssl: false,
    auth: { token: 'test-token-dev' }
  });

  try {
    const collections = await client.listCollections();
    console.log('✅ ChromaDB connection successful');
    console.log(`📊 Found ${collections.length} collections`);
    return true;
  } catch (error) {
    console.error('❌ ChromaDB connection failed:', error.message);
    return false;
  }
}

async function testLocalInvocation() {
  console.log('🚀 Testing local Lambda invocation...');
  
  try {
    const result = execSync(
      'sam local invoke DependencyIndexerFunction --event events/dependency-indexer-event.json',
      { encoding: 'utf8', timeout: 600000 } // 10 minutes timeout
    );
    
    console.log('✅ Local invocation successful');
    console.log('📋 Result:', JSON.parse(result));
    return true;
  } catch (error) {
    console.error('❌ Local invocation failed:', error.message);
    return false;
  }
}

async function testCollectionOperations() {
  console.log('🧪 Testing collection operations...');
  
  const client = new ChromaDBClient();
  const testCollectionName = 'test-collection';
  
  try {
    // Create collection
    await client.getOrCreateCollection({
      name: testCollectionName,
      metadata: { purpose: 'testing' }
    });
    console.log('✅ Collection creation successful');

    // Add test document
    await client.addDocuments({
      collectionName: testCollectionName,
      documents: ['test document for semantic search'],
      metadatas: [{ type: 'test', created: new Date().toISOString() }],
      ids: ['test-doc-1']
    });
    console.log('✅ Document addition successful');

    // Test search
    const results = await client.semanticSearch({
      collectionName: testCollectionName,
      queryTexts: ['test semantic search'],
      nResults: 1
    });
    console.log('✅ Semantic search successful');
    console.log('📊 Search results:', results.length);

    // Cleanup
    await client.deleteDocuments({
      collectionName: testCollectionName,
      ids: ['test-doc-1']
    });
    console.log('✅ Cleanup successful');

    return true;
  } catch (error) {
    console.error('❌ Collection operations failed:', error.message);
    return false;
  }
}

async function runTests() {
  console.log('🧪 Starting Dependency Indexer Tests\n');

  const tests = [
    { name: 'ChromaDB Connection', fn: testChromaDBConnection },
    { name: 'Collection Operations', fn: testCollectionOperations },
    { name: 'Local Lambda Invocation', fn: testLocalInvocation }
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    console.log(`\n--- ${test.name} ---`);
    try {
      const success = await test.fn();
      if (success) {
        passed++;
      } else {
        failed++;
      }
    } catch (error) {
      console.error(`❌ ${test.name} threw an error:`, error.message);
      failed++;
    }
  }

  console.log(`\n📊 Test Summary:`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Success Rate: ${(passed / (passed + failed) * 100).toFixed(1)}%`);

  process.exit(failed > 0 ? 1 : 0);
}

if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = {
  testChromaDBConnection,
  testCollectionOperations,
  testLocalInvocation
};
```

### Paso 3.3: Comandos de Testing

```bash
# Hacer ejecutable el script de testing
chmod +x scripts/test-dependency-indexer.js

# Instalar dependencias de la capa
cd layers/chromadb-layer/nodejs && npm install && cd ../../../

# Construir el proyecto
sam build

# Ejecutar tests
node scripts/test-dependency-indexer.js

# Probar función específica localmente
sam local invoke DependencyIndexerFunction \
  --event events/dependency-indexer-event.json \
  --env-vars env.json
```

## Comandos de Despliegue

```bash
# Validar template
sam validate

# Construir
sam build

# Desplegar con parámetros ChromaDB
sam deploy \
  --stack-name pr-revisor-dependency-index-internal \
  --parameter-overrides \
    envName=internal \
    ChromaDBHost=localhost \
    ChromaDBPort=8000 \
    ChromaDBSSL=false \
    ChromaDBAuthToken=test-token-dev \
  --capabilities CAPABILITY_IAM

# Verificar despliegue
aws lambda list-functions --query 'Functions[?contains(FunctionName, `dependency-indexer`)].FunctionName'
```

## Próximos Pasos

1. **Implementar Dependency Analyzer** (Fase 4)
2. **Crear Dashboard de Monitoreo** (Fase 5)
3. **Integrar con PR Processor existente** (Fase 6)
4. **Optimizar Performance** (Fase 7)

Esta implementación proporciona una base sólida para el sistema de indexación de dependencias con ChromaDB. Los siguientes archivos de documentación cubrirán las fases restantes y estrategias específicas por lenguaje.