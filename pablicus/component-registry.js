/* Block 2A: one inspectable UI contract registry. Declarations are not features. */
(function(root){
 'use strict';
 if(root.PablicusUI)throw Error('DUPLICATE_COMPONENT_REGISTRY');
 const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value};
 const components={
  AppShell:{owner:'PablicusShell',implementation:'app-shell.js',region:'#home / #app'},
  TopBar:{owner:'PablicusShell',implementation:'app-shell.js',region:'.homeHeader / #app > header'},
  BottomNavigation:{owner:'PablicusShell',implementation:'app-shell.js',region:'#mainNav'},
  'Tab/SegmentedControl':{owner:'view instance',implementation:'index.html',region:'#chatViewTabs / #chatFilters'},
  Button:{owner:'mounting view',implementation:'controls.css',contract:'semantic button, type, accessible name, focus-visible, disabled'},
  IconButton:{owner:'mounting view',implementation:'message-menu.js',contract:'shared icon, accessible name, 44px target'},
  Input:{owner:'mounting view',implementation:'index.html',contract:'label, input type, composition, error description'},
  Composer:{owner:'PablicusChat',implementation:'rich-composer.js',adapter:'chat.js'},
  SearchField:{owner:'search view',implementation:'chat-library.js',contract:'query state belongs to scoped search, not root navigation'},
  List:{owner:'mounted domain view',implementation:'chat-list-view.js',contract:'stable IDs, bounded lifecycle'},
  ListItem:{owner:'mounted domain view',implementation:'app.js',contract:'one explicit resource ID and action'},
  Avatar:{owner:'mounted domain view',implementation:'app.js',contract:'decorative initials or meaningful image alt'},
  Badge:{owner:'mounted domain view',implementation:'app.js',contract:'count meaning available without color'},
  Chip:{owner:'PablicusWorkspaceQuick',implementation:'workspace-quick.js'},
  Card:{owner:'mounted domain view',implementation:'bots.js',contract:'content owns local actions, never root shell'},
  Modal:{owner:'dialog instance',implementation:'index.html',contract:'native dialog, label, initial focus, escape, focus return'},
  Sheet:{owner:'sheet instance',implementation:'chat-canvas.js',contract:'bounded history entry, leave consent, focus return'},
  Toast:{owner:'app service',implementation:'app.js',region:'#toast',contract:'status, finite lifetime, no secret text'},
  EmptyState:{owner:'mounted domain view',implementation:'app.js'},
  LoadingState:{owner:'mounted domain view',implementation:'chat-canvas.js'},
  ErrorState:{owner:'mounted domain view',implementation:'chat-canvas.js',contract:'visible error and explicit retry; never fake success'},
  Menu:{owner:'menu instance',implementation:'message-menu.js',contract:'outside/keyboard listeners disposed with instance'},
  ContextMenu:{owner:'menu instance',implementation:'message-menu.js',contract:'no global navigation interception'},
  AgentTaskCard:{owner:'future agent view',status:'INTERFACE_ONLY',contract:'runId, initiator, status, cancel action; no executor'},
  PrivateAgentResult:{owner:'future result view',status:'INTERFACE_ONLY',contract:'resultId, scope, provenance, authorized actions; private by default'},
  ActionConfirmation:{owner:'future confirmation view',status:'INTERFACE_ONLY',contract:'exact action, parameters, revision, expiry; explicit confirm/cancel'},
  WorkObjectPreview:{owner:'object view',status:'INTERFACE_ONLY',contract:'objectId, revision, source, permitted actions; object is not message'},
  SidePanel:{owner:'PablicusShell',status:'INTERFACE_ONLY',contract:'desktop object surface; same object/route as FullScreenObjectView'},
  FullScreenObjectView:{owner:'PablicusShell',status:'INTERFACE_ONLY',contract:'mobile object surface, close guard, focus return, same object/route as SidePanel'}
 };
 const roots=[{id:'chats',label:'Чаты'},{id:'tasks',label:'Дела'},{id:'profile',label:'Вы'}];
 const parentRoots={chats:'chats',feed:'chats',tasks:'tasks',bots:'tasks',profile:'profile'};
 const informationArchitecture={
  Chats:{root:'chats',entry:'conversation list',state:'EXISTING'},
  Groups:{root:'chats',entry:'conversation directory',state:'CONTRACT_ONLY'},
  Channels:{root:'chats',entry:'conversation directory',state:'CONTRACT_ONLY'},
  Spaces:{root:'chats',entry:'space switcher / directory',state:'CONTRACT_ONLY',category:'A'},
  Threads:{root:'chats',entry:'within conversation',state:'CONTRACT_ONLY',category:'A'},
  Search:{root:'chats',entry:'search field / scoped results',state:'CONTRACT_ONLY_GLOBAL',category:'A'},
  Saved:{root:'chats',entry:'personal conversation / You shortcut',state:'EXISTING_SAVED_CONVERSATION_ONLY',category:'A'},
  AIConversations:{root:'chats',entry:'new private AI conversation',state:'CONTRACT_ONLY'},
  AIComposer:{root:'chats',entry:'composer contextual actions',state:'CONTRACT_ONLY',category:'A'},
  Profile:{root:'profile',entry:'profile and settings',state:'EXISTING'},
  PublicIdentity:{root:'profile',entry:'username / profile link',state:'EXISTING_BASELINE',category:'A'},
  Tasks:{root:'tasks',entry:'task list',state:'EXISTING'},
  WorkObjects:{root:'tasks',entry:'task / conversation Canvas object',state:'EXISTING_CANVAS_ONLY'},
  BotsFactory:{root:'tasks',entry:'nested tools entry',state:'EXISTING_SPECIFICATION_ONLY'}
 };
 const composer={
  version:1,implementation:'PablicusRichComposer.create',adapter:'PablicusChat',
  extensionPoints:['text','attachments','richBlocks','commands','aiInlineActions','mentions','agentInvocation','taskCreation','workObjectLinking'],
  existingOperations:['capture','restore','focus','blur','destroy'],
  context:['userId','conversationId','sessionGeneration','routeGeneration','revision','signal'],
  states:['idle','composing','saving','saved','sending','error','cancelled'],
  invariants:['original Blob retained','stable IDs and order','save before send','identity currentness','no silent unsupported operation'],
  extensionRequest:{fields:['kind','context','selection','payload'],result:['applied','cancelled','unsupported','error']},
  messageDocV2Implemented:false,agentExecutionImplemented:false,
  note:'Existing v1 draft/IndexedDB remains canonical. Future adapters validate context and permission before execution; declarations do not grant capabilities.'
 };
 const calls={category:'B',implemented:false,slots:['audioCallAction','videoCallAction','activeCallSurface','screenShareState','voiceLiveEntry'],
  context:['sessionId','conversationId','spaceId','participants','permissions','mediaState'],
  surface:'Non-root session overlay; independent from editor/list resource. Mobile full screen and desktop panel share session ID.',
  deferred:['WebRTC/TURN','background behavior','media security','cost','physical-device QA']};
 const tokenGroups={color:['--color-accent'],surface:['--surface-primary'],text:['--text-primary'],border:['--border-subtle'],
  radius:['--radius-control','--radius-pill'],spacing:['--space-1','--space-2','--space-3','--space-4','--space-6'],
  typography:['--font-family-ui','--font-body','--font-input','--line-height-body'],iconSizes:['--icon-size'],controlSizes:['--control-size'],
  elevation:['--elevation-overlay'],motion:['--motion-duration','--motion-easing'],safeArea:['--safe-area-top','--safe-area-bottom','--safe-area-left','--safe-area-right'],
  breakpoints:['--breakpoint-tablet','--breakpoint-desktop'],zIndex:['--layer-base','--layer-shell','--layer-popover','--layer-sheet','--layer-toast']};
 // Stateless native-control helpers. Mounting views retain state and listeners.
 function prepareControl(node,kind){
  if(!node)return node;
  const tag=node.tagName?.toLowerCase();
  if(!['button','input','textarea','select'].includes(tag))return node;
  node.dataset.uiControl=kind||(tag==='button'?'button':'input');
  if(tag==='button'&&!node.hasAttribute('type'))node.type='button';
  return node;
 }
 function tabKey(event,buttons){
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return false;
  const items=[...buttons].filter(n=>!n.disabled&&!n.hidden);
  if(!items.length)return false;
  const index=items.indexOf(event.target);if(index<0)return false;
  event.preventDefault();
  const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowRight'?1:items.length-1))%items.length;
  items[next].focus({preventScroll:true});items[next].click();return true;
 }
 function focusWithin(event,region){
  if(event.key!=='Tab')return false;
  const items=[...region.querySelectorAll('button,input,textarea,select,a[href],[tabindex]')].filter(n=>!n.disabled&&n.tabIndex>=0&&!n.closest('[hidden],[inert]')&&n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden');
  const first=items[0],last=items.at(-1);if(!first)return false;
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus({preventScroll:true});return true;}
  if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus({preventScroll:true});return true;}
  return false;
 }
 const controlContract={implementation:'native controls + controls.css',owner:'mounting view',minimumTargetToken:'--control-size',focusToken:'--focus-width',disabledToken:'--disabled-opacity',states:['idle','hover','focus-visible','active','disabled','busy','invalid'],rules:['native disabled prevents activation','accessible name supplied by view','no global listener or observer','tabs invoke existing owner action'],overlayRules:['initial focus','Escape/close through owner guard','focus return to connected opener','bounded scrolling and viewport']};
 function rootSection(section){return parentRoots[section]||null}
 function get(name){if(!Object.hasOwn(components,name))throw Error('UNKNOWN_COMPONENT: '+name);return components[name]}
 root.PablicusUI=freeze({version:1,components,roots,parentRoots,informationArchitecture,composer,calls,tokenGroups,controlContract,prepareControl,tabKey,focusWithin,get,rootSection});
})(window);
