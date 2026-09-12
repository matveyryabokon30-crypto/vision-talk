# Pablicus — независимая приёмка 2B R1

Дата: 12 сентября 2026 года. Роль: Проверяющий.

**SUBSTEP_2B_ACCEPTED** — в границе задания `PABLICUS-BLOCK02-2B-SHARED-COMPONENTS-20260912`, R1.

Приняты общие контракты затронутых native controls и согласование существующих composer/overlay surfaces. Это не приёмка всего Block 2, не утверждение нового дизайна и не разрешение релиза.

## Версии и scope

- WORK_START_HEAD: `6822a58a7a632fcfc182e4a8e2f02eea37d55afb`.
- CODE_SHA = TESTED_SHA: `c5e26c2f85ef1f6d1f8ab4684d033de4f3b0d3c9`.
- HANDOFF_HEAD / remote при начале review: `d791adc19aade1015f4ba34cf4beb5ce2069c93f`.
- Реализация: 22 runtime paths, один новый component probe и один workflow. Controller, принятые 1B/1C tests и transport/storage sources не переписаны. В диапазоне также присутствуют три отдельные документальные записи Amendment 03 / owner decision / Design Reference Register; они сохранены и не выданы за реализацию 2B.
- CODE_SHA → HANDOFF_HEAD: только четыре документа COMPONENTS_2B и PABLICUS_CONTEXT.md; runtime/tests/workflow diff отсутствует.

Проверка выполнена в собственной копии candidate. Рабочая копия Исполнителя не изменялась. Новый runtime/test patch ради PASS не создавался.

## Лично выполнено

1. Прочитаны source diff, существенные зависимости, тестовые assertions, workflow и документы передачи. Свежий remote совпал с HANDOFF_HEAD. Все 24 source/test/workflow hashes из манифеста совпали с кандидатом.
2. Скачаны GitHub run/job/artifact metadata, job log и оригинальный ZIP. Run `34701805783`, job `103574775764`, artifact `10299754595`. Checkout точного SHA подтверждён log; все steps success, скрытого allowed-failure в проверенной цепочке нет.
3. ZIP 9437953 bytes: SHA-256 `b55508278727f1aa81e0d215ee96dde5e3ff631801c4e50c6c0dcb80db3353b6` совпал с GitHub digest; CRC без ошибок. Сверены 681 file hash и 249 исходников с Git. Сопоставлены 160 предметных observations из отчёта с первичным component artifact: расхождений нет; ещё 12 записей — preflight/network/error checks.
4. Локальные structural checks: 10/10 PASS. Component probe после сохранённой первоначальной ошибки загрузки: 172/172 PASS на 390×844, 768×1024, 1280×900, 320×568, без изменения probe/candidate/assertions.
5. Локальный 1B: 30 основных сценариев PASS; timeout self-test сначала дважды не завершил внешнюю проверку за 6 секунд, затем тот же неизменённый self-test прошёл отдельно. Это не один локальный прогон 31/31. Первичные CI результаты 31/31 PASS подтверждены отдельно.
6. Собственная дополнительная проба: 11/11 PASS — Escape с отказом от закрытия dirty sheet; history Back с отказом и восстановлением sheet history; подтверждённое закрытие/возврат фокуса; сохранение inline текста при недоступном Popover API; фокус внутри expanded workspace при циклах Tab/Shift+Tab; сворачивание без закрытия sheet и потери текста; закрытие MediaViewer до завершения resolver и игнорирование позднего ответа; отсутствие page errors, посторонних запросов и cleanup.
7. Просмотрены screenshots мобильного полноэкранного редактора и прокрученного длинного modal. Hit testing и геометрические observations используются вместе с изображениями, а не заменяются сгенерированным макетом.

Локальная среда: macOS 13.7.8 x86_64, Python 3.14.7, Playwright 1.57.0, Chromium 143.0.7499.4. Chromium sandbox включён. HTTP/Phoenix boundary синтетический, внешнего forwarding нет; service workers заблокированы. Это не тождественная Ubuntu CI среда.

[Результаты и provenance](2B_R1_RESULTS.json), [точные reviewer probes](2B_R1_PROBES.txt). Полные исходные локальные логи/изображения находятся по пути, указанному в JSON.

## Подтверждено по исходному CI artifact без нового локального запуска соответствующих suites

- 1C: 9/9 PASS, 145 assertions, 54 проверенных перехода. Сохранены identity, late operations, Canvas leave, Blob/IDs/order durability, outbox и cleanup.
- Четыре отрицательных контроля: конкретные inner FAIL на resource growth, late-account contamination, original bytes и scenario resource ID. Проверены qualification observations; startup ERROR/TIMEOUT не засчитаны за ожидаемый FAIL, candidate unchanged.
- Shell: три положительных viewport PASS; duplicate-listener даёт ровно три dispatch FAIL, остальные checks PASS.
- Одинаковый финальный 2B probe воспроизводит исходные дефекты на WORK_START_HEAD; отдельная before-копия `f1460551abbd4e7e4f8ddfa7e5023f4bb727d2e5` воспроизводит modal-scroll-content FAIL на mobile/small-mobile. 92 и 93 before-source hashes сверены с соответствующими Git-версиями. Финальный кандидат проходит эти assertions.
- CI component qualification работает на Ubuntu 22.04 с sandbox=true. Исторический No usable sandbox на Ubuntu 24.04 остаётся ошибкой стенда, не отрицательным контролем и не дефектом продукта. Нового вмешательства в managed policies не выполнялось.

## Критерии

| Критерий | Основание | Вывод |
|---|---|---|
| T01 | Stateless prepareControl/tabKey/focusWithin; native controls, общий controls.css и tokens; реальные выбранные controls | PASS в заявленной области внедрения |
| T02 | Чаты/Дела/Вы, согласованные заголовки/routes, вложенный Bots/Factory; Controller сохраняется | PASS |
| T03 | Native disabled, имена controls, клавиатурное переключение, visible focus на проверенных surfaces | PASS; полная WCAG не заявляется |
| T04 | Escape/close/focus return; dirty-sheet denial; Back; focus cycles; реальный MediaViewer; поздний resolver | PASS |
| T05 | Четыре viewport, уменьшение высоты/offset, safe areas, long/large text, modal scroll и hit testing | PASS в Chromium fixture |
| T06 | Text/IDs/order/Blob SHA сохраняются при collapse, Canvas roundtrip и reopen; собственная проверка fallback/dirty text | PASS |
| T07 | Первичный CI 31/31 1B, 9/9 1C и negative controls; локальная проверка 1B с отдельным успешным self-test | PASS |

## Неуспешные диагностические попытки

Первый component run и первая собственная проба завершились Page.goto timeout до проверок поведения. Независимая диагностика затем подтвердила передачу всех 17001 байта index и завершение загрузки ресурсов; повторный неизменённый component run прошёл. Точная причина исходных тайм-аутов не установлена; они сохранены как ошибки выполнения, а не PASS или дефекты приложения.

Во второй собственной пробе четыре поведенческие проверки прошли, затем reviewer-выражение восстановления showPopover вернуло native function в Playwright и вызвало Illegal invocation. В третьем запуске исправлено только reviewer-выражение на блок без возврата function; приложение не менялось. Финальная проба завершилась 11/11 PASS. Неуспешные версии и hashes сохранены.

## Дефекты, ограничения, следующий шаг

Подтверждённых несоответствий, блокирующих 2B R1, не установлено. Коррекция Исполнителя по 2B не требуется. Диагностические ошибки среды/пробы отделены от результата приложения и не являются незакрытыми продуктовыми дефектами.

Не квалифицированы physical iPhone, Safari/WebKit/Firefox, native keyboard/Dynamic Type/rotation, production backend/RLS/Auth, реальные пользователи, multi-device, Service Worker lifecycle, весь набор compact controls и полная WCAG. Popover fallback проверен искусственным отключением feature в собственной browser context, не запуском старого браузера.

Amendment 03 и отдельный дизайн-контур обязательны. 2B сохраняет существующие assets и не выдаётся за DESIGN_APPROVED или лицензионный аудит прежних assets. Будущие CATEGORY_A, MessageDoc v2, AI, calls и новые object surfaces не объявляются реализованными. Приёмка не сокращает релизную границу.

Следующий допустимый шаг — отдельное ограниченное задание внутри Block 2 через Матвея с учётом Amendment 03. Внедрение нового визуального слоя требует утверждённой design source of truth и engineering handoff; эта проверка не создаёт и не утверждает их. Автоматически следующий подэтап не запускается. Block 2 целиком не принят. Merge/deploy/main/production не разрешены.
