#!/usr/bin/env node

// Script de prueba local para el sistema de indexación

import { IndexBuilder } from './src/dependency-indexer/core/IndexBuilder.js';
import { DependencyIndexLoader } from './src/dependency-indexer/core/DependencyIndexLoader.js';
import { LocalFileStorage } from './src/dependency-indexer/storage/StorageAdapter.js';
import { JavaStrategy } from './src/dependency-indexer/strategies/JavaStrategy.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function testIndexer() {
    console.log('🚀 Iniciando prueba del sistema de indexación\n');

    // 1. Configurar storage local
    const storage = new LocalFileStorage(path.join(__dirname, 'indexes'));
    
    // 2. Crear IndexBuilder y registrar estrategias
    const indexBuilder = new IndexBuilder(storage);
    indexBuilder.registerStrategy('java', new JavaStrategy());
    
    // 3. Crear un proyecto Java de prueba
    await createTestJavaProject();
    
    // 4. Indexar el proyecto de prueba
    const testRepoPath = path.join(__dirname, 'test-java-project');
    const testRepoName = 'test-java-project';
    
    console.log('\n📚 Fase 1: Indexación\n');
    const index = await indexBuilder.buildIndex(testRepoPath, testRepoName);
    
    // 5. Probar el loader
    console.log('\n🔍 Fase 2: Carga y Consultas\n');
    const loader = new DependencyIndexLoader(storage);
    await loader.loadIndex(testRepoName);
    
    // 6. Ejecutar consultas de prueba
    console.log('\n📊 Fase 3: Análisis de Dependencias\n');
    
    // Buscar clase MovementService
    const movementService = loader.findClass('MovementService');
    if (movementService) {
        console.log('✅ Clase encontrada: MovementService');
        console.log(`   - Métodos públicos: ${movementService.publicMethods.length}`);
        console.log(`   - Dependencias: ${movementService.dependencies.join(', ')}`);
    }
    
    // Analizar impacto
    const impact = loader.analyzeImpact('MovementService');
    console.log('\n🎯 Análisis de impacto para MovementService:');
    console.log(`   - Dependientes directos: ${impact.directDependents.length}`);
    console.log(`   - Archivos afectados: ${impact.affectedFiles.length}`);
    console.log(`   - Impacto total: ${impact.totalImpact} clases`);
    
    // Estadísticas generales
    const stats = loader.getStats();
    console.log('\n📈 Estadísticas del índice:');
    console.log(`   - Total de clases: ${stats.totalClasses}`);
    console.log(`   - Total de dependencias: ${stats.totalDependencies}`);
    console.log(`   - Total de archivos: ${stats.totalFiles}`);
    console.log(`   - Tiempo de carga: ${stats.loadTimeMs}ms`);
    
    console.log('\n✅ Prueba completada exitosamente!');
}

async function createTestJavaProject() {
    const fs = await import('fs/promises');
    const testDir = path.join(__dirname, 'test-java-project');
    const srcDir = path.join(testDir, 'src', 'main', 'java', 'com', 'example');
    
    // Crear estructura de directorios
    await fs.mkdir(srcDir, { recursive: true });
    
    // Crear archivo MovementService.java
    const movementServiceContent = `package com.example;

import java.util.List;
import java.util.Optional;

public class MovementService {
    private final MovementRepository repository;
    private final EventPublisher eventPublisher;
    
    public MovementService(MovementRepository repository, EventPublisher eventPublisher) {
        this.repository = repository;
        this.eventPublisher = eventPublisher;
    }
    
    public Movement createMovement(String description, Double amount) {
        Movement movement = new Movement(description, amount);
        repository.save(movement);
        eventPublisher.publish(new MovementCreatedEvent(movement));
        return movement;
    }
    
    public Optional<Movement> findById(Long id) {
        return repository.findById(id);
    }
    
    public List<Movement> findAll() {
        return repository.findAll();
    }
    
    public void deleteMovement(Long id) {
        repository.deleteById(id);
        eventPublisher.publish(new MovementDeletedEvent(id));
    }
}`;
    
    await fs.writeFile(
        path.join(srcDir, 'MovementService.java'),
        movementServiceContent
    );
    
    // Crear archivo MovementRepository.java
    const repositoryContent = `package com.example;

import java.util.List;
import java.util.Optional;

public interface MovementRepository {
    void save(Movement movement);
    Optional<Movement> findById(Long id);
    List<Movement> findAll();
    void deleteById(Long id);
}`;
    
    await fs.writeFile(
        path.join(srcDir, 'MovementRepository.java'),
        repositoryContent
    );
    
    // Crear archivo Movement.java
    const movementContent = `package com.example;

public class Movement {
    private Long id;
    private String description;
    private Double amount;
    
    public Movement(String description, Double amount) {
        this.description = description;
        this.amount = amount;
    }
    
    public Long getId() {
        return id;
    }
    
    public String getDescription() {
        return description;
    }
    
    public Double getAmount() {
        return amount;
    }
}`;
    
    await fs.writeFile(
        path.join(srcDir, 'Movement.java'),
        movementContent
    );
    
    // Crear archivo EventPublisher.java
    const eventPublisherContent = `package com.example;

public interface EventPublisher {
    void publish(Object event);
}`;
    
    await fs.writeFile(
        path.join(srcDir, 'EventPublisher.java'),
        eventPublisherContent
    );
    
    // Crear eventos
    const createdEventContent = `package com.example;

public class MovementCreatedEvent {
    private final Movement movement;
    
    public MovementCreatedEvent(Movement movement) {
        this.movement = movement;
    }
    
    public Movement getMovement() {
        return movement;
    }
}`;
    
    await fs.writeFile(
        path.join(srcDir, 'MovementCreatedEvent.java'),
        createdEventContent
    );
    
    const deletedEventContent = `package com.example;

public class MovementDeletedEvent {
    private final Long movementId;
    
    public MovementDeletedEvent(Long movementId) {
        this.movementId = movementId;
    }
    
    public Long getMovementId() {
        return movementId;
    }
}`;
    
    await fs.writeFile(
        path.join(srcDir, 'MovementDeletedEvent.java'),
        deletedEventContent
    );
    
    console.log('✅ Proyecto Java de prueba creado en:', testDir);
}

// Ejecutar la prueba
testIndexer().catch(console.error);