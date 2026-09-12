# Figma SDS в библиотеке Pablicus

Источник: официальный https://github.com/figma/sds, commit `030aba021183cd5332b35c89c56fbaee5b600162`, MIT, upstream alpha. В PROVENANCE.json — 20 неизменённых файлов с SHA-256. SOURCE_INTEGRITY.json сравнивает их с Git object закреплённого commit.

`library/pablicus-ui/foundation.css` реально импортирует theme.css в отдельный прототип. Button/Tab/Card/Forms/Code Connect исходники помогают сопоставлять компоненты с Figma. React/React Aria примеры не являются совместимым runtime-пакетом для существующей vanilla JS PWA. Пример Form Log In сам не реализует вход: рабочая авторизация Pablicus уже существует и не заменяется этим примером.

Дополнена цепочка генерации токенов: app.mjs, fromFigma.mjs, tokens.json, styles.json. На изолированной копии `node app.mjs --skip-rest-api` воспроизводит theme.css побайтово без ключей и сети; результат TOKEN_BUILD.json. Для запуска копируйте scripts/tokens и src в временную структуру и запускайте из scripts/tokens. Не запускайте генератор внутри оригинальной подборки: он перезаписывает src/theme.css и пишет служебный snippet.

Через Figma получены Navigation Button/Card/Button, Space/400, Body Base, Background/Default/Default. Сборка из 7 связанных экземпляров: https://www.figma.com/design/ppVDFrQo8drbWCyxWtOHj1?node-id=4-18 . Это конструктор основы; не финальный дизайн приложения и не установленный оригинал ролика uiux.build.
