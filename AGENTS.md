# Repository collaboration rules

- After each substantial, coherent feature, fix, or documentation change, run the relevant checks, review the complete diff, and create a Git commit without waiting for a separate reminder.
- Use one focused commit per substantial change. Do not create commits for routine intermediate edits.
- Never stage secrets, `.env.local`, caches, temporary build outputs, or unrelated user changes.
- If required validation fails or cannot run, record that fact in the commit or report and do not describe the change as verified.
- Push commits only when the user asks to publish or sync them to the remote. A request to commit authorizes the local commit; a request to push or sync authorizes publication.

# Delivery and verification rules (2026-10-24)

- Follow `docs/后续推进计划与执行要求.md` for the active batch order and change-based checks. Historical TDD records are evidence, not instructions to resume full regression.
- Deliver the prebuilt-sample Demo first (RP-01); do not make runtime redesign or full PRD acceptance prerequisites for that Demo. Label sample provenance and retain existing publication checks.
- Use TDD at the layer affected by the change. Developer unit tests may be corrected with a recorded diff; independent acceptance criteria must not be weakened. Do not manufacture Java red tests for unchanged components or text-only assets.
- Run relevant checks once. Documentation-only changes need document checks; if they change machine-tracked acceptance metadata, run its existing consistency check only. UI changes do not trigger Java builds or model generation. Full phase acceptance is a separate delivery batch, not a gate for every local change.
- Rebuild only affected Docker services when their build inputs change and deployment verification is needed. Reuse one build for multiple tests; do not rebuild for evidence refresh, test-case changes, or unchanged image storage migration.
- Separate content identity from execution IDs. Preserve historical evidence and legacy candidate digests; cross-version evidence reuse requires implemented and verified compatibility rules.
- New test/build workspaces must have bounded retention and cleanup. Do not delete historical artifacts, project volumes, or unrelated data without verifying ownership, references, and authorization.
- Commit coherent changes locally after relevant checks. GitHub CI is not a blocker for local progress; do not push unless requested.
