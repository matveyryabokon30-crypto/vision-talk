# VISION TALK — ARCHITECTURE 1.0

Status: **approved technical direction after media prototype failure analysis**  
Date: 2026-09-05

## 1. Frozen baseline

- Recoverable code baseline: branch `baseline-media-v29` at commit `8dde48f5310982a07e9e96e3e7c54846a7407e6d`.
- Text delivery, server ordering, Realtime, read counters and offline text queue are not to be rewritten during the media rebuild.
- Experimental builds `media-v30` through `media-v35` are not production candidates.

## 2. Root cause of the current failures

The current prototype couples four independent systems in one browser element:

1. upload of the original file;
2. message creation;
3. rendering of the message row;
4. playback of the original video.

The current feed inserts a video row before stable media geometry exists, then mounts a raw signed Storage URL into `<video>`. When metadata arrives, the row can change height. That invalidates the scroll position and causes visible jumps. Opening the viewer creates or relocates another heavy media state and forces additional buffering/decoding. The chat also loads the complete history in ascending order and scrolls after rendering instead of opening on an end-anchored window.

This is an architectural defect, not a CSS defect.

## 3. Product constraints

Vision Talk must support:

- immediate optimistic appearance of a selected video;
- portrait, square and landscape media without layout shift;
- resumable upload after network interruption;
- videos of minutes, not only a few seconds;
- clear states: queued, uploading, processing, ready, failed, cancelled;
- instant opening of the latest part of a conversation;
- loading older history only when scrolling upward;
- media playback without downloading the original MOV into the feed;
- exact return to the same message after closing the viewer;
- Safari and Chrome on iPhone;
- authenticated private playback.

A product limit must still exist. “Any size” is not literal for real messengers. Vision Talk should initially define a maximum file size and maximum duration, then enforce those constraints before upload.

## 4. Target client architecture

### 4.1 Modular application

Replace the monolithic HTML runtime with modules:

- `auth/`
- `conversations/`
- `messages/`
- `outbox/`
- `media/`
- `player/`
- `storage/`
- `realtime/`

Use TypeScript with a reproducible build. UI code must not own transport logic.

### 4.2 Local database and outbox

Use IndexedDB as the local source for:

- conversation summaries;
- recent message windows;
- optimistic messages;
- upload jobs and resumable-upload fingerprints;
- media metadata and cached poster references;
- last read sequence and last visible anchor.

The screen first renders local state, then synchronizes with the server asynchronously.

Message identity and order:

- `client_message_id`: generated before network work;
- `server_seq`: authoritative monotonic order inside a conversation;
- duplicate inserts are idempotently reconciled by `client_message_id`;
- UI order is always `server_seq`, with local pending messages after the current server tail.

### 4.3 Message state machine

Text:

`local -> queued -> sending -> sent -> delivered/read`

Media:

`local -> queued -> uploading -> uploaded -> processing -> ready`

Failure branches:

`failed`, `cancelled`, `expired`

Upload progress must never be represented as message delivery status.

## 5. Chat-list architecture

### 5.1 End-anchored virtualized list

The conversation screen must not render the complete history.

Initial load:

1. request the latest 30–50 messages;
2. build rows using already-known dimensions;
3. mount a virtualized list anchored to the end;
4. reveal the screen only after the end anchor is established;
5. fetch older pages only when the user approaches the top.

Older-page insertion must preserve the visible anchor by stable message ID. There must be no repeated `scrollTop = scrollHeight`, timeout-based pinning or full-tree MutationObserver scanning.

### 5.2 Stable row geometry

Every media message stored on the server must include at least:

- width;
- height;
- duration for video;
- media kind;
- poster aspect ratio;
- processing state.

The bubble size is calculated before any image or video network request. Loading media may change pixels but never row geometry.

### 5.3 Scroll policy

- New incoming messages auto-follow only while the user is already near the bottom.
- If the user is reading older messages, show a “new messages” control; do not move the viewport.
- Closing media restores the exact message anchor and intra-row offset.

## 6. Video pipeline

### 6.1 Selection and immediate local rendering

When the user selects a file, the client performs one lightweight metadata pass:

- MIME/container check;
- byte size;
- width and height;
- duration;
- local JPEG/WebP poster;
- optional orientation correction.

The chat immediately shows a compact poster bubble with fixed geometry and circular upload progress. The original file is **not mounted as a playing `<video>` in the chat feed**.

### 6.2 Direct resumable upload

The browser requests a one-time upload endpoint from the Vision Talk backend. The original video uploads directly to the video pipeline by TUS. The API token is never exposed to the browser.

The client persists the TUS upload URL/fingerprint in IndexedDB and resumes after reconnect or page reopening. Closing or suspending an iPhone browser may pause work; resumability means continuing later without retransmitting completed chunks, not guaranteed native background execution.

### 6.3 Processing

The video service produces:

- normalized H.264/AAC renditions;
- adaptive-bitrate HLS;
- poster image;
- thumbnail/preview derivative;
- canonical dimensions and duration;
- processing status.

The recipient receives the message and poster immediately, but playback remains `processing` until the service reports `ready`.

### 6.4 Ready notification

A verified webhook updates the media record:

`processing -> ready` or `processing -> failed`

Supabase Realtime then updates both clients. The database stores the provider UID and immutable media metadata, not a temporary signed playback URL.

### 6.5 Feed playback

Default feed representation: poster or lightweight animated preview.

Only one preview may be active at a time. A shared player/controller is assigned to the most relevant visible video. Scrolling offscreen pauses and releases it. The feed never fetches the original uploaded MOV.

### 6.6 Full-screen viewer

Use one persistent viewer player:

- load low HLS rendition first;
- adaptive player raises quality as bandwidth allows;
- use poster as the transition snapshot;
- no second raw-video decode;
- close by button or downward gesture;
- restore exact virtual-list anchor.

## 7. Photo and document pipeline

Photos and documents may remain in Supabase Storage.

Photos:

- upload original;
- create/store thumbnail and medium display derivative;
- feed uses thumbnail/medium;
- viewer loads original only when opened;
- dimensions stored before insertion.

Documents:

- metadata card in feed;
- authenticated internal viewer where supported;
- explicit download action;
- no navigation away from the messenger unless required by iOS.

## 8. Server data model

### `messages`

- `id`
- `conversation_id`
- `client_message_id`
- `server_seq`
- `sender_id`
- `type`
- `state`
- `body`
- `media_asset_id`
- `created_at`

### `media_assets`

- `id`
- `message_id`
- `provider`
- `provider_uid`
- `state`
- `mime_type`
- `size_bytes`
- `width`
- `height`
- `duration_ms`
- `poster_reference`
- `preview_reference`
- `playback_reference`
- `error_code`
- `created_at`
- `ready_at`

### `media_uploads`

- `id`
- `user_id`
- `client_message_id`
- `provider_uid`
- `state`
- `bytes_total`
- `bytes_uploaded`
- `expires_at`

Playback tokens are short-lived and generated server-side after conversation-membership authorization.

## 9. Security

- private video requires signed playback tokens;
- direct-upload endpoints verify authenticated Vision Talk user and conversation membership;
- upload constraints are set server-side;
- webhook signatures are verified;
- allowed origins are restricted;
- MIME declarations are not trusted without server-side validation;
- RLS remains authoritative for message records.

## 10. Non-negotiable invariants

1. Message rows have final dimensions before they enter the visible list.
2. Initial chat entry never renders the whole history.
3. Feed never plays the original uploaded video.
4. No more than one active video decoder/player in the feed.
5. Upload, processing and playback are separate states.
6. Reconnect resumes transport instead of restarting from byte zero.
7. Viewer close restores the exact conversation position.
8. Media failure cannot break text messaging.
9. Experimental media work occurs on an isolated branch and cannot replace the stable baseline.

## 11. Delivery sequence

### Phase 0 — baseline protection

- freeze `baseline-media-v29`;
- preserve text/Realtime/offline behavior;
- add automated smoke checks.

### Phase 1 — message list

- modular client shell;
- IndexedDB recent-window cache;
- end-anchored virtual list;
- cursor pagination upward;
- zero visible initial scroll.

### Phase 2 — media state model

- new database schema;
- fixed geometry from metadata;
- poster-first local media messages;
- separate transport status.

### Phase 3 — video transport

- dedicated Vision Talk upload backend;
- direct TUS upload;
- webhook processing state;
- private HLS playback.

### Phase 4 — player

- one shared feed preview player;
- full-screen HLS viewer;
- exact anchor restoration.

### Phase 5 — qualification

Test matrix:

- 10 seconds, 60 seconds, 5 minutes, 30 minutes;
- 20 MB, 200 MB, 1 GB;
- portrait, landscape and square;
- MOV/H.264, MOV/HEVC and MP4/H.264;
- Wi-Fi, LTE, network loss and airplane mode;
- reload during upload;
- 10,000-message synthetic conversation;
- Safari and Chrome on iPhone.

## 12. Definition of done

- chat opens at the latest message with no visible traversal;
- media loading causes no visible row resize;
- only a bounded recent message window exists in the DOM;
- selected video appears locally in under one frame after metadata extraction;
- interrupted upload resumes;
- recipient sees `processing`, then `ready` without reopening the chat;
- five-minute video does not block scrolling or text input;
- full-screen playback starts from adaptive stream, not original MOV;
- closing returns to the exact source message;
- text delivery remains functional if the video service is unavailable.

## 13. Primary evidence

- Telegram TDLib: local storage, ordered asynchronous updates and reliability on unstable networks — https://core.telegram.org/tdlib
- Telegram iOS source: virtualized chat history, stationary item range, target scrolling, separate media fetch status, minimized HLS preloading — https://github.com/TelegramMessenger/Telegram-iOS
- Apple HTTP Live Streaming — https://developer.apple.com/streaming/
- WebKit iOS video policies — https://webkit.org/blog/6784/new-video-policies-for-ios/
- Cloudflare Stream direct creator upload/TUS/ABR/private playback — https://developers.cloudflare.com/stream/
- TUS resumable upload protocol — https://tus.io/protocols/resumable-upload
