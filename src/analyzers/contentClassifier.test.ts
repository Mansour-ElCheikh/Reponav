import { describe, it, expect } from 'vitest';
import type { FileClassification } from '../types';
import { enrichWithContentSignals } from './contentClassifier';

// Helper: make an "unknown" classification (Pass 1 found nothing)
function unknown(filePath: string): FileClassification {
    return { path: filePath, category: 'unknown', confidence: 'low', reason: 'No matching classification rule' };
}

// Helper: make a Pass 1 classified entry
function classified(filePath: string, category: FileClassification['category'], confidence: FileClassification['confidence'] = 'high'): FileClassification {
    return { path: filePath, category, confidence, reason: 'Pass 1 rule' };
}

// Helper: build a Map with one file
function oneFile(path: string, content: string): Map<string, string> {
    return new Map([[path, content]]);
}

// ─── Python / FastAPI ────────────────────────────────────────────────────────

describe('contentClassifier — Python / FastAPI', () => {
    it('upgrades FastAPI route file (@router.get)', () => {
        const content = `from fastapi import APIRouter\nrouter = APIRouter()\n\n@router.get("/users")\nasync def get_users():\n    return []`;
        const result = enrichWithContentSignals([unknown('app/api/v1/endpoints/users.py')], oneFile('app/api/v1/endpoints/users.py', content));
        expect(result[0].category).toBe('route');
        expect(result[0].confidence).toBe('high');
    });

    it('upgrades FastAPI route file (@app.post)', () => {
        const content = `from fastapi import FastAPI\napp = FastAPI()\n\n@app.post("/items")\ndef create_item():\n    pass`;
        const result = enrichWithContentSignals([unknown('main.py')], oneFile('main.py', content));
        expect(result[0].category).toBe('entry'); // app = FastAPI() → entry wins first
    });

    it('upgrades Pydantic schema file', () => {
        const content = `from pydantic import BaseModel\n\nclass UserCreate(BaseModel):\n    email: str\n    name: str`;
        const result = enrichWithContentSignals([unknown('app/schemas/user.py')], oneFile('app/schemas/user.py', content));
        expect(result[0].category).toBe('type');
        expect(result[0].confidence).toBe('high');
    });

    it('upgrades SQLAlchemy model file', () => {
        const content = `from sqlalchemy import Column, Integer, String\nfrom sqlalchemy.ext.declarative import declarative_base\nBase = declarative_base()\n\nclass User(Base):\n    __tablename__ = "users"`;
        const result = enrichWithContentSignals([unknown('app/models/user.py')], oneFile('app/models/user.py', content));
        expect(result[0].category).toBe('model');
    });

    it('upgrades Django ORM model file', () => {
        const content = `from django.db import models\n\nclass Post(models.Model):\n    title = models.CharField(max_length=200)`;
        const result = enrichWithContentSignals([unknown('blog/models.py')], oneFile('blog/models.py', content));
        expect(result[0].category).toBe('model');
    });

    it('upgrades FastAPI app entry file', () => {
        const content = `from fastapi import FastAPI\nfrom app.routers import users\n\napp = FastAPI(title="My API")\napp.include_router(users.router)`;
        const result = enrichWithContentSignals([unknown('app/main.py')], oneFile('app/main.py', content));
        expect(result[0].category).toBe('entry');
    });

    it('upgrades Flask app entry file', () => {
        const content = `from flask import Flask\napp = Flask(__name__)\n\n@app.route("/")\ndef index():\n    return "Hello"`;
        const result = enrichWithContentSignals([unknown('server.py')], oneFile('server.py', content));
        expect(result[0].category).toBe('entry');
    });

    it('upgrades Django view file', () => {
        const content = `from django.views import View\nfrom django.http import HttpResponse\n\nclass UserView(View):\n    def get(self, request):\n        return HttpResponse("ok")`;
        const result = enrichWithContentSignals([unknown('blog/views.py')], oneFile('blog/views.py', content));
        expect(result[0].category).toBe('controller');
    });
});

// ─── TypeScript / NestJS ─────────────────────────────────────────────────────

describe('contentClassifier — TypeScript / NestJS', () => {
    it('upgrades @Injectable service', () => {
        const content = `import { Injectable } from '@nestjs/common';\n\n@Injectable()\nexport class AuthService {\n  login() {}\n}`;
        const result = enrichWithContentSignals([unknown('src/auth/auth.ts')], oneFile('src/auth/auth.ts', content));
        expect(result[0].category).toBe('service');
    });

    it('upgrades @Controller', () => {
        const content = `import { Controller, Get } from '@nestjs/common';\n\n@Controller('users')\nexport class UsersController {}`;
        const result = enrichWithContentSignals([unknown('src/users/users.ts')], oneFile('src/users/users.ts', content));
        expect(result[0].category).toBe('controller');
    });

    it('upgrades NestJS HTTP method decorator to route', () => {
        const content = `import { Get, Post } from '@nestjs/common';\n\n@Get('/users')\ngetAll() {}\n\n@Post('/users')\ncreate() {}`;
        const result = enrichWithContentSignals([unknown('src/handlers.ts')], oneFile('src/handlers.ts', content));
        expect(result[0].category).toBe('route');
    });

    it('upgrades @Entity to model', () => {
        const content = `import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';\n\n@Entity()\nexport class User {\n  @PrimaryGeneratedColumn() id: number;\n}`;
        const result = enrichWithContentSignals([unknown('src/entities/user.ts')], oneFile('src/entities/user.ts', content));
        expect(result[0].category).toBe('model');
    });

    it('upgrades Redux createSlice to service', () => {
        const content = `import { createSlice } from '@reduxjs/toolkit';\n\nexport const counterSlice = createSlice({ name: 'counter', initialState: 0, reducers: {} });`;
        const result = enrichWithContentSignals([unknown('src/count.ts')], oneFile('src/count.ts', content));
        expect(result[0].category).toBe('service');
    });

    it('upgrades @Module to config', () => {
        const content = `import { Module } from '@nestjs/common';\n\n@Module({ imports: [], controllers: [], providers: [] })\nexport class AppModule {}`;
        const result = enrichWithContentSignals([unknown('src/app.module.ts')], oneFile('src/app.module.ts', content));
        expect(result[0].category).toBe('config');
    });
});

// ─── Go ──────────────────────────────────────────────────────────────────────

describe('contentClassifier — Go', () => {
    it('upgrades Go main function to entry', () => {
        const content = `package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("hello")\n}`;
        const result = enrichWithContentSignals([unknown('cmd/server/main.go')], oneFile('cmd/server/main.go', content));
        expect(result[0].category).toBe('entry');
    });

    it('upgrades Go HTTP router registration to route', () => {
        const content = `package routes\n\nfunc SetupRoutes(r *gin.Engine) {\n\tr.GET("/users", handlers.GetUsers)\n\tr.POST("/users", handlers.CreateUser)\n}`;
        const result = enrichWithContentSignals([unknown('internal/routes/setup.go')], oneFile('internal/routes/setup.go', content));
        expect(result[0].category).toBe('route');
    });

    it('upgrades Go GORM model to model', () => {
        const content = `package models\n\nimport "gorm.io/gorm"\n\ntype User struct {\n\tgorm.Model\n\tEmail string\n}`;
        const result = enrichWithContentSignals([unknown('internal/models/user.go')], oneFile('internal/models/user.go', content));
        expect(result[0].category).toBe('model');
    });
});

// ─── C# ──────────────────────────────────────────────────────────────────────

describe('contentClassifier — C#', () => {
    it('upgrades ASP.NET ApiController to controller', () => {
        const content = `[ApiController]\n[Route("api/[controller]")]\npublic class UsersController : ControllerBase\n{\n}`;
        const result = enrichWithContentSignals([unknown('Controllers/UsersController.cs')], oneFile('Controllers/UsersController.cs', content));
        expect(result[0].category).toBe('controller');
    });

    it('upgrades Entity Framework DbContext to model', () => {
        const content = `public class AppDbContext : DbContext\n{\n    public DbSet<User> Users { get; set; }\n}`;
        const result = enrichWithContentSignals([unknown('Data/AppDbContext.cs')], oneFile('Data/AppDbContext.cs', content));
        expect(result[0].category).toBe('model');
    });
});

// ─── Safety: high-confidence Pass 1 results are NOT overridden ───────────────

describe('contentClassifier — confidence gating', () => {
    it('does NOT override high-confidence Pass 1 classification', () => {
        const content = `@Injectable()\nexport class AuthService {}`;
        // Already classified as 'test' with high confidence by Pass 1
        const result = enrichWithContentSignals(
            [classified('src/auth.test.ts', 'test', 'high')],
            oneFile('src/auth.test.ts', content)
        );
        expect(result[0].category).toBe('test');
        expect(result[0].confidence).toBe('high');
    });

    it('does NOT override medium-confidence Pass 1 classification', () => {
        const content = `@Injectable()\nexport class SomeService {}`;
        const result = enrichWithContentSignals(
            [classified('src/some.ts', 'component', 'medium')],
            oneFile('src/some.ts', content)
        );
        expect(result[0].category).toBe('component');
    });

    it('returns unchanged when content is empty', () => {
        const result = enrichWithContentSignals(
            [unknown('src/empty.py')],
            oneFile('src/empty.py', '')
        );
        expect(result[0].category).toBe('unknown');
    });

    it('returns unchanged when no signal matches', () => {
        const content = `# just a comment file\nsome_data = [1, 2, 3]`;
        const result = enrichWithContentSignals(
            [unknown('src/data.py')],
            oneFile('src/data.py', content)
        );
        expect(result[0].category).toBe('unknown');
    });

    it('preserves all fields on non-upgraded entries', () => {
        const original = classified('src/foo.ts', 'utility', 'high');
        const result = enrichWithContentSignals([original], oneFile('src/foo.ts', ''));
        expect(result[0]).toEqual(original);
    });
});
