# Engineering acceptance gates

## Every change

- [ ] Scope is one coherent problem.
- [ ] Existing implementation and recent history were inspected.
- [ ] Relevant tests exist or the task documents why they are unnecessary.
- [ ] Lint/typecheck/build pass.
- [ ] PR targets current main. Enforced by the `pr-base-guard` CI job — a PR
      based on anything else fails immediately. A stacked PR onto a non-main
      base is still allowed, but must say `intentional-base` in its body.
      This gate is mechanical because it has already failed silently: PR #22
      was merged into a stale feature branch, reported as MERGED, and the
      isolation fix it carried never reached main or production.

## Runtime-sensitive changes

Also require:

- [ ] Deployment succeeds.
- [ ] Production or real-site behavior is checked.
- [ ] Evidence matches the intended user-visible behavior.
- [ ] Project/user isolation is preserved where applicable.

## Verification rule

Passing CI means the code satisfies automated checks. It does not by itself prove production correctness.

A merge reported as successful does not prove the change reached `main`. GitHub
reports a PR as MERGED even when its base was a stale branch, and `gh pr merge`
can report a local error after the merge already succeeded server-side. Confirm
the change is actually present — `git show origin/main:<path>`, or check that
the merge commit is an ancestor of `origin/main` — rather than trusting the
status word.

A task remains pending until every applicable gate has evidence.
