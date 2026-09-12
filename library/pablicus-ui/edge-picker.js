import { notchPath, clampPosition } from './notch-geometry.js';

/** Own browser controller. Contract: only selection; never an AI/service command. */
export function createEdgePicker({ host, bounds = host, items, selected, onSelect, edge = 'right' }) {
  if (!items.length || new Set(items.map(i => i.id)).size !== items.length) throw new Error('Unique views required');
  const abort = new AbortController();
  const listen = (el, event, fn) => el.addEventListener(event, fn, { signal: abort.signal });
  const box = document.createElement('aside');
  box.className = 'pb-edge';
  box.dataset.edge = edge;
  box.setAttribute('aria-label', 'Представление рабочего пространства');
  const trigger = document.createElement('button');
  trigger.type = 'button'; trigger.className = 'pb-edge-trigger';
  trigger.setAttribute('aria-label', 'Сменить представление');
  trigger.setAttribute('aria-expanded', 'false');
  const backdrop = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  backdrop.setAttribute('viewBox', '0 0 46 92'); backdrop.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(backdrop.namespaceURI, 'path');
  path.setAttribute('d', notchPath(46, 92)); backdrop.append(path);
  const mark = document.createElement('span'); mark.textContent = '≡'; mark.setAttribute('aria-hidden', 'true');
  trigger.append(backdrop, mark);
  const options = document.createElement('div'); options.className = 'pb-edge-options'; options.hidden = true;
  options.id = `pb-edge-${crypto.randomUUID()}`;
  trigger.setAttribute('aria-controls', options.id);
  options.setAttribute('role', 'group'); options.setAttribute('aria-label', 'Представление');
  const buttons = items.map(item => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = item.label; b.dataset.view = item.id;
    b.setAttribute('aria-pressed', String(item.id === selected));
    listen(b, 'click', () => { select(item.id); close(); onSelect(item.id); });
    options.append(b); return b;
  });
  box.append(options, trigger); host.append(box);
  let open = false, press = null, swallowClick = false;
  function place(y) {
    const region = bounds.getBoundingClientRect(), origin = host.getBoundingClientRect();
    const start = region.top - origin.top, h = region.height;
    const size = Math.min(92, Math.max(44, h - 16));
    box.style.height = trigger.style.height = `${size}px`;
    const top = start + clampPosition(y - start, h, size, 8);
    box.style.top = `${top}px`;
    options.style.maxHeight = `${Math.max(44, h - 16)}px`;
    if (open) options.style.top = `${start + clampPosition(top - start, h, options.offsetHeight, 8) - top}px`;
  }
  function close(returnFocus = true) {
    open = false; options.hidden = true; trigger.setAttribute('aria-expanded', 'false');
    if (returnFocus) trigger.focus({ preventScroll: true });
  }
  function select(id) {
    if (!items.some(i => i.id === id)) throw new RangeError('Unknown view');
    selected = id;
    buttons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === id)));
    trigger.title = items.find(i => i.id === id).label;
  }
  listen(trigger, 'click', () => {
    if (swallowClick) { swallowClick = false; return; }
    open = !open; options.hidden = !open; trigger.setAttribute('aria-expanded', String(open));
    if (open) { place(box.offsetTop); buttons.find(b => b.dataset.view === selected).focus({ preventScroll: true }); }
  });
  listen(box, 'keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (open && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault(); const at = buttons.indexOf(document.activeElement);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 :
        (at + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus({ preventScroll: true });
    }
  });
  listen(document, 'pointerdown', e => { if (open && !box.contains(e.target)) close(false); });
  listen(box, 'focusout', e => { if (open && !box.contains(e.relatedTarget)) close(false); });
  listen(trigger, 'pointerdown', e => {
    if (e.button !== 0) return;
    press = { id: e.pointerId, y: e.clientY, top: box.offsetTop, moved: false };
    swallowClick = false; trigger.setPointerCapture(e.pointerId);
  });
  listen(trigger, 'pointermove', e => {
    if (!press || e.pointerId !== press.id) return;
    const delta = e.clientY - press.y;
    if (Math.abs(delta) > 6) press.moved = true;
    if (press.moved) { close(false); place(press.top + delta); }
  });
  listen(trigger, 'pointerup', e => {
    if (!press || press.id !== e.pointerId) return;
    swallowClick = press.moved; press = null;
  });
  listen(trigger, 'pointercancel', () => {
    if (press) place(press.top);
    press = null; swallowClick = true; close(false);
  });
  const resize = new ResizeObserver(() => place(box.offsetTop || (host.clientHeight - box.offsetHeight) / 2));
  resize.observe(host); if (bounds !== host) resize.observe(bounds); select(selected);
  return { select, close, setEdge(value) { box.dataset.edge = value === 'left' ? 'left' : 'right'; },
    destroy() { abort.abort(); resize.disconnect(); box.remove(); } };
}
