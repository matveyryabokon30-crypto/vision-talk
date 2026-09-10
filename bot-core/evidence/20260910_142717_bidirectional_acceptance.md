# Public Bot Core — two-account cloud pilot evidence

Date: 2026-09-10.
Status: SCENARIO AND FOUR-ROUTE BIDIRECTIONAL ISOLATION CHECKS PASSED.
This is bounded pilot evidence, NOT production-release authorization or a comprehensive security certification.

## New evidence supplied by the owner

The owner pasted the JSON from the published peer-only page:

- version: 2; kind: peer_isolation_only; release: 20260910-peer-2.
- started_at: 2026-09-10T14:27:17.010Z.
- finished_at: 2026-09-10T14:27:21.805Z.
- auth_verified: true; complete: true; outcome: passed.
- first_owner is account B, the target owner. second_owner is account A, the checking user. The identifiers differ and match the previously corroborated test accounts and target objects.
- Direction: account A attempted access to account B's private intake bot.

| Route under test | User-supplied result |
|---|---|
| Read the other owner's private bot | pass=true, HTTP 404, NOT_FOUND |
| Read the other user's conversation history | pass=true, HTTP 404, NOT_FOUND |
| Read the other owner's saved records | pass=true, HTTP 404, NOT_FOUND |
| Create a conversation with that private bot | pass=true, HTTP 404, NOT_FOUND |

Inspected implementation: bot-lab/peer-core.mjs at publication commit daa313cf2c490bde210beb871e1845768522b044, blob 98aa620ac03f5c2898eb14ecf846ee63240b1fa7. It checks a normal manage-scope identity before and after the probes, rejects the same owner and an unexpected checking identity, requires exact HTTP 404 plus NOT_FOUND, and does not treat HTTP 401 as an isolation success. The reported complete=true is assigned only after its final identity check.

These HTTP outcomes are user-supplied browser evidence, not a new authenticated test run executed by the assistant.

## Independent read-only corroboration in this turn

Inspected only metadata and counts for the two known private intake bots and their known conversations. No ordinary message bodies, Auth credentials, session tokens, passwords or key hashes were read.

| Property | Account A target | Account B target |
|---|---|---|
| Bot exists; expected owner matches | true | true |
| Status / visibility | active / private | active / private |
| Conversation exists; actor and bot match | true | true |
| Conversation revision / event count | 6 / 6 | 6 / 6 |
| Saved records | 1 | 1 |
| Conversations by other actors with that private bot | 0 | 0 |

The targets still exist and belong to the expected distinct owners. Thus the reported denials concern known existing private objects; the metadata corroboration does not independently replay or prove HTTP authorization behavior.

## Consolidated accepted results

| Accepted evidence | Checks passed |
|---|---:|
| Account A scenario, 12:39:06.122Z to 12:39:27.250Z | 34 / 34 |
| Account B scenario, 13:40:47.617Z to 13:41:12.041Z | 34 / 34 |
| Account B probing account A, appended peer report | 4 / 4 |
| Account A probing account B, 14:27:17.010Z to 14:27:21.805Z | 4 / 4 |
| Total passed check executions in accepted reports | 76 / 76 |

These are repeated scenario/check executions, not 76 distinct security guarantees. Earlier failed and interrupted attempts remain part of the history; this total does not describe every attempt as successful. The account-B peer report has no separate timestamp and must not be assigned the scenario's timestamps.

Earlier evidence files:
- 20260910_123906_account_a_acceptance.md.
- 20260910_134047_account_b_acceptance.md.

The requested two-account scenario and four-route bidirectional isolation pilot can now be closed as passed. Repeating those same full runs is not a prerequisite for recording this outcome.

## Remaining work and release boundary

- Integrating bot management into the actual Public messenger, ordinary conversation handling, and testing that integration are separate work.
- This evidence does not establish general production security, multi-user load resilience, complete permissions coverage, backup/restore acceptance, token-refresh behavior in all browsers, or installed-PWA lifecycle behavior.
- The earlier session interruptions are not erased by this success. The peer-only page provides clear bounded diagnostics; it does not repair the legacy Lab's session lifecycle.
- Multiple similarly named profiles and recovery of the intended chat account remain a separate identity-management issue. This test neither merges nor modifies profiles.
- PR #33 remains draft and unmerged. It needs reconciliation with current main and integration review, not a blind merge. The owner's instruction to leave the main messenger unchanged remains in force.

This turn adds evidence documentation only to bot-core-integration-stage. It makes no change to the production messenger, Auth, database permissions, deployed Bot Core runtime or stored test data. Personal/test-object identifiers are omitted from this public document.
