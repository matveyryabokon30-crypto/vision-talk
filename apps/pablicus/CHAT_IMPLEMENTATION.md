# Pablicus chat: ordered multimodal messages

## Current agreed scope

The user's latest requirement is one editable message body containing text,
photos, video, audio and documents in insertion order. Text can continue after
each attachment. Recording must leave editing and the attachment menu usable.
Sending completes the current recording and publishes one message.

The existing Gate-derived chat, fullscreen composer, account/conversation draft
scoping, durable outbox and server ordering remain the base. `rich_bridge.py`
adapts those sources for the product build without rewriting archived gates.

## Implemented

- Ordered text/media blocks, cursor insertion and expanding/fullscreen editing.
- Microphone recording alongside text and file insertion; a finished recording
  is an audio block in the same draft. Runtime interruption stops and retains
  the available recording. Closing a chat or changing accounts stops and saves.
- Original attachment Blobs and ordered blocks in IndexedDB; revision conflicts
  prevent another tab silently replacing a draft. Database version 2 excludes
  older clients from overwriting the new draft representation.
- One immutable queue item, one rich RPC, one server row and sequence number.
  All uploads finish before publication. Retry accepts only the same complete
  payload. Lost ACKs do not create another message or retire different bytes.
- Inline image preview and tap-to-open image/video/audio/document viewer.
- Owner-scoped `Избранное`, created only when the user opens it.

## Server and release

`chat-workspace/SCHEMA_PROPOSAL.sql` is the exact SQL applied to the existing
Supabase project with migration
`pablicus_ordered_rich_messages_and_saved_conversation` on 2026-09-08.
Public RPCs are invokers; private definers check approved membership and every
storage object's owner, path, size and MIME. Existing Auth and storage policies
are preserved. No test users or conversations are created by the migration.

The existing release workflow tests the source before publishing only
`/vision-talk/pablicus/`; the repository's other applications remain separate.
It verifies published bytes against the asset manifest and checks public login.

## Verification and limits

- Isolated PostgreSQL/PGlite tests exercise the exact migration, authorization,
  atomic publication, retry conflicts and saved-conversation ownership.
- Real IndexedDB tests exercise block order, Blob durability, queue atomicity,
  conflicts and account/conversation isolation.
- Full built-app tests use explicit mocked Supabase transport and microphone:
  text/photo/text/video/document/voice/document/text, one row/bubble, exact
  original bytes, lost ACK, conflicting ACK and scope transitions.
- Existing login and queue tests remain release gates. Chromium and WebKit run
  in CI. A virtual/mock microphone does not validate physical iPhone capture.

Limits: 5000 text characters, 100 blocks, 25 MiB per attachment and 100 MiB of
attachments per message. Finished audio is durable; an unfinished recording
cannot be recovered after the browser process is killed. The app reports that
interruption and retains the other draft blocks. OS file pickers/backgrounding
may interrupt an iPhone microphone and require device testing. Original videos
are sent without server transcoding; playback depends on browser codec support.

## Next chat work

Return to the supplied visual reference after this functional slice: inline
replies from Focus, actions on existing messages, and a shared conversation
canvas. The reference's shared plan, tasks and assistant are not implemented by
this release. Existing assistant/action placeholders must not be described as
real AI execution. Feed, tasks, push, automatic video conversion and a full
reference-layout redesign are still separate work.
