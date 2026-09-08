"""Focused voice UX proof with actual WAV decoding, never a live account.

Run after installing Playwright browsers. Routes source files and synthetic audio
in memory; no application server, external requests or credentials are used.
"""
import argparse
import asyncio
import io
import json
import math
import struct
import wave
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]


def wav():
    stream = io.BytesIO()
    with wave.open(stream, 'wb') as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(16000)
        # Silence followed by a rising signal allows checking actual decoded
        # samples, rather than accepting arbitrary decorative waveform bars.
        target.writeframes(b''.join(struct.pack('<h', round(
            (0 if i < 16000 else 3000 * (i - 16000) / 48000) * math.sin(i * math.tau * 240 / 16000)
        )) for i in range(16000 * 4)))
    return stream.getvalue()


async def run(name, browser_type):
    browser = await browser_type.launch(headless=True)
    context = await browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, service_workers='block')
    page = await context.new_page()
    requests, errors, checks = [], [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    css = (ROOT / 'src/pablicus.css').read_text() + '\n' + (ROOT / 'src/rich-message.css').read_text()
    html = '''<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>''' + css + '''
#canvas{padding:35px 18px}.bubble{margin:0 0 12px;width:max-content;max-width:90%;padding:9px 12px}.richMessage{width:250px}.measureBox{visibility:hidden;height:0;overflow:hidden}
</style><main id="canvas"></main><aside class="measureBox"></aside><script src="/message-menu.js"></script><script src="/rich-message.js"></script><script>
window.resolves=0;window.replies=[];window.opens=0;
const options={resolveUrl:(path)=>{resolves++;return location.origin+'/'+path},onReply:b=>replies.push(b.id),openMedia:()=>opens++};
function mount(id,path,where='#canvas'){
 const row=document.createElement('div'); row.className='bubble';
 const tree=PablicusRichMessage.render({v:1,blocks:[{id,type:'audio',path,name:'Голосовое сообщение',mime:'audio/wav'}]},options);
 row.append(tree);document.querySelector(where).append(row);tree.activate();return tree;
}
window.first=mount('one','voice.wav');mount('two','voice.wav');mount('measure','voice.wav','.measureBox');
</script>'''

    async def route(route):
        path = route.request.url.split('127.0.0.1:8774')[-1]
        requests.append((path, route.request.resource_type))
        if path == '/':
            await route.fulfill(status=200, content_type='text/html', body=html)
        elif path in ['/rich-message.js', '/message-menu.js']:
            await route.fulfill(status=200, content_type='text/javascript', body=(ROOT / 'src' / path.removeprefix('/')).read_bytes())
        elif path == '/voice.wav':
            data = wav()
            headers = {'Accept-Ranges': 'bytes', 'Content-Length': str(len(data))}
            if route.request.headers.get('range'):
                headers['Content-Range'] = f'bytes 0-{len(data)-1}/{len(data)}'
            await route.fulfill(status=206 if route.request.headers.get('range') else 200, content_type='audio/wav', headers=headers, body=data)
        elif path == '/fallback.wav':
            # Media playback succeeds; optional waveform download does not.
            if route.request.resource_type == 'fetch':
                await route.fulfill(status=403, body='Optional waveform unavailable')
            else:
                await route.fulfill(status=200, content_type='audio/wav', body=wav())
        else:
            raise AssertionError('Unexpected network request: ' + route.request.url)
    await page.route('**/*', route)
    await page.goto('http://127.0.0.1:8774/')
    await page.wait_for_timeout(150)
    assert await page.evaluate('resolves') == 0
    assert not any(path.endswith('.wav') for path, _ in requests)
    checks.append('no audio requests before a gesture; virtual measurement copy stays inert')
    first = page.locator('[data-block-id="one"]')
    second = page.locator('[data-block-id="two"]')
    await first.locator('.richAudioPlay').click()
    await page.wait_for_function("document.querySelector('[data-block-id=one] audio').currentTime > .1")
    await page.wait_for_selector('[data-block-id="one"].richAudioHasWave')
    heights = await first.locator('.richAudioWave rect').evaluate_all('(bars)=>bars.map(b=>+b.getAttribute("height"))')
    assert len(heights) == 40 and all(height == 1.5 for height in heights[:9])
    assert heights[-1] > heights[15] > heights[9]
    assert await page.evaluate('opens') == 0
    await page.wait_for_function("+document.querySelector('[data-block-id=one] .richAudioSeek').value > 0")
    checks.append('actual decoded WAV silence and increasing amplitude appear faithfully in 40 bars; playback stays inline')
    assert (await first.bounding_box())['height'] <= 70
    await first.locator('.richAudioRate').click()
    assert await first.locator('audio').evaluate('(a)=>a.playbackRate') == 1.5
    await first.locator('.richAudioRate').click()
    assert await first.locator('audio').evaluate('(a)=>a.playbackRate') == 2
    await first.locator('.richAudioRate').click()
    assert await first.locator('audio').evaluate('(a)=>a.playbackRate') == 1
    checks.append('compact 68px voice strip; speed cycles 1, 1.5, 2 and back to 1 on actual audio element')
    await first.locator('.richAudioPlay').click()
    assert await first.locator('audio').evaluate('(a)=>a.paused')
    await first.locator('.richAudioSeek').evaluate("s=>{s.value='500';s.dispatchEvent(new Event('input',{bubbles:true}))}")
    assert 1.9 <= await first.locator('audio').evaluate('(a)=>a.currentTime') <= 2.1
    await first.locator('.richAudioPlay').click()
    await second.locator('.richAudioPlay').click()
    await page.wait_for_function("document.querySelector('[data-block-id=two] audio').currentTime > .1")
    assert await first.locator('audio').evaluate('(a)=>a.paused')
    await second.locator('.richAudioReply').click()
    assert await page.evaluate('replies') == ['two']
    assert await page.evaluate('opens') == 0
    await second.locator('.richAudioPlay').click()
    checks.append('seek changes position; second voice pauses first; separate reply does not open or toggle media')
    await page.evaluate("mount('fallback','fallback.wav')")
    fallback = page.locator('[data-block-id="fallback"]')
    await fallback.locator('.richAudioPlay').click()
    await page.wait_for_function("document.querySelector('[data-block-id=fallback] audio').currentTime > .1")
    await page.wait_for_timeout(150)
    assert await fallback.locator('.richAudioWave rect').count() == 0
    assert not await fallback.locator('.richAudioSeek').is_disabled()
    await fallback.locator('.richAudioPlay').click()
    checks.append('optional waveform failure preserves playback and the clean seek track')
    await page.locator('[data-block-id="measure"] .richAudioPlay').dispatch_event('click')
    assert await page.locator('[data-block-id="measure"] audio').get_attribute('src') is None
    evidence = ROOT / 'evidence'
    evidence.mkdir(exist_ok=True)
    await page.screenshot(path=str(evidence / f'voice-design-{name}.png'))
    await first.locator('.richAudioPlay').click()
    await page.evaluate("document.querySelector('[data-block-id=one]').parentNode.remove()")
    await page.wait_for_timeout(100)
    assert await page.evaluate("first.querySelector('audio').paused && !first.querySelector('audio').getAttribute('src')")
    checks.append('row removal stops playback and releases the media URL; measurement copy never starts')
    assert not errors, errors
    await browser.close()
    return {'engine': name, 'pass': True, 'checks': checks, 'scope': 'isolated source module and actual synthetic WAV decoding; no physical iPhone claim'}


async def main(names):
    async with async_playwright() as playwright:
        output = [await run(name, getattr(playwright, name)) for name in names]
    (ROOT / 'evidence/voice-design.json').write_text(json.dumps(output, ensure_ascii=False, indent=2))
    print(json.dumps(output, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('engines', nargs='*')
    names = parser.parse_args().engines or ['chromium', 'webkit']
    if any(name not in ['chromium', 'webkit'] for name in names):
        parser.error('Supported engines: chromium, webkit')
    asyncio.run(main(names))
