# Guía de Despliegue - Sistema de Índice de Dependencias

## Descripción General

Esta guía proporciona instrucciones detalladas para desplegar el Sistema de Índice de Dependencias con ChromaDB en entornos AWS. El despliegue incluye configuración de infraestructura, servicios administrados de AWS, y la integración completa con ChromaDB.

## Pre-requisitos

### Herramientas Requeridas

```bash
# Verificar versiones mínimas
aws --version          # >= 2.0.0
sam --version          # >= 1.100.0
docker --version       # >= 20.0.0
terraform --version    # >= 1.0.0 (opcional)
node --version         # >= 18.0.0
```

### Configuración AWS

```bash
# Configurar credenciales AWS
aws configure set aws_access_key_id YOUR_ACCESS_KEY
aws configure set aws_secret_access_key YOUR_SECRET_KEY
aws configure set default.region us-east-1

# Verificar permisos
aws sts get-caller-identity
aws iam get-user
```

### Permisos IAM Requeridos

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudformation:*",
        "lambda:*",
        "iam:*",
        "s3:*",
        "dynamodb:*",
        "sqs:*",
        "apigateway:*",
        "logs:*",
        "ec2:*",
        "ecs:*",
        "secretsmanager:*",
        "ssm:*"
      ],
      "Resource": "*"
    }
  ]
}
```

## Arquitectura de Despliegue

### Componentes Principales

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   GitHub API    │    │   API Gateway    │    │   ChromaDB      │
│                 │    │                  │    │   Cluster       │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
    ┌─────────────────────────────────────────────────────────────┐
    │                  Lambda Functions                          │
    │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐    │
    │  │  Indexer    │  │  Analyzer   │  │    Updater      │    │
    │  └─────────────┘  └─────────────┘  └─────────────────┘    │
    └─────────────────────────────────────────────────────────────┘
         │                       │                       │
    ┌─────────────────────────────────────────────────────────────┐
    │                    SQS Queues                              │
    │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐    │
    │  │Index Queue  │  │Analysis Q   │  │  Update Queue   │    │
    │  └─────────────┘  └─────────────┘  └─────────────────┘    │
    └─────────────────────────────────────────────────────────────┘
         │                       │                       │
    ┌─────────────────────────────────────────────────────────────┐
    │              Storage & Monitoring                          │
    │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐    │
    │  │ DynamoDB    │  │     S3      │  │  CloudWatch     │    │
    │  └─────────────┘  └─────────────┘  └─────────────────┘    │
    └─────────────────────────────────────────────────────────────┘
```

## Fase 1: Infraestructura Base

### 1.1 Configuración de ChromaDB

#### Opción A: ChromaDB en ECS (Recomendado para Producción)

Crear `infrastructure/chromadb-ecs.yaml`:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: ChromaDB ECS Cluster for Dependency Index System

Parameters:
  Environment:
    Type: String
    Default: production
    AllowedValues: [internal, development, staging, production]
  
  ChromaDBVersion:
    Type: String
    Default: "0.4.15"
    Description: ChromaDB Docker image version
  
  InstanceType:
    Type: String
    Default: t3.large
    Description: EC2 instance type for ECS cluster
  
  MinCapacity:
    Type: Number
    Default: 1
    MinValue: 1
    MaxValue: 10
  
  MaxCapacity:
    Type: Number
    Default: 3
    MinValue: 1
    MaxValue: 20

  VpcId:
    Type: AWS::EC2::VPC::Id
    Description: VPC for ChromaDB deployment
  
  PrivateSubnetIds:
    Type: List<AWS::EC2::Subnet::Id>
    Description: Private subnets for ChromaDB instances

Resources:
  # EFS for persistent storage
  ChromaDBFileSystem:
    Type: AWS::EFS::FileSystem
    Properties:
      CreationToken: !Sub "chromadb-${Environment}"
      PerformanceMode: generalPurpose
      ThroughputMode: provisioned
      ProvisionedThroughputInMibps: 100
      Encrypted: true
      FileSystemTags:
        - Key: Name
          Value: !Sub "chromadb-${Environment}"
        - Key: Environment
          Value: !Ref Environment

  ChromaDBMountTargets:
    Type: AWS::EFS::MountTarget
    Properties:
      FileSystemId: !Ref ChromaDBFileSystem
      SubnetId: !Select [0, !Ref PrivateSubnetIds]
      SecurityGroups:
        - !Ref ChromaDBEFSSecurityGroup

  ChromaDBEFSSecurityGroup:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: Security group for ChromaDB EFS
      VpcId: !Ref VpcId
      SecurityGroupIngress:
        - IpProtocol: tcp
          FromPort: 2049
          ToPort: 2049
          SourceSecurityGroupId: !Ref ChromaDBSecurityGroup

  # ECS Cluster
  ChromaDBCluster:
    Type: AWS::ECS::Cluster
    Properties:
      ClusterName: !Sub "chromadb-cluster-${Environment}"
      CapacityProviders:
        - EC2
        - FARGATE
      DefaultCapacityProviderStrategy:
        - CapacityProvider: EC2
          Weight: 1
          Base: 1

  # Task Definition
  ChromaDBTaskDefinition:
    Type: AWS::ECS::TaskDefinition
    Properties:
      Family: !Sub "chromadb-${Environment}"
      NetworkMode: awsvpc
      RequiresCompatibilities:
        - EC2
      Cpu: 2048
      Memory: 4096
      ExecutionRoleArn: !Ref ChromaDBExecutionRole
      TaskRoleArn: !Ref ChromaDBTaskRole
      ContainerDefinitions:
        - Name: chromadb
          Image: !Sub "ghcr.io/chroma-core/chroma:${ChromaDBVersion}"
          Memory: 4096
          MemoryReservation: 3072
          Essential: true
          PortMappings:
            - ContainerPort: 8000
              HostPort: 8000
              Protocol: tcp
          Environment:
            - Name: CHROMA_SERVER_AUTH_PROVIDER
              Value: chromadb.auth.token.TokenAuthServerProvider
            - Name: CHROMA_SERVER_AUTH_TOKEN_TRANSPORT_HEADER
              Value: X-Chroma-Token
            - Name: CHROMA_SERVER_HOST
              Value: 0.0.0.0
            - Name: CHROMA_SERVER_HTTP_PORT
              Value: "8000"
            - Name: CHROMA_SERVER_CORS_ALLOW_ORIGINS
              Value: "*"
          Secrets:
            - Name: CHROMA_SERVER_AUTH_CREDENTIALS
              ValueFrom: !Ref ChromaDBAuthSecret
          MountPoints:
            - SourceVolume: chromadb-data
              ContainerPath: /chroma/chroma
              ReadOnly: false
          LogConfiguration:
            LogDriver: awslogs
            Options:
              awslogs-group: !Ref ChromaDBLogGroup
              awslogs-region: !Ref AWS::Region
              awslogs-stream-prefix: chromadb
          HealthCheck:
            Command:
              - CMD-SHELL
              - "curl -f http://localhost:8000/api/v1/heartbeat || exit 1"
            Interval: 30
            Timeout: 10
            Retries: 3
            StartPeriod: 60
      Volumes:
        - Name: chromadb-data
          EFSVolumeConfiguration:
            FileSystemId: !Ref ChromaDBFileSystem
            RootDirectory: /
            TransitEncryption: ENABLED
            AuthorizationConfig:
              AccessPointId: !Ref ChromaDBAccessPoint

  ChromaDBAccessPoint:
    Type: AWS::EFS::AccessPoint
    Properties:
      FileSystemId: !Ref ChromaDBFileSystem
      PosixUser:
        Uid: 1000
        Gid: 1000
      RootDirectory:
        Path: "/chromadb"
        CreationInfo:
          OwnerUid: 1000
          OwnerGid: 1000
          Permissions: 755

  # ECS Service
  ChromaDBService:
    Type: AWS::ECS::Service
    DependsOn: ChromaDBTargetGroup
    Properties:
      ServiceName: !Sub "chromadb-service-${Environment}"
      Cluster: !Ref ChromaDBCluster
      TaskDefinition: !Ref ChromaDBTaskDefinition
      DesiredCount: !Ref MinCapacity
      LaunchType: EC2
      NetworkConfiguration:
        AwsvpcConfiguration:
          SecurityGroups:
            - !Ref ChromaDBSecurityGroup
          Subnets: !Ref PrivateSubnetIds
          AssignPublicIp: DISABLED
      LoadBalancers:
        - ContainerName: chromadb
          ContainerPort: 8000
          TargetGroupArn: !Ref ChromaDBTargetGroup
      DeploymentConfiguration:
        MinimumHealthyPercent: 50
        MaximumPercent: 200
      EnableExecuteCommand: true

  # Application Load Balancer
  ChromaDBLoadBalancer:
    Type: AWS::ElasticLoadBalancingV2::LoadBalancer
    Properties:
      Name: !Sub "chromadb-alb-${Environment}"
      Scheme: internal
      Type: application
      SecurityGroups:
        - !Ref ChromaDBLoadBalancerSecurityGroup
      Subnets: !Ref PrivateSubnetIds
      Tags:
        - Key: Name
          Value: !Sub "chromadb-alb-${Environment}"

  ChromaDBTargetGroup:
    Type: AWS::ElasticLoadBalancingV2::TargetGroup
    Properties:
      Name: !Sub "chromadb-tg-${Environment}"
      Port: 8000
      Protocol: HTTP
      VpcId: !Ref VpcId
      TargetType: ip
      HealthCheckPath: /api/v1/heartbeat
      HealthCheckIntervalSeconds: 30
      HealthCheckTimeoutSeconds: 10
      HealthyThresholdCount: 2
      UnhealthyThresholdCount: 3
      TargetGroupAttributes:
        - Key: deregistration_delay.timeout_seconds
          Value: "60"

  ChromaDBListener:
    Type: AWS::ElasticLoadBalancingV2::Listener
    Properties:
      LoadBalancerArn: !Ref ChromaDBLoadBalancer
      Port: 8000
      Protocol: HTTP
      DefaultActions:
        - Type: forward
          TargetGroupArn: !Ref ChromaDBTargetGroup

  # Auto Scaling
  ChromaDBAutoScalingTarget:
    Type: AWS::ApplicationAutoScaling::ScalableTarget
    Properties:
      MaxCapacity: !Ref MaxCapacity
      MinCapacity: !Ref MinCapacity
      ResourceId: !Sub "service/${ChromaDBCluster}/${ChromaDBService.Name}"
      RoleARN: !Sub "arn:aws:iam::${AWS::AccountId}:role/aws-service-role/ecs.application-autoscaling.amazonaws.com/AWSServiceRoleForApplicationAutoScaling_ECSService"
      ScalableDimension: ecs:service:DesiredCount
      ServiceNamespace: ecs

  ChromaDBScalingPolicy:
    Type: AWS::ApplicationAutoScaling::ScalingPolicy
    Properties:
      PolicyName: !Sub "chromadb-scaling-policy-${Environment}"
      PolicyType: TargetTrackingScaling
      ScalingTargetId: !Ref ChromaDBAutoScalingTarget
      TargetTrackingScalingPolicyConfiguration:
        TargetValue: 70.0
        PredefinedMetricSpecification:
          PredefinedMetricType: ECSServiceAverageCPUUtilization
        ScaleOutCooldown: 300
        ScaleInCooldown: 300

  # Security Groups
  ChromaDBSecurityGroup:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: Security group for ChromaDB containers
      VpcId: !Ref VpcId
      SecurityGroupIngress:
        - IpProtocol: tcp
          FromPort: 8000
          ToPort: 8000
          SourceSecurityGroupId: !Ref ChromaDBLoadBalancerSecurityGroup
      Tags:
        - Key: Name
          Value: !Sub "chromadb-sg-${Environment}"

  ChromaDBLoadBalancerSecurityGroup:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: Security group for ChromaDB load balancer
      VpcId: !Ref VpcId
      SecurityGroupIngress:
        - IpProtocol: tcp
          FromPort: 8000
          ToPort: 8000
          CidrIp: 10.0.0.0/8
          Description: "Allow access from private subnets"
      Tags:
        - Key: Name
          Value: !Sub "chromadb-lb-sg-${Environment}"

  # IAM Roles
  ChromaDBExecutionRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: !Sub "ChromaDB-ExecutionRole-${Environment}"
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              Service: ecs-tasks.amazonaws.com
            Action: sts:AssumeRole
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
      Policies:
        - PolicyName: ChromaDBSecretsAccess
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              - Effect: Allow
                Action:
                  - secretsmanager:GetSecretValue
                Resource:
                  - !Ref ChromaDBAuthSecret

  ChromaDBTaskRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: !Sub "ChromaDB-TaskRole-${Environment}"
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              Service: ecs-tasks.amazonaws.com
            Action: sts:AssumeRole
      Policies:
        - PolicyName: ChromaDBEFSAccess
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              - Effect: Allow
                Action:
                  - elasticfilesystem:ClientMount
                  - elasticfilesystem:ClientWrite
                  - elasticfilesystem:ClientRootAccess
                Resource: !Sub "${ChromaDBFileSystem}/*"

  # Secrets
  ChromaDBAuthSecret:
    Type: AWS::SecretsManager::Secret
    Properties:
      Name: !Sub "chromadb-auth-${Environment}"
      Description: ChromaDB authentication credentials
      GenerateSecretString:
        SecretStringTemplate: '{"username": "admin"}'
        GenerateStringKey: token
        PasswordLength: 32
        ExcludeCharacters: '"@/\'

  # CloudWatch
  ChromaDBLogGroup:
    Type: AWS::Logs::LogGroup
    Properties:
      LogGroupName: !Sub "/ecs/chromadb-${Environment}"
      RetentionInDays: 30

  # CloudWatch Alarms
  ChromaDBHighCPUAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: !Sub "ChromaDB-HighCPU-${Environment}"
      AlarmDescription: ChromaDB high CPU utilization
      MetricName: CPUUtilization
      Namespace: AWS/ECS
      Statistic: Average
      Period: 300
      EvaluationPeriods: 2
      Threshold: 80
      ComparisonOperator: GreaterThanThreshold
      Dimensions:
        - Name: ServiceName
          Value: !Sub "chromadb-service-${Environment}"
        - Name: ClusterName
          Value: !Sub "chromadb-cluster-${Environment}"

  ChromaDBHighMemoryAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: !Sub "ChromaDB-HighMemory-${Environment}"
      AlarmDescription: ChromaDB high memory utilization
      MetricName: MemoryUtilization
      Namespace: AWS/ECS
      Statistic: Average
      Period: 300
      EvaluationPeriods: 2
      Threshold: 85
      ComparisonOperator: GreaterThanThreshold
      Dimensions:
        - Name: ServiceName
          Value: !Sub "chromadb-service-${Environment}"
        - Name: ClusterName
          Value: !Sub "chromadb-cluster-${Environment}"

Outputs:
  ChromaDBEndpoint:
    Description: Internal endpoint for ChromaDB
    Value: !Sub "http://${ChromaDBLoadBalancer.DNSName}:8000"
    Export:
      Name: !Sub "${AWS::StackName}-ChromaDBEndpoint"

  ChromaDBAuthSecretArn:
    Description: ARN of ChromaDB auth secret
    Value: !Ref ChromaDBAuthSecret
    Export:
      Name: !Sub "${AWS::StackName}-AuthSecretArn"

  ChromaDBClusterName:
    Description: Name of ChromaDB ECS cluster
    Value: !Ref ChromaDBCluster
    Export:
      Name: !Sub "${AWS::StackName}-ClusterName"
```

#### Script de Despliegue ChromaDB

```bash
#!/bin/bash
# scripts/deploy-chromadb.sh

set -e

ENVIRONMENT=${1:-internal}
REGION=${2:-us-east-1}
VPC_ID=${3}
PRIVATE_SUBNET_IDS=${4}

if [ -z "$VPC_ID" ] || [ -z "$PRIVATE_SUBNET_IDS" ]; then
  echo "Usage: $0 <environment> <region> <vpc-id> <private-subnet-ids>"
  echo "Example: $0 internal us-east-1 vpc-12345678 subnet-12345678,subnet-87654321"
  exit 1
fi

STACK_NAME="chromadb-${ENVIRONMENT}"

echo "🚀 Deploying ChromaDB infrastructure for ${ENVIRONMENT}..."

# Validate template
echo "📋 Validating CloudFormation template..."
aws cloudformation validate-template \
  --template-body file://infrastructure/chromadb-ecs.yaml \
  --region $REGION

# Deploy infrastructure
echo "☁️ Deploying CloudFormation stack..."
aws cloudformation deploy \
  --template-file infrastructure/chromadb-ecs.yaml \
  --stack-name $STACK_NAME \
  --parameter-overrides \
    Environment=$ENVIRONMENT \
    VpcId=$VPC_ID \
    PrivateSubnetIds=$PRIVATE_SUBNET_IDS \
  --capabilities CAPABILITY_NAMED_IAM \
  --region $REGION \
  --no-fail-on-empty-changeset

# Get outputs
echo "📊 Retrieving stack outputs..."
CHROMADB_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --region $REGION \
  --query 'Stacks[0].Outputs[?OutputKey==`ChromaDBEndpoint`].OutputValue' \
  --output text)

AUTH_SECRET_ARN=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --region $REGION \
  --query 'Stacks[0].Outputs[?OutputKey==`ChromaDBAuthSecretArn`].OutputValue' \
  --output text)

echo "✅ ChromaDB deployment completed!"
echo "📋 Configuration:"
echo "  Endpoint: $CHROMADB_ENDPOINT"
echo "  Auth Secret ARN: $AUTH_SECRET_ARN"

# Test connectivity
echo "🧪 Testing ChromaDB connectivity..."
sleep 60 # Wait for service to be ready

AUTH_TOKEN=$(aws secretsmanager get-secret-value \
  --secret-id $AUTH_SECRET_ARN \
  --region $REGION \
  --query 'SecretString' \
  --output text | jq -r '.token')

# Create test script
cat > test-chromadb.js << 'EOF'
const https = require('https');
const http = require('http');

const endpoint = process.argv[2];
const token = process.argv[3];

const client = endpoint.startsWith('https') ? https : http;
const url = new URL(endpoint + '/api/v1/heartbeat');

const options = {
  hostname: url.hostname,
  port: url.port || (url.protocol === 'https:' ? 443 : 80),
  path: url.pathname,
  method: 'GET',
  headers: {
    'X-Chroma-Token': token
  }
};

const req = client.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  if (res.statusCode === 200) {
    console.log('✅ ChromaDB is healthy');
    process.exit(0);
  } else {
    console.log('❌ ChromaDB health check failed');
    process.exit(1);
  }
});

req.on('error', (error) => {
  console.error('❌ Connection failed:', error.message);
  process.exit(1);
});

req.setTimeout(10000, () => {
  console.error('❌ Request timeout');
  req.destroy();
  process.exit(1);
});

req.end();
EOF

node test-chromadb.js $CHROMADB_ENDPOINT $AUTH_TOKEN

echo "🎉 ChromaDB is ready for use!"
```

### 1.2 Actualización del Template Principal

Actualizar `template.yml` para incluir la integración con ChromaDB:

```yaml
# Agregar parámetros para ChromaDB
Parameters:
  # ... parámetros existentes ...
  
  ChromaDBEndpoint:
    Type: String
    Description: ChromaDB endpoint URL
  
  ChromaDBAuthSecretArn:
    Type: String
    Description: ARN of ChromaDB auth secret

# Actualizar función DependencyIndexerFunction
DependencyIndexerFunction:
  Type: AWS::Serverless::Function
  Properties:
    FunctionName: !Join ["-", [!Ref envName, "nbx", "dependency-indexer", "lambda"]]
    CodeUri: src/dependency-indexer/
    Handler: app.lambdaHandler
    Runtime: nodejs20.x
    Timeout: 900
    MemorySize: 2048
    Layers:
      - !Ref AwsSdkLayer
      - !Ref ChromaDBLayer
    Environment:
      Variables:
        # Variables existentes...
        # Variables ChromaDB
        CHROMADB_ENDPOINT: !Ref ChromaDBEndpoint
        CHROMADB_AUTH_SECRET_ARN: !Ref ChromaDBAuthSecretArn
    Policies:
      # Políticas existentes...
      # Acceso a ChromaDB auth secret
      - AWSSecretsManagerGetSecretValuePolicy:
          SecretArn: !Ref ChromaDBAuthSecretArn
      # Acceso VPC si ChromaDB está en VPC privada
      - VPCAccessPolicy: {}
    # VPC Configuration si es necesario
    VpcConfig:
      SecurityGroupIds:
        - !Ref LambdaSecurityGroup
      SubnetIds:
        - !Ref PrivateSubnetA
        - !Ref PrivateSubnetB

# Security Group para Lambda
LambdaSecurityGroup:
  Type: AWS::EC2::SecurityGroup
  Properties:
    GroupDescription: Security group for Lambda functions
    VpcId: !Ref VpcId
    SecurityGroupEgress:
      - IpProtocol: tcp
        FromPort: 8000
        ToPort: 8000
        CidrIp: 10.0.0.0/8
        Description: "ChromaDB access"
      - IpProtocol: tcp
        FromPort: 443
        ToPort: 443
        CidrIp: 0.0.0.0/0
        Description: "HTTPS outbound"
```

## Fase 2: Despliegue de Funciones Lambda

### 2.1 Configuración de Capas

```bash
# Construir capas Lambda
cd layers/chromadb-layer/nodejs
npm install --production
cd ../../../

# Construir capa de parsers
cd layers/dependency-parsers-layer/nodejs
npm install --production
cd ../../../
```

### 2.2 Despliegue por Ambiente

#### Script de Despliegue Completo

```bash
#!/bin/bash
# scripts/deploy-complete-system.sh

set -e

ENVIRONMENT=${1:-internal}
REGION=${2:-us-east-1}
CHROMADB_ENDPOINT=${3}
CHROMADB_AUTH_SECRET_ARN=${4}

if [ -z "$CHROMADB_ENDPOINT" ] || [ -z "$CHROMADB_AUTH_SECRET_ARN" ]; then
  echo "Usage: $0 <environment> <region> <chromadb-endpoint> <chromadb-auth-secret-arn>"
  exit 1
fi

STACK_NAME="pr-revisor-dependency-index-${ENVIRONMENT}"

echo "🚀 Deploying Dependency Index System for ${ENVIRONMENT}..."

# Validate SAM template
echo "📋 Validating SAM template..."
sam validate

# Build application
echo "🔧 Building application..."
sam build --parallel

# Deploy to AWS
echo "☁️ Deploying to AWS..."
sam deploy \
  --stack-name $STACK_NAME \
  --parameter-overrides \
    envName=$ENVIRONMENT \
    ChromaDBEndpoint=$CHROMADB_ENDPOINT \
    ChromaDBAuthSecretArn=$CHROMADB_AUTH_SECRET_ARN \
  --capabilities CAPABILITY_NAMED_IAM \
  --region $REGION \
  --no-confirm-changeset \
  --no-fail-on-empty-changeset

# Get deployment outputs
echo "📊 Retrieving deployment outputs..."
API_URL=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --region $REGION \
  --query 'Stacks[0].Outputs[?OutputKey==`PRRevisorApiUrl`].OutputValue' \
  --output text)

INDEX_QUEUE_URL=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --region $REGION \
  --query 'Stacks[0].Outputs[?OutputKey==`DependencyIndexQueueUrl`].OutputValue' \
  --output text)

echo "✅ Deployment completed!"
echo "📋 Configuration:"
echo "  API URL: $API_URL"
echo "  Index Queue URL: $INDEX_QUEUE_URL"

# Run post-deployment tests
echo "🧪 Running post-deployment tests..."
./scripts/test-deployment.sh $ENVIRONMENT $REGION

echo "🎉 System is ready for use!"
```

### 2.3 Test de Despliegue

```bash
#!/bin/bash
# scripts/test-deployment.sh

set -e

ENVIRONMENT=${1:-internal}
REGION=${2:-us-east-1}

STACK_NAME="pr-revisor-dependency-index-${ENVIRONMENT}"

echo "🧪 Testing deployment for ${ENVIRONMENT}..."

# Get function names
INDEXER_FUNCTION=$(aws cloudformation describe-stack-resources \
  --stack-name $STACK_NAME \
  --region $REGION \
  --logical-resource-id DependencyIndexerFunction \
  --query 'StackResources[0].PhysicalResourceId' \
  --output text)

ANALYZER_FUNCTION=$(aws cloudformation describe-stack-resources \
  --stack-name $STACK_NAME \
  --region $REGION \
  --logical-resource-id DependencyAnalyzerFunction \
  --query 'StackResources[0].PhysicalResourceId' \
  --output text)

echo "📋 Functions to test:"
echo "  Indexer: $INDEXER_FUNCTION"
echo "  Analyzer: $ANALYZER_FUNCTION"

# Test 1: Basic function invocation
echo "🔧 Testing basic function invocation..."

# Create test event
cat > test-event.json << 'EOF'
{
  "repositoryUrl": "https://github.com/expressjs/express.git",
  "repositoryId": "express-test",
  "indexType": "full"
}
EOF

# Invoke indexer function
echo "  Testing indexer function..."
aws lambda invoke \
  --function-name $INDEXER_FUNCTION \
  --payload file://test-event.json \
  --region $REGION \
  indexer-result.json

# Check result
if grep -q '"statusCode":200' indexer-result.json; then
  echo "  ✅ Indexer function test passed"
else
  echo "  ❌ Indexer function test failed"
  cat indexer-result.json
  exit 1
fi

# Test 2: API Gateway endpoints
echo "🌐 Testing API Gateway endpoints..."

API_URL=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --region $REGION \
  --query 'Stacks[0].Outputs[?OutputKey==`PRRevisorApiUrl`].OutputValue' \
  --output text)

# Test health endpoint (if exists)
if curl -f -s "$API_URL/health" > /dev/null; then
  echo "  ✅ API Gateway health check passed"
else
  echo "  ⚠️ API Gateway health check failed (may not be implemented yet)"
fi

# Test 3: SQS queues
echo "📬 Testing SQS queues..."

QUEUE_URL=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --region $REGION \
  --query 'Stacks[0].Outputs[?OutputKey==`DependencyIndexQueueUrl`].OutputValue' \
  --output text)

# Send test message
aws sqs send-message \
  --queue-url $QUEUE_URL \
  --message-body '{"test": true}' \
  --region $REGION > /dev/null

echo "  ✅ SQS message sent successfully"

# Test 4: DynamoDB tables
echo "🗄️ Testing DynamoDB access..."

TABLE_NAME=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --region $REGION \
  --query 'Stacks[0].Outputs[?OutputKey==`ReviewJobsTableName`].OutputValue' \
  --output text)

# Test table access
aws dynamodb describe-table \
  --table-name $TABLE_NAME \
  --region $REGION > /dev/null

echo "  ✅ DynamoDB table accessible"

# Test 5: ChromaDB connectivity
echo "🔍 Testing ChromaDB connectivity..."

# Get ChromaDB endpoint from Lambda environment
CHROMADB_ENDPOINT=$(aws lambda get-function-configuration \
  --function-name $INDEXER_FUNCTION \
  --region $REGION \
  --query 'Environment.Variables.CHROMADB_ENDPOINT' \
  --output text)

AUTH_SECRET_ARN=$(aws lambda get-function-configuration \
  --function-name $INDEXER_FUNCTION \
  --region $REGION \
  --query 'Environment.Variables.CHROMADB_AUTH_SECRET_ARN' \
  --output text)

# Get auth token
AUTH_TOKEN=$(aws secretsmanager get-secret-value \
  --secret-id $AUTH_SECRET_ARN \
  --region $REGION \
  --query 'SecretString' \
  --output text | jq -r '.token')

# Test ChromaDB health
if curl -f -s -H "X-Chroma-Token: $AUTH_TOKEN" "$CHROMADB_ENDPOINT/api/v1/heartbeat" > /dev/null; then
  echo "  ✅ ChromaDB connectivity test passed"
else
  echo "  ❌ ChromaDB connectivity test failed"
  exit 1
fi

# Cleanup
rm -f test-event.json indexer-result.json

echo "🎉 All deployment tests passed!"
```

## Fase 3: Configuración de Monitoreo

### 3.1 CloudWatch Dashboards

Crear `infrastructure/monitoring.yaml`:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: Monitoring and alerting for Dependency Index System

Parameters:
  Environment:
    Type: String
    Default: production
  
  FunctionNamePrefix:
    Type: String
    Description: Prefix for Lambda function names

Resources:
  # CloudWatch Dashboard
  DependencyIndexDashboard:
    Type: AWS::CloudWatch::Dashboard
    Properties:
      DashboardName: !Sub "DependencyIndex-${Environment}"
      DashboardBody: !Sub |
        {
          "widgets": [
            {
              "type": "metric",
              "x": 0,
              "y": 0,
              "width": 12,
              "height": 6,
              "properties": {
                "metrics": [
                  [ "AWS/Lambda", "Duration", "FunctionName", "${FunctionNamePrefix}-dependency-indexer-lambda" ],
                  [ ".", "Invocations", ".", "." ],
                  [ ".", "Errors", ".", "." ]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": "${AWS::Region}",
                "title": "Indexer Function Metrics",
                "period": 300
              }
            },
            {
              "type": "metric",
              "x": 12,
              "y": 0,
              "width": 12,
              "height": 6,
              "properties": {
                "metrics": [
                  [ "AWS/Lambda", "Duration", "FunctionName", "${FunctionNamePrefix}-dependency-analyzer-lambda" ],
                  [ ".", "Invocations", ".", "." ],
                  [ ".", "Errors", ".", "." ]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": "${AWS::Region}",
                "title": "Analyzer Function Metrics",
                "period": 300
              }
            },
            {
              "type": "metric",
              "x": 0,
              "y": 6,
              "width": 24,
              "height": 6,
              "properties": {
                "metrics": [
                  [ "PRRevisor/ChromaDB", "QueryDuration" ],
                  [ ".", "QueryResultCount" ],
                  [ ".", "CollectionDocumentCount" ]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": "${AWS::Region}",
                "title": "ChromaDB Performance Metrics",
                "period": 300
              }
            }
          ]
        }

  # Alarms
  IndexerHighErrorRate:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: !Sub "DependencyIndexer-HighErrorRate-${Environment}"
      AlarmDescription: High error rate in dependency indexer
      MetricName: ErrorRate
      Namespace: AWS/Lambda
      Statistic: Average
      Period: 300
      EvaluationPeriods: 2
      Threshold: 5
      ComparisonOperator: GreaterThanThreshold
      Dimensions:
        - Name: FunctionName
          Value: !Sub "${FunctionNamePrefix}-dependency-indexer-lambda"
      TreatMissingData: notBreaching

  IndexerHighDuration:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: !Sub "DependencyIndexer-HighDuration-${Environment}"
      AlarmDescription: High duration in dependency indexer
      MetricName: Duration
      Namespace: AWS/Lambda
      Statistic: Average
      Period: 300
      EvaluationPeriods: 2
      Threshold: 600000  # 10 minutes in milliseconds
      ComparisonOperator: GreaterThanThreshold
      Dimensions:
        - Name: FunctionName
          Value: !Sub "${FunctionNamePrefix}-dependency-indexer-lambda"

  ChromaDBHighLatency:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: !Sub "ChromaDB-HighLatency-${Environment}"
      AlarmDescription: High latency in ChromaDB queries
      MetricName: QueryDuration
      Namespace: PRRevisor/ChromaDB
      Statistic: Average
      Period: 300
      EvaluationPeriods: 2
      Threshold: 1000
      ComparisonOperator: GreaterThanThreshold
      TreatMissingData: breaching

  # SNS Topic for alerts
  AlertingTopic:
    Type: AWS::SNS::Topic
    Properties:
      TopicName: !Sub "DependencyIndex-Alerts-${Environment}"
      DisplayName: Dependency Index System Alerts

  AlertingTopicPolicy:
    Type: AWS::SNS::TopicPolicy
    Properties:
      Topics:
        - !Ref AlertingTopic
      PolicyDocument:
        Statement:
          - Effect: Allow
            Principal:
              Service: cloudwatch.amazonaws.com
            Action: sns:Publish
            Resource: !Ref AlertingTopic
```

### 3.2 Logging Avanzado

Crear utilidad de logging estructurado:

```javascript
// src/common/utils/structuredLogger.js
const { Logger } = require('@aws-lambda-powertools/logger');

class DependencyIndexLogger extends Logger {
  constructor(serviceName = 'dependency-index', options = {}) {
    super({
      serviceName,
      logLevel: process.env.LOG_LEVEL || 'info',
      ...options
    });
  }

  logIndexingStart(params) {
    this.info('Indexing started', {
      operation: 'indexing_start',
      repositoryId: params.repositoryId,
      repositoryUrl: params.repositoryUrl,
      indexType: params.indexType,
      options: params.options
    });
  }

  logIndexingComplete(params) {
    this.info('Indexing completed', {
      operation: 'indexing_complete',
      repositoryId: params.repositoryId,
      duration: params.duration,
      dependenciesIndexed: params.dependenciesIndexed,
      codeFragmentsIndexed: params.codeFragmentsIndexed,
      collectionsCreated: params.collectionsCreated
    });
  }

  logChromaDBOperation(operation, params, duration, resultCount) {
    this.info('ChromaDB operation', {
      operation: 'chromadb_operation',
      chromaOperation: operation,
      collectionName: params.collectionName,
      duration,
      resultCount,
      queryType: params.queryType || 'unknown'
    });
  }

  logDependencyAnalysis(params) {
    this.info('Dependency analysis', {
      operation: 'dependency_analysis',
      language: params.language,
      dependencyCount: params.dependencyCount,
      vulnerabilityCount: params.vulnerabilityCount,
      unusedCount: params.unusedCount
    });
  }

  logError(operation, error, context = {}) {
    this.error('Operation failed', {
      operation,
      errorType: error.constructor.name,
      errorMessage: error.message,
      errorStack: error.stack,
      context
    }, error);
  }

  logPerformanceMetric(metric, value, tags = {}) {
    this.info('Performance metric', {
      operation: 'performance_metric',
      metric,
      value,
      tags,
      timestamp: new Date().toISOString()
    });
  }
}

module.exports = DependencyIndexLogger;
```

## Fase 4: Configuración de Seguridad

### 4.1 Secrets Management

```bash
#!/bin/bash
# scripts/setup-secrets.sh

set -e

ENVIRONMENT=${1:-internal}
REGION=${2:-us-east-1}

echo "🔐 Setting up secrets for ${ENVIRONMENT}..."

# GitHub token for repository access
read -s -p "Enter GitHub token: " GITHUB_TOKEN
echo

aws secretsmanager create-secret \
  --name "dependency-index/github-token-${ENVIRONMENT}" \
  --description "GitHub token for dependency indexer" \
  --secret-string "{\"token\":\"$GITHUB_TOKEN\"}" \
  --region $REGION

# ChromaDB auth credentials are created by the ChromaDB stack

# Additional API keys if needed
read -s -p "Enter vulnerability DB API key (optional): " VULN_API_KEY
echo

if [ ! -z "$VULN_API_KEY" ]; then
  aws secretsmanager create-secret \
    --name "dependency-index/vulnerability-api-key-${ENVIRONMENT}" \
    --description "API key for vulnerability database" \
    --secret-string "{\"apiKey\":\"$VULN_API_KEY\"}" \
    --region $REGION
fi

echo "✅ Secrets configured successfully"
```

### 4.2 IAM Policies Granulares

```yaml
# Política mínima para función indexer
DependencyIndexerPolicy:
  Type: AWS::IAM::Policy
  Properties:
    PolicyName: DependencyIndexerMinimalAccess
    PolicyDocument:
      Version: '2012-10-17'
      Statement:
        # ChromaDB access (via VPC/SG, no direct policy needed)
        
        # S3 access for temporary storage
        - Effect: Allow
          Action:
            - s3:GetObject
            - s3:PutObject
            - s3:DeleteObject
          Resource:
            - !Sub "${TempStorageBucket}/*"
        
        # DynamoDB access
        - Effect: Allow
          Action:
            - dynamodb:PutItem
            - dynamodb:UpdateItem
            - dynamodb:GetItem
          Resource:
            - !GetAtt ReviewJobsTable.Arn
        
        # SQS access
        - Effect: Allow
          Action:
            - sqs:SendMessage
          Resource:
            - !GetAtt DependencyIndexQueue.Arn
        
        # Secrets access
        - Effect: Allow
          Action:
            - secretsmanager:GetSecretValue
          Resource:
            - !Ref GitHubTokenSecret
            - !Ref ChromaDBAuthSecret
        
        # CloudWatch Logs
        - Effect: Allow
          Action:
            - logs:CreateLogGroup
            - logs:CreateLogStream
            - logs:PutLogEvents
          Resource:
            - !Sub "arn:aws:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/*"
        
        # VPC access (if needed)
        - Effect: Allow
          Action:
            - ec2:CreateNetworkInterface
            - ec2:DescribeNetworkInterfaces
            - ec2:DeleteNetworkInterface
            - ec2:AttachNetworkInterface
            - ec2:DetachNetworkInterface
          Resource: "*"
    Roles:
      - !Ref DependencyIndexerRole
```

## Comandos de Despliegue Completo

### Script Master de Despliegue

```bash
#!/bin/bash
# scripts/deploy-all.sh

set -e

# Configuration
ENVIRONMENT=${1:-internal}
REGION=${2:-us-east-1}
VPC_ID=${3}
PRIVATE_SUBNETS=${4}

if [ -z "$VPC_ID" ] || [ -z "$PRIVATE_SUBNETS" ]; then
  echo "Usage: $0 <environment> <region> <vpc-id> <private-subnets>"
  echo "Example: $0 production us-east-1 vpc-12345678 subnet-12345,subnet-67890"
  exit 1
fi

echo "🚀 Starting complete deployment for ${ENVIRONMENT}"
echo "================================================="

# Phase 1: Deploy ChromaDB infrastructure
echo "📊 Phase 1: Deploying ChromaDB infrastructure..."
./scripts/deploy-chromadb.sh $ENVIRONMENT $REGION $VPC_ID $PRIVATE_SUBNETS

# Get ChromaDB outputs
CHROMADB_STACK="chromadb-${ENVIRONMENT}"
CHROMADB_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name $CHROMADB_STACK \
  --region $REGION \
  --query 'Stacks[0].Outputs[?OutputKey==`ChromaDBEndpoint`].OutputValue' \
  --output text)

CHROMADB_AUTH_SECRET_ARN=$(aws cloudformation describe-stacks \
  --stack-name $CHROMADB_STACK \
  --region $REGION \
  --query 'Stacks[0].Outputs[?OutputKey==`ChromaDBAuthSecretArn`].OutputValue' \
  --output text)

echo "✅ ChromaDB deployed at: $CHROMADB_ENDPOINT"

# Phase 2: Setup secrets
echo "🔐 Phase 2: Setting up secrets..."
./scripts/setup-secrets.sh $ENVIRONMENT $REGION

# Phase 3: Deploy main application
echo "⚡ Phase 3: Deploying main application..."
./scripts/deploy-complete-system.sh $ENVIRONMENT $REGION $CHROMADB_ENDPOINT $CHROMADB_AUTH_SECRET_ARN

# Phase 4: Deploy monitoring
echo "📈 Phase 4: Deploying monitoring..."
FUNCTION_PREFIX="${ENVIRONMENT}-nbx"
aws cloudformation deploy \
  --template-file infrastructure/monitoring.yaml \
  --stack-name "dependency-index-monitoring-${ENVIRONMENT}" \
  --parameter-overrides \
    Environment=$ENVIRONMENT \
    FunctionNamePrefix=$FUNCTION_PREFIX \
  --region $REGION \
  --no-fail-on-empty-changeset

# Phase 5: Run comprehensive tests
echo "🧪 Phase 5: Running deployment tests..."
./scripts/test-deployment.sh $ENVIRONMENT $REGION

# Phase 6: Initialize ChromaDB collections
echo "🗄️ Phase 6: Initializing ChromaDB collections..."
./scripts/initialize-collections.sh $ENVIRONMENT $REGION

echo ""
echo "🎉 Deployment completed successfully!"
echo "================================================="
echo "📋 Summary:"
echo "  Environment: $ENVIRONMENT"
echo "  Region: $REGION"
echo "  ChromaDB Endpoint: $CHROMADB_ENDPOINT"
echo ""
echo "🔧 Next steps:"
echo "  1. Configure CI/CD pipeline"
echo "  2. Set up monitoring alerts"
echo "  3. Run performance tests"
echo "  4. Begin indexing repositories"
echo ""
echo "📚 Documentation:"
echo "  - Architecture: ARCHITECTURE.md"
echo "  - Testing: TESTING_PLAN.md"
echo "  - Language Support: LANGUAGE_STRATEGIES.md"
```

### Script de Inicialización de Colecciones

```bash
#!/bin/bash
# scripts/initialize-collections.sh

set -e

ENVIRONMENT=${1:-internal}
REGION=${2:-us-east-1}

echo "🗄️ Initializing ChromaDB collections for ${ENVIRONMENT}..."

# Get indexer function name
INDEXER_FUNCTION="${ENVIRONMENT}-nbx-dependency-indexer-lambda"

# Create initialization event
cat > initialize-collections.json << 'EOF'
{
  "action": "initialize",
  "collections": [
    {
      "name": "global-vulnerabilities",
      "purpose": "vulnerability-database",
      "schema": "vulnerability-v1"
    },
    {
      "name": "dependency-patterns",
      "purpose": "common-patterns",
      "schema": "pattern-v1"
    }
  ]
}
EOF

# Invoke function to initialize global collections
aws lambda invoke \
  --function-name $INDEXER_FUNCTION \
  --payload file://initialize-collections.json \
  --region $REGION \
  initialize-result.json

# Check result
if grep -q '"statusCode":200' initialize-result.json; then
  echo "✅ Global collections initialized successfully"
else
  echo "❌ Collection initialization failed"
  cat initialize-result.json
  exit 1
fi

# Cleanup
rm -f initialize-collections.json initialize-result.json

echo "🎉 ChromaDB collections are ready!"
```

## Rollback y Recuperación

### Script de Rollback

```bash
#!/bin/bash
# scripts/rollback.sh

set -e

ENVIRONMENT=${1:-internal}
REGION=${2:-us-east-1}
STACK_VERSION=${3}

if [ -z "$STACK_VERSION" ]; then
  echo "Usage: $0 <environment> <region> <stack-version>"
  echo "Available versions:"
  aws cloudformation list-stacks \
    --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
    --region $REGION \
    --query "StackSummaries[?contains(StackName, 'pr-revisor-dependency-index-${ENVIRONMENT}')].{Name:StackName,Status:StackStatus,Time:LastUpdatedTime}" \
    --output table
  exit 1
fi

echo "⚠️ Rolling back to version ${STACK_VERSION} for ${ENVIRONMENT}"
echo "This will revert the Lambda functions and configurations."
read -p "Are you sure? (yes/no): " -r
if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
  echo "Rollback cancelled"
  exit 1
fi

# Perform rollback
STACK_NAME="pr-revisor-dependency-index-${ENVIRONMENT}"

echo "🔄 Starting rollback..."
aws cloudformation update-stack \
  --stack-name $STACK_NAME \
  --use-previous-template \
  --parameters file://previous-parameters.json \
  --capabilities CAPABILITY_NAMED_IAM \
  --region $REGION

echo "⏳ Waiting for rollback to complete..."
aws cloudformation wait stack-update-complete \
  --stack-name $STACK_NAME \
  --region $REGION

echo "✅ Rollback completed successfully"

# Test rolled back version
./scripts/test-deployment.sh $ENVIRONMENT $REGION

echo "🎉 Rollback verified successfully!"
```

Esta guía de despliegue proporciona un conjunto completo de herramientas y scripts para desplegar el Sistema de Índice de Dependencias con ChromaDB en AWS de manera robusta y escalable.
