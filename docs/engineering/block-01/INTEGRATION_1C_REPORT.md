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
