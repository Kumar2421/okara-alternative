# Current engineering state

## Product loop

DISCOVER → UNDERSTAND → ACT → VERIFY

## Coordination model

GitHub is the shared engineering state. Agents should inspect current main, recent commits, open PRs, CI, deployment state, and production evidence before proposing or implementing changes.

## Current agent roles

- GPT: architecture, product strategy, task selection, acceptance criteria.
- Claude Code: implementation and debugging.
- Harmis: independent review and adversarial validation.
- GitHub Actions: automated quality gate.
- Vercel and production checks: runtime evidence.

## Operating principle

Prefer the smallest reliable change that advances the product loop. Avoid speculative infrastructure and unrelated refactors.
