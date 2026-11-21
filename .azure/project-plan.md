# Fahan Academy — approved MVP plan

## Approval and boundaries

The user approved on 2026-11-17: brand Fahan Academy; English; structured lessons,
exercises, explained quizzes, progress, AI tutor, course administration, accounts,
and subscriptions; Stripe test mode subject to country eligibility; Azure Container
Apps first, with Kubernetes manifests. Business country and billing currency are
deferred. No paid provisioning, live payments, invented affiliation, exam dumps,
or modifications to other workspace projects.

## Curriculum source

Read-only user-supplied guide:
`C:\Users\Mohammed Ismail\AppData\Roaming\Code\agentSessionData\69ec90cc-0f78-4fb4-9f76-170f0e850991\attachments\006734d3-6356-46a8-a72d-1e5be0c30422\Pasted text #1.txt`.

Treat its version and exam facts as user-supplied, not independently verified.
Create original educational content, not copied sample questions or full guide.
Domains and weights:
1. Prompting and Task Execution — 14%
2. Output Evaluation and Validation — 21%
3. Product and Model Selection — 12%
4. Workflow Integration and Solution Design — 16%
5. Configuration and Knowledge Management — 12%
6. Governance, Risk, and Responsible Use — 15%
7. Troubleshooting and Optimization — 10%

Provide at least two substantive lessons and three original scenario questions per
domain, explanations, practical exercises, and source/verification caveats. Every
lesson needs useful teaching text rather than a placeholder. Practice percentages
are study feedback, not conversions to the official scaled score or pass guarantees.

## Experience

Premium, accessible responsive SaaS learning platform: warm ivory background,
forest-green and mint accents, restrained violet/gold accents, clear typography,
generous spacing, tasteful CSS illustration. Original Fahan branding, no unlicensed
logos or stock assets. Landing page, course dashboard, domain/lesson navigation,
lesson reader, quizzes/results, progress, tutor, pricing/billing, admin editor.
Provide honest empty/loading/error states and keyboard-visible focus.

## Implementation

React + TypeScript with Vite frontend; Node.js + TypeScript HTTP API; use the
simplest maintainable stack. Persistent SQLite local development database is
acceptable for a runnable single-instance MVP; clearly document single-writer/
single-replica limitations and production migration to managed PostgreSQL before
scaling. Prefer PostgreSQL if a usable local runtime can be supplied without Docker.
Auth must hash passwords, use HttpOnly session cookies, validate input, protect
mutations, isolate users' progress, restrict admin operations, and avoid embedded
credentials. Local account registration must work without third-party credentials.
Do not silently enable paid features or admin access.

AI tutor: Anthropic API, server-side key, syllabus-grounded context, explicit missing-
key and upstream failure messages, per-user usage limits. No fake AI responses.
Do not advertise AI or payments as connected until configured.

Subscriptions: Stripe test-mode checkout + customer portal + verified signature
webhook, server-selected configured prices, durable entitlement state, idempotent
event handling, no success-page entitlement bypass. If unconfigured, display a clear
unavailable state; free preview remains usable. Never fabricate payment links.
Pricing and currency should be configurable, not business commitments. Design
premium access controls consistently on API and UI; admin managed separately.

Provide .env.example with placeholders, .gitignore, Dockerfile, Compose local setup,
GitHub Actions build/tests, Azure Container Apps IaC or documented deploy templates,
Kubernetes deployment/service templates with non-root/container health checks and
placeholder secrets. Never apply cloud resources or use live payment keys.

## Verification

Focused executable API tests for auth/isolation, quiz scoring and progress,
subscription authorization/webhook invariants and error paths; frontend build/
typecheck. Browser validation for registration/login, lesson reading, quiz feedback,
persisted progress, unconfigured tutor/billing, responsive layouts. Use unique test
data and clean up helpers. Docker engine is currently unavailable: include its
configuration but report container execution as unverified unless it becomes usable.

## Delivery

Keep all changes under `M:\Amsterdam Job\Fahan-Academy`.
Provide README with setup, environment keys, admin bootstrap, limitations, and
truthful production readiness checklist (email verification/reset, provider setup,
tax/privacy/refunds, managed DB/scaling, security review before public launch).
Do not claim production readiness, paid provisioning, official endorsement, or
certification exam equivalence. Prioritize a verified runnable local app.
