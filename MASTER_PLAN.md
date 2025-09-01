# Plan Maestro - Sistema de Índice de Dependencias

## Resumen Ejecutivo

El Sistema de Índice de Dependencias (DIS) es una extensión del PR Revisor que crea y mantiene índices JSON precomputados de dependencias de código. Este sistema analiza proyectos de múltiples lenguajes de programación, identifica dependencias, relaciones y patrones, y almacena esta información en índices JSON eficientes para análisis instantáneo en Lambda.

### Arquitectura Simplificada con Índices JSON

**DISEÑO EFICIENTE**: Sistema basado en índices JSON precomputados:

- **Almacenamiento Simple**: Dependencias y relaciones en formato JSON estructurado
- **Búsqueda Directa**: Consultas instantáneas sobre estructuras de datos en memoria
- **Análisis Efímero**: Carga completa del índice en memoria Lambda para análisis rápido
- **Sin Dependencias Externas**: Solo requiere S3 para almacenamiento de índices

## Objetivos Principales

### 1. **Indexación de Dependencias**
- Análisis multi-lenguaje (JavaScript/TypeScript, Python, Java, C#, Go)
- Detección automática de dependencias directas e indirectas
- Almacenamiento en JSON estructurado en S3
- Metadatos enriquecidos para cada dependencia

### 2. **Búsqueda y Recuperación Directa**
- Consultas instantáneas sobre estructuras JSON en memoria
- Búsquedas por nombre, tipo, y relaciones de dependencia
- Análisis de impacto de cambios en dependencias
- Detección de breaking changes basada en AST

### 3. **Integración con PR Revisor**
- Extensión del agente LangGraph existente
- Análisis de dependencias en tiempo real para PRs
- Alertas automáticas sobre cambios críticos de dependencias
- Sugerencias de optimización basadas en el historial del proyecto

### 4. **Análisis de Seguridad y Calidad**
- Detección de vulnerabilidades conocidas en dependencias
- Análisis de licencias y compatibilidad
- Métricas de calidad y mantenimiento de dependencias
- Alertas sobre dependencias obsoletas o no mantenidas

## Arquitectura del Sistema

### Componentes Principales

#### 1. **Dependency Indexer Lambda** (`dependency-indexer`)
- **Función**: Análisis y indexación inicial de repositorios
- **Memoria**: 2048MB (análisis intensivo)
- **Timeout**: 900s (15 minutos)
- **Triggers**: API Gateway, S3 events, CloudWatch Events
- **Output**: Índice JSON almacenado en S3:
  - `s3://bucket/indexes/[repo-id]/dependency-index.json`
  - Estructura completa de dependencias y relaciones
  - Metadatos de análisis y timestamp de actualización

#### 2. **Dependency Analyzer Lambda** (`dependency-analyzer`)
- **Función**: Análisis en tiempo real para PRs
- **Memoria**: 1024MB
- **Timeout**: 300s (5 minutos)
- **Triggers**: SQS desde PR Processor existente
- **JSON Loading**: Carga índice desde S3 al inicio, análisis en memoria

#### 3. **Dependency Updater Lambda** (`dependency-updater`)
- **Función**: Mantenimiento y actualización del índice
- **Memoria**: 1024MB
- **Timeout**: 900s
- **Triggers**: CloudWatch Events (programado)
- **JSON Updates**: Regeneración incremental de índices cuando hay cambios

### Pipeline de Procesamiento

```
GitHub Repo → Indexer → S3 JSON Index → Analyzer → PR Comments
     ↓              ↓                        ↑
   S3 Bucket → Updater → JSON Updates → Memory Load
```

### Estructura del Índice JSON

#### Formato del Índice Principal

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
    },
    "files": {
      "src/main/java/.../MovementServiceImpl.java": {
        "language": "java",
        "classes": ["MovementServiceImpl"],
        "lastModified": "2025-01-31T09:15:00Z"
      }
    }
  }
}
```

## Roadmap de Implementación

### Fase 1: Fundación (Semanas 1-2)
- ✅ Configuración de infraestructura AWS
- ⏳ Sistema de indexación JSON básico
- ⏳ Lambda de indexación básica para JavaScript/Node.js
- ⏳ Formato de índice JSON estructurado

### Fase 2: Análisis Multi-Lenguaje (Semanas 3-4)
- 🔄 Soporte completo para TypeScript, Python, Java
- 🔄 Parsers especializados por lenguaje
- 🔄 Detección de dependencias indirectas
- 🔄 Validación de estructura JSON y consistencia

### Fase 3: Integración PR Revisor (Semanas 5-6)
- ⏳ Extensión del agente LangGraph existente
- ⏳ Pipeline de análisis en tiempo real
- ⏳ Generación de comentarios inteligentes
- ⏳ Métricas y monitoreo

### Fase 4: Análisis Avanzado (Semanas 7-8)
- ⏳ Base de datos de vulnerabilidades integrada
- ⏳ Análisis de licencias automático
- ⏳ Recomendaciones de optimización
- ⏳ Dashboard de métricas

### Fase 5: Optimización y Producción (Semanas 9-10)
- ⏳ Optimización de performance ChromaDB
- ⏳ Caching inteligente
- ⏳ Monitoreo avanzado con New Relic
- ⏳ Documentación completa

## Estructura del Proyecto

```
pr-revisor/
├── src/
│   ├── dependency-indexer/           # Lambda de indexación
│   │   ├── app.js                   # Handler principal
│   │   ├── core/
│   │   │   ├── indexer.js          # Lógica de indexación
│   │   │   ├── parser.js           # Parsers multi-lenguaje
│   │   │   └── indexStorage.js     # Gestión de índices JSON
│   │   ├── adapters/
│   │   │   ├── githubAdapter.js    # Integración GitHub
│   │   │   ├── s3Adapter.js        # Storage S3
│   │   │   └── vulnerabilityAdapter.js # APIs vulnerabilidades
│   │   └── utils/
│   ├── dependency-analyzer/          # Lambda de análisis PR
│   │   ├── app.js
│   │   ├── core/
│   │   │   ├── analyzer.js         # Análisis de impacto
│   │   │   ├── comparator.js       # Comparación de versiones
│   │   │   └── recommender.js      # Sistema de recomendaciones
│   │   └── utils/
│   └── dependency-updater/           # Lambda de actualización
│       ├── app.js
│       ├── core/
│       │   ├── updater.js          # Actualización incremental
│       │   └── scheduler.js        # Programación de tareas
│       └── utils/
├── layers/
│   ├── json-storage-layer/          # Utilidades de almacenamiento JSON
│   └── dependency-parsers-layer/    # Parsers especializados
├── events/
│   ├── dependency-indexer-event.json
│   ├── dependency-analyzer-event.json
│   └── dependency-updater-event.json
├── scripts/
│   ├── setup-s3-buckets.js          # Setup de buckets S3
│   ├── migrate-indexes.js           # Migraciones de índices
│   └── performance-test.js          # Tests de performance
└── docs/
    ├── ARCHITECTURE.md              # Arquitectura detallada
    ├── IMPLEMENTATION_GUIDE.md      # Guía de implementación
    ├── LANGUAGE_STRATEGIES.md       # Estrategias por lenguaje
    ├── TESTING_PLAN.md             # Plan de testing
    └── DEPLOYMENT_GUIDE.md         # Guía de despliegue
```

## Métricas de Éxito

### KPIs Técnicos
- **Precisión de Detección**: >95% de dependencias correctamente identificadas
- **Performance JSON**: Carga de índice <100ms, consultas <10ms
- **Cobertura de Lenguajes**: 5 lenguajes principales soportados
- **Tiempo de Indexación**: <30min para repositorios de tamaño medio

### KPIs de Negocio
- **Detección de Vulnerabilidades**: 100% de CVEs críticos detectados
- **Calidad de PRs**: 40% reducción en issues post-merge
- **Tiempo de Revisión**: 30% reducción en tiempo promedio
- **Satisfacción Desarrollador**: Score >4.5/5 en usabilidad

## Consideraciones de Seguridad

### Seguridad de Índices JSON
- Índices almacenados en S3 con cifrado
- Acceso mediante IAM roles específicos
- Separación por repositorio/proyecto
- Logs de acceso a través de CloudTrail

### Datos Sensibles
- Nunca almacenar tokens o credenciales en índices JSON
- Anonimización de información propietaria
- Cumplimiento GDPR/CCPA para metadatos
- Políticas de retención S3 configuradas

## Recursos y Costos Estimados

### Infraestructura AWS (mensual)
- **Lambda Executions**: ~$200-400 (variable por uso)
- **DynamoDB**: ~$100-200 (jobs table + metadata)
- **S3 Storage**: ~$50-100 (repositorios + cache)
- **CloudWatch Logs**: ~$25-50
- **Total Estimado**: $375-750/mes

### Almacenamiento S3
- **S3 Standard**: ~$10-30/mes (almacenamiento de índices)
- **S3 Requests**: ~$5-15/mes (GET/PUT operations)

### Desarrollo y Mantenimiento
- **Desarrollo Inicial**: 8-10 semanas desarrollador senior
- **Mantenimiento**: 20-30% tiempo desarrollador

## Próximos Pasos Inmediatos

1. **Configurar S3 Buckets**
   ```bash
   # Crear buckets para almacenar índices
   cd scripts/
   node setup-s3-buckets.js --env internal
   ```

2. **Implementar Indexer Básico**
   ```bash
   # Seguir IMPLEMENTATION_GUIDE.md
   sam build
   sam deploy --stack-name pr-revisor-dependency-index-internal
   ```

3. **Generar Índices Iniciales**
   ```bash
   # Ejecutar indexación inicial
   aws lambda invoke \
     --function-name internal-nbx-dependency-indexer-lambda \
     --payload file://events/initial-index-event.json \
     result.json
   ```

4. **Testing y Validación**
   ```bash
   # Tests de integración
   npm run test:integration
   # Performance testing
   node scripts/performance-test.js
   ```

## Documentación Relacionada

- **ARCHITECTURE.md**: Arquitectura técnica detallada
- **IMPLEMENTATION_GUIDE.md**: Guía paso a paso de implementación
- **LANGUAGE_STRATEGIES.md**: Estrategias específicas por lenguaje
- **TESTING_PLAN.md**: Plan comprehensivo de testing
- **DEPLOYMENT_GUIDE.md**: Instrucciones de despliegue y configuración

---

**Nota Crítica**: Este sistema está diseñado para máxima simplicidad y eficiencia, utilizando índices JSON precomputados para análisis instantáneo en Lambda sin dependencias externas complejas. Todas las decisiones priorizan velocidad, simplicidad y confiabilidad.

**Estado del Proyecto**: Fase 1 - Fundación (En Desarrollo)
**Próxima Revisión**: Semanal con actualizaciones de progreso
**Contacto Técnico**: Equipo NBX Architecture