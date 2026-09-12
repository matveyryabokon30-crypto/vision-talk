from pathlib import Path
import shutil,subprocess,csv,hashlib,json,zipfile,datetime,html,re
W=Path('/Users/artem/Documents/ChatGPT/Pablicus'); R=W/'design-handoff-20260912'; P=R/'docs/pablicus/design/handoff/2026-09-12'
BASE='883003ebe9ae25d3c97b657234d0b6cab72414dd'; OLD='d791adc19aade1015f4ba34cf4beb5ce2069c93f'
P.mkdir(parents=True,exist_ok=True)
meta={};mapping=[]
def put(src,dst,stage,status,purpose,provenance,licence='Not separately licensed; project study / documentation',visual=False,created=True,tags=None):
 d=P/dst;d.parent.mkdir(parents=True,exist_ok=True)
 if isinstance(src,bytes):d.write_bytes(src)
 else:shutil.copy2(src,d)
 meta[dst]=dict(stage=stage,status=status,purpose=purpose,provenance=provenance,licence_status=licence,is_actual_visual=visual,visual_or_description='ACTUAL_VISUAL_FILE' if visual else 'SOURCE_ASSET_OR_DESCRIPTION',created_in_design_contour=created,preexisting_before_handoff=stage!='HANDOFF',tags=tags or [])
 return d
for src in sorted((W/'design-d0-20260912').rglob('*')):
 if not src.is_file():continue
 dst='01_audit/D0/'+str(src.relative_to(W/'design-d0-20260912'));isimg=src.suffix=='.png'
 put(src,dst,'D0','EXISTING_RUNTIME' if isimg else 'DOCUMENTATION_ONLY','Legacy login screenshot; NOT_A_DESIGN_BASELINE' if isimg else 'Original D0 audit/inventory/evidence file, unmodified',str(src),visual=isimg,tags=['LEGACY_FAILURE_REGRESSION_EVIDENCE'] if isimg else [])
 mapping.append(dict(source=str(src),package_path=dst,sha256=hashlib.sha256(src.read_bytes()).hexdigest()))
for src in sorted((W/'design-d1-20260912').rglob('*')):
 if not src.is_file():continue
 rel=str(src.relative_to(W/'design-d1-20260912'));dst='10_prototypes/D1/'+rel
 stage='D1';status='DOCUMENTATION_ONLY';visual=False;created=True;purpose='Original D1 specification, generator or validation file; not runtime implementation';lic='Project documentation; no separate asset licence';tags=[];prov=str(src)
 if rel.startswith('research/') and src.suffix in ['.jpg','.html']:
  dst='09_references/RonDesignLab/'+src.name;status='REFERENCE';visual=src.suffix=='.jpg';created=False;lic='Third-party copyrighted reference; no redistribution/product asset licence established; REFERENCE_ONLY'
  purpose='My Notes mobile collage, directly inspected' if src.name=='my-notes-ui.jpg' else 'My Notes logo page; not UI evidence' if src.suffix=='.jpg' else 'Downloaded My Notes page HTML; external dependencies, not a self-contained screenshot'
  prov='https://rondesignlab.com/cases/my-notes-app-smart-ai-assistant; locally downloaded during D1; '+str(src)
 elif rel.startswith('visuals/'):
  status='GENERATED_STUDY';visual=True;purpose='Image-generated direction '+src.stem+'; conceptual UI board, approximate typography/icons, not implemented';lic='Generated study; no third-party pack licence claimed; reference-informed, not approved final assets';tags=['PROPOSED','NOT_IMPLEMENTED']
 elif rel.startswith('icons/'):
  status='ORIGINAL_PABLICUS_DESIGN';visual=True;purpose='Original D1 representative '+src.stem+' glyph / direction '+src.parent.name+'; draft SVG, not final285-icon system';lic='Original paths authored in design contour; not a commercial/third-party icon pack';tags=['DRAFT','NOT_IMPLEMENTED']
 elif rel.startswith('motion/'):
  status='ORIGINAL_PABLICUS_DESIGN';visual=True;purpose='Static SVG keyframe storyboard '+src.stem+'; no live motion simulation';lic='Original diagram authored in design contour';tags=['STATIC_STORYBOARD','NOT_IMPLEMENTED']
 elif rel=='index.html':
  status='ORIGINAL_PABLICUS_DESIGN';visual=True;purpose='Static HTML review gallery: embedded mobile/tablet/desktop/accessibility specimens, original SVG and generated boards; controls are illustrative except review copy/scroll';lic='Own review markup/styles; licensed interim fonts; links to generated studies';tags=['STATIC_REVIEW','NOT_IMPLEMENTED']
 elif rel.startswith('fonts/') and src.suffix=='.ttf':
  status='INTERIM';created=False;purpose='Interim third-party font binary, not Pablicus font';lic='SIL Open Font License1.1; corresponding bundled OFL file';prov='https://github.com/google/fonts/tree/main/ofl/'+{'inter':'inter','golostext':'golostext','manrope':'manrope','sourceserif4':'sourceserif4'}[src.name.split('-')[0]]+'; '+str(src)
 elif rel.startswith('fonts/') and src.name.endswith('OFL.txt'):
  status='INTERIM';created=False;purpose='Unmodified licence text for corresponding interim font';lic='SIL OFL1.1 legal notice';prov='Google Fonts repository corresponding font directory; '+str(src)
 put(src,dst,stage,status,purpose,prov,lic,visual,created,tags)
 mapping.append(dict(source=str(src),package_path=dst,sha256=hashlib.sha256(src.read_bytes()).hexdigest()))
# Historical source snapshots: read exactly the revision used in D0, never latest substituted.
rows=list(csv.DictReader((W/'design-d0-20260912/SOURCE_LEDGER.csv').open(encoding='utf-8-sig')))
for row in rows:
 path=row['Path'];b=subprocess.check_output(['git','-C',str(W/'design-d0-source'),'show',OLD+':'+path]);assert hashlib.sha256(b).hexdigest()==row['SHA256'],path
 runtime=path.startswith('pablicus/')
 put(b,'12_evidence/source_snapshot/'+path,'PREEXISTING','EXISTING_RUNTIME' if runtime else 'DOCUMENTATION_ONLY','Historical source consulted during D0: '+row['Read scope']+'; immutable copy, not an application change','vision-talk@'+OLD+':'+path,'Existing repository material; original ownership/licence retained, not newly licensed',False,False,['HISTORICAL_SOURCE','NOT_A_DESIGN_BASELINE'])
# Preserve originally delivered archive as bytes, even if its contents are duplicates.
a=W/'PABLICUS_D1_R1_OWNER_REVIEW.zip'
put(a,'12_evidence/previous_delivery/'+a.name,'D1','INTERIM','Previously delivered archive, unchanged; MIXED content includes third-party references and interim fonts',str(a),'Mixed; see member licences and statuses of unpacked files',False,True,['HISTORICAL_ARCHIVE','MIXED_REFERENCE_CONTENT'])
archive=[]
with zipfile.ZipFile(a) as z:
 for i in z.infolist():
  if i.is_dir():continue
  b=z.read(i.filename);archive.append(dict(member=i.filename,size_bytes=len(b),sha256=hashlib.sha256(b).hexdigest(),classification='REFERENCE' if '/research/' in i.filename and i.filename.endswith(('.html','.jpg')) else 'INTERIM' if '/fonts/' in i.filename else 'SEE_UNPACKED_FILE_MANIFEST'))
# Original generated filenames are byte-identical aliases, retained for inspection.
gen=W.parent # overwritten below
G=Path('/Users/artem/.codex/generated_images/01a09647-b8fc-7033-9162-59281cc2dead')
for src in sorted(G.glob('*.png')):
 put(src,'12_evidence/generated_originals/'+src.name,'D1','GENERATED_STUDY','Original imagegen output filename; byte duplicate of corresponding named direction PNG',str(src),'Generated study; not a final approved asset',True,True,['DUPLICATE_VISUAL_BYTES','NOT_IMPLEMENTED'])
def doc(name,text,purpose):return put(text.encode(),'00_manifest/'+name,'HANDOFF','DOCUMENTATION_ONLY',purpose,'Created now solely for honest inventory and handoff; no design changes',visual=False)
doc('BASE_RECORD.json',json.dumps(dict(repository='matveyryabokon30-crypto/vision-talk',branch='design/pablicus-design-handoff-20260912',base_ref='origin/refactor/pablicus-foundation-20260911',BASE_SHA=BASE,design_source_sha=OLD,fresh_fetch_completed=True,recorded_utc=datetime.datetime.now(datetime.timezone.utc).isoformat(),runtime_changed=False,deployed=False),indent=2),'Fresh-fetch base and provenance of historical design source')
doc('ORIGINAL_FILE_MAPPING.json',json.dumps(mapping,ensure_ascii=False,indent=2),'Byte-exact mapping of all107 local D0/D1 files to package locations')
doc('HISTORICAL_ARCHIVE_MEMBERS.json',json.dumps(archive,ensure_ascii=False,indent=2),'Per-member size/SHA and classification for historical delivered ZIP')
doc('README.md','''# Pablicus design handoff — frozen existing work

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
''','Instructions, distinctions, limitations and manifest self-integrity convention')
# Keep packaging script itself available, without executing original design generators.
put(Path('/tmp/pablicus_handoff_build.py'),'00_manifest/build_handoff.py','HANDOFF','DOCUMENTATION_ONLY','Packaging/inventory script created for this handoff only','Current handoff operation',visual=False)
# persisted metadata used by a finalizer after context notes are exported
(P/'00_manifest/_INVENTORY_WORK.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2))
print('Copied',len(meta),'files. Ready for inventory finalization.')
