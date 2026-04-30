import { describe, it, expect } from 'vitest';
import { SchemaAnalyzer } from './schemaAnalyzer';

describe('SchemaAnalyzer', () => {
    const analyzer = new SchemaAnalyzer();

    describe('extractPrismaEntities', () => {
        it('should correctly parse a basic Prisma model with fields and relations', () => {
            const schema = `
model User {
  id    Int     @id @default(autoincrement())
  email String  @unique
  posts Post[]
}

model Post {
  id        Int     @id @default(autoincrement())
  title     String
  authorId  Int
  author    User    @relation(fields: [authorId], references: [id])
}
            `;

            const entities = analyzer.extractPrismaEntities('schema.prisma', schema);

            expect(entities).toHaveLength(2);
            
            const user = entities.find(e => e.name === 'User')!;
            expect(user.fields).toContainEqual(expect.objectContaining({ name: 'id', type: 'Int', isPrimary: true }));
            expect(user.relations).toContainEqual({ target: 'Post', type: 'one-to-many' });

            const post = entities.find(e => e.name === 'Post')!;
            expect(post.fields).toContainEqual(expect.objectContaining({ name: 'title', type: 'String' }));
            expect(post.relations).toContainEqual({ target: 'User', type: 'many-to-one' });
        });

        it('should handle optional fields and complex attributes', () => {
            const schema = `
model Profile {
  id     Int    @id
  bio    String?
  userId Int    @unique
}
            `;
            const entities = analyzer.extractPrismaEntities('schema.prisma', schema);
            const profile = entities[0];
            
            const bio = profile.fields.find(f => f.name === 'bio')!;
            expect(bio.isNullable).toBe(true);
            expect(bio.type).toBe('String');
        });

        it('should ignore comments and empty lines', () => {
            const schema = `
// This is a comment
model Foo {
  id Int @id
  // another comment
}
            `;
            const entities = analyzer.extractPrismaEntities('schema.prisma', schema);
            expect(entities[0].fields).toHaveLength(1);
        });
    });
});
