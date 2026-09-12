# Pablicus — 1C R2: интеграционная квалификация

12 сентября 2026 года. **SUBSTEP_1C_READY_FOR_INDEPENDENT_REVIEW**. ACCEPTED не присвоен; независимая приёмка ещё требуется.

CURRENT_REMOTE_HEAD в начале / WORK_START_HEAD: `56a6ecf7b5ebdf0e8cc3529d4582707188124e29`. Новых коммитов относительно переданного SHA на момент начала не было. Ветка: `refactor/pablicus-foundation-20260911`.
CODE_SHA = TESTED_SHA: `4b886c1477c44752359ccc4b44f8ff5c072bb241`. HANDOFF_HEAD — следующий документальный commit; точный SHA фиксируется после его создания в handoff receipt. Команда разрешения приведена в манифесте.

Свежий [CI 34688665398](https://github.com/matveyryabokon30-crypto/vision-talk/actions/runs/34688665398), job `103540004753`, artifact `10297195136`: SUCCESS. Исходный ZIP SHA-256 = GitHub digest: `af0115ae7d0df2efbb1b910ef9d172b4e360bef936fdb9424444ec476950bcb8`; CRC PASS.

Пять gates PASS; **9/9 сценариев, 145 assertions PASS; 54 завершённых проверенных перехода; 4 изолированные mutations дали ожидаемый конкретный FAIL; 31/31 регрессия 1B PASS**. Проверены начальные снимки, неизменяемые actual в момент assertion, source/result/log hashes и cleanup.

## Требования 1–7

| № | Доказательство | Итог |
|---|---|---|
| 1 | Real modules, routes and visible resources; routes | PASS |
| 2 | 54 completed transitions; no measured resource accumulation or unchanged-list rerender; lifecycle, quiet | PASS |
| 3 | Draft text, order, stable IDs and original Blob bytes across close/open, reload and Canvas deny/accept; durability, canvas | PASS |
| 4 | Durable outbox offline/reload/lost ACK/retry/idempotency and visible explicit failure; outbox | PASS |
| 5 | A to B to A, late read/write/send, draft/files/outbox/selection and same-user refresh; isolation, pending-send | PASS |
| 6 | Native storage write/enqueue/load failures and recovery; storage-errors | PASS |
| 7 | Positive baseline plus concrete isolated negative controls; routes, quiet, lifecycle, durability, canvas, outbox, isolation, pending-send, storage-errors | PASS |

Подробные поля и точные JSON pointers на исходные наблюдения: [primary evidence](INTEGRATION_1C_PRIMARY_EVIDENCE_R2.json). [Манифест](INTEGRATION_1C_MANIFEST.json), [evidence index](INTEGRATION_1C_EVIDENCE.json), [проверка artifact](INTEGRATION_1C_ARTIFACT_VERIFICATION_R2.json), [аудит другим агентом](INTEGRATION_1C_AUDIT_R2.json). Последний является внутренней проверкой передачи, не владельческой приёмкой.

## Harness и причинность

Сохранён native receiver для всех шести timers/rAF. Receiver self-test: 52/52 PASS. Collector self-test: 12/12 outer PASS; deliberate inner ERROR с exit 1, first pageerror/stack/location/PNG/HTML сохранены. Независимые collectors подключены до goto, отсутствие globals остаётся наблюдением. Начальные и итоговые снимки защищены; actual каждого assertion копируется при сохранении.

Существующие special routes квалифицированы по exact host/method/path/auth/context/offline и Boundary.calls; UNKNOWN остаётся явным отказом. 100 unit contracts и 34 browser network controls PASS. Python callback/cleanup defects исправлены; никакие их ERROR не зачтены как продуктовые FAIL.

A (без instrument) PASS; B0 (точный исходный published instrument) — ожидаемый TypeError: Illegal invocation в clearTimeout; B1 (исправленный instrument) PASS. H1_REPRODUCED_IN_CURRENT_EXPERIMENT: наблюдаемая цепочка clearTimeout → chat-canvas stopRequests/reset → app startup. Историческая первая ошибка старого CI не восстановлена. Preflight: index200 → intended login → SDK A → dialogs → A1/list → Canvas ready → return, без startup error/UNKNOWN.

## Минимальные runtime исправления

1. `pablicus/app.js`, `loadDialogs`: обновлять home DOM только при изменившихся данных и фактическом route chats/home. Это сохраняет активный Bot detail и неизменённые chat nodes. Те же assertions `1C-BOT-DETAIL-SURVIVES-POLL` и `1C-QUIET-LIST`: e8d017b / CI34686928531 FAIL → 0cf9f7 / CI34687327770 PASS; relevant harness files побайтово одинаковы. Changed-data positive control PASS.
2. `pablicus/app-controller.js`, `applySessionIdentity`: одна очистка прежнего route к существующему chats/home после same-user early return. Counter/invalidation/abort/cleanup semantics сохранены. Тот же `1C-ACCOUNT-SWITCH-HOME-ROUTE`: 9a60e7 / CI34687667191 FAIL → 1190098 / CI34688000446 PASS; весь harness побайтово одинаков. На конечном SHA все три assertions PASS.

Других runtime файлов не изменяли. [Before/after доказательства](INTEGRATION_1C_PRODUCT_PROOF_R2.json). Исторические 9 ERROR до assertions не объявляются девятью product bugs.

## Negative controls

| Mutation | Внутренний итог | Конкретный assertion |
|---|---|---|
| MUTATION_A_RESOURCE_LEAK | FAIL, exit 1; outer PASS | 1C-NO-RESOURCE-ACCUMULATION |
| MUTATION_B_LATE_ACCOUNT | FAIL, exit 1; outer PASS | 1C-LATE-ACCOUNT-ISOLATION |
| MUTATION_C_BYTE_OR_ORDER | FAIL, exit 1; outer PASS | 1C-DRAFT-BYTES |
| MUTATION_D_ROUTE_RESOURCE | FAIL, exit 1; outer PASS | 1C-SCENARIO-SURVIVES-POLL |

Каждая mutation выполнена в отдельной копии; positive candidate и assertions не изменялись. Startup ERROR/TIMEOUT не засчитываются. Копии удалены, candidate_unchanged=true.

## Safety, история и внешние записи

Исторический отказ GitHub.create_tree сохранён: NOT_RESOLVED, support SENT_AND_ESCALATED, specialist PENDING. Текущая обычная source-write фактически прошла 08:31:51–08:31:57 UTC и вернула tree b202d0666ae8e2ea9ef0352cfb1f0819121f334d. Последующие обычные записи также прошли; новых safety refusal не было. Это факт текущей среды, не решение специалиста по прошлому отказу. Обходов и новых обращений в Support не было.

External writes: нормальные trees/commits/non-force updates только разрешённой ветки, CI и их artifacts; настоящая документальная передача. Main/reset/force-push/deploy/production Supabase/RLS/Auth/реальные данные не затрагивались. Полный журнал: [session history](INTEGRATION_1C_SESSION_HISTORY_R2.json).

Промежуточные неуспешные и неполные попытки сохранены: исходные pre-assertion ERROR; invalid Python WebSocket callbacks; неудачная network qualification; квалифицированные product FAIL; 1190098 без initial snapshots; cdea679 с изменяемой ссылкой на ранний outbox effects. Их результаты не перенесены как готовность конечного SHA. Последний generic deepcopy исправил сохранение наблюдений, не runtime.

1A и 1B остаются принятыми в прежних границах. План 1.0 + Amendments01/02 и последовательность пяти блоков сохранены. 1D и блок2 не начаты.

## Прочитанные канонические документы

- `PABLICUS_CONTEXT.md`
- `docs/pablicus/approved/2026-09-11/Pablicus_Continuation_Plan_2026-09-11.md`
- `docs/pablicus/approved/2026-09-11/OWNER_DECISION.md`
- `docs/pablicus/approved/2026-09-11/AMENDMENT_01_UNIVERSAL_AI_ASSISTANT.md`
- `docs/pablicus/approved/2026-09-11/OWNER_DECISION_AMENDMENT_01.md`
- `docs/pablicus/approved/2026-09-11/AMENDMENT_02_COMPETITIVE_CAPABILITIES.md`
- `docs/pablicus/approved/2026-09-11/OWNER_DECISION_AMENDMENT_02.md`
- `docs/engineering/block-01/INTEGRATION_1C_EXECUTION_BLUEPRINT.md`
- `docs/engineering/block-01/INTEGRATION_1C_REPORT.md`
- `docs/engineering/block-01/INTEGRATION_1C_MANIFEST.json`
- `docs/engineering/block-01/INTEGRATION_1C_EVIDENCE.json`
- `docs/engineering/block-01/INTEGRATION_1C_SUPPORT_STATUS_R1.md`
- `docs/engineering/block-01/INTEGRATION_1C_SUPPORT_ESCALATION_R1.md`
- `docs/pablicus/reviews/2026-09-11/1C_BLOCKED_REVIEW_R1.md`
- `docs/pablicus/reviews/2026-09-11/1C_BLOCKED_REVIEW_R1_RESULTS.json`
- `docs/pablicus/reviews/2026-09-11/1C_BLUEPRINT_REVIEW_R1.md`
- `docs/pablicus/tasks/1C_INTEGRATION_PROMPT.txt`
- `docs/pablicus/tasks/1C_DIAGNOSIS_R1_PROMPT.txt`

Дополнительно прочитаны принятые решения 1A/1B и review R3. Blueprint уточнён без расширения scope: A/B0/B1 причинность, completed validated transitions вместо generation proxy, различие outer/inner collector verdict и одинаковый assertion для mutations.

## Воспроизведение и границы

Checkout `4b886c1477c44752359ccc4b44f8ff5c072bb241`; pinned Playwright1.57.0/Chromium143.0.7499.4 и Python3.12.7. Выполнить шаги `.github/workflows/pablicus-integration.yml` в исходном порядке. Каждый запуск — новый output directory. Стенд не обращается к production. Original ZIP не перепаковывать; проверять digest из GitHub API и его SOURCE_MANIFEST против Git tree данного SHA.

- Qualified Chromium 143.0.7499.4 / Playwright 1.57.0 on Ubuntu 24.04 CI; no cross-browser or physical-device claim.
- Real local index, bundled SDK, application modules and IndexedDB; deterministic synthetic HTTP/Phoenix and native fault boundaries. No production backend, RLS/Auth, real-user or multi-device qualification.
- Service Workers blocked; unchanged local static files supply the explicitly declared offline shell. Production Service Worker installation/caching is not qualified.
- Resource conclusion covers the observed classes across 54 completed transitions after 9 warmup transitions; it is not an unlimited-lifetime or general heap-leak claim.
- WebSocket observer preserves the routed pre-observer API/prototype/instanceof/constants but changes constructor identity; observer and Playwright WebSocket routing are identical in all A/B variants.
- H1 reproduced in the current controlled A/B0/B1 experiment. The missing first pageerror from the historical f00f253 run was not recovered.
- Historical safety refusal and pending specialist review are preserved. Current normal source writes succeeded; no historical policy-clearance decision is claimed.
- Local macOS Chromium startup later timed out; executable final evidence comes from the normal isolated CI environment. Earlier failed/incomplete/unqualified attempts retain their original outcomes.
- GitHub artifact retention is 14 days; the original ZIP is also supplied as a local deliverable. Package binary hashes are not recorded; pinned versions, source hashes and execution environment are recorded.
- Initial snapshot chronology uses UTC and captured awaited source order; the separate stage monotonic clock is not cross-converted.
- Normal 1B cases use bounded runner process cleanup; the intentional timeout probe additionally retains explicit parent/child PID verification. Final CI observes zero browser/driver processes.

Следующий разрешённый шаг: независимая проверка 1C. **1D не начинать без отдельного задания.**

---

## Сохранённый исторический отчёт R1-DIAGNOSIS

Ниже прежний отчёт сохранён дословно как исторический снимок. Его статусы и формулировки «не опубликовано/не отправлено/OPEN» относятся к тому раунду; актуальные факты приведены выше и в более позднем Support status.

# Pablicus — 1C R1-DIAGNOSIS: диагностика стенда и сохранённая блокировка

11 сентября 2026 года. `PABLICUS-BLOCK01-1C-INTEGRATION-20260911`, revision `R1-DIAGNOSIS`.

**SUBSTEP_1C_BLOCKED.** Интеграция 1C не завершена. READY и ACCEPTED не присвоены.

## Версии

- Исходный WORK_START_HEAD 1C: `dc4a6031e3a7b5248882f88dee11d83ccd88fd60`.
- Новая точка продолжения диагностики: `c36e6c95e69f989a23711168fbb81e5e6f12efb5`.
- Последний исполняемый CODE_SHA / TESTED_SHA: `f00f253ca2adfe7afc07e64cc3a1dc8f53c5692d`.
- Последний CI: `34634080287`, job `103377640278`, artifact `10277168648`.
- Принятый 1B не изменён; его 31 регрессия на последнем TESTED_SHA — 31/31 PASS.

В R1-DIAGNOSIS не опубликовано ни одной новой правки приложения, тестов или workflow и не выполнен новый исполняемый CI. Это намеренно: исходная source-write операция остаётся под safety-ограничением.

## Отдельно: что наблюдалось, что доказано, что остаётся гипотезой

### Наблюдения исходного неуспешного запуска

Во всех девяти браузерных процессах 1C: `0 PASS / 0 FAIL / 9 ERROR / 0 TIMEOUT`, и `checks=[]`. Поэтому это не девять дефектов Pablicus и не девять отрицательных контролей.

Общий UI-симптом: `#email` существует, но остаётся невидимым; `Locator.fill` истекает через 8000 мс. После этого сбор диагностики падает на `ReferenceError: PablicusDebug is not defined`.

`__integration.releaseWrite()` стоит перед `app.state()` в finally. Сохранённый `capture_error` относится к `app.state()`, следовательно `__integration` в этот момент существовал достаточно, чтобы первый вызов finally не стал записанной ошибкой.

В девяти каталогах последнего artifact отсутствуют PNG/HTML: один общий `try` остановил оставшийся capture после сбоя `app.state()`.

### Подтверждённый дефект стенда №1 — receiver нативных функций

Опубликованный `instrument.js` сохраняет таймеры/rAF в объекте `native`, затем вызывает их как методы этого объекта:

`native.setTimeout`, `native.clearTimeout`, `native.setInterval`, `native.clearInterval`, `native.raf`, `native.caf`.

Это меняет `this`: независимая Node VM-проба Проверяющего на точном Git blob показала `window` для всех шести вызовов до измерителя и `not window` после него.

Это **подтверждённое изменение семантики стендом**, но ещё не браузерное доказательство первой ошибки запуска.

### Новая статическая локализация раннего кандидата

HTML стартует с `#legacyLogin hidden`.

В тестовом локальном origin `publicPasskey.origin` не совпадает с `location.origin`, поэтому нормальный `app.js` должен выполнить `legacyLogin.hidden=false` на строке 275. При неуспешном запуске форма осталась скрыта. `PablicusDebug` создаётся ещё позднее — на строке 609.

До строки 275 `app.js` на строке 108 создаёт `PablicusChatCanvas`. `PablicusChatCanvas.create()` вызывает `reset()` до возврата, а `reset()` вызывает `scope.clearTimeout(planCopyTimer)` на `chat-canvas.js:1140`. После установки измерителя этот вызов проходит через wrapper и далее как `native.clearTimeout(id)` с receiver=`native`.

Если Chromium отвергает такой receiver, эта цепочка объясняет одновременно скрытую login-форму и отсутствие `PablicusDebug`. Однако первая pageerror/stack не была сохранена, поэтому причинность **остаётся гипотезой H1**, а не установленным браузерным root cause. Возможна и другая ранняя ошибка до строки 275.

Увеличение timeout, force-click, принудительное снятие `hidden` или фиктивный `PablicusDebug` не являются допустимым исправлением причины.

### Подтверждённый дефект стенда №2 — диагностический collector

`case.py` выполняет в одном `try`:

1. `__integration.releaseWrite()`;
2. `app.state()`;
3. `__integration.snapshot()`;
4. screenshot;
5. HTML.

`app.state()` напрямую требует `PablicusDebug`. Если приложение не дошло до создания этого объекта, последующие доказательства теряются.

В `case.py` нет независимого внешнего `pageerror`-collector, хотя первоначальный `probe.py` его имел. Поэтому текущий artifact сохранил вторичный UI timeout и вторичный capture error, но не первую реальную page error.

Планируемая минимальная диагностика после штатного разрешения: подключить `pageerror`, console и request-failed collectors до `page.goto`; затем сохранять DOM/global state, instrument snapshot, screenshot и HTML отдельными независимыми блоками. Все обращения к optional globals должны использовать `typeof`/безопасный доступ. Фиктивный `PablicusDebug` не создаётся. Искусственный ранний sentinel-error должен оставлять первичную ошибку и ненулевой результат, а не PASS.

Эта правка **не опубликована и не проверена** в настоящем раунде.

## Сверка probe и сетевой границы

Первоначальный probe без измерителя дошёл до настоящего входа искусственного A, разговора c1, живого списка и пустого IndexedDB vault. Затем реальный caller дважды выполнил:

`POST /rest/v1/rpc/get_message_actions`, uid A,

и базовая модель вернула 501. Это сохранено в исходном probe artifact.

Расширенный `LocalBoundary` уже содержит ответы `get_message_actions`, `get_pinned_messages` и `factory_list_projects`. Повторно добавлять их не нужно.

Статический анализ выявил точность, которую требуется исправить после разрешения записи:

- специальные ветки сейчас стоят до базовой проверки API-host/auth;
- сопоставляются по суффиксу пути;
- не требуют POST;
- не попадают в `Boundary.calls`;
- `factory_list_projects` не соблюдает offline.

Настоящий `get_message_actions` вызывается `chat-actions.js` через `sb.rpc(name,args)`; исходный probe подтверждает точный POST-путь `/rest/v1/rpc/get_message_actions`.

Корректная тестовая граница должна ограничить специальные ответы точным API-host, методом POST, точным `/rest/v1/rpc/<name>`, синтетическим авторизованным пользователем и ожидаемым контекстом; каждый ответ должен журналироваться и соблюдать offline. Неизвестные обращения продолжают давать явный 501/blocked результат. Универсального пустого success-fallback не будет.

## Safety gate — отдельный статус

Статус ограничения: **NOT_RESOLVED**.

Заблокированная операция: `GitHub.create_tree` для предполагаемой коррекции integration-only `instrument.js`.

Точный ответ:

> Этот вызов инструмента был заблокирован OpenAI, поскольку мы не смогли определить статус безопасности запроса.

Сохранённые метаданные:

- точный timestamp вызова: `NOT_AVAILABLE`;
- верхняя граница наблюдения: `2026-09-11T18:43:20Z` (`UTC`);
- request ID: `NOT_AVAILABLE`;
- tool/action: `GitHub.create_tree`;
- версия инструмента/коннектора: `NOT_AVAILABLE`;
- HTTP status: `NOT_AVAILABLE`;
- returned tree SHA: отсутствует;
- branch update заблокированным вызовом: нет;
- точный неопубликованный payload: `NOT_AVAILABLE` в сохранённых доказательствах.

Безопасное описание намерения: правка только интеграционного измерителя/диагностики для сохранения native receiver semantics и устойчивого сбора первой ошибки. Runtime Pablicus, main, production и Supabase этим намерением не затрагивались.

Заблокированная запись не повторялась, не кодировалась/разбивалась, не переносилась на другой инструмент, аккаунт или транспорт. Документальные записи после отказа не являются доказательством снятия ограничения.

### Подготовленный текст для штатной поддержки — НЕ ОТПРАВЛЕН

**Subject:** Safety gate blocked GitHub.create_tree for Pablicus integration-test instrumentation

- Repository: `matveyryabokon30-crypto/vision-talk`.
- Branch: `refactor/pablicus-foundation-20260911`.
- Intended change: integration-test instrumentation/diagnostics only; no application runtime or production change.
- Exact safety response: «Этот вызов инструмента был заблокирован OpenAI, поскольку мы не смогли определить статус безопасности запроса.»
- Exact timestamp: NOT_AVAILABLE; observed no later than `2026-09-11T18:43:20Z UTC`.
- Request ID: NOT_AVAILABLE.
- Tool/connector version: NOT_AVAILABLE.
- The operation was not retried, repackaged, split, encoded, moved to another tool/account, or otherwise bypassed.
- Repository reads and ordinary documentation writes still work, so a general GitHub permission failure is not established.
- Request: review the safety classification through the normal support process; no bypass is requested.

Обращение не отправлено. Для отправки от владельца требуется его явное разрешение.

## Что можно будет делать только после штатного разрешения

Сначала — один контролируемый A/B запуск на одинаковых index/SDK/network fixture/искусственных данных:

1. без измерителя;
2. с измерителем.

Единственная переменная — измеритель. Production остаётся заблокирован. Сборщики ошибок подключаются до загрузки и не зависят от приложения.

После получения первой реальной page error — минимальная правка обвязки штатным способом. Runtime-код не меняется, пока не доказан именно дефект продукта.

До массового запуска девяти сценариев должен пройти предварительный путь: настоящий index → предусмотренная форма входа → SDK login → разговор → Полотно → возврат. Общая ранняя ошибка делает зависимые сценарии BLOCKED/NOT_RUN, а не девять одинаковых ERROR.

После этого исходные семь требований 1C остаются обязательными: маршруты; ≥50 переходов и ресурсы; текст/IDs/Blob после переходов/reload; durable outbox/offline/lost ACK/retry; A→B→A и поздние операции; ошибки хранения/восстановление; положительные и отрицательные контроли.

## Статус требований 1C

Все семь требований остаются OPEN. Нового executable CI в R1-DIAGNOSIS нет. Прежний TESTED_SHA остаётся последней попыткой, а не успешным кандидатом.

Ни один дефект приложения в этом раунде не доказан и ни одно приложение-исправление не выполнено.

## Границы

Не изменялись: `pablicus/`, main, production, Supabase, RLS/Auth, реальные данные, дизайн и утверждённый план. Не выполнялись merge/deploy, force-push, повтор 1A/1B, переход к 1D/блокам 2–5 и изменение URLBlocklist.

Итог: **SUBSTEP_1C_BLOCKED**. Следующее затронутое исполнение возможно только после штатного разрешения safety-ограничения; затем требуется доказать первую browser error и выполнить исходные семь требований 1C.
