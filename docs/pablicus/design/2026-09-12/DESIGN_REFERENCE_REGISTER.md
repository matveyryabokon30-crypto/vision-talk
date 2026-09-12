# Pablicus — Design Reference Register

**Date:** 2026-09-12  
**Status:** REFERENCE_ONLY  
**Owner:** Матвей

**Дополнение после чтения чата «Проверка сайтов обучения»:** [восстановленные решения и точные пробелы](../../recovery/2026-09-12/SITES_CHAT_RECOVERY.md). Ниже сохранён первоначальный реестр, затем добавлены ранее пропущенные 72pt, Codenotch и поздние подборки. Полнота оригинальных вложений ещё не достигнута; названный источник не равен просмотренному файлу.

Этот реестр предназначен для контура «Главный дизайнер проекта». Он фиксирует найденные первоисточники и извлекаемые принципы. Ни один сторонний asset не становится автоматически частью Pablicus.

## 1. Owner rule

- Платные сторонние fonts/icon packs не входят в целевую систему Pablicus.
- Нелицензированные коммерческие assets не использовать даже как временную runtime-зависимость.
- Для прототипов — только system/free/open-source substitutes с подходящей лицензией.
- Цель — собственные Pablicus icons и собственная типографическая идентичность.
- Референсы изучаются на уровне visual/motion/interaction principles; прямое копирование запрещено.

Каноническое основание: `docs/pablicus/approved/2026-09-12/AMENDMENT_03_DESIGN_AUTHORITY_AND_ORIGINAL_ASSETS.md`.

## 2. RonDesignLab — найденные видео

### Hydroflask
Instagram Reel:
https://www.instagram.com/reel/DcL4oRFMeaS/

Portfolio:
https://dribbble.com/shots/27699907-Hydroflask-Smart-Water-Bottle-Mobile-App
https://dribbble.com/shots/27619760-Hydroflask-Smart-Water-Bottle-Mobile-App

Изучать: glowing gradient cards, frosted surfaces, hierarchy of stats, object-focused motion, foreground/background separation.

### Credit Karma — дополнительные video references
https://www.instagram.com/reel/DafvgKSMbGz/
https://www.instagram.com/reel/DafZYKasmvT/

Это дополнительные примеры студии, не подмена CreditPros.

## 3. CreditPros

Official case:
https://rondesignlab.com/cases/credit-pros-saas-dashboard-ui-ux-design

Dribbble:
https://dribbble.com/shots/27678963-CreditPros-Credit-Repair-Financial-Dashboard-UI

Изучать: card hierarchy, data readability, account/object cards, desktop/mobile relationship, contextual information density.

В кейсе назван Red Hat. Это reference fact, не решение использовать этот font в Pablicus.

## 4. My Notes — AI Assistant

Official case:
https://rondesignlab.com/cases/my-notes-app-smart-ai-assistant

Изучать: frosted glass, dynamic gradients, contextual editing toolbar, AI inside work surface, floating controls, relation between content and contextual actions.

В кейсе назван Urbanist; точечный display font описан непоследовательно как Matricha/Matricia. Эти названия не являются Pablicus dependencies.

Показанная палитра кейса (#93DCDF, #EFAF86, #BB96DA, black, white) — reference palette конкретного чужого проекта, не Pablicus tokens.

## 5. Серии из подборки владельца, для которых точный Reel ещё требуется найти/проверить

- Small Balances / Converter crypto wallet;
- CreditPros exact motion posts;
- Home Air Purifier;
- transit / fleet telemetry;
- другие присланные владельцем серии.

Не выдавать статичную страницу или похожий ролик за доказательство точной анимации. При нахождении видео фиксировать URL, автора, дату, соответствие кадрам и какие motion/interaction principles реально наблюдаются.

## 6. Что извлекаем в Pablicus

Разрешённые направления исследования:

- translucent/frosted surfaces;
- layered depth;
- soft luminous gradients;
- restrained blur;
- floating contextual cards;
- expandable contextual panels;
- cinematic but functional presentation;
- large readable hierarchy;
- motion that explains hierarchy/state;
- persistent object identity across chat/panel/fullscreen;
- independent foreground panel behavior without dragging the underlying chat;
- contextual AI/actions near the object being edited.

## 7. Pablicus interaction hypothesis to design and validate

`Chat card → expanded work panel → optional fullscreen → return to exact chat context`.

Requirements:

- preserve object identity, draft, selection and scroll return position;
- explicit modal/non-modal behavior;
- keyboard and safe-area correctness;
- accessible close/back alternatives to gesture-only control;
- independent panel drag/scroll where appropriate;
- readable non-transparent fallback for dense content;
- real Pablicus object/function underneath the visual transition.

Это design hypothesis для разработки и owner review, а не утверждение, что конкретный сторонний Reel реализует механику именно так.

## 8. Assets policy

Не использовать Iconly Pro или иной платный pack как целевую зависимость. Если подобные наборы изучаются, только как reference taxonomy/style benchmark. Для временной сборки использовать разрешённые бесплатные/system placeholders с маркировкой TEMP. Финальный набор — оригинальный Pablicus.

## 9. Полный реестр названных источников из рабочего чата

Основание: 60 ходов ChatGPT `6aa41e2c-4db8-83ed-adf5-ff2f4be59292`. «Из чата» означает извлечённое историческое утверждение, а не повторно выполненный визуальный аудит. Референс не утверждает токены, палитру, активы или поведение Pablicus.

| ID | Источник | Что сохраняем / состояние доказательств |
|---|---|---|
| R01 | RonDesignLab, https://rondesignlab.com/ | Главная большая подборка владельца: 120 image-вхождений в ходах 30–41. Их оригинальные байты ещё не получены; невозможно перечислить каждую изображённую работу только по заглушкам. |
| R02 | Cargo TMS | В ходе 40 назван Urbanist конкретного кейса. Не доказательство шрифта остальных проектов; точная ссылка в тексте хода не раскрыта. |
| R03 | Everybot Cleaner | Названный в каталоге кандидат для сопоставления с оригиналами; это не подтверждённая идентификация всех кадров. |
| R04 | Cutter | То же; точный кадр/URL ещё не сопоставлены. |
| R05 | Katana | То же; точный кадр/URL ещё не сопоставлены. |
| R06 | Hydroflask | Два Dribbble URL и Reel в разделе 2. Свет, градиентные карточки, статистика, крупный предмет. Точное motion-поведение не подтверждено текущим просмотром. |
| R07 | Credit Karma | Два Reels в разделе 2; дополнительная серия, не CreditPros. |
| R08 | CreditPros / серия TD Bank | Источники раздела 3. Карточки и раскрываемые сведения; Red Hat повторно подтверждён текстом официального кейса. Точный Reel остаётся отдельным пробелом. |
| R09 | My Notes | Раздел 4. Контекстные действия/AI рядом с выбранным содержимым; официальный кейс повторно прочитан. Urbanist и конфликт Matricha/Matricia — историческая reference-запись, не выбранные шрифты Pablicus. |
| R10 | Small Balances / Converter crypto wallet | Два названия серии из чата/канонического реестра; точные оригиналы и публикации не сопоставлены. |
| R11 | Home Air Purifier | Различать с Everybot; отсутствует доказательство, что это один проект. |
| R12 | Transit / fleet telemetry | Motion/телеметрия/рабочие пространства из backlog; оригиналы ещё нужны. |
| R13 | Iconly / @iconlypro, https://iconly.pro/ | Два полученных исходных PNG осмотрены: согласованные outline/filled пары и знаки внутри glass-контрола. Использовать как benchmark грамматики, не копировать pack. Раннее отдельное вложение хода 42 не получено. |
| R14 | 72pt / Kalypso / @kalypsodesigns | https://72pt.app/ , /about , /changelog , /accessibility. Основной interaction-reference, подробно ниже. |
| R15 | Codenotch / Vincent de Genouillac | https://github.com/vinzdg/codenotch . Репозиторий точно совпал с полученным screenshot. MIT-код — согласованный источник инженерной основы; не generic UI kit. |
| R16 | juicelab.uiux — ZIKO fintech / Light Shot | Три исходных JPEG осмотрены: свободная светлая композиция, предметная банковская карточка, крупная типографика, локальная нижняя зона действий. https://www.instagram.com/juicelab.uiux/ — профиль по видимому имени; точный post URL не получен. |
| R17 | dyslove.design — New Color Combos | JPEG осмотрен: стеклянная карточка поверх изображения, тёмно-синий/оранжевый свет, большая белая типографика. https://www.instagram.com/dyslove.design/ ; не утверждённая палитра. |
| R18 | uxintace / @arc.graphique — Best Color Combos, Part 2 | JPEG осмотрен: типографическая композиция фиолетовый/белый на тёмном фоне. В начале второго видео дополнительно видны #F6F3ED, #C2CBD3, #313851. Публикатор uxintace, внутри кадра указан @arc.graphique; первичное авторство требует отдельной проверки. |
| R19 | tranmautritam — liquid glass + mesh gradients | Первое полученное видео, 16.305 s: четыре страницы с Thinking / Searching / Planning / Listening, смена цветового/материального состояния capsule. Это отдельный material-reference, не 72pt. Профиль: https://www.instagram.com/tranmautritam/ . |
| R20 | githubsignals — обзор Codenotch | Второе полученное видео, 32.600 s: прокрутка README и статичная иллюстрация notch. Это обзор проекта; видео не демонстрирует живой drag или Edge Picker 72pt. Профиль: https://www.instagram.com/githubsignals/ . |
| R21 | Apple / Liquid Glass / spatial/native principles | Источник общих исследований в owner correction, не разрешение скопировать UI Apple. Поздний D1 register содержит WWDC25/219, typography/text-fields, custom symbols WWDC21/10250 и reduced-motion criteria. |
| R22 | Linear, Telegram, Arc, Claude | В ходе 49 названы как исследовательские ориентиры с прямым запретом клона. Конкретные owner-вложения для каждого не установлены. |
| R23 | WhatsApp, WeChat/Weixin, Discord, LINE (+ Telegram) | Конкурентная функциональная база Amendment 02, не пять выбранных визуальных шаблонов. |
| R24 | suraj.dsgn, uxbrainy, aida.maag, uiuxikbal | Имена видны на соседних/частично попавших в поздние screenshots постах. Сохранены для полноты происхождения; нельзя считать их полноценными выбранными референсами или восстановить невидимую часть поста. |

Профильные URL, составленные из видимого handle, не заменяют точную ссылку на пост. Прямое веб-чтение Instagram-профилей Kalypso/juicelab/dyslove/uxintace завершилось ошибками получения; это не доказательство удаления материалов.

## 10. 72pt — требование, факт и пробел

Владелец в ходе 57 потребовал перенести принцип: боковое управление меняет представление содержимого, основная рабочая область остаётся устойчивой. Это прямое требование даже при недоступности видеобайтов.

Официальные About и Accessibility повторно прочитаны: каталог шрифтов, предпросмотр собственного текста, коллекции/iCloud, установка на Mac; разработчик описывает Dynamic Type, VoiceOver, Reduced Motion и адаптацию прозрачности/контраста. Это заявления разработчика, не тест установленного приложения. About: https://72pt.app/about ; Accessibility: https://72pt.app/accessibility . Changelog при новой проверке не открылся; историческая проверка сохранена отдельно.

Из ответа исходного чата восстановлено описание Edge Picker: фиксированная active position, движущиеся соседние варианты, раскрываемая подпись, циклический выбор. Числа 46/96 pt, 12 pt, icon 20 pt, drag threshold 8 pt и optical adjustment 2 pt приведены автором чата со ссылкой на недоступные схемы. **В текущем восстановлении они не перепроверены по оригиналам и не являются токенами Pablicus.**

Точный исходный пакет `Pablicus_72pt_reference_01.zip`, два MP4 и пять изображений хода 57 не извлечены. Ссылка вида `chatgpt-content-reference index=10` не раскрывает downloadable URL. Полученные видео хода 58 относятся к tranmautritam и githubsignals и не заменяют 72pt. Нельзя выдавать contact sheets этих двух видео за запрошенный дизайнеру deliverable 72pt.

Стартовая Pablicus-гипотеза: один Work Object, виды Оригинал / Предложение ИИ / Сравнение. Смена вида сохраняет ID, draft, selection и anchor; не запускает действие и не принимает правку. Положение, форма и modes ещё не утверждены. Должны быть tap/keyboard alternatives, понятная отмена drag, независимая прокрутка, safe areas, keyboard и Back.

## 11. Codenotch — согласованное направление reuse

Владелец в ходе 59 выбрал совместить reuse открытого кода с собственной библиотекой и собственным дизайном. README описывает разделение `along/across`, `NotchPlacement` и `NotchLayout`; Windows-порт использует Rust/Tauri 2/WebView2 и отдельный `ui/notch.html`. Повторно прочитаны [основной README](https://github.com/vinzdg/codenotch/blob/main/README.md), [Windows README](https://github.com/vinzdg/codenotch/blob/main/windows/README.md) и [LICENSE](https://github.com/vinzdg/codenotch/blob/main/LICENSE).

В данной задаче проверены идентичность источника и документация, не выполнен полный аудит реализации или перенос кода. При будущем переносе фиксировать upstream SHA, выбранные файлы, изменения и notices. Исследовать геометрию и взаимодействие; функции доступа Codenotch к чужим AI credentials не входят в потребность UI-библиотеки Pablicus. Desktop placement/hover не доказывают готовность phone tap/drag/keyboard.

## 12. Фактически полученные файлы и наблюдения

Локальный source-of-truth полученных originals: `/Users/artem/Documents/ChatGPT/Pablicus/context-recovery-sites-20260912/attachments/`. Все сохранены побайтово, SHA-256 в локальном MANIFEST.json. Статус каждого — USER_PROVIDED_THIRD_PARTY_REFERENCE, не продуктовый asset и не одобрение дизайна.

| Файл | Осмотр / назначение |
|---|---|
| DAF6B5DB-D458-400B-B9C8-EB90E5248643.jpeg | ZIKO, 3 экрана вместе |
| 0391DE33-94B0-48B1-ADCF-8A81AD7B14B5.jpeg | ZIKO, onboarding на устройстве |
| 1428FABC-3D27-4BAA-9F00-620BE602F574.jpeg | ZIKO, transfer/cards/actions |
| F690B136-AF4D-4870-916C-0BB8BBA9FF45.png | Iconly, home/search/add внутри control |
| 5385C81E-1CB0-4D5D-AE83-A94F31F081B0.png | Iconly, 4 outline/filled пары |
| 6163E264-DD9A-42C9-B5A5-37AC4B3696D3.jpeg | dyslove, glass/color cover |
| BFD93C97-18CA-470F-9D47-329DBB70F4F1.jpeg | uxintace / arc.graphique, typography/color cover |
| 91F9639C-18A8-44B3-BB1F-29E22B205674.jpeg | githubsignals, точный GitHub URL Codenotch |
| ScreenRecording_09-12-2026 22-11-07_1.mp4 | tranmautritam, material states, 16.305 s |
| ScreenRecording_09-12-2026 22-11-59_1.mp4 | uxintace palette + githubsignals README overview, 32.600 s |

Для двух MP4 просмотрены 98 последовательных кадров с шагом 0.5 s на протяжении обоих файлов, собраны 8 contact sheets с таймкодами. Это анализ визуального ряда выборкой, не покадровый просмотр всех 30 fps и не прослушивание аудиодорожки. Он устанавливает содержание и различие источников, но не измеренные easing, latency или точные gesture thresholds. Таймкоды смен страниц первого ролика: около 3.5 s Searching, 8 s Planning, 13 s Listening; это переходы записанной Instagram-карусели, не доказательство внутреннего UI-переключения приложения.
