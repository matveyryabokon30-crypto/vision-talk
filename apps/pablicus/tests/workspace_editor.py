"""Isolated real-DOM task/project composer checks with deterministic fake media.

No upload, account, real microphone or network service is contacted. This tests
ordered drafts, retained server references, original bytes and chat isolation.
"""
import argparse
import asyncio
import json
from pathlib import Path

from playwright.async_api import async_playwright

from rich_message_integration import MOCK_MIC

ROOT = Path(__file__).resolve().parents[1]


async def run(engine, name):
    browser = await engine.launch(headless=True)
    page = await browser.new_page(viewport={"width": 390, "height": 844})
    failures = []
    page.on("pageerror", lambda error: failures.append(str(error)))
    await page.set_content('''<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    body{margin:12px;font-family:Arial,sans-serif} #host{width:100%;margin-block:20px}
    </style></head><body><div id="composeBox"><div id="chatEditor"><textarea id="chatInput">Неприкосновенный черновик чата</textarea></div></div><div id="host"></div></body></html>''')
    await page.add_script_tag(content=MOCK_MIC)
    await page.add_script_tag(path=str(ROOT / 'src/rich-composer.js'))
    await page.add_script_tag(path=str(ROOT / 'src/workspace-editor.js'))
    await page.add_style_tag(path=str(ROOT / 'src/rich-composer.css'))
    await page.add_style_tag(path=str(ROOT / 'src/workspace-editor.css'))
    await page.evaluate('''() => {
      window.chatChanges=0; window.editorChanges=0; window.editorErrors=[];
      window.chat=PablicusRichComposer.create({container:document.querySelector('#chatEditor'),input:document.querySelector('#chatInput'),onChange:()=>chatChanges++});
      document.querySelector('#composeBox').append(chat.voiceButton);
      window.originalRemote={id:'saved-document',type:'document',path:'synthetic/existing/document.pdf',name:'Сохранённый документ.pdf',mime:'application/pdf',size:29};
      window.editor=PablicusWorkspaceEditor.create({host:document.querySelector('#host'),label:'Материалы проекта',placeholder:'Проект…',
        content:{v:1,blocks:[{id:'text-before',type:'text',text:'До вложений'},originalRemote,{id:'text-after',type:'text',text:'После вложений'}]},
        onChange:()=>editorChanges++,onError:message=>editorErrors.push(message),resolveUrl:()=>URL.createObjectURL(new Blob(['SYNTHETIC_REMOTE_DOCUMENT']))});
      window.fileValues=['IMAGE_ORIGINAL','VIDEO_ORIGINAL','AUDIO_ORIGINAL','DOCUMENT_ORIGINAL'];
      window.fileInputs=[new File([fileValues[0]],'photo.png',{type:'image/png'}),new File([fileValues[1]],'video.mp4',{type:'video/mp4'}),
        new File([fileValues[2]],'audio.mp3',{type:'audio/mpeg'}),new File([fileValues[3]],'document.pdf',{type:'application/pdf'})];
    }''')
    assert await page.evaluate('JSON.stringify(editor.getContent().blocks.find(b=>b.path))===JSON.stringify(originalRemote)')
    assert await page.evaluate('editor.files.length===0 && !editor.isDirty()')
    assert await page.locator('.workspaceEditor .richMissing').count() == 0
    assert await page.locator('#richVoice').count() == 1, 'Workspace must not reuse the chat microphone ID'
    await page.locator('.workspaceEditor textarea').first.fill('До вложений: https://example.test/ссылка')
    await page.evaluate('''async() => {
      const first=document.querySelector('.workspaceEditor textarea'); first.setSelectionRange(2,2); first.dispatchEvent(new Event('select'));
      await editor.addFiles(fileInputs);
    }''')
    assert await page.evaluate('''async() => {
      const draft=editor.snapshot();
      return draft.files.length===4 && JSON.stringify(await Promise.all(draft.files.map(f=>f.file.text())))===JSON.stringify(fileValues)
        && draft.files.every((f,i)=>f.file===fileInputs[i]) && draft.content.blocks.filter(b=>b.assetId).map(b=>b.type).join(',')==='image,video,audio,document'
        && draft.content.blocks.find(b=>b.path).path===originalRemote.path && editor.isDirty() && !draft.errors.length;
    }'''), 'Mixed blocks must keep original File objects, ordering, and existing path'
    await page.locator('.workspaceEditor [aria-label="Добавить вложение"]').click()
    await page.locator('.workspaceEditorMenu [aria-label="Добавить ссылку"]').click()
    await page.locator('.workspaceEditorLink input').fill('https://example.test/project')
    await page.locator('.workspaceEditorLink button').click()
    assert 'https://example.test/project' in await page.evaluate('editor.snapshot().text')
    assert await page.evaluate('chat.capture().text==="Неприкосновенный черновик чата" && chatChanges===0')
    await page.evaluate('editor.startRecording()')
    assert await page.evaluate('editor.recording && !chat.recording')
    await page.locator('.workspaceEditor textarea').last.fill('Текст во время записи')
    await page.evaluate('editor.stopRecording()')
    assert await page.evaluate('''async()=> !editor.recording && editor.snapshot().text.includes('Текст во время записи')
      && (await editor.files.at(-1).file.text())==='MOCK_MIC_DETERMINISTIC_CHUNK' && __mockMic.stops>0'''), 'Finish recording must retain text and completed audio'
    await page.locator('.workspaceEditorExpand').click()
    assert await page.evaluate('document.querySelector(".workspaceEditor").getBoundingClientRect().width<=390')
    await page.locator('.workspaceEditorDone').click()
    assert await page.evaluate('''()=>{
      const root=document.querySelector('.workspaceEditor'),text=root.querySelector('textarea');
      return getComputedStyle(text).borderWidth==='0px' && parseFloat(getComputedStyle(root).borderRadius)>15
        && root.getBoundingClientRect().right<=390 && root.querySelector('.workspaceEditorBody').getBoundingClientRect().height<=340;
    }'''), 'Mobile editor remains bounded and has no native textarea frame'
    await page.evaluate('''()=>{
      window.recovered=editor.snapshot(); editor.setContent(recovered.content,{files:recovered.files,selection:recovered.selection});
    }''')
    assert await page.evaluate('!editor.isDirty() && editor.files.length===5 && !editor.validate().errors.length')
    await page.locator('.workspaceEditor [data-workspace-remote] .richAction').click()
    assert await page.evaluate('!editor.getContent().blocks.some(b=>b.path) && editor.isDirty()')
    await page.evaluate('''async()=>{
      const pending=editor.addFiles(fileInputs); editor.setDisabled(true); await editor.stopRecording(); await pending;
    }''')
    assert await page.evaluate('editor.files.length===9'), 'Save freeze must wait for all already selected files'
    assert await page.locator('.workspaceEditor textarea').first.get_attribute('readonly') is not None
    await page.evaluate('''()=>{
      editor.setDisabled(false); editor.setContent({v:1,blocks:[{id:'long',type:'text',text:'x'.repeat(20001)}]});
    }''')
    assert await page.evaluate('editor.snapshot().text.length===20001 && !editor.validate().ok'), 'Long text must be preserved and rejected explicitly'
    await page.evaluate('''async()=>{
      editor.setContent({v:1,blocks:[0,1,2,3].map(i=>({id:'remote-limit-'+i,type:'document',path:'synthetic/limit/'+i,name:'Limit '+i,mime:'application/pdf',size:25*1024*1024}))});
      await editor.addFiles([fileInputs[3]]);
    }''')
    assert await page.evaluate('editor.files.length===0 && editor.getContent().blocks.filter(b=>b.path).length===4'), 'Size budget must include retained attachments'
    await page.evaluate('''async()=>{
      editor.setContent('Черновик'); await editor.startRecording(); window.stopsBeforeDestroy=__mockMic.stops; editor.destroy();
    }''')
    assert await page.evaluate('__mockMic.stops>stopsBeforeDestroy && document.querySelectorAll(".workspaceEditor").length===0 && chat.capture().text==="Неприкосновенный черновик чата"')
    await page.evaluate('''async()=>{
      window.lateStops=0;
      navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>window.allowLateMicrophone=resolve);
      const late=PablicusWorkspaceEditor.create({host:document.querySelector('#host'),content:'Новый черновик'});
      const request=late.startRecording(); late.destroy();
      const track={stop:()=>lateStops++}; allowLateMicrophone({getTracks:()=>[track],getAudioTracks:()=>[track]});
      await request;
    }''')
    assert await page.evaluate('lateStops===1 && document.querySelectorAll(".workspaceEditor").length===0'), 'Late microphone permission must release the device after navigation'
    assert failures == [], failures
    await browser.close()
    return {"engine": name, "result": "passed", "checks": ["remote metadata roundtrip", "original mixed-file bytes and insertion order", "link insertion", "voice and text coexist", "chat isolation", "mobile bounds", "recovered draft", "remove existing attachment", "in-flight files survive save freeze", "text and total-size limits", "recording cleanup", "late microphone permission cleanup"]}


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--engines', default='chromium,webkit')
    args = parser.parse_args()
    async with async_playwright() as runtime:
        for name in args.engines.split(','):
            print(json.dumps(await run(getattr(runtime, name), name), ensure_ascii=False))


if __name__ == '__main__':
    asyncio.run(main())
