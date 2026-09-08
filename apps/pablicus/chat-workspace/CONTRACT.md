# Rich messages and saved conversation

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

## `start_saved_conversation`

Authenticated RPC with no arguments returns a conversation UUID. It creates a normal `group` conversation titled `Избранное` with exactly one member, the requesting approved user. An inaccessible private mapping uniquely identifies each owner's conversation; concurrent creation is serialized by locking that owner's profile row. Repeated calls return the same conversation.

No conversation or user data is created by deployment. Call only when the user chooses saved messages. Existing conversation listing, polling, message RLS, read markers and durable outbox work with this conversation. No invitation, task or shared-canvas APIs are added.

## Verification

`npm ci --ignore-scripts && npm test` runs the exact proposal on an isolated PGlite PostgreSQL fixture. No remote database or credentials are used. Tests cover message atomicity, block order, retry/dedup conflicts, membership and approval, storage path/ownership/size/MIME, privileges and saved-conversation isolation. PGlite serializes its single connection; cross-connection lock behavior follows PostgreSQL row locks but needs the existing PostgreSQL CI harness for true parallel-process testing.

Official references checked: [Database functions](https://supabase.com/docs/guides/database/functions), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Supabase changelog](https://supabase.com/changelog).
