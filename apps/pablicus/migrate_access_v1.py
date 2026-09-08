"""One-time source migration; does not change auth settings, users or core UI."""
from pathlib import Path
R=Path(__file__).resolve().parent
p=R/'src/access.js';s=p.read_text()
# Correct the single source transcription error before any build is eligible.
old="$('error').textContent=failure(e))}"
if old in s:
 assert s.count(old)==1
 p.write_text(s.replace(old,"$('error').textContent=failure(e)}"))
p=R/'build.py';s=p.read_text()
marker="for n in ['access.html','access.js','access.css']:shutil.copy2(ROOT/'src'/n,OUT/n)"
if marker not in s:
 anchor="print('Built',len(list(OUT.rglob('*'))),'paths')"
 assert s.count(anchor)==1,'Build script changed; review required'
 p.write_text(s.replace(anchor,marker+'\n'+anchor))
print('Account access source and future build inputs ready; no deployment or account mutation performed')
