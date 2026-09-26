# Product Direction and Phase Guardrails

## Product promise

Help a website owner understand:

1. What is wrong with the website?
2. What should be fixed first?
3. How can search and AI visibility improve?

## Common-user principles

- Show outcomes before architecture.
- Prefer clear recommendations over raw telemetry.
- Explain why an issue matters and what to do next.
- Use real evidence or explicitly state when evidence is unavailable.
- Avoid exposing provider adapters, crawl orchestration, or internal state machines in the primary user experience.

## Phase gate

Every feature must identify:

- The user problem it solves.
- The user-visible outcome.
- The evidence required.
- The smallest implementation that delivers the outcome.
- How success will be tested.
- What complexity or product-drift risk it introduces.

A phase should not proceed when it primarily adds infrastructure without improving a user-facing workflow or enabling a clearly defined near-term outcome.

## Next product phase: actionable findings

The next user-facing focus is the existing Findings workspace. Improve it so users can quickly:

1. Understand the highest-impact unresolved issue.
2. See the evidence behind the issue.
3. Take a concrete next action.
4. Re-check the issue and understand the result.

The implementation should prioritize transparent ordering and useful explanations, not introduce a new orchestration layer or provider abstraction.

## Definition of done

- Findings are presented in a predictable, explainable priority order.
- Each finding exposes evidence, impact, and an actionable recommendation.
- Status changes and verification results remain truthful and recoverable.
- Empty, loading, and error states are explicit.
- Unit tests cover priority behavior and edge cases.
- Lint, tests, and production build pass on the exact commit.
