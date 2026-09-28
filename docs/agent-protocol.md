# Agent protocol

## Task lifecycle

IDEA → SPECIFIED → IMPLEMENTING → PR_OPEN → CI_PASS → REVIEW → PRODUCTION_VALIDATION → VERIFIED → MERGED

Failures move the task back to investigation or implementation.

## Handoff format

Each completed or blocked task should report:

- Objective
- Status
- Changed areas
- Evidence
- Failures encountered
- Risks
- Unresolved questions
- Recommended next action

## Agent responsibilities

### Architect
Select the smallest high-value problem, define acceptance criteria, and protect product scope.

### Implementer
Investigate the repository, implement the change, add focused tests, and own CI corrections.

### Independent reviewer
Challenge assumptions, inspect security boundaries, test contradictions, and look for production failure modes.

### Gates
CI validates mechanical correctness. Deployment validates deployability. Production checks validate runtime behavior.

## Coordination rule

Agents must coordinate through repository state, PRs, CI results, deployment evidence, and explicit handoffs. Do not rely on private chat context as shared state.

Several agents may be working in the same clone at the same time. Before
branching or checking out, run `git status` and `git worktree list`: another
agent's uncommitted files or checked-out branch may already be there. Do your
work in a separate `git worktree` rather than switching the shared working
tree's branch, and never revert or commit files you did not change.
