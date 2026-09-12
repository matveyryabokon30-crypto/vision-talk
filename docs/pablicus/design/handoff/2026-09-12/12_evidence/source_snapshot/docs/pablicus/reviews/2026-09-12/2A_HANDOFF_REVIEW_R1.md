# Pablicus — независимая приёмка 2A R1

Дата: 12 сентября 2026 года. Роль: Проверяющий.

**SUBSTEP_2A_ACCEPTED** в границе задания `PABLICUS-BLOCK02-2A-SHELL-ARCHITECTURE-20260912`, R1.

Это приёмка архитектурной базы оболочки и ограниченных foundation changes. Block 2 целиком не принят; пользовательский релиз не разрешён.

## Версии и источники

- WORK_START_HEAD: `abfc878896d8b10acc540d27ed370bbfaf2e8b70`.
- CODE_SHA = TESTED_SHA: `9ee215300ac97b3c48bf5184f414f28333429a1c`.
- HANDOFF_HEAD и remote при начале/перед документальной фиксацией: `55754de80a74b45ddd8aef7d2a2a9e95f132aa40`.
- От начала 2A до CODE_SHA: 17 runtime paths, 7 test paths, 1 workflow. После CODE_SHA до передачи: только PABLICUS_CONTEXT.md и пять документов block-02.
- Самостоятельно прочитаны Git diff, текущие компоненты и существенные зависимости, assertions, workflow, пять документов передачи, GitHub job log и исходный CI artifact.

Проверена отдельная копия точного CODE_SHA. Рабочая копия Исполнителя не изменялась. Новые проверки используют искусственные данные и HTTP/Phoenix boundary без forwarding к production. Наблюдаемые незакоммиченные файлы Исполнителя не использованы как кандидат.

## Восстановленное решение блока 1

Матвей передал `PABLICUS-REVIEWER-CODEX-HANDOFF-20260912`, R1: предыдущий Проверяющий принял Block 1 и выдал задание 2A. Это источник перенесённого `BLOCK_1_ACCEPTED`, а не новый прогон или обнаруженный исторический Git-документ. Сохраняются прежние ограничения, приёмки 1A–1C и `NOT_RECOVERED / EXCLUDED_FROM_BASELINE` для неизвестного delta 1A. Старые READY/NOT_STARTED остаются историческими.

## Что выполнено лично

1. Сверены remote, Git ancestry и оба диапазона diff. Исходники карты ownership сверены с указанными Git-версиями: 68 current entries, расхождений хешей нет. Связи evidence всех 13 критериев имеют совпадающие хеши.
2. Скачан оригинальный artifact `10299632187`, run `34698093479`, job `103564952160`. ZIP 4628104 bytes; SHA-256 `f5920d65eae25b7ae06639940cb8eb82df648a00de46b81a5aeb1845f2d803c2` совпал с GitHub digest. CRC без ошибок. Проверены 531 content hash и 235 исходников относительно Git candidate. Checkout точного SHA подтверждён job log; шаги не пропущены и завершились success.
3. Локально повторены structural checks: 10/10 PASS. Это структурные критерии, не подмена всего T01–T13.
4. Локально повторены 31/31 регрессий 1B: PASS, включая timeout self-test и leave/resume.
5. Локально запущен точный shell_probe кандидата через отдельный reviewer launcher: mobile 390×844, tablet 768×1024, desktop 1280×900 — по 43 PASS. Отдельный browser context с дублированным navigation listener дал ровно три ожидаемых inner FAIL на dispatch tasks/profile/chats, без startup ERROR и других FAIL.
6. Дополнительная собственная проба: правильные заголовки трёх разделов; переход разговор → Полотно → разговор с сохранением черновика; изменение viewport 320×568 → 844×390 → 1280×900 → 390×844 без выхода проверенных controls за границы; выход/повторное открытие с сохранением текста. 11/11 проверок PASS, включая ошибки и cleanup.
7. Отдельная проба развёрнутого composer на 320×568: критические controls доступны и попадают под hit testing; сворачивание сохраняет черновик. Все восемь записей PASS (включая повторённую подготовку и cleanup).

Локальная среда и результаты: [2A_R1_RESULTS.json](2A_R1_RESULTS.json). Точные reviewer launchers: [2A_R1_PROBES.txt](2A_R1_PROBES.txt). Локально используется macOS, Playwright 1.57.0 / Chromium 143.0.7499.4; это не идентичная Ubuntu CI среда. В reviewer launcher удалён `--no-sandbox`, явно включён `chromium_sandbox=True`; исходный probe и приложение не изменялись. HTTP/WebSocket routing, блокировка service workers и DNS-ограничение сохранены. Browser contexts/browser/server закрыты.

## Подтверждено по первичному CI без нового локального прогона 1C

- 1C: 9/9 PASS, 145 assertions, 54 проверенных перехода; изучены результаты маршрутов, тихого списка, lifecycle, durability, outbox, isolation, pending send, Canvas и ошибок хранения.
- Четыре мутации имеют ожидаемые inner FAIL: resource growth, late account isolation, original Blob bytes, scenario resource ID. Проверены конкретные qualification observations, ненулевые inner exits и отсутствие startup ERROR/TIMEOUT вместо нужного assertion. Outer PASS означает квалификацию отрицательного контроля.
- Одинаковый финальный shell probe воспроизвёл исходный конфликт пяти корневых вкладок на WORK_START_HEAD и дефект title на `6c01d8b0f30003be885b152b3e9e955607ba2abd`. Кандидат проходит. Фактические результаты и хеши before-исходников доступны в скачанном artifact; соответствующие исходники сохранены в Git.
- Изменения старых тестов 1B/1C ограничены загрузкой реальных shell/registry, новым входом Bots, отображением bots→tasks/feed→chats и актуальным текстовым якорем stale-account mutation. Содержательные сохранность/изоляция/cleanup assertions не заменены заглушками.

## Требования и выводы

| Критерии | Независимое основание | Вывод |
|---|---|---|
| T01–T03 | Controller сохраняет state machine; AppShell — stateless projection. Source diff, header write stacks, фактические root clicks и отрицательный контроль | PASS |
| T04 | Реально подключённый entry graph не загружает shell repair legacy. Наблюдатели rich-message и inbox-monitor ограничены очисткой медиа/своим overlay | PASS |
| T05–T06 | design-tokens.css, 14 разрешившихся групп, 29 уникальных frozen entries, проверка повторной регистрации; registry не монтирует дубликаты | PASS в границе контрактов |
| T07–T09 | Три root routes, заголовки, вложенный Bots, три viewport, keyboard/safe-area/long title/large text, дополнительные resize и expanded composer | PASS в проверенном Chromium baseline |
| T10 | Девять точек расширения Composer, context/result/invariants, реальные capture/restore/focus/blur/destroy; MessageDoc v2 не заявлен | PASS как контракт |
| T11–T12 | Полная IA в Чаты/Дела/Вы; будущие функции явно отделены; calls slots без engine или новой root tab | PASS как IA/readiness |
| T13 | Локальные 31/31 1B, дополнительные Canvas/draft проверки; точный CI 1C и четыре квалифицированные мутации | PASS |

## Дефекты и ограничения

Подтверждённых несоответствий, препятствующих приёмке 2A R1, не установлено. Исправление заголовка подтверждено; обязательной дополнительной коррекции 2A нет.

Не проверены физический iPhone, Safari/WebKit/Firefox, native keyboard/rotation/Dynamic Type, production Supabase/Auth/RLS, реальные пользователи, multi-device synchronization, Service Worker installation/caching и полная WCAG compliance. В 2A эти результаты не заявлены и не блокируют ограниченную приёмку. Отдельный серверный аудит утверждения «внешних production writes не было» не выполнялся; собственная проверка таких записей не совершала.

Реестр будущих компонентов, Spaces/Threads/global Search/AI и calls readiness — контракты, не реализованные возможности. Компонентные CSS literals, полная доступность overlays и реализация CATEGORY_A остаются работой соответствующих следующих подэтапов. Их перенос не уменьшает утверждённую релизную границу.

## Следующий шаг

Подготовить через Матвея отдельное задание 2B на внедрение общих компонентов и согласованное поведение существующих composer/overlay surfaces, используя принятый 2A. Это следующая рабочая декомпозиция блока 2, а не ранее существовавший канонический документ. Исполнение 2B этой проверкой не запускается. Block 3–5, новый дизайн/root tabs, merge/deploy и production changes не разрешены.
