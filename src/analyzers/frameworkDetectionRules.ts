import type { FrameworkInfo } from '../types';

interface DetectionRule {
    name: string;
    type: FrameworkInfo['type'];
    detect: (files: Map<string, string>) => FrameworkInfo | null;
}

const DETECTION_RULES: DetectionRule[] = [
    {
        name: 'Next.js',
        type: 'framework',
        detect: (files) => {
            const pkg = tryParseJson(files.get('package.json'));
            const version = pkg?.dependencies?.['next'] || pkg?.devDependencies?.['next'];
            if (version) {
                const hasAppDir = [...files.keys()].some((filePath) => filePath.startsWith('app/'));
                const hasPagesDir = [...files.keys()].some((filePath) => filePath.startsWith('pages/'));
                const router = hasAppDir ? 'App Router' : hasPagesDir ? 'Pages Router' : 'Unknown Router';
                return {
                    name: `Next.js (${router})`,
                    version: cleanVersion(version),
                    type: 'framework',
                    evidence: `package.json dependency "next": "${version}"`,
                };
            }
            return null;
        },
    },
    {
        name: 'React',
        type: 'library',
        detect: (files) => {
            const pkg = tryParseJson(files.get('package.json'));
            const version = pkg?.dependencies?.['react'] || pkg?.devDependencies?.['react'];
            if (version) {
                return {
                    name: 'React',
                    version: cleanVersion(version),
                    type: 'library',
                    evidence: `package.json dependency "react": "${version}"`,
                };
            }
            return null;
        },
    },
    {
        name: 'Vue.js',
        type: 'framework',
        detect: (files) => {
            const pkg = tryParseJson(files.get('package.json'));
            const version = pkg?.dependencies?.['vue'] || pkg?.devDependencies?.['vue'];
            if (version) {
                const hasNuxt = pkg?.dependencies?.['nuxt'] || pkg?.devDependencies?.['nuxt'];
                return {
                    name: hasNuxt ? 'Nuxt.js (Vue)' : 'Vue.js',
                    version: cleanVersion(version),
                    type: 'framework',
                    evidence: `package.json dependency "vue": "${version}"`,
                };
            }
            return null;
        },
    },
    {
        name: 'Svelte',
        type: 'framework',
        detect: (files) => {
            const pkg = tryParseJson(files.get('package.json'));
            const version = pkg?.dependencies?.['svelte'] || pkg?.devDependencies?.['svelte'];
            if (version) {
                const hasSvelteKit = pkg?.dependencies?.['@sveltejs/kit'] || pkg?.devDependencies?.['@sveltejs/kit'];
                return {
                    name: hasSvelteKit ? 'SvelteKit' : 'Svelte',
                    version: cleanVersion(version),
                    type: 'framework',
                    evidence: 'package.json dependency',
                };
            }
            return null;
        },
    },
    {
        name: 'Express',
        type: 'framework',
        detect: (files) => {
            const pkg = tryParseJson(files.get('package.json'));
            const version = pkg?.dependencies?.['express'];
            if (version) {
                return {
                    name: 'Express',
                    version: cleanVersion(version),
                    type: 'framework',
                    evidence: `package.json dependency "express": "${version}"`,
                };
            }
            return null;
        },
    },
    {
        name: 'Fastify',
        type: 'framework',
        detect: (files) => {
            const pkg = tryParseJson(files.get('package.json'));
            const version = pkg?.dependencies?.['fastify'];
            if (version) {
                return {
                    name: 'Fastify',
                    version: cleanVersion(version),
                    type: 'framework',
                    evidence: `package.json dependency "fastify": "${version}"`,
                };
            }
            return null;
        },
    },
    {
        name: 'FastAPI',
        type: 'framework',
        detect: (files) => {
            for (const [filePath, content] of files) {
                if (filePath === 'requirements.txt' || filePath === 'requirements/base.txt') {
                    const match = content.match(/fastapi[>=~!]*([\d.]+)?/i);
                    if (match) {
                        return {
                            name: 'FastAPI',
                            version: match[1],
                            type: 'framework',
                            evidence: `${filePath}: fastapi dependency`,
                        };
                    }
                }
                if (filePath === 'pyproject.toml' && content.includes('fastapi')) {
                    return {
                        name: 'FastAPI',
                        type: 'framework',
                        evidence: 'pyproject.toml: fastapi dependency',
                    };
                }
            }
            return null;
        },
    },
    {
        name: 'Django',
        type: 'framework',
        detect: (files) => {
            if (files.has('manage.py')) {
                const manageContent = files.get('manage.py')!;
                if (manageContent.includes('django')) {
                    return {
                        name: 'Django',
                        type: 'framework',
                        evidence: 'manage.py with django reference',
                    };
                }
            }
            return null;
        },
    },
    {
        name: 'Flask',
        type: 'framework',
        detect: (files) => {
            for (const [filePath, content] of files) {
                if (filePath === 'requirements.txt' && /flask[>=~!]/i.test(content)) {
                    return {
                        name: 'Flask',
                        type: 'framework',
                        evidence: 'requirements.txt: flask dependency',
                    };
                }
            }
            return null;
        },
    },
    {
        name: 'Vite',
        type: 'build-tool',
        detect: (files) => {
            if (files.has('vite.config.ts') || files.has('vite.config.js')) {
                const pkg = tryParseJson(files.get('package.json'));
                const version = pkg?.devDependencies?.['vite'] || pkg?.dependencies?.['vite'];
                return {
                    name: 'Vite',
                    version: version ? cleanVersion(version) : undefined,
                    type: 'build-tool',
                    evidence: 'vite.config.ts/js present',
                };
            }
            return null;
        },
    },
    {
        name: 'Webpack',
        type: 'build-tool',
        detect: (files) => {
            if (files.has('webpack.config.js') || files.has('webpack.config.ts')) {
                return {
                    name: 'Webpack',
                    type: 'build-tool',
                    evidence: 'webpack.config file present',
                };
            }
            return null;
        },
    },
    {
        name: 'Node.js',
        type: 'runtime',
        detect: (files) => {
            if (files.has('package.json')) {
                const pkg = tryParseJson(files.get('package.json'));
                const nodeVersion = pkg?.engines?.node;
                return {
                    name: 'Node.js',
                    version: nodeVersion ? cleanVersion(nodeVersion) : undefined,
                    type: 'runtime',
                    evidence: 'package.json present',
                };
            }
            return null;
        },
    },
    {
        name: 'Go',
        type: 'runtime',
        detect: (files) => {
            const goMod = files.get('go.mod');
            if (goMod) {
                const versionMatch = goMod.match(/^go\s+([\d.]+)/m);
                return {
                    name: 'Go',
                    version: versionMatch?.[1],
                    type: 'runtime',
                    evidence: 'go.mod present',
                };
            }
            return null;
        },
    },
    {
        name: 'Rust',
        type: 'runtime',
        detect: (files) => {
            if (files.has('Cargo.toml')) {
                return {
                    name: 'Rust',
                    type: 'runtime',
                    evidence: 'Cargo.toml present',
                };
            }
            return null;
        },
    },
    {
        name: 'pnpm',
        type: 'build-tool',
        detect: (files) => {
            if (files.has('pnpm-lock.yaml')) {
                return { name: 'pnpm', type: 'build-tool', evidence: 'pnpm-lock.yaml present' };
            }
            return null;
        },
    },
    {
        name: 'yarn',
        type: 'build-tool',
        detect: (files) => {
            if (files.has('yarn.lock')) {
                return { name: 'Yarn', type: 'build-tool', evidence: 'yarn.lock present' };
            }
            return null;
        },
    },
    {
        name: 'Prisma',
        type: 'library',
        detect: (files) => {
            if (files.has('prisma/schema.prisma')) {
                return { name: 'Prisma ORM', type: 'library', evidence: 'prisma/schema.prisma present' };
            }
            return null;
        },
    },
    {
        name: 'SQLAlchemy',
        type: 'library',
        detect: (files) => {
            for (const [filePath, content] of files) {
                if (filePath === 'requirements.txt' && /sqlalchemy/i.test(content)) {
                    return { name: 'SQLAlchemy', type: 'library', evidence: 'requirements.txt: sqlalchemy' };
                }
            }
            return null;
        },
    },
    {
        name: 'Jest',
        type: 'library',
        detect: (files) => {
            const pkg = tryParseJson(files.get('package.json'));
            if (pkg?.devDependencies?.['jest'] || files.has('jest.config.ts') || files.has('jest.config.js')) {
                return { name: 'Jest', type: 'library', evidence: 'jest config or dependency' };
            }
            return null;
        },
    },
    {
        name: 'Vitest',
        type: 'library',
        detect: (files) => {
            const pkg = tryParseJson(files.get('package.json'));
            if (pkg?.devDependencies?.['vitest']) {
                return { name: 'Vitest', type: 'library', evidence: 'vitest devDependency' };
            }
            return null;
        },
    },
];

// Parse JSON manifests defensively so malformed package files degrade gracefully.
function tryParseJson(content?: string): Record<string, any> | null {
    if (!content) {
        return null;
    }
    try {
        return JSON.parse(content);
    } catch {
        return null;
    }
}

// Strip common semver operators so reported versions stay human-readable.
function cleanVersion(version: string): string {
    return version.replace(/^[\^~>=<]+/, '');
}

/**
 * Detect frameworks, libraries, runtimes, and build tools from manifest files and file structure.
 */
export function detectFrameworksFromRules(files: Map<string, string>): FrameworkInfo[] {
    const detected: FrameworkInfo[] = [];

    for (const rule of DETECTION_RULES) {
        const result = rule.detect(files);
        if (result) {
            detected.push(result);
        }
    }

    return detected;
}