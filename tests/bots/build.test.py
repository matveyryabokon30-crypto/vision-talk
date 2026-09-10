import unittest,tempfile,importlib.util,hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('builder',ROOT/'integrations/public-bots/build.py');builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
class BuildTests(unittest.TestCase):
 def test_build_and_preserve(self):
  source=ROOT/'pablicus'
  before={str(p.relative_to(source)):p.read_bytes() for p in source.rglob('*') if p.is_file()}
  with tempfile.TemporaryDirectory() as tmp:
   out=Path(tmp)/'candidate/pablicus';changes=builder.build(source,out)
   self.assertEqual({x['path'] for x in changes},{'pablicus/app.js','pablicus/index.html','pablicus/sw.js','pablicus/ASSET_MANIFEST.json','pablicus/bots-client.js','pablicus/bots-panel.js','pablicus/bots-panel.css'})
   self.assertEqual(before,{str(p.relative_to(source)):p.read_bytes() for p in source.rglob('*') if p.is_file()})
   manifest=json.loads((out/'ASSET_MANIFEST.json').read_text());self.assertTrue(all(hashlib.sha256((out/p).read_bytes()).hexdigest()==h for p,h in manifest.items()))
   for name in ['auth-local.js','auth-config.js','chat.js','rich-store.js','public-passkey.js','push-notifications.js','assets/icon-glass-20260909-180.png']:
    self.assertEqual((out/name).read_bytes(),before[name])
   script=(out/'app.js').read_text();original=before['app.js'].decode()
   # The ordinary message pump function and conversation opener are byte-identical.
   for first,last in [('async function openConversation','function mapped'),('async function pump','async function showOutbox')]:
    if first in original and last in original and original.find(last,original.index(first))>=0:
     a=original[original.index(first):original.index(last,original.index(first))]
     b=script[script.index(first):script.index(last,script.index(first))];self.assertEqual(a,b)
   self.assertLess((out/'index.html').read_text().index('bots-client.js'),(out/'index.html').read_text().index('bots-panel.js'))
   with self.assertRaises(RuntimeError):builder.build(source,out)
 def test_changed_host_refused(self):
  with tempfile.TemporaryDirectory() as tmp:
   s=Path(tmp)/'source';s.mkdir();(s/'app.js').write_text('changed')
   with self.assertRaises(RuntimeError):builder.build(s,Path(tmp)/'out')
 def test_no_external_execution(self):
  source=Path(__file__).resolve().parents[2]/'integrations/public-bots/build.py'
  text=source.read_text();self.assertNotIn('subprocess',text);self.assertNotIn('requests.',text)
if __name__=='__main__':unittest.main()
