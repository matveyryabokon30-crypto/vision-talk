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
  prevent another tab silently replacing a draft. Database version 3 excludes
  older clients from overwriting the new draft representation.
- One immutable queue item, one rich RPC, one server row and sequence number.
  All uploads finish before publication. Retry accepts only the same complete
  payload. Lost ACKs do not create another message or retire different bytes.
- Inline voice playback, pause and seek, one voice at a time; no audio modal.
- Adjacent photos/videos form compact albums (up to four visible tiles and a
  remaining-count tile). Text, audio and document blocks preserve group order.
- Black viewport-sized photo/video viewer, gallery navigation and authenticated
  download; documents retain their existing viewer.
- Replies to a whole message or an individual rich block. The reference survives
  draft restoration, offline queueing and retry; quotes come from the actual
  target message. IndexedDB v3 blocks older writers from erasing reply metadata.
- A draggable side monitor above the composer receives messages from other
  conversations through Realtime plus ordered polling. It scrolls internally,
  previews muted video and collapses/dismisses without deleting chat messages.
  Opening its conversation first saves the current draft.
- Owner-scoped `Избранное`, created only when the user opens it.

## Server and release

`chat-workspace/SCHEMA_PROPOSAL.sql` is the exact SQL applied to the existing
Supabase project with migration
`pablicus_ordered_rich_messages_and_saved_conversation` on 2026-09-08.
`chat-workspace/REPLY_SCHEMA_PROPOSAL.sql` was applied as
`pablicus_rich_message_replies` on 2026-09-08. It replaces only the private
rich-send implementation, checks that each reply target belongs to the same
conversation and validates a referenced block. Existing acknowledged retries
remain valid if the original message was later removed.

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
- Playable WAV/WebM fixtures in `message_interactions.py` exercise inline audio,
  fullscreen media, download, durable block replies and incoming monitor events.
  `inbox_monitor.py` covers queue bounds, account changes and delayed media URLs.
- Existing login and queue tests remain release gates. Chromium and WebKit run
  in CI. A virtual/mock microphone does not validate physical iPhone capture.

Limits: 5000 text characters, 100 blocks, 25 MiB per attachment and 100 MiB of
attachments per message. Finished audio is durable; an unfinished recording
cannot be recovered after the browser process is killed. The app reports that
interruption and retains the other draft blocks. OS file pickers/backgrounding
may interrupt an iPhone microphone and require device testing. The side monitor works while the application is open; it is not OS push. Original videos
are sent without server transcoding; playback depends on browser codec support.

## Next chat work

Return to the supplied visual reference after this functional slice: inline
replies from Focus, additional message actions, and a shared conversation
canvas. The reference's shared plan, tasks and assistant are not implemented by
this release. Existing assistant/action placeholders must not be described as
real AI execution. Feed, tasks, push, automatic video conversion and a full
reference-layout redesign are still separate work.


## Compact actions and people discovery follow-up

The centered message-action dialog is replaced with an anchored 220px menu and
small contextual forms. Available actions are reply, copy, pin/unpin, forward,
select, download, edit own text and delete own messages; reactions are shared.
Edits preserve media placement and original send identifiers. The actions RPC
stores text overlays and a revision; a conflicting edit cannot overwrite newer
text silently. Deleted rows are hidden from REST by a restrictive SELECT policy,
and list RPC previews/unread counts omit them. Deletion is a server tombstone,
not a claim of secure media erasure or revoking already downloaded copies.

The migrations applied on 2026-09-08 are `pablicus_message_actions` and
`pablicus_people_and_direct_conversations`. Exact proposals are in chat-workspace.
Action state is polled for already loaded messages because edits/reactions do
not allocate a new message sequence. Forwarding downloads authorized source
bytes, preserves the destination draft, and waits for the user's Send action.
It does not send in the background on selecting the menu item.

The voice strip uses a waveform derived from actual decoded audio, inline
play/pause and an accessible seek input. Waveform decoding is optional and bounded;
a straight progress track remains usable when the browser cannot decode it.
The minimal stylesheet removes the inherited hidden toolbar grid tracks and
retains the established light/dark purple palette.

People can be found by display name, username or a shared `?person=` link.
Shared links still require explicitly selecting the intended profile. Profiles
show a Share/Copy link action. The direct-conversation RPC serializes both
participants through the same lock and reuses their existing conversation.
The directory returns only public name/handle/avatar fields to approved users.
Phonebook import and automatic matching by unverified phone numbers are absent.

### Voice speed deferred (release scope decision)

Playback speed was an optional implementation addition, not part of the user's
requested compact voice redesign. Its button and all native playbackRate writes
were removed from this release after WebKit failed the rate/resume scenario.
The failure persisted with valid byte ranges and a real threaded HTTP fixture;
diagnostics showed WebKit reporting native duration 0 while decoded PCM had the
correct duration. No unsupported speed control is shipped. Core playback, pause,
seek, per-voice reply, one active voice, waveform fallback, end-of-stream replay
and cleanup remain required checks. Future speed support needs separate browser
and physical-device validation.
