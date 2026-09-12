# Codenotch: исходники для адаптации Pablicus

Upstream: https://github.com/vinzdg/codenotch/tree/bd62f4486a81a31e8239f79ae93f3370cb047b78

Неизменённые исходники и MIT notice хранятся физически, а не только по внешней ссылке. Хеш каждого файла — в PROVENANCE.json. Это reference source, не подключённый модуль и не принятый Pablicus UI.

Изученные переносимые механизмы:

- `NotchPlacement.swift`: единые оси along/across, преобразования point/rect для четырёх сторон. Сохраняет геометрию без четырёх независимых реализаций.
- `SideNotchShape.swift`: одна каноническая форма, отражение/поворот, ограничение flare/corner при сворачивании; визуальная геометрия должна быть адаптирована под Pablicus.
- `NotchLayout.swift`: раздельные размеры компактного элемента и читаемой панели; расчёт доступного места для содержимого и ограничение числа строк с явным остатком.
- `windows/codenotch/ui/notch.html`: `placeCard()` удерживает карточку в viewport и направляет хвост к активной ячейке; 250 ms grace period для мыши; отдельный размер карточки при масштабировании ручки.

Что потребуется при переносе: pointer/touch и клавиатурные события, корректное поведение вне hover, VoiceOver labels, Escape/focus return, reduced motion, safe areas, scroll/selection сохранность, тесты компактного viewport. Windows-исходник обращается к `window.__TAURI__`; он не работает как готовый web-компонент. Полный HTML не вставляется в runtime.

Нативные адаптеры аккаунтов, keychain, чтение сессий других приложений и provider collectors не входят в этот source package. Для Pablicus используются собственные серверные API и его пользовательские полномочия.

Проверка этой фиксации: byte-for-byte совпадение с указанным upstream checkout; SHA-256; наличие MIT. Сборка macOS/Windows и runtime-интеграция ещё не выполнены. Извлечение исходника не доказывает готовность компонента.
