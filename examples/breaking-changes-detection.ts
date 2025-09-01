#!/usr/bin/env node

/**
 * Example: Breaking Changes Detection with PatchBot
 * 
 * This example demonstrates how to detect breaking changes
 * between different versions of your code.
 */

import { JavaStrategy } from '../src/dependency-indexer/strategies/JavaStrategy.js';

async function detectBreakingChanges() {
    console.log('🔍 PatchBot Breaking Changes Detection Example\n');

    const javaStrategy = new JavaStrategy();

    // Example: Old version of a Java class
    const oldCode = `
package com.example;

public class UserService {
    public User findById(Long id) {
        return userRepository.findById(id);
    }
    
    public void deleteUser(Long id) {
        userRepository.deleteById(id);
    }
    
    public List<User> getAllUsers() {
        return userRepository.findAll();
    }
}`;

    // Example: New version with breaking changes
    const newCode = `
package com.example;

public class UserService {
    // Method signature changed - BREAKING CHANGE
    public Optional<User> findById(Long id) {
        return userRepository.findById(id);
    }
    
    // Method removed - BREAKING CHANGE  
    // public void deleteUser(Long id) { ... }
    
    public List<User> getAllUsers() {
        return userRepository.findAll();
    }
    
    // New method added - NOT breaking
    public User createUser(UserDto userDto) {
        return userRepository.save(new User(userDto));
    }
}`;

    // Analyze both versions
    console.log('📊 Analyzing old version...');
    const oldFileInfo = {
        path: '/example/UserService.java',
        relativePath: 'src/main/java/com/example/UserService.java',
        content: oldCode.trim(),
        size: oldCode.length,
        lastModified: new Date()
    };
    
    const oldAnalysis = await javaStrategy.analyzeFile(oldFileInfo);
    console.log(`   Found ${oldAnalysis.classes?.length || 0} classes`);
    console.log(`   Found ${oldAnalysis.classes?.[0]?.publicMethods.length || 0} public methods`);

    console.log('\n📊 Analyzing new version...');
    const newFileInfo = {
        ...oldFileInfo,
        content: newCode.trim(),
        size: newCode.length
    };
    
    const newAnalysis = await javaStrategy.analyzeFile(newFileInfo);
    console.log(`   Found ${newAnalysis.classes?.length || 0} classes`);
    console.log(`   Found ${newAnalysis.classes?.[0]?.publicMethods.length || 0} public methods`);

    // Detect breaking changes
    console.log('\n🔍 Detecting breaking changes...');
    const breakingChanges = javaStrategy.detectBreakingChanges(oldAnalysis, newAnalysis);

    if (breakingChanges.length === 0) {
        console.log('✅ No breaking changes detected!');
    } else {
        console.log(`⚠️  Found ${breakingChanges.length} breaking changes:`);
        
        breakingChanges.forEach((change, index) => {
            console.log(`\n   ${index + 1}. ${change.type.toUpperCase()}`);
            console.log(`      📍 Location: ${change.location.file}:${change.location.line}`);
            console.log(`      🔥 Severity: ${change.severity}`);
            console.log(`      📝 Description: ${change.description}`);
            
            if (change.affectedFiles && change.affectedFiles.length > 0) {
                console.log(`      📂 Affected Files: ${change.affectedFiles.join(', ')}`);
            }
        });
    }

    // Show detailed method comparison
    console.log('\n📋 Detailed Method Analysis:');
    const oldClass = oldAnalysis.classes?.[0];
    const newClass = newAnalysis.classes?.[0];
    
    if (oldClass && newClass) {
        console.log(`\n   Old version methods (${oldClass.publicMethods.length}):`);
        oldClass.publicMethods.forEach(method => {
            console.log(`      ✓ ${method.signature}`);
        });
        
        console.log(`\n   New version methods (${newClass.publicMethods.length}):`);
        newClass.publicMethods.forEach(method => {
            const isNew = !oldClass.publicMethods.some(oldMethod => 
                oldMethod.name === method.name && oldMethod.signature === method.signature
            );
            const status = isNew ? '🆕' : '✓';
            console.log(`      ${status} ${method.signature}`);
        });
    }

    console.log('\n💡 Integration Tips:');
    console.log('   1. Run this analysis on every PR');
    console.log('   2. Block PRs with critical breaking changes');
    console.log('   3. Require explicit approval for major breaking changes');
    console.log('   4. Auto-generate migration guides for breaking changes');
}

// Run the example
detectBreakingChanges().catch(console.error);