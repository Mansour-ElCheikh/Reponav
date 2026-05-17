# ADR-0025: Cascade Exhaustion MockProvider Terminator Test Contract

**Status:** Accepted
**Date:** 2026-04-27
**Supersedes:** None

## Context

`DynamicLLMProvider` in auto mode cascades through Groq → Gemini → Anthropic → OpenAI → VSCodeLM → MockProvider when providers fail. MockProvider was added as a structural terminator (ADR implied by B1 fix in commit `5ec88fb`) to ensure users never see raw provider errors. However, there were no tests verifying that the full cascade actually terminates at MockProvider — the test suite covered only happy-path and single-fallback scenarios.

## Decision

Add two tests to `DynamicLLMProvider.test.ts` that force all real providers (Groq, Gemini, Anthropic, OpenAI, VSCodeLM) to throw via a `state.providerErrors` map injected into the `vi.hoisted` mock state. The tests assert:
- `generate()` returns MockProvider's output text when the full cascade exhausts all real providers.
- `generateStream()` yields MockProvider's output text under the same conditions.

The mock infrastructure was extended: `buildProviderClass` and the inline `GeminiProvider` mock both check `state.providerErrors[providerId]` on each `generate()` call and throw if set. `beforeEach` resets `providerErrors = {}` to isolate tests.

## Consequences

The MockProvider terminator contract is now mechanically verified — any future refactor that accidentally removes or breaks the terminator will fail these tests. The `state.providerErrors` mechanism is reusable for future cascade-order or priority tests. No production code changed.
