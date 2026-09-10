# Bot Lab: account B cloud evidence

Date: 2026-09-10.
Status: ACCOUNT B SCENARIO CHECKS PASSED; B-TO-A ISOLATION CHECKS PASSED; A-TO-B CHECKS PENDING.

## User-provided browser report

The owner supplied the JSON copied from the published Bot Lab after testing with a second approved Public account. Its scenario run started at 2026-09-10T13:40:47.617Z and finished at 2026-09-10T13:41:12.041Z. The peer check is appended to the report; it has no separate timestamp and must not be assumed to have occurred inside that interval.

- 34 account-level checks have pass=true and complete=true.
- peer.complete=true and all four peer checks have pass=true.
- The first_owner and second_owner identifiers differ. They match account A from the first accepted report and account B from the current user-provided test code.
- Direction tested: account B attempts access to account A's private bot, history, records and creation of a conversation with that private bot. All four reported HTTP 404; the inspected test source additionally requires NOT_FOUND.
- This is 38 successful checks in the submitted report, not 38 distinct security guarantees.

The scenario includes creation, replies, an exactly-one-record duplicate submission test, conflicting replay rejection, history reload, concurrent revision conflict, stop/resume, restricted chat-key permissions, key revocation and return to private visibility. The successful report is user-supplied browser evidence, not a new authenticated run executed by the assistant.

## Independent read-only database corroboration

Queried only the second account's test bots created in the reported interval, their conversation metadata, aggregate event/record counts and the revocation flag of their test key. No ordinary message contents, password, session token or key hash was read.

- Two matching bots exist. Both are active, private and at bot revision 3.
- Intake conversation: revision 6, 6 persisted events, 1 record.
- Help conversation: revision 2, 2 persisted events, 0 records.
- The temporary key has scope chat and is revoked.
- The owner, bot and conversation identifiers supplied in the user's separate account-B code match these database objects.
- The sixth intake event is consistent with the final /start after stop/resume; the earlier five-step history check is not contradicted.

Personal and test-object identifiers are intentionally omitted from this public evidence file.

## Remaining scope

The inverse check (account A attempting to access account B's private test objects) has not yet been provided. Do not mark bidirectional isolation, overall production security, load resilience or installed-PWA acceptance complete on this evidence alone. The main messenger must remain unchanged while the owner performs this inverse check.

This recording adds documentation only to bot-core-integration-stage. It changes no messenger source, authentication, database permissions, deployed runtime or user data.
