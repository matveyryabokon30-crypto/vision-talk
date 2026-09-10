/* Visual editor for Bot Core flow v1. It edits safe declarative data only; Bot Core validates the complete flow again on save. */
(function(global){'use strict';
 const el=(t,c,x)=>{const n=document.createElement(t);if(c)n.className=c;if(x!==undefined)n.textContent=x;return n;};
 const clone=x=>JSON.parse(JSON.stringify(x));
 const labels={say:'Сообщение',ask:'Вопрос',choice:'Выбор',save:'Сохранение',end:'Финал'};
 function create({request}){
  let root=null,bot=null,back=null,draft=null,busy=false;
  const input=(value,max=4000)=>{const n=el('textarea','scenarioInput');n.value=value||'';n.maxLength=max;n.rows=3;return n;};
  const field=(title,node)=>{const w=el('label','scenarioField',title);w.append(node);return w;};
  function ordered(flow){const out=[],seen=new Set();let id=flow.start;for(let guard=0;id&&guard<64&&!seen.has(id);guard++){seen.add(id);out.push(id);const n=flow.nodes[id];if(!n)break;if(n.type==='choice'){for(const o of n.options||[])if(!seen.has(o.next))out.push(o.next);break;}id=n.next;}for(const id2 of Object.keys(flow.nodes))if(!seen.has(id2)&&!out.includes(id2))out.push(id2);return out;}
  function header(){const h=el('div','botsHeader'),b=el('button','botsBack','‹');b.type='button';b.onclick=()=>back?.();h.append(b,el('h2','','Сценарий'));root.append(h);}
  function render(){if(!root||!draft)return;root.replaceChildren();header();root.append(el('p','muted','Изменяйте тексты, вопросы, проверки и кнопки. Схема переходов сохраняется, поэтому существующий бот нельзя случайно сломать перестановкой шагов.'));
   const list=el('div','scenarioList');for(const id of ordered(draft))list.append(step(id,draft.nodes[id]));root.append(list);
   const bar=el('div','scenarioSaveBar'),save=el('button','solid','Сохранить сценарий'),state=el('p','muted');save.type='button';save.onclick=()=>saveFlow(save,state);bar.append(save,state);root.append(bar);
  }
  function step(id,n){const card=el('section','scenarioCard'),top=el('div','scenarioTop');top.append(el('strong','',labels[n.type]||n.type),el('span','scenarioId',id));card.append(top);
   if(['say','ask','choice','end'].includes(n.type)){const text=input(n.text);text.oninput=()=>n.text=text.value;card.append(field(n.type==='ask'?'Вопрос пользователю':n.type==='choice'?'Текст перед вариантами':n.type==='end'?'Финальное сообщение':'Сообщение',text));}
   if(n.type==='ask'){
    const validation=el('select','scenarioSelect');[['text','Текст'],['email','Электронная почта'],['phone','Телефон']].forEach(([v,x])=>{const o=el('option','',x);o.value=v;o.selected=n.validation===v;validation.append(o);});validation.onchange=()=>n.validation=validation.value;
    const key=el('input','scenarioSmall');key.value=n.field||'';key.maxLength=80;key.oninput=()=>n.field=key.value.trim();
    card.append(field('Что проверять',validation),field('Имя сохраняемого поля',key));
   }
   if(n.type==='choice'){
    const key=el('input','scenarioSmall');key.value=n.field||'';key.maxLength=80;key.oninput=()=>n.field=key.value.trim();card.append(field('Имя сохраняемого поля',key));
    const opts=el('div','scenarioOptions');(n.options||[]).forEach((o,i)=>{const row=el('label','scenarioOption'),inp=el('input','scenarioSmall');inp.value=o.label||'';inp.maxLength=120;inp.oninput=()=>o.label=inp.value;row.append(el('span','muted','Кнопка '+(i+1)),inp);opts.append(row);});card.append(opts);
   }
   if(n.type==='save')card.append(el('p','muted','На этом шаге Bot Core сохраняет собранные ответы в «Заявки».'));
   const nexts=n.type==='choice'?(n.options||[]).map(o=>o.next):n.next?[n.next]:[];if(nexts.length)card.append(el('p','scenarioNext','Далее: '+[...new Set(nexts)].join(', ')));
   return card;
  }
  async function saveFlow(button,state){if(busy)return;busy=true;button.disabled=true;state.className='muted';state.textContent='Проверяем и сохраняем…';try{const updated=await request('/v1/bots/'+bot.id,{method:'PATCH',data:{revision:bot.revision,flow:draft}});bot=updated;draft=clone(updated.flow);state.textContent='Сценарий сохранён. Новые диалоги будут использовать новую версию.';}catch(e){state.className='danger';state.textContent=e.message;}finally{busy=false;button.disabled=false;}}
  function mount(host,current,onBack){root=host;bot=current;back=onBack;draft=clone(current.flow);render();}
  return{mount};
 }
 global.PablicusBotScenarioEditor={create};
})(window);