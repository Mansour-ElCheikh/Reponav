import { describe, it, expect } from 'vitest';
import { parseDiff } from './diffParser';

describe('diffParser', () => {
    it('should parse a standard unified diff with one file and one hunk', () => {
        const diff = `
diff --git a/src/index.ts b/src/index.ts
index abc123..def456 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -10,5 +12,8 @@
-old line
+new line 1
+new line 2
+new line 3
        `.trim();

        const hunks = parseDiff(diff);
        expect(hunks).toHaveLength(1);
        expect(hunks[0]).toEqual({
            file: 'src/index.ts',
            startLine: 12,
            endLine: 19, // 12 + 8 - 1 = 19 (wait, the hunk len is 8)
        });
    });

    it('should parse a diff with multiple files', () => {
        const diff = `
diff --git a/src/A.ts b/src/A.ts
--- a/src/A.ts
+++ b/src/A.ts
@@ -1,1 +1,1 @@
+modified A
diff --git a/src/B.ts b/src/B.ts
--- a/src/B.ts
+++ b/src/B.ts
@@ -5,1 +5,1 @@
+modified B
        `.trim();

        const hunks = parseDiff(diff);
        expect(hunks).toHaveLength(2);
        expect(hunks[0].file).toBe('src/A.ts');
        expect(hunks[1].file).toBe('src/B.ts');
    });

    it('should handle hunks with no length specified (defaults to 1)', () => {
        const diff = `
diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -10 +10 @@
+single line change
        `.trim();

        const hunks = parseDiff(diff);
        expect(hunks[0].startLine).toBe(10);
        expect(hunks[0].endLine).toBe(10);
    });

    it('should skip hunks that are purely deletions (len 0)', () => {
        const diff = `
diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -10,5 +10,0 @@
-deleted 5 lines
        `.trim();

        const hunks = parseDiff(diff);
        expect(hunks).toHaveLength(0);
    });

    it('should handle malformed or empty diffs gracefully', () => {
        expect(parseDiff('')).toEqual([]);
        expect(parseDiff('just some text')).toEqual([]);
    });
});
