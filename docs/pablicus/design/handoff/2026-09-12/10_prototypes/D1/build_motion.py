from pathlib import Path
import html
P=Path(__file__).parent
(P/'motion').mkdir(exist_ok=True)
colors={'A':('#eef3f0','#142f29','#255e4c',22),'B':('#f6f2e9','#272b34','#304cad',4),'C':('#edf0f5','#172a45','#2449c8',8)}
for t,(bg,ink,ac,r) in colors.items():
 for kind,titles in [('object',['CHAT','OBJECT','EXPAND','WORKSPACE','FULLSCREEN','COLLAPSE','EXACT RETURN']),('composer',['DRAFT','KEYBOARD','ATTACHMENT','AI PROPOSAL','SEND']),('agent',['RUNNING','APPROVAL','APPLYING','RESULT'])]:
  w=len(titles)*190+20;v=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="380" viewBox="0 0 {w} 380"><rect width="100%" height="100%" fill="#fff"/><g font-family="Arial,sans-serif" fill="{ink}"><text x="20" y="24" font-size="15">{t} / {kind.upper()} · D1 STORYBOARD · static keyframes</text>']
  for i,title in enumerate(titles):
   x=20+i*190;v +=[f'<g transform="translate({x},45)"><rect width="165" height="275" rx="4" fill="{bg}" stroke="#aab7be"/><text x="10" y="24" font-size="11">Север / Выпуск</text>']
   def rect(y,h,label,color='white',rx=r):return f'<rect x="10" y="{y}" width="145" height="{h}" rx="{rx}" fill="{color}" stroke="{ac}"/><text x="19" y="{y+22}" font-size="10">{html.escape(label)}</text>'
   if kind=='object':
    v += ['<path d="M12 55h110M12 69h90M12 83h115M12 215h105" stroke="#aab7be"/>']
    geom=[(105,62),(105,62),(77,115),(55,180),(36,225),(90,95),(105,62)][i]
    v +=[rect(*geom,'wo-17 / v2' if i>=5 else 'wo-17 / v1')]
    if i in [2,3,5]:v +=[f'<path d="M6 105h153" stroke="{ac}" stroke-dasharray="3 3"/><text x="12" y="255" font-size="10">source anchor сохранён</text>']
    if i in [3,4]:v +=[f'<path d="M25 108h100M25 122h95M25 136h105" stroke="{ink}"/><text x="25" y="180" font-size="10">independent scroll ↕</text><text x="120" y="{geom[0]+20}" font-size="10">Close</text>']
    if t=='B':v +=[f'<path d="M14 {geom[0]+5}v{geom[1]-10}" stroke="{ink}" stroke-width="4"/>']
    if t=='C':v +=[f'<path d="M7 85v20h10" stroke="{ac}" stroke-width="2"/>']
    if i==6:v +=[rect(225,35,'draft d-17 / caret',bg,6)]
   elif kind=='composer':
    v +=['<path d="M12 55h110M12 69h95M12 90h90" stroke="#aab7be"/>']
    if i==0:v +=[rect(220,38,'draft d-17')]
    elif i==1:v +=[rect(135,40,'тот же draft'),rect(181,80,'SYSTEM KEYBOARD','#d9dfe4',0)]
    elif i==2:v +=[rect(100,50,'Север.mp4'),rect(165,40,'Добавить / Отмена'),rect(220,38,'draft сохранён')]
    elif i==3:v +=[rect(97,95,'proposal / undo'),rect(200,60,'Apply / Reject')]
    else:v +=[rect(100,55,'pending → delivered'),rect(220,38,'следующий draft')]
   else:
    v +=[rect(50,55,'Редактор / run-8')]
    captions=['Выполняется','Нужно ваше решение','Сохраняем v2','Результат сохранён']
    v +=[rect(120,95,captions[i])]
    v +=[f'<text x="19" y="167" font-size="10">{"Apply / Reject" if i==1 else "scope: wo-17"}</text>']
    if i==3:v +=[rect(225,35,'проверить результат')]
   v +=[f'<text x="0" y="302" font-size="11">{i+1:02} / {title}</text></g>']
  v+=['</g></svg>'];(P/'motion'/f'{t}-{kind}.svg').write_text(''.join(v))
p=P/'build_review.py';s=p.read_text();needle="parts += ['</div><p>Composer → keyboard"
replacement="parts += ['</div>'+''.join('<div class=\"widewrap\"><img src=\"motion/'+t+'-'+k+'.svg\" alt=\"Storyboard '+k+' '+t+'\"></div>' for k in ['object','composer','agent'])+'<p>Composer → keyboard"
assert needle in s
s=s.replace(needle,replacement);p.write_text(s)
