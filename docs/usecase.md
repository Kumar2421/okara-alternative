# Product Use Cases and Boundary Guide

> Purpose: keep implementation aligned with the product we are trying to ship, prevent scope drift, and make every future PR explain its user value.

## 1. Product Goal

Build a practical, focused alternative to Okara that helps a website owner:

1. Connect or configure a website/project.
2. Understand the most important website, SEO, and visibility problems.
3. See evidence and business impact for each problem.
4. Receive clear recommendations and next actions.
5. Re-run checks and understand whether progress was made.
6. Inspect basic AI/GEO visibility for relevant prompts.

The product should optimize for **useful decisions and measurable progress**, not for the largest number of integrations or reports.

## 2. Primary User

### Primary persona: Website owner or growth operator

Needs:

- A quick understanding of what is wrong.
- Prioritized issues instead of raw technical output.
- Plain-language explanations.
- Concrete actions that can be completed.
- A way to verify improvement.
- A simple view of search and AI visibility.

### Secondary persona: SEO or marketing specialist

Needs:

- Evidence behind findings.
- Competitor and content context.
- Repeatable checks.
- Project-level history and status.
- Exportable or shareable results later, if justified.

### Not the initial target

- Enterprise crawler operators.
- Full-service marketing agencies requiring complex multi-tenant workflows.
- Users needing a complete replacement for every commercial SEO data provider.
- Users expecting autonomous production code changes without review.

## 3. Core User Journeys

### Journey A: Project setup and context

**User goal:** establish enough context for meaningful analysis.

Flow:

1. Create or select a project.
2. Configure the website and relevant project details.
3. Add useful documents such as product information, marketing strategy, content strategy, or design guidance.
4. Add competitors when relevant.
5. Start an analysis.

Acceptance criteria:

- All data is scoped to the active project.
- Empty states explain what the user should do next.
- Existing project mutations continue to use validated API routes.
- The UI does not require duplicate manual configuration in multiple panels.

### Journey B: Focused website audit

**User goal:** discover the most important actionable website problems.

Flow:

1. Start an audit for the project website.
2. Run a focused set of useful checks.
3. Normalize results into project findings.
4. Assign severity, category, evidence, and a useful explanation.
5. Display prioritized findings in the dashboard.

Acceptance criteria:

- Results are understandable without reading raw crawler output.
- Findings have stable identifiers and project ownership.
- Failures and partial results are visible rather than silently ignored.
- The first version favors a small set of reliable checks over broad but noisy coverage.

### Journey C: Findings and recommendations

**User goal:** understand what to fix and why it matters.

Flow:

1. Open a finding.
2. Review severity, evidence, affected URL or resource, and explanation.
3. Read a recommendation with a clear next action.
4. Mark or move the finding through its lifecycle.
5. Recheck the finding when a change is made.

Acceptance criteria:

- A finding explains the problem, evidence, impact, and recommended action.
- Status changes are persisted and project-scoped.
- The user can distinguish new, acknowledged, fixing, fixed, verified, and failed states where supported.
- Recommendations do not claim that a change was applied unless the system actually performed and verified it.

### Journey D: Progress and re-check

**User goal:** verify whether work improved the website.

Flow:

1. Select a finding or audit area.
2. Run a re-check.
3. Compare the new result with the previous result.
4. Update the finding status based on evidence.
5. Show what improved and what remains unresolved.

Acceptance criteria:

- Re-checks are explicit and have loading, failure, and success states.
- Previous results are not overwritten without traceability where history exists.
- Verification is evidence-based, not inferred from a user clicking a button.
- The UI avoids showing a false success state when a provider or check fails.

### Journey E: Basic GEO/AI visibility

**User goal:** understand how the project appears in AI-generated answers.

Flow:

1. Select a small set of relevant prompts.
2. Run the prompts through supported providers.
3. Record whether the project or brand is mentioned.
4. Capture relevant citations or source references when available.
5. Display a simple visibility summary and improvement opportunities.

Acceptance criteria:

- The first version uses a limited, understandable prompt set.
- Provider errors, unavailable citations, and incomplete responses are represented honestly.
- Results are stored with project, prompt, provider, and timestamp context.
- The feature does not pretend to provide statistically complete market-wide measurement.

## 4. Product Perspectives

Every meaningful feature should be evaluated from these perspectives before implementation.

### 4.1 User value

- Does this help the user understand a problem, choose an action, or verify progress?
- Is the output understandable to a non-specialist?
- Does the feature reduce work rather than add configuration?

### 4.2 Workflow completeness

- Where does the feature start?
- What data does it consume?
- What does the user see?
- What action can the user take?
- How is the outcome persisted and rechecked?

A feature that only produces data but does not support a user decision is incomplete unless it is explicitly an internal foundation.

### 4.3 Data correctness and project isolation

- Is every read and mutation scoped to the active project?
- Are identifiers, timestamps, status values, and source information preserved?
- Are missing, partial, stale, and failed results distinguishable?
- Can one project access another project's data through query parameters, IDs, or mutations?

### 4.4 Explainability and trust

- Can the user see why a finding exists?
- Is evidence linked to the conclusion?
- Are recommendations clearly separated from verified facts?
- Are provider limitations and uncertainty visible?
- Does the UI avoid claiming completion without verification?

### 4.5 Technical simplicity

- Can the feature use existing API routes, database tables, providers, and dashboard state?
- Does it require a new abstraction, or can a small domain function solve it?
- Is the proposed complexity justified by a current user need?
- Can the feature be tested and operated by the current project?

### 4.6 Reliability and failure handling

- What happens when a provider times out, returns invalid data, or is unavailable?
- Can the user retry safely?
- Are partial results saved without corrupting completed results?
- Are duplicate requests and repeated mutations handled safely?
- Does the UI provide useful empty, loading, and error states?

### 4.7 Performance and cost

- Does the operation make unnecessary API or model calls?
- Can existing shared dashboard data prevent duplicate requests?
- Is the number of URLs, prompts, tokens, and retries bounded?
- Is expensive processing triggered intentionally rather than on every render?

### 4.8 Security and privacy

- Is project ownership checked server-side?
- Are external URLs validated before fetching?
- Are secrets and provider credentials kept server-side?
- Are user-controlled values escaped and validated?
- Are logs free of sensitive credentials and unnecessary personal data?

### 4.9 Maintainability

- Is the code placed in the correct domain or feature area?
- Are types shared rather than duplicated?
- Are API contracts explicit?
- Does the change preserve existing behavior unless a behavior change is intentional?
- Is there a clear rollback path?

### 4.10 Product differentiation

- Does the feature help users move from detection to action to verification?
- Does it make the product simpler or more useful than a raw reporting tool?
- Is it directly connected to website health, SEO performance, or AI visibility?
- Is it a real product capability or only an integration showcase?

## 5. Product Boundary

### Build now

- Project-scoped dashboard workflows.
- Context, documents, and competitor information already supported by the product.
- Focused website and SEO checks.
- Prioritized findings with evidence.
- Recommendations and finding lifecycle states.
- Re-checks and visible progress.
- Basic GEO/AI visibility using a limited prompt workflow.
- Reliable loading, error, empty, and retry states.
- Automated validation, project isolation, and security checks.

### Defer until justified by real usage

- Full SiteOne Crawler replacement.
- Broad DataForSEO integration.
- Full OpenSERP infrastructure.
- Multi-engine GEO monitoring at scale.
- Complex provider-adapter frameworks.
- Distributed queues and worker orchestration.
- Autonomous production code modifications.
- Advanced lead verification and enrichment.
- Enterprise reporting, billing, and agency features.
- Large-scale historical analytics and benchmarking.

These items may be researched or prototyped, but they are not default requirements for the MVP.

## 6. PR Planning Rules

Every PR should include:

1. **User problem:** what user problem is being addressed?
2. **Scope:** what is included and explicitly excluded?
3. **Existing capability reused:** which API, table, provider, or component is reused?
4. **User-visible outcome:** what can the user do after the PR?
5. **Data and security impact:** how is project isolation preserved?
6. **Validation:** what lint, typecheck, tests, build, and manual checks are required?
7. **Rollback or failure behavior:** what happens when the new flow fails?

### PR size guideline

Prefer one vertical slice that can be tested end-to-end over a broad architectural refactor.

A PR should be split when:

- It mixes unrelated user workflows.
- It introduces a new abstraction without an immediate consumer.
- It is difficult to review or validate safely.
- It combines migration, redesign, and new functionality without a clear boundary.

A PR should not be split merely to create more PRs.

## 7. Current Roadmap Guardrail

PR14 is considered part of the approved product boundary. It provides shared dashboard data foundations and should not be replaced with another data architecture.

The expected next product slices are:

1. Complete Context data migration and remove unnecessary duplicate reads.
2. Complete Findings data migration and dashboard integration.
3. Complete the recommendation and action workflow.
4. Make re-check and progress behavior reliable.
5. Deliver a focused website audit experience.
6. Deliver basic GEO visibility.
7. Harden the complete journey with security, failure handling, and automated validation.

The order can change only when repository evidence or a concrete user requirement justifies it.

## 8. Definition of Done for a Product Slice

A feature is not complete when its UI renders. It is complete when:

- The primary user journey works from start to finish.
- Data is project-scoped and validated server-side.
- Loading, empty, error, retry, and partial-result states are handled.
- Mutations persist correctly.
- The user can understand the result and next action.
- Verification does not report success without evidence.
- Lint, typecheck, tests, and production build pass where applicable.
- The change does not introduce unnecessary architecture or provider dependency.
- Documentation is updated when behavior or contracts change.

## 9. Scope-Drift Questions

Before approving a new feature or dependency, ask:

1. Which core user journey does this improve?
2. Can the same outcome be achieved with existing code?
3. Is this required for the MVP or only interesting technically?
4. What is the smallest version that proves user value?
5. What new operational cost, provider dependency, or failure mode does it add?
6. Does it move the user from detection to action or verification?
7. If we do not build it now, which current user journey is blocked?

If these questions do not produce a clear answer, defer the work.

## 10. Guiding Principle

> Build the smallest reliable workflow that helps a website owner discover an important problem, understand it, act on it, and verify improvement.

Avoid building an ecosystem before the core workflow is useful.