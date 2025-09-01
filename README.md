# PatchBot

AI-powered Pull Request reviewer with intelligent dependency analysis and breaking changes detection.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/Node.js->=18.0.0-green.svg)](https://nodejs.org/)
[![AWS Lambda](https://img.shields.io/badge/AWS-Lambda-orange.svg)](https://aws.amazon.com/lambda/)

## Overview

PatchBot is a serverless, asynchronous API that automatically reviews GitHub Pull Requests using AI. The system receives GitHub webhooks, processes PRs in the background with AWS Bedrock (Claude 3.5 Sonnet), and generates intelligent code review comments.

### Key Features

- **Intelligent Code Analysis**: Uses Claude 3.5 Sonnet for comprehensive code review
- **Fast Dependency Graph**: Pre-computed JSON indices for instant dependency analysis
- **Breaking Changes Detection**: Advanced semantic analysis of code modifications
- **Multi-language Support**: Extensible strategy pattern (Java, TypeScript, Python, .NET)
- **Tree-sitter Parsing**: 36x faster AST parsing than traditional methods
- **Serverless Architecture**: AWS Lambda with SQS for async processing
- **Observability**: New Relic integration and structured logging

## Architecture

### Components

- **pr-receptor**: Lambda that receives GitHub webhooks (<3s response)
- **pr-processor**: Lambda that processes PRs with AI using LangChain/LangGraph
- **Dependency Indexer**: Pre-computed repository analysis system
- **Async Pipeline**: SQS + DynamoDB for decoupling
- **AWS Bedrock**: Claude 3.5 Sonnet for code analysis

### Flow

```
GitHub Webhook -> API Gateway -> pr-receptor -> SQS -> pr-processor -> Bedrock -> GitHub Comments
                                                   |
                                            Dependency Index (S3)
```

## Installation

### Prerequisites

- Node.js >= 18.0.0
- AWS CLI configured
- SAM CLI installed
- Java JDK (for Java project analysis)

### Setup

```bash
# Clone repository
git clone https://github.com/kmilo93sd/PatchBot.git
cd PatchBot

# Install dependencies
npm install

# Install layer dependencies
cd layers/aws-sdk-layer/nodejs && npm install && cd ../../..
```

## Development

### Build Commands

```bash
# Build project
npm run build

# Build with SAM
npm run sam:build

# Validate SAM template
sam validate
```

### Local Testing

```bash
# Test receptor function
npm run sam:invoke:receptor

# Test processor function
npm run sam:invoke:processor

# Start local API
npm run sam:local

# Test local endpoint
curl -X POST http://localhost:3000/review-pr \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: pull_request" \
  -d @events/pr-receptor-event.json
```

### Dependency Indexing

```bash
# Test dependency indexer
npm run test:indexer

# Index Java project example
npm run example:index

# Test breaking changes detection
npm run example:breaking
```

### Code Quality

```bash
# Run tests
npm test

# Run linting
npm run lint

# Type checking
npm run typecheck

# Test coverage
npm run test:coverage
```

## Deployment

### Development

```bash
npm run deploy:dev
```

### Production

```bash
npm run deploy:prod
```

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `REVIEW_JOBS_TABLE` | DynamoDB table for jobs | Yes |
| `PR_PROCESS_QUEUE_URL` | SQS queue URL | Yes |
| `AWS_REGION` | AWS region (default: us-east-1) | Yes |
| `NODE_ENV` | Environment (internal/development/production) | Yes |
| `GITHUB_TOKEN` | GitHub API token | Yes |

## Dependency Analysis System

PatchBot includes a sophisticated dependency indexing system that pre-computes repository relationships for instant analysis:

### Features

- **Pre-computed Indices**: JSON-based dependency graphs stored in S3
- **Multi-language Support**: Strategy pattern for different programming languages
- **Breaking Changes Detection**: Semantic analysis of API modifications
- **Tree-sitter Parsing**: Fast, reliable AST parsing
- **Lambda Optimized**: In-memory processing with ephemeral architecture

### Performance

- **7ms** indexing speed for medium Java projects
- **<16ms** load time from S3
- **<10ms** dependency query speed
- **36x faster** than traditional parsers

## AI Analysis

The system uses Claude 3.5 Sonnet via AWS Bedrock for:

- Security vulnerability detection
- Performance issue identification
- Code quality assessment
- Best practices recommendations
- Maintainability analysis

## Monitoring

- **New Relic**: Application performance monitoring
- **CloudWatch**: AWS native monitoring
- **Structured Logging**: JSON-based logs with correlation IDs
- **Custom Metrics**: Business KPIs and performance indicators

## Security

- GitHub webhook signature validation
- IAM roles with minimal permissions
- No secrets in code (environment variables only)
- Secure AWS Bedrock integration

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Support

For support and questions, please open an issue in the [GitHub repository](https://github.com/kmilo93sd/PatchBot/issues).

---

**Built with love using AWS Serverless technologies and Claude AI**