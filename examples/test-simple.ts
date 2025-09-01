#!/usr/bin/env ts-node-esm

/**
 * Script para probar el flujo del PR Processor con datos reales de GitHub
 * Usa las clases TypeScript del proyecto
 */

import { GitHubAdapter } from './src/pr-processor/adapters/githubAdapter.js';
import { AIAnalyzer } from './src/pr-processor/core/aiAnalyzer.js';

import type { 
    ServiceConfig, 
    FileChange, 
    AIAnalysisResult
} from './src/shared/types/index.js';

// 🏳️ FEATURE FLAGS - Cambiar estos valores para probar
const FEATURE_FLAGS = {
    POST_COMMENTS_TO_GITHUB: false,  // true = publica comentarios reales, false = solo muestra en consola
    DEBUG_MODE: true,                 // true = logs detallados, false = logs mínimos
    LIMIT_FILES_FOR_TESTING: 3,       // Limitar archivos para testing rápido
    USE_REAL_BEDROCK: true            // true = llama a Bedrock real, false = simula respuesta
};

console.log('🏳️ Feature Flags configurados:', FEATURE_FLAGS);

// Logger simple compatible con el proyecto
const logger = {
    info: (msg: string, data?: any) => {
        if (FEATURE_FLAGS.DEBUG_MODE) console.log('ℹ️', msg, data || '');
    },
    warn: (msg: string, data?: any) => console.log('⚠️', msg, data || ''),
    error: (msg: string, data?: any) => console.log('❌', msg, data || ''),
    debug: (msg: string, data?: any) => {
        if (FEATURE_FLAGS.DEBUG_MODE) console.log('🐛', msg, data || '');
    }
};

// Mock de métricas para compatibilidad
const metrics = {
    addMetric: (name: string, unit: string, value: number) => {
        if (FEATURE_FLAGS.DEBUG_MODE) {
            console.log(`📊 Métrica: ${name} = ${value} ${unit}`);
        }
    },
    addMetadata: (key: string, value: any) => {
        if (FEATURE_FLAGS.DEBUG_MODE) {
            console.log(`📊 Metadata: ${key} = ${value}`);
        }
    },
    publishStoredMetrics: () => {}
};

// Configuración de prueba
const TEST_CONFIG = {
    repository: 'nubox-spa/sas-banking-bff',
    prNumber: 62,
    githubToken: process.env.GITHUB_TOKEN || 'YOUR_GITHUB_TOKEN_HERE' // Use environment variable
};

// Configurar variables de entorno necesarias
process.env.GITHUB_TOKEN = TEST_CONFIG.githubToken;
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.REVIEW_JOBS_TABLE = process.env.REVIEW_JOBS_TABLE || 'test-review-jobs';
process.env.NODE_ENV = 'test';

// Función para convertir números de línea del diff a números reales del archivo
function convertDiffLineToFileLine(patch: string | undefined, diffLineNumber: number): number | null {
    if (!patch || !diffLineNumber) return null;
    
    const lines = patch.split('\n');
    let currentFileLine = 0;
    let currentDiffLine = 0;
    let inDiffContent = false;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Línea de header del diff (@@ -x,y +a,b @@)
        if (line.startsWith('@@')) {
            const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
            if (match) {
                currentFileLine = parseInt(match[1]); // Línea inicial del archivo nuevo
                inDiffContent = true;
                currentDiffLine = 0; // Resetear contador del diff
            }
            continue;
        }
        
        // Si no estamos en contenido del diff, saltar
        if (!inDiffContent) continue;
        
        // Incrementar contador de líneas del diff (todas las líneas dentro del chunk)
        currentDiffLine++;
        
        // Si encontramos la línea del diff que buscamos
        if (currentDiffLine === diffLineNumber) {
            // Si es una línea eliminada, no tiene número en el archivo nuevo
            if (line.startsWith('-')) {
                return null;
            }
            // Para líneas agregadas o sin cambios, devolver el número actual
            return currentFileLine;
        }
        
        // Actualizar el número de línea del archivo según el tipo de línea
        if (line.startsWith('-')) {
            // Líneas eliminadas no incrementan el contador del archivo nuevo
            continue;
        } else if (line.startsWith('+') || line.startsWith(' ')) {
            // Líneas agregadas o sin cambios incrementan el contador
            currentFileLine++;
        }
    }
    
    return null;
}

// Función para crear comentario de resumen
function createSummaryComment(analysisResult: AIAnalysisResult): string {
    const { analysis } = analysisResult;
    const riskEmoji = analysis.riskLevel === 'high' ? '🔴' : analysis.riskLevel === 'medium' ? '🟡' : '🟢';
    
    return `## 🤖 Revisión Automática de PR

${riskEmoji} **Nivel de Riesgo:** ${analysis.riskLevel.toUpperCase()}
📊 **Puntuación:** ${analysis.score}/100

### Resumen
${analysis.summary}

### Estadísticas
- **Issues encontrados:** ${analysis.issues.length}
  - Críticos: ${analysis.issues.filter(i => i.severity === 'critical').length}
  - Altos: ${analysis.issues.filter(i => i.severity === 'high').length}
  - Medios: ${analysis.issues.filter(i => i.severity === 'medium').length}
  - Bajos: ${analysis.issues.filter(i => i.severity === 'low').length}
- **Sugerencias de mejora:** ${analysis.suggestions.length}

---
*Esta revisión fue generada automáticamente por PR Revisor IA con Claude 3.5 Sonnet*`;
}

async function testPRProcessor(): Promise<void> {
    console.log('🧪 Iniciando test del PR Processor...\n');
    console.log('📦 Configuración del test:');
    console.log(`   - Repositorio: ${TEST_CONFIG.repository}`);
    console.log(`   - PR Number: ${TEST_CONFIG.prNumber}`);
    console.log(`   - AWS Region: ${process.env.AWS_REGION}`);
    console.log(`   - Límite de archivos: ${FEATURE_FLAGS.LIMIT_FILES_FOR_TESTING}`);
    console.log('');

    try {
        // 1. Crear adaptadores usando las clases del proyecto
        console.log('📦 Inicializando componentes...');
        
        // GitHub Adapter
        const githubAdapter = new GitHubAdapter({ 
            logger 
        } as ServiceConfig);
        
        // AI Analyzer (requiere Bedrock configurado)
        const aiAnalyzer = new AIAnalyzer({ 
            logger,
            metrics 
        } as ServiceConfig);

        console.log('✅ Componentes inicializados\n');

        // 2. Obtener datos del PR desde GitHub
        console.log('🔍 Obteniendo datos del PR desde GitHub...');
        
        const prData = await githubAdapter.getPullRequest(
            TEST_CONFIG.repository,
            TEST_CONFIG.prNumber
        );

        console.log('✅ Datos del PR obtenidos:');
        console.log(`   - Título: ${prData.title}`);
        console.log(`   - Autor: ${prData.user.login}`);
        console.log(`   - Estado: ${prData.state}`);
        console.log(`   - Archivos cambiados: ${prData.changed_files}`);
        console.log(`   - Adiciones: +${prData.additions}`);
        console.log(`   - Eliminaciones: -${prData.deletions}\n`);

        // 3. Obtener archivos modificados
        console.log('📁 Obteniendo archivos modificados...');
        
        let fileChanges = await githubAdapter.getFileChanges(
            TEST_CONFIG.repository,
            TEST_CONFIG.prNumber
        );

        console.log(`✅ Se encontraron ${fileChanges.length} archivos modificados`);

        // Aplicar límite de archivos si está configurado
        if (FEATURE_FLAGS.LIMIT_FILES_FOR_TESTING && fileChanges.length > FEATURE_FLAGS.LIMIT_FILES_FOR_TESTING) {
            console.log(`🚀 Limitando a ${FEATURE_FLAGS.LIMIT_FILES_FOR_TESTING} archivos para testing rápido`);
            fileChanges = fileChanges.slice(0, FEATURE_FLAGS.LIMIT_FILES_FOR_TESTING);
        }

        // Mostrar archivos que se van a analizar
        console.log('\n📋 Archivos a analizar:');
        fileChanges.forEach((file, i) => {
            console.log(`   ${i + 1}. ${file.filename}`);
            console.log(`      - Estado: ${file.status}`);
            console.log(`      - Cambios: +${file.additions} -${file.deletions}`);
            if (file.patch && FEATURE_FLAGS.DEBUG_MODE) {
                const patchLines = file.patch.split('\n').slice(0, 3);
                console.log(`      - Patch preview:`);
                patchLines.forEach(line => console.log(`        ${line}`));
                if (file.patch.split('\n').length > 3) {
                    console.log(`        ... (${file.patch.split('\n').length - 3} líneas más)`);
                }
            }
        });
        console.log('');

        // 4. Job ID simulado (sin persistencia)
        const jobId = `test-job-${Date.now()}`;
        console.log(`📝 Job ID de prueba (sin persistencia): ${jobId}\n`);

        // 5. Preparar datos para análisis con IA
        if (FEATURE_FLAGS.USE_REAL_BEDROCK) {
            console.log('🤖 Ejecutando análisis con AWS Bedrock (Claude 3.5 Sonnet)...');
            
            try {
                const analysisRequest = {
                    jobId,
                    repository: TEST_CONFIG.repository,
                    prNumber: TEST_CONFIG.prNumber,
                    sha: prData.head.sha,
                    prData: {
                        repository: TEST_CONFIG.repository,
                        prNumber: TEST_CONFIG.prNumber,
                        action: 'opened' as const,
                        sha: prData.head.sha,
                        title: prData.title,
                        author: prData.user.login,
                        githubDeliveryId: null,
                        prUrl: prData.html_url
                    },
                    fileChanges
                };

                const analysisResult = await aiAnalyzer.analyzeCode(analysisRequest);
                
                console.log('✅ Análisis completado!\n');
                
                // Mostrar resultados del análisis
                console.log('🎯 RESULTADO DEL ANÁLISIS:');
                console.log('========================');
                console.log(`📊 Score: ${analysisResult.analysis.score}/100`);
                console.log(`⚠️  Nivel de riesgo: ${analysisResult.analysis.riskLevel}`);
                console.log(`📝 Resumen: ${analysisResult.analysis.summary}`);
                console.log(`⏱️  Tiempo de procesamiento: ${analysisResult.processingTime}ms`);
                
                // Mostrar issues encontrados
                if (analysisResult.analysis.issues.length > 0) {
                    console.log(`\n🐛 ISSUES ENCONTRADOS (${analysisResult.analysis.issues.length}):`);
                    console.log('================================');
                    
                    analysisResult.analysis.issues.forEach((issue, i) => {
                        console.log(`\n${i + 1}. [${issue.severity.toUpperCase()}] ${issue.type}`);
                        console.log(`   📁 Archivo: ${issue.file || 'N/A'}`);
                        console.log(`   📍 Línea: ${issue.line || 'N/A'}`);
                        console.log(`   📝 ${issue.description}`);
                        if (issue.suggestion) {
                            console.log(`   💡 Sugerencia: ${issue.suggestion}`);
                        }
                    });
                } else {
                    console.log('\n✅ No se encontraron issues');
                }

                // Mostrar sugerencias
                if (analysisResult.analysis.suggestions.length > 0) {
                    console.log(`\n💡 SUGERENCIAS DE MEJORA (${analysisResult.analysis.suggestions.length}):`);
                    console.log('====================================');
                    
                    analysisResult.analysis.suggestions.forEach((suggestion, i) => {
                        console.log(`\n${i + 1}. [${suggestion.type.toUpperCase()}]`);
                        console.log(`   📁 Archivo: ${suggestion.file || 'N/A'}`);
                        console.log(`   📍 Línea: ${suggestion.line || 'N/A'}`);
                        console.log(`   📝 ${suggestion.description}`);
                        if (suggestion.code) {
                            console.log(`   📄 Código sugerido:\n      ${suggestion.code}`);
                        }
                    });
                } else {
                    console.log('\n📋 No hay sugerencias adicionales');
                }

                // 6. Publicar comentarios en GitHub (si está habilitado)
                if (FEATURE_FLAGS.POST_COMMENTS_TO_GITHUB) {
                    console.log('\n📤 PUBLICANDO COMENTARIOS EN GITHUB...');
                    console.log('=====================================');
                    
                    // Crear comentario de resumen
                    const summaryComment = createSummaryComment(analysisResult);
                    
                    try {
                        await githubAdapter.createReviewComment(
                            TEST_CONFIG.repository,
                            TEST_CONFIG.prNumber,
                            { body: summaryComment }
                        );
                        console.log('✅ Comentario de resumen publicado');
                        
                        // Publicar comentarios específicos por issue crítico
                        const criticalIssues = analysisResult.analysis.issues.filter(
                            i => i.severity === 'high' || i.severity === 'critical'
                        );
                        
                        for (const issue of criticalIssues) {
                            if (issue.file && issue.line) {
                                const issueComment = {
                                    body: `**${issue.type.toUpperCase()} - ${issue.severity.toUpperCase()}**\n\n${issue.description}${issue.suggestion ? '\n\n**Sugerencia:**\n' + issue.suggestion : ''}`,
                                    path: issue.file,
                                    line: issue.line
                                };
                                
                                await githubAdapter.createReviewComment(
                                    TEST_CONFIG.repository,
                                    TEST_CONFIG.prNumber,
                                    issueComment
                                );
                                console.log(`✅ Comentario publicado en ${issue.file}:${issue.line}`);
                            }
                        }
                        
                    } catch (error) {
                        if (error instanceof Error) {
                            console.error('❌ Error publicando comentarios:', error.message);
                        }
                    }
                } else {
                    console.log('\n📤 SIMULACIÓN DE COMENTARIOS (no se envían a GitHub):');
                    console.log('====================================================');
                    console.log('🏳️ Feature flag POST_COMMENTS_TO_GITHUB = false');
                    console.log('📝 Los siguientes comentarios SE ENVIARÍAN:');
                    console.log(`   - 1 comentario de resumen general`);
                    
                    const criticalCount = analysisResult.analysis.issues.filter(
                        i => i.severity === 'high' || i.severity === 'critical'
                    ).length;
                    
                    if (criticalCount > 0) {
                        console.log(`   - ${criticalCount} comentarios en líneas específicas (issues críticos)`);
                    }
                    
                    // Mostrar preview del comentario de resumen
                    console.log('\n📄 Preview del comentario de resumen:');
                    console.log('------------------------------------');
                    console.log(createSummaryComment(analysisResult));
                    console.log('------------------------------------');
                    
                    console.log('\n✅ Simulación completada - ningún comentario fue enviado');
                }

                // Job completado (sin persistencia)
                console.log(`\n✅ Análisis completado para job ID: ${jobId}`);

            } catch (error) {
                if (error instanceof Error) {
                    console.error('❌ Error en análisis con Bedrock:', error.message);
                    console.log('💡 Asegúrate de tener AWS configurado correctamente');
                    console.log('   - AWS_REGION configurada');
                    console.log('   - Credenciales AWS válidas');
                    console.log('   - Permisos para Bedrock:InvokeModel');
                }
            }
        } else {
            console.log('🤖 SIMULACIÓN DE ANÁLISIS (Bedrock deshabilitado)');
            console.log('================================================');
            console.log('🏳️ Feature flag USE_REAL_BEDROCK = false');
            console.log('📝 Se simularía el análisis de:');
            console.log(`   - ${fileChanges.length} archivos`);
            console.log(`   - ${fileChanges.reduce((sum, f) => sum + f.additions, 0)} líneas agregadas`);
            console.log(`   - ${fileChanges.reduce((sum, f) => sum + f.deletions, 0)} líneas eliminadas`);
            
            // Simular resultado
            console.log('\n📊 Resultado simulado:');
            console.log('   - Score: 85/100');
            console.log('   - Nivel de riesgo: medium');
            console.log('   - Issues encontrados: 3');
            console.log('   - Sugerencias: 5');
        }

        console.log('\n🎉 Test completado exitosamente!');
        
    } catch (error) {
        if (error instanceof Error) {
            console.error('\n💥 Error en el test:', error.message);
            console.error('📋 Stack trace:', error.stack);
            
            if (error.message.includes('401')) {
                console.error('\n🔐 El token de GitHub no es válido o ha expirado');
            } else if (error.message.includes('404')) {
                console.error('\n🔍 El repositorio o PR no existe');
                console.log(`💡 Verifica que ${TEST_CONFIG.repository}#${TEST_CONFIG.prNumber} sea válido`);
            } else if (error.message.includes('Bedrock')) {
                console.error('\n☁️  Error con AWS Bedrock');
                console.log('💡 Verifica tu configuración AWS y permisos de Bedrock');
            }
        }
        
        process.exit(1);
    }
}

// Ejecutar el test
console.log('🚀 PR Processor Test - Versión TypeScript\n');
console.log('========================================\n');

// Ejecutar directamente
testPRProcessor()
    .then(() => {
        console.log('\n✨ ¡Test finalizado exitosamente!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n💥 Test falló:', error);
        process.exit(1);
    });