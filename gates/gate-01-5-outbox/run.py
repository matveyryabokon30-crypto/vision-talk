"""Driver synchronization only. Application and acceptance predicates unchanged."""
from pathlib import Path
p=Path(__file__).with_name('test.py')
s=p.read_text(encoding='utf-8')
old="if page.evaluate('() => Boolean('+expr+')'):return"
assert old in s
s=s.replace(old,"if page.evaluate('() => Boolean(window.gate && typeof gate.queueSummary===\"function\" && ('+expr+'))'):return")
old="page.locator('#queueBtn').click();page.locator('#queueReload').click();ready(page)\n   until(page,'gate.queueSummary().reload_check')"
assert old in s
s=s.replace(old,"oldboot=page.evaluate('vault.bootId');page.locator('#queueBtn').click();page.locator('#queueReload').click()\n   until(page,'vault.bootId!=='+json.dumps(oldboot)+' && gate.queueSummary().reload_check')\n   ready(page)")
s=s.replace("page.locator('#input').press('End')","page.locator('#input').press('Control+End')")
s=s.replace('   ctx.set_viewport_size if False else None\n','')
e=Path('evidence/gate015/executed_test.py');e.parent.mkdir(parents=True,exist_ok=True);e.write_text(s,encoding='utf-8')
exec(compile(s,str(p),'exec'))
