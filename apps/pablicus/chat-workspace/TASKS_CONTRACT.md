# Shared task list

`POST /rest/v1/rpc/pablicus_list_tasks` requires the current user's authenticated session and current approved profile. It reads existing canvas tasks across that user's current conversation memberships. It creates no rows and never changes read markers.

Arguments (named; all optional when omitted):

| Argument | Default | Meaning |
| --- | --- | --- |
| `p_view` | `open` | `open`, `mine`, `overdue`, or `completed` |
| `p_query` | empty string | Trimmed, case-insensitive literal substring of task title; at most 200 characters / 800 bytes. `%` and `_` are literal characters. |
| `p_today` | database `CURRENT_DATE` | Client local date `YYYY-MM-DD` to define overdue, 1900–9999 inclusive. |
| `p_cursor` | `null` | Prior response's exact `{created_at, id}`; both strings. |
| `p_limit` | `40` | Integer 1–60. |

`open` includes every noncompleted task accessible to the caller, including unassigned and other people's tasks. `mine` includes only noncompleted tasks assigned to the caller. `overdue` includes only noncompleted tasks whose non-null due date is earlier than `p_today`; today is not overdue. `completed` includes completed tasks. Deleted tasks never appear in any view.

Response is a JSON object, not a row array:

```json
{
  "tasks": [
    {
      "id": "uuid",
      "title": "Book studio",
      "assignee_id": "uuid or null",
      "due_date": "2026-09-15 or null",
      "completed": false,
      "revision": 0,
      "source_message_id": "uuid or null",
      "source_block_id": "block id or null",
      "created_at": "timestamp",
      "created_by": "uuid or null",
      "updated_at": "timestamp",
      "updated_by": "uuid or null",
      "conversation_id": "uuid",
      "conversation_title": "Katya",
      "assignee_name": "Katya or null"
    }
  ],
  "next_cursor": {"created_at": "timestamp", "id": "uuid"}
}
```

Task fields exactly match the public fields of `pablicus_get_canvas`. Conversation title matches `my_conversations_v3`: explicit stored title (including `Избранное`), otherwise the first current approved peer's display name or `@username`, otherwise `Диалог`. Assignee name is null if unassigned, removed from the conversation, or no longer approved. No source message content, contact details, task replay payload, or deletion metadata is returned.

Order is immutable `created_at DESC, id DESC`. `next_cursor` is null at the end. Its two fields describe the last returned task; the server looks one row ahead to decide whether a next page exists. Preserve the timestamp's microseconds exactly; do not parse and reserialize it through JavaScript `Date`. The cursor is an ordering boundary, not a capability; forged or stale cursor values cannot expand conversation access. Changing view, query, or local date must reset the cursor. A live view is not a frozen snapshot: concurrent edits may change filter membership; refresh from the first page for current results, merge by task ID, and never sort by `updated_at`.

Invalid views, null/oversized search strings, limits, dates and malformed cursors return `22023`. Cursor must contain exactly `created_at` (ISO timestamp including timezone and up to six fractional digits) and `id` (canonical UUID), with no other keys. Anonymous/missing identity or unavailable/unapproved caller returns `42501` (anon is also denied EXECUTE). An approved caller without memberships gets `{tasks: [], next_cursor: null}`.

The public function is SECURITY INVOKER; its private SECURITY DEFINER implementation has an empty search path, checks and SHARE-locks current caller approval, and joins and SHARE-locks each page's current membership rows. Concurrent membership deletion/approval revocation therefore completes before or after the authorized read. Locks last only for the RPC transaction. Client roles gain no access to task tables. This migration only adds an index and two functions.

Updates, completion, and deletion continue through existing conversation-scoped canvas RPCs with task revision checks. Navigation can use `conversation_id` to open the conversation canvas and `id` to locate the task; source navigation separately checks current source existence.
