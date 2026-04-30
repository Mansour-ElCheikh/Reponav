# Security policy

## Reporting a vulnerability

Please report security issues privately, not as public GitHub issues.

**Channel:** [GitHub Security Advisory](https://github.com/mansour-90/reponav/security/advisories/new) (preferred), or email `security@reponav.dev` if the advisory channel is unavailable.

Include:
- Affected version (`reponav --version` or extension version)
- Reproducer (minimal repo or steps)
- Impact (what an attacker could achieve)
- Suggested fix if you have one

## Response window

Best-effort in v1. No formal SLA. We aim to acknowledge within one week and patch critical issues within a sprint, but we do not commit to specific timelines until v1 contribution policy graduates.

## Supported versions

| Version | Supported |
|---|---|
| `0.1.x` | Yes (current) |
| `< 0.1.0` | No |

## Scope

In scope:
- Code execution via crafted repos passed to `reponav analyze` / `reponav check`
- Prompt injection via tour synthesis when repo content reaches the LLM provider path
- Path traversal via repo path inputs
- Credential leakage in logs, telemetry, or output formats
- AI provider key handling (BYOK paths)

Out of scope (in v1):
- Vulnerabilities in third-party AI providers (report to the provider directly)
- DoS via extremely large repos (use `--max-files` / tier limits)
- Social engineering of maintainers

## Disclosure

We follow coordinated disclosure. We will not publish details of an issue until a patch is available, and we will credit reporters in the release notes unless they prefer anonymity.
