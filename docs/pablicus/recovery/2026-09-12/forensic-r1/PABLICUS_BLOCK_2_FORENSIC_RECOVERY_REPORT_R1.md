# PABLICUS BLOCK 2 FORENSIC RECOVERY REPORT R1

Дата: 12 сентября 2026. Только forensic audit. Recovery, новый дизайн и следующий блок НЕ начаты.

## 1. Current HEAD

Repository: matveyryabokon30-crypto/vision-talk.
Branch: refactor/pablicus-foundation-20260911.
CURRENT_HEAD = 883003ebe9ae25d3c97b657234d0b6cab72414dd.
Рабочая копия: /Users/artem/Documents/Codex/2026-09-12/1c-codex-astra-1d-2-role/work/vision-talk.

Важный конфликт статусов: новое задание говорит, что независимого ACCEPTED 2B нет. Однако коммит 883003e содержит docs/pablicus/reviews/2026-09-12/2B_HANDOFF_REVIEW_R1.md с явным SUBSTEP_2B_ACCEPTED и соответствующую запись PABLICUS_CONTEXT.md. Это факт содержимого Git, не новое решение Исполнителя. История не переписана; финальная/физическая приёмка Block 2 из этой записи не следует. Owner physical regression остаётся открытой.

## 2. Accepted 2A SHA

CODE_SHA = TESTED_SHA: 9ee215300ac97b3c48bf5184f414f28333429a1c.
Handoff: 55754de80a74b45ddd8aef7d2a2a9e95f132aa40.
Документ независимой проверки: 6822a58a7a632fcfc182e4a8e2f02eea37d55afb, docs/pablicus/reviews/2026-09-12/2A_HANDOFF_REVIEW_R1.md.

## 3. Candidate 2B SHA

CODE_SHA = TESTED_SHA: c5e26c2f85ef1f6d1f8ab4684d033de4f3b0d3c9.
Handoff: d791adc19aade1015f4ba34cf4beb5ce2069c93f.
Существующий CI: 34701805783; job 103574775764; artifact 10299754595.
ZIP SHA-256: b55508278727f1aa81e0d215ee96dde5e3ff631801c4e50c6c0dcb80db3353b6.
Новый CI в forensic-проходе не запускался.

Runtime c5e26c2 → 883003e: NONE. После candidate изменены восемь документальных путей, включая handoff и review. Поэтому HEAD документально отличается, но runtime кандидата и HEAD совпадает по всем 93 файлам pablicus/.

Найдена фактическая публикация 6411657167: commit 0e953322eac69e6f3e79458ac32323b564acaf55, ref publish/pablicus-2b-20260912, 2026-09-12 16:10:54 UTC, Pages SUCCESS. Все runtime-файлы публикации совпадают с c5e26c2. GET публичных index.html и sw.js также совпал по SHA-256 с локальным HEAD. Это не подтверждает состояние кэша конкретного iPhone.

Последняя предшествующая публикация: f348aceacc3acdb315387a4066f6f495ce269b54, deployment 6383933239, 2026-09-11 00:38:15 UTC. Это LAST_PUBLISHED_BEFORE_ENGINEERING, а не доказанный физически GOOD_BASELINE. URL/модель/iOS/cache-состояние проверенного владельцем устройства не получены; такой baseline не выдуман.

## 4. Commit range

Диапазон 9ee2153..883003e содержит 12 коммитов. Полные SHA и полный path list сохранены в COMMIT_MATRIX.json.

| Commit | Files | Назначение → пользовательский эффект |
|---|---|---|
| 55754de | CONTEXT + 5 SHELL_2A документов | Handoff 2A; runtime NONE |
| 6822a58 | CONTEXT + 3 review-файла 2A | Фиксация проверки; runtime NONE |
| f5eec61 | 21 runtime-файл, components_probe.py, workflow 2B | Общие controls, focus/disabled, guard задачи, Escape composer, close MediaViewer, viewport overlay. Глобальный flex-shrink:0 ломает строки чатов |
| 5326905 | workflow 2B | Ubuntu 22.04 вместо 24.04 для sandboxed browser; runtime NONE |
| f1e5d82 | AMENDMENT_03_DESIGN_AUTHORITY_AND_ORIGINAL_ASSETS.md | Дизайн-полномочия; runtime NONE |
| 39ee3c0 | OWNER_DECISION_AMENDMENT_03.md | Решение владельца; runtime NONE |
| 8ea1c7b | DESIGN_REFERENCE_REGISTER.md | Реестр референсов; runtime NONE |
| ccfdd90 | workspace-editor.js/.css, public-ui-foundation.css, probe, workflow | Fullscreen workspace перенесён в native Popover top layer, сохранён тот же DOM; старые inline overrides ограничены :not(.is-expanded). Исправляет прежнее clipping, но возвращает filename/X в expanded editor |
| f146055 | probe + workflow | Проверки коротких/длинных модальных окон; runtime NONE |
| c5e26c2 | index.html, pablicus.css, probe, workflow | Длинный заголовок modal получает ограниченную высоту, свою прокрутку и keyboard focus |
| d791adc | CONTEXT + 4 COMPONENTS_2B документа | Handoff; runtime NONE |
| 883003e | CONTEXT + 3 review-файла 2B | Запись проверки; runtime NONE |

21 runtime-путь f5eec61 (все внутри pablicus/): app-shell.js, app.js, bot-factory.js, bots.js, chat-canvas.js, chat-library.css, chat-library.js, chat.js, component-registry.js, controls.css, design-tokens.css, index.html, media-viewer.css, media-viewer.js, pablicus.css, rich-composer.css, rich-composer.js, sw.js, tasks-home.js, workspace-editor.css, workspace-editor.js. Дополнительный public-ui-foundation.css появляется в ccfdd90. Итого 22 runtime-пути за весь 2B. Точный numstat первичного коммита — в JSON; не следует приписывать public-ui-foundation.css первому коммиту.

Главный исторический переход для исчезнувшего профиля находится раньше этого диапазона: 1527cc1e0af229d04864dad4882e214b42985feb (Block 1) заменил ux-refinement и отключил его профильные функции вместе с наблюдателями. 2A не является first-bad commit этого исчезновения.

## 5. Feature regression matrix

PRESENT означает найденную активную реализацию/команду. Это не новый production или physical-device PASS. Если hardware/backend поведение не повторялось, оно не объявляется проверенным. Наблюдаемые ограничения указаны отдельно.

| Feature | 2A | 2B | HEAD | Evidence / предел |
|---|---|---|---|---|
| Чаты: список / вход / назад | PRESENT | PRESENT | PRESENT | app.js:398–445; Controller; существующие 1C/2B probes |
| Чаты: поиск по заголовку | PRESENT | PRESENT | PRESENT | app.js:405, searchChats.oninput |
| Поиск по preview сообщения | MISSING | MISSING | MISSING | Удалён ensureSearch в 1527cc1; текущий filter ищет только title |
| Фокус: команда и фильтр | PRESENT | PRESENT | PRESENT | focusKey, focus.onclick, chatFilters |
| Фокус: доступная геометрия звезды | PRESENT | BROKEN | BROKEN | CI screenshots 2A/2B + WebKit 320: right=344 при viewport=320 |
| Избранное: видимый вход | MISSING | MISSING | MISSING | app.js создаёт savedConversation; public-ui-foundation.css:7 скрывает её; правило из a9b3604 |
| Найти человека: отдельная строка | MISSING | MISSING | MISSING | Тот же CSS скрывает findPeople |
| Найти человека / новый разговор через newChat | PRESENT | PRESENT | PRESENT | app.js:424–425 → people.open; прямой entry сохранился |
| Старый локальный group/channel/contact prototype | MISSING | MISSING | MISSING | creation-flows.js не активируется с 1527cc1; backend сообщений отсутствовал и раньше |
| Story preview / фиктивные search-категории | MISSING | MISSING | MISSING | ux-refinement не активен; это не ранее работавший story publish/global search |
| История / reply / reactions / menu | PRESENT | PRESENT | PRESENT | app.js:457+, chat-actions.js:67–124; backend не изменялся этим audit |
| Attach / camera / documents / paste / audio | PRESENT | PRESENT | PRESENT | chat.js:312–355, rich-composer.js; физическая запись/камера не квалифицированы |
| Composer expand / draft / outgoing | PRESENT | PRESENT | PRESENT | chat.js:202–260,384+,445+; storage/outbox исходники сохранены |
| Escape из fullscreen control | BROKEN | PRESENT | PRESENT | В 2A listener был на editor; f5eec61 перенёс его на composer; существующий before/after proof |
| Mobile keyboard / horizontal conversation movement | UNKNOWN | UNKNOWN | UNKNOWN | Симптом владельца принят; точный причинный browser/device trace не получен |
| Canvas: project / editor / save / cancel | PRESENT | PRESENT | PRESENT | chat-canvas.js:89–114,173–218,488–510 |
| Canvas: inline media remove | BROKEN | BROKEN | BROKEN | .richMediaHead display:none скрывает содержащую remove кнопку |
| Canvas/workspace fullscreen | BROKEN | PRESENT | PRESENT | 2A inline !important overrides мешали fullscreen; ccfdd90 исправил через top layer; physical keyboard остаётся UNKNOWN |
| Tasks в Canvas / reminders / archive | PRESENT | PRESENT | PRESENT | chat-canvas.js:119–126,834–852,879–883; серверные операции в этом audit не вызывались |
| Dirty task cancel guard | BROKEN | PRESENT | PRESENT | requestDismissTask в f5eec61; сохранить проверенное deny/accept поведение |
| Дела: Все / Мне / Просрочено / Готово / Архив | PRESENT | PRESENT | PRESENT | tasks-home.js:6; удалений нет |
| Дела: поиск / источник / изменение статуса | PRESENT | PRESENT | PRESENT | tasks-home.js:66,187–218,343–376; source-level сохранность |
| Вы: базовые username/profile/share/copy | PRESENT | PRESENT | PRESENT | app.js:406–408 |
| Вы: последняя иерархия настроек | LEGACY_REAPPEARED | LEGACY_REAPPEARED | LEGACY_REAPPEARED | Source regression 1527cc1; не новая подмена view в 2B |
| Вы: локальная фотография / picker | MISSING | MISSING | MISSING | decorateProfile/resizeAvatar удалены в 1527cc1 |
| Вы: theme/storage/notifications/passkeys/logout | PRESENT | PRESENT | PRESENT | app.js:326–395,409–411; функции остались, организация стала старой |
| Вы: актуальный идентификатор сборки | MISSING | MISSING | MISSING | Показывается постоянная VERSION=0.1.0-rc5 |
| Bots / Factory / Scenario entry | PRESENT | PRESENT | PRESENT | bots-nav.js, bot-factory.js; nested route сохранён |
| Фото/видео в отправленном rich-message | PRESENT | PRESENT | PRESENT | rich-message.js image/video paths; фото без постоянного filename heading |
| MediaViewer / share / download | PRESENT | PRESENT | PRESENT | media-viewer.js; f5eec61 добавил явный close/focus return |
| Фото в composer: photo-first presentation | BROKEN | BROKEN | BROKEN | rich-composer.mediaNode всегда вставляет filename, ×, size/type |
| Expanded workspace: filename/X | BROKEN | BROKEN | BROKEN | Тот же renderer; ccfdd90 сделал ранее скрытый header видимым в fullscreen |

## 6. Physical iPhone defect → code cause matrix

| Симптом | Причина / источник | Происхождение / уровень доказательства |
|---|---|---|
| Исчезнувшие функции и старый «Вы» | Сняли ux-refinement целиком; профильные возможности не перенесли в активный view | 1527cc1; доказано diff и import graph |
| Обрезанные controls / часть интерфейса сдвинута | controls.css:3 запрещает shrink всем button; .chatMain имеет width:100% внутри flex-row рядом со звездой | f5eec61; реальный WebKit screenshot/rect и CI before/after. Это доказательство строки списка, не всей conversation |
| Кривые/разнородные пиктограммы | Смесь SVG MessageMenu, CSS pseudo-icons expand/attach, текстовых ◈/↑/☆ и размеров 10/21/22/44; clipping дополнительно искажает вид | Смесь предшествует 2B; 2B меняет control sizes/font. Геометрический общий стандарт не квалифицирован; новые платные assets не вводились |
| Composer движется при клавиатуре | chat.applyLayout использует vv.width/height/pageLeft/pageTop, AppShell пишет transform/width/height; grid-компоновка и fullscreen имеют отдельные ограничения | Формула с 491ec31; 6c01d8b только перенос writer. Точная физическая причина НЕ доказана |
| Полотно разрастается / отрывается | Несколько scroll regions: chatCanvasPanel → inline workspace body; expanded workspace переходит в native top layer и считает offsetTop/height отдельно | Старые правила + ccfdd90; fresh physical keyboard causality НЕ доказана |
| Фото с IMG_*.jpeg и X | rich-composer.js:145,147–150,195–198; workspace-editor.js:128–132 | Renderer с ef302c8; inline hiding с a9b3604; fullscreen exposing ccfdd90 |
| Снова старая версия | app.js:5 VERSION и :411 info, не определение версии по фактически загруженному view | 8900e72; одинаково в 2A/2B/HEAD |
| Смесь поколений | Остаточный CSS активен при отключённых JS-decorators; плюс доказанный механизм mixed PWA generation | Source-смешение подтверждено; кэш конкретного iPhone UNKNOWN |
| Нет видимого результата при PASS | Проверки ограничивали route/controls/guards; feature parity и физическая клавиатура не были критериями. Clipped звёзды уже видны в PASS-артефакте | Пробел квалификации; физические наблюдения владельца этим PASS не опровергаются |

## 7. Missing functions list

Подтверждённо отсутствуют: локальный avatar picker; пятираздельная иерархия настроек; поиск по preview; отдельный прежний search overlay; видимые Saved/findPeople entries (они были скрыты уже до 2A, не являются новой потерей 2B); initial-avatar в шапке разговора; прежние локальные creation/story prototype surfaces. Отдельно сломана доступность inline attachment remove, а не удалена сама операция removeBlock.

Нельзя называть прежние прототипы готовыми продуктами: группы/каналы сохраняли только локальные карточки без сообщения в backend; contact sync и QR не были реализованы; story «Готово» закрывало preview без durable story; большинство global-search tabs показывали пояснения. Block1 IMPLEMENTATION.md явно фиксировал вывод local-only prototype из canonical navigation. Это не отменяет будущие CATEGORY_A требования. Их возврат и границы должны быть явно решены в recovery, без фиктивных success.

## 8. Legacy components that re-entered runtime

Повторного подключения legacy JS между accepted 2A и HEAD не найдено. ux-refinement.js, public-hotfix-v8.js, creation-flows.js, ux-repair-20260911.js не входят в текущий entry graph; присутствие в SW allowlist не выполняет JavaScript.

Фактически остались active legacy CSS rules в public-ui-foundation.css и извлечённых частях shell.css. ccfdd90 снял их влияние с .workspaceEditor.is-expanded — из-за этого вновь виден технический attachment header. Это изменение каскада, не импорт второго composer.

## 9. Composer geometry root cause

Для физического сдвига именно conversation/composer root cause остаётся UNKNOWN.

Подтверждённая схема: chat.js:248–254 → AppShell.viewport (app-shell.js:40–45). Абсолютный #app получает translate3d(left,pageTop,0), width=min(vv.width,800), height=vv.height; обычный composer — relative grid item; fullscreen — absolute inset:0 внутри #app. Эта формула существовала до 2A.

В shell.css:187 присутствует fixed composer для public-keyboard-open. В свежем graph никто не устанавливает этот legacy class: объявлять данное правило причиной текущего runtime без доказательства смешанного кэша нельзя. WorkspaceQuick размещает свой popover в document.body; его нельзя ошибочно считать fixed-child transformed #app. Прямой двойной keyboard offset в нормальном fresh path не доказан.

Нужно измерить pageLeft/offsetLeft/scrollX/scale, app/composer rect, scrollLeft всех предков и activeElement непосредственно при физическом симптоме. Локальный WebKit подтвердил clipping списка, но conversation probe завершился timeout до таких измерений. Нельзя подменять этот пробел гипотезой или overflow:hidden.

## 10. Canvas geometry root cause

В 2A доказанный CSS конфликт: public-ui-foundation принуждал .pccPlanEditor .workspaceEditor к position:relative/height:auto даже при expanded. Исправление 2B ccfdd90 сохранять: inline selectors ограничены :not(.is-expanded), fullscreen — тот же DOM в manual Popover top layer с opaque surface.

Текущие координаты: workspace-editor.js:203–218 и CSS:42; top=visualViewport.offsetTop, height=visualViewport.height. Native top-layer element не следует автоматически трактовать как fixed descendant transformed app. Без showPopover fullscreen не открывается, остаётся inline с сообщением — это явный compatibility limitation, а не полная поддержка старого Safari.

Дополнительные области проверки: max-height 38/48dvh внутри уменьшившегося visual viewport, safe areas, nested scrolling, toolbar sizing и сохранение focus при collapse/reopen. mountCanvasView в app.js:143 уже вызывает collapseEditor; нельзя объявлять одновременный composer-fullscreen+canvas-active нормальным постоянным состоянием только по наличию CSS selectors.

Точная причина нынешнего физического разрастания/отрыва после ccfdd90 НЕ установлена. До нового measured before FAIL geometry patch не предлагается как доказанное исправление.

## 11. Attachment filename/X root cause

Активный ordered composer: rich-composer.js, mediaNode(). Имя вставляется в .richMediaName:145; × создаётся button('Убрать вложение', '×', ...):147–150; тип/размер в .richMediaDetails:195–198. Эти элементы создаются и для image. Изображение добавляется отдельно ниже. Это прямой source cause технического UI.

WorkspaceEditor использует тот же RichComposer и отдельно decorateRemote() для уже сохранённых media: workspace-editor.js:128–132,154–161. Имя и details восстанавливаются из remote block. Inline CSS скрывает всю richMediaHead вместе с remove; expanded после ccfdd90 её показывает. Поэтому простое display:none сохраняет дефект доступности удаления.

Параллельный старый renderer addAssetNode/updateAssetNode в chat.js:262+ существует для legacy fallback; при активном richComposer идут capture/restore/addFiles rich-path. Отправленные rich images используют rich-message.js:553–567 и не создают тот же filename/X header; legacy single-image app.js:463 тоже использует image presentation. Нельзя исправлять renderer сообщений вслепую по симптому composer.

## 12. «Вы» rollback root cause

В текущем source tree две реализации base-profile: /pablicus/app.js:406–411 и старая копия /app.js:369–373. Только первая подключается /pablicus/index.html. Корневой index.html — отдельный Vision Talk media-v29 с inline script, он не выбирает второй профиль как fallback Pablicus.

До engineering-перехода active /pablicus/app.js дополнялся ux-refinement.decorateProfile: avatar upload/crop, share/copy и settings hierarchy. В 1527cc1 decorator заменили 13-строчным compatibility adapter. К моменту 2A новый профиль уже отсутствовал. 2B не переключал profile flags/templates, профильная ветка логически не менялась, кроме shared control annotation.

Итог: SOURCE REGRESSION подтверждён. Cache mismatch возможен отдельно, но для объяснения старого «Вы» не нужен. Простой VERSION replacement проблему не исправляет.

## 13. Version label root cause

pablicus/app.js:5: VERSION='0.1.0-rc5'. :411 выводит строку в профиле, :609 — PablicusDebug.version. Происхождение: 8900e72bec6a1002a4f93915bf5d513208c5d75f.

manifest.webmanifest не содержит build/version: только name/id/start_url/scope/icons. SW VERSION — имя cache, не отображаемая release version. Поэтому rc5 не позволяет отличить 2A, 2B или старый cache. Идентификатор candidate/release должен быть связан с реальным artifact, а не косметически заменён.

## 14. PWA/cache finding

Да, один URL/устройство может получить смесь поколений. Выполнена локальная алгоритмическая проба на неизменённом реальном sw.js с in-memory Cache/Fetch boundary — без production/user storage.

PWA-QUERY-MIX: REPRODUCED. Worker проверяет urls.includes(u.href) (sw.js:8). /pablicus/?conversation=... не совпадает с закэшированным /pablicus/: HTML уходит в network. app.js без query попадает в старый CacheStorage. Новый app-shell.js, отсутствующий в старом allowlist, приходит из network. Получена комбинация HTML=new / app.js=old / app-shell.js=new. Query-ссылки реально создаёт notificationclick самого worker.

PWA-INSTALL-NO-REVISION-BINDING: REPRODUCED. Install последовательно fetch(cache:'reload') и put каждого unversioned URL. Нет source manifest/digest validation. Если серверная ревизия меняется между запросами, один cache содержит old+new.

PWA-UNCHANGED-WORKER-AFTER-RUNTIME-CHANGES: CONFIRMED. sw.js побайтово одинаков в f5eec61, ccfdd90, f146055, c5e26c2, 883003e: SHA-256 538916a82c6025678cd847a47ae1ff048d31316ad82d3834c06d01ddfed068aa. Cache key: pablicus-shell-block02-2b-candidate. При уже установленном раннем 2B worker поздние runtime changes не получают новую cache generation. При этом в найденной публичной истории была одна публикация финального 2B; установка раннего 2B на iPhone НЕ доказана.

ACTIVATE вызывает skipWaiting; activate удаляет старые pablicus-shell-* caches и clients.claim. app.js:603–607 перезагружает только вкладку, где approveUpdate=true; остальные получают toast и могут продолжать старый in-memory JS под новым worker. Update вызывает Chat.flush, но явно не проверяет Canvas leave guard: дополнительный риск для dirty Canvas при update, не воспроизведённый здесь product FAIL.

Публичный HTML на момент проверки: HTTP 200, Cache-Control:max-age=600, last-modified 2026-09-12 16:10:48 GMT. HTTP TTL не ограничивает срок CacheStorage, который worker возвращает без проверки возраста. updateViaCache:'none' относится к проверке worker, не обеспечивает атомарность всей оболочки. Asset filenames и HTML imports не содержат content hashes.

Для конкретного iPhone: наличие mixed cache UNKNOWN. Версия UI rc5 его не доказывает. Старые cache/data владельца не очищались.

## 15. Exact files requiring repair

Подтверждённые области минимального patch, после отдельного разрешения:
- pablicus/controls.css — убрать layout ownership из общего control contract; разрешить shrink растягиваемым строкам, сохранить размеры icon controls.
- pablicus/app.js — восстановить явную profile/settings composition, preview search, build presentation, безопасный update guard.
- pablicus/public-ui-foundation.css — удалить obsolete suppression и скрытие remove вместе со всем media header; согласовать с восстановленными владельцами.
- pablicus/rich-composer.js/.css — contextual attachment presentation без изменения blocks/files/bytes.
- pablicus/workspace-editor.js/.css — такое же представление remote/local attachment, сохранив native fullscreen и focus cleanup.
- pablicus/sw.js и pablicus/index.html — deterministic release graph/update.

Только после недостающего geometry reproduction: pablicus/app-shell.js, shell.css, chat.js, chat-canvas.css, workspace-editor.css, pablicus.css. Это suspect/qualification list, не разрешение переписать каждый файл.

## 16. Minimal recovery sequence

1. Закрыть оставшиеся forensic gaps: точный проверенный URL/build, Safari/iOS/standalone, keyboard/scroll/zoom trace, layout A/B, сравнение cache generations. Сохранить before FAIL.
2. Первым ограниченным patch исправить доказанный flex-shrink regression и доступность затронутых controls; добавить проверку child rect/scrollWidth, а не только document width.
3. Восстановить утраченные profile/settings/search/Saved surfaces внутри существующего app/Controller/AppShell. Не включать обратно observer/hotfix. Старый avatar key был общим для аккаунтов — автоматически присваивать его текущему пользователю нельзя.
4. Исправить только доказанные mobile containment причины в едином shell owner; сохранить currentness, Canvas leave, draft/outbox и fullscreen top-layer fixes.
5. Сделать media-first attachment actions, сохранив удаление и original bytes/IDs/order/resolvers. Удаление header CSS без нового доступного action не считать исправлением.
6. Связать release identity/asset graph/cache generation; квалифицировать query deep links, waiting worker, две вкладки, dirty Canvas и interrupted update на synthetic данных.
7. Повторить Block1/2 suites + требуемые viewport/state checks и затем отдельную физическую проверку владельца. Software PASS не снимает physical gate. Любая публикация — только по отдельному разрешению Матвея.

## 17. Risks and exact gaps

Не получены модель/iOS/режим Safari-vs-installed-PWA, точный owner URL с query и снимок cache/worker контроллера. Нельзя связать все физические симптомы с конкретной cache generation.

Локально: Chromium первые пробы завершились goto/fill timeout; WebKit дошёл до synthetic login, Chats и Profile, дал screenshots/rects, затем click timeout. Отдельные geometry и диагностический flex A/B прогоны получили goto timeout 90000ms до assertions. Их причина не локализована; это НЕ qualified negative controls и не доказанные product bugs. Ошибки collector сохранены. WebKit build 2140 был предоставлен Playwright как frozen вариант для macOS 13, browser.version сообщает 26.0; это не физический Safari/iPhone.

Таким образом, измерение clipped Focus подтверждено, но временный CSS A/B причинный прогон не завершён. Полное воспроизведение horizontal conversation movement / keyboard / expanded Canvas не получено. Нужны actual before/after measurements до geometry patch. Полный physical test matrix не выполнен.

Формальная история 2B противоречит последнему тексту задания; нужен отдельный owner/reviewer disposition, а не молчаливое переписывание истории. Для текущего audit и запрета recovery это не мешало чтению.

Новый дизайн D0–D7 сюда не переносился. Неподтверждённые удаления/прототипы нельзя превращать в fake backend или забывать обязательный будущий CATEGORY_A scope.

## 18. What must NOT be touched

main, production, Supabase/RLS/Auth, реальные пользовательские данные, accepted history; transport-store/vault/outbox/rich-store semantics; accepted Controller identity/currentness/leave/cleanup fixes; original bytes/IDs/order. Не делать reset/clean/force-push/rollback/deploy, не включать global repair observers и не менять IA/иконный дизайн. Не удалять или ослаблять тесты.

Фактические действия: чтение Git/GitHub metadata и двух публичных static assets, локальные архивы/пробы/screenshots. Runtime/test/workflow diff = NONE; working tree CLEAN. Recovery patch, commit, GitHub write, merge, deployment = NONE. Диагностические материалы находятся вне Git-репозитория. В конце проверки local и remote HEAD повторно совпали с 883003ebe9ae25d3c97b657234d0b6cab72414dd; рабочее дерево чистое. Процессы forensic-браузеров и серверов завершены; отдельный сервер design-d1 не затрагивался. Safety refusal в этом проходе не получен; source-write не проверялся, потому что теперь не разрешён.

## 19. Proposed next task ID

PABLICUS-BLOCK02-SELECTIVE-RECOVERY-R1.
Предлагаемая первая обязательная фаза — закрыть перечисленные geometry/cache gaps; runtime patch только после отдельного разрешения Матвея, с measured before FAIL → after PASS. Новый task не создавался, следующий блок не начат.


## Локальные первичные материалы

- EVIDENCE_INDEX.json — SHA-256 отчёта, JSON evidence, диагностических скриптов и screenshots.
- COMMIT_MATRIX.json — полные SHA, даты, авторы и paths всех 12 commits.
- RUNTIME_HISTORY_HASHES.json — source binding шести контрольных ревизий.
- PWA_MECHANISM_PROOF.json и sw_mechanism_probe.cjs — результаты и воспроизводимая алгоритмическая проба.
- DIAGNOSTIC_LIMITATIONS.json — полные browser errors и неполнота collectors.
- screenshot-provenance.json — исходные пути CI screenshots 2A/2B и свежих локальных captures.

Материалы сохранены в outputs/forensic; копии сделаны без изменения исходных evidence.

STATUS: BLOCK_2_FORENSIC_INCOMPLETE_WITH_EXACT_GAPS
