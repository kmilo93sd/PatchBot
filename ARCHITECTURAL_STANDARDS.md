# Estándares Arquitectónicos y Guía de Desarrollo
## Agente Serverless con AWS SAM

Este documento define los estándares, convenciones y mejores prácticas para crear agentes serverless siguiendo la arquitectura del proyecto nbx-scope-slack-agent.

## 1. Estructura del Proyecto

### 1.1 Organización de Directorios

```
proyecto/
├── src/                           # Código fuente de funciones Lambda
│   ├── [nombre-función]/          # Una carpeta por función
│   │   ├── app.js                 # Punto de entrada principal
│   │   ├── package.json           # Dependencias específicas de la función
│   │   └── [módulos]/             # Módulos adicionales organizados
│   │       ├── config/            # Configuraciones
│   │       ├── core/              # Lógica principal
│   │       ├── adapters/          # Adaptadores externos
│   │       ├── tools/             # Herramientas modulares
│   │       └── utils/             # Utilidades compartidas
├── layers/                        # Capas Lambda compartidas
│   └── [nombre-layer]/
│       └── nodejs/
│           └── package.json       # Dependencias de la capa
├── events/                        # Eventos de prueba local
│   └── [función]-event.json      # Un archivo por función
├── tests/                         # Tests unitarios e integración
├── scripts/                       # Scripts de utilidad
├── template.yml                   # Template SAM principal
├── samconfig.toml                 # Configuración de despliegue SAM
├── CLAUDE.md                      # Instrucciones para Claude Code
└── README.md                      # Documentación del proyecto
```

### 1.2 Convenciones de Nomenclatura Empresarial

#### Funciones Lambda (template.yml)
- **Formato en Template**: `[Dominio][Acción]Function`
- **Nombre Real en AWS**: `!Join ["-", [!Ref envName, "nbx", "[nombre-función]", "lambda"]]`
- **Ejemplos**:
  ```yaml
  LLMAgentFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Join ["-", [!Ref envName, "nbx", "llm-agent", "lambda"]]
      # Resultado: internal-nbx-llm-agent-lambda
  
  SlackEventHandlerFunction:
    Properties:
      FunctionName: !Join ["-", [!Ref envName, "nbx", "slack-event-handler", "lambda"]]
      # Resultado: internal-nbx-slack-event-handler-lambda
  ```

#### Recursos AWS (template.yml)
- **Colas SQS**: 
  - Formato en Template: `[Propósito]Queue`
  - Nombre en AWS: `!Sub "[nombre-queue]-${envName}"`
  - Ejemplos:
    ```yaml
    SlackEventsQueue:
      Properties:
        QueueName: !Sub "slack-events-queue-${envName}"
        # Resultado: slack-events-queue-internal
    ```
  
- **Tablas DynamoDB**: 
  - Formato en Template: `[Entidad]Table`
  - Nombre en AWS: `!Sub "[entidad]-${envName}"`
  - Ejemplos:
    ```yaml
    ConversationHistoryTable:
      Properties:
        TableName: !Sub "conversation-history-${envName}"
        # Resultado: conversation-history-internal
    
    ThreadStateTable:
      Properties:
        TableName: !Sub "thread-state-${envName}"
        # Resultado: thread-state-internal
    ```

- **Capas Lambda**: 
  - Formato en Template: `[Tecnología]Layer`
  - Nombre en AWS: `!Sub "${envName}-[tecnología]-layer"`
  - Ejemplos:
    ```yaml
    AwsSdkLayer:
      Properties:
        LayerName: !Sub "${envName}-aws-sdk-layer"
        # Resultado: internal-aws-sdk-layer
    
    SlackLayer:
      Properties:
        LayerName: !Sub "${envName}-slack-layer"
        # Resultado: internal-slack-layer
    ```

- **Roles IAM**: `[Función]Role`
- **Políticas IAM**: `[Función][Recurso]Policy`

#### Nomenclatura de Stack
- El nombre del stack debe seguir el patrón definido en samconfig.toml
- Típicamente: `[proyecto]-[característica]-[ambiente]`
- Ejemplo: `nbx-scope-slack-agent-production`

#### Archivos y Módulos
- **Archivos JavaScript**: camelCase (`messageProcessor.js`)
- **Herramientas**: `[dominio][Acción]Tool.js`
  - Ejemplos: `companyInfoTool.js`, `workflowExecutorTool.js`
- **Configuraciones**: `[aspecto]Config.js`
  - Ejemplos: `modelConfig.js`, `toolsConfig.js`

## 2. Arquitectura de Pipeline Asíncrono

### 2.1 Patrón de Comunicación

Implementar un pipeline asíncrono usando SQS para desacoplar componentes:

```
Entrada → Handler → Cola SQS → Procesador → Cola SQS → Siguiente Etapa
```

#### Estructura de Mensaje SQS Estándar

```javascript
{
  requestId: 'uuid-v4',           // ID único de rastreo
  timestamp: 'ISO-8601',           // Timestamp del evento
  source: 'nombre-función-origen', // Identificador del origen
  payload: {                      // Datos específicos del dominio
    // ...
  },
  metadata: {                      // Metadatos opcionales
    retryCount: 0,
    correlationId: 'uuid-v4'
  }
}
```

### 2.2 Configuración de Funciones Lambda

#### Template Base para Función

```yaml
[NombreFuncion]Function:
  Type: AWS::Serverless::Function
  Properties:
    FunctionName: !Join ["-", [!Ref envName, "nbx", "[nombre-funcion]", "lambda"]]
    CodeUri: src/[nombre-funcion]/
    Handler: app.lambdaHandler  # o newrelic-lambda-wrapper.handler para New Relic
    Runtime: nodejs22.x  # Usar versión más reciente
    Timeout: !Ref LambdaTimeout
    MemorySize: !Ref LambdaMemory
    Architectures:
      - x86_64
    Layers:
      - !Ref [NombreLayer]
      # Layer de New Relic para monitoreo
      - arn:aws:lambda:us-east-1:451483290750:layer:NewRelicNodeJS22X:34
    Environment:
      Variables:
        # Variables estándar de New Relic
        NEW_RELIC_LAMBDA_HANDLER: app.lambdaHandler
        NEW_RELIC_ACCOUNT_ID: !Ref NRAccountId
        NEW_RELIC_TRUSTED_ACCOUNT_KEY: !Ref NRAccountId
        NEW_RELIC_EXTENSION_SEND_FUNCTION_LOGS: true
        NEW_RELIC_EXTENSION_LOG_LEVEL: DEBUG
        NEW_RELIC_SERVERLESS_MODE_ENABLED: true
        # Variables de aplicación
        ENVIRONMENT: !Ref envName
        REQUEST_ID_HEADER: x-request-id
    Policies:
      # Política para obtener licencia de New Relic
      - AWSSecretsManagerGetSecretValuePolicy:
          SecretArn: !ImportValue NewRelicLicenseKeySecret-NewRelic-LicenseKeySecretARN
    Events:
      [NombreEvento]:
        Type: SQS
        Properties:
          Queue: !GetAtt [NombreQueue].Arn
          BatchSize: 10
          FunctionResponseTypes:
            - ReportBatchItemFailures
```

### 2.3 Configuración de Colas SQS

```yaml
[NombreQueue]:
  Type: AWS::SQS::Queue
  Properties:
    QueueName: !Sub "[nombre-queue]-${envName}"
    VisibilityTimeout: 180  # 6x timeout de función
    MessageRetentionPeriod: 1209600  # 14 días
    ReceiveMessageWaitTimeSeconds: 20  # Long polling
    RedrivePolicy:
      deadLetterTargetArn: !GetAtt [NombreDLQ].Arn
      maxReceiveCount: 3

# Dead Letter Queue correspondiente
[NombreDLQ]:
  Type: AWS::SQS::Queue
  Properties:
    QueueName: !Sub "[nombre-queue]-dlq-${envName}"
    MessageRetentionPeriod: 1209600  # 14 días
```

## 3. Gestión de Capas Lambda

### 3.1 Organización de Dependencias

Crear capas específicas por dominio para optimizar cold starts:

```javascript
// layers/[tecnología]-layer/nodejs/package.json
{
  "name": "[tecnología]-layer",
  "version": "1.0.0",
  "description": "Capa de dependencias para [tecnología]",
  "dependencies": {
    // Solo dependencias específicas del dominio
  }
}
```

### 3.2 Template de Capa Lambda

```yaml
[TecnologiaLayer]:
  Type: AWS::Serverless::LayerVersion
  Properties:
    LayerName: !Sub "${envName}-[tecnologia]-layer"
    Description: Layer con las dependencias de [Tecnologia]
    ContentUri: layers/[tecnologia]-layer/
    CompatibleRuntimes:
      - nodejs22.x
    RetentionPolicy: Retain
```

### 3.3 Capas Recomendadas

- **aws-sdk-layer**: Clientes AWS SDK v3
- **logging-layer**: AWS Lambda Powertools
- **[framework]-layer**: Dependencias específicas del framework
- **common-utils-layer**: Utilidades compartidas personalizadas

## 4. Sistema de Herramientas Modulares

### 4.1 Estructura Base de Herramienta

```javascript
// src/[función]/tools/base/baseTool.js
class BaseTool {
  constructor(config = {}) {
    this.config = config;
    this.logger = config.logger;
  }

  get name() {
    throw new Error('name must be implemented');
  }

  get description() {
    throw new Error('description must be implemented');
  }

  get schema() {
    throw new Error('schema must be implemented');
  }

  async execute(params, context) {
    throw new Error('execute must be implemented');
  }

  validateParams(params) {
    // Validación usando schema
  }

  handleError(error, context) {
    this.logger.error(`Error in ${this.name}:`, {
      error: error.message,
      stack: error.stack,
      context
    });
    throw error;
  }
}

module.exports = BaseTool;
```

### 4.2 Implementación de Herramienta

```javascript
// src/[función]/tools/[dominio]/[acción]Tool.js
const BaseTool = require('../base/baseTool');

class [Dominio][Acción]Tool extends BaseTool {
  get name() {
    return '[dominio]_[acción]';
  }

  get description() {
    return 'Descripción clara de la funcionalidad';
  }

  get schema() {
    return {
      type: 'object',
      properties: {
        // Definición de parámetros
      },
      required: ['campo1', 'campo2']
    };
  }

  async execute(params, context) {
    try {
      this.validateParams(params);
      
      // Lógica de ejecución
      
      return {
        success: true,
        data: result
      };
    } catch (error) {
      return this.handleError(error, context);
    }
  }
}

module.exports = [Dominio][Acción]Tool;
```

## 5. Configuración y Variables de Entorno

### 5.1 Gestión Centralizada de Configuración

```javascript
// src/[función]/config/environment.js
module.exports = {
  // Configuración de AWS
  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
    accountId: process.env.AWS_ACCOUNT_ID
  },
  
  // Configuración de la aplicación
  app: {
    environment: process.env.ENVIRONMENT || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',
    requestIdHeader: process.env.REQUEST_ID_HEADER || 'x-request-id'
  },
  
  // Configuración de servicios externos
  services: {
    apiKey: process.env.API_KEY,
    baseUrl: process.env.SERVICE_BASE_URL
  },
  
  // Configuración de base de datos
  database: {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  },
  
  // Configuración de colas
  queues: {
    processingQueue: process.env.PROCESSING_QUEUE_URL,
    responseQueue: process.env.RESPONSE_QUEUE_URL
  }
};
```

### 5.2 Parámetros Estándar en template.yml

#### Parámetros Obligatorios de Empresa

```yaml
Parameters:
  # Parámetro principal de ambiente - SIEMPRE requerido
  envName:
    Type: String
    Description: Nombre del ambiente
    Default: internal
    AllowedValues:
      - internal
      - development
      - staging
      - production
  
  # Parámetros de monitoreo empresarial
  NRAccountId:
    Type: String
    Description: Your New Relic account ID; necessary for distributed tracing.
    Default: "3357944"  # ID corporativo de New Relic
  
  deployedVersion:
    Type: String
    Default: 1.0.0
    Description: Versión del despliegue
  
  # Parámetros de VPC para funciones que requieren acceso a BD
  VpcId:
    Type: AWS::EC2::VPC::Id
    Description: ID de la VPC "internal" donde se ejecutará la función
  
  PrivateSubnets:
    Type: List<AWS::EC2::Subnet::Id>
    Description: Lista de subredes privadas donde se ejecutará la función
  
  # Parámetros de configuración de Lambda
  LambdaMemory:
    Type: Number
    Default: 512
    Description: Memoria asignada a Lambda (MB)
    MinValue: 128
    MaxValue: 10240
  
  LambdaTimeout:
    Type: Number
    Default: 180
    Description: Timeout de Lambda (segundos)
```

#### Variables de Entorno Globales

```yaml
Globals:
  Function:
    Environment:
      Variables:
        NODE_ENV: !Ref envName
        DEPLOYED_VERSION: !Ref deployedVersion
        NODE_OPTIONS: --enable-source-maps
        LOG_LEVEL: info
        LOG_FORMAT: json
        ENABLE_REQUEST_LOGGING: true
        LOG_SAMPLE_RATE: 1.0
        POWERTOOLS_SERVICE_NAME: [nombre-servicio]
        POWERTOOLS_METRICS_NAMESPACE: [NombreServicioEnPascalCase]
```

## 6. Gestión de Memoria y Contexto

### 6.1 Gestión de Historial de Conversación

```javascript
// src/[función]/core/memory.js
class ConversationMemory {
  constructor(config) {
    this.maxMessages = config.maxMessages || 10;
    this.ttlDays = config.ttlDays || 90;
    this.dynamoClient = config.dynamoClient;
  }

  async getConversationHistory(conversationId, limit) {
    // Implementar ventana deslizante
    const params = {
      TableName: process.env.CONVERSATION_TABLE,
      KeyConditionExpression: 'conversationId = :id',
      ExpressionAttributeValues: {
        ':id': conversationId
      },
      Limit: limit || this.maxMessages,
      ScanIndexForward: false  // Más recientes primero
    };
    
    return await this.dynamoClient.query(params);
  }

  async saveMessage(message) {
    const ttl = Math.floor(Date.now() / 1000) + (this.ttlDays * 86400);
    
    const params = {
      TableName: process.env.CONVERSATION_TABLE,
      Item: {
        ...message,
        ttl: ttl
      }
    };
    
    return await this.dynamoClient.put(params);
  }
}
```

## 7. Manejo de Errores y Logging

### 7.1 Patrón de Manejo de Errores

```javascript
// src/[función]/utils/errorHandler.js
class ErrorHandler {
  static handle(error, context) {
    const errorResponse = {
      requestId: context.requestId,
      timestamp: new Date().toISOString(),
      error: {
        type: error.constructor.name,
        message: error.message,
        code: error.code || 'UNKNOWN_ERROR'
      }
    };

    // Log estructurado
    console.error(JSON.stringify({
      level: 'ERROR',
      ...errorResponse,
      stack: error.stack
    }));

    // Determinar si reintentable
    if (this.isRetryable(error)) {
      throw error;  // SQS reintentará
    }

    return errorResponse;
  }

  static isRetryable(error) {
    const retryableCodes = [
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ThrottlingException',
      'ProvisionedThroughputExceededException'
    ];
    
    return retryableCodes.includes(error.code);
  }
}
```

### 7.2 Logging Estructurado

```javascript
// src/[función]/utils/logger.js
const { Logger } = require('@aws-lambda-powertools/logger');

class StructuredLogger {
  constructor(serviceName) {
    this.logger = new Logger({
      serviceName,
      logLevel: process.env.LOG_LEVEL || 'info'
    });
  }

  addContext(context) {
    this.logger.addPersistentLogAttributes({
      requestId: context.requestId,
      correlationId: context.correlationId
    });
  }

  info(message, data = {}) {
    this.logger.info(message, data);
  }

  error(message, error, data = {}) {
    this.logger.error(message, {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      },
      ...data
    });
  }
}
```

## 8. Testing

### 8.1 Estructura de Tests

```javascript
// tests/unit/[función]/[módulo].test.js
const { handler } = require('../../../src/[función]/app');
const { mockClient } = require('aws-sdk-client-mock');

describe('[Función] Handler', () => {
  let mockDynamoDB;
  
  beforeEach(() => {
    mockDynamoDB = mockClient(DynamoDBClient);
    process.env.ENVIRONMENT = 'test';
  });

  afterEach(() => {
    mockDynamoDB.restore();
    jest.clearAllMocks();
  });

  test('should process valid event successfully', async () => {
    // Arrange
    const event = require('../../../events/[función]-event.json');
    
    // Act
    const result = await handler(event);
    
    // Assert
    expect(result.statusCode).toBe(200);
  });
});
```

### 8.2 Eventos de Prueba Local

```json
// events/[función]-event.json
{
  "Records": [
    {
      "messageId": "test-message-id",
      "body": "{\"requestId\":\"test-request\",\"payload\":{}}",
      "attributes": {
        "ApproximateReceiveCount": "1"
      },
      "messageAttributes": {
        "requestId": {
          "stringValue": "test-request",
          "dataType": "String"
        }
      }
    }
  ]
}
```

## 9. Configuración VPC para Acceso a Base de Datos

### 9.1 Configuración de Función en VPC

```yaml
LLMAgentFunction:
  Type: AWS::Serverless::Function
  Properties:
    VpcConfig:
      SecurityGroupIds:
        - !Ref LambdaSecurityGroup
      SubnetIds: !Ref PrivateSubnetIds
    # Resto de propiedades...

LambdaSecurityGroup:
  Type: AWS::EC2::SecurityGroup
  Properties:
    GroupDescription: Security group for Lambda functions
    VpcId: !Ref VpcId
    SecurityGroupEgress:
      - IpProtocol: tcp
        FromPort: 443
        ToPort: 443
        CidrIp: 0.0.0.0/0  # HTTPS
      - IpProtocol: tcp
        FromPort: 5432
        ToPort: 5432
        CidrIp: 10.0.0.0/16  # PostgreSQL (ajustar CIDR)
```

## 10. Integración con Servicios Externos

### 10.1 Patrón de Adaptador

```javascript
// src/[función]/adapters/[servicio]Adapter.js
class [Servicio]Adapter {
  constructor(config) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.timeout = config.timeout || 30000;
    this.retryAttempts = config.retryAttempts || 3;
  }

  async request(method, endpoint, data = null) {
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'X-Request-ID': this.generateRequestId()
      },
      timeout: this.timeout
    };

    if (data) {
      options.body = JSON.stringify(data);
    }

    return await this.executeWithRetry(
      () => fetch(`${this.baseUrl}${endpoint}`, options)
    );
  }

  async executeWithRetry(fn, attempt = 1) {
    try {
      return await fn();
    } catch (error) {
      if (attempt < this.retryAttempts && this.isRetryable(error)) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.executeWithRetry(fn, attempt + 1);
      }
      throw error;
    }
  }
}
```

## 11. DynamoDB - Diseño de Tablas

### 11.1 Tabla de Historial de Conversación

```yaml
ConversationHistoryTable:
  Type: AWS::DynamoDB::Table
  Properties:
    TableName: !Sub "conversation-history-${envName}"
    BillingMode: PAY_PER_REQUEST
    AttributeDefinitions:
      - AttributeName: conversationId
        AttributeType: S
      - AttributeName: timestamp
        AttributeType: N
      - AttributeName: userId
        AttributeType: S
    KeySchema:
      - AttributeName: conversationId
        KeyType: HASH
      - AttributeName: timestamp
        KeyType: RANGE
    GlobalSecondaryIndexes:
      - IndexName: UserIdIndex
        KeySchema:
          - AttributeName: userId
            KeyType: HASH
          - AttributeName: timestamp
            KeyType: RANGE
        Projection:
          ProjectionType: ALL
    TimeToLiveSpecification:
      AttributeName: ttl
      Enabled: true
    StreamSpecification:
      StreamViewType: NEW_AND_OLD_IMAGES
```

## 12. Scripts de Desarrollo

### 12.1 Script de Despliegue

```bash
#!/bin/bash
# scripts/deploy.sh

set -e

ENVIRONMENT=${1:-development}
STACK_NAME="agente-${ENVIRONMENT}"

echo "Validando template..."
sam validate

echo "Construyendo aplicación..."
sam build

echo "Desplegando a ${ENVIRONMENT}..."
if [ "$ENVIRONMENT" == "production" ]; then
    sam deploy \
        --stack-name $STACK_NAME \
        --parameter-overrides Environment=$ENVIRONMENT \
        --no-confirm-changeset \
        --capabilities CAPABILITY_IAM
else
    sam deploy \
        --stack-name $STACK_NAME \
        --parameter-overrides Environment=$ENVIRONMENT \
        --capabilities CAPABILITY_IAM
fi

echo "Despliegue completado!"
```

### 12.2 Script de Testing Local

```bash
#!/bin/bash
# scripts/test-local.sh

FUNCTION_NAME=$1
EVENT_FILE=${2:-"events/${FUNCTION_NAME}-event.json"}

if [ -z "$FUNCTION_NAME" ]; then
    echo "Uso: ./test-local.sh [NombreFunción] [archivo-evento-opcional]"
    exit 1
fi

echo "Probando función: $FUNCTION_NAME"
echo "Con evento: $EVENT_FILE"

sam local invoke $FUNCTION_NAME \
    --event $EVENT_FILE \
    --env-vars env.json \
    --docker-network host
```

## 13. Monitoreo y Observabilidad

### 13.1 Métricas Personalizadas

```javascript
// src/[función]/utils/metrics.js
const { Metrics } = require('@aws-lambda-powertools/metrics');

class CustomMetrics {
  constructor(namespace, serviceName) {
    this.metrics = new Metrics({
      namespace,
      serviceName
    });
  }

  recordLatency(operation, duration) {
    this.metrics.addMetric(
      `${operation}Latency`,
      'Milliseconds',
      duration
    );
  }

  recordSuccess(operation) {
    this.metrics.addMetric(
      `${operation}Success`,
      'Count',
      1
    );
  }

  recordError(operation, errorType) {
    this.metrics.addMetadata('errorType', errorType);
    this.metrics.addMetric(
      `${operation}Error`,
      'Count',
      1
    );
  }

  publish() {
    this.metrics.publishStoredMetrics();
  }
}
```

### 13.2 Rastreo Distribuido

```javascript
// src/[función]/utils/tracer.js
const { Tracer } = require('@aws-lambda-powertools/tracer');

const tracer = new Tracer({
  serviceName: process.env.SERVICE_NAME
});

// Uso en handler
exports.handler = tracer.captureLambdaHandler(async (event, context) => {
  const segment = tracer.getSegment();
  
  // Agregar anotaciones
  segment.addAnnotation('requestId', context.requestId);
  
  // Capturar llamadas AWS SDK
  const dynamodb = tracer.captureAWSv3Client(new DynamoDBClient({}));
  
  // Lógica del handler
});
```

## 14. Seguridad

### 14.1 Gestión de Secretos

```yaml
# En template.yml
SecretsPolicy:
  Type: AWS::IAM::Policy
  Properties:
    PolicyDocument:
      Statement:
        - Effect: Allow
          Action:
            - secretsmanager:GetSecretValue
          Resource: !Sub 'arn:aws:secretsmanager:${AWS::Region}:${AWS::AccountId}:secret:${AWS::StackName}/*'
```

```javascript
// src/[función]/utils/secrets.js
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

class SecretsManager {
  constructor() {
    this.client = new SecretsManagerClient();
    this.cache = new Map();
  }

  async getSecret(secretName) {
    if (this.cache.has(secretName)) {
      return this.cache.get(secretName);
    }

    const command = new GetSecretValueCommand({
      SecretId: secretName
    });

    const response = await this.client.send(command);
    const secret = JSON.parse(response.SecretString);
    
    this.cache.set(secretName, secret);
    return secret;
  }
}
```

### 14.2 Validación de Entrada

```javascript
// src/[función]/utils/validator.js
const Ajv = require('ajv');

class InputValidator {
  constructor() {
    this.ajv = new Ajv({ allErrors: true });
  }

  validate(schema, data) {
    const validate = this.ajv.compile(schema);
    const valid = validate(data);
    
    if (!valid) {
      throw new ValidationError(
        'Invalid input',
        validate.errors
      );
    }
    
    return true;
  }
}

class ValidationError extends Error {
  constructor(message, errors) {
    super(message);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}
```

## 15. CLAUDE.md - Plantilla

```markdown
# CLAUDE.md

Este archivo proporciona orientación a Claude Code cuando trabaja con código en este repositorio.

## Descripción General del Proyecto

[Descripción breve del proyecto y su propósito]

## Arquitectura

[Descripción de la arquitectura y componentes principales]

## Tareas Comunes de Desarrollo

### Comandos de Construcción y Despliegue

\`\`\`bash
# Construir el proyecto
sam build

# Desplegar
sam deploy

# Pruebas locales
sam local invoke [FunctionName] --event events/[function]-event.json
\`\`\`

### Gestión de Dependencias

[Instrucciones para actualizar dependencias]

## Convenciones del Proyecto

- Responder siempre en español
- Seguir nomenclatura establecida en template.yml
- Validar template antes de desplegar
- Mantener consistencia con el código existente

## Puntos Críticos

[Lista de aspectos importantes a considerar]
```

## 16. Checklist de Implementación

### Para Nuevo Proyecto

- [ ] Crear estructura de directorios según estándar
- [ ] Configurar template.yml con nomenclatura correcta
- [ ] Implementar pipeline asíncrono con SQS
- [ ] Crear capas Lambda necesarias
- [ ] Configurar variables de entorno y parámetros
- [ ] Implementar logging estructurado
- [ ] Configurar rastreo de requestId
- [ ] Crear eventos de prueba local
- [ ] Documentar en CLAUDE.md
- [ ] Configurar scripts de despliegue
- [ ] Implementar manejo de errores consistente
- [ ] Configurar TTL en tablas DynamoDB
- [ ] Validar permisos IAM mínimos necesarios

### Para Nueva Función Lambda

- [ ] Crear directorio en src/[nombre-función]
- [ ] Implementar handler con estructura estándar
- [ ] Configurar en template.yml siguiendo convenciones
- [ ] Agregar evento de prueba en events/
- [ ] Implementar logging con requestId
- [ ] Manejar errores correctamente
- [ ] Documentar variables de entorno necesarias
- [ ] Crear tests unitarios básicos

### Para Nueva Herramienta

- [ ] Extender de BaseTool
- [ ] Implementar name, description, schema, execute
- [ ] Agregar configuración en toolsConfig.js
- [ ] Registrar en index.js de herramientas
- [ ] Implementar validación de parámetros
- [ ] Manejar errores con logging apropiado
- [ ] Documentar uso y ejemplos

## 17. Principios de Diseño

1. **Desacoplamiento**: Usar colas SQS entre componentes
2. **Idempotencia**: Funciones deben ser idempotentes
3. **Resiliencia**: Implementar reintentos y manejo de errores
4. **Observabilidad**: Logging estructurado y métricas
5. **Seguridad**: Principio de menor privilegio en IAM
6. **Escalabilidad**: Diseño stateless y uso de servicios administrados
7. **Mantenibilidad**: Código modular y bien documentado
8. **Testabilidad**: Funciones puras y dependencias inyectables

## Notas Finales

Este documento debe evolucionar con el proyecto. Actualizar cuando:
- Se agreguen nuevos patrones o convenciones
- Se identifiquen mejores prácticas
- Se encuentren problemas recurrentes y sus soluciones
- Se integren nuevos servicios o tecnologías