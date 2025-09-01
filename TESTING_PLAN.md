# Plan de Testing Comprehensivo - Sistema de Índice de Dependencias

## Descripción General

Este documento define la estrategia completa de testing para el Sistema de Índice de Dependencias, con énfasis especial en la validación de la integración con ChromaDB. El plan incluye tests unitarios, de integración, de rendimiento y de extremo a extremo (E2E).

## Estructura de Testing

### Pirámide de Testing

```
                 E2E Tests
                    /\
                   /  \
              Integration Tests
                 /\      /\
                /  \    /  \
           Unit Tests    ChromaDB Tests
          /\      /\        /\      /\
         /  \    /  \      /  \    /  \
    Components  Utils  Collections Queries
```

### Tipos de Testing por Componente

#### 1. **Unit Tests (70%)**
- Parsers de dependencias por lenguaje
- Utilidades de processing
- Generadores de embeddings
- Validadores de entrada

#### 2. **ChromaDB Integration Tests (20%)**
- Operaciones CRUD en colecciones
- Búsquedas semánticas
- Performance de queries
- Consistencia de datos

#### 3. **Integration Tests (8%)**
- Pipeline completo de indexación
- Lambda functions end-to-end
- AWS services integration

#### 4. **E2E Tests (2%)**
- Flujos completos de usuario
- Performance en repositorios reales
- Stress testing

## Configuración del Entorno de Testing

### Estructura de Archivos de Testing

```
tests/
├── unit/
│   ├── parsers/
│   │   ├── javascriptParser.test.js
│   │   ├── pythonParser.test.js
│   │   ├── javaParser.test.js
│   │   └── goParser.test.js
│   ├── core/
│   │   ├── indexer.test.js
│   │   ├── embeddings.test.js
│   │   └── fragmentExtractor.test.js
│   └── utils/
│       ├── validator.test.js
│       └── logger.test.js
├── integration/
│   ├── chromadb/
│   │   ├── collections.test.js
│   │   ├── queries.test.js
│   │   └── performance.test.js
│   ├── lambdas/
│   │   ├── indexer.integration.test.js
│   │   ├── analyzer.integration.test.js
│   │   └── updater.integration.test.js
│   └── aws/
│       ├── sqs.test.js
│       └── dynamodb.test.js
├── e2e/
│   ├── full-pipeline.test.js
│   ├── repository-analysis.test.js
│   └── pr-analysis.test.js
├── fixtures/
│   ├── sample-repos/
│   │   ├── javascript-basic/
│   │   ├── python-complex/
│   │   └── java-monorepo/
│   ├── chromadb/
│   │   └── seed-data.js
│   └── events/
│       ├── indexing-events.json
│       └── analysis-events.json
├── helpers/
│   ├── chromadb-helper.js
│   ├── mock-github.js
│   └── test-utils.js
└── config/
    ├── jest.config.js
    ├── jest.integration.config.js
    └── test-environment.js
```

## Configuración de Jest

### jest.config.js (Unit Tests)
```javascript
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/unit/**/*.test.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',
    '!src/common/chromadb/client.js' // Tested separately
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 85,
      lines: 85,
      statements: 85
    }
  },
  setupFilesAfterEnv: ['<rootDir>/tests/helpers/test-setup.js'],
  testTimeout: 30000,
  verbose: true,
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  modulePathIgnorePatterns: ['<rootDir>/dist/', '<rootDir>/build/'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/build/']
};
```

### jest.integration.config.js (Integration Tests)
```javascript
module.exports = {
  ...require('./jest.config.js'),
  testMatch: ['**/tests/integration/**/*.test.js'],
  testTimeout: 120000, // 2 minutes for integration tests
  setupFilesAfterEnv: [
    '<rootDir>/tests/helpers/test-setup.js',
    '<rootDir>/tests/helpers/chromadb-setup.js'
  ],
  globalSetup: '<rootDir>/tests/config/global-setup.js',
  globalTeardown: '<rootDir>/tests/config/global-teardown.js',
  maxConcurrency: 1, // Run integration tests sequentially
  collectCoverage: false // Don't collect coverage for integration tests
};
```

## ChromaDB Testing Infrastructure

### ChromaDB Test Helper

```javascript
// tests/helpers/chromadb-helper.js
const ChromaDBClient = require('../../src/common/chromadb/chromaClient');
const { execSync } = require('child_process');

class ChromaDBTestHelper {
  constructor() {
    this.client = null;
    this.testCollections = new Set();
    this.isDockerized = process.env.TEST_CHROMADB_DOCKER === 'true';
  }

  async setup() {
    if (this.isDockerized) {
      await this.startDockerChromaDB();
    }

    this.client = new ChromaDBClient({
      host: process.env.TEST_CHROMADB_HOST || 'localhost',
      port: process.env.TEST_CHROMADB_PORT || 8000,
      auth: { token: 'test-token' }
    });

    await this.waitForChromaDB();
  }

  async startDockerChromaDB() {
    console.log('Starting ChromaDB container for testing...');
    
    try {
      // Stop any existing test container
      execSync('docker stop test-chromadb 2>/dev/null || true');
      execSync('docker rm test-chromadb 2>/dev/null || true');
      
      // Start new container
      execSync(`
        docker run -d \\
          --name test-chromadb \\
          -p 8001:8000 \\
          -e CHROMA_SERVER_AUTH_PROVIDER=chromadb.auth.token.TokenAuthServerProvider \\
          -e CHROMA_SERVER_AUTH_CREDENTIALS=test-token \\
          ghcr.io/chroma-core/chroma:latest
      `);
      
      console.log('ChromaDB container started');
    } catch (error) {
      throw new Error(`Failed to start ChromaDB container: ${error.message}`);
    }
  }

  async waitForChromaDB(maxRetries = 30, delay = 1000) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        await this.client.listCollections();
        console.log('ChromaDB is ready for testing');
        return;
      } catch (error) {
        if (i === maxRetries - 1) {
          throw new Error(`ChromaDB not ready after ${maxRetries} attempts`);
        }
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  async createTestCollection(name, metadata = {}) {
    const collectionName = `test-${name}-${Date.now()}`;
    
    await this.client.getOrCreateCollection({
      name: collectionName,
      metadata: {
        ...metadata,
        isTest: true,
        createdAt: new Date().toISOString()
      }
    });
    
    this.testCollections.add(collectionName);
    return collectionName;
  }

  async seedTestData(collectionName, testData) {
    const documents = testData.map(item => item.document);
    const metadatas = testData.map(item => item.metadata);
    const ids = testData.map((item, index) => item.id || `test-doc-${index}`);

    await this.client.addDocuments({
      collectionName,
      documents,
      metadatas,
      ids
    });

    return { collectionName, count: documents.length };
  }

  async cleanup() {
    // Delete all test collections
    for (const collectionName of this.testCollections) {
      try {
        await this.client.deleteDocuments({
          collectionName,
          where: { isTest: { "$eq": true } }
        });
      } catch (error) {
        console.warn(`Failed to cleanup collection ${collectionName}:`, error.message);
      }
    }
    
    this.testCollections.clear();

    if (this.isDockerized) {
      try {
        execSync('docker stop test-chromadb');
        execSync('docker rm test-chromadb');
        console.log('ChromaDB container stopped and removed');
      } catch (error) {
        console.warn('Failed to cleanup ChromaDB container:', error.message);
      }
    }
  }

  async assertCollectionExists(collectionName) {
    const collections = await this.client.listCollections();
    const exists = collections.some(c => c.name === collectionName);
    
    if (!exists) {
      throw new Error(`Expected collection '${collectionName}' to exist`);
    }
  }

  async assertDocumentCount(collectionName, expectedCount) {
    const info = await this.client.getCollectionInfo(collectionName);
    
    if (info.count !== expectedCount) {
      throw new Error(
        `Expected ${expectedCount} documents in '${collectionName}', found ${info.count}`
      );
    }
  }

  async assertSearchResults(collectionName, query, expectedResults) {
    const results = await this.client.semanticSearch({
      collectionName,
      queryTexts: [query],
      nResults: expectedResults.length
    });

    if (results.length !== expectedResults.length) {
      throw new Error(
        `Expected ${expectedResults.length} search results, got ${results.length}`
      );
    }

    // Validate result structure
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const expected = expectedResults[i];
      
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('document');
      expect(result).toHaveProperty('metadata');
      expect(result).toHaveProperty('similarity');
      
      if (expected.minSimilarity) {
        expect(result.similarity).toBeGreaterThanOrEqual(expected.minSimilarity);
      }
    }
  }
}

module.exports = ChromaDBTestHelper;
```

## Unit Tests Específicos

### Test de Parser JavaScript

```javascript
// tests/unit/parsers/javascriptParser.test.js
const JavaScriptDependencyParser = require('../../../src/dependency-indexer/parsers/javascriptParser');
const fs = require('fs').promises;
const path = require('path');

describe('JavaScriptDependencyParser', () => {
  let parser;
  let tempDir;

  beforeEach(async () => {
    parser = new JavaScriptDependencyParser();
    tempDir = await fs.mkdtemp(path.join(__dirname, '../../fixtures/temp-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('parseProject', () => {
    test('should parse basic package.json correctly', async () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          'express': '^4.18.0',
          'lodash': '~4.17.21'
        },
        devDependencies: {
          'jest': '^29.0.0',
          'nodemon': '^2.0.20'
        }
      };

      await fs.writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      const result = await parser.parseProject(tempDir);

      expect(result.dependencies).toHaveLength(2);
      expect(result.devDependencies).toHaveLength(2);
      
      const express = result.dependencies.find(d => d.name === 'express');
      expect(express).toMatchObject({
        name: 'express',
        version: '^4.18.0',
        type: 'dependency',
        category: 'web-framework',
        isDirect: true
      });
    });

    test('should detect monorepo structure', async () => {
      const rootPackageJson = {
        name: 'monorepo-root',
        private: true,
        workspaces: ['packages/*']
      };

      await fs.writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify(rootPackageJson, null, 2)
      );

      await fs.mkdir(path.join(tempDir, 'packages', 'app-a'), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, 'packages', 'app-a', 'package.json'),
        JSON.stringify({ name: 'app-a', dependencies: { react: '^18.0.0' } }, null, 2)
      );

      const result = await parser.parseProject(tempDir);

      expect(result).toHaveProperty('subProjects');
      expect(result.subProjects).toHaveLength(1);
      expect(result.subProjects[0].name).toBe('app-a');
    });

    test('should analyze code imports correctly', async () => {
      const packageJson = {
        dependencies: { 'express': '^4.18.0', 'lodash': '^4.17.21' }
      };

      const appJs = `
        const express = require('express');
        import { debounce } from 'lodash';
        const unused = require('unused-package');
        
        const app = express();
      `;

      await fs.writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );
      await fs.writeFile(path.join(tempDir, 'app.js'), appJs);

      const result = await parser.parseProject(tempDir);

      expect(result.codeAnalysis).toBeDefined();
      expect(result.codeAnalysis.requireCalls).toContain('express');
      expect(result.codeAnalysis.staticImports).toContain('lodash');
      expect(result.codeAnalysis.missingDependencies).toContain('unused-package');
    });
  });

  describe('categorizeJSDependency', () => {
    test.each([
      ['express', 'framework'],
      ['jest', 'testing'],
      ['webpack', 'bundling'],
      ['axios', 'http'],
      ['unknown-package', 'library']
    ])('should categorize %s as %s', (packageName, expectedCategory) => {
      expect(parser.categorizeJSDependency(packageName)).toBe(expectedCategory);
    });
  });

  describe('generateEmbeddingDocument', () => {
    test('should create proper embedding document', () => {
      const dependency = {
        name: 'express',
        description: 'Fast, unopinionated, minimalist web framework',
        keywords: ['web', 'framework', 'server'],
        category: 'web-framework'
      };

      const codeContext = {
        usage: 'HTTP server creation middleware routing'
      };

      const document = parser.generateEmbeddingDocument(dependency, codeContext);
      
      expect(document).toContain('express');
      expect(document).toContain('web framework');
      expect(document).toContain('server creation');
      expect(document.length).toBeGreaterThan(10);
    });
  });

  describe('metadata generation', () => {
    test('should generate complete metadata', () => {
      const dependency = {
        name: 'express',
        version: '4.18.0',
        type: 'dependency',
        license: 'MIT',
        vulnerabilities: []
      };

      const repoInfo = { repositoryId: 'test-repo' };
      
      const metadata = parser.generateMetadata(dependency, repoInfo);
      
      expect(metadata).toMatchObject({
        id: 'js-express-4.18.0',
        name: 'express',
        version: '4.18.0',
        language: 'javascript',
        ecosystem: 'npm',
        repository: 'test-repo',
        hasVulnerabilities: false
      });
    });
  });
});
```

### Test de ChromaDB Operations

```javascript
// tests/integration/chromadb/collections.test.js
const ChromaDBTestHelper = require('../../helpers/chromadb-helper');

describe('ChromaDB Collections Integration', () => {
  let helper;

  beforeAll(async () => {
    helper = new ChromaDBTestHelper();
    await helper.setup();
  });

  afterAll(async () => {
    await helper.cleanup();
  });

  describe('Collection Management', () => {
    test('should create and retrieve collections', async () => {
      const collectionName = await helper.createTestCollection('dependencies');
      
      await helper.assertCollectionExists(collectionName);
    });

    test('should add and query documents', async () => {
      const collectionName = await helper.createTestCollection('dependencies');
      
      const testData = [
        {
          id: 'express-4.18.0',
          document: 'express web framework for node.js',
          metadata: {
            name: 'express',
            version: '4.18.0',
            category: 'web-framework',
            language: 'javascript'
          }
        },
        {
          id: 'lodash-4.17.21',
          document: 'lodash utility library for javascript',
          metadata: {
            name: 'lodash',
            version: '4.17.21',
            category: 'utility',
            language: 'javascript'
          }
        }
      ];

      await helper.seedTestData(collectionName, testData);
      await helper.assertDocumentCount(collectionName, 2);

      // Test semantic search
      await helper.assertSearchResults(
        collectionName,
        'javascript web server framework',
        [
          { minSimilarity: 0.7 }, // express should be most similar
          { minSimilarity: 0.3 }  // lodash should be less similar
        ]
      );
    });

    test('should filter by metadata', async () => {
      const collectionName = await helper.createTestCollection('dependencies');
      
      const testData = [
        {
          document: 'react frontend library',
          metadata: { category: 'framework', language: 'javascript' }
        },
        {
          document: 'django web framework',
          metadata: { category: 'framework', language: 'python' }
        },
        {
          document: 'pytest testing framework',
          metadata: { category: 'testing', language: 'python' }
        }
      ];

      await helper.seedTestData(collectionName, testData);

      const results = await helper.client.semanticSearch({
        collectionName,
        queryTexts: ['framework'],
        nResults: 10,
        where: { language: { "$eq": "python" } }
      });

      expect(results).toHaveLength(2); // django and pytest
      expect(results.every(r => r.metadata.language === 'python')).toBe(true);
    });
  });

  describe('Performance Tests', () => {
    test('should handle batch operations efficiently', async () => {
      const collectionName = await helper.createTestCollection('performance');
      
      // Generate large dataset
      const batchSize = 1000;
      const testData = Array.from({ length: batchSize }, (_, i) => ({
        id: `package-${i}`,
        document: `package ${i} description with various keywords`,
        metadata: {
          name: `package-${i}`,
          version: '1.0.0',
          category: i % 2 === 0 ? 'library' : 'framework',
          index: i
        }
      }));

      const startTime = Date.now();
      await helper.seedTestData(collectionName, testData);
      const insertTime = Date.now() - startTime;

      expect(insertTime).toBeLessThan(10000); // Should complete in <10s
      await helper.assertDocumentCount(collectionName, batchSize);

      // Test query performance
      const queryStart = Date.now();
      const results = await helper.client.semanticSearch({
        collectionName,
        queryTexts: ['framework library'],
        nResults: 10
      });
      const queryTime = Date.now() - queryStart;

      expect(queryTime).toBeLessThan(1000); // Queries should be <1s
      expect(results).toHaveLength(10);
    });

    test('should maintain performance with complex filters', async () => {
      const collectionName = await helper.createTestCollection('complex-filters');
      
      // Create data with various metadata combinations
      const testData = Array.from({ length: 500 }, (_, i) => ({
        document: `package ${i} for testing complex filtering`,
        metadata: {
          category: ['framework', 'library', 'testing', 'utility'][i % 4],
          language: ['javascript', 'python', 'java'][i % 3],
          hasVulnerabilities: i % 10 === 0,
          downloadCount: Math.floor(Math.random() * 1000000),
          isDeprecated: i % 50 === 0
        }
      }));

      await helper.seedTestData(collectionName, testData);

      // Complex query with multiple filters
      const queryStart = Date.now();
      const results = await helper.client.semanticSearch({
        collectionName,
        queryTexts: ['testing framework'],
        nResults: 20,
        where: {
          "$and": [
            { "language": { "$eq": "javascript" } },
            { "hasVulnerabilities": { "$eq": false } },
            { "downloadCount": { "$gt": 100000 } }
          ]
        }
      });
      const queryTime = Date.now() - queryStart;

      expect(queryTime).toBeLessThan(2000); // Complex queries should be <2s
      expect(results.length).toBeGreaterThan(0);
      
      // Verify filter conditions
      results.forEach(result => {
        expect(result.metadata.language).toBe('javascript');
        expect(result.metadata.hasVulnerabilities).toBe(false);
        expect(result.metadata.downloadCount).toBeGreaterThan(100000);
      });
    });
  });
});
```

### Test de Indexer Lambda Integration

```javascript
// tests/integration/lambdas/indexer.integration.test.js
const { lambdaHandler } = require('../../../src/dependency-indexer/app');
const ChromaDBTestHelper = require('../../helpers/chromadb-helper');
const fs = require('fs').promises;
const path = require('path');

describe('Dependency Indexer Lambda Integration', () => {
  let helper;
  let testRepo;

  beforeAll(async () => {
    helper = new ChromaDBTestHelper();
    await helper.setup();
    
    // Setup test repository
    testRepo = await createTestRepository();
  });

  afterAll(async () => {
    await helper.cleanup();
    await cleanupTestRepository(testRepo);
  });

  describe('Full Indexing Pipeline', () => {
    test('should index JavaScript repository successfully', async () => {
      const event = {
        repositoryUrl: testRepo.url,
        repositoryId: 'test-repo-js',
        indexType: 'full',
        options: {
          includeDevDependencies: true,
          includeCodeFragments: true
        }
      };

      const context = {
        awsRequestId: 'test-request-123',
        functionName: 'test-indexer',
        functionVersion: '1'
      };

      // Override ChromaDB config for testing
      process.env.CHROMADB_HOST = 'localhost';
      process.env.CHROMADB_PORT = '8001';
      process.env.CHROMADB_AUTH_TOKEN = 'test-token';

      const result = await lambdaHandler(event, context);
      
      expect(result.statusCode).toBe(200);
      
      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);
      expect(body.result).toMatchObject({
        repositoryId: 'test-repo-js',
        dependenciesIndexed: expect.any(Number),
        codeFragmentsIndexed: expect.any(Number),
        collectionsCreated: expect.arrayContaining([
          'dependencies-test-repo-js',
          'code-fragments-test-repo-js'
        ])
      });

      // Verify collections were created and populated
      await helper.assertCollectionExists('dependencies-test-repo-js');
      await helper.assertCollectionExists('code-fragments-test-repo-js');
      
      const depInfo = await helper.client.getCollectionInfo('dependencies-test-repo-js');
      expect(depInfo.count).toBeGreaterThan(0);
    });

    test('should handle repository parsing errors gracefully', async () => {
      const event = {
        repositoryUrl: 'https://invalid-repo-url.com/non-existent/repo',
        repositoryId: 'invalid-repo',
        indexType: 'full'
      };

      const context = {
        awsRequestId: 'test-request-error',
        functionName: 'test-indexer',
        functionVersion: '1'
      };

      const result = await lambdaHandler(event, context);
      
      expect(result.statusCode).toBe(500);
      
      const body = JSON.parse(result.body);
      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
      expect(body.error.message).toContain('Failed to clone repository');
    });

    test('should support incremental indexing', async () => {
      const repositoryId = 'test-repo-incremental';
      
      // First, do a full index
      const fullIndexEvent = {
        repositoryUrl: testRepo.url,
        repositoryId,
        indexType: 'full'
      };

      const fullResult = await lambdaHandler(fullIndexEvent, {
        awsRequestId: 'full-index',
        functionName: 'test-indexer',
        functionVersion: '1'
      });

      expect(fullResult.statusCode).toBe(200);

      // Then, do an incremental update
      const incrementalEvent = {
        repositoryUrl: testRepo.url,
        repositoryId,
        indexType: 'incremental',
        options: {
          lastIndexed: new Date().toISOString()
        }
      };

      const incrementalResult = await lambdaHandler(incrementalEvent, {
        awsRequestId: 'incremental-index',
        functionName: 'test-indexer',
        functionVersion: '1'
      });

      expect(incrementalResult.statusCode).toBe(200);
      
      const body = JSON.parse(incrementalResult.body);
      expect(body.result.indexType).toBe('incremental');
    });
  });
});

async function createTestRepository() {
  const tempDir = await fs.mkdtemp('/tmp/test-repo-');
  
  // Create a sample JavaScript project
  const packageJson = {
    name: 'test-project',
    version: '1.0.0',
    dependencies: {
      'express': '^4.18.0',
      'lodash': '^4.17.21'
    },
    devDependencies: {
      'jest': '^29.0.0'
    }
  };

  const appJs = `
    const express = require('express');
    const { debounce } = require('lodash');
    
    const app = express();
    
    app.get('/', (req, res) => {
      res.json({ message: 'Hello World' });
    });
    
    module.exports = app;
  `;

  await fs.writeFile(
    path.join(tempDir, 'package.json'),
    JSON.stringify(packageJson, null, 2)
  );
  await fs.writeFile(path.join(tempDir, 'app.js'), appJs);

  // Initialize git repository
  const { execSync } = require('child_process');
  execSync(`cd ${tempDir} && git init && git add . && git commit -m "Initial commit"`);

  return {
    path: tempDir,
    url: `file://${tempDir}`
  };
}

async function cleanupTestRepository(testRepo) {
  if (testRepo && testRepo.path) {
    await fs.rm(testRepo.path, { recursive: true, force: true });
  }
}
```

## E2E Testing Strategy

### Full Pipeline E2E Test

```javascript
// tests/e2e/full-pipeline.test.js
const ChromaDBTestHelper = require('../helpers/chromadb-helper');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { DynamoDBClient, GetItemCommand } = require('@aws-sdk/client-dynamodb');

describe('Full Pipeline E2E Tests', () => {
  let helper;
  let sqsClient;
  let dynamoClient;

  beforeAll(async () => {
    helper = new ChromaDBTestHelper();
    await helper.setup();

    sqsClient = new SQSClient({ region: 'us-east-1' });
    dynamoClient = new DynamoDBClient({ region: 'us-east-1' });
  });

  afterAll(async () => {
    await helper.cleanup();
  });

  describe('Repository Analysis Flow', () => {
    test('should complete full analysis flow for real repository', async () => {
      const repositoryUrl = 'https://github.com/expressjs/express.git';
      const repositoryId = 'express-test';
      const jobId = `job-${Date.now()}`;

      // 1. Trigger indexing job
      await sqsClient.send(new SendMessageCommand({
        QueueUrl: process.env.DEPENDENCY_INDEX_QUEUE_URL,
        MessageBody: JSON.stringify({
          requestId: jobId,
          payload: {
            repositoryUrl,
            repositoryId,
            indexType: 'full'
          }
        })
      }));

      // 2. Wait for indexing to complete
      await waitForJobCompletion(jobId, 'indexing', 300000); // 5 minutes

      // 3. Verify collections were created
      await helper.assertCollectionExists(`dependencies-${repositoryId}`);
      await helper.assertCollectionExists(`code-fragments-${repositoryId}`);

      // 4. Test semantic search capabilities
      const searchResults = await helper.client.semanticSearch({
        collectionName: `dependencies-${repositoryId}`,
        queryTexts: ['web framework http server'],
        nResults: 5
      });

      expect(searchResults.length).toBeGreaterThan(0);
      expect(searchResults[0].similarity).toBeGreaterThan(0.7);

      // 5. Simulate PR analysis
      const prAnalysisJob = `pr-${Date.now()}`;
      await sqsClient.send(new SendMessageCommand({
        QueueUrl: process.env.PR_PROCESS_QUEUE_URL,
        MessageBody: JSON.stringify({
          requestId: prAnalysisJob,
          payload: {
            repositoryId,
            prNumber: 1234,
            changedFiles: ['package.json', 'src/app.js'],
            analysis: {
              dependencies: true,
              codeFragments: true
            }
          }
        })
      }));

      // 6. Wait for PR analysis to complete
      await waitForJobCompletion(prAnalysisJob, 'pr-analysis', 120000); // 2 minutes

      // 7. Verify analysis results
      const analysisResults = await getJobResults(prAnalysisJob);
      expect(analysisResults).toBeDefined();
      expect(analysisResults.dependencyAnalysis).toBeDefined();
      expect(analysisResults.impactAnalysis).toBeDefined();

    }, 600000); // 10 minutes timeout for full E2E test
  });

  async function waitForJobCompletion(jobId, jobType, timeout) {
    const startTime = Date.now();
    const pollInterval = 5000; // 5 seconds

    while (Date.now() - startTime < timeout) {
      try {
        const job = await dynamoClient.send(new GetItemCommand({
          TableName: process.env.REVIEW_JOBS_TABLE,
          Key: {
            jobId: { S: jobId }
          }
        }));

        if (job.Item && job.Item.status.S === 'completed') {
          return job.Item;
        }

        if (job.Item && job.Item.status.S === 'failed') {
          throw new Error(`Job ${jobId} failed: ${job.Item.error?.S || 'Unknown error'}`);
        }

      } catch (error) {
        console.warn(`Error polling job ${jobId}:`, error.message);
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Job ${jobId} did not complete within ${timeout}ms`);
  }

  async function getJobResults(jobId) {
    const job = await dynamoClient.send(new GetItemCommand({
      TableName: process.env.REVIEW_JOBS_TABLE,
      Key: { jobId: { S: jobId } }
    }));

    return job.Item ? JSON.parse(job.Item.results?.S || '{}') : null;
  }
});
```

## Performance Testing

### Load Testing Script

```javascript
// tests/performance/load-test.js
const ChromaDBTestHelper = require('../helpers/chromadb-helper');

class PerformanceTestSuite {
  constructor() {
    this.helper = new ChromaDBTestHelper();
    this.results = {
      insertion: [],
      queries: [],
      memory: [],
      concurrent: []
    };
  }

  async runAll() {
    await this.helper.setup();

    console.log('🚀 Starting Performance Test Suite');

    await this.testBulkInsertion();
    await this.testQueryPerformance();
    await this.testConcurrentOperations();
    await this.testMemoryUsage();

    await this.helper.cleanup();
    
    this.generateReport();
  }

  async testBulkInsertion() {
    console.log('📊 Testing bulk insertion performance...');
    
    const batchSizes = [100, 500, 1000, 5000];
    
    for (const batchSize of batchSizes) {
      const collectionName = await this.helper.createTestCollection(`bulk-${batchSize}`);
      
      const testData = Array.from({ length: batchSize }, (_, i) => ({
        id: `dep-${i}`,
        document: `dependency ${i} with description and keywords for testing bulk operations`,
        metadata: {
          name: `package-${i}`,
          version: '1.0.0',
          category: ['library', 'framework', 'testing'][i % 3],
          downloadCount: Math.floor(Math.random() * 1000000)
        }
      }));

      const startTime = performance.now();
      await this.helper.seedTestData(collectionName, testData);
      const endTime = performance.now();

      const duration = endTime - startTime;
      const throughput = batchSize / (duration / 1000); // items per second

      this.results.insertion.push({
        batchSize,
        duration,
        throughput
      });

      console.log(`  ${batchSize} items: ${duration.toFixed(2)}ms (${throughput.toFixed(2)} items/sec)`);
    }
  }

  async testQueryPerformance() {
    console.log('🔍 Testing query performance...');
    
    const collectionName = await this.helper.createTestCollection('query-perf');
    
    // Create large dataset
    const dataSize = 10000;
    const testData = Array.from({ length: dataSize }, (_, i) => ({
      document: `package ${i} for ${['web', 'testing', 'database', 'utility'][i % 4]} development with advanced features`,
      metadata: {
        category: ['web-framework', 'testing', 'database', 'utility'][i % 4],
        language: ['javascript', 'python', 'java'][i % 3],
        popularity: Math.floor(Math.random() * 1000)
      }
    }));

    await this.helper.seedTestData(collectionName, testData);

    const queries = [
      'web framework for javascript development',
      'testing utilities and libraries',
      'database connection and orm',
      'utility functions and helpers'
    ];

    for (const query of queries) {
      const iterations = 100;
      const durations = [];

      for (let i = 0; i < iterations; i++) {
        const startTime = performance.now();
        
        await this.helper.client.semanticSearch({
          collectionName,
          queryTexts: [query],
          nResults: 10
        });
        
        const endTime = performance.now();
        durations.push(endTime - startTime);
      }

      const avgDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;
      const p95Duration = durations.sort((a, b) => a - b)[Math.floor(durations.length * 0.95)];

      this.results.queries.push({
        query,
        avgDuration,
        p95Duration,
        iterations
      });

      console.log(`  "${query}": avg ${avgDuration.toFixed(2)}ms, p95 ${p95Duration.toFixed(2)}ms`);
    }
  }

  async testConcurrentOperations() {
    console.log('⚡ Testing concurrent operations...');
    
    const collectionName = await this.helper.createTestCollection('concurrent');
    
    // Seed initial data
    const initialData = Array.from({ length: 1000 }, (_, i) => ({
      document: `initial package ${i}`,
      metadata: { index: i, type: 'initial' }
    }));
    
    await this.helper.seedTestData(collectionName, initialData);

    const concurrencyLevels = [5, 10, 20];
    
    for (const concurrency of concurrencyLevels) {
      const startTime = performance.now();
      
      const promises = Array.from({ length: concurrency }, async (_, i) => {
        // Mix of operations
        const operations = [
          // Query operations
          () => this.helper.client.semanticSearch({
            collectionName,
            queryTexts: [`concurrent query ${i}`],
            nResults: 5
          }),
          
          // Insert operations
          () => this.helper.client.addDocuments({
            collectionName,
            documents: [`concurrent document ${i}`],
            metadatas: [{ concurrent: true, threadId: i }],
            ids: [`concurrent-${i}-${Date.now()}`]
          })
        ];

        // Execute multiple operations per thread
        for (let j = 0; j < 10; j++) {
          const operation = operations[j % operations.length];
          await operation();
        }
      });

      await Promise.all(promises);
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      this.results.concurrent.push({
        concurrency,
        duration,
        operationsPerSecond: (concurrency * 10) / (duration / 1000)
      });

      console.log(`  ${concurrency} threads: ${duration.toFixed(2)}ms (${((concurrency * 10) / (duration / 1000)).toFixed(2)} ops/sec)`);
    }
  }

  async testMemoryUsage() {
    console.log('💾 Testing memory usage patterns...');
    
    const getMemoryUsage = () => {
      const usage = process.memoryUsage();
      return {
        rss: usage.rss / 1024 / 1024, // MB
        heapUsed: usage.heapUsed / 1024 / 1024, // MB
        heapTotal: usage.heapTotal / 1024 / 1024, // MB
        external: usage.external / 1024 / 1024 // MB
      };
    };

    const baselineMemory = getMemoryUsage();
    
    // Test memory growth with increasing data
    const dataSizes = [1000, 5000, 10000, 20000];
    
    for (const size of dataSizes) {
      const collectionName = await this.helper.createTestCollection(`memory-${size}`);
      
      const beforeMemory = getMemoryUsage();
      
      const testData = Array.from({ length: size }, (_, i) => ({
        document: `memory test document ${i} with longer content to simulate realistic data sizes and measure memory impact`,
        metadata: {
          index: i,
          category: `category-${i % 10}`,
          tags: [`tag-${i % 5}`, `tag-${i % 7}`],
          data: {
            nested: {
              value: `nested-value-${i}`,
              array: Array.from({ length: 10 }, (_, j) => `item-${j}`)
            }
          }
        }
      }));

      await this.helper.seedTestData(collectionName, testData);
      
      const afterMemory = getMemoryUsage();
      
      this.results.memory.push({
        dataSize: size,
        memoryBefore: beforeMemory,
        memoryAfter: afterMemory,
        memoryGrowth: {
          rss: afterMemory.rss - beforeMemory.rss,
          heapUsed: afterMemory.heapUsed - beforeMemory.heapUsed
        }
      });

      console.log(`  ${size} docs: +${(afterMemory.heapUsed - beforeMemory.heapUsed).toFixed(2)}MB heap`);
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
    }
  }

  generateReport() {
    console.log('\n📋 Performance Test Report');
    console.log('=' .repeat(50));
    
    console.log('\n💾 Bulk Insertion Results:');
    this.results.insertion.forEach(result => {
      console.log(`  ${result.batchSize} items: ${result.throughput.toFixed(2)} items/sec`);
    });
    
    console.log('\n🔍 Query Performance Results:');
    this.results.queries.forEach(result => {
      console.log(`  Average: ${result.avgDuration.toFixed(2)}ms, P95: ${result.p95Duration.toFixed(2)}ms`);
    });
    
    console.log('\n⚡ Concurrent Operations Results:');
    this.results.concurrent.forEach(result => {
      console.log(`  ${result.concurrency} threads: ${result.operationsPerSecond.toFixed(2)} ops/sec`);
    });
    
    console.log('\n💾 Memory Usage Results:');
    this.results.memory.forEach(result => {
      console.log(`  ${result.dataSize} docs: +${result.memoryGrowth.heapUsed.toFixed(2)}MB`);
    });

    // Performance thresholds
    console.log('\n✅ Performance Validation:');
    
    const maxInsertThroughput = Math.max(...this.results.insertion.map(r => r.throughput));
    console.log(`  Insertion throughput: ${maxInsertThroughput.toFixed(2)} items/sec ${maxInsertThroughput > 100 ? '✅' : '❌'}`);
    
    const avgQueryTime = this.results.queries.reduce((sum, r) => sum + r.avgDuration, 0) / this.results.queries.length;
    console.log(`  Average query time: ${avgQueryTime.toFixed(2)}ms ${avgQueryTime < 500 ? '✅' : '❌'}`);
    
    const maxConcurrentOps = Math.max(...this.results.concurrent.map(r => r.operationsPerSecond));
    console.log(`  Concurrent operations: ${maxConcurrentOps.toFixed(2)} ops/sec ${maxConcurrentOps > 50 ? '✅' : '❌'}`);
  }
}

// Run performance tests
if (require.main === module) {
  const suite = new PerformanceTestSuite();
  suite.runAll().catch(console.error);
}

module.exports = PerformanceTestSuite;
```

## Comandos de Testing

### package.json Scripts

```json
{
  "scripts": {
    "test": "jest --config tests/config/jest.config.js",
    "test:unit": "jest --config tests/config/jest.config.js tests/unit",
    "test:integration": "jest --config tests/config/jest.integration.config.js",
    "test:e2e": "jest --config tests/config/jest.e2e.config.js",
    "test:performance": "node tests/performance/load-test.js",
    "test:watch": "jest --watch --config tests/config/jest.config.js",
    "test:coverage": "jest --coverage --config tests/config/jest.config.js",
    "test:chromadb": "jest tests/integration/chromadb --config tests/config/jest.integration.config.js",
    "test:setup": "node tests/helpers/test-setup.js",
    "test:teardown": "node tests/helpers/test-teardown.js"
  }
}
```

### Testing Automation

```bash
#!/bin/bash
# scripts/run-all-tests.sh

set -e

echo "🧪 Running Complete Test Suite"
echo "================================"

# Setup
echo "📋 Setting up test environment..."
npm run test:setup

# Unit tests
echo "🔧 Running unit tests..."
npm run test:unit

# Integration tests (requires ChromaDB)
echo "🔗 Running integration tests..."
npm run test:integration

# Performance tests
echo "⚡ Running performance tests..."
npm run test:performance

# E2E tests (requires AWS resources)
if [ "$RUN_E2E" = "true" ]; then
  echo "🌐 Running E2E tests..."
  npm run test:e2e
fi

# Cleanup
echo "🧹 Cleaning up test environment..."
npm run test:teardown

echo "✅ All tests completed successfully!"
```

Este plan de testing comprehensivo asegura que el Sistema de Índice de Dependencias con ChromaDB sea robusto, performante y confiable en producción.