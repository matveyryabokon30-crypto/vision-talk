"""Focused voice UX proof with actual WAV decoding, never a live account.

Run after installing Playwright browsers. An isolated threaded localhost HTTP
fixture serves source files and synthetic audio. Media requests never pass
through Playwright interception; only an optional waveform fetch failure is
explicitly injected. No live account or credentials are used.
"""
import argparse
import asyncio
import io
import json
import math
import re
import struct
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
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
            (0 if i < 16000 else 3000 * (i - 16000) / (16000 * 11)) * math.sin(i * math.tau * 240 / 16000)
        )) for i in range(16000 * 12)))
    return stream.getvalue()


def media_response(data, range_header=None):
    """HTTP single-range semantics used by actual audio servers.

    A WebKit rate change can seek to a new byte offset. Returning the entire
    file with an invented Content-Range can stall its media pipeline.
    """
    total = len(data)
    headers = {'Accept-Ranges': 'bytes', 'Content-Length': str(total)}
    if not range_header:
        return 200, headers, data
    match = re.fullmatch(r'bytes=(\d*)-(\d*)', range_header.strip())
    if not match or not any(match.groups()):
        return 416, {'Content-Range': f'bytes */{total}'}, b''
    first, last = match.groups()
    if first:
        start, end = int(first), min(int(last), total - 1) if last else total - 1
    else:
        start, end = max(0, total - int(last)), total - 1
    if start >= total or start > end:
        return 416, {'Content-Range': f'bytes */{total}'}, b''
    body = data[start:end + 1]
    headers['Content-Length'] = str(len(body))
    headers['Content-Range'] = f'bytes {start}-{end}/{total}'
    return 206, headers, body


def verify_media_ranges():
    data = b'0123456789'
    assert media_response(data)[::2] == (200, data)
    for request, expected_body, expected_range in [
        ('bytes=0-1', b'01', 'bytes 0-1/10'),
        ('bytes=4-', b'456789', 'bytes 4-9/10'),
        ('bytes=3-5', b'345', 'bytes 3-5/10'),
        ('bytes=7-100', b'789', 'bytes 7-9/10'),
        ('bytes=-3', b'789', 'bytes 7-9/10'),
    ]:
        status, headers, body = media_response(data, request)
        assert status == 206 and body == expected_body
        assert headers['Content-Range'] == expected_range
        assert headers['Content-Length'] == str(len(body))
    for request in ['bytes=20-', 'bytes=5-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,3-4']:
        status, headers, body = media_response(data, request)
        assert status == 416 and not body and headers['Content-Range'] == 'bytes */10'


@contextmanager
def fixture_server(html, requests):
    """Keep native media transport independent from the browser protocol.

    WebKit/GStreamer can synchronously seek when changing playbackRate. A real
    server thread can answer that request while a Playwright click is pending.
    """
    media = wav()
    sources = {path: (ROOT / 'src' / path.removeprefix('/')).read_bytes()
               for path in ['/rich-message.js', '/message-menu.js']}

    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'

        def log_message(self, *_):
            pass

        def do_HEAD(self):
            self.do_GET()

        def do_GET(self):
            path = urlsplit(self.path).path
            kind = 'media' if path.endswith('.wav') else 'document'
            requests.append((path, kind))
            if path.endswith('.wav'):
                print(f'VOICE_HTTP method={self.command} path={path} range={self.headers.get("Range")}', flush=True)
            headers, status, mime = {}, 200, 'text/html; charset=utf-8'
            if path == '/':
                body = html.encode('utf-8')
                headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'"
            elif path in sources:
                mime, body = 'text/javascript; charset=utf-8', sources[path]
            elif path in ['/voice.wav', '/fallback.wav']:
                mime = 'audio/wav'
                status, headers, body = media_response(media, self.headers.get('range'))
            elif path == '/favicon.ico':
                status, body = 204, b''
            else:
                status, body = 404, b'Unknown fixture'
            self.send_response(status)
            self.send_header('Content-Type', mime)
            self.send_header('Cache-Control', 'no-store')
            for key, value in headers.items():
                self.send_header(key, value)
            if 'Content-Length' not in headers:
                self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            try:
                if self.command != 'HEAD':
                    self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                # Audio is intentionally paused/released during these checks.
                pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}'
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


async def diagnose_native_audio(name, browser):
    """Separate native transport/decoder behavior from the product renderer.

    These observations never replace or relax the actual player assertions.
    Every mode receives the same real 12-second WAV and native media APIs.
    """
    html = '''<!doctype html><meta charset="utf-8"><button id="play">Play</button>
<audio id="audio" preload="none"></audio><script>
window.nativeErrors=[];window.decodedDuration=null;window.mediaUrl='/voice.wav';
document.querySelector('#play').onclick=()=>{
  const audio=document.querySelector('#audio');audio.src=window.mediaUrl;
  audio.play().catch(error=>nativeErrors.push(error.name+': '+error.message));
  if(window.mode==='http-with-waveform'){
    fetch('/voice.wav').then(response=>response.arrayBuffer()).then(bytes=>
      new OfflineAudioContext(1,1,16000).decodeAudioData(bytes)
    ).then(decoded=>window.decodedDuration=decoded.duration)
     .catch(error=>nativeErrors.push('decode: '+error.name));
  }
};
</script>'''
    requests = []
    with fixture_server(html, requests) as origin:
        for mode in ['http', 'http-with-waveform', 'blob']:
            context = await browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, service_workers='block')
            page = await context.new_page()
            page.set_default_timeout(5000)
            snapshots = []
            try:
                await page.goto(origin + '/')
                await page.evaluate('(mode)=>window.mode=mode', mode)
                if mode == 'blob':
                    await page.evaluate("async()=>{const response=await fetch('/voice.wav');const bytes=await response.arrayBuffer();window.blobBytes=bytes.byteLength;window.mediaUrl=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));}")
                await page.locator('#play').click()
                elapsed = 0
                for delay in [150, 350, 500, 1000]:
                    await page.wait_for_timeout(delay)
                    elapsed += delay
                    state = await page.locator('audio').evaluate('a=>({duration:a.duration,currentTime:a.currentTime,ended:a.ended,paused:a.paused,readyState:a.readyState,networkState:a.networkState,seekable:Array.from({length:a.seekable.length},(_,i)=>[a.seekable.start(i),a.seekable.end(i)]),mediaError:a.error?.message||null,decodedDuration:window.decodedDuration,blobBytes:window.blobBytes||null,errors:window.nativeErrors})')
                    snapshots.append({'elapsedMs': elapsed, **state})
            except Exception as error:
                snapshots.append({'diagnosticError': str(error)[:500]})
            finally:
                print('VOICE_NATIVE_MEDIA ' + json.dumps({'engine': name, 'mode': mode, 'snapshots': snapshots}), flush=True)
                await context.close()


async def run(name, browser_type):
    browser = await browser_type.launch(headless=True)
    await diagnose_native_audio(name, browser)
    context = await browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, service_workers='block')
    page = await context.new_page()
    requests, errors, checks = [], [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    css = (ROOT / 'src/pablicus.css').read_text() + '\n' + (ROOT / 'src/rich-message.css').read_text()
    html = '''<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>''' + css + '''
#canvas{padding:35px 18px}.bubble{margin:0 0 12px;width:max-content;max-width:90%;padding:9px 12px}.richMessage{width:250px}.measureBox{visibility:hidden;height:0;overflow:hidden}
</style><main id="canvas"></main><aside class="measureBox"></aside><script src="/message-menu.js"></script><script src="/rich-message.js"></script><script>
window.resolves=0;window.replies=[];window.opens=0;window.waveformFailures=0;
// Preserve native request headers/cache semantics for real media and normal
// waveform decoding. Only the optional fallback waveform fetch is faulted;
// HTMLMediaElement still receives its complete, real WAV from the HTTP server.
const realFetch=window.fetch.bind(window);
window.fetch=(resource,options)=>{
  if(new URL(typeof resource==='string'?resource:resource.url,location.href).pathname==='/fallback.wav'){
    window.waveformFailures++;return Promise.reject(new TypeError('Injected optional waveform network failure'));
  }
  return realFetch(resource,options);
};
const options={resolveUrl:(path)=>{resolves++;return location.origin+'/'+path},onReply:b=>replies.push(b.id),openMedia:()=>opens++};
function mount(id,path,where='#canvas'){
 const row=document.createElement('div'); row.className='bubble';
 const tree=PablicusRichMessage.render({v:1,blocks:[{id,type:'audio',path,name:'Голосовое сообщение',mime:'audio/wav'}]},options);
 row.append(tree);document.querySelector(where).append(row);tree.activate();return tree;
}
window.first=mount('one','voice.wav');mount('two','voice.wav');mount('measure','voice.wav','.measureBox');
</script>'''

    with fixture_server(html, requests) as origin:
        unexpected = []
        page.on('request', lambda request: unexpected.append(request.url) if not request.url.startswith(origin + '/') else None)
        await page.goto(origin + '/')
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
        assert len(heights) == 40 and all(height == 1.5 for height in heights[:3])
        assert heights[-1] > heights[15] > heights[4]
        assert await page.evaluate('opens') == 0
        await page.wait_for_function("+document.querySelector('[data-block-id=one] .richAudioSeek').value > 0")
        checks.append('actual decoded WAV silence and increasing amplitude appear faithfully in 40 bars; playback stays inline')
        assert (await first.bounding_box())['height'] <= 70
        snapshot = await first.locator('audio').evaluate('a=>({paused:a.paused,ended:a.ended,time:a.currentTime,duration:a.duration})')
        print(f'VOICE_CORE_STATE engine={name} snapshot={snapshot}', flush=True)
        assert not snapshot['paused'] and not snapshot['ended'], 'Voice should still be playing'
        assert await first.locator('button').count() == 2, 'Only play and reply are offered'
        checks.append('compact 68px voice strip with play and separate reply controls')
        await first.locator('.richAudioPlay').click()
        assert await first.locator('audio').evaluate('(a)=>a.paused')
        native_timeline = await first.locator('audio').evaluate('a=>({duration:a.duration,ranges:Array.from({length:a.seekable.length},(_,i)=>[a.seekable.start(i),a.seekable.end(i)])})')
        seekable = native_timeline['duration'] is not None and math.isfinite(native_timeline['duration']) and native_timeline['duration'] > 0 and any(end > start for start, end in native_timeline['ranges'])
        before_seek = await first.locator('audio').evaluate('(a)=>a.currentTime')
        assert await first.locator('.richAudioSeek').is_disabled() == (not seekable)
        await first.locator('.richAudioSeek').evaluate("s=>{s.value='500';s.dispatchEvent(new Event('input',{bubbles:true}))}")
        if seekable:
            assert 5.9 <= await first.locator('audio').evaluate('(a)=>a.currentTime') <= 6.1
            checks.append('a native seekable timeline actually moves to six seconds')
        else:
            assert abs(await first.locator('audio').evaluate('(a)=>a.currentTime') - before_seek) < .1
            checks.append('an unseekable native stream disables scrubbing and ignores forced seek input while retaining playback')
        paused_at = await first.locator('audio').evaluate('(a)=>a.currentTime')
        await page.wait_for_timeout(120)
        assert await first.locator('audio').evaluate('(a)=>a.paused')
        assert abs(await first.locator('audio').evaluate('(a)=>a.currentTime') - paused_at) < .1
        print(f'VOICE_SEEK_RESUME_START engine={name}', flush=True)
        await first.locator('.richAudioPlay').click()
        await page.wait_for_function("position=>{const a=document.querySelector('[data-block-id=one] audio');return !a.paused&&a.currentTime>position+.05}", arg=paused_at)
        # Reach a real end-of-stream, then explicitly play again. This protects
        # the basic voice lifecycle independently from optional future features.
        if seekable:
            await first.locator('.richAudioSeek').evaluate("s=>{s.value='980';s.dispatchEvent(new Event('input',{bubbles:true}))}")
        await page.wait_for_function("document.querySelector('[data-block-id=one] audio').ended")
        assert await first.locator('audio').evaluate('(a)=>a.ended && a.paused')
        print(f'VOICE_ENDED_REPLAY_START engine={name}', flush=True)
        await first.locator('.richAudioPlay').click()
        await page.wait_for_function("(()=>{const a=document.querySelector('[data-block-id=one] audio');return !a.paused&&!a.ended&&a.currentTime>.1&&a.currentTime<3})()")
        print(f'VOICE_ENDED_REPLAY_DONE engine={name}', flush=True)
        checks.append('pause preserves position; real end-of-stream stays stopped until an explicit replay from the beginning')
        await second.locator('.richAudioPlay').click()
        await page.wait_for_function("document.querySelector('[data-block-id=two] audio').currentTime > .1")
        assert await first.locator('audio').evaluate('(a)=>a.paused')
        await second.locator('.richAudioReply').click()
        assert await page.evaluate('replies') == ['two']
        assert await page.evaluate('opens') == 0
        await second.locator('.richAudioPlay').click()
        checks.append('second voice pauses first; separate reply does not open or toggle media')
        await page.evaluate("mount('fallback','fallback.wav')")
        fallback = page.locator('[data-block-id="fallback"]')
        await fallback.locator('.richAudioPlay').click()
        await page.wait_for_function("document.querySelector('[data-block-id=fallback] audio').currentTime > .1")
        await page.wait_for_timeout(150)
        assert await fallback.locator('.richAudioWave rect').count() == 0
        fallback_seekable = await fallback.locator('audio').evaluate('a=>Number.isFinite(a.duration)&&a.duration>0&&a.seekable.length>0&&a.seekable.end(a.seekable.length-1)>a.seekable.start(a.seekable.length-1)')
        assert await fallback.locator('.richAudioSeek').is_disabled() == (not fallback_seekable)
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
        assert not unexpected, unexpected
        assert await page.evaluate('waveformFailures') == 1, 'Optional waveform failure path was not exercised exactly once'
        await browser.close()
        return {'engine': name, 'pass': True, 'checks': checks, 'scope': 'isolated source module with real threaded localhost HTTP and synthetic WAV decoding; one explicitly injected optional waveform fetch failure; no intercepted native media, live account or physical iPhone claim'}


async def main(names):
    verify_media_ranges()
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
