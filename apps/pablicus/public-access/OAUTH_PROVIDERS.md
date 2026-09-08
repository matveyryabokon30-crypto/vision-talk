# Подключение почтовых аккаунтов к Pablicus

Дата проверки: 2026-09-08. Владелец разрешил общедоступный вход, отказался от SMS и выбрал вход через внешние аккаунты, включая Яндекс. Здесь зафиксированы подготовленная схема и зависимости. Наличие пункта в каталоге или исходного кода **не означает**, что OAuth-приложение зарегистрировано, сервер настроен или вход опубликован.

Существующий сайт: `https://matveyryabokon30-crypto.github.io/vision-talk/pablicus/`.
Существующий Supabase: `ctcoqgsztdtsazdiwcmd` (**Vision talk**).
Пароль почты вводится только на странице её поставщика. Pablicus не получает и не проверяет его. Регистрация разработчиком OAuth-клиента — однократная настройка приложения; пользователи не создают новый пароль Pablicus.

## Список и состояние интеграций

| Вариант | Идентификатор Supabase | Что требуется |
|---|---|---|
| Google / Gmail | `google` | Собственный OAuth web client, настройка Google provider, callback и реальный вход |
| Яндекс ID | `custom:yandex` | Собственный OAuth client, серверный UserInfo-адаптер в этой ветке, `email_optional=true`, активация нового профиля по серверной identity |
| Mail / Mail.ru | Пока не включён | Проверить действующий путь регистрации Mail/VK ID и реальный протокол; прямой generic OAuth пока не подтверждён |
| Microsoft / Outlook / Hotmail | `azure` | Entra app registration, разрешённые типы аккаунтов, настройка Azure provider, scope email и реальный вход |

Каталог способов входа может содержать эти названия, но начинать OAuth-переход можно только после фактического включения соответствующего backend-провайдера. Не заменять Mail.ru входом в произвольный VK-аккаунт. Другие адреса и корпоративные домены не доказывают наличие настроенного OAuth-сервиса; неизвестный домен нельзя автоматически объявлять поддерживаемым.

## Два разных адреса возврата

1. В кабинет внешнего провайдера вносится **Callback URL Supabase**, скопированный из его формы настройки. Ожидаемый адрес существующего hosted-проекта: `https://ctcoqgsztdtsazdiwcmd.supabase.co/auth/v1/callback`. Ориентироваться на реально показанное значение: у сервера может быть отдельный внешний адрес custom OAuth.
2. В Supabase Redirect URLs вносится точный адрес возврата **в Pablicus**, используемый клиентским `redirectTo`. Это второй переход после обработки внешнего OAuth. Не разрешать произвольные пользовательские URL или широкие wildcard без необходимости.

[Supabase: Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

## Google

Открыть [Google Auth Platform](https://console.cloud.google.com/auth/overview), выбрать проект владельца, настроить приложение и аудиторию, создать OAuth client типа **Web application**. Для публичного входа приложение не должно оставаться доступным только вручную добавленным тестовым пользователям. Запросить только `openid`, профиль и email, без Gmail API или чтения писем. Client ID и Client Secret внести в **Supabase → Google**; секрет не сохранять в исходниках или браузерной конфигурации.

Origin сайта: `https://matveyryabokon30-crypto.github.io` (без пути). Redirect URI — Supabase callback выше. Возможность входа всех нужных аккаунтов и внешний вид consent screen проверяются отдельно; регистрация клиента сама по себе их не доказывает.

Точные настройки и требования: [Supabase: Google](https://supabase.com/docs/guides/auth/social-login/auth-google), [Google: OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).

## Microsoft

Используется встроенный провайдер `azure`, а не выдуманный `microsoft`. Зарегистрировать приложение в Microsoft Entra. Выбрать типы аккаунтов согласно аудитории: поддержка личных Outlook/Hotmail и рабочих аккаунтов зависит от самой регистрации, а не только от надписи кнопки. Общий tenant по умолчанию — `https://login.microsoftonline.com/common`; для приложения только с личными аккаунтами документация указывает `consumers`. В OAuth-вызове нужен scope `email`.

Секрет хранить в настройке Azure provider Supabase. Проверку достоверности email и ограничений tenant выполнить по текущему руководству: [Supabase: Azure/Microsoft](https://supabase.com/docs/guides/auth/social-login/auth-azure), [Microsoft: OIDC](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc).

## Яндекс: точная конфигурация кандидата

| Настройка | Значение |
|---|---|
| Кабинет регистрации | `https://oauth.yandex.ru/client/new/id/` |
| Название | Pablicus |
| Платформа | Веб-сервисы |
| Права приложения | `login:info` |
| Тип Supabase provider | OAuth2 / Manual configuration |
| Identifier | `custom:yandex` |
| Authorization URL | `https://oauth.yandex.ru/authorize` |
| Token URL | `https://oauth.yandex.ru/token` |
| UserInfo URL | URL реально развёрнутой функции `pablicus-yandex-userinfo` |
| Scopes | `login:info` |
| PKCE | Включён, S256 |
| Email optional | `true` |
| Attribute mapping | Пусто; адаптер уже выдаёт стандартный `sub` |
| Client ID / Client Secret | Значения собственного OAuth-приложения; секрет только в Supabase |
| Среда адаптера | `YANDEX_CLIENT_ID`, то же значение Client ID |

Яндекс документирует Authorization Code Flow с PKCE S256 и необязательный `login_hint`. Последний облегчает выбор аккаунта, но не доказывает, каким аккаунтом пользователь в итоге вошёл. [Протокол](https://yandex.ru/dev/id/doc/ru/codes/code-url).

Регистрация включает название, иконку, контактную почту и Web Redirect URI. Для удаления предупреждения о неподтверждённом сервисе Яндекс предлагает верификацию аккаунта разработчика через Госуслуги; неподтверждённый статус и модерация не равнозначны. Не обещать отсутствие предупреждений до проверки кабинета и реального экрана согласия. [Регистрация](https://yandex.ru/dev/id/doc/ru/register-auth), [верификация](https://yandex.ru/dev/id/doc/ru/confirm-account).

Исходный UserInfo JSON Яндекса имеет поля `id`, `client_id`, имя, а при соответствующем scope — `default_email`. Рассмотренный контракт не содержит признака подтверждения email. Поэтому адаптер возвращает **только субъект и необязательное имя**, полностью исключая email. Пароль Яндекса не меняется; письма для этого способа не нужны. [UserInfo](https://yandex.ru/dev/id/doc/ru/user-information).

Яндекс-адреса могут быть алиасами одного аккаунта, поэтому адрес из поля ввода не используется как идентификатор. [Яндекс: алиасы](https://yandex.ru/support/id/ru/feedback). Существующий email-аккаунт Pablicus автоматически не объединяется с новым Яндекс ID. Для объединения нужен отдельный явный сценарий связывания из уже авторизованного аккаунта.

Код и контракт серверного адаптера: [yandex-userinfo/README.md](yandex-userinfo/README.md).

### Совместимость с Supabase: что подтверждено источниками

Supabase документирует пользовательские OAuth2/OIDC-провайдеры с префиксом `custom:`, серверный PKCE и `email_optional`. Это поддержка произвольного совместимого провайдера, а не встроенный переключатель Яндекса. [Руководство](https://supabase.com/docs/guides/auth/custom-oauth-providers).

Дополнительно прочитан исходный код Supabase Auth на коммите **`0907af9bd6be3c76f472c40a7dcc0dc34abeffaf`**. Это доказательство поведения этой версии исходников; точное совпадение с версией нашего hosted-проекта не установлено, реальная проверка обязательна.

- [Provider dispatch](https://github.com/supabase/auth/blob/0907af9bd6be3c76f472c40a7dcc0dc34abeffaf/internal/api/external.go) не содержит встроенных `yandex` или `mailru`. В нём же при `email_optional=true` и полностью отсутствующем email пропускается подтверждение почты и продолжается выдача OAuth-сессии. Непустой неподтверждённый email имеет другой сценарий и может вызвать письмо.
- [Account linking](https://github.com/supabase/auth/blob/0907af9bd6be3c76f472c40a7dcc0dc34abeffaf/internal/models/linking.go) сначала ищет идентичность по provider+sub. Без email новый субъект создаёт отдельный аккаунт; совпадение отображаемого имени не используется.
- [Custom UserInfo decoding](https://github.com/supabase/auth/blob/0907af9bd6be3c76f472c40a7dcc0dc34abeffaf/internal/api/provider/custom_oauth.go) разбирает JSON в типизированные Claims до attribute mapping. Неизвестные `id/default_email` при прямом подключении отбрасываются. Allowlist помещает их внутрь `custom_claims`, а текущий mapping не выполняет вложенный поиск. Поэтому прямые `sub: id` / `email: default_email` не заменяют адаптер.
- [Admin validation](https://github.com/supabase/auth/blob/0907af9bd6be3c76f472c40a7dcc0dc34abeffaf/internal/api/custom_oauth_admin.go) запрещает mapping в `email_verified` и системные поля. Не пытаться обходить это настройкой глобального автоподтверждения email.
- [PKCE exchange](https://github.com/supabase/auth/blob/0907af9bd6be3c76f472c40a7dcc0dc34abeffaf/internal/api/token.go) проверяет выданный OAuth flow state и code verifier. Пустой email сам по себе не превращает внешнего OAuth-пользователя в анонимного.

### Обязательное дополнение к серверной активации

Действующий Pablicus требует отдельного профиля с `is_approved=true`; одного OAuth-клиента недостаточно. Основа изменения описана в [SERVER_SETUP.md](SERVER_SETUP.md), но до запуска subject-only входа необходимо проверить и дополнить её:

1. Новый пользователь без email/телефона получает корректный уникальный username, неподтверждённый профиль и одноразовый признак ожидания активации.
2. После вставки **серверной** записи `auth.identities` с точным разрешённым `provider='custom:yandex'` и непустым `provider_id` активируется только ожидающий новый профиль. Запись auth.users и триггер профиля возникают раньше identity — нельзя рассчитывать, что identity уже есть внутри первого триггера.
3. `raw_user_meta_data`, заявленный браузером provider, имя и адрес почты не дают доступа. Старые `activation_pending=false`, блокировки и потреблённые ожидания остаются неизменными. Нельзя делать массовый backfill одобрения.
4. Членство в переписках, RLS и доступ к файлам сохраняются. Клиент всё равно проверяет реального пользователя через Supabase и свой профиль.

Этот документ **не выполняет SQL**. Требуются легитимный административный доступ, проверка SQL в тестовом окружении и настоящие входы до публикации.

## Mail / Mail.ru: установленное и неизвестное

[Официальный сайт Mail ID](https://o2.mail.ru/) предлагает вход почтовым аккаунтом и перечисляет домены `mail.ru`, `list.ru`, `bk.ru`, `inbox.ru`. Это полезно для названия пункта в каталоге; не является доказательством настроенной интеграции Pablicus.

[Официальный старый Mail SDK](https://github.com/mailru/mail-auth-sdk-android) указывает регистрацию `https://o2.mail.ru/app/`, авторизацию `https://o2.mail.ru/login`, scope `userinfo` и PKCE. Его реализация UserInfo отправляет access token методом POST и читает `id`, `email`, `name`, `image`. Прямой generic endpoint Supabase с GET Bearer и стандартными Claims нельзя считать совместимым без проверки.

[Современный официальный VK ID Web SDK](https://github.com/VKCOM/vkid-web-sdk) поддерживает OAuth 2.1 и отдельный вариант `OAuthName.MAIL` наряду с VK и OK. Он направляет разработчика на [регистрацию приложения VK ID](https://id.vk.ru/about/business/go/docs/ru/vkid/latest/vk-id/connection/create-application). Подробные страницы регистрации/протокола через доступный просмотрщик не открылись. Доступные первичные источники не позволили подтвердить, разрешена ли сейчас новая отдельная регистрация в o2 либо необходим путь через VK ID.

До реализации нужны: реально доступный кабинет и созданный клиент, актуальные endpoints, формат обмена кода (включая обязательные динамические поля), UserInfo/ID token, стабильный субъект и фактическое поведение MAIL. Не обещать, что произвольный вход VK возвращает или подтверждает точный адрес `@mail.ru`. Если выбран subject-only подход, отсутствие email и отдельный аккаунт должны быть согласованы с клиентом/активацией так же, как для Яндекса.

## Готовность к публикации

Готовность каждого варианта проверяется отдельно: зарегистрированный клиент → включённый backend provider → реальный OAuth round-trip → правильный существующий/новый профиль → повторный вход после закрытия приложения → отказ при отмене согласия → сохранение блокировки → изоляция чужих чатов и файлов. Локальные mock-тесты покрывают код, но не заменяют эти проверки.

SMS-сервис и SMS-провайдеры для текущего решения не подключаются. Существующий успешный вход владельца не сбрасывается.
