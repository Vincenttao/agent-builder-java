# Repository collaboration rules

- After each substantial, coherent feature, fix, or documentation change, run the relevant checks, review the complete diff, and create a Git commit without waiting for a separate reminder.
- Use one focused commit per substantial change. Do not create commits for routine intermediate edits.
- Never stage secrets, `.env.local`, caches, temporary build outputs, or unrelated user changes.
- If required validation fails or cannot run, record that fact in the commit or report and do not describe the change as verified.
- Push commits only when the user asks to publish or sync them to the remote. A request to commit authorizes the local commit; a request to push or sync authorizes publication.
