# Shared project and task content

Status: additive proposal, verified through executable PGlite SQL tests; not automatically applied. Requires `TASK_LIFECYCLE_SCHEMA_PROPOSAL.sql`. Keep the separately owned `TODAY_SHARED_SCHEMA_PROPOSAL.sql`, which adds rich content to cross-conversation task listings, after this schema.

The existing conversation canvas is the project's identity; no multiple-project table is introduced. Project and task content persists ordered text, image, video, audio and document blocks using the existing message format. URLs remain in text blocks and use the existing safe message link renderer.

## RPCs

```text
pablicus_save_canvas_plan_v2(
 p_conversation_id uuid,
 p_expected_revision integer,
 p_content jsonb
)
pablicus_create_canvas_task_v3(
 p_conversation_id uuid,
 p_task_id uuid,
 p_content jsonb,
 p_assignee_id uuid = NULL,
 p_due_date date = NULL,
 p_source_message_id uuid = NULL,
 p_source_block_id text = NULL,
 p_schedule jsonb = NULL
)
pablicus_update_canvas_task_v3(
 p_conversation_id uuid,
 p_task_id uuid,
 p_expected_revision integer,
 p_content jsonb,
 p_assignee_id uuid,
 p_due_date date,
 p_completed boolean,
 p_schedule jsonb = NULL,
 p_archived boolean = NULL
)
```

All return the current canvas snapshot. Expected revision is the individual task or `canvas.revision` integer, not the top-level aggregate bigint. New RPCs derive plain `body` and bounded `title`; callers do not send competing text.

`canvas.content` and snapshot `tasks[].content` contain `{v:1,blocks:[...]}`. Existing records are physically unchanged: NULL content is represented as the original text in a `legacy_text` block. Task listings may return NULL content for legacy rows; clients fall back to `title`.

The project index retains bounded summaries plus `attachment_count`. Attachment-only projects are included and use attachment names as their title. Saving empty blocks clears the project and removes it from the index.

## Content and uploads

```json
{"v":1,"blocks":[
 {"id":"brief","type":"text","text":"Brief\nhttps://example.org"},
 {"id":"photo","type":"image","path":"conversation-uuid/user-uuid/upload-uuid/photo/file.png","name":"file.png","mime":"image/png","size":1234},
 {"id":"after","type":"text","text":"Notes after the image"}
]}
```

UUID placeholders must be real lowercase UUIDs. Supported types and metadata are the existing rich-message types. Block IDs are unique, using 1–128 ASCII letters, digits, underscore or hyphen. Optional width/height/duration follow message limits. URLs, signed URLs, HTML and draft properties cannot replace stored media paths.

Limits: 100 blocks; combined text 20,000 Unicode characters and 80,000 UTF-8 bytes including separators; JSON 200,000 bytes; each file 25 MiB; attachment total 100 MiB. Task content is nonempty; empty project blocks clear it. Full task text can exceed 500 characters: only the list title is shortened to 500 Unicode characters. Attachment-only tasks use filenames as title.

Uploads use existing private `message-media` storage:

```text
<conversation uuid>/<uploading user uuid>/<stable upload uuid>/<block id>/<safe filename>
```

A new attachment must belong to the acting user, with actual storage `owner_id` matching the second folder. A peer attachment can be retained only if its same path, type, MIME and size are already linked to the exact project/task being edited. Knowing a peer path does not authorize adding it, including from another item in the same conversation. Copying peer material requires a new authorized upload.

The server locks/verifies the storage object and rejects delete markers, foreign paths, ownership mismatch, nonexistent objects, wrong size/MIME and oversized payloads. Live storage ACLs were verified read-only: upload/delete require membership and uploader path; reads require conversation membership. No storage policy or auth configuration changes are needed.

## Revisions, compatibility and deletion

Public entry points are security-invoker wrappers around guarded private functions that authorize approved conversation membership on every call. Helpers are uncallable by anon/authenticated. Private tables retain their existing RLS and denied direct grants. Conversation locking, source/assignee ACL checks and active-task capacity are retained.

Same-value project/update retries return current state before revalidating old attachments/assignees. Changed stale requests fail with `40001`. Caller-generated task IDs retain immutable canonical create payloads; equivalent schedule instants replay, but another actor or changed payload fails with `23505`. Replays never overwrite later edits or resurrect deleted tasks. Keep upload UUIDs and request content stable across uncertain retries.

Schedule semantics are unchanged: update `p_schedule=NULL` preserves the schedule; explicit empty schedule clears time/reminders; timestamp/timezone derive the local date. Existing schedule-version triggers handle completion/archive/assignee/timing changes. Content-only edits do not invalidate reminder versions.

Old task updates preserve rich content when changing metadata/completion/archive with the unchanged bounded title. Attempting to overwrite a rich title through an old RPC fails with `workspace_content_requires_v3` (`22023`). Old plain project save allows same-body retry but rejects changed text once rich content exists with `workspace_content_requires_v2`. These guards prevent silent attachment loss and competing text. Legacy NULL-content rows retain plain-text edit support.

The existing delete RPC clears content and retains only the existing SHA-256 create-request tombstone plus deletion metadata. It does not delete storage objects that may also be referenced by other messages/items; this matches existing media retention.

## Verification

Run `npm run test:workspace-content` here. Exact SQL is applied after synthetic pre-migration records, then tests cover migration preservation, ordered mixed content and links, all four attachment types, attachment-only items, peer edits, forbidden cross-item/foreign/private uploads, actual storage metadata, payload limits, revision conflicts, replay after edit/removal/deletion, legacy edit protection, scheduling/completion/archive, deletion scrubbing and denied direct/anonymous/unapproved access.

The official Supabase changelog and current storage/function documentation were checked on 2026-09-09; no announced breaking change affects this additive private-schema/function approach. Production deployment and post-apply advisors remain the coordinating agent's responsibility.
