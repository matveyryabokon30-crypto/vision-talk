# Pablicus — Дополнение 03 к плану 1.0

**Document:** `PABLICUS-PLAN-AMENDMENT-03-DESIGN-AUTHORITY-ORIGINAL-ASSETS-20260912`  
**Revision:** 1.0  
**Status:** OWNER_APPROVED  
**Date:** 2026-09-12  
**Owner:** Матвей

## 1. Назначение

Дополнение 03 закрепляет отдельный дизайн-контур Pablicus до массового внедрения нового визуального слоя в runtime. Полный дизайн приложения и связанная с ним дизайн-система разрабатываются в отдельном рабочем контуре **«Главный дизайнер проекта»** под прямым руководством владельца. После утверждения дизайн передаётся в инженерный контур и внедряется в код по существующим блокам и gates.

Это дополнение действует совместно с планом 1.0, Дополнением 01 и Дополнением 02. Оно не создаёт шестой инженерный блок и не отменяет уже принятую архитектурную работу.

## 2. Прямое решение владельца по платным активам

Pablicus не должен зависеть от платных сторонних шрифтов, платных icon packs или иных платных визуальных библиотек как от постоянной основы продукта.

Правила:

- платные шрифты не входят в целевую дизайн-систему Pablicus;
- платные наборы иконок не входят в целевую дизайн-систему Pablicus;
- нельзя копировать или перерисовывать чужие иконки, шрифты, логотипы или охраняемые элементы один-в-один;
- найденные работы RonDesignLab и других студий используются как **визуальные и интеракционные референсы подхода**, а не как набор активов для присвоения;
- целевой набор иконок Pablicus должен быть оригинальным и принадлежать проекту;
- целевая типографическая система должна быть собственной по характеру и не зависеть от коммерческой лицензии стороннего шрифта;
- для временных прототипов и тестовой версии допускаются только системные либо бесплатные/open-source активы с проверенной лицензией, разрешающей соответствующее использование;
- наличие визуального сходства по эпохе, принципам стекла, глубины, мягких градиентов, геометрии и motion language не является разрешением копировать конкретный охраняемый asset.

Если ранее в тестах использовался сторонний asset, он считается временным и подлежит замене до квалификации целевой дизайн-системы. Не лицензированный платный asset не должен добавляться даже во временную сборку только потому, что он является референсом.

## 3. Главный дизайнер проекта

Создаётся отдельный рабочий контур / отдельный чат Codex с ролью:

`ГЛАВНЫЙ ДИЗАЙНЕР ПРОЕКТА PABLICUS`.

Его задача — спроектировать **весь Pablicus как единую продуктовую систему**, а не рисовать отдельные красивые экраны.

Главный дизайнер обязан:

1. восстановить канонический продуктовый контекст из репозитория;
2. учитывать план 1.0 + Дополнения 01/02/03 и действующие owner decisions;
3. исследовать переданные владельцем референсы и извлекать из них принципы, а не копировать assets;
4. разработать целостный visual language Pablicus;
5. разработать оригинальную icon system;
6. разработать typography strategy и требования к будущему собственному шрифтовому/леттеринговому слою Pablicus;
7. разработать цвет, поверхности, стекло, глубину, свет, blur, тени, радиусы, сетку, spacing, размеры, states и motion language;
8. разработать дизайн всех основных сущностей и режимов приложения;
9. разработать responsive/mobile-first поведение, iPhone safe areas, keyboard states, gestures и accessibility states;
10. разработать переходы `чат → объект → раскрытая панель → полный экран → возврат` без потери контекста;
11. разработать системные компоненты, а не набор несвязанных макетов;
12. вести versioned design decisions и показывать владельцу варианты на утверждение;
13. не внедрять дизайн в production/runtime до отдельного разрешения владельца.

## 4. Обязательный охват дизайна

Дизайн-контур должен охватить как минимум:

- App Shell;
- Чаты;
- личные и групповые разговоры;
- Threads / Topics;
- Spaces / Communities;
- Дела;
- Вы / public identity;
- Composer;
- AI in Composer;
- AI Chat;
- AI in Context;
- AI Inline;
- Полотно;
- Work Objects;
- rich/interactive messages;
- files/media;
- search;
- Saved / Personal Inbox;
- каналы и публикации;
- feed/discovery surfaces в утверждённых границах;
- notifications;
- agent cards, agent runs, approvals, results and errors;
- фабрику ботов/агентов/mini-apps/services;
- каталог «Возможности» и trust states;
- mini-app runtime surfaces;
- moderation/community roles;
- settings, privacy, permissions, account states;
- empty/loading/offline/error/recovery states;
- будущие calls/live surfaces на уровне архитектурной готовности там, где это требует Дополнение 02.

Основные вкладки `Чаты / Дела / Вы` сохраняются, пока владелец отдельно не изменит это решение.

## 5. Оригинальная система иконок

Цель — создать узнаваемый набор Pablicus, а не адаптировать чужой icon pack.

Главный дизайнер должен определить:

- базовую геометрию и grid;
- optical size;
- stroke logic;
- corner logic;
- filled/outline/active variants;
- системные размеры;
- правила badge/status overlays;
- animation/morph rules для ключевых иконок;
- accessibility/readability rules;
- master list иконок по всем продуктовым функциям;
- source-of-truth формат и экспортный pipeline для web и будущего native app.

На раннем прототипе разрешены временные системные/open-source placeholders с явной маркировкой `TEMP_ICON`, но финальная приёмка дизайна требует замены на оригинальные Pablicus icons.

## 6. Типографическая система

Цель — получить самостоятельный характер Pablicus без зависимости от платной сторонней гарнитуры.

Два уровня:

1. **Interim:** системный или бесплатный/open-source шрифт с подходящей лицензией для прототипов и разработки.
2. **Target:** оригинальная типографическая система Pablicus. Главный дизайнер определяет характер, пропорции, набор начертаний, цифры, UI-метрики, Latin/Cyrillic requirements, variable-axis requirements при необходимости и спецификацию для дальнейшей разработки собственного шрифтового актива.

До готовности полноценной собственной гарнитуры нельзя задерживать архитектурную разработку: используется квалифицированный interim font. Однако interim font не становится автоматически финальным брендовым шрифтом.

## 7. Дизайн-принципы из референсов

Разрешено исследовать и переосмысливать на уровне принципов:

- translucent/frosted surfaces;
- layered depth;
- soft luminous gradients;
- restrained blur;
- floating contextual cards;
- large readable numeric/data hierarchy;
- object-focused transitions;
- cinematic presentation without sacrificing usability;
- expandable contextual panels;
- separation of foreground action and background context;
- motion that explains hierarchy and state change.

Запрещено превращать Pablicus в визуальную копию одного референса. Результат должен иметь собственную узнаваемость.

## 8. Порядок разработки дизайна

### D0 — Design foundation audit

Инвентаризация существующего UI, owner decisions, функций, состояний, экранов, компонентов и конфликтов. Карта полного design scope.

### D1 — Visual directions

Не менее трёх целостных направлений на общей продуктовой архитектуре. Владелец выбирает/комбинирует направление. До решения владельца финальная система не фиксируется.

### D2 — Design system foundation

Tokens, typography, color, surfaces, spacing, radii, grid, icon grammar, motion grammar, states, accessibility rules.

### D3 — Core product flows

Чаты, Composer, Полотно, Work Objects, раскрывающиеся панели, Дела, Вы, Search, Saved, AI modes.

### D4 — Extended product flows

Spaces/Communities, channels, rich/interactive messages, agents, factory, «Возможности», moderation, service/mini-app surfaces и остальные утверждённые функции.

### D5 — Complete state coverage

Responsive, keyboard, safe areas, empty/loading/error/offline, permission states, long content, accessibility, edge cases.

### D6 — Owner design acceptance

Полный пакет показывается владельцу. Только явно утверждённые решения получают статус `DESIGN_APPROVED`.

### D7 — Engineering handoff

После утверждения: component specs, tokens, assets, icon masters, motion specs, interaction contracts, responsive rules, acceptance criteria и mapping к существующим инженерным блокам.

## 9. Связь с действующими инженерными блоками

Пять блоков сохраняются.

- Block 2 получает утверждённые shell/components/tokens/composer/interaction specifications.
- Block 3 получает утверждённые message/canvas/work-object/rich-interaction specifications.
- Block 4 получает social/community/moderation/discovery specifications.
- Block 5 получает AI/agent/factory/marketplace/mini-app specifications.

Дизайн может разрабатываться опережающе в отдельном контуре, но **не изменяет статус инженерной приёмки** и не разрешает перескакивать gates.

Текущий подтверждённый инженерный статус при фиксации Дополнения 03: `SUBSTEP_2A_ACCEPTED`; Block 2 целиком не принят, следующий инженерный шаг — отдельное задание 2B.

## 10. Разделение ролей

- **Владелец (Матвей):** финальные продуктовые и визуальные решения.
- **Главный дизайнер проекта:** исследование, дизайн всей системы, варианты, спецификации и design QA.
- **Исполнитель:** внедрение только утверждённого дизайна в код в разрешённой инженерной границе.
- **Проверяющий:** независимая проверка соответствия утверждённому дизайну, требованиям и gates.

Главный дизайнер не подменяет Исполнителя и Проверяющего.

## 11. Design QA gate

Перед инженерным handoff каждый утверждаемый поток должен иметь:

- source-of-truth design version;
- список компонентов и состояний;
- размеры и responsive rules;
- keyboard/safe-area behavior;
- motion/transition spec;
- accessibility/contrast/touch-target checks;
- оригинальные либо разрешённые временные assets;
- отсутствие неразрешённых платных зависимостей;
- acceptance criteria для реализации;
- owner decision.

После внедрения код сравнивается не с вдохновляющими референсами, а с утверждённым Pablicus design source of truth.

## 12. Что это решение не разрешает

Дополнение 03 само по себе не разрешает:

- массовый redesign текущего runtime;
- изменение production;
- публикацию нового релиза;
- замену принятой архитектуры 2A;
- обход инженерных gates;
- покупку платных шрифтов/иконок;
- использование не лицензированных коммерческих assets;
- копирование чужого UI один-в-один;
- автоматический переход к 2B без отдельного задания владельца.

---

**OWNER_APPROVED · Revision 1.0**