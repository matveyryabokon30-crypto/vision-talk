"""One-time source migration. The release workflow commits these source edits
before building; this script is not required by the published client.
No Auth setting, account, identifier, draft schema or transport RPC is changed.
"""
from pathlib import Path
R=Path(__file__).resolve().parent
p=R/'build.py';s=p.read_text()
if "magic=r'''" in s:
 start=s.index("magic=r'''")
 end=s.index("app=app.replace('refreshing=false",start)
 s=s[:start]+'''# Standard provider verification completes in the requesting browsing context.
needle=" sb.auth.onAuthStateChange("
assert app.count(needle)==1,'Auth event binding changed; review required'
app=app.replace(needle," PablicusLogin.mount({client:sb,projectUrl:URL,authenticate});\\n"+needle,1)
'''+s[end:]
 s=s.replace('0.1.0-rc3','0.1.0-rc4')
 s=s.replace('<script src="app.js"></script>', '<script src="auth-local.js"></script><script src="app.js"></script>')
 s=s.replace("['transport-store.js','app.js','pablicus.css'", "['transport-store.js','app.js','auth-local.js','pablicus.css'")
 p.write_text(s)
assert 'PablicusLogin.mount' in s and 'auth-local.js' in s and "magic=r'''" not in s
p=R/'finalize.py';s=p.read_text();s=s.replace("'version':'0.1.0-rc2'", "'version':json.loads((D/'version.json').read_text())['version']");p.write_text(s)
p=R/'src/sw.js';s=p.read_text()
if "'auth-local.js'" not in s:s=s.replace("'app.js','vendor/supabase.js'", "'app.js','auth-local.js','vendor/supabase.js'")
assert "'auth-local.js'" in s;p.write_text(s)
print('RC4_LOGIN_SOURCE_MIGRATED: build.py, finalize.py, src/sw.js')
