# Shared conversation canvas

The canvas is shared by the current approved members of one conversation. It contains a plain-text plan and a bounded checklist. Any current approved member may edit the plan or any task, assign another current approved member, complete/reopen a task, or delete it. This is a shared workspace, not a private list or an admin-only feature.

`CANVAS_SCHEMA_PROPOSAL.sql` is additive and requires the existing rich-message, reply and message-actions schemas. It does not modify messages, Auth, file uploads, Storage or conversation membership. Only the root release process may apply it to the live project.

## API

All five functions return a **JSON object**, not a table/singleton array. The same full snapshot is returned after every successful mutation:

```json
{
  "conversation_id": "conversation UUID",
  "revision": 12,
  "canvas": {
    "body": "Shared plain text",
    "revision": 3,
    "updated_at": "2026-09-09T12:00:00Z",
    "updated_by": "actor UUID"
  },
  "tasks": [{
    "id": "client-generated task UUID",
    "title": "Book studio",
    "assignee_id": "member UUID or null",
    "due_date": "2026-10-01",
    "completed": false,
    "revision": 1,
    "source_message_id": "message UUID or null",
    "source_block_id": "rich block ID or null",
    "created_at": "2026-09-09T12:00:00Z",
    "created_by": "actor UUID",
    "updated_at": "2026-09-09T12:05:00Z",
    "updated_by": "actor UUID"
  }],
  "participants": [{"id":"member UUID","display_name":"Name or null","username":"handle"}]
}
```

An untouched canvas has body `""`, both revisions `0`, null plan update fields, and an empty task array. Reading does not create a row. Participants contain only current approved conversation members; no email, phone, auth metadata or other profile fields are exposed. Tasks are ordered by creation timestamp, then UUID.

| RPC | Parameters |
| --- | --- |
| `pablicus_get_canvas` | `p_conversation_id` |
| `pablicus_save_canvas_plan` | `p_conversation_id`, `p_expected_revision` (plan revision), `p_body` |
| `pablicus_create_canvas_task` | `p_conversation_id`, `p_task_id` (new client UUID), `p_title`, optional `p_assignee_id`, `p_due_date`, `p_source_message_id`, `p_source_block_id` (default null) |
| `pablicus_update_canvas_task` | `p_conversation_id`, `p_task_id`, `p_expected_revision` (task revision), `p_title`, `p_assignee_id`, `p_due_date`, `p_completed` |
| `pablicus_delete_canvas_task` | `p_conversation_id`, `p_task_id`, `p_expected_revision` (task revision) |

The update RPC is a full replacement of the task's editable fields; explicit null clears its assignee or due date. Source message/block are immutable after creation. Clients render plain text as text, never HTML.

Plan text is at most 20,000 characters / 80,000 bytes. Empty text clears the plan. Task title is required, trimmed on storage, 1–500 characters / at most 2,000 input bytes. A due date is an optional finite calendar date from 1900-01-01 through 9999-12-31; no timezone conversion is needed. Source block IDs use the existing `[A-Za-z0-9_-]{1,128}` rich-message contract.

The returned snapshot includes all nondeleted tasks, up to **200 per conversation**, including completed tasks. A 201st task is rejected, never silently omitted. Delete a task to free a slot. The UI must explain the limit if reached. The follow-on [aggregate task list](TASKS_CONTRACT.md) adds a separate paginated read API across the caller's current conversations; this canvas snapshot and its mutation contracts remain unchanged.

## Concurrency and safe retries

- Outer `revision` increments on every material plan/task change; it is useful for refresh reconciliation. It is **not** the mutation precondition.
- `canvas.revision` increments only for plan changes. Each task's `revision` increments only when that task changes or is deleted. Independent plan/task edits therefore do not conflict.
- A differing write with a stale expected revision fails with `40001`. The client keeps its draft, reloads the server snapshot, shows a conflict and asks the person to reconcile. Do not silently fetch a new revision and overwrite.
- A write whose requested values already equal current values returns the current snapshot without changing any revision. A delete retry of an already deleted task is also a no-op.
- Creation uses the **same client-generated `p_task_id` and exact original field values** on an uncertain/network retry. The original payload and creator are immutable, retained in the private row after subsequent edits or deletion. Replaying that creation returns current state without duplication, overwriting edits, or resurrecting deletion. A reused task UUID with a different creator, conversation or original payload fails with `23505 task_id_conflict`.
- Whitespace in original create title is part of the replay request identity even though the stored visible title is trimmed. A client should retain its original payload for retries.
- Authorization is checked and locked before every operation and every no-op/replay. Removing membership or approval takes effect on subsequent calls; JWT/user-editable metadata is never used as authority.
- Assignment and source validation run for new content. Replaying an already accepted creation remains safe when its old assignee or source has since disappeared. For a new edit, an absent former assignee must be cleared or replaced with a current member.
- Mutations acquire one short conversation-canvas row lock before inspecting/changing tasks. It serializes limit checks and revision increments, including first creation. Source message/assignee membership/profile rows are share-locked during validation to prevent a concurrent removal passing unnoticed.

## Source messages

At task creation the source must exist, be undeleted, and belong to the **same conversation**, even if the caller belongs to both chats. A block reference requires a rich source and an ID present in the source's effective edited content. Text, voice and media blocks all qualify. The server stores only source IDs; it does not duplicate source text or signed media URLs.

Later message edits/deletion do not delete the independent shared task. The UI fetches the source through the existing membership-scoped message read; a deleted/unavailable source is reported as unavailable. Hard deletion clears the source message foreign key. Source contents are never embedded in a returned canvas snapshot.

## Errors

| SQLSTATE | Meaning |
| --- | --- |
| `42501` | Missing authentication/approval/membership; task or source not in this chat; direct private access denied |
| `40001` + `canvas_revision_conflict` | Plan changed since the submitted revision |
| `40001` + `task_revision_conflict` | Task changed since the submitted revision |
| `23505` + `task_id_conflict` | Client task UUID was reused for a different create request |
| `22023` | Invalid fields, deleted task/source, unavailable assignee, or `canvas_task_limit` |
| PostgreSQL date/UUID parsing errors | Invalid serialized date or UUID before function execution |

## Security and storage

Tables live only in the existing unexposed `pablicus_chat_private` schema. Both have RLS enabled with explicit deny policies and no table privileges for PUBLIC, anon or authenticated. Source/actor/assignee/conversation foreign keys have indexes for deletion and membership-scale operations. Tombstones retain only the accepted task record and original create identity; they are not returned to clients. Deleting a conversation cascades its canvas and tasks.

Public endpoints are SECURITY INVOKER wrappers. Their private SECURITY DEFINER entry points all have fixed empty `search_path` and call the existing `assert_message_member`, which checks live profile approval and conversation membership with share locks. Three internal helper functions are invokers with no client execution grant. Only the five guarded private entries and five public wrappers are executable by authenticated; anonymous execution is revoked. The design does not add exposed definer functions, direct table writes, service keys, Realtime schema mutations, notifications or auth bypasses.

Read-only live catalog inspection on 2026-09-09 confirmed the actual profile `display_name`/`username`/`is_approved`, conversation-member keys, and message `attachment_metadata`/`edited_content`/`deleted_at` fields used here. Current [database function guidance](https://supabase.com/docs/guides/database/functions) and the [table API exposure change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically) were checked. Explicit private-table denial and function grants do not depend on automatic table exposure.

## Verification

`node --test canvas.test.mjs` executes the exact proposal after the established synthetic application schema under PGlite. It verifies two-participant sharing, per-resource conflict handling, safe retries after edit/deletion, cross-chat task/source denial, rich block existence, approval/membership removal including replay, anonymous and direct-private denial, field bounds, calendar dates, all-200 inclusion/capacity, and independent task/plan revisions. Synthetic local state only; no real messages, tasks or users are created by this suite. The local SQL tests do not simulate multiple physical Postgres connections; row-lock use and lock ordering are reviewed in the proposal, while sequential competing revisions are executed.
