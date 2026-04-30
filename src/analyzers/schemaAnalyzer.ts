import * as path from 'path';
/** Implemented by Antigravity (2026-04-26) */
import type { DataEntity } from '../types';

/**
 * SchemaAnalyzer (Tier 4)
 * 
 * Extracts data models and relationships from ORM schemas (Prisma, TypeORM, etc.)
 */
export class SchemaAnalyzer {
    /**
     * Extract entities from Prisma schema files using regex parsing.
     * 
     * @param filePath - Path to the .prisma file.
     * @param content - Text content of the schema file.
     * @returns A list of extracted data entities.
     */
    extractPrismaEntities(filePath: string, content: string): DataEntity[] {
        const entities: DataEntity[] = [];
        
        // Match model blocks
        const modelRegex = /model\s+(\w+)\s+\{([\s\S]*?)\}/g;
        let match;
        
        while ((match = modelRegex.exec(content)) !== null) {
            const [_, modelName, body] = match;
            const fields: DataEntity['fields'] = [];
            const relations: DataEntity['relations'] = [];
            
            const lines = body.split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('//')) continue;
                
                // Match field: name type attributes
                // Example: id Int @id
                const fieldMatch = trimmed.match(/^(\w+)\s+(\w+)(\[\])?(\?)?(\s+@.+)?$/);
                if (fieldMatch) {
                    const [__, fieldName, fieldType, isArray, isOptional] = fieldMatch;
                    
                    // Is it a relation to another model?
                    // Usually if the type starts with an Uppercase letter and isn't a primitive.
                    const isPrimitive = ['String', 'Int', 'Boolean', 'DateTime', 'Float', 'Json', 'Bytes', 'Decimal'].includes(fieldType);
                    
                    if (!isPrimitive) {
                        relations.push({
                            target: fieldType,
                            type: isArray ? 'one-to-many' : 'many-to-one', // Simplistic heuristic
                        });
                    } else {
                        fields.push({
                            name: fieldName,
                            type: fieldType + (isArray ? '[]' : ''),
                            isPrimary: trimmed.includes('@id'),
                            isNullable: !!isOptional,
                        });
                    }
                }
            }
            
            entities.push({
                name: modelName,
                fields,
                relations,
                sourceFile: filePath,
            });
        }
        
        return entities;
    }

    /**
     * Entry point for Tier 4 analysis. Scans the workspace for schema files
     * and extracts data models.
     * 
     * @param files - A map of file paths to their contents.
     * @returns A list of all detected data entities.
     */
    async analyze(files: Map<string, string>): Promise<DataEntity[]> {
        const allEntities: DataEntity[] = [];
        
        for (const [filePath, content] of files) {
            if (filePath.endsWith('.prisma')) {
                allEntities.push(...this.extractPrismaEntities(filePath, content));
            }
            // Add TypeORM / Sequelize detection here in the future
        }
        
        return allEntities;
    }
}
