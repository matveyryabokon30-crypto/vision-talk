from integration_case import asyncio, check, stage, A, B, C1, C2, CB, BOT, FILES, TEXT, TAIL, sha

async def run(a):
 await a.login();await a.conversation();before=await a.write();stored=await a.fp('stored')
 check('1C-ORIGINAL-FILES',[(f['name'],f['type'],f['size'],f['sha256']) for f in before['files']]==[(f['name'],f['mimeType'],len(f['buffer']),sha(f['buffer'])) for f in FILES],before)
 blocks=before['blocks'];block_ids=[b['id'] for b in blocks];file_ids=[f['id'] for f in before['files']]
 check('1C-DRAFT-STRUCTURE',all(block_ids) and len(set(block_ids))==len(block_ids) and all(file_ids) and len(set(file_ids))==len(file_ids) and [b['assetId'] for b in blocks if b['type']!='text']==file_ids and [b['text'] for b in blocks if b['type']=='text' and b['text']]==[TEXT,TAIL],{'owner':A,'conversation':C1,'blocks':blocks,'ordered_file_ids':file_ids})
 check('1C-DRAFT-BYTES',stored==before,{'live':before,'stored':stored})
 await a.canvas();await a.page.locator('#conversationTab').click();await a.back();await a.conversation(C2);await a.back();await a.conversation(C1)
 reopened=await a.fp();check('1C-DRAFT-REOPEN',reopened==before,{'before':before,'after':reopened})
 boot=await a.page.evaluate('vault.bootId');stage('actual same-origin page reload');await a.page.reload(wait_until='load');await a.wait('document.querySelectorAll(".chatCard").length>0');await a.conversation()
 after=await a.fp();stored=await a.fp('stored');newboot=await a.page.evaluate('vault.bootId')
 check('1C-DRAFT-RELOAD',boot!=newboot and after==before and stored==before,{'before':before,'after':after,'stored':stored,'old_boot':boot,'new_boot':newboot})
