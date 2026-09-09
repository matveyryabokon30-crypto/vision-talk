# Rich messages and saved conversation

Search, paginated materials and aggregate storage usage are specified separately in [SEARCH_CONTRACT.md](SEARCH_CONTRACT.md).

This additive SQL proposal targets the inspected production schema. Deployment status is recorded separately; this document does not assert deployment.

## `send_rich_message`

Authenticated RPC arguments:

```js
{
  p_conversation_id: conversationUUID,
  p_client_message_id: stableMessageUUID,
  p_content: {
    v: 1,
    blocks: [
      { id: 'text_1', type: 'text', text: 'Before the photo' },
      { id: 'photo_1', type: 'image', path: `${conversationUUID}/${userUUID}/${stableMessageUUID}/photo_1/photo.jpg`, name: 'photo.jpg', mime: 'image/jpeg', size: 12345 },
      { id: 'text_2', type: 'text', text: 'After the photo' }
    ]
  }
}
```

Returns one ordinary `public.messages` row with `type: 'rich'`, exactly one `id` and `server_seq`, `attachment_path: null` and the ordered content in `attachment_metadata`. `body` is the server-generated newline-joined text, or a media-name summary for conversation previews. The viewer renders `attachment_metadata.blocks` in order; `body` is only a preview/fallback.

Each block has a unique stable ID matching `[A-Za-z0-9_-]{1,128}`. Supported media types: `image`, `video`, `audio`, `document`. Media optional `width`, `height` and `duration` are positive numbers, dimensions up to 16384 and duration up to 7200 seconds. They are display hints, not trusted transcoding metadata. Unknown keys and unknown block types are rejected. Empty text blocks are omitted by the composer before send.

Limits: 1–100 blocks, 5000 text characters including joining newlines, 25 MiB per media, 100 MiB aggregate media, 200000 bytes JSON. Names are 1–255 characters. Storage basename matches `[A-Za-z0-9_-][A-Za-z0-9._-]{0,254}`; original Unicode filename stays in `name`. Upload path is exactly `conversation/owner/message/block/basename`.

All media must finish uploading before calling the RPC. Every object must exist in private `message-media`, belong to `auth.uid()`, and have matching storage size and MIME. MIME comparison ignores case and `;codecs=…` parameters. Image/video/audio types use explicit MIME allowlists; arbitrary documents remain download attachments. No video conversion or transcoding is introduced.

Authorization: authenticated, approved account and conversation membership, checked on the server. Existing storage policies stay unchanged. Server checks every block before incrementing `last_seq` and inserting the one message. A failed final block produces no sent row and consumes no sequence. Completed but unsent uploads remain private to conversation members, as under existing bucket policies; uploading is not publication as a message.

Retry the exact same UUID and content until acknowledged. The same request returns the same row without another sequence or message; reusing its UUID with different content/conversation fails with `23505 client_message_conflict`. Keep the ordered JSON unchanged during a queued retry. A lost response must not cause a new client UUID. Old `send_message` and `send_attachment_message` remain unchanged for existing queued messages.

## Replies to a message or one block

`REPLY_SCHEMA_PROPOSAL.sql` applies **after** the rich-message schema. It replaces only the existing private implementation. It does not create tables, add grants, change RLS, touch old messages, or change the public RPC signature. `CREATE OR REPLACE` preserves the restricted function privileges; a precondition fails closed if the original implementation is absent.

Optional `p_content.reply_to`:

```js
// Answer the complete message (including a legacy text/file message).
reply_to: { message_id: originalMessageUUID }

// Answer this voice recording inside the original mixed message.
reply_to: { message_id: originalMessageUUID, block_id: 'voice_2' }
```

Omit `reply_to` for ordinary messages. Explicit JSON `null` is also accepted. If present, its only keys are `message_id` (canonical hyphenated UUID) and optional `block_id` (`[A-Za-z0-9_-]{1,128}`). A null `block_id`, malformed values and caller-supplied author/quotation fields are rejected with `22023`. Every rich block can be addressed, including separate audio blocks inside the same message.

The server first checks authentication, approval and membership as before. For a new send, the referenced message must exist in **the same conversation**, even if the sender belongs to several conversations. A block reference additionally requires a rich target containing that exact stable block ID. A row lock keeps the target intact through the insertion. Failed reference/media validation creates no message and consumes no sequence.

The reference is retained in `attachment_metadata.reply_to`. The reply remains one normal rich message; it does not duplicate the original attachment. Resolve quoted text and author from the authorized original message, never from untrusted supplied preview text. If the original is later unavailable, render a missing-original state while retaining the reference.

Idempotency compares the entire JSON, including `reply_to`: changing only the target with the same client UUID returns `23505 client_message_conflict`. Keep null versus omitted form stable during retries. An acknowledged retry returns the existing reply even if its target was subsequently removed; a new send referencing the removed target is rejected.

## `start_saved_conversation`

Authenticated RPC with no arguments returns a conversation UUID. It creates a normal `group` conversation titled `Избранное` with exactly one member, the requesting approved user. An inaccessible private mapping uniquely identifies each owner's conversation; concurrent creation is serialized by locking that owner's profile row. Repeated calls return the same conversation.

No conversation or user data is created by deployment. Call only when the user chooses saved messages. Existing conversation listing, polling, message RLS, read markers and durable outbox work with this conversation. No invitation, task or shared-canvas APIs are added.

## Verification

`npm ci --ignore-scripts && npm test` runs the original proposal and the reply extension on an isolated PGlite PostgreSQL fixture. No remote database or credentials are used. Tests cover message atomicity, block order, retry/dedup conflicts, membership and approval, storage path/ownership/size/MIME, privileges and saved-conversation isolation. Reply checks cover whole/legacy messages, each rich block and multiple voice recordings, malformed references, cross-conversation targets, missing/deleted originals, revoked membership, atomic failure, exact retry semantics and unchanged function privileges. PGlite serializes its single connection; cross-connection lock behavior follows PostgreSQL row locks but needs the existing PostgreSQL CI harness for true parallel-process testing.

Official references checked: [Database functions](https://supabase.com/docs/guides/database/functions), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Supabase changelog](https://supabase.com/changelog).
