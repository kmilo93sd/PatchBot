// =============================================================================
// S3 STORAGE ADAPTER - DEPENDENCY INDEXER
// =============================================================================

import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { StorageAdapter } from './StorageAdapter.js';
import type { DependencyIndex } from '../types/DependencyTypes.js';

// =============================================================================
// S3 STORAGE CLASS
// =============================================================================

export class S3Storage implements StorageAdapter {
    private s3Client: S3Client;
    private bucketName: string;

    constructor(bucketName?: string) {
        this.bucketName = bucketName || process.env.DEPENDENCY_INDEX_BUCKET || 'dependency-indices';
        this.s3Client = new S3Client({
            region: process.env.AWS_REGION || 'us-east-1'
        });
    }

    // =============================================================================
    // SAVE INDEX TO S3
    // =============================================================================

    async save(key: string, index: DependencyIndex): Promise<void> {
        const s3Key = `${key}/latest.json`;
        
        try {
            const command = new PutObjectCommand({
                Bucket: this.bucketName,
                Key: s3Key,
                Body: JSON.stringify(index, null, 2),
                ContentType: 'application/json',
                Metadata: {
                    repository: index.repository,
                    lastUpdated: index.lastUpdated,
                    language: index.language
                }
            });

            await this.s3Client.send(command);
            
            // También guardar una versión con timestamp para histórico
            const timestampKey = `${key}/history/${new Date().toISOString().split('T')[0]}.json`;
            const historyCommand = new PutObjectCommand({
                Bucket: this.bucketName,
                Key: timestampKey,
                Body: JSON.stringify(index, null, 2),
                ContentType: 'application/json'
            });
            
            await this.s3Client.send(historyCommand);
            
            console.log(`✅ Index saved to S3: ${s3Key}`);
        } catch (error) {
            console.error(`❌ Error saving index to S3: ${error}`);
            throw error;
        }
    }

    // =============================================================================
    // LOAD INDEX FROM S3
    // =============================================================================

    async load(key: string): Promise<DependencyIndex | null> {
        const s3Key = `${key}/latest.json`;
        
        try {
            const command = new GetObjectCommand({
                Bucket: this.bucketName,
                Key: s3Key
            });

            const response = await this.s3Client.send(command);
            
            if (!response.Body) {
                console.warn(`⚠️ No index found for key: ${s3Key}`);
                return null;
            }

            const bodyString = await response.Body.transformToString();
            const index = JSON.parse(bodyString) as DependencyIndex;
            
            console.log(`✅ Index loaded from S3: ${s3Key}`);
            console.log(`📊 Index stats: ${Object.keys(index.index.classes).length} classes, ${Object.keys(index.index.files).length} files`);
            
            return index;
        } catch (error: any) {
            if (error.name === 'NoSuchKey') {
                console.warn(`⚠️ Index not found in S3: ${s3Key}`);
                return null;
            }
            
            console.error(`❌ Error loading index from S3: ${error}`);
            throw error;
        }
    }

    // =============================================================================
    // CHECK IF INDEX EXISTS
    // =============================================================================

    async exists(key: string): Promise<boolean> {
        const s3Key = `${key}/latest.json`;
        
        try {
            const command = new GetObjectCommand({
                Bucket: this.bucketName,
                Key: s3Key
            });

            await this.s3Client.send(command);
            return true;
        } catch (error: any) {
            if (error.name === 'NoSuchKey') {
                return false;
            }
            throw error;
        }
    }

    // =============================================================================
    // DELETE INDEX
    // =============================================================================

    async delete(key: string): Promise<void> {
        const s3Key = `${key}/latest.json`;
        
        try {
            const command = new PutObjectCommand({
                Bucket: this.bucketName,
                Key: s3Key
            });

            await this.s3Client.send(command);
            console.log(`✅ Index deleted from S3: ${s3Key}`);
        } catch (error) {
            console.error(`❌ Error deleting index from S3: ${error}`);
            throw error;
        }
    }
}