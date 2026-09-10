# Public Bot Core — bidirectional peer isolation acceptance

Date: 2026-09-10

## Reverse direction supplied by owner

The owner supplied the result from the dedicated `peer_isolation_only` page, release `20260910-peer-2`.

Result:
- `auth_verified: true`
- `complete: true`
- `outcome: passed`
- all four checks passed with HTTP 404 and code `NOT_FOUND`:
  1. foreign private bot is hidden;
  2. foreign private conversation history is hidden;
  3. foreign private records are hidden;
  4. a conversation cannot be opened with the foreign private bot.

The checking account and target owner are different. This is the inverse direction of the previously accepted account-B → account-A peer test.

## Acceptance status

Together with the previously supplied browser evidence:
- account A scenario: 34/34 passed;
- account B scenario: 34/34 passed;
- account B → account A isolation: 4/4 passed;
- account A → account B isolation: 4/4 passed.

Therefore the defined two-account Bot Lab acceptance gate is complete for these tested behaviours.

This does **not** establish general production security, arbitrary-user security, load resilience, disaster recovery, or installed-PWA acceptance. It also does not authorize merging PR #33 or enabling Bots in the main messenger without a separate integration decision.

No passwords, session tokens, bot-key secrets, ordinary message contents, or private record contents are stored in this evidence file.