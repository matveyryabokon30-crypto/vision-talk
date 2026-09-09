# Search, chat materials and storage usage

`SEARCH_SCHEMA_PROPOSAL.sql` is additive and applies after `ACTIONS_SCHEMA_PROPOSAL.sql`. The file is a reviewable deployment proposal; deployment is recorded separately. It creates no messages, storage objects, users or conversations and changes no existing message/storage policies.

All three public RPCs are read-only `SECURITY INVOKER` entry points to a private `SECURITY DEFINER` implementation with an empty `search_path`. Anonymous execution is revoked. The private implementations validate the current authenticated user against `public.profiles.is_approved`; chat queries additionally check the requested conversation's membership directly on each call. No user-editable metadata or cached session flags authorize access. Internal helpers have no authenticated execution grant. Deleted messages are explicitly excluded because a definer must enforce that visibility rule itself.

## Message search

```js
supabase.rpc('pablicus_search_messages', {
  p_conversation_id: conversationId,
  p_query: query,
  p_before_seq: null,
  p_limit: 30
})
```

Each returned row has these fields:

| Field | Meaning |
| --- | --- |
| `message_id` | Stable original message UUID, used to locate the message in the chat |
| `server_seq` | Message sequence, also the next-page cursor |
| `sender_id` | Author UUID; resolve their display name through existing authorized profile data |
| `created_at` | Original timestamp |
| `snippet` | Up to 280 characters around the first match, with up to 80 preceding characters |
| `message_revision` | Current edit revision |

Search is a case-insensitive **literal substring** over effective text. `%`, `_`, and backslash have no wildcard meaning. Trimmed query length must be 1–200 characters, raw query no more than 1,600 bytes. For rich messages, effective text is reconstructed from `coalesce(edited_content, attachment_metadata).blocks`, using text blocks only. For legacy messages it is `coalesce(edited_body, body)`. Original text overwritten by an edit does not match; media names belong in materials search.

Results use `server_seq DESC` across the complete authorized conversation history. Request the next page with the last row's `server_seq` as `p_before_seq`. The sequence cursor is exclusive, positive, and can be passed through unchanged. Page size defaults to 30 and must be 1–100. There is no total count; a full page may have another page, and an empty subsequent page ends the list. Reset the cursor when query or conversation changes. New sends do not reorder previous sequences; edits/deletions between pages can change live results, so refresh begins a new traversal.

## Chat materials

```js
supabase.rpc('pablicus_chat_materials', {
  p_conversation_id: conversationId,
  p_kind: 'documents', // media | documents | audio | links
  p_query: '',
  p_before_seq: null,
  p_before_index: null,
  p_limit: 40
})
```

| Field | Meaning |
| --- | --- |
| `message_id`, `server_seq`, `sender_id`, `created_at` | Source message identity, position, author and timestamp |
| `block_id` | Actual stable rich block ID; null for legacy messages |
| `block_index` | Opaque zero-based ordinal among all flattened material items in this message; use only for paging |
| `kind` | `media`, `documents`, `audio`, or `links` |
| `type` | `image`, `video`, `document`, `audio`, or `link` |
| `path` | Private `message-media` object path; null for links |
| `name`, `mime`, `size` | Attachment name, MIME and bytes; links use their URL as name with null MIME/size |
| `body` | Up to 280 characters of effective source text as context |
| `url` | Detected HTTP/HTTPS URL; null for attachments |
| `duration` | Rich audio/video duration hint where present; null otherwise |

Rich image/video blocks map to `media`, document blocks to `documents`, and voice/audio blocks to `audio`. Legacy `file`, `image`, `video`, and `document` rows are supported through `attachment_path`; their legacy `mime_type`/`size_bytes` metadata is normalized. A legacy file with audio MIME is classified as audio. Text blocks and legacy text/captions contribute HTTP/HTTPS links from effective edited content. Each detected occurrence is retained, including multiple links in one text block; common trailing prose punctuation is stripped. Link extraction performs no network fetch or preview generation. Clients must still validate HTTP/HTTPS before opening a URL and render returned strings as text.

Filename/text filtering uses the same literal case-insensitive substring semantics. It searches the original filename or URL and the complete effective message text, including text beyond the returned context snippet. Empty/null query means all matching materials; trimmed query is at most 200 characters and raw query at most 1,600 bytes.

Results use `server_seq DESC, block_index ASC`. To continue, pass **both** the last row's `server_seq` and `block_index`. The next page includes later material items from that same message before continuing to older messages, so multiple documents or voice blocks remain visible even at a page boundary. Never use `block_index` to index rich content or manufacture a block ID. The two cursor arguments must be both null or both supplied; sequence must be positive and index 0–100,000. Default page size is 40, allowed range 1–100. There is no total count. Reset pagination when kind/query/conversation changes. Grouping rows by `message_id` in the UI must preserve each block and URL.

This RPC returns authorized private object paths, not signed URLs. Use existing storage signing/download functions to access a selected object. Message deletion hides materials but does not delete their underlying stored objects.

## Storage usage

```js
supabase.rpc('pablicus_storage_usage') // no arguments; singleton row array
```

| Field | Meaning |
| --- | --- |
| `total_bytes` | Sum of known object sizes across the application's `message-media` bucket |
| `own_bytes` | Known-size subset owned by the current authenticated user |
| `object_count` | Count of stored objects in that bucket, including unknown sizes |
| `own_object_count` | Current user's subset of the object count |
| `unknown_size_count` | Objects whose size metadata could not be counted |
| `measured_at` | Database statement timestamp |

Values come from `storage.objects.metadata.size`, not browser state or attachment declarations. Ownership uses `owner_id` with fallback to the legacy `owner` UUID. Other buckets and deletion markers are excluded. Stored archived versions count because they remain stored; completed unsent uploads and files from soft-deleted messages also count. Unknown sizes are omitted from byte sums and separately counted, so a nonzero `unknown_size_count` means the displayed bytes are a known minimum.

The total is intentionally an **application aggregate**, not a list or per-conversation breakdown. An approved user can read this aggregate and their own amount without gaining access to object names, ownership records, other users' private files, or private conversations. The RPC provides no quota, plan allowance, billing meter, or remaining capacity; label it as stored chat files. SQL sums are numeric; convert to display-safe numbers when formatting units and do not infer an entitlement from the totals.

## Errors, query plan and verification

Authorization errors use `42501`; malformed query/cursor/limit values use `22023`. UI adapters should present an unavailable/retry state for RPC failures instead of showing zero usage or an empty successful search.

Existing `UNIQUE(conversation_id, server_seq)` provides an ordered B-tree range for both history cursors. No duplicate sequence index is added. Literal substring search evaluates the authorized history in the database; it has no 120-message client window and introduces no unsupported language stemming/ranking. This first implementation does not add a full-text or trigram index. Very large conversations may eventually warrant an indexed search representation based on measured query timings.

`npm test` includes `search.test.mjs`, which runs the exact SQL file on an isolated PGlite fixture. It checks approved membership, anonymous/outsider denial, immediate membership revocation, edited/deleted text and links, history beyond 120 messages, literal wildcard characters, complete keyset paging, multiple materials/URLs from one message across single-row pages, legacy metadata, complete-caption filtering, parameter bounds, private grants, read-only transactions, and real object aggregates including unknown sizes and retained versions. Tests create synthetic data locally only. The fixture explicitly mirrors current production Storage ownership/deletion-marker columns.

References checked: [Supabase database functions](https://supabase.com/docs/guides/database/functions), [Storage schema](https://supabase.com/docs/guides/storage/schema/design), [Supabase changelog](https://supabase.com/changelog).
