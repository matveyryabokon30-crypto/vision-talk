# Task time, lifecycle, and project navigation

Additive extension of the existing conversation canvas and aggregate tasks API. Install `TASK_LIFECYCLE_SCHEMA_PROPOSAL.sql` after `CANVAS_SCHEMA_PROPOSAL.sql` and `TASKS_SCHEMA_PROPOSAL.sql`; install the reminder scheduler separately afterwards. The SQL file is a reviewed proposal, not a CLI-generated migration history file.

## Task fields

All existing task fields remain unchanged. `pablicus_get_canvas` and the mutation snapshots additionally return:

| Field | Meaning |
| --- | --- |
| `due_at` | Nullable ISO timestamp including offset; precise scheduled instant. |
| `due_timezone` | Nullable recognized IANA zone, such as `Europe/Moscow`, or `UTC`. |
| `reminder_minutes` | Nullable reminder lead time: `0`, `15`, `30`, `60`, or `1440`. Null disables advance reminder. |
| `followup_minutes` | `180` or null. A timed schedule defaults to 180 when this key is omitted; explicit null disables follow-up. |
| `archived_at` | Nullable server timestamp; archive does not imply completed. |
| `schedule_version` | Positive integer for event cancellation/deduplication; not the task edit revision. |

For timed tasks the server derives `due_date` from `due_at` in `due_timezone`. Date-only tasks have all scheduling fields null. They do not produce timed reminders.

A private BEFORE UPDATE trigger increments `schedule_version` on changes to the instant, zone, reminder/follow-up interval, assignee, completion, archive, or deletion. Title edits preserve the version; delivery workers must read the latest title. The trigger also protects updates from cached older clients.

## Create and edit

`pablicus_create_canvas_task_v2` takes every v1 parameter plus `p_schedule jsonb DEFAULT NULL`:

```json
{
  "p_conversation_id": "uuid",
  "p_task_id": "uuid",
  "p_title": "Prepare the recording",
  "p_assignee_id": "uuid or null",
  "p_due_date": "2026-09-10",
  "p_source_message_id": null,
  "p_source_block_id": null,
  "p_schedule": {
    "due_at": "2026-09-10T15:00:00+03:00",
    "timezone": "Europe/Moscow",
    "reminder_minutes": 60,
    "followup_minutes": 180
  }
}
```

`pablicus_update_canvas_task_v2` takes the v1 update parameters (`p_conversation_id`, `p_task_id`, `p_expected_revision`, `p_title`, `p_assignee_id`, `p_due_date`, `p_completed`) plus `p_schedule DEFAULT NULL` and `p_archived boolean DEFAULT NULL`.

- Null/omitted `p_schedule` preserves all existing time and reminder settings during update.
- `{}` or `{ "due_at": null }` explicitly clears time/reminders, retaining the supplied date.
- A nonempty timed schedule is a complete replacement; omitted reminder disables it; omitted follow-up enables the default 180-minute check.
- Null/omitted `p_archived` preserves archive status. True archives; false restores without changing completion implicitly.
- Postpone: send the new complete schedule/date, `p_completed: false`, `p_archived: false`.
- Completed: set `p_completed: true`. The task leaves active lists and appears in completed history; it does not require deletion.
- Archive: set `p_archived: true`, preserving whether the task was completed.

Mutations atomically validate membership/approval, lock the conversation canvas, check revision and assignee/source membership, write, then return a complete canvas snapshot. Same-value retries are safe; conflicting edits fail with `40001`. Create UUID replay checks normalized immutable payload and original creator, including after deletion. All schedule values are validated on the server, with no user-supplied current-time value.

Existing v1 updates preserve added columns. A v1 date change on an already timed task is rejected with `task_schedule_requires_v2` rather than corrupting its scheduled instant. V1 completion still cancels scheduled jobs through the same trigger.

The create cap counts 200 active tasks per conversation only; completed/archived tasks free active capacity. Canvas snapshots include all nondeleted tasks without silent history truncation. Global history uses pagination.

## Lists and counters

`pablicus_list_tasks_v2(p_view='open', p_query='', p_today=CURRENT_DATE, p_cursor=NULL, p_limit=40, p_timezone='UTC')` returns:

```json
{
  "tasks": [],
  "next_cursor": { "created_at": "2026-09-09T12:00:00.123456+00:00", "id": "uuid" },
  "total_count": 81
}
```

`next_cursor` is null at the end. Pass it back unchanged; client conversion through a JavaScript Date loses timestamp precision. Limit is 1–60. Total count covers the current view/search across all pages, excluding the cursor boundary. Tasks include existing aggregate labels `conversation_id`, `conversation_title`, `assignee_name` and the new fields above.

| View | Filter |
| --- | --- |
| `open` | All active shared tasks; excludes completed and archived. |
| `mine` | Active tasks assigned to the caller. |
| `overdue` | Active timed tasks before the server's transaction time; date-only tasks before `p_today`. |
| `today` | Active caller-assigned or unassigned shared tasks; timed date evaluated in caller `p_timezone`, date-only equals `p_today`. |
| `completed` | Completed tasks that have not been archived. |
| `archived` | Archived tasks, both completed and incomplete. |

The browser supplies its local YYYY-MM-DD as `p_today` and IANA zone as `p_timezone`. Current-time deadline comparison comes from PostgreSQL, not a client clock. These are display filters, never authorization. Deleted tasks never appear in any list. The old aggregate API also excludes archived tasks.

## Project quick access

`pablicus_list_projects(p_query='', p_cursor=NULL, p_limit=40)` returns:

```json
{
  "projects": [{
    "conversation_id": "uuid",
    "title": "First line of the canvas, at most 120 characters",
    "conversation_title": "Participant or group title",
    "body_preview": "At most 240 characters",
    "updated_at": "2026-09-09T12:00:00+00:00",
    "revision": 3
  }],
  "next_cursor": { "conversation_id": "uuid" },
  "total_count": 81
}
```

One current canvas per conversation remains the data model. This endpoint aggregates all nonempty accessible canvases, rather than introducing multiple canvas records inside one conversation. Stable ascending `conversation_id` keyset pagination avoids repeats when a project is edited. Search matches body or conversation label literally, case-insensitively. The chip opens `conversation_id` in its canvas tab. Counts cover all matching projects without a first-page cap.

## Authorization and deletion

Private tables keep RLS, explicit deny policies, and no direct grants to authenticated or anonymous clients. Public wrappers are invoker functions, with EXECUTE granted only to authenticated users. Private definer implementations validate an approved current caller, hold approval/membership locks through each operation, and use an empty search_path. Neither project summaries nor task results expose email, original create payload, deleted source text, or private scheduling internals.

Delete uses the existing guarded `pablicus_delete_canvas_task`. It removes the task from active, completed, archive, canvas, and aggregate views; strips title, assignment, date, schedule, and source references. A minimal inaccessible tombstone retains its identity and SHA-256 create-request fingerprint so delayed network retries cannot recreate a deleted task. No previous task prose remains in the tombstone. Existing database backups follow the hosting retention policy; this API does not claim to erase backups.

## Verification

`task-lifecycle.test.mjs` executes the exact proposals in synthetic PGlite fixtures. Cases cover normalization, midnight timezone boundaries, opt-out/default reminders, version invalidation, retries/conflicts, v1 preservation, completion/archive/postpone, pagination/counts, deletion without resurrection/content retention, project boundaries, membership/approval/anonymous denial, and helper/table ACL.
