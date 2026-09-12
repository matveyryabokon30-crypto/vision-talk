# Pablicus — независимая приёмка 1C R1

Дата: 2026-09-12

Роль: Проверяющий / независимая приёмка.

## Решение

**SUBSTEP_1C_ACCEPTED**

Принят точный исполняемый кандидат:

- `CODE_SHA = TESTED_SHA = 4b886c1477c44752359ccc4b44f8ff5c072bb241`
- передача Исполнителя: `2d610c10cdd2be62ae2193965cd4d5a6c869f09c`
- ветка: `refactor/pablicus-foundation-20260911`

Статус `ACCEPTED` относится только к подэтапу 1C в его утверждённой границе. Это не является автоматической приёмкой всего Block 1, не запускает 1D и не разрешает Block 2 без отдельного задания владельца.

## Что проверено независимо

### 1. Связь результата с точным CODE_SHA

GitHub Actions run `34688665398`, job `103540004753` выполнился на `4b886c1477c44752359ccc4b44f8ff5c072bb241` и завершился `success`.

Artifact:

- ID `10297195136`
- name `integration-1c-4b886c1477c44752359ccc4b44f8ff5c072bb241`
- size `2362292`
- digest `sha256:af0115ae7d0df2efbb1b910ef9d172b4e360bef936fdb9424444ec476950bcb8`

CI checkout log непосредственно показывает checkout SHA `4b886c1477c44752359ccc4b44f8ff5c072bb241`.

Сравнение `4b886c... -> 2d610c...` показывает ровно один последующий commit и только документальные изменения. Код, tests и workflow после TESTED_SHA не менялись.

### 2. Harness не подменяет product result

Подтверждены отдельные qualification gates:

- native receiver self-test;
- collector early-error self-test;
- network boundary qualification;
- browser A/B0/B1;
- preflight.

A/B:

- A без instrument — PASS;
- B0 с исходным опубликованным instrument — `TypeError: Illegal invocation` в `clearTimeout`;
- B1 с исправленным instrument — PASS.

Следовательно, подтверждённый defect receiver semantics относится к harness и не выдаётся за product bug. Историческая первая pageerror старого CI не реконструирована и не заявлена как доказанная.

Collector отдельно доказывает, что искусственная ранняя ошибка остаётся ERROR с ненулевым exit и сохраняет pageerror/stack/screenshot/HTML; ложный PASS не возникает.

### 3. Семь требований 1C

Финальная browser matrix:

- PASS 9
- FAIL 0
- ERROR 0
- TIMEOUT 0
- NOT_RUN 0
- BLOCKED 0

145 behavioral assertions PASS.

Результат по требованиям:

1. Real modules/routes/resources — PASS.
2. 54 завершённых перехода и отсутствие накопления измеряемых ресурсов — PASS.
3. Durability: text/order/stable IDs/original Blob bytes/close-open/reload/Canvas deny-accept — PASS.
4. Durable outbox: offline/reload/lost ACK/retry/idempotency/явный failure — PASS.
5. A→B→A, late read/write/send, draft/files/outbox/selection, same-user refresh — PASS.
6. Storage write/enqueue/load failures и recovery — PASS.
7. Positive baseline + negative controls — PASS.

Граница результата сохранена: это real local index/SDK/modules/DOM/IndexedDB с детерминированными synthetic HTTP/Phoenix boundaries; production backend/RLS/Auth/real users не квалифицированы.

### 4. Negative controls действительно чувствительны

Проверены четыре изолированные mutation-копии. Во всех случаях positive candidate не изменён, startup ERROR/TIMEOUT не использованы как доказательство.

- `MUTATION_A_RESOURCE_LEAK` → ожидаемый behavioral FAIL `1C-NO-RESOURCE-ACCUMULATION`.
- `MUTATION_B_LATE_ACCOUNT` → ожидаемый behavioral FAIL `1C-LATE-ACCOUNT-ISOLATION`.
- `MUTATION_C_BYTE_OR_ORDER` → ожидаемый behavioral FAIL `1C-DRAFT-BYTES`.
- `MUTATION_D_ROUTE_RESOURCE` → ожидаемый behavioral FAIL `1C-SCENARIO-SURVIVES-POLL`.

Это подтверждает чувствительность ключевых проверок к классам дефектов, которые они должны обнаруживать.

### 5. Runtime fix №1 — polling / active route

Изменение `pablicus/app.js` минимально: `loadDialogs` теперь различает изменившиеся данные и перерисовывает home только когда фактический controller route соответствует `chats/home`.

До исправления реальный poll закрывал активный Bot detail и перерисовывал неизменённый список.

Before:

- SHA `e8d017be3a8c46f3dcc78910a2082e704a4fcaa5`
- `1C-BOT-DETAIL-SURVIVES-POLL` — FAIL.

After:

- SHA `0cf9f714a50952c42c5b503b70fc7429e8b99588`
- тот же assertion — PASS.

Relevant route/quiet harness files, которыми доказан этот defect, сохранены побайтово между before/after. В том же commit были отдельные корректировки других harness checks, не используемые как основание данного before/after proof; это не скрыто и не влияет на конкретный route/quiet proof.

Changed-data positive control также PASS, поэтому fix не достигает результата простым запретом обновлений.

### 6. Runtime fix №2 — route при смене identity

`pablicus/app-controller.js` изменён одной строкой после same-user early return: при новой session identity route сбрасывается в `chats/home`, resource/conversation/canvas очищаются.

Сравнение `9a60e778... -> 1190098e...` показывает единственный изменённый файл `pablicus/app-controller.js` и ровно одну добавленную строку.

До исправления route предыдущего пользователя A сохранялся после перехода к пользователю B.

After тот же `1C-ACCOUNT-SWITCH-HOME-ROUTE` проходит. Generation/invalidation/abort/cleanup механика не переписывалась.

### 7. 1B regression

На финальном `4b886c...` повторно выполнены принятые 1B проверки:

**31/31 PASS**.

CI log отдельно перечисляет все 31 PASS, включая timeout self-test и leave/resume cases.

1A/1B не переоткрываются.

### 8. Integrity и process cleanup

Перед tests CI снял source manifest из tracked Git files на том же SHA.

Передача содержит отдельную artifact verification и independent non-owner audit. В них подтверждены:

- GitHub digest / ZIP SHA-256;
- CRC;
- exact scoped Git source bytes;
- result/log hashes;
- source provenance;
- evidence inventory;
- process logs;
- runtime change scope.

После тестов отдельный process cleanup step показывает 0 активных Playwright/browser/driver процессов.

## Ограничения приёмки

Принятие 1C не утверждает:

- физический iPhone;
- Safari/WebKit/Firefox;
- production Supabase backend;
- production RLS/Auth;
- production Service Worker caching;
- real-user data;
- multi-device behavior;
- неограниченную по времени leak-free работу.

Квалифицированная среда: Ubuntu 24.04, Python 3.12.7, Playwright 1.57.0, Chromium 143.0.7499.4.

Resource conclusion ограничен измеряемыми классами и 54 завершёнными переходами после прогрева.

## Safety incident

Исторический отказ `GitHub.create_tree` не переписывается задним числом.

Сохраняются последние канонические факты:

- support `SENT_AND_ESCALATED`;
- specialist review `PENDING` по последней фиксации;
- исторический gate `NOT_RESOLVED`.

Одновременно подтверждено, что в текущей среде обычные source writes выполнились без нового safety refusal. Это не объявляется ответом специалиста по прошлому инциденту.

## Финальное решение

На основании независимой проверки точного final candidate, GitHub CI, artifact metadata, handoff diff, runtime before/after proof, negative controls и 1B regression:

**SUBSTEP_1C_ACCEPTED**.

Незакрытых corrective пунктов в утверждённой границе 1C не установлено.

Следующий этап автоматически не начинается.

**1D: NOT_STARTED.**

**Block 2: NOT_STARTED.**
