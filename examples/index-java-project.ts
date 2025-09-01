#!/usr/bin/env node

/**
 * Example: How to index a Java project with PatchBot
 * 
 * This example shows how to:
 * 1. Set up the dependency indexer
 * 2. Index a Java project
 * 3. Query the index for dependency analysis
 */

import { IndexBuilder } from '../src/dependency-indexer/core/IndexBuilder.js';
import { DependencyIndexLoader } from '../src/dependency-indexer/core/DependencyIndexLoader.js';
import { LocalFileStorage } from '../src/dependency-indexer/storage/StorageAdapter.js';
import { JavaStrategy } from '../src/dependency-indexer/strategies/JavaStrategy.js';

async function indexJavaProject() {
    console.log('🚀 PatchBot Java Indexing Example\n');

    // 1. Set up storage (can be local or S3)
    const storage = new LocalFileStorage('./indexes');
    console.log('✅ Storage configured: Local file system');

    // 2. Create index builder and register Java strategy
    const indexBuilder = new IndexBuilder(storage);
    indexBuilder.registerStrategy('java', new JavaStrategy());
    console.log('✅ Java strategy registered');

    // 3. Index your Java project
    const repoPath = process.argv[2] || '.';
    const repoName = process.argv[3] || 'my-java-project';
    
    console.log(`\n📊 Indexing project: ${repoName}`);
    console.log(`📁 Project path: ${repoPath}`);
    
    const index = await indexBuilder.buildIndex(repoPath, repoName);
    
    // 4. Load the index for querying
    console.log('\n🔍 Loading index for analysis...');
    const loader = new DependencyIndexLoader(storage);
    await loader.loadIndex(repoName);
    
    // 5. Analyze dependencies
    console.log('\n📈 Dependency Analysis Results:');
    const stats = loader.getStats();
    console.log(`   📦 Total Classes: ${stats.totalClasses}`);
    console.log(`   🔗 Total Dependencies: ${stats.totalDependencies}`);
    console.log(`   📄 Total Files: ${stats.totalFiles}`);
    console.log(`   🌐 Languages: ${stats.languages.join(', ')}`);
    console.log(`   ⚡ Load Time: ${stats.loadTimeMs}ms`);

    // 6. Example: Find classes and their dependencies
    const allClasses = Object.keys(index.index.classes);
    if (allClasses.length > 0) {
        console.log('\n🔍 Class Analysis Examples:');
        
        const exampleClass = allClasses[0];
        console.log(`\n   📋 Analyzing class: ${exampleClass}`);
        
        const classInfo = loader.findClass(exampleClass);
        if (classInfo) {
            console.log(`      - Package: ${classInfo.package}`);
            console.log(`      - Public Methods: ${classInfo.publicMethods.length}`);
            console.log(`      - Dependencies: ${classInfo.dependencies.join(', ')}`);
            
            // Show method details
            if (classInfo.publicMethods.length > 0) {
                console.log('      - Methods:');
                classInfo.publicMethods.slice(0, 3).forEach(method => {
                    console.log(`        * ${method.signature}`);
                });
                if (classInfo.publicMethods.length > 3) {
                    console.log(`        ... and ${classInfo.publicMethods.length - 3} more`);
                }
            }
        }

        // 7. Example: Impact analysis
        const impact = loader.analyzeImpact(exampleClass);
        console.log(`\n   🎯 Impact Analysis for ${exampleClass}:`);
        console.log(`      - Direct Dependents: ${impact.directDependents.length}`);
        console.log(`      - Affected Files: ${impact.affectedFiles.length}`);
        console.log(`      - Total Impact Score: ${impact.totalImpact}`);
        
        if (impact.directDependents.length > 0) {
            console.log('      - Classes that depend on this:');
            impact.directDependents.forEach(dep => {
                console.log(`        * ${dep}`);
            });
        }
    }

    // 8. Example: Find files by language
    const javaFiles = loader.findFilesByLanguage('java');
    console.log(`\n📁 Java Files Found: ${javaFiles.length}`);
    if (javaFiles.length <= 5) {
        javaFiles.forEach(file => console.log(`   - ${file}`));
    } else {
        javaFiles.slice(0, 3).forEach(file => console.log(`   - ${file}`));
        console.log(`   ... and ${javaFiles.length - 3} more files`);
    }

    console.log('\n✅ Indexing and analysis complete!');
    console.log('\n💡 Next steps:');
    console.log('   1. Integrate with your PR workflow');
    console.log('   2. Set up breaking changes detection');
    console.log('   3. Deploy to AWS Lambda with S3 storage');
}

// Run the example
indexJavaProject().catch(console.error);