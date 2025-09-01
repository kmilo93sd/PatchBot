# Dependency Graph Index System - Diseño Técnico

## 🎯 Objetivo
Eliminar dependencia de GitHub Search API y crear un índice precomputado de dependencias para detección eficiente de breaking changes.

## 🏗️ Arquitectura Propuesta

### Componente 1: Repository Index Builder
```bash
# Proceso de indexación (ejecutar 1x por repo o en cambios)
./index-builder --repo nubox-spa/sas-banking-bff --output ./dependency-index/
```

#### Tecnologías Base:
1. **jdeps**: Análisis de dependencias a nivel bytecode
2. **Tree-sitter**: Parsing rápido de AST (36x más rápido)  
3. **LSIF**: Formato estándar de índices precomputados

### Componente 2: Dependency Graph Database
```json
{
  "repository": "nubox-spa/sas-banking-bff",
  "lastUpdated": "2025-01-31T10:30:00Z",
  "index": {
    "classes": {
      "MovementServiceImpl": {
        "path": "src/main/java/.../MovementServiceImpl.java",
        "package": "com.nubox.core.banking.domain.service",
        "publicMethods": [
          {
            "name": "recategorizeMovement", 
            "signature": "void recategorizeMovement(Long id, Category category)",
            "line": 45
          }
        ],
        "dependencies": ["MovementRepository", "EventPublisher"],
        "dependents": ["ReconciliationMovementServiceImpl"]
      }
    },
    "dependencies": {
      "MovementServiceImpl -> EventPublisher": {
        "type": "field_injection",
        "line": 25,
        "usage": ["publish method call at line 67"]
      }
    }
  }
}
```

### Componente 3: Breaking Changes Analyzer
```javascript
class BreakingChangesAnalyzer {
  async analyzeChanges(modifiedFiles, dependencyIndex) {
    const breakingChanges = [];
    
    for (const file of modifiedFiles) {
      const oldAST = this.parseFile(file.oldContent);
      const newAST = this.parseFile(file.newContent);
      
      const changes = this.detectAPIChanges(oldAST, newAST);
      
      for (const change of changes) {
        const affectedFiles = this.findAffectedFiles(change, dependencyIndex);
        breakingChanges.push({
          change,
          affectedFiles,
          severity: this.calculateSeverity(affectedFiles.length)
        });
      }
    }
    
    return breakingChanges;
  }
}
```

## 🚀 Ventajas vs GitHub Search API

### ❌ GitHub Search API (actual):
- 5000 requests/hour limit
- Solo busca texto, no semántica
- No detecta cambios en signatures
- Latencia de red en cada búsqueda

### ✅ Dependency Index (propuesto):
- Sin límites de rate
- Análisis semántico completo
- Detección precisa de breaking changes
- Búsquedas instantáneas (local)
- Funciona offline

## 📋 Plan de Implementación

### Fase 1: Index Builder
- [ ] Integrar jdeps para análisis de bytecode
- [ ] Implementar Tree-sitter Java parser
- [ ] Crear formato de índice JSON
- [ ] Script de indexación de repositorio

### Fase 2: Breaking Changes Detection
- [ ] AST diff analyzer
- [ ] Public API signature comparison  
- [ ] Impact analysis usando índice
- [ ] Severity calculation

### Fase 3: Integration con PR Revisor
- [ ] Pre-compute índice en setup
- [ ] Reemplazar GitHub Search con índice local
- [ ] Agregar breaking changes node a LangGraph
- [ ] UI para mostrar impacto de cambios

## 🔧 Herramientas y Tecnologías

### Core Stack:
- **jdeps**: Dependencias bytecode (built-in JDK)
- **tree-sitter-java**: Parsing AST ultrarrápido
- **Node.js**: Runtime para procesamiento
- **SQLite/JSON**: Storage de índices

### Inspiración:
- **SourceGraph LSIF**: Formato estándar de índices
- **Jarviz (Expedia)**: Visualización de dependencias Java
- **IntelliJ IDEA**: Análisis de dependencias interno

## 💡 Casos de Uso Específicos

### 1. Método Eliminado
```diff
- public void oldMethod() { ... }
```
**Detección**: Comparar public methods en AST
**Impacto**: Buscar usos en dependency index
**Output**: "⚠️ Breaking change: oldMethod() removed, affects 3 files"

### 2. Signature Changed  
```diff
- public void process(String data)
+ public void process(String data, Options opts)
```
**Detección**: Comparar method signatures
**Impacto**: Encontrar call sites sin nuevo parámetro
**Output**: "🔴 Breaking change: process() signature changed, 12 call sites need updating"

### 3. Interface Modified
```diff
public interface EventPublisher {
-   void publish(Event event);
+   CompletableFuture<Void> publish(Event event);
}
```
**Detección**: Return type change en interface
**Impacto**: Todas las implementaciones y usuarios
**Output**: "💥 Critical: EventPublisher return type changed, affects all implementations"

## 🎯 Métricas de Éxito

- **Velocidad**: Análisis completo <30s (vs varios minutos con API)
- **Precisión**: 95%+ de breaking changes detectados
- **Cobertura**: 100% de dependencias internas identificadas
- **Escalabilidad**: Repos de 100k+ archivos soportados

## 🚧 Consideraciones Técnicas

### Storage:
- **JSON files**: Para índices pequeños (<1MB)
- **SQLite**: Para repos grandes (1MB+)
- **Incremental updates**: Solo re-index archivos cambiados

### Performance:
- **Lazy loading**: Cargar solo secciones relevantes del índice
- **Caching**: Cache AST parsing results
- **Parallel processing**: Múltiples archivos en paralelo

### Maintenance:
- **Auto-refresh**: Re-index cuando hay push al main branch
- **Validation**: Verificar consistencia de índice
- **Metrics**: Tracking de uso y performance