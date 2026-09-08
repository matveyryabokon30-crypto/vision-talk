/* Compact, anchored actions for a message. No data mutations live in this UI module.
 * Icons adapted from Lucide, https://github.com/lucide-icons/lucide (ISC).
 * Copyright (c) 2026 Lucide Icons and Contributors.
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 *
 * Some Lucide icons derive from Feather (MIT), Copyright (c)
 * 2013-present Cole Bemis. Permission is hereby granted, free of charge, to
 * any person obtaining a copy of this software and associated documentation
 * files (the "Software"), to deal in the Software without restriction,
 * including without limitation the rights to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies of the Software, and
 * to permit persons to whom the Software is furnished to do so, subject to
 * the following conditions: The above copyright notice and this permission
 * notice shall be included in all copies or substantial portions of the
 * Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 * IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 * OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
 * USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
(function (scope) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const ICONS = {
    copy: [['rect', {width:14,height:14,x:8,y:8,rx:2,ry:2}], ['path', {d:'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'}]],
    pin: [['path', {d:'M12 17v5'}], ['path', {d:'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z'}]],
    forward: [['path', {d:'m15 17 5-5-5-5'}], ['path', {d:'M4 18v-2a4 4 0 0 1 4-4h12'}]],
    "reply": [["path",{"d":"M20 18v-2a4 4 0 0 0-4-4H4"}],["path",{"d":"m9 17-5-5 5-5"}]],
    "edit": [["path",{"d":"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"}],["path",{"d":"m15 5 4 4"}]],
    "select": [["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"m16 9-5.5 5.5L8 12"}]],
    "download": [["path",{"d":"M12 15V3"}],["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}],["path",{"d":"m7 10 5 5 5-5"}]],
    "search": [["path",{"d":"m21 21-4.34-4.34"}],["circle",{"cx":"11","cy":"11","r":"8"}]],
    "compose": [["path",{"d":"M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"}],["path",{"d":"M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"}]],
    "chats": [["path",{"d":"M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"}],["path",{"d":"M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1"}]],
    "feed": [["path",{"d":"M3 5h.01"}],["path",{"d":"M3 12h.01"}],["path",{"d":"M3 19h.01"}],["path",{"d":"M8 5h13"}],["path",{"d":"M8 12h13"}],["path",{"d":"M8 19h13"}]],
    "tasks": [["path",{"d":"M13 5h8"}],["path",{"d":"M13 12h8"}],["path",{"d":"M13 19h8"}],["path",{"d":"m3 17 2 2 4-4"}],["path",{"d":"m3 7 2 2 4-4"}]],
    "profile": [["circle",{"cx":"12","cy":"8","r":"5"}],["path",{"d":"M20 21a8 8 0 0 0-16 0"}]],
    "back": [["path",{"d":"m12 19-7-7 7-7"}],["path",{"d":"M19 12H5"}]],
    "plus": [["path",{"d":"M5 12h14"}],["path",{"d":"M12 5v14"}]],
    "microphone": [["path",{"d":"M12 19v3"}],["path",{"d":"M19 10v2a7 7 0 0 1-14 0v-2"}],["rect",{"x":"9","y":"2","width":"6","height":"13","rx":"3"}]],
    "send": [["path",{"d":"M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"}],["path",{"d":"m21.854 2.147-10.94 10.939"}]],
    "check": [["path",{"d":"M20 6 9 17l-5-5"}]],
    "close": [["path",{"d":"M18 6 6 18"}],["path",{"d":"m6 6 12 12"}]],
    "share": [["circle",{"cx":"18","cy":"5","r":"3"}],["circle",{"cx":"6","cy":"12","r":"3"}],["circle",{"cx":"18","cy":"19","r":"3"}],["line",{"x1":"8.59","x2":"15.42","y1":"13.51","y2":"17.49"}],["line",{"x1":"15.41","x2":"8.59","y1":"6.51","y2":"10.49"}]],
    "users": [["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["path",{"d":"M16 3.128a4 4 0 0 1 0 7.744"}],["path",{"d":"M22 21v-2a4 4 0 0 0-3-3.87"}],["circle",{"cx":"9","cy":"7","r":"4"}]],
    "delete": [["path",{"d":"M10 11v6"}],["path",{"d":"M14 11v6"}],["path",{"d":"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"}],["path",{"d":"M3 6h18"}],["path",{"d":"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"}]],
    "play": [["path",{"d":"M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"}]],
    "pause": [["rect",{"x":"14","y":"3","width":"5","height":"18","rx":"1"}],["rect",{"x":"5","y":"3","width":"5","height":"18","rx":"1"}]],
    "corner-up-left": [["path",{"d":"M20 20v-7a4 4 0 0 0-4-4H4"}],["path",{"d":"M9 14 4 9l5-5"}]],
  };

  function icon(name) {
    const document = scope.document;
    const svg = document.createElementNS(NS, 'svg');
    for (const [key, value] of Object.entries({viewBox:'0 0 24 24',width:20,height:20,fill:'none',stroke:'currentColor','stroke-width':1.7,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'})) svg.setAttribute(key,value);
    for (const [tag, attributes] of ICONS[name] || ICONS.reply) {
      const child = document.createElementNS(NS,tag);
      for (const [key,value] of Object.entries(attributes)) child.setAttribute(key,value);
      svg.append(child);
    }
    return svg;
  }

  function create(options = {}) {
    const document = scope.document;
    if (!document?.body) throw new Error('Для меню нужен DOM.');
    const node = (tag, className) => {
      const el = document.createElement(tag); el.className = className; return el;
    };
    const root = node('div', 'pablicusMessageMenu');
    root.hidden = true; root.setAttribute('aria-label','Действия с сообщением');
    root.setAttribute('popover','manual');
    const reactions = node('div', 'pmmReactions');
    reactions.setAttribute('role','group'); reactions.setAttribute('aria-label','Реакция на сообщение');
    const list = node('div', 'pmmActions'); list.setAttribute('role','menu'); list.setAttribute('aria-label','Действия с сообщением');
    const content = node('div','pmmContent'); content.hidden = true;
    root.append(reactions,content,list); document.body.append(root);
    let config = null, previousFocus = null, destroyed = false, opened = false, positionFrame = 0;
    let anchorAria = null, pointOffset = null;
    const viewport = () => {
      const vv = scope.visualViewport;
      return {left:vv?.offsetLeft || 0,top:vv?.offsetTop || 0,width:vv?.width || scope.innerWidth,height:vv?.height || scope.innerHeight};
    };
    const enabledButtons = () => [...root.querySelectorAll('button:not(:disabled)')];
    function position() {
      positionFrame = 0;
      if (!opened || !config) return;
      if (!config.anchor?.isConnected) { close({restoreFocus:false}); return; }
      const box = viewport(), gap = 8;
      const bounds = config.anchor.getBoundingClientRect();
      if(bounds.bottom < box.top || bounds.top > box.top+box.height) { close({restoreFocus:false}); return; }
      const px = pointOffset ? bounds.left+pointOffset.x : null;
      const py = pointOffset ? bounds.top+pointOffset.y : null;
      const width = Math.max(0, Math.min(config.content ? 300 : 220, box.width - gap*2));
      const maxHeight = Math.max(0,box.height - gap*2);
      root.style.width = width+'px'; root.style.maxHeight = maxHeight+'px';
      const height = Math.min(root.getBoundingClientRect().height,maxHeight);
      const insideTop = box.top+gap, insideBottom = box.top+box.height-gap;
      const targetTop = py !== null ? py : Math.max(insideTop,bounds.top);
      const targetBottom = py !== null ? py : Math.min(insideBottom,bounds.bottom);
      const below = insideBottom-targetBottom-gap, above = targetTop-insideTop-gap;
      let top = below >= height || below >= above ? targetBottom+gap : targetTop-height-gap;
      top = Math.max(insideTop,Math.min(top,insideBottom-height));
      let left = px !== null ? px-16 : bounds.left;
      left = Math.max(box.left+gap,Math.min(left,box.left+box.width-gap-width));
      root.style.left = left+'px'; root.style.top = top+'px';
    }
    function schedulePosition() {
      if (opened && !positionFrame) positionFrame = scope.requestAnimationFrame(position);
    }
    function close({restoreFocus = true} = {}) {
      if (!opened) return;
      opened = false;
      const anchor = config?.anchor, focus = previousFocus;
      if (positionFrame) scope.cancelAnimationFrame(positionFrame);
      positionFrame = 0;
      if (typeof root.hidePopover === 'function' && root.matches(':popover-open')) root.hidePopover();
      root.hidden = true;
      anchor?.classList.remove('pablicusMessageMenuAnchor');
      if (anchor && anchorAria) {
        for (const [key, value] of Object.entries(anchorAria)) {
          if (value === null) anchor.removeAttribute(key); else anchor.setAttribute(key,value);
        }
      }
      config = null; previousFocus = null; anchorAria = null; pointOffset = null;
      root.replaceChildren(reactions,content,list); reactions.replaceChildren(); content.replaceChildren(); content.hidden = true; list.replaceChildren();
      if (restoreFocus) {
        const target = focus?.isConnected ? focus : anchor?.isConnected ? anchor : null;
        target?.focus?.({preventScroll:true});
      }
    }
    async function invoke(callback, argument, errorHandler) {
      close({restoreFocus:false});
      try { await callback(argument); }
      catch (error) { if (typeof errorHandler === 'function') errorHandler(error); }
    }
    function open(next) {
      if (destroyed) throw new Error('Меню уже удалено.');
      if (!next?.anchor?.isConnected) return;
      if (opened) close({restoreFocus:false});
      config = next; previousFocus = document.activeElement;
      if(Number.isFinite(next.point?.x) && Number.isFinite(next.point?.y)) {
        const bounds=next.anchor.getBoundingClientRect(); pointOffset={x:next.point.x-bounds.left,y:next.point.y-bounds.top};
      }
      root.setAttribute('aria-label',next.title || 'Действия с сообщением');
      anchorAria = {'aria-expanded':next.anchor.getAttribute('aria-expanded'),'aria-haspopup':next.anchor.getAttribute('aria-haspopup')};
      next.anchor.setAttribute('aria-haspopup','menu'); next.anchor.setAttribute('aria-expanded','true');
      next.anchor.classList.add('pablicusMessageMenuAnchor');
      const onError = next.onError || options.onError;
      for (const item of Array.isArray(next.reactions) ? next.reactions : []) {
        if (typeof next.onReaction !== 'function') break;
        const value = typeof item === 'string' ? {id:item,emoji:item,label:item} : item;
        if (!value || typeof value.emoji !== 'string') continue;
        const button = node('button','pmmReaction'); button.type = 'button'; button.textContent = value.emoji;
        button.dataset.reactionId = String(value.id ?? value.emoji);
        button.setAttribute('aria-label',value.label || value.emoji);
        button.setAttribute('aria-pressed',value.selected ? 'true' : 'false');
        button.onclick = () => invoke(next.onReaction,value.id ?? value.emoji,onError);
        reactions.append(button);
      }
      reactions.hidden = !reactions.childElementCount;
      if (next.content?.nodeType === 1) { content.append(next.content); content.hidden = false; }
      for (const action of Array.isArray(next.actions) ? next.actions : []) {
        if (!action || typeof action.onSelect !== 'function') continue;
        const button = node('button','pmmAction'); button.type = 'button';
        button.setAttribute('role','menuitem'); button.dataset.action = String(action.id || '');
        if (action.danger) button.classList.add('pmmDanger');
        if (action.separator) button.classList.add('pmmSeparated');
        const label = node('span','pmmLabel'); label.textContent = action.label || '';
        button.append(icon(action.icon || action.id),label);
        button.onclick = () => invoke(action.onSelect,action.id,onError);
        list.append(button);
      }
      if (!list.childElementCount && !reactions.childElementCount && !content.childElementCount) {
        opened = true; close({restoreFocus:false}); return;
      }
      opened = true; root.hidden = false;
      if (typeof root.showPopover === 'function') root.showPopover();
      position();
      const first = content.querySelector('textarea,input,select,button,[tabindex="0"]') || list.querySelector('button') || reactions.querySelector('button');
      first?.focus({preventScroll:true});
      schedulePosition();
    }
    function onPointerDown(event) {
      if (opened && !root.contains(event.target)) close({restoreFocus:false});
    }
    function onKeyDown(event) {
      if (!opened) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (config.content) {
        if (event.key === 'Tab') {
          const controls = [...root.querySelectorAll('button:not(:disabled),textarea:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]')].filter(el=>!el.hidden);
          const first = controls[0], last = controls[controls.length-1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
        return;
      }
      if (event.key === 'Tab') { close({restoreFocus:false}); return; }
      const buttons = enabledButtons();
      if (!buttons.length) return;
      let index = buttons.indexOf(document.activeElement);
      if (['ArrowDown','ArrowRight'].includes(event.key)) index = (index+1)%buttons.length;
      else if (['ArrowUp','ArrowLeft'].includes(event.key)) index = (index-1+buttons.length)%buttons.length;
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = buttons.length-1;
      else return;
      event.preventDefault(); buttons[index].focus({preventScroll:true}); buttons[index].scrollIntoView({block:'nearest'});
    }
    function onScroll(event) {
      if (opened && !root.contains(event.target)) schedulePosition();
    }
    function destroy() {
      close({restoreFocus:false}); destroyed = true;
      document.removeEventListener('pointerdown',onPointerDown,true);
      document.removeEventListener('keydown',onKeyDown,true);
      document.removeEventListener('scroll',onScroll,true);
      scope.removeEventListener('resize',schedulePosition);
      scope.visualViewport?.removeEventListener('resize',schedulePosition);
      scope.visualViewport?.removeEventListener('scroll',schedulePosition);
      root.remove();
    }
    document.addEventListener('pointerdown',onPointerDown,true);
    document.addEventListener('keydown',onKeyDown,true);
    document.addEventListener('scroll',onScroll,true);
    scope.addEventListener('resize',schedulePosition);
    scope.visualViewport?.addEventListener('resize',schedulePosition);
    scope.visualViewport?.addEventListener('scroll',schedulePosition);
    return Object.freeze({open,close,destroy,get opened(){return opened;}});
  }
  scope.PablicusMessageMenu = Object.freeze({create,icon});
})(typeof window === 'undefined' ? globalThis : window);
