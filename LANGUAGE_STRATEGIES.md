# Estrategias Específicas por Lenguaje - Sistema de Índice de Dependencias

## Descripción General

Este documento detalla las estrategias específicas para el análisis y indexación de dependencias en diferentes lenguajes de programación. Cada lenguaje requiere un enfoque especializado debido a sus particularidades en la gestión de dependencias, ecosistemas de paquetes y patrones de código.

## JavaScript/TypeScript

### Ecosistema y Herramientas

**Gestores de Paquetes Soportados:**
- npm (package.json + package-lock.json)
- Yarn (package.json + yarn.lock)
- pnpm (package.json + pnpm-lock.yaml)

**Archivos de Configuración:**
- `package.json` - Dependencias declaradas
- `package-lock.json` - Árbol de dependencias resuelto
- `yarn.lock` - Lockfile de Yarn
- `pnpm-lock.yaml` - Lockfile de pnpm
- `tsconfig.json` - Configuración TypeScript
- `.nvmrc` - Versión de Node.js

### Implementación Específica

#### Parser JavaScript Avanzado

```javascript
// src/dependency-indexer/parsers/javascriptParser.js
const fs = require('fs').promises;
const path = require('path');

class JavaScriptDependencyParser {
  constructor() {
    this.vulnerabilityDB = new Map(); // Cache de vulnerabilidades conocidas
    this.npmRegistry = 'https://registry.npmjs.org';
  }

  async parseProject(repoPath) {
    const results = {
      dependencies: [],
      devDependencies: [],
      peerDependencies: [],
      optionalDependencies: [],
      bundledDependencies: [],
      workspaces: [],
      scripts: {},
      config: {}
    };

    // Detectar workspace monorepo
    const isMonorepo = await this.detectMonorepo(repoPath);
    if (isMonorepo) {
      return await this.parseMonorepo(repoPath);
    }

    // Analizar package.json principal
    const packageJson = await this.loadPackageJson(repoPath);
    if (!packageJson) return results;

    // Enriquecer con información del registry
    await this.enrichPackageInfo(packageJson, results);

    // Analizar lockfiles
    await this.analyzeLockFiles(repoPath, results);

    // Analizar imports/requires en código fuente
    await this.analyzeCodeImports(repoPath, results);

    // Detectar vulnerabilidades
    await this.scanVulnerabilities(results);

    return results;
  }

  async detectMonorepo(repoPath) {
    const indicators = [
      'lerna.json',
      'nx.json',
      'rush.json',
      'packages/',
      'apps/',
      'libs/'
    ];

    for (const indicator of indicators) {
      try {
        await fs.access(path.join(repoPath, indicator));
        return true;
      } catch {
        // Continue checking
      }
    }

    // Check if package.json has workspaces
    const packageJson = await this.loadPackageJson(repoPath);
    return packageJson && (packageJson.workspaces || packageJson.private);
  }

  async parseMonorepo(repoPath) {
    const packageJson = await this.loadPackageJson(repoPath);
    const results = { subProjects: [], rootDependencies: [] };

    // Analizar dependencias raíz
    if (packageJson) {
      results.rootDependencies = await this.parseSinglePackage(repoPath, packageJson);
    }

    // Encontrar todos los subpaquetes
    const workspacePaths = await this.findWorkspacePaths(repoPath, packageJson);
    
    for (const workspacePath of workspacePaths) {
      const subPackageJson = await this.loadPackageJson(workspacePath);
      if (subPackageJson) {
        const subResults = await this.parseSinglePackage(workspacePath, subPackageJson);
        results.subProjects.push({
          path: workspacePath,
          name: subPackageJson.name,
          dependencies: subResults
        });
      }
    }

    return results;
  }

  async findWorkspacePaths(repoPath, packageJson) {
    const paths = [];
    
    if (packageJson.workspaces) {
      const workspacePatterns = Array.isArray(packageJson.workspaces) 
        ? packageJson.workspaces 
        : packageJson.workspaces.packages || [];

      for (const pattern of workspacePatterns) {
        const glob = require('glob');
        const matchedPaths = glob.sync(pattern, { 
          cwd: repoPath,
          onlyDirectories: true 
        });
        paths.push(...matchedPaths.map(p => path.join(repoPath, p)));
      }
    }

    return paths;
  }

  async enrichPackageInfo(packageJson, results) {
    const dependencies = [
      ...Object.keys(packageJson.dependencies || {}),
      ...Object.keys(packageJson.devDependencies || {}),
      ...Object.keys(packageJson.peerDependencies || {})
    ];

    // Batch API calls to npm registry
    const batchSize = 10;
    for (let i = 0; i < dependencies.length; i += batchSize) {
      const batch = dependencies.slice(i, i + batchSize);
      await Promise.allSettled(
        batch.map(dep => this.fetchPackageMetadata(dep))
      );
    }
  }

  async fetchPackageMetadata(packageName) {
    try {
      // Implementar cache para evitar llamadas repetidas
      const cacheKey = `npm-${packageName}`;
      if (this.metadataCache.has(cacheKey)) {
        return this.metadataCache.get(cacheKey);
      }

      const response = await fetch(`${this.npmRegistry}/${packageName}`);
      if (!response.ok) return null;

      const data = await response.json();
      const metadata = {
        name: packageName,
        description: data.description,
        keywords: data.keywords || [],
        license: data.license,
        homepage: data.homepage,
        repository: data.repository,
        maintainers: data.maintainers?.length || 0,
        lastPublished: data.time?.modified,
        weeklyDownloads: null, // Requiere API adicional
        isDeprecated: !!data.deprecated
      };

      this.metadataCache.set(cacheKey, metadata);
      return metadata;
    } catch (error) {
      console.error(`Failed to fetch metadata for ${packageName}:`, error.message);
      return null;
    }
  }

  async analyzeLockFiles(repoPath, results) {
    // Analizar package-lock.json
    await this.analyzePackageLock(repoPath, results);
    
    // Analizar yarn.lock
    await this.analyzeYarnLock(repoPath, results);
    
    // Analizar pnpm-lock.yaml
    await this.analyzePnpmLock(repoPath, results);
  }

  async analyzePackageLock(repoPath, results) {
    const lockPath = path.join(repoPath, 'package-lock.json');
    
    try {
      const lockContent = await fs.readFile(lockPath, 'utf8');
      const lockData = JSON.parse(lockContent);

      // NPM v2/v3 format vs v1 format
      const dependencies = lockData.packages || lockData.dependencies;
      
      for (const [packagePath, info] of Object.entries(dependencies)) {
        const packageName = packagePath === '' ? lockData.name : this.extractPackageName(packagePath);
        
        if (packageName && packageName !== lockData.name) {
          const depInfo = {
            name: packageName,
            version: info.version,
            resolved: info.resolved,
            integrity: info.integrity,
            isDirect: !packagePath.includes('node_modules'),
            isDevOnly: info.dev === true,
            isPeerOptional: info.optional === true,
            dependencies: Object.keys(info.dependencies || {}),
            fileSize: info.size,
            licenseText: info.license
          };
          
          results.resolvedDependencies = results.resolvedDependencies || [];
          results.resolvedDependencies.push(depInfo);
        }
      }
    } catch (error) {
      // Lock file not found or invalid
    }
  }

  async analyzeCodeImports(repoPath, results) {
    const jsFiles = await this.findJSFiles(repoPath);
    const imports = new Set();
    const dynamicImports = new Set();
    const requires = new Set();

    for (const filePath of jsFiles) {
      try {
        const content = await fs.readFile(filePath, 'utf8');
        
        // Analizar ES6 imports
        const importMatches = content.match(/import\s+.*?\s+from\s+['"`]([^'"`]+)['"`]/g);
        if (importMatches) {
          importMatches.forEach(match => {
            const moduleMatch = match.match(/from\s+['"`]([^'"`]+)['"`]/);
            if (moduleMatch) imports.add(moduleMatch[1]);
          });
        }

        // Analizar dynamic imports
        const dynamicMatches = content.match(/import\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g);
        if (dynamicMatches) {
          dynamicMatches.forEach(match => {
            const moduleMatch = match.match(/['"`]([^'"`]+)['"`]/);
            if (moduleMatch) dynamicImports.add(moduleMatch[1]);
          });
        }

        // Analizar require()
        const requireMatches = content.match(/require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g);
        if (requireMatches) {
          requireMatches.forEach(match => {
            const moduleMatch = match.match(/['"`]([^'"`]+)['"`]/);
            if (moduleMatch) requires.add(moduleMatch[1]);
          });
        }

      } catch (error) {
        // Skip files that can't be read
      }
    }

    results.codeAnalysis = {
      staticImports: Array.from(imports),
      dynamicImports: Array.from(dynamicImports),
      requireCalls: Array.from(requires),
      unusedDependencies: this.findUnusedDependencies(results, imports, requires),
      missingDependencies: this.findMissingDependencies(results, imports, requires)
    };
  }

  findUnusedDependencies(results, imports, requires) {
    const declaredDeps = new Set([
      ...Object.keys(results.dependencies || {}),
      ...Object.keys(results.devDependencies || {})
    ]);
    
    const usedDeps = new Set([...imports, ...requires]
      .map(imp => this.resolveModuleName(imp))
      .filter(Boolean)
    );

    return Array.from(declaredDeps).filter(dep => !usedDeps.has(dep));
  }

  resolveModuleName(importPath) {
    // Resolver paths relativos vs módulos npm
    if (importPath.startsWith('.') || importPath.startsWith('/')) {
      return null; // Local file, not a dependency
    }
    
    // Scoped packages
    if (importPath.startsWith('@')) {
      const parts = importPath.split('/');
      return parts.slice(0, 2).join('/');
    }
    
    // Regular packages
    return importPath.split('/')[0];
  }

  async scanVulnerabilities(results) {
    // Integración con bases de datos de vulnerabilidades
    const vulnerablePackages = [];
    
    for (const dep of results.dependencies || []) {
      const vulnerabilities = await this.checkVulnerabilities(dep.name, dep.version);
      if (vulnerabilities.length > 0) {
        vulnerablePackages.push({
          ...dep,
          vulnerabilities
        });
      }
    }

    results.securityAnalysis = {
      vulnerablePackages,
      totalVulnerabilities: vulnerablePackages.reduce((sum, pkg) => sum + pkg.vulnerabilities.length, 0),
      criticalCount: vulnerablePackages.reduce((sum, pkg) => 
        sum + pkg.vulnerabilities.filter(v => v.severity === 'critical').length, 0
      ),
      recommendedActions: this.generateSecurityRecommendations(vulnerablePackages)
    };
  }

  async checkVulnerabilities(packageName, version) {
    // Implementar integración con:
    // - GitHub Advisory Database
    // - npm audit
    // - Snyk
    // - OSV.dev
    return []; // Placeholder
  }

  // ChromaDB specific methods
  async generateEmbeddingDocument(dependency, codeContext = null) {
    const parts = [
      dependency.name,
      dependency.description || '',
      dependency.keywords?.join(' ') || '',
      dependency.category || '',
      codeContext?.usage || ''
    ];
    
    return parts.filter(part => part.length > 0).join(' ');
  }

  async generateMetadata(dependency, repoInfo) {
    return {
      id: `js-${dependency.name}-${dependency.version}`,
      name: dependency.name,
      version: dependency.version,
      type: dependency.type,
      language: 'javascript',
      ecosystem: 'npm',
      category: this.categorizeJSDependency(dependency.name),
      license: dependency.license,
      isDeprecated: dependency.isDeprecated || false,
      hasVulnerabilities: dependency.vulnerabilities?.length > 0,
      vulnerabilityCount: dependency.vulnerabilities?.length || 0,
      downloadCount: dependency.weeklyDownloads || 0,
      maintainerCount: dependency.maintainers || 0,
      lastUpdated: dependency.lastPublished,
      repository: repoInfo.repositoryId,
      filePath: 'package.json',
      isDirect: dependency.isDirect !== false,
      isDevOnly: dependency.isDevOnly || false,
      bundleSize: dependency.bundleSize || null,
      treeShakeable: dependency.treeShakeable || null
    };
  }

  categorizeJSDependency(packageName) {
    const categories = {
      'testing': ['jest', 'mocha', 'chai', 'cypress', 'playwright', 'karma'],
      'bundling': ['webpack', 'rollup', 'parcel', 'vite', 'esbuild'],
      'framework': ['react', 'vue', 'angular', 'svelte', 'express', 'fastify'],
      'database': ['mysql', 'pg', 'mongodb', 'redis', 'sqlite'],
      'validation': ['joi', 'yup', 'ajv', 'validator'],
      'http': ['axios', 'fetch', 'superagent', 'got'],
      'utility': ['lodash', 'ramda', 'moment', 'dayjs'],
      'cli': ['commander', 'yargs', 'inquirer'],
      'logging': ['winston', 'pino', 'debug'],
      'security': ['helmet', 'bcrypt', 'jsonwebtoken']
    };

    for (const [category, packages] of Object.entries(categories)) {
      if (packages.some(pkg => packageName.includes(pkg))) {
        return category;
      }
    }

    return 'library';
  }
}

module.exports = JavaScriptDependencyParser;
```

## Python

### Ecosistema y Herramientas

**Gestores de Paquetes Soportados:**
- pip (requirements.txt, setup.py)
- pipenv (Pipfile, Pipfile.lock)
- poetry (pyproject.toml, poetry.lock)
- conda (environment.yml)

**Archivos de Configuración:**
- `requirements.txt` - Dependencias pip básicas
- `requirements-dev.txt` - Dependencias de desarrollo
- `setup.py` - Configuración tradicional de paquete
- `pyproject.toml` - Configuración moderna (PEP 518)
- `Pipfile` - Pipenv dependencies
- `poetry.lock` - Poetry lockfile
- `environment.yml` - Conda environment

### Implementación Específica

#### Parser Python Avanzado

```javascript
// src/dependency-indexer/parsers/pythonParser.js
const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

class PythonDependencyParser {
  constructor() {
    this.pypiRegistry = 'https://pypi.org/pypi';
    this.condaRegistry = 'https://anaconda.org';
  }

  async parseProject(repoPath) {
    const results = {
      dependencies: [],
      devDependencies: [],
      buildDependencies: [],
      environment: {},
      pythonVersion: null,
      packageManager: null
    };

    // Detectar gestor de paquetes principal
    results.packageManager = await this.detectPackageManager(repoPath);

    // Detectar versión de Python
    results.pythonVersion = await this.detectPythonVersion(repoPath);

    // Parsear según el gestor detectado
    switch (results.packageManager) {
      case 'poetry':
        await this.parsePoetryProject(repoPath, results);
        break;
      case 'pipenv':
        await this.parsePipenvProject(repoPath, results);
        break;
      case 'conda':
        await this.parseCondaProject(repoPath, results);
        break;
      default:
        await this.parsePipProject(repoPath, results);
    }

    // Analizar imports en código fuente
    await this.analyzeCodeImports(repoPath, results);

    // Enriquecer con metadata de PyPI
    await this.enrichWithPyPIMetadata(results);

    return results;
  }

  async detectPackageManager(repoPath) {
    const managers = [
      { name: 'poetry', file: 'pyproject.toml' },
      { name: 'pipenv', file: 'Pipfile' },
      { name: 'conda', file: 'environment.yml' },
      { name: 'pip', file: 'requirements.txt' }
    ];

    for (const manager of managers) {
      try {
        await fs.access(path.join(repoPath, manager.file));
        return manager.name;
      } catch {
        continue;
      }
    }

    return 'pip';
  }

  async parsePoetryProject(repoPath, results) {
    const pyprojectPath = path.join(repoPath, 'pyproject.toml');
    
    try {
      const content = await fs.readFile(pyprojectPath, 'utf8');
      const toml = this.parseToml(content);
      
      const poetrySection = toml.tool?.poetry;
      if (!poetrySection) return;

      // Parse main dependencies
      if (poetrySection.dependencies) {
        for (const [name, version] of Object.entries(poetrySection.dependencies)) {
          if (name !== 'python') {
            results.dependencies.push({
              name,
              version: this.normalizePoetryVersion(version),
              type: 'dependency',
              source: 'pyproject.toml',
              extras: this.extractPoetryExtras(version)
            });
          } else {
            results.pythonVersion = version;
          }
        }
      }

      // Parse dev dependencies
      if (poetrySection['dev-dependencies']) {
        for (const [name, version] of Object.entries(poetrySection['dev-dependencies'])) {
          results.devDependencies.push({
            name,
            version: this.normalizePoetryVersion(version),
            type: 'devDependency',
            source: 'pyproject.toml'
          });
        }
      }

      // Parse optional dependencies
      if (poetrySection.extras) {
        for (const [extraName, packages] of Object.entries(poetrySection.extras)) {
          packages.forEach(pkg => {
            results.dependencies.push({
              name: pkg,
              version: '*',
              type: 'optionalDependency',
              source: 'pyproject.toml',
              extra: extraName
            });
          });
        }
      }

    } catch (error) {
      console.error('Failed to parse pyproject.toml:', error.message);
    }
  }

  parseToml(content) {
    // Implementación simplificada de parser TOML
    // En producción, usar una librería como @iarna/toml
    const lines = content.split('\n');
    const result = {};
    let currentSection = result;
    let sectionPath = [];

    for (const line of lines) {
      const trimmed = line.trim();
      
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        // Nueva sección
        const sectionName = trimmed.slice(1, -1);
        sectionPath = sectionName.split('.');
        currentSection = result;
        
        for (const part of sectionPath) {
          if (!currentSection[part]) currentSection[part] = {};
          currentSection = currentSection[part];
        }
      } else if (trimmed.includes('=')) {
        // Clave-valor
        const [key, ...valueParts] = trimmed.split('=');
        const value = valueParts.join('=').trim().replace(/"/g, '');
        currentSection[key.trim()] = value;
      }
    }

    return result;
  }

  normalizePoetryVersion(versionSpec) {
    if (typeof versionSpec === 'string') {
      return versionSpec;
    }
    
    if (typeof versionSpec === 'object' && versionSpec.version) {
      return versionSpec.version;
    }
    
    return '*';
  }

  async analyzeCodeImports(repoPath, results) {
    const pythonFiles = await this.findPythonFiles(repoPath);
    const imports = new Set();
    const fromImports = new Set();

    for (const filePath of pythonFiles) {
      try {
        const content = await fs.readFile(filePath, 'utf8');
        
        // Analizar import statements
        const importMatches = content.match(/^import\s+([^\s#]+)/gm);
        if (importMatches) {
          importMatches.forEach(match => {
            const module = match.replace('import ', '').split(',')[0].trim();
            imports.add(module.split('.')[0]); // Solo el paquete raíz
          });
        }

        // Analizar from X import Y
        const fromMatches = content.match(/^from\s+([^\s]+)\s+import/gm);
        if (fromMatches) {
          fromMatches.forEach(match => {
            const module = match.match(/from\s+([^\s]+)/)[1];
            fromImports.add(module.split('.')[0]);
          });
        }

      } catch (error) {
        // Skip files that can't be read
      }
    }

    results.codeAnalysis = {
      imports: Array.from(imports),
      fromImports: Array.from(fromImports),
      unusedDependencies: this.findUnusedPythonDependencies(results, imports, fromImports),
      standardLibraryModules: this.filterStandardLibrary(imports, fromImports)
    };
  }

  async findPythonFiles(repoPath) {
    try {
      const output = execSync(`find "${repoPath}" -name "*.py" -type f`, { encoding: 'utf8' });
      return output.trim().split('\n').filter(line => line.length > 0);
    } catch {
      return [];
    }
  }

  async enrichWithPyPIMetadata(results) {
    const allDependencies = [
      ...results.dependencies,
      ...results.devDependencies
    ];

    for (const dep of allDependencies) {
      try {
        const metadata = await this.fetchPyPIMetadata(dep.name);
        if (metadata) {
          Object.assign(dep, metadata);
        }
      } catch (error) {
        console.error(`Failed to fetch PyPI metadata for ${dep.name}:`, error.message);
      }
    }
  }

  async fetchPyPIMetadata(packageName) {
    try {
      const response = await fetch(`${this.pypiRegistry}/${packageName}/json`);
      if (!response.ok) return null;

      const data = await response.json();
      return {
        description: data.info.summary,
        license: data.info.license,
        homepage: data.info.home_page,
        repository: data.info.project_urls?.Repository,
        keywords: data.info.keywords?.split(',').map(k => k.trim()) || [],
        maintainer: data.info.maintainer,
        lastRelease: data.info.version,
        pythonRequires: data.info.requires_python,
        isDeprecated: data.info.yanked || false
      };
    } catch (error) {
      return null;
    }
  }

  // ChromaDB specific methods
  generateEmbeddingDocument(dependency, codeContext = null) {
    const parts = [
      dependency.name,
      dependency.description || '',
      dependency.keywords?.join(' ') || '',
      dependency.category || '',
      `python ${dependency.pythonRequires || ''}`,
      codeContext?.usage || ''
    ];
    
    return parts.filter(part => part.length > 0).join(' ');
  }

  generateMetadata(dependency, repoInfo) {
    return {
      id: `py-${dependency.name}-${dependency.version}`,
      name: dependency.name,
      version: dependency.version,
      type: dependency.type,
      language: 'python',
      ecosystem: 'pypi',
      category: this.categorizePythonDependency(dependency.name),
      license: dependency.license,
      pythonRequires: dependency.pythonRequires,
      isDeprecated: dependency.isDeprecated || false,
      hasVulnerabilities: false, // TODO: Integrate with safety/snyk
      repository: repoInfo.repositoryId,
      source: dependency.source,
      extras: dependency.extras || [],
      isDirect: dependency.isDirect !== false,
      isDevOnly: dependency.type === 'devDependency',
      lastUpdated: new Date().toISOString()
    };
  }

  categorizePythonDependency(packageName) {
    const categories = {
      'web-framework': ['django', 'flask', 'fastapi', 'tornado', 'pyramid'],
      'testing': ['pytest', 'unittest2', 'nose', 'tox', 'coverage'],
      'data-science': ['numpy', 'pandas', 'scipy', 'matplotlib', 'sklearn'],
      'machine-learning': ['tensorflow', 'pytorch', 'keras', 'xgboost'],
      'database': ['sqlalchemy', 'psycopg2', 'pymongo', 'redis'],
      'http': ['requests', 'httpx', 'aiohttp', 'urllib3'],
      'async': ['asyncio', 'aiofiles', 'uvloop', 'trio'],
      'cli': ['click', 'argparse', 'typer', 'fire'],
      'serialization': ['pydantic', 'marshmallow', 'cerberus'],
      'templating': ['jinja2', 'mako', 'chameleon'],
      'security': ['cryptography', 'passlib', 'pyjwt'],
      'deployment': ['gunicorn', 'uwsgi', 'celery', 'supervisor']
    };

    for (const [category, packages] of Object.entries(categories)) {
      if (packages.some(pkg => packageName.toLowerCase().includes(pkg))) {
        return category;
      }
    }

    return 'library';
  }
}

module.exports = PythonDependencyParser;
```

## Java

### Ecosistema y Herramientas

**Gestores de Dependencias Soportados:**
- Maven (pom.xml)
- Gradle (build.gradle, build.gradle.kts)
- SBT (build.sbt) - Scala
- Ant + Ivy (ivy.xml)

**Archivos de Configuración:**
- `pom.xml` - Maven project descriptor
- `build.gradle` - Gradle build script (Groovy)
- `build.gradle.kts` - Gradle build script (Kotlin)
- `settings.gradle` - Gradle settings
- `gradle.properties` - Gradle properties
- `build.sbt` - SBT build definition

### Implementación Específica

```javascript
// src/dependency-indexer/parsers/javaParser.js
class JavaDependencyParser {
  constructor() {
    this.mavenCentral = 'https://search.maven.org/solrsearch/select';
  }

  async parseProject(repoPath) {
    const results = {
      dependencies: [],
      testDependencies: [],
      buildDependencies: [],
      plugins: [],
      properties: {},
      javaVersion: null,
      buildTool: null
    };

    // Detectar build tool
    results.buildTool = await this.detectBuildTool(repoPath);

    switch (results.buildTool) {
      case 'maven':
        await this.parseMavenProject(repoPath, results);
        break;
      case 'gradle':
        await this.parseGradleProject(repoPath, results);
        break;
      case 'sbt':
        await this.parseSBTProject(repoPath, results);
        break;
    }

    // Analizar imports en código Java
    await this.analyzeJavaImports(repoPath, results);

    // Enriquecer con metadata de Maven Central
    await this.enrichWithMavenMetadata(results);

    return results;
  }

  async parseMavenProject(repoPath, results) {
    const pomPath = path.join(repoPath, 'pom.xml');
    
    try {
      const pomContent = await fs.readFile(pomPath, 'utf8');
      const dom = this.parseXML(pomContent);
      
      // Parse properties
      const properties = dom.querySelector('properties');
      if (properties) {
        for (const child of properties.children) {
          results.properties[child.tagName] = child.textContent;
        }
      }

      // Parse dependencies
      const dependencies = dom.querySelectorAll('dependency');
      for (const dep of dependencies) {
        const groupId = dep.querySelector('groupId')?.textContent;
        const artifactId = dep.querySelector('artifactId')?.textContent;
        const version = dep.querySelector('version')?.textContent;
        const scope = dep.querySelector('scope')?.textContent || 'compile';
        const optional = dep.querySelector('optional')?.textContent === 'true';

        if (groupId && artifactId) {
          results.dependencies.push({
            groupId,
            artifactId,
            name: `${groupId}:${artifactId}`,
            version: this.resolveMavenVersion(version, results.properties),
            scope,
            optional,
            type: scope === 'test' ? 'testDependency' : 'dependency',
            source: 'pom.xml'
          });
        }
      }

    } catch (error) {
      console.error('Failed to parse pom.xml:', error.message);
    }
  }

  // Similar implementations for Gradle and SBT...

  generateEmbeddingDocument(dependency, codeContext = null) {
    const parts = [
      dependency.name || `${dependency.groupId}:${dependency.artifactId}`,
      dependency.description || '',
      dependency.groupId || '',
      dependency.artifactId || '',
      `java ${dependency.javaVersion || ''}`,
      dependency.category || '',
      codeContext?.usage || ''
    ];
    
    return parts.filter(part => part.length > 0).join(' ');
  }

  categorizeJavaDependency(artifactId, groupId = '') {
    const categories = {
      'web-framework': ['spring-boot', 'spring-web', 'jersey', 'struts', 'wicket'],
      'testing': ['junit', 'testng', 'mockito', 'powermock', 'hamcrest'],
      'logging': ['logback', 'log4j', 'slf4j', 'commons-logging'],
      'database': ['hibernate', 'mybatis', 'jdbc', 'h2', 'postgresql'],
      'serialization': ['jackson', 'gson', 'xstream', 'protobuf'],
      'http': ['httpclient', 'okhttp', 'retrofit', 'feign'],
      'utility': ['commons-lang', 'commons-io', 'guava', 'apache-commons'],
      'security': ['spring-security', 'shiro', 'bouncastle'],
      'build': ['maven', 'gradle', 'ant']
    };

    const searchText = `${artifactId} ${groupId}`.toLowerCase();
    
    for (const [category, patterns] of Object.entries(categories)) {
      if (patterns.some(pattern => searchText.includes(pattern))) {
        return category;
      }
    }

    return 'library';
  }
}
```

## Go

### Implementación Go

```javascript
// src/dependency-indexer/parsers/goParser.js
class GoDependencyParser {
  async parseProject(repoPath) {
    const results = {
      dependencies: [],
      indirectDependencies: [],
      replacements: [],
      excludes: [],
      goVersion: null,
      module: null
    };

    await this.parseGoMod(repoPath, results);
    await this.analyzeGoImports(repoPath, results);

    return results;
  }

  async parseGoMod(repoPath, results) {
    const goModPath = path.join(repoPath, 'go.mod');
    
    try {
      const content = await fs.readFile(goModPath, 'utf8');
      const lines = content.split('\n');

      let currentSection = null;
      let inBlockComment = false;

      for (const line of lines) {
        const trimmed = line.trim();
        
        if (trimmed.startsWith('module ')) {
          results.module = trimmed.replace('module ', '');
        } else if (trimmed.startsWith('go ')) {
          results.goVersion = trimmed.replace('go ', '');
        } else if (trimmed === 'require (') {
          currentSection = 'require';
        } else if (trimmed === 'replace (') {
          currentSection = 'replace';
        } else if (trimmed === 'exclude (') {
          currentSection = 'exclude';
        } else if (trimmed === ')') {
          currentSection = null;
        } else if (currentSection === 'require' && trimmed) {
          this.parseGoRequire(trimmed, results);
        }
      }
    } catch (error) {
      console.error('Failed to parse go.mod:', error.message);
    }
  }

  parseGoRequire(line, results) {
    const parts = line.split(/\s+/);
    if (parts.length >= 2) {
      const module = parts[0];
      const version = parts[1];
      const isDirect = !line.includes('// indirect');

      const dependency = {
        name: module,
        version,
        type: isDirect ? 'dependency' : 'indirectDependency',
        isDirect,
        source: 'go.mod'
      };

      if (isDirect) {
        results.dependencies.push(dependency);
      } else {
        results.indirectDependencies.push(dependency);
      }
    }
  }

  categorizeGoDependency(moduleName) {
    const categories = {
      'web-framework': ['gin-gonic', 'echo', 'fiber', 'chi', 'gorilla/mux'],
      'database': ['gorm', 'sqlx', 'mongo-driver', 'redis', 'badger'],
      'testing': ['testify', 'gomega', 'ginkgo'],
      'logging': ['logrus', 'zap', 'zerolog'],
      'http': ['resty', 'fasthttp'],
      'cli': ['cobra', 'cli', 'kingpin'],
      'security': ['crypto', 'jwt-go', 'bcrypt'],
      'serialization': ['json-iterator', 'protobuf', 'msgpack']
    };

    for (const [category, patterns] of Object.entries(categories)) {
      if (patterns.some(pattern => moduleName.includes(pattern))) {
        return category;
      }
    }

    return 'library';
  }
}
```

## ChromaDB Integration Patterns

### Universal Embedding Strategy

```javascript
// src/dependency-indexer/core/embeddingStrategy.js
class DependencyEmbeddingStrategy {
  constructor() {
    this.embeddingModels = {
      code: 'microsoft/codebert-base',
      text: 'sentence-transformers/all-MiniLM-L6-v2',
      security: 'sentence-transformers/all-mpnet-base-v2'
    };
  }

  async generateDependencyEmbedding(dependency, context = {}) {
    // Create comprehensive document for embedding
    const document = this.createEmbeddingDocument(dependency, context);
    
    // Choose appropriate model based on content type
    const modelType = this.selectEmbeddingModel(dependency, context);
    
    // Generate embedding (would integrate with actual embedding service)
    return {
      document,
      modelType,
      metadata: this.createEmbeddingMetadata(dependency, context)
    };
  }

  createEmbeddingDocument(dependency, context) {
    const parts = [
      `${dependency.language} package ${dependency.name}`,
      dependency.description || '',
      dependency.keywords?.join(' ') || '',
      dependency.category || '',
      `version ${dependency.version}`,
      context.usagePatterns?.join(' ') || '',
      context.codeSnippets?.join(' ') || ''
    ];
    
    return parts.filter(part => part.length > 0).join(' ');
  }

  selectEmbeddingModel(dependency, context) {
    if (context.hasCodeSnippets) return 'code';
    if (context.isSecurityRelated) return 'security';
    return 'text';
  }

  createEmbeddingMetadata(dependency, context) {
    return {
      // Core dependency info
      id: `${dependency.language}-${dependency.name}-${dependency.version}`,
      name: dependency.name,
      version: dependency.version,
      language: dependency.language,
      ecosystem: dependency.ecosystem,
      category: dependency.category,
      type: dependency.type,
      
      // Quality metrics
      isDeprecated: dependency.isDeprecated || false,
      hasVulnerabilities: dependency.vulnerabilities?.length > 0 || false,
      vulnerabilityCount: dependency.vulnerabilities?.length || 0,
      downloadCount: dependency.downloadCount || 0,
      maintainerCount: dependency.maintainers || 0,
      licenseType: this.normalizeLicense(dependency.license),
      
      // Context info
      repository: context.repositoryId,
      filePath: dependency.source,
      isDirect: dependency.isDirect !== false,
      isTestOnly: dependency.type?.includes('test') || false,
      
      // Timestamps
      lastUpdated: dependency.lastPublished || new Date().toISOString(),
      indexedAt: new Date().toISOString(),
      
      // Advanced metadata
      codeComplexity: context.complexity || 'unknown',
      usageFrequency: context.usageCount || 0,
      breakingChangeRisk: this.assessBreakingChangeRisk(dependency),
      securityRisk: this.assessSecurityRisk(dependency),
      
      // Searchable tags
      tags: this.generateTags(dependency, context)
    };
  }

  normalizeLicense(license) {
    if (!license) return 'unknown';
    
    const commonLicenses = {
      'MIT': 'permissive',
      'Apache-2.0': 'permissive',
      'BSD': 'permissive',
      'GPL': 'copyleft',
      'LGPL': 'weak-copyleft',
      'ISC': 'permissive',
      'Mozilla': 'weak-copyleft'
    };

    for (const [pattern, type] of Object.entries(commonLicenses)) {
      if (license.toUpperCase().includes(pattern)) {
        return type;
      }
    }

    return 'other';
  }

  assessBreakingChangeRisk(dependency) {
    // Implement heuristics for breaking change assessment
    if (dependency.version.startsWith('0.')) return 'high';
    if (dependency.isDeprecated) return 'high';
    if (dependency.lastPublished && 
        new Date() - new Date(dependency.lastPublished) > 365 * 24 * 60 * 60 * 1000) {
      return 'medium';
    }
    return 'low';
  }

  assessSecurityRisk(dependency) {
    if (dependency.vulnerabilities?.some(v => v.severity === 'critical')) return 'high';
    if (dependency.vulnerabilities?.some(v => v.severity === 'high')) return 'medium';
    if (dependency.vulnerabilities?.length > 0) return 'low';
    return 'none';
  }

  generateTags(dependency, context) {
    const tags = [
      dependency.language,
      dependency.category,
      dependency.type,
      dependency.ecosystem
    ];

    if (dependency.isDeprecated) tags.push('deprecated');
    if (dependency.hasVulnerabilities) tags.push('vulnerable');
    if (context.isPopular) tags.push('popular');
    if (context.isMaintained) tags.push('maintained');

    return tags.filter(Boolean);
  }
}

module.exports = DependencyEmbeddingStrategy;
```

## Collection Management Strategy

```javascript
// src/dependency-indexer/core/collectionManager.js
class DependencyCollectionManager {
  constructor(chromaClient) {
    this.chromaClient = chromaClient;
  }

  async initializeRepositoryCollections(repositoryId) {
    const collections = [
      {
        name: `dependencies-${repositoryId}`,
        purpose: 'dependencies',
        schema: 'dependency-v1',
        embeddingModel: 'text'
      },
      {
        name: `code-usage-${repositoryId}`,
        purpose: 'code-usage',
        schema: 'usage-v1',
        embeddingModel: 'code'
      },
      {
        name: `vulnerabilities-${repositoryId}`,
        purpose: 'vulnerabilities',
        schema: 'vulnerability-v1',
        embeddingModel: 'security'
      }
    ];

    for (const collection of collections) {
      await this.chromaClient.getOrCreateCollection({
        name: collection.name,
        metadata: {
          purpose: collection.purpose,
          repository: repositoryId,
          schema: collection.schema,
          embeddingModel: collection.embeddingModel,
          createdAt: new Date().toISOString()
        }
      });
    }

    return collections.map(c => c.name);
  }

  async optimizeCollections(repositoryId) {
    // Implement collection optimization strategies
    // - Remove duplicates
    // - Update embeddings
    // - Rebalance partitions
    // - Update metadata
  }
}

module.exports = DependencyCollectionManager;
```

Esta documentación proporciona estrategias completas y específicas para cada lenguaje de programación, con implementaciones detalladas que aprovechan al máximo las capacidades de ChromaDB para el análisis semántico de dependencias.