# Vision Talk — Evidence Gate 01: End-Anchored Virtual Chat List

Status: `IMPLEMENTATION IN ISOLATED TEST; NOT INTEGRATED`

## Proposition under test

A modern chat history can open directly at the latest message and preserve a stable visual anchor while older messages are prepended, without keeping the whole history in the DOM.

## Isolation law

This gate contains no Supabase, authentication, Realtime, uploads, media decoding, or Vision Talk production code. A PASS authorizes only the chat-list mechanism to advance to the next integration stage.

## Test dataset

- 10,000 deterministic synthetic messages.
- Mixed fixed geometries representing short text, long text, system rows, and media placeholders.
- Stable persistent IDs.
- Only the viewport window plus overscan may exist in the DOM.

## Blocking acceptance criteria

1. Initial entry opens at the final message with bottom error `<= 2 px` and no visible traversal through the history.
2. Prepending 50 older messages preserves the current anchor with displacement `<= 1.5 px`.
3. Maximum rendered message rows remains `<= 120` during initial render, prepend, and rapid random scrolling.
4. Appending while the user is at the bottom keeps the latest message visible with bottom error `<= 2 px`.
5. Appending while the user is reading older history changes scroll position by `<= 1.5 px`, preserves the first visible message, and shows a new-message control instead of forcing a jump.
6. The same gate must pass independently on the target iPhone in Safari and Chrome before any integration into Vision Talk.

## Evidence output

The isolated page emits an on-device JSON evidence record containing:

- build identifier;
- timestamp;
- user agent;
- viewport dimensions;
- mount time;
- initial bottom error;
- prepend anchor displacement;
- maximum DOM row count;
- per-test PASS/FAIL results.

## Integration rule

`FAIL` on either Safari or Chrome blocks integration. No production file may be changed to compensate for a failing gate.
