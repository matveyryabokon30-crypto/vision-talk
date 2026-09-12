# Pablicus design handoff — frozen existing work

Это передача существующих файлов, не новый этап дизайна. Owner direction pending. Никакие визуалы сейчас не создавались и не исправлялись.

## Открыть

- [D1 HTML gallery](../10_prototypes/D1/index.html): скачать всю директорию, открыть index.html. На GitHub HTML показывается исходным текстом; нужен локальный браузер. Не запускайте generators для проверки снимка.
- [A PNG](../10_prototypes/D1/visuals/A-ORBIT.png), [B PNG](../10_prototypes/D1/visuals/B-FOLIO.png), [C PNG](../10_prototypes/D1/visuals/C-RELAY.png).
- [Visual index](VISUAL_INDEX.md): только фактические визуальные файлы.
- [Manifest JSON](DESIGN_HANDOFF_MANIFEST.json), [Manifest MD](DESIGN_HANDOFF_MANIFEST.md).

HTML содержит 78 mobile states,3 tablet,3 desktop,3 large-text specimens. Это встроенные статические представления, НЕ78 отдельных PNG или интерактивный прототип приложения. Motion —9 SVG-схем ключевых кадров, а не видео. Визуальная браузерная проверка ранее не завершилась; прошлые ограничения сохранены.

D0 — преимущественно документы и один legacy login screenshot. D1 —3 generated boards,63 оригинальных draft glyphs,9 оригинальных motion diagrams,1 authored HTML gallery. Font binaries —4 свободных interim гарнитуры, не собственный шрифт. Нет Figma, PDF, native prototype, рабочей анимации,285 final icons, полного font family Pablicus, отдельных финальных экранов всех будущих функций или утверждённых tokens.

## Заморозка и разделение

Исходные107 D0/D1 файлов перенесены без изменения байтов. Только3 сторонних research capture физически вынесены в09_references. Relative links gallery к своим fonts/visuals/icons не менялись. Старые текстовые упоминания research paths сохраняют исторический вид; точный mapping прилагается. README/отчёты прошлого этапа не исправлялись задним числом.

12_evidence/source_snapshot —61 исторический файл, использованный в D0, из SHA d791adc19aade1015f4ba34cf4beb5ce2069c93f. Копии исходного runtime — evidence, не новый runtime и не design baseline. Приёмочные документы скопированы как historical evidence, не изменены в канонических путях. База ветки883003ebe9ae25d3c97b657234d0b6cab72414dd новее исследования.

12_evidence/generated_originals —3 исходных imagegen PNG, дублирующих по байтам named boards; не3 дополнительных варианта. Старый ZIP оставлен неизменным: внутри смешанные исторические материалы, включая references. Это архив предыдущей передачи, не целевая библиотека assets. Реестр его members приложен; не учитывайте их второй раз как отдельные новые файлы.

## Как читать статусы

ORIGINAL_PABLICUS_DESIGN = авторские SVG/HTML исследования, не финальная оригинальность/утверждение. GENERATED_STUDY = image-generated концепции. INTERIM = сторонние fonts/licences или historical mixed archive. REFERENCE = сторонние сохранённые материалы. EXISTING_RUNTIME = legacy screenshot и архивные исходники. DOCUMENTATION_ONLY = описания, таблицы, generators, manifests, source documents. NOT_IMPLEMENTED указан дополнительным тегом там, где visual существует, но продуктовый механизм не реализован.

Физические file totals считаются один раз по package tree, включая manifest pair. Visual totals включают3 явных duplicate PNG; уникальных visual bytes на3 меньше. Font binaries, source HTML и ZIP не считаются визуальными макетами. Один HTML считается одним visual file, а не числом его frames.

SHA-256 всех payload files указан вJSON/MD. Self-describing manifest pair не включается в собственную checksum inventory во избежание рекурсивного self-hash; их точные file hashes выдаются в финальном сообщении. Оба manifest дополнительно закреплены Git commit. Их назначение: HANDOFF / DOCUMENTATION_ONLY, созданы сейчас, не visual. Это единственное явное исключение из checksum table.

В research register перечислены доступные источники; нескачанные страницы и непросмотренные видео не создавались задним числом. Нет утверждения, что точные reels были просмотрены. Prompts/контекст, экспортированные для передачи, отмечаются как text evidence, не как новый дизайн.
