// =============================================================================
// AI ANALYZER - PR PROCESSOR
// =============================================================================

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { fromIni } from '@aws-sdk/credential-providers';

import { BedrockError, ProcessingError } from '../shared/types/errors.js';
import { AWS_CONFIG, AI_CONFIG } from '../shared/constants/index.js';
import { getCurrentTimestamp } from '../shared/utils/index.js';
import { FileValidator } from '../shared/validation/validators.js';

import type { 
  ServiceConfig,
  AIAnalysisRequest,
  AIAnalysisResult,
  CodeIssue,
  CodeSuggestion,
  FileChange
} from '../shared/types/index.js';
import type { DependencyAnalysisResult } from './dependencyAnalyzer.js';

// =============================================================================
// AI ANALYZER CLASS
// =============================================================================

export class AIAnalyzer {
  private readonly logger: ServiceConfig['logger'];
  private readonly metrics: ServiceConfig['metrics'];
  private readonly bedrockClient: BedrockRuntimeClient;

  constructor(config: ServiceConfig) {
    this.logger = config.logger;
    this.metrics = config.metrics;
    
    // Crear cliente Bedrock con perfil internals
    this.bedrockClient = new BedrockRuntimeClient({
      region: AWS_CONFIG.REGION,
      credentials: fromIni({ profile: 'internals' })
    });
  }

  // =============================================================================
  // ANÁLISIS PRINCIPAL
  // =============================================================================

  async analyzeCode(request: AIAnalysisRequest): Promise<AIAnalysisResult> {
    const startTime = Date.now();

    try {
      this.logger.info('Iniciando análisis IA', {
        jobId: request.jobId,
        repository: request.repository,
        prNumber: request.prNumber,
        filesCount: request.fileChanges.length
      });

      // 1. Filtrar archivos válidos para análisis
      const validFiles = this.filterValidFiles(request.fileChanges);
      
      if (validFiles.length === 0) {
        return this.createEmptyAnalysis(request.jobId);
      }

      // 2. Preparar contexto para IA
      const analysisContext = this.prepareAnalysisContext(request, validFiles);

      // 3. Generar prompt para Claude (con contexto de dependencias si está disponible)
      const prompt = this.generatePrompt(analysisContext, request.dependencyContext);

      // 4. Llamar a Bedrock
      const aiResponse = await this.callBedrock(prompt);

      // 5. Parsear respuesta de IA
      const analysisData = this.parseAIResponse(aiResponse);

      // 6. Crear resultado final
      const result: AIAnalysisResult = {
        jobId: request.jobId,
        analysis: {
          summary: analysisData.summary || 'Análisis completado',
          issues: analysisData.issues || [],
          suggestions: analysisData.suggestions || [],
          riskLevel: this.calculateRiskLevel(analysisData.issues || []),
          score: this.calculateScore(analysisData.issues || [], analysisData.suggestions || [])
        },
        processingTime: Date.now() - startTime,
        timestamp: getCurrentTimestamp()
      };

      // 7. Métricas
      this.metrics?.addMetric('BedrockAPICall', 'Count', 1);
      this.metrics?.addMetric('BedrockResponseTime', 'Milliseconds', Date.now() - startTime);

      this.logger.info('Análisis IA completado', {
        jobId: request.jobId,
        issuesFound: result.analysis.issues.length,
        suggestionsCount: result.analysis.suggestions.length,
        riskLevel: result.analysis.riskLevel,
        score: result.analysis.score,
        processingTime: result.processingTime
      });

      return result;

    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      this.logger.error('Error en análisis IA', {
        jobId: request.jobId,
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTime
      });

      this.metrics?.addMetric('BedrockError', 'Count', 1);
      
      throw error;
    }
  }

  // =============================================================================
  // LLAMADA A BEDROCK
  // =============================================================================

  private async callBedrock(prompt: string): Promise<string> {
    try {
      const payload = {
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: AI_CONFIG.MAX_TOKENS,
        temperature: AI_CONFIG.TEMPERATURE,
        top_p: AI_CONFIG.TOP_P,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      };

      const command = new InvokeModelCommand({
        modelId: AI_CONFIG.MODEL_ID,
        body: JSON.stringify(payload),
        contentType: 'application/json'
      });

      this.logger.debug('Llamando a Bedrock', {
        modelId: AI_CONFIG.MODEL_ID,
        promptLength: prompt.length
      });

      const response = await this.bedrockClient.send(command);
      
      if (!response.body) {
        throw new BedrockError('Empty response from Bedrock');
      }

      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      
      if (!responseBody.content || !responseBody.content[0] || !responseBody.content[0].text) {
        throw new BedrockError('Invalid response format from Bedrock');
      }

      return responseBody.content[0].text;

    } catch (error) {
      if (error instanceof BedrockError) {
        throw error;
      }

      throw new BedrockError('Failed to call Bedrock API', {
        originalError: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // =============================================================================
  // UTILIDADES PRIVADAS
  // =============================================================================

  private filterValidFiles(fileChanges: FileChange[]): FileChange[] {
    return fileChanges.filter(file => {
      if (FileValidator.shouldIgnoreFile(file.filename)) {
        return false;
      }

      if (!FileValidator.isSupportedFile(file.filename)) {
        return false;
      }

      return true;
    });
  }

  private prepareAnalysisContext(request: AIAnalysisRequest, validFiles: FileChange[]) {
    return {
      repository: request.repository,
      prNumber: request.prNumber,
      prTitle: request.prData.title,
      prAuthor: request.prData.author,
      totalFiles: validFiles.length,
      totalAdditions: validFiles.reduce((sum, file) => sum + file.additions, 0),
      totalDeletions: validFiles.reduce((sum, file) => sum + file.deletions, 0),
      files: validFiles.slice(0, 10) // Limitar a 10 archivos para no sobrecargar
    };
  }

  private generatePrompt(context: any, dependencyContext?: DependencyAnalysisResult): string {
    let prompt = `Eres un experto revisor de código. Analiza el siguiente Pull Request y proporciona un análisis estructurado.

**Contexto del PR:**
- Repositorio: ${context.repository}
- PR #${context.prNumber}: ${context.prTitle}
- Autor: ${context.prAuthor}
- Archivos modificados: ${context.totalFiles}
- Líneas agregadas: ${context.totalAdditions}
- Líneas eliminadas: ${context.totalDeletions}`;

    // Agregar contexto de dependencias si está disponible
    if (dependencyContext) {
      prompt += `\n\n**Análisis de Dependencias e Impacto:**
- Nivel de riesgo detectado: ${dependencyContext.riskLevel}
- Breaking changes detectados: ${dependencyContext.breakingChanges.length}
- Archivos afectados: ${dependencyContext.affectedFiles.length}
- Clases afectadas: ${dependencyContext.affectedClasses.join(', ') || 'ninguna'}
- Métodos afectados: ${dependencyContext.affectedMethods.join(', ') || 'ninguno'}`;

      if (dependencyContext.breakingChanges.length > 0) {
        prompt += `\n\n**Breaking Changes Detectados:**`;
        dependencyContext.breakingChanges.forEach(bc => {
          prompt += `\n- ${bc.type} (${bc.severity}): ${bc.description}`;
        });
      }

      if (dependencyContext.dependencies.added.length > 0) {
        prompt += `\n\n**Nuevas Dependencias:** ${dependencyContext.dependencies.added.join(', ')}`;
      }

      if (dependencyContext.dependencies.removed.length > 0) {
        prompt += `\n\n**Dependencias Eliminadas:** ${dependencyContext.dependencies.removed.join(', ')}`;
      }

      if (dependencyContext.affectedFiles.length > 0) {
        prompt += `\n\n**Archivos que dependen del código modificado:**\n${dependencyContext.affectedFiles.join('\n')}`;
      }
    }

    prompt += `\n\n**Archivos modificados:**
${context.files.map((file: FileChange) => `
- **${file.filename}** (${file.status})
  - +${file.additions} -${file.deletions}
  ${file.patch ? `\`\`\`diff\n${file.patch.slice(0, 2000)}${file.patch.length > 2000 ? '...' : ''}\n\`\`\`` : ''}
`).join('\n')}

**Instrucciones:**
1. Proporciona un resumen ejecutivo del PR${dependencyContext ? ', considerando el impacto en archivos dependientes' : ''}
2. Identifica issues de código (security, performance, maintainability, bugs, style)${dependencyContext && dependencyContext.breakingChanges.length > 0 ? ', prestando especial atención a los breaking changes detectados' : ''}
3. Sugiere mejoras específicas${dependencyContext ? ' y cómo manejar el impacto en otros archivos' : ''}
4. Responde SOLO en formato JSON válido:

\`\`\`json
{
  "summary": "Resumen ejecutivo del PR en español",
  "issues": [
    {
      "type": "security|performance|maintainability|bug|style",
      "severity": "low|medium|high|critical", 
      "file": "nombre-archivo",
      "line": 123,
      "description": "Descripción del issue",
      "suggestion": "Cómo solucionarlo"
    }
  ],
  "suggestions": [
    {
      "type": "improvement|optimization|refactor|best-practice",
      "file": "nombre-archivo", 
      "line": 123,
      "description": "Descripción de la mejora",
      "code": "código sugerido (opcional)"
    }
  ]
}
\`\`\``;

    return prompt;
  }

  private parseAIResponse(response: string): any {
    try {
      // Extraer JSON de la respuesta (en caso que tenga markdown)
      const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
      const jsonString = jsonMatch?.[1] ?? response.trim();

      return JSON.parse(jsonString);
    } catch (error) {
      this.logger.warn('Error parsing AI response, using fallback', {
        error: error instanceof Error ? error.message : 'Unknown error',
        responsePreview: response?.slice(0, 200) || 'No response'
      });

      // Respuesta de fallback
      return {
        summary: 'Error analizando la respuesta de IA. Se requiere revisión manual.',
        issues: [],
        suggestions: []
      };
    }
  }

  private calculateRiskLevel(issues: CodeIssue[]): 'low' | 'medium' | 'high' {
    const criticalCount = issues.filter(i => i.severity === 'critical').length;
    const highCount = issues.filter(i => i.severity === 'high').length;

    if (criticalCount > 0) return 'high';
    if (highCount >= 3) return 'high';
    if (highCount > 0 || issues.filter(i => i.severity === 'medium').length >= 5) return 'medium';
    
    return 'low';
  }

  private calculateScore(issues: CodeIssue[], suggestions: CodeSuggestion[]): number {
    let score = 100;

    // Restar puntos por issues
    issues.forEach(issue => {
      switch (issue.severity) {
        case 'critical': score -= 20; break;
        case 'high': score -= 10; break;
        case 'medium': score -= 5; break;
        case 'low': score -= 2; break;
      }
    });

    // Pequeño bonus por sugerencias (código proactivo)
    score += Math.min(suggestions.length * 2, 10);

    return Math.max(0, Math.min(100, score));
  }

  private createEmptyAnalysis(jobId: string): AIAnalysisResult {
    return {
      jobId,
      analysis: {
        summary: 'No hay archivos válidos para analizar.',
        issues: [],
        suggestions: [],
        riskLevel: 'low',
        score: 100
      },
      processingTime: 0,
      timestamp: getCurrentTimestamp()
    };
  }
}