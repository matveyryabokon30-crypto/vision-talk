# Pablicus — Design Reference Register

**Date:** 2026-09-12  
**Status:** REFERENCE_ONLY  
**Owner:** Матвей

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
