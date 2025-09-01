# CLAUDE.md - PatchBot

Este archivo proporciona orientación a Claude Code cuando trabaja con código en este repositorio.

## Descripción General del Proyecto

**PatchBot** es una API asíncrona serverless que revisa automáticamente Pull Requests de GitHub utilizando IA. El sistema recibe webhooks de GitHub, procesa los PRs en segundo plano con AWS Bedrock (Claude 3.5 Sonnet), y genera comentarios inteligentes de revisión de código con análisis avanzado de dependencias.

## Arquitectura

### Componentes Principales:
- **pr-receptor**: Lambda que recibe webhooks de GitHub (responde <3s)
- **pr-processor**: Lambda que procesa PRs con IA usando LangChain/LangGraph
- **Pipeline asíncrono**: SQS + DynamoDB para desacoplamiento
- **AWS Bedrock**: Claude 3.5 Sonnet para análisis de código
- **New Relic**: Monitoreo y observabilidad

### Flujo:
```
GitHub Webhook → API Gateway → pr-receptor → SQS → pr-processor → Bedrock → GitHub Comments
```

## Tareas Comunes de Desarrollo

### Comandos de Construcción y Despliegue

```bash
# Construir el proyecto
sam build

# Validar template
sam validate

# Desplegar a ambiente interno
sam deploy --stack-name pr-revisor-internal --parameter-overrides envName=internal

# Desplegar a desarrollo
sam deploy --stack-name pr-revisor-development --parameter-overrides envName=development

# Desplegar a producción
sam deploy --stack-name pr-revisor-production --parameter-overrides envName=production LambdaMemory=1024
```

### Pruebas Locales

```bash
# Probar función receptor
sam local invoke PRReceptorFunction --event events/pr-receptor-event.json

# Probar función procesador  
sam local invoke PRProcessorFunction --event events/pr-processor-event.json

# Iniciar API local
sam local start-api --port 3000

# Probar endpoint local
curl -X POST http://localhost:3000/review-pr \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: pull_request" \
  -d @events/pr-receptor-event.json
```

### Gestión de Dependencias

```bash
# Instalar dependencias en capas
cd layers/aws-sdk-layer/nodejs && npm install

# Actualizar dependencias
cd layers/aws-sdk-layer/nodejs && npm update

# Agregar nueva dependencia a layer
cd layers/aws-sdk-layer/nodejs && npm install nueva-dependencia
```

### Logs y Debugging

```bash
# Ver logs de función receptor
aws logs tail /aws/lambda/internal-nbx-pr-receptor-lambda --follow

# Ver logs de función procesador
aws logs tail /aws/lambda/internal-nbx-pr-processor-lambda --follow

# Ver mensajes en DLQ
aws sqs receive-message --queue-url [URL-DLQ]
```

## Convenciones del Proyecto

### Generales
- **Responder siempre en español** en comentarios y documentación
- **Seguir estándares NBX** definidos en ARCHITECTURAL_STANDARDS.md
- **Usar nomenclatura empresarial** en todos los recursos AWS
- **Logging estructurado** con AWS Lambda Powertools
- **Manejo de errores** con reintentos y DLQ

### Código
- **ES6 Modules** (`import/export`) en lugar de CommonJS
- **Async/await** en lugar de Promises con .then()
- **Validación de entrada** con Ajv para todos los inputs
- **Logging contextual** con requestId y correlationId
- **Métricas personalizadas** para operaciones críticas

### Estructura de Archivos
- `src/[función]/` - Una carpeta por función Lambda
- `src/[función]/config/` - Configuraciones específicas
- `src/[función]/core/` - Lógica principal de negocio
- `src/[función]/adapters/` - Integraciones con servicios externos
- `src/[función]/utils/` - Utilidades compartidas

### Variables de Entorno Críticas
- `REVIEW_JOBS_TABLE` - Tabla DynamoDB de jobs
- `PR_PROCESS_QUEUE_URL` - Cola SQS de procesamiento
- `AWS_REGION` - Región AWS (por defecto us-east-1)
- `NODE_ENV` - Ambiente (internal/development/production)

## Puntos Críticos

### Seguridad
- **NUNCA commitear** API keys o secrets en el código
- **Validar siempre** signatures de GitHub webhooks en producción
- **Usar IAM roles** con permisos mínimos necesarios
- **Logs sensibles** - no loguear tokens o secrets

### Performance  
- **Respuesta rápida** del receptor (<3 segundos) es CRÍTICA
- **Timeouts apropiados** - receptor: 180s, procesador: 900s
- **Batch size 1** en SQS por complejidad del procesamiento IA
- **Memory optimization** - receptor: 512MB, procesador: 1024MB

### Reliability
- **Idempotencia** - funciones deben ser idempotentes
- **TTL en DynamoDB** configurado a 90 días
- **Dead Letter Queues** para manejo de fallos
- **Reintentos inteligentes** con exponential backoff

### Monitoreo
- **New Relic** integrado siguiendo estándares corporativos
- **CloudWatch metrics** personalizadas para KPIs
- **Structured logging** para debugging efectivo
- **Alertas** en errores críticos y timeouts

## Estados de Desarrollo

### ✅ COMPLETADO - FASE 1: Infraestructura Base
- Estructura de proyecto siguiendo estándares NBX
- Template SAM con nomenclatura corporativa  
- Función pr-receptor completa y funcional
- Capas Lambda con AWS SDK v3
- Eventos de prueba local

### 🚧 EN DESARROLLO - FASE 2: Procesador Básico
- Función pr-processor básica
- Integración GitHub API
- Pipeline asíncrono SQS → Lambda
- AWS Bedrock integration básica

### ⏳ PENDIENTE - FASE 3: Agente IA Inteligente  
- LangChain + LangGraph integration
- Agente multi-nodo para revisión especializada
- Workflows de análisis (security, performance, best practices)
- Prompts especializados por tipo de código

## Comandos de Emergencia

### Si el sistema falla:
```bash
# Verificar estado de recursos
aws dynamodb describe-table --table-name review-jobs-internal
aws sqs get-queue-attributes --queue-url [QUEUE-URL] --attribute-names All

# Purgar cola si necesario (¡CUIDADO!)
aws sqs purge-queue --queue-url [QUEUE-URL]

# Verificar logs en tiempo real
aws logs tail /aws/lambda/internal-nbx-pr-receptor-lambda --follow
```

### Si hay demasiados errores:
```bash
# Escalar memoria temporalmente
aws lambda update-function-configuration \
  --function-name internal-nbx-pr-processor-lambda \
  --memory-size 2048
```

## Próximos Pasos de Desarrollo

1. **Completar FASE 2**: Función procesador con Bedrock básico
2. **Testing end-to-end**: Flujo completo GitHub → Comments  
3. **Implementar FASE 3**: LangGraph agent inteligente
4. **Optimización**: Cache, batch processing, cost optimization
5. **Productización**: Secrets management, monitoring avanzado

---

**Nota**: Este proyecto sigue los estándares arquitectónicos definidos en ARCHITECTURAL_STANDARDS.md. Cualquier cambio debe mantener consistencia con dichos estándares.