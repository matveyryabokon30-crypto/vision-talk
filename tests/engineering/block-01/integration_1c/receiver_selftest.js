/* Test-only recording wrappers forward to actual Chromium primitives. */
(() => {
  'use strict';
  const names = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'requestAnimationFrame', 'cancelAnimationFrame'];
  const original = Object.fromEntries(names.map(name => [name, window[name]]));
  const calls = [];
  window.__receiverProbe = {original, calls};
  for (const name of names) {
    window[name] = function (...args) {
      const record = {name, receiver_is_window: this === window,
        args: args.map(value => typeof value === 'function' ? '<function>' : value)};
      calls.push(record);
      const result = Reflect.apply(original[name], this, args);
      record.result_type = typeof result;
      record.result = result === undefined ? null : result;
      return result;
    };
  }
})();
