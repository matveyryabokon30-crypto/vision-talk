# Pablicus UI foundation · prototype API

Own browser library adapted from the selected open sources. Production `pablicus/` does not import this package yet.

```js
import { createEdgePicker } from './edge-picker.js';
const picker = createEdgePicker({
  host: workspace,        // positioned outer container, stable across views
  bounds: scrollRegion,  // excludes header, composer and bottom navigation
  items: [{id:'talk',label:'Разговор'},{id:'materials',label:'Материалы'}],
  selected: 'talk',
  onSelect(id) { showExistingView(id); },
  edge: 'right'
});
// picker.select(id), close(), setEdge('left'|'right'), destroy()
```

Load `foundation.css` once. It imports vendored SDS tokens and supplies the picker/button/form foundation. `notch-geometry.js` ports Codenotch path clamping and edge-coordinate transformation; see [notices](THIRD_PARTY_NOTICES.md). The state/event controller is Pablicus code, with native Pointer Events, keyboard operation, focus return, drag cancellation, bounded movement and listener cleanup.

Contract: `onSelect` is called by explicit selection only. Opening, moving or dismissing the control never selects another view. Do not attach an AI/service launch directly to view selection. `destroy()` is mandatory on unmount. `bounds` must identify a visible usable region; menu overflow is scrollable in a short viewport. CSS does not change the host's size or position.

Executable consumer: [new shell](../../prototypes/pablicus-next/index.html). Source research and scope: [design record](../../docs/pablicus/design/2026-09-13-new-foundation/SOURCE_RESEARCH.md). This is an initial verified foundation, not a complete published design system or a final approved Pablicus skin.
