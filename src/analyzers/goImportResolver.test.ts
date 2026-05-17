/**
 * Tests for goImportResolver — Go module/package import resolution.
 *
 * Covers 3 import styles:
 *   - Standard library imports (e.g. "fmt", "net/http")
 *   - Relative imports (e.g. "./utils")
 *   - go.mod module-path imports (e.g. "github.com/user/repo/pkg/utils")
 */
import { describe, it, expect } from 'vitest';
import { resolveGoImports } from './goImportResolver';

// ─── Task 11: 3 import styles ─────────────────────────────────────────────────

describe('resolveGoImports — standard library imports', () => {
    it('resolves a standard library import to stdlib:<pkg>', () => {
        const imports = resolveGoImports('service.go', '/project', ['fmt'], null);
        expect(imports).toContainEqual({
            source: 'service.go',
            target: 'stdlib:fmt',
            specifiers: ['fmt'],
            isDynamic: false,
            rawStatement: 'fmt',
        });
    });

    it('resolves a standard library package with subpath (e.g. net/http)', () => {
        const imports = resolveGoImports('server.go', '/project', ['net/http'], null);
        expect(imports).toContainEqual(
            expect.objectContaining({ target: 'stdlib:net/http' })
        );
    });
});

describe('resolveGoImports — relative (same-module) imports', () => {
    it('resolves a relative import path within the same module', () => {
        const imports = resolveGoImports('cmd/main.go', '/project', ['./utils'], null);
        // Same directory relative: ./utils -> cmd/utils
        expect(imports).toContainEqual(
            expect.objectContaining({ target: 'cmd/utils', source: 'cmd/main.go' })
        );
    });
});

describe('resolveGoImports — go.mod module-path imports', () => {
    it('resolves a go.mod-declared module path to a canonical path', () => {
        const moduleName = 'github.com/user/myrepo';
        const imports = resolveGoImports(
            'cmd/main.go',
            '/project',
            ['github.com/user/myrepo/pkg/utils'],
            moduleName
        );
        // Module-relative: strip module prefix -> pkg/utils
        expect(imports).toContainEqual(
            expect.objectContaining({ target: 'pkg/utils' })
        );
    });

    it('treats an import not matching module prefix as external', () => {
        const moduleName = 'github.com/user/myrepo';
        const imports = resolveGoImports(
            'cmd/main.go',
            '/project',
            ['github.com/other/library'],
            moduleName
        );
        expect(imports).toContainEqual(
            expect.objectContaining({ target: 'external:github.com/other/library' })
        );
    });
});
