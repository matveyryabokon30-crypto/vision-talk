"""Owner-requested in-place project expansion; no storage or transport changes."""
from pathlib import Path
import argparse, hashlib

BASELINE = {
    'src/chat-canvas.js': 'bca320afda85ff4cf0f2c3b6ed5353721d9327a49111049078b923cdcf746b79',
    'src/chat-canvas.css': '0e87bcc693bcf3d02bb57e4fa048dc582b80b25a27cf0758876fd1104bce2d45',
    'tests/chat_canvas.py': '74ddefdd43cf7a439ba36be925282d7f1cd6f207156ae48ec5c08accb64607c0',
}

def prepare(root):
    root = Path(root) / 'apps/pablicus'
    for path, expected in BASELINE.items():
        assert hashlib.sha256((root / path).read_bytes()).hexdigest() == expected, path
    def edit(path, changes):
        target = root / path
        text = target.read_text()
        for old, new in changes:
            assert text.count(old) == 1, (path, old[:100])
            text = text.replace(old, new, 1)
        target.write_text(text)

    edit('src/chat-canvas.js', [
        ("    const planCard = button('pccProjectCard', 'Открыть проект');", """    // One persistent surface owns the summary and the full project. The native
    // button toggles disclosure; media/edit controls are siblings, never nested.
    const planSurface = el('article', 'pccProject');
    const planCard = button('pccProjectCard', 'Открыть проект');
    planCard.setAttribute('aria-controls', uid + '-project-content');"""),
        ("    const planView = el('div', 'pccProjectView');", """    const planView = el('div', 'pccProjectView');
    planView.id = uid + '-project-content';"""),
        ("    planSection.append(planCard, planNew, planView, planEditorHost, planFoot, planConflict);", """    planSurface.append(planCard, planView);
    planSection.append(planSurface, planNew, planEditorHost, planFoot, planConflict);"""),
        ("      planCard.hidden = !exists || planEditing;", """      planSurface.hidden = !exists || planEditing;
      planSurface.dataset.expanded = String(planExpanded && !planEditing);"""),
        ("      planExcerpt.hidden = !planExcerpt.textContent;", """      planTitle.hidden = planExpanded;
      planExcerpt.hidden = planExpanded || !planExcerpt.textContent;"""),
        ("      planAttachments.hidden = !planAttachments.textContent;\n      planCard.title = 'Открыть проект';", """      planAttachments.hidden = planExpanded || !planAttachments.textContent;
      const disclosureLabel = planExpanded ? 'Свернуть проект' : 'Открыть проект';
      planCard.title = disclosureLabel;
      planCard.setAttribute('aria-label', disclosureLabel);"""),
    ])

    edit('src/chat-canvas.css', [
        ('.pablicusChatCanvas .pccProjectCard{position:relative;display:flex;flex-direction:column;gap:6px;width:100%;min-width:0;max-height:164px;margin:0;padding:16px 42px 16px 17px;border:0;border-radius:22px;background:var(--surface,#fff);box-shadow:0 3px 20px rgba(30,35,40,.035);text-align:left;overflow:hidden}', """.pablicusChatCanvas .pccProject{position:relative;width:100%;min-width:0;margin:0;border-radius:22px;background:var(--surface,#fff);box-shadow:0 3px 20px rgba(30,35,40,.035)}
.pablicusChatCanvas .pccProjectCard{position:relative;display:flex;flex-direction:column;gap:6px;width:100%;min-width:0;max-height:164px;margin:0;padding:16px 42px 16px 17px;border:0;border-radius:22px;background:transparent;text-align:left;overflow:hidden}
.pablicusChatCanvas .pccProjectCard[aria-expanded=true]{position:absolute;top:4px;right:4px;z-index:1;display:grid;place-items:center;width:44px;min-width:44px;height:44px;min-height:44px;margin:0;padding:0;border-radius:50%}"""),
        ('.pablicusChatCanvas .pccProjectCard[aria-expanded=true]>svg{transform:rotate(90deg)}', '.pablicusChatCanvas .pccProjectCard[aria-expanded=true]>svg{position:static;transform:rotate(-90deg)}'),
        ('.pablicusChatCanvas .pccProjectView{padding:13px 14px 2px;margin-top:5px;border-radius:20px;background:var(--surface,#fff);min-width:0}', '.pablicusChatCanvas .pccProjectView{padding:48px 17px 8px;margin:0;border-radius:0;background:transparent;min-width:0}'),
        ('.pablicusChatCanvas .pccProjectViewContent{max-height:min(45dvh,380px);overflow:auto;overscroll-behavior:contain;font-size:16px;line-height:1.6;overflow-wrap:anywhere;white-space:pre-wrap}', """/* The project grows in the canvas flow. Only the canvas itself scrolls. */
.pablicusChatCanvas .pccProjectViewContent{max-height:none;overflow:visible;font-size:16px;line-height:1.6;overflow-wrap:anywhere;white-space:pre-wrap}
.pablicusChatCanvas .pccProjectViewContent>.richMessage{width:100%;max-width:100%}"""),
    ])

    edit('tests/chat_canvas.py', [
        ("        await project_card.click()\n        await pane.locator('.pccProjectViewContent a[href=\"https://example.com/brief\"]').wait_for()\n        await pane.locator('.pccPlanEdit').click()", """        # Owner acceptance: the card itself unfolds; no duplicate preview or
        # separately scrolling detail surface may remain underneath it.
        await page.evaluate('window.__projectSurface=document.querySelector(".pccProject")')
        for width in (390, 320, 768):
            await page.set_viewport_size({'width': width, 'height': 844})
            await page.wait_for_timeout(200)
            await project_card.scroll_into_view_if_needed()
            before = await pane.locator('.pccProject').evaluate('node=>({height:node.offsetHeight,top:node.offsetTop})')
            assert before['height'] <= 165
            if width == 320:
                await project_card.focus()
                await project_card.press('Enter')
            else:
                await project_card.click()
            await pane.locator('.pccProjectViewContent a[href="https://example.com/brief"]').wait_for()
            assert await project_card.get_attribute('aria-expanded') == 'true'
            assert await project_card.get_attribute('aria-label') == 'Свернуть проект'
            assert await project_card.inner_text() == ''
            for selector in ('.pccProjectTitle', '.pccProjectExcerpt', '.pccAttachmentSummary'):
                assert await project_card.locator(selector).is_hidden()
            surface = pane.locator('.pccProject')
            assert await surface.count() == 1
            assert await surface.locator('.pccProjectView').count() == 1
            assert await pane.locator('.pccPlan > .pccProjectView').count() == 0
            assert (await surface.inner_text()).count('Съёмка сериала') == 1
            texts = await surface.locator('.pccProjectViewContent .richText').all_text_contents()
            assert texts == [block['text'] for block in project_content['blocks'] if block['type'] == 'text']
            assert await surface.locator('.pccProjectViewContent .richMedia').count() == 4
            assert await surface.evaluate('node=>node===window.__projectSurface')
            assert await project_card.evaluate('node=>document.getElementById(node.getAttribute("aria-controls"))===node.nextElementSibling')
            layout = await surface.evaluate('''node=>{
                const view=node.querySelector('.pccProjectView'), body=node.querySelector('.pccProjectViewContent');
                const r=node.getBoundingClientRect(), style=getComputedStyle(body);
                const edit=node.querySelector('.pccPlanEdit').getBoundingClientRect();
                return {height:node.offsetHeight,top:node.offsetTop,left:r.left,right:r.right,viewport:innerWidth,
                    maxHeight:style.maxHeight,overflowY:style.overflowY,bodyClient:body.clientHeight,bodyScroll:body.scrollHeight,
                    viewBackground:getComputedStyle(view).backgroundColor,editBottom:edit.bottom,cardBottom:r.bottom,
                    pageOverflow:document.documentElement.scrollWidth>innerWidth};
            }''')
            assert layout['top'] == before['top'], layout
            assert layout['height'] > 500 and layout['maxHeight'] == 'none', layout
            assert layout['overflowY'] == 'visible' and layout['bodyScroll'] <= layout['bodyClient'] + 1, layout
            assert layout['viewBackground'] == 'rgba(0, 0, 0, 0)', layout
            assert layout['editBottom'] <= layout['cardBottom'] + 1, layout
            assert layout['left'] >= 0 and layout['right'] <= width + 1 and not layout['pageOverflow'], layout
            await page.screenshot(path=str(EVIDENCE / f'chat-canvas-{name}-expanded-project-{width}.png'))
            await pane.locator('.pccPlanEdit').scroll_into_view_if_needed()
            assert await pane.evaluate('node=>node.scrollTop') > 0
            assert await pane.locator('.pccProjectViewContent').evaluate('node=>node.scrollTop') == 0
            # A same-revision refresh must not recreate or collapse the project.
            await page.evaluate('window.__projectRich=document.querySelector(".pccProjectViewContent").firstElementChild')
            await pane.locator('.pccRefresh').click()
            await pane.locator('.pablicusChatCanvas[data-state="ready"]').wait_for()
            assert await page.evaluate('__projectRich===document.querySelector(".pccProjectViewContent").firstElementChild')
            await project_card.scroll_into_view_if_needed()
            if width == 320:
                await project_card.focus()
                await project_card.press('Space')
            else:
                await project_card.click()
            assert await project_card.get_attribute('aria-expanded') == 'false'
            assert await surface.locator('.pccProjectView').is_hidden()
            assert not await surface.locator('.pccProjectViewContent > *').count()
            assert await surface.evaluate('node=>node.offsetHeight') <= 165
            assert await page.evaluate('id=>__mock.canvasState[id].canvas.content', MAIN_CHAT) == project_content
        await page.set_viewport_size({'width': 390, 'height': 844})
        await page.wait_for_timeout(200)
        checks.append('one persistent project card unfolds in place at 320/390/768px; summary is hidden, exact full text appears once, all four attachments remain, body has no height cap or inner scroll, canvas scroll reaches Edit, keyboard disclosure and refresh retain state, collapse disposes rendered media without changing saved data')
        await project_card.click()
        await pane.locator('.pccProjectViewContent a[href="https://example.com/brief"]').wait_for()
        await pane.locator('.pccPlanEdit').click()"""),
    ])
    for path in BASELINE:
        print(path, hashlib.sha256((root/path).read_bytes()).hexdigest())

if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('source',type=Path);args=parser.parse_args()
    prepare(args.source)
