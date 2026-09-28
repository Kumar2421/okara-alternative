# Engineering acceptance gates

## Every change

- [ ] Scope is one coherent problem.
- [ ] Existing implementation and recent history were inspected.
- [ ] Relevant tests exist or the task documents why they are unnecessary.
- [ ] Lint/typecheck/build pass.
- [ ] PR targets current main.

## Runtime-sensitive changes

Also require:

- [ ] Deployment succeeds.
- [ ] Production or real-site behavior is checked.
- [ ] Evidence matches the intended user-visible behavior.
- [ ] Project/user isolation is preserved where applicable.

## Verification rule

Passing CI means the code satisfies automated checks. It does not by itself prove production correctness.

A task remains pending until every applicable gate has evidence.
