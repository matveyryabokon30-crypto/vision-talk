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

The shared conversation plan and checklist are now implemented below. Remaining
reference work includes inline replies from Focus, the assistant, event-specific
participation controls and a fuller canvas layout. Existing assistant/action
placeholders must not be described as real AI execution. Feed, automatic video
conversion and a cross-conversation task aggregation remain separate work.


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
now uses the neutral white/translucent palette described below.

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

Native seek capability is separate from decoded waveform duration. If a browser
reports an unseekable stream, its waveform and time display continue, but the
seek control is disabled and forced input cannot change native position. A
positive native duration and a non-empty seekable range enable actual scrubbing.

Native timeline queries wait until media metadata is available. Querying
`seekable` during initialization made WebKit/GStreamer cache the current position
as an unknown duration, producing premature end-of-stream. The real HTTP fixture
now checks that the compact player retains the same 12-second native timeline as
a plain audio element, alongside pause, actual six-second seeking and replay.

## White/translucent design and system notifications

The user confirmed successful two-account text, voice, photo, video and document
exchange with Katya before this change. Preserve that working transport.

Purple surfaces and outlines are replaced by neutral white/translucent surfaces,
subtle gray edges and monochrome controls. The home wordmark is removed; the
regular-weight title is `Чат`. The conversation header retains the recipient.
Message actions open on tap, long press, context menu or focused Enter/Space;
there are no per-message ellipsis buttons. Inline media controls remain usable.

Visible message metadata uses time and small SVG symbols: clock for queued or
sending, hollow circle for server-accepted, filled circle for read, exclamation
for failure. Accessible labels explain the symbols. Server acceptance does not
prove delivery to another device, and push-provider acceptance is not a read
receipt. No new device-delivery state is invented.

`push/` contains the private notification outbox and encrypted Web Push worker.
The profile offers per-device opt-in, and the service worker opens only a
conversation belonging to the current bound recipient. No app-icon badges are
set. Each iPhone user must open the installed Home Screen app, choose Profile →
Enable notifications and approve the system prompt. Physical lock-screen
delivery remains a user acceptance check after consent, separate from the
previously confirmed message transport.

Applied on 2026-09-08: `pablicus_web_push_prerequisites`,
`pablicus_private_web_push_outbox`, `pablicus_web_push_retry_worker`.
`pablicus_push_network_permissions` attempted to restrict extension ACLs, but
live readback showed provider-owned grants could not be revoked by postgres.
The network and private push schemas are not exposed through REST (HTTP 406
verified for both). Worker launch uses short-lived, single-use capabilities;
the reusable server secret is never put in the network queue.
The deployed worker returned HTTP 200 with zero claimed/sent jobs during its
empty-queue initialization, and a stable VAPID key was created on the server.
No test notification was sent to either real account.

## Full-history search, materials and storage

The conversation header now opens materials by tapping the recipient name; a
small search button opens text search. Both share a neutral mobile dialog with
Search, Media, Files, Voice and Links tabs. Search queries the complete authorized
conversation, including effective edits, instead of filtering the loaded history.
Materials preserve individual rich block IDs and use a message/block cursor, so
multiple attachments from one message cannot disappear at a page boundary.
Files can be filtered by original filename or source text, downloaded, and traced
back to their original message. Images/videos use the existing viewer; audio
plays inline. HTTP(S) links open separately without automatic previews.

Locating an old message loads its contiguous neighborhood and replaces the
timeline window. Combining a distant old range with the latest range would leave
an invisible history gap; replacing the window allows normal older-page loading
and forward catch-up. Drafts and the outgoing queue are preserved. Search and
media requests are canceled or discarded after tab, conversation or account
changes; closing the catalog releases audio sources.

Profile → Storage displays actual retained bytes in `message-media`, separately
showing the app total and the current user's uploads. It does not display a plan
quota or claim that the stored total is a monthly allowance. Unsent uploads and
retained files from deleted messages still occupy space. Unknown metadata and
failed measurements have explicit states rather than an invented zero.

Applied on 2026-09-09: `pablicus_chat_search_materials_storage`, using
`chat-workspace/SEARCH_SCHEMA_PROPOSAL.sql`. Live catalog readback confirms three
public invoker wrappers, guarded private implementations and revoked anonymous
execution. Anonymous HTTP calls to all three public RPCs return 401. The security
advisor has no new findings compared with the pre-migration baseline. Detailed
interfaces and storage semantics are in `chat-workspace/SEARCH_CONTRACT.md`.

The SQL suite passes 59 tests. `tests/chat_library.py` exercises a 277-message
synthetic conversation, text and same-message material pagination, edits, original
message navigation, download, real inline WAV playback, stale results, account
isolation and storage error states. The release workflow requires this test in
Chromium and WebKit before promotion. Local Chromium passes; local WebKit is
blocked by incompatible native dependencies and is validated by the CI gate.
These checks do not represent a physical iPhone acceptance test.

## Shared conversation canvas

The `Разговор / Полотно` tabs sit below the existing centered chat header. The
canvas contains a shared plain-text plan and tasks with a title, optional current
participant assignee and due date, completion/reopening, editing and deletion.
All conversation participants can change the shared plan and tasks. The compact
message menu offers `Создать задачу`; it opens an editable title and keeps the
source message/block reference. `Из переписки` locates the original message.
The `Дела` home tab opens the canvases of the user's existing conversations; it
does not claim to show an aggregate task list or task counts across chats.

Saving is explicit. Plan revisions and task revisions are independent, so a
task change does not invalidate a plan edit. Conflicting edits retain local
fields and show the shared version before explicit replacement. The client
keeps the original task-creation UUID and payload when a response is lost;
subsequent field changes become an explicit edit after the creation is resolved.
The server keeps creation receipts after edits and soft deletion, preventing
retries from duplicating or resurrecting tasks. Deleting a task is shared and
requires the task's current revision.

The normal composer remains available under the canvas. Switching tabs persists
the draft without stopping microphone recording. It preserves pin/reaction
state, keeps unsaved plan/task edits in memory, and does not mark the hidden
message timeline read. Canvas request generations are independent of timeline
history paging. Polling occurs every eight seconds while the canvas is visible,
plus focus/manual refresh. Chat/account changes cancel pending responses and
clear canvas content. Explicit navigation warns before discarding unsaved edits;
unsaved canvas edits are not durable after browser termination. Message drafts
continue using the existing IndexedDB durability contract.

Applied on 2026-09-09: `pablicus_shared_conversation_canvas`, exactly as recorded
in `chat-workspace/CANVAS_SCHEMA_PROPOSAL.sql`. Two private RLS-denied tables are
accessed only through guarded functions and five public invoker RPC wrappers.
Every call, including retries, checks current approved membership. Assignees
must belong to the conversation; source messages/blocks are validated within it.
Live catalog readback confirms the guards' execution grants, no anonymous RPC
grants and no direct table access. The security advisor adds no new findings.
No production test tasks or messages were created. Auth, storage limits and the
existing message transport are unchanged.

`chat-workspace/canvas.test.mjs` tests the exact migration, access boundaries,
revisions, source/assignee validation, replay after edit/delete and capacity.
`tests/chat_canvas.py` exercises the built app with a synthetic shared backend:
plan/task operations, peer conflicts, lost responses, source navigation,
recording/draft preservation and stale responses after chat/account changes.
The release workflow requires the browser suite in Chromium and WebKit; physical
two-iPhone acceptance remains separate. Current canvas bounds: 20,000 plan
characters, 500 task-title characters and 200 retained nondeleted tasks per
conversation, with an explicit error instead of silently truncating the list.

Observer-driven list and composer size changes run in a coalesced animation
frame, avoiding synchronous resize feedback during WebKit observer delivery.
Pending layout callbacks are canceled on destruction. Historical navigation
tests validate the bounded source query and the complete contiguous interval,
including normal forward catch-up, rather than assuming the initial 61-row
window remains unchanged after navigation. Browser errors remain release failures.
