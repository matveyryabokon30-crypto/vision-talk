# Pablicus — D1 / Three Future Design Directions

Версия: D1 R1 · 12 сентября 2026.
Статус: D1_DELIVERED_FOR_OWNER_REVIEW. DESIGN_APPROVED: false.
Владелец: Матвей. Направление не выбрано. D2 не начат.

## 1. Основание и границы

Применено прямое решение PABLICUS-OWNER-DESIGN-CORRECTION-20260912 revision 1.0 из сообщения владельца. D0_COMPLETE_READY_FOR_D1. Прежний D0_SOURCE_AUDIT_DELIVERED_WITH_VISUAL_EVIDENCE_GAP остаётся исторической записью, а не текущим блокером. D0-V1 отменён. Legacy UI — LEGACY ENGINEERING PROTOTYPE / NOT_A_DESIGN_BASELINE. Скриншоты legacy используются только как evidence ошибок и регрессий.

Основание: канонический снимок ветки refactor/pablicus-foundation-20260911, SHA d791adc19aade1015f4ba34cf4beb5ce2069c93f, восстановленный в D0. Прочитанные Plan 1.0, Amendments 01–03, шесть owner/plan решений и reference register перечислены в SOURCE_LEDGER.csv D0. D1 не является новым инженерным acceptance audit. Исторические инженерные статусы в D0 не менялись.

Приоритет: прямые решения владельца → утверждённые Plan и Amendments → будущие функции и сущности → права/приватность → сценарии → reference principles → ограничения реализации. Внешний вид текущего приложения не задаёт дизайн.

Проектируем связность: разговор → объект → работа → действие → AI/агент → проверяемый результат → публикация/сервис/повторное использование. Root navigation: только Чаты / Дела / Вы. Пять инженерных блоков сохраняются; Block 6 не создаётся.

Артефакты локальные. Runtime, production, Supabase, deploy и инженерные задачи не изменялись. HTML — статическая галерея проектных состояний с прокруткой и копированием отчёта, не реализация нового приложения. Изображения — концептуальные визуализации. Данные и результат агента в них вымышлены.

## 2. Как смотреть пакет

Открыть index.html. Сначала три hero boards, затем одинаковые 26 состояний каждого направления, tablet, desktop, large text, собственные SVG и storyboard. Галерея листается горизонтально; длинное содержимое отдельного телефона — вертикально.

Source of truth этого D1: данный текст для семантики/поведения + точные образцы index.html для компонентной композиции + icons/A,B,C для representative glyphs. Hero PNG передают характер, но не точные размеры, начертания, безопасность и финальный текст. При расхождениях контракт этого отчёта выше PNG. D1 не содержит production-ready token set или финальных icon masters всего продукта.

Все три направления оцениваются без логотипа и без смены сценария. Нельзя принимать красивый кадр за доказательство реализованных функций.

## 3. Целевое исследование

Реестр research/RESEARCH_REGISTER.md содержит источник, что реально наблюдалось, принцип, вывод для Pablicus и запрет копирования. Исследованы официальные описания Apple материалов/типографики/ввода/иконок, Claude Artifacts, Telegram topics/search/checklists, RonDesignLab My Notes и CreditPros. Непосредственно осмотрен статичный mobile collage My Notes. Маркетинговые проценты эффективности не использованы.

Видео не выдаются за просмотренные: у WWDC изучен текст транскрипта; точные ролики из owner register не все верифицированы. Неподтверждённые Small Balances, Air Purifier, fleet и exact CreditPros motion не используются как evidence конкретной анимации. Собственные переходы ниже — проектные гипотезы.

## 4. Общая постановка сценария

Команда «Север» готовит видео на 30 секунд. Аня приносит материалы в разговор «Север / Выпуск», создаётся сценарий. AI сокращает выделенный фрагмент. Агент «Редактор» предлагает изменения только выбранного объекта; Аня проверяет их. Результат можно связать с делом, подготовить к публикации или превратить в повторно используемый шаблон/сервис.

Единый fixture: account demo-anna; space demo-sever; conversation demo-release; message msg-104; work object wo-17; draft d-17; run run-8; source revision v1; proposal p2; сохранённая после согласия revision v2. Это тестовые обозначения, не изменение backend schema. Локальная дата примера 12.09.2026, часовой пояс Europe/Moscow.

01 authenticated home; 02 Чаты; 03 Conversation; 04 Rich message; 05 Composer/keyboard; 06 attachment/media; 07 AI Inline; 08 agent invocation; 09 object creation; 10 compact object; 11 expand; 12 contextual workspace; 13 fullscreen; 14 progress/approval; 15 result; 16 task/publication/reuse; 17 exact return; 18 Дела; 19 Вы; 20 Search; 21 Saved; 22 Space/Community; 23 Channel/publication; 24 Factory; 25 Возможности; 26 mini-app/service.

SCENARIO_MATRIX.csv связывает каждый пункт с A-01…26, B-01…26, C-01…26. Не все состояния показывают root bar: внутри разговора и рабочего режима доступны Back/Close, а при клавиатуре root bar освобождает место вводу.

## 5. Direction A — ОРБИТА / ORBIT

1. Тезис: рабочий объект получает самостоятельный объём, сохраняя источник в разговоре. Идентичность читается по постоянным заголовку, маркеру и revision.
2. Визуальное лицо: тихий фарфор, открытые контуры, мягкое отделение foreground. Узнаваемый приём — объект поднимается из потока, а действия остаются рядом с ним.
3. Material language: opaque content; слегка прозрачный navigation/control layer. На плотных текстах, формах и approvals прозрачность запрещена. Нет стекла внутри стекла.
4. Color behavior: фон #EEF3F0; текст #142F29; действие #255E4C; тихий contextual tint #DCEBE3. Цвет контента не окрашивает смысловые статусы. Success имеет подпись; awaiting approval — отдельную подпись и маркер.
5. Typography: interim Inter, body 17/25, title 34/39, labels 14/20, numbers tabular. Target: открытые апертуры, умеренная ширина, высокая x-height, мягкие соединения; выразительность без чрезмерной округлости.
6. Icon direction: мягкие разомкнутые контуры. AI — встречные дуги, Agent — замкнутый paired node, Object — открытый рабочий контейнер. 21 собственный SVG в icons/A.
7. Geometry/navigation: независимый объект radius 24; внутренние controls 12–16; компактный root dock с тремя равными зонами. Не все rows получают карточку. Desktop dock становится боковой root rail.
8. Chat: спокойный поток с авторами и редкими самостоятельными объектами. Reply/Thread открываются с явным источником. Media имеет собственный aspect ratio, подпись и статус загрузки.
9. Composer: единый мягкий контейнер draft + вложения + контекст AI. Меню вложений появляется из соответствующей зоны, не меняя draft. Agent picker показывает область доступа до запуска.
10. Object/Canvas: lift → expanded opaque panel → fullscreen. Independent scrolling; на телефоне panel modal, на desktop dock non-modal. Жест работает только за handle, не за текст/медиа.
11. AI: AI Chat — личный разговор; In Context — локальный помощник объекта; Inline — предложение к выделению; Composer — работа с draft. AI не получает права агента автоматически. Память открывается через источник контекста и настройки AI.
12. Agent: отдельная идентичность исполнителя, run card и approval. Мягкая граница карточки не должна скрывать риск действия или область прав.
13. Social: автор, аудитория и preview важнее хрома. Space выбирает область; Channel доступен из Space/Вы и поиска. Публичные публикации отделены от приватных исходников.
14. Factory/Capabilities: сервис — повторно используемый объект с контрактом, автором, версией и правами. Последовательность brief → specification → isolated test → service. Каталог не становится root tab.
15. Motion: появление foreground через изменение границ 280–320ms; fullscreen 240ms; collapse 220ms. Background не zoom/translate; тень меняется без анимации blur. Timings — гипотезы D1, не утверждённые tokens.
16. Mobile: A-01…26, 390×844. Текст на opaque substrate; controls reachable снизу; status/safe zones свободны.
17. Tablet: 834×1194; разговор 300px + workspace 534px. При тесном split view — последовательное mobile presentation.
18. Desktop: 1440×1024; root rail 220px, разговор 370px, остальное объект. Панель не должна уменьшать ширину уже открытого чата во время morph: dock allocation сначала, возврат якоря после layout.
19. Accessibility: A-large — непрозрачный белый слой, 23px example, vertical reflow; Reduced Motion: dissolve ≤100ms или instant, заголовок источника остаётся.
20. Icon family: весь требуемый representative набор приведён в галерее и используется в компонентах. Активность через container + label; glyphs пока outline, не окончательная семья filled.
21. Common scenario: A-01…26; данные совпадают с B/C.
22. Риски: избыточное glass, высокий визуальный вес панелей, конкуренция клавиатуры и листа. Ограничение: один рабочий foreground на mobile; вложенный modal не складывается бесконечно.
23. Сложность: высокая относительно B/C по shared geometry, interruptions и material fallback. Оценка качественная, без обещаний сроков.
24. Оригинальность: собственная связь object identity, открытой геометрии и тихого материала. Родство с общими native patterns остаётся; сходство с чужим UI нельзя исключить одним заявлением. Нужен последующий visual similarity review.
25. Owner board: сравнивать лёгкость пространственного перехода и сохранение читаемости. Решение PENDING.

## 6. Direction B — ФОЛИО / FOLIO

1. Тезис: мысль из разговора раскрывается в рабочий документ, который можно проверить и опубликовать.
2. Визуальное лицо: общий «переплёт» объекта, спокойная редакционная иерархия, поля для замечаний. Без имитации бумаги/перелистывания книги.
3. Material: opaque ivory pages, разделение линиями и отступами; blur 0. Depth задаётся сменой структуры документа и поля источника.
4. Color: #F6F2E9 background, #272B34 ink, #304CAD action, #E5E9F7 selection. Red/orange reserved для требующего решения состояния, не повсеместной декорации.
5. Typography: Golos Text для UI; Source Serif 4 для крупных содержательных заголовков. Обе interim. Body 17/26; title 34/40; serif не используется для мелких controls. Target: сильная кириллица, спокойный текст, авторская display пластика без заимствования гарнитуры.
6. Icons: открытые bookend strokes, более прямые окончания; AI — bracket с точкой, Agent — двойная метка, Object — поле с корешком. Собственные icons/B, 21 glyph.
7. Geometry/nav: radius 4–8 для controls; object узнаётся вертикальным spine, не радиусом. Root labels на общей плоскости, selected underline. Tablet/desktop превращают нижнюю навигацию в спокойный индекс.
8. Chat: авторские строки и hanging indents, лёгкие разделители. Разговор остаётся быстрым; длинные ветки не имитируют документ редактора. Media занимает ширину поля.
9. Composer: закреплённая строка письма с устойчивой baseline. Выбор AI не меняет режим Send молча. Draft можно раскрыть в полноэкранное редактирование.
10. Object/Canvas: вкладка раскрывается в page workspace. Spine и источник постоянны. Mobile — последовательная modal page; desktop — page рядом с источником. Нет 3D page curl.
11. AI: In Context в поле замечаний; Inline показывает original/proposal. На 390px поля НЕ сжимают текст в узкую колонку: предложение переносится под выделение. AI Chat — обычный личный разговор с отличимой ролью.
12. Agent: редакционный review, авторство каждого предложения, diff и scope. Agent run — не «всегда правильный редактор»: failure/unknown confidence видны, решение остаётся человеку.
13. Social: публикация продолжает язык документа; профиль выступает страницей автора. Audience и права находятся рядом с publish action. Stories и followers расширяют профиль только в утверждённом scope.
14. Factory/Capabilities: specification-first последовательность; карточка сервиса как краткий паспорт с input/output/test. Каталог использует списки с явными типами, не витрину одинаковых плиток.
15. Motion: раскрытие page clip 220–260ms, fullscreen 180–220ms, collapse 180ms. Текст reflow выполняется в конечном размере, не масштабируется во время чтения. Reduced Motion — instant + выделение source.
16. Mobile: B-01…26, 390×844. При крупном тексте комментарии, statuses и actions переходят на новые строки. Встроенный media viewer остаётся полноценным.
17. Tablet: разговор/индекс 300px и page 534px; AI suggestion под выделением, если margin не помещается.
18. Desktop: 220/370/850px; документ max 65ch, замечания доступны в боковом поле при достаточной ширине. Хронология и объект прокручиваются отдельно.
19. Accessibility: B-large; полностью opaque, типографическая иерархия не зависит от serif. При отсутствии custom font применяется fallback без потери labels.
20. Icons: 21 собственный outline glyph; линии согласуются с текстом, optical alignment проверяется на 16/20/24/32 после выбора направления.
21. Scenario: B-01…26; та же fixture и тот же review gate.
22. Риски: слишком «документальный» образ для живого общения; слабая различимость run vs annotation; узкие поля на mobile. Ответ: mobile annotations stacked, отдельный run header.
23. Сложность: средняя относительно A; основные затраты — reflow, text selection, комментарии и устойчивое редактирование.
24. Оригинальность: новый для Pablicus язык conversation insert → рабочая страница → reusable specification. Общие editorial conventions не объявляются уникальным изобретением.
25. Owner board: сравнивать качество длинной работы, силу типографики и жизненность общения. PENDING.

## 7. Direction C — РЕЛЕ / RELAY

1. Тезис: входные материалы, действие и результат образуют обозримую цепочку; пользователь всегда знает, что выполняется и что ждёт решения.
2. Visual identity: смещённые стыки, короткие rails, ясные модули; технологичность через структуру, не декоративную телеметрию.
3. Material: матовые opaque панели; blur 0. Depth — contextual dock и уровни выполнения, без многослойного стекла.
4. Color: #EDF0F5 background, #172A45 ink, #2449C8 action, #E0E6FB selection; #934120 approval. Цвет не заменяет текст состояния.
5. Typography: Manrope interim, body 17/25, title 32/38, tabular numbers. Target: semi-geometric кириллица, открытые малые формы, ясные временные интервалы; не monospace для разговоров.
6. Icons: угловатые rails и ports; AI — сходящиеся пути, Agent — узел с портами, Object — контейнер со стыком. 21 icon/C, новые SVG paths.
7. Geometry/nav: controls radius 6–10; root three segment rail. Не рисовать connections там, где они не отражают реальную связь данных. Desktop: постоянная root rail, адаптивный dock.
8. Chat: общий поток, самостоятельный модуль только у WO/run/interactive block. Сообщения не превращаются в workflow nodes.
9. Composer: modular input с выделенными Attach/AI/Send, expanded tray для команд. Переключение command/agent не отправляет остаток текста другому адресату.
10. Canvas: модуль расширяется в секции. Фазы — материалы/работа/проверка, не новая root navigation. Fullscreen сохраняет модульный marker, заголовок, source.
11. AI: inline proposal на ветке от выбранного содержимого; AI Chat доступен как личный разговор. AI in Context показывает context scope; память можно исключить до запроса.
12. Agent: run timeline, инициатор/исполнитель/полномочия; awaiting approval прерывает progression. A2A раскрывает подзадачи по запросу, не заполняет ими чат. Нет фиктивного процента готовности.
13. Social: публичный контент свободнее сетки исполнения; phase rail не показывается читателю публикации. Автор и аудитория первичны.
14. Factory/Capabilities: input → contract → test → result; сервис имеет тип, версию, автора, trust и permissions. Коммерческие условия показываются до install/run, но D1 не изобретает модель оплаты или backend.
15. Motion: модуль расширяется 180–220ms; рабочие секции появляются без каскада ожидания; fullscreen 180ms, collapse 160ms. Progress marker меняется только от события; никакого бесконечного «бегущего света».
16. Mobile: C-01…26. Соединения короткие, не требуют горизонтального pan. Main action и close доступны без drag.
17. Tablet: 300/534px; 2 области, последовательность работы вертикальная. При split resize возвращаем single-surface presentation.
18. Desktop: 220/370/850px; детали run в workspace, разговор остаётся разговором. Только пользователь переключает активный объект.
19. Accessibility: C-large — контрастные подписи, вертикальная схема, no animation; цветные rails дублируются текстом этапа.
20. Icons: 21 representative glyph; tiny-size simplification и filled states остаются D2, не берутся из коммерческого pack.
21. Scenario: C-01…26; общий fixture, без добавления более выгодных для концепции функций.
22. Риски: ощущение инженерной панели; перегрузка rails; преждевременный success. Ограничение: показать только текущий уровень, детали по запросу.
23. Сложность: средне-высокая; больше state/provenance presentation, меньше material/shader сложности, чем A.
24. Оригинальность: связность разговора и исполняемого объекта через небольшие модульные соединения; не клон automation canvas. Требуется owner review без логотипа.
25. Owner board: сравнить ясность исполнения и простоту повседневного общения. PENDING.

## 8. Общий interaction contract — проект для review

### Object lifecycle

До раскрытия сохраняются conversation/thread ID, message anchor + relative offset, object ID + revision, draft/selection, attachment order, focused control, panel scroll. Pixel scrollTop сам по себе недостаточен при новых сообщениях или resize.

Mobile expanded panel modal: background inert, scroll locked на существующей позиции; focus входит в heading/первый нужный control, не открывает keyboard автоматически. Independent panel scroll. Swipe только за handle; selectable text, media и native edge gestures не перехватываются. Close и Back всегда доступны.

Tablet/desktop при наличии двух читаемых областей: dock non-modal; обе области доступны клавиатуре, без focus trap. Активная область видна. Drag panel — только optional desktop arrangement, не обязательный способ управления. Mobile свободный drag окна не используется.

Fullscreen сохраняет object ID и editor state. Переход не создаёт новый объект и не меняет права. Browser Back закрывает верхний transient layer до ухода из conversation. Esc закрывает меню, затем overlay; при несохранённых изменениях — явный save/discard/cancel.

Return: восстановить layout → anchor message → offset → выделение и draft → focus исходного trigger. Если trigger исчез, показать ближайший доступный контекст с сообщением причины. Если права отозваны, не возвращать закрытый текст из cache. Если новые сообщения пришли ниже, показать «Новые сообщения», не autoscroll.

Interruptions: при повторном open/close переход отменяется в текущей геометрии; не дублировать панель. Resize во время анимации завершает переход в валидный layout. Reduced Motion сохраняет тот же state path без transform.

### Composer lifecycle

Один draft на conversation/thread. Текст, selection/caret, reply target, вложения и порядок переживают picker/AI/panel. IME composition не отправляет Enter. На touch Send отдельной кнопкой; на desktop сочетание определяется настройкой, Enter не должен случайно отправлять многострочный контент.

Keyboard height — системное значение, не fixed 270px: в образце 270px — резерв для storyboard. Composer над keyboard, нижняя safe area не добавляется второй раз. Root nav скрывается. AI toolbar располагается над selection, а при нехватке места — над composer без перекрытия ввода.

Attachment picker заменяет keyboard или открывает системный picker; возврат сохраняет draft. Failed upload показывает retry/remove, отправка не изображает подтверждённый файл. Send создаёт pending delivery; confirmed state только по результату. Failed send сохраняет outbox/draft recovery.

### Agent lifecycle

idle → queued → running → awaiting approval → applying → succeeded. Боковые пути: denied, cancelled, failed, offline/pending, expired approval, stale revision. Run не считается завершённым по окончанию stream.

Approval содержит действие, объект, изменяемую revision, audience при публикации, scope прав, исполнителя и последствия. Refuse не запускает действие. Apply не расширяет scope. Разрешение на чтение объекта не даёт публикацию или доступ ко всему Space. A2A не расширяет права родителя.

Результат сохраняет provenance и revision. Create task связывает две сущности; публикация начинает private preview; reuse очищает/явно выбирает приватные bindings. Нельзя выдавать private draft за опубликованное.

### Motion storyboard timings

| Переход | A | B | C | Reduced Motion |
|---|---|---|---|---|
| Chat → expanded object | lift/resize 280–320ms | page reveal 220–260ms | module expand 180–220ms | instant или dissolve ≤100ms |
| Workspace → fullscreen | 240ms | 180–220ms | 180ms | сохранить heading/source, instant |
| Collapse → exact return | 220ms | 180ms | 160ms | anchor highlight без перемещения |
| Composer → keyboard | следовать system curve | следовать system curve | следовать system curve | системное поведение |
| Attachment → AI proposal | local reveal 160ms | annotation insert 120ms | local section 120ms | instant, label нового состояния |
| Agent → approval → result | спокойная смена card state | review annotation | phase label | текстовое событие/announcement |

Никакой переход не блокирует действие только ради окончания анимации. Haptics concept для future native: один лёгкий отклик на committed action; success/error по факту, настройка выключения; отсутствие haptics не теряет смысл.

## 9. Mobile, responsive и accessibility

390×844 — базовый iPhone specimen, не заявление о тестировании на устройстве. Safe fixture 59pt top/34pt bottom; runtime обязан получать реальные insets. Ничего важного под Dynamic Island/status region. Touch targets минимум 44×44pt, primary actions 48–56pt; иконка 24px не означает target 24px. Между соседними targets минимум 8px, где возможно.

Проверяемые layouts следующего этапа: 320, 390, 430px portrait; 844×390 landscape; 834×1194 tablet; narrow split view; 1440×1024 desktop; browser zoom 200%. Landscape mobile при низкой высоте использует fullscreen workspace, прячет вторичные controls в меню, не сжимает editor между несколькими панелями. Breakpoints определяются читаемой шириной: ориентир <720 single, 720–1199 two areas, ≥1200 root rail + two areas. Они ещё не финальные tokens.

Body 17px, line-height ≥1.45. Long RU/EN переносится; usernames — до двух строк с доступом к полному имени. Главное действие, права и ошибки не обрезаются ellipsis. Large text пример23px включён для каждого направления, но D5 обязан проверить все accessibility sizes и screen reader order.

Contrast target: обычный текст ≥4.5:1, крупный ≥3:1, значимые control outlines/focus ≥3:1. Цвет дополняется текстом/shape. Все approvals opaque. Reduced Transparency убирает glass A; B/C opaque изначально. Focus ring 3px + offset, видим на каждой поверхности. Loading объявляется один раз, streaming не зачитывается посимвольно. Изменения run — polite announcement, критическая ошибка адресно.

Hero PNG имеют иллюстративные ограничения: B показывает узкое поле AI, которое на реальном390px должно идти под выделением; C местами показывает root bar внутри fullscreen — в точном контракте он скрыт; A декоративные glyphs и малые подписи не являются финальными assets. Эти расхождения исключены из точных component specimens. Реальный iPhone/VoiceOver и performance ещё не проверялись.

## 10. Иконки и типографическая стратегия

Создано 63 оригинальных representative SVG: 21 для каждого направления. Chats, Tasks, Profile, AI, Agent, Object/Canvas, Search, Compose, Attachment, Photo, Camera, Microphone, Send, Back, Close, More, Check, Calendar, Share, Notification, Settings.

Общий D1 grid24; рабочая зона преимущественно3…21; stroke A/C1.8, B1.7; outline. A round terminals, B square/bookend, C angular/ports. Badge не включён в glyph: отдельный overlay с текстовым accessibility label. Unread не накрывает смысловой центр. Active должен иметь минимум два признака: положение/подложка/подпись; не только color.

Оптические коррекции D2: round overshoot, масса диагоналей Send/Back, небольшое смещение визуального центра, упрощение16px, согласование с font weight. Morph только между семантически связанными состояниями; AI не превращается в human avatar. Web export SVG viewBox24, currentColor, без внешних ссылок/scripts; button даёт accessible name. Native позднее PDF/vector assets с scale и accessibility mapping. Эти SVG — D1 draft masters, не полный final inventory285 и не platform-certified assets.

Пакет fonts содержит квалифицируемые interim Inter, Golos Text, Manrope и Source Serif4 с OFL. Источники Google Fonts repo; тексты лицензий сохранены. Кириллица/латиница/цифры сверяются по cmap в validation, однако наличие glyph не равно optical QA. Free font не становится «собственным шрифтом Pablicus».

Target font-production brief после выбора: согласовать proportions, x-height, width, apertures, ритм Cyrillic/Latin; проверить Д/Л/Ж/Ф/Ы/Й/ё, строчные б/д/т, Latin a/g/I/l, 0/O/1, знак ₽ и временные диапазоны; weights400/500/600/700, optional450; tabular+proportional figures. Возможные axes wght/opsz, width только если действительно нужен compact UI. Display layer может стать оригинальным lettering; полный font family требует отдельного производства, hinting, kerning и лицензирования новых файлов.

## 11. Будущая продуктовая система

Три направления используют одну IA; визуальная плотность раскрывается постепенно.

| Семейство | Вход | Связь с объектом / права |
|---|---|---|
| Private/group chat, Topics, Threads | Чаты → scope → разговор | topic — область обсуждения; thread — ветка к сообщению; отдельные drafts |
| Rich/interactive: polls, events, checklists, forms | сообщение / composer | actor permission; pending/server result; expired action |
| AI Chat / Context / Inline / Composer | личный помощник / выбранный объект / выделение | context sources и memory отдельно от прав агента |
| AI memory | AI context inspector / Вы → AI settings | view/edit/delete, включение по scope, приватность; не общая память по умолчанию |
| Canvas revisions/comments/shared editing | WO → workspace | revision, автор, presence, conflict; агентный diff не молчаливое overwrite |
| Дела / Saved / Search | root / Вы или shortcut / header search | task identity; saved origin; поиск соблюдает permissions |
| Profile/social/channels/discovery | Вы, Space, public search | private/public audience; публикация через preview; stories scope не расширяется молча |
| Agents / A2A | conversation invocation / run inspector | инициатор, исполнитель, scope, approvals, stop, provenance |
| Factory / Bots / workflows / video creation | Дела → Создать → Factory; выбранный объект | specification/test/runtime раздельно; reusable service без приватных bindings |
| Возможности / commerce | каталог из Дела/Space/Factory | agent/bot/mini app/plugin/skill/integration/workflow; author/version/trust/permissions; commercial terms до действия |
| Mini-app | сообщение / объект / каталог | host chrome, safe area, close, isolated content и host permission gate |
| Roles / moderation | Space settings / content menu | report/review/appeal where approved; moderator не получает private object автоматически |
| Notifications | header/Вы | run result, mentions, approvals; переход с проверкой доступа; не Saved |
| Account/security/privacy | Вы → настройки | sessions, consent, revoked/expired/suspended/deleted states; recovery |
| Calls/live readiness | conversation header contextual action | зарезервированная поверхность permission/prejoin/ongoing, без обещания реализации или четвёртой root tab |

Полный coverage сохраняет D0 matrix49. На D1 показана способность языка обслужить scope; детальные flows D3/D4 и полное состояние D5 ещё не объявлены завершёнными.

## 12. State coverage и D1 acceptance граница

Для каждого flow в D3–D5 обязательны: empty, loading, pending, error, offline, reconnect, conflict, denied, expired, cancelled, long content/usernames, keyboard, safe areas, reduced motion/transparency, high contrast, account recovery. На D1 реально показаны draft, selection/proposal, running-to-approval storyboard, awaiting approval, success fixture, large text/opaque, compact/expanded/fullscreen/return. Остальные здесь определены как требования, а не изображены и проверены на runtime.

Review checks перед D2: различимы A/B/C без смены цвета; одинаковы26 шагов; root semantics сохранены; AI/agent/person/result отличимы; объект остаётся одним; читаемы approvals; понятен Close; icons собственные; interim fonts названы; legacy не baseline. Полная реализационная acceptance возможна после D2–D7, не в этом отчёте.

Открыто: owner selection, точные дополнительные motion refs, тест на реальном iPhone, user testing, final icon optical pass, полный typography QA, окончательные tokens, будущие commercial terms и неутверждённый релизный social scope. Отсутствие авторизованного legacy runtime не блокирует этот D1.

Проверка пакета: 78/78 идентификаторов mobile frames, 26 строк общей matrix, 63 валидных SVG; локальные ссылки присутствуют; встроенный текст отчёта совпадает с MD. В четырёх fonts cmap содержит RU/Latin/цифры/₽. Расчёт контраста основных пар: body/base 12.65–12.74:1; white/primary 7.54–7.60:1 для A/B, C — см. VALIDATION.json. Это не проверка всех сочетаний и rendered состояний. Встроенный браузер дал три timeout; альтернативный isolated headless capture также не получен. Кнопка Copy присутствует и имеет fallback, но её взаимодействие в браузере не проверено.

## 13. Owner comparison и остановка

| Критерий | A / Орбита | B / Фолио | C / Реле |
|---|---|---|---|
| Объединяющий приём | отделяющийся объект | раскрывающаяся страница | связанный рабочий модуль |
| Сильная сторона гипотезы | пространственная непрерывность | чтение/создание/проверка | понятность исполнения |
| Основной риск | слои и материалы | излишняя документальность | излишняя техническая структура |
| Сложность | высокая | средняя | средне-высокая |
| Typography | открытая sans | text sans + editorial display | semi-geometric sans |
| Material | opaque + limited glass controls | opaque ruled surfaces | matte modules |
| Решение | PENDING | PENDING | PENDING |

Матвей может выбрать A/B/C, указать конкретную комбинацию, отклонить все, запросить D или изменить требования. Победитель и комбинация не выбраны дизайнером. DESIGN_APPROVED не установлен. Работа останавливается на OWNER REVIEW. D2 только после прямого решения владельца.
