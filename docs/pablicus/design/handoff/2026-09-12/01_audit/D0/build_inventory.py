from pathlib import Path
import csv, json, re, hashlib, subprocess

OUT = Path(__file__).resolve().parent
SRC = OUT.parent / 'design-d0-source'
SHA = subprocess.check_output(['git','-C',str(SRC),'rev-parse','HEAD'],text=True).strip()

# D0 research register. Each row is a flow family, not an assertion of runtime completeness.
RAW = '''
F01|App Shell|P1/A2/A3|BASE|SOURCE_BASELINE|2|D2|Чаты/Дела/Вы; шапка; nested entry; responsive split|C01 C02 C03 C04|S03 S04|M01 M02|pablicus/index.html; pablicus/app-shell.js; pablicus/shell.css|Сохранить три вкладки и одного владельца геометрии
F02|Список чатов|P1/A2|BASE|SOURCE_BASELINE|2/3|D3|Все/Фокус; строка диалога; unread; new conversation; filters|C03 C05|S03|M01 M02 M07|pablicus/app.js:398-415; pablicus/chat-list-view.js|Не сбрасывать позицию при обновлении и возврате
F03|Личный чат|P1|BASE|SOURCE_BASELINE|2/3|D3|История; header; reply; reactions; message menu; media; outbox|C05 C06 C07|S03 S04 S07|M02 M07 M11|pablicus/chat.js; pablicus/app.js; pablicus/chat-actions.js|Delivery/read только при фактическом подтверждении
F04|Групповой чат|P1/A2|A|PARTIAL|2/3/4|D3|Создание/выбор участников; разговор; group info; invite; permissions; leave|C01 C05 C12|S03 S08|M02 M06|pablicus/creation-flows.js; docs/engineering/block-02/SHELL_2A_COMPONENT_REGISTRY.md|Локальная неподключённая форма не доказывает серверную группу
F05|Threads|A2|A|CONTRACT_ONLY|2/3|D3|Thread list; ветка; reply in thread; источник; unread; return|C05 C06|S03 S04 S07|M02 M07|pablicus/component-registry.js; A2 §5.2|Отдельная сущность от Canvas
F06|Topics|A2|A|CONTRACT_ONLY|2/3/4|D3|Topic directory; topic detail; создание/редактирование; перенос/архив|C01 C03 C05|S03 S08|M01 M02|A2 §5.2; §6|Уточнить связь Topic и Thread; не изобретать backend contract
F07|Media/attachments|P1/A2|BASE|SOURCE_BASELINE|2/3|D3|Picker; upload; preview; gallery; file/audio/video viewer; download; source|C06 C07 C04|S03 S04|M06 M11|pablicus/rich-composer.js; pablicus/rich-message.js; pablicus/media-viewer.js|Сохранить оригинал и доступный Close; offline/expired media
F08|Composer text/files/voice|P1/A1/A2|BASE|SOURCE_BASELINE|2/3|D3|Inline/fullscreen; draft; reply; voice; menu; attachment order; send|C06 C02 C04|S03 S04|M05 M06|pablicus/rich-composer.js; pablicus/workspace-editor.js|Один draft при раскрытии; IME и interrupted recording
F09|Composer commands/agents/objects|A1/A2|A|CONTRACT_ONLY|2/3/5|D3|Commands; mentions; agent picker; object link/create; task conversion|C06 C08 C09 C11|S03 S04 S06|M05 M08 M09|pablicus/component-registry.js composer contract|Контракт расширения не означает действующее исполнение
F10|AI Chat|A1/A2|A+P1|CONTRACT_ONLY|2/3/5|D3|Список AI бесед; новый/продолжить; rename; history search; export; delete; result|C05 C06 C10|S03 S04 S06|M02 M08 M09|A1 §6; pablicus/component-registry.js|Свободный разговор без Factory; восстановление истории между устройствами
F11|AI in Context|A1/A2|A|CONTRACT_ONLY|2/3/5|D3|Context picker; область данных; contextual panel; sources; handoff to agent|C08 C10 C11|S04 S06 S07|M03 M08 M09|A1 §3; A2 §8.1|Контекст и полномочия видимы; mention не открывает весь аккаунт
F12|AI Inline / in Composer|A1/A2|A|CONTRACT_ONLY|2/3/5|D3|Выделение; исправить/сократить/расширить/перевести/тон/структура; diff; accept/reject|C06 C08 C10|S04 S06 S07|M05 M08|A2 §5.5/§6; composer extension contract|Не заменять оригинал автоматически; защита ревизии
F13|AI results/errors/approvals|A1/A2|A|CONTRACT_ONLY|2/3/5|D3|Answer/source; editable file; partial output; stop/retry; quota; approval exact action|C10 C11 C15|S03 S06 S07 S08|M08 M09 M13|A1 §4/§7; PablicusUI PrivateAgentResult/ActionConfirmation|Ответ модели и выполненное действие различимы
F14|AI memory/settings|A1|BASE|NOT_ESTABLISHED|4/5|D3|Список памяти; добавить/изменить/удалить; disable; personal settings; usage|C10 C14|S03 S06|M06 M08|A1 §3/§6/§8|История/контекст/память разные; скрытый профиль не включён
F15|Canvas / Полотно|P1/A2|BASE|PARTIAL|2/3|D3|Conversation Canvas; project list/card; view/edit; tasks; source links|C08 C09 C06|S03 S04 S07|M02 M03 M04|pablicus/chat-canvas.js; pablicus/workspace-editor.js|Существующий общий проект не полная Work Object модель
F16|Work Object representations|P1/A2/A3|BASE|CONTRACT_ONLY|2/3|D3|Compact card; expanded panel; fullscreen; exact chat return; deep link|C08 C04 C01|S03 S04 S07|M03 M04 M10|PablicusUI WorkObjectPreview/SidePanel/FullScreenObjectView|Object identity неизменна; independent panel scroll
F17|Revisions/comments/shared editing|P1/A2|BASE|PARTIAL|3/5|D3|Revision history; diff; comments; agent changes; collaborators; conflicts|C08 C10 C11|S03 S04 S07|M08 M10|pablicus/chat-canvas.js recoverConflict/renderTaskConflict; P1 §3|Есть conflict recovery; полноценный общий revision UI не установлен
F18|Дела|P1/A2|BASE|SOURCE_BASELINE|2/3|D3|Все/Мне/Просрочено/Готово/Архив; search; detail; source; assignee/date/reminder|C09 C03 C06|S03 S04 S07|M02 M12 M13|pablicus/tasks-home.js; pablicus/chat-canvas.js|Сохранять фильтр/позицию и явно показывать неизвестный результат
F19|Вы / identity|A2/A3|A|PARTIAL|2/4|D3|Мой профиль; публичный профиль; username/share link; edit; privacy|C14 C03|S03 S08|M01 M06|pablicus/app.js renderHome; pablicus/people.js|Публичное имя отдельно от телефона/приватных контактов
F20|Stories/followers profile surfaces|A3/owner task|SCOPE_TBD|NOT_ESTABLISHED|4|D4|Followers/following; channel shortcut; stories only after scope decision|C12 C14|S08|M01 M06|A3 §4; app.js unavailable feed text|Не считать заглушку утверждением Stories первого релиза
F21|Global Search|A2|A|PARTIAL|2/3/4/5|D3|Query; scopes; filters; people/chat/message/channel/Space/file/object/agent/service results; source return|C03 C05 C08 C10 C13|S03 S07 S08|M02 M07|app.js title filter; people.js; chat-library.js; A2 §5.3|Разделить private/global и public discovery; не показывать закрытые данные
F22|Saved / Personal Inbox|A2|A|PARTIAL|2/3|D3|Saved collection; types; save/remove; personal note; original source; inaccessible source|C03 C07 C08|S03 S04 S07|M02 M07|app.js start_saved_conversation; A2 §5.4|Избранное сейчас personal conversation; определить link vs copy
F23|Spaces / Communities|A2|A basic; B advanced|CONTRACT_ONLY|2/3/4/5|D4|Directory/switcher; create/join; Space overview; conversations/topics/objects/files/services; members|C01 C03 C12|S03 S07 S08|M01 M02|A2 §5.1; registry IA|Один контейнер с общей областью прав
F24|Channels / Publications|P1/A2|BASE+A|NOT_ESTABLISHED|3/4|D4|Channel info; posts; subscribe; editor; private preview; publish approval; history|C12 C07 C08|S03 S04 S08|M06 M14|P1 §3/§5; A2 §7; creation-flows.js unloaded|Серверная публикация отдельно от draft и приватного оригинала
F25|Discovery / subscription feed|P1/A2|A basic; C recommendations|NOT_ESTABLISHED|2/4/5|D4|Public search; directories; editorial picks; subscription feed; follow states|C12 C03 C13|S03 S08|M01 M02|P1 §3; A2 §7.3|Не вводить root Лента; не обещать сложную recommendation engine
F26|Notifications|A2/A3|BASE|PARTIAL|2/4/5|D4|Permission onboarding; notification centre; unread; preferences; deep link; reminders; run result|C14 C15 C03|S03 S06 S08|M07 M09 M13|pablicus/push-notifications.js; pablicus/inbox-monitor.js|Push baseline не полный центр; не путать с Saved
F27|Rich messages|P1/A2|A|PARTIAL|3|D4|Text/headings/lists/table/quote/code/media/file/form/task/result/service/carousel blocks|C07 C05|S03 S07|M07 M11|pablicus/rich-message.js; A2 §6|Текущие rich media не доказывают полный MessageDoc v2
F28|Interactive messages|A2|A|NOT_ESTABLISHED|3/5|D4|Buttons/choices; poll; event; checklist; lightweight form; approvals; result actions|C07 C11 C09|S03 S04 S06 S08|M06 M09 M12|A2 §6|Safe blocks; истёкшее действие/повтор/нет прав; без произвольного runtime доступа
F29|Scheduled content/reminders|A2|A|PARTIAL|3/4/5|D4|Schedule message/post; queue; edit/cancel; reminders; recurring where applicable|C09 C12 C15|S03 S04 S08|M12 M13 M14|chat-canvas.js scheduleOf/buildSchedule; A2 §7.4|Task reminders не подтверждают scheduled publications; timezone и DST
F30|Translation / summary|A2|A supported|CONTRACT_ONLY|3/4/5|D4|Translate; original toggle; language; summary; source span; correction|C07 C10|S03 S06 S07|M08|A2 §7.5|Оригинал, перевод и AI-summary различимы
F31|Agent identity/permissions|P1/A2|A|CONTRACT_ONLY|2/4/5|D4|Agent card; install/member; capabilities; allowed context; permission review/revoke|C11 C13 C12|S06 S08|M06 M09 M14|P1 §4; A2 §8; registry|Личный, разовый и установленный агент имеют разные границы
F32|Agent runs/results/failure|P1/A2|A|CONTRACT_ONLY|3/5|D4|Run card; progress/timeline; checkpoint; cancel/retry; approval; result; failure/recovery|C11 C08 C15|S03 S06 S07 S08|M09 M13|PablicusUI AgentTaskCard/PrivateAgentResult; P1 §4|Долговечный ID и реальное завершение; не просто stream текста
F33|Agent-to-agent delegation|A2|A controlled; B autonomous|NOT_ESTABLISHED|5|D4|Delegation timeline; initiator/executor/reason; context/rights/budget; stop; result attribution|C11 C10|S03 S06 S08|M09|A2 §8.2|Нет автоматического расширения прав и бесконтрольных циклов
F34|Factory|P1/A2|BASE+A|PARTIAL|2/3/5|D4|Brief/materials; clarifications; specification; build; isolated checks; private service; test result|C13 C06 C11|S03 S04 S06 S08|M09 M14|pablicus/bot-factory.js; P1 §3/§5|Baseline specification/planner; real running instance отдельно
F35|Bots / scenario editor|P1|BASE|SOURCE_BASELINE|2/5|D4|Bot list/create; details/settings; run/stop; chat; submissions; scenario/version|C13 C07 C06|S03 S04 S06 S08|M02 M06 M14|pablicus/bots.js; pablicus/bot-scenario-editor.js|Сохранить работающие сценарии; engine acceptance не выполнялся в D0
F36|Возможности / trust|A2|A catalogue/trust; B/C marketplace|NOT_ESTABLISHED|2/4/5|D4|Catalogue/filter; agent/bot/mini app/plugin/skill/integration/workflow detail; publisher/version/trust; install/revoke|C13 C03 C11|S03 S06 S08|M06 M14|A2 §8.3/§8.4|UNVERIFIED/VERIFIED/PABLICUS_REVIEWED — канонический минимум или owner-approved эквивалент
F37|Mini-app runtime|A2|A limited|CONTRACT_ONLY|2/3/5|D4|Host chrome; launch from chat/result/profile/channel/Space/link; loading/error; permissions; exit/return|C13 C04 C08|S03 S04 S06 S08|M03 M04 M14|A2 §8.5; P1 §7|Изоляция от DOM/сессии host; не считать interface preview runtime
F38|Community roles|A2|A|NOT_ESTABLISHED|4/5|D4|Members; invite/approve; Owner/Admin/Moderator/Editor/Member/Guest/Agent; edit/revoke|C12 C14|S03 S08|M06 M14|A2 §7.1|Название роли не заменяет реальные server permissions
F39|Moderation|A2|A; AI guardian B/C|NOT_ESTABLISHED|4/5|D4|Report; block; moderation queue/detail; actions; membership approval; audit log|C12 C15 C11|S03 S06 S08|M06 M14|A2 §7.2|Модератор видит причину/объект/действие; AI не получает неограниченные права
F40|Settings / privacy / permissions|P1/A1/A2/A3|BASE|PARTIAL|2/4/5|D4|Theme/text/accessibility; notifications; storage; sessions; privacy; permissions; AI memory|C14 C02 C15|S03 S04 S06 S08|M06 M13|app.js profile; push-notifications.js; A1 §6|Нужна единая settings IA и точная область каждого разрешения
F41|Account / access / recovery|P1/A3|BASE|SOURCE_BASELINE|2/4|D4|Login/provider/passkey; approval pending; expired; restore access; session switch; logout; account unavailable|C14 C02 C15|S03 S04|M01 M06 M13|index.html; access.html; passkey-start.html; app.js authenticate|Сохранность/изоляция draft; не раскрывать данные другого аккаунта
F42|Offline / storage / PWA recovery|P1/A3|BASE|PARTIAL|2/3/4|D5|Offline banner; outbox; local-save errors; reconnect; update saved draft; recovery; storage usage|C15 C14 C06|S03 S04 S07|M13|app.js connection/showOutbox; transport-store.js; index updateNotice; P1 §3|Local saved не cloud backup; Service Worker не квалифицирован текущим аудитом
F43|Content / video pipeline|P1/A1|BASE|NOT_ESTABLISHED|3/5|D4|Original; transcript/timecodes; edit plan; subtitles/composition/audio; preview; render; verified MP4/post; publish|C16 C08 C11 C12|S03 S04 S06 S07 S08|M09 M11 M14|P1 §6; A1 §6|Real reproducible media result; оформление не требует повторной расшифровки
F44|Deep links / QR|A2|A links; B QR|PARTIAL|2/3/4/5|D4|Object/service/person link; auth resume; unavailable/expired/denied; return; future QR launch|C01 C08 C13 C15|S03 S07 S08|M02 M03 M14|people.js profileLink; A2 §8.6|Profile link не универсальный object deep link
F45|Calls / media sessions|A2|B|CONTRACT_ONLY|2/3; future engine TBD|D4 readiness|1:1/group audio/video; active session; share; devices/handoff; call links; permission/connection states|C17 C04 C14|S03 S10|M15|registry calls slots; A2 §10|Architectural surfaces only; не обязательный полный call release
F46|Voice rooms / Stage / Live|A2|B/C|CONTRACT_ONLY|2/3/4/5 readiness|D4 readiness|Speaker/audience/moderator; text companion/reactions; recording reference; transcript→tasks/objects|C17 C12 C08|S03 S06 S10|M15 M09|A2 §7.7|Отдельная будущая квалификация recording/media/moderation
F47|Business / creator monetization|A2|B; partial A only after decision|NOT_ESTABLISHED|4/5 readiness|D4 readiness|Business profile/hours/location; replies/greeting; agent→human takeover; catalog/bookings; paid channel/tips|C12 C13 C14|S03 S06 S08|M14|A2 §7.6/§8.7|Тарифы и экономическая квалификация не утверждены
F48|Commerce / supplier comparison|P1/A2|B commerce; B/C suppliers|NOT_ESTABLISHED|5 readiness|D4 readiness|Merchant/Catalog/Product/Offer/Order/Booking/Checkout/Payment/Subscription/Fulfilment/Refund; shortlist|C13 C08 C11|S03 S06 S08|M14|P1 §7; A2 §8.8/§8.9|Товар/продавец/предложение различимы; актуальность и реклама видимы; нет автономной покупки
F49|Cross-product empty/loading/error/a11y|A3/owner task|CROSS_CUTTING|PARTIAL|2/3/4/5|D2/D5|Empty/loading/error/retry/offline/expired/conflict; long RU/EN; large text; reduced motion/contrast|C15 C01 C02 C04|S03 S04 S06 S07 S08 S10 applicable|M01–M15 applicable|A3 §11; 2A/2B qualification limits|Все потоки проходят применимую state/responsive матрицу; не WCAG claim
'''

headers=['ID','Функция','Основание','Релизная категория','Текущий статус','Инженерные блоки','Дизайн-этап','Необходимые поверхности','Компоненты','Дополнительные состояния','Motion','Evidence','Ключевой контракт']
rows=[dict(zip(headers,line.split('|'))) for line in RAW.strip().splitlines()]
for row in rows:
    row['Общие состояния']='S01 S02 S05 S09'
    row['Версия']='D0 R1'
    row['Owner decision']='PENDING'
    row['Visual verification']='LOGIN_ONLY' if row['ID']=='F41' else 'NOT_PERFORMED_AUTH_REQUIRED'
    row['Font/Icon']='INTERIM_TO_QUALIFY / ORIGINAL_NOT_CREATED'
    row['Source SHA']=SHA

def save_csv(name, data):
    with (OUT/name).open('w',encoding='utf-8-sig',newline='') as f:
        w=csv.DictWriter(f,fieldnames=list(data[0]));w.writeheader();w.writerows(data)

save_csv('DESIGN_SCOPE_MATRIX.csv',rows)
intro='''# Pablicus — Design Scope Matrix / D0 R1

Источник: канонический снимок `{sha}`. Все строки — owner decision PENDING; визуально осмотрен только экран входа (F41), остальные строки исследованы по исходникам. A — обязательно к первому полноценному релизу; BASE — план 1.0/дополнение 01; B — readiness; C — позже. SCOPE_TBD не означает одобрение новой функции.

Каждый поток наследует S01/S02/S05/S09 и проходит D5. Определения компонентов C01–C17, состояний S01–S10, motion M01–M15, ограничения evidence и список источников — в [D0 audit](D0_FOUNDATION_AUDIT.md). Полная машинно-читаемая версия — [CSV](DESIGN_SCOPE_MATRIX.csv). Mobile/desktop/tablet и owner review обязательны для каждого потока; численные specs выбираются позднее.

'''.format(sha=SHA)
out=[intro,'| '+' | '.join(headers)+' |','|'+'|'.join(['---']*len(headers))+'|']
for r in rows: out.append('| '+' | '.join(r[h] for h in headers)+' |')
(OUT/'DESIGN_SCOPE_MATRIX.md').write_text('\n'.join(out)+'\n',encoding='utf-8')

# Semantic inventory, not drawings. Filled state is restricted to sustained toggles.
groups={
'navigation': 'chats:Чаты;tasks:Дела;you:Вы;back:Назад;close:Закрыть;forward:Вперёд;chevron-down:Раскрыть;chevron-up:Свернуть;menu:Меню;more:Другие действия;search:Поиск;filter:Фильтр;sort:Сортировка;space-switch:Сменить пространство;external-link:Открыть вне Pablicus;fullscreen:Полный экран;restore:Вернуть размер;side-panel:Боковая панель',
'communication': 'conversation-new:Новый разговор;private-chat:Личный разговор;group-chat:Группа;thread:Ветка;topic:Тема;reply:Ответить;forward-message:Переслать;quote:Цитировать;reaction:Реакция;mention:Упоминание;pin:Закрепить;unpin:Открепить;focus:Фокус;mute:Отключить звук;unmute:Включить звук;unread:Непрочитанное;jump-latest:Последнее сообщение;history:История;outbox:Исходящие;sent:Отправлено;delivered:Доставлено;read:Прочитано',
'composer': 'add:Добавить;attach:Вложить;send:Отправить;keyboard-hide:Скрыть клавиатуру;command:Команда;bold:Жирный;italic:Курсив;underline:Подчёркивание;heading:Заголовок;bullets:Список;numbered-list:Нумерованный список;table:Таблица;code:Код;link:Ссылка;unlink:Убрать ссылку;undo:Отменить;redo:Повторить;clear:Очистить;record:Записать голос;stop-recording:Остановить запись;reorder:Изменить порядок',
'media': 'image:Изображение;camera:Камера;video:Видео;audio:Аудио;file:Файл;document:Документ;pdf:PDF;upload:Загрузить;download:Скачать;play:Воспроизвести;pause:Пауза;stop:Стоп;volume:Громкость;volume-off:Без звука;seek-back:Назад по записи;seek-forward:Вперёд по записи;scan:Сканировать;zoom-in:Приблизить;zoom-out:Отдалить;rotate:Повернуть;captions:Субтитры;transcript:Расшифровка;trim:Обрезать;timeline:Монтаж;render:Рендер;output-verified:Результат проверен',
'objects': 'canvas:Полотно;work-object:Рабочий объект;project:Проект;edit:Редактировать;copy:Копировать;duplicate:Создать копию;source:Исходное сообщение;revision:Версия;diff:Изменения;comment:Комментарий;collaborators:Соавторы;lock-edit:Только чтение;merge:Объединить;conflict:Конфликт;save:Сохранить;bookmark:Сохранить в Избранное;bookmark-remove:Убрать из Избранного;personal-inbox:Личные сохранения;note:Заметка;archive:В архив;unarchive:Из архива;delete:Удалить;restore-deleted:Восстановить;publish-snapshot:Опубликованное представление',
'tasks': 'task-create:Создать дело;task-complete:Завершить дело;task-reopen:Вернуть в работу;checklist:Чеклист;assignee:Исполнитель;calendar:Дата;clock:Время;reminder:Напомнить;schedule:Запланировано;recurring:Повторение;overdue:Просрочено;priority:Приоритет;move-date:Перенести срок',
'ai': 'ai-chat:AI-разговор;ai-context:AI в контексте;ai-inline:AI для выделения;context-add:Добавить контекст;context-remove:Убрать контекст;sources:Источники;translate:Перевести;summarize:Краткое содержание;shorten:Сократить;expand-text:Расширить текст;tone:Изменить тон;structure:Структурировать;correct:Исправить;ai-proposal:Предложение AI;accept:Принять;reject:Отклонить;memory:Память;memory-off:Память отключена;research:Исследовать;export:Экспорт',
'agents': 'agent:Агент;agent-add:Добавить агента;permissions:Разрешения;run:Запустить;queued:В очереди;progress:Выполняется;checkpoint:Контрольная точка;approval:Нужно подтверждение;cancel-run:Отменить запуск;retry:Повторить;failure:Ошибка запуска;result:Результат;delegate:Делегирование;budget:Бюджет;limit:Лимит;human-takeover:Передать человеку;private-result:Приватный результат',
'social': 'space:Пространство;community:Сообщество;channel:Канал;publication:Публикация;feed:Подписная лента;discover:Открыть новое;follow:Подписаться;unfollow:Отписаться;share:Поделиться;invite:Пригласить;join:Вступить;leave:Покинуть;members:Участники;roles:Роли;owner:Владелец;admin:Администратор;moderator:Модератор;editor:Редактор;member:Участник;guest:Гость;poll:Опрос;event:Событие;form:Форма;report:Пожаловаться;block:Заблокировать;unblock:Разблокировать;audit-log:Журнал действий;membership-approval:Одобрить вступление;story:История;followers:Подписчики',
'services': 'factory:Фабрика;capabilities:Возможности;bot:Бот;mini-app:Мини-приложение;plugin:Плагин;skill:Навык;integration:Интеграция;workflow:Сценарий работы;publisher:Издатель;install:Установить;uninstall:Удалить установку;connect:Подключить;disconnect:Отключить;update:Обновить;revoke:Отозвать;trust-unverified:Не проверено;trust-verified:Проверено;trust-reviewed:Проверено Pablicus;build:Сборка;test:Проверка;service-instance:Экземпляр сервиса;scenario-node:Шаг сценария;branch:Ветвление',
'system': 'settings:Настройки;profile-edit:Изменить профиль;public-identity:Публичная идентичность;privacy:Приватность;lock:Закрытый доступ;unlock:Открытый доступ;session:Сеанс;device:Устройство;passkey:Ключ доступа;sign-in:Войти;sign-out:Выйти;account-switch:Сменить аккаунт;recovery:Восстановить доступ;storage:Хранилище;notification:Уведомления;notification-off:Уведомления выключены;light:Светлая тема;dark:Тёмная тема;theme-system:Системная тема;accessibility:Доступность;text-size:Размер текста;contrast:Контраст;motion-reduce:Уменьшить движение;transparency-reduce:Уменьшить прозрачность;online:В сети;offline:Нет сети;reconnect:Восстановление связи;sync:Синхронизация;warning:Предупреждение;error:Ошибка;success:Успех;info:Информация;loading:Загрузка;expired:Срок истёк;permission-denied:Нет доступа;help:Помощь',
'future': 'phone:Аудиозвонок;video-call:Видеозвонок;call-end:Завершить звонок;microphone:Микрофон;microphone-off:Микрофон выключен;camera-off:Камера выключена;screen-share:Показ экрана;device-handoff:Перенос сессии;call-link:Ссылка на звонок;voice-room:Голосовая комната;live:Эфир;speaker:Выступающий;audience:Слушатели;hand-raise:Поднять руку;recording-reference:Запись эфира;qr:QR-код;business:Бизнес;catalog:Каталог;product:Товар;offer:Предложение;merchant:Продавец;order:Заказ;booking:Бронирование;checkout:Оформление;payment:Оплата;subscription:Подписка;fulfilment:Исполнение заказа;refund:Возврат;tip:Благодарность;location:Место;hours:Часы работы;supplier:Поставщик;compare:Сравнение;shortlist:Список выбора;sponsored:Реклама'
}
icons=[]
for group, values in groups.items():
    for item in values.split(';'):
        name,label=item.split(':',1)
        icons.append({'ID':f'pi-{group}-{name}','Family':group,'Meaning RU':label,'Scope':'B/C readiness' if group=='future' else 'TBD owner scope' if name=='story' else 'D0 semantic requirement','Master status':'NOT_CREATED','Variants':'outline; active if stateful; filled only if justified in D2','Sizes':'optical sizes TBD D2; current UI baseline 22px','Touch target':'D2 specification; audit candidate minimum 44x44 CSS px','Accessible name':label,'Overlays':'only relevant unread/status; placement TBD D2','Motion':'static required; morph only same semantic control','License':'original master required; TEMP must retain source/license','Owner decision':'PENDING'})
save_csv('ICON_INVENTORY.csv',icons)

current=[]
for n,marker in [('message-menu.js','const ICONS ='),('chat-canvas.js','const paths ='),('tasks-home.js','const paths =')]:
    s=(SRC/'pablicus'/n).read_text(); pos=s.find(marker); end=s.find('\n  };',pos) if n=='message-menu.js' else s.find('\n      };',pos)
    block=s[pos:end]
    for name in re.findall(r'^\s{4,10}["\']?([a-zA-Z][\w-]*)["\']?:',block,re.M):
        current.append({'Source':'pablicus/'+n,'Definition':name,'Evidence':'named SVG definition; source inspection','Provenance':'Lucide ISC / Feather MIT notices in file' if n=='message-menu.js' else 'origin not fully established','Target status':'interim baseline, not original master'})
for name in ['close','chevron']:
    current.append({'Source':'pablicus/workspace-quick.js','Definition':name,'Evidence':'local SVG factory','Provenance':'origin not fully established','Target status':'interim baseline'})
for name in ['▢ Чаты','✓ Дела','♙ Вы','◈ Боты','✎ новый разговор','＋ добавить','⛶ развернуть','⌄ скрыть клавиатуру','↑ отправить','× закрыть']:
    current.append({'Source':'pablicus/index.html','Definition':name,'Evidence':'markup fallback; runtime may replace icon','Provenance':'text glyph; platform-dependent','Target status':'not original master'})
save_csv('CURRENT_ICON_DEFINITIONS.csv',current)

ledger=[]
mandatory=list((SRC/'docs/pablicus/approved/2026-09-11').glob('*.md'))+list((SRC/'docs/pablicus/approved/2026-09-12').glob('*.md'))+[SRC/'docs/pablicus/design/2026-09-12/DESIGN_REFERENCE_REGISTER.md']
engineering=list((SRC/'docs/engineering/block-02').glob('*'))+[SRC/'docs/pablicus/reviews/2026-09-12/2A_HANDOFF_REVIEW_R1.md',SRC/'PABLICUS_CONTEXT.md']
names=['index.html','design-tokens.css','app.js','app-shell.js','component-registry.js','shell.css','controls.css','rich-composer.js','rich-composer.css','rich-message.js','rich-message.css','chat.js','chat-canvas.js','chat-canvas.css','chat-library.js','chat-library.css','tasks-home.js','tasks-home.css','workspace-editor.js','workspace-editor.css','workspace-quick.js','workspace-quick.css','media-viewer.js','media-viewer.css','message-menu.js','message-menu.css','people.js','people.css','bots.js','bot-factory.js','bot-scenario-editor.js','push-notifications.js','inbox-monitor.css','style.css','pablicus.css','public-ui-foundation.css','chat-minimal.css','creation-flows.js','assets/PROVENANCE.json','ASSET_MANIFEST.json']
for p in mandatory+engineering+[SRC/'pablicus'/n for n in names]:
    if not p.is_file(): continue
    level='full canonical text' if p in mandatory else 'report or structured metadata inspection' if p in engineering else 'selected source sections / inventory extraction'
    ledger.append({'Path':str(p.relative_to(SRC)),'SHA':SHA,'SHA256':hashlib.sha256(p.read_bytes()).hexdigest(),'Read scope':level,'Live verification':'login screenshot only' if p.name=='index.html' else 'none'})
save_csv('SOURCE_LEDGER.csv',ledger)

# Stable handoff record, with absence of approval explicit.
manifest={'task':'PABLICUS-CHIEF-DESIGNER-BOOTSTRAP-20260912','revision':'R1','stage':'D0','status':'D0_SOURCE_AUDIT_DELIVERED_WITH_VISUAL_EVIDENCE_GAP','source_sha':SHA,'accepted_2a_code_sha':'9ee215300ac97b3c48bf5184f414f28333429a1c','current_2b_code_sha':'c5e26c2f85ef1f6d1f8ab4684d033de4f3b0d3c9','current_2b_status':'SUBSTEP_2B_READY_FOR_INDEPENDENT_REVIEW','design_approved':False,'owner_decision':'PENDING','scope_rows':len(rows),'semantic_icon_entries':len(icons),'current_icon_definition_entries':len(current),'visual_evidence':'first attempt timed out; retry captured and inspected 01-login-baseline.png at 1280x720; authenticated flows unavailable without test session','writes':'local D0 documentation only; no remote push/runtime changes','files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in OUT.iterdir() if p.is_file() and p.name!='D0_MANIFEST.json'}}
(OUT/'D0_MANIFEST.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:manifest[k] for k in ['source_sha','scope_rows','semantic_icon_entries','current_icon_definition_entries','status']},ensure_ascii=False))
