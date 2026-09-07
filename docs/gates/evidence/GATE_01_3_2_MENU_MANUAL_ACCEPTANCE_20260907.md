# Gate 01.3.2 — scoped compact-menu acceptance

Date: 2026-09-07.
Project: Vision Talk only.
Candidate referenced by the conversation: `gate-01.3.2-glass-menu`.
Status: **MENU_PRESENTATION_MANUALLY_ACCEPTED_BY_USER**.
Whole Gate 01.3 / production integration: **NOT ACCEPTED; BLOCKED_PENDING_REMAINING_SCOPED_CHECKS**.

## User evidence

Following the compact-menu candidate, the user wrote:

> Да, вот теперь отлично. Всё видно, всё читается, всё хорошо. И не мешает тексту. Всё супер. Так, что дальше там у нас? Демо-задачи или что мы дальше делаем?

Accept this as manual acceptance of the requested menu presentation: readable content, compact sizing/placement and no interference with text in the user's tested state. The message supplies no new JSON, screenshot, browser identifier or second-browser result. Do not infer separate Safari and Chrome acceptances, keyboard/rotation coverage, measured performance, real task execution or production readiness. Prior reports retain their original build scopes. Do not request another unchanged menu test merely to reconfirm this statement.

Candidate record read before this recording: `GATE_01_3_2_COMPACT_MENU_CANDIDATE_20260907.md`, introduced by commit `53101a60a10b17ce4294df9e954748089efb2b37`.

## Source-only check of the next interaction

Inspected `publish/app.js` and `publish/index.html` from the mounted conversation artifact `Vision_Talk_Gate_01_3_2_Compact_Menu.zip`. This is inspection of archived source, not independent live retrieval or a new device run.

- Plus menu contains `Помощник`; its mode submenu contains `Сообщение`, `Помощник · демо`, `Задача · демо` and `Назад`.
- Selecting task mode changes the primary action to `▷` with an explicit demo-only label.
- Starting requires text or an attachment. `startTask()` creates a local task presentation in `В очереди`, preserves the draft and resets the composing mode to ordinary message mode. It does not add a conversation message or run a backend agent.
- The visible `Далее` control advances from `В очереди` to `Выполняется (демо)` and then `Готово`. These transitions require explicit actions, not a hidden execution timer.
- The task-bar cross calls cancellation and sets `Отменено`. It does not necessarily remove the status bar. Do not instruct users that cancellation always hides the bar.
- A subsequent ordinary send remains a separate local-message operation.

## Focused next manual check on the unchanged page

1. Enter a nonprivate test draft. Choose plus -> Помощник -> Задача · демо, then press `▷`. Expect a clearly marked queued demonstration and unchanged draft; no new message should appear merely from starting the demo.
2. Continue typing while the task bar is present. Advance with `Далее` to the running demonstration and completed state. Text, cursor, composer controls and reading position should remain usable.
3. Start another demo through the same mode path and cancel with the task-bar cross. Expect `Отменено` without deleting or disabling the draft.

Do not demand another full automatic run for this focused interaction. A short usability confirmation or description of a defect is sufficient for its human side. An automatic PASS cannot replace manual acceptance, and `Готово` in this harness is not evidence that any useful work was executed.

## Remaining work and proposed ordering

After this local interaction check, complete only outstanding device/keyboard/rotation checks for the composer; do not silently close the entire gate. Actual agent execution is a separate later backend gate, not the immediate consequence of a demo PASS.

Proposed subsequent development priorities, not implemented or qualified here: durable draft/outbox restoration with explicit file-access semantics; then idempotent server delivery and media upload/processing/playback, each in isolation and with failure tests. Real agent task execution should have its own authenticated contract and truthful server-originated lifecycle before it is connected to the messenger.

## Isolation

This step adds only this acceptance/next-check record on `messenger-architecture-1.0`. It makes no runtime, deployment, hostname, production-main, Supabase, Auth, Realtime, Storage or agent-service change. No new local browser test or deployment was run in this recording step.
