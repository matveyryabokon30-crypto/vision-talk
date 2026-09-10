# Current-main reconciliation

Initial inspected and locally built source: main `daa313cf2c490bde210beb871e1845768522b044`.

During candidate preparation main advanced to `2d801e16b7aba42f00fc298d4a9d832eda92aa28` (PR #37). That concurrent commit adds only `pablicus/bots.js`, `pablicus/bots.css`, `pablicus/bots-candidate.html` and `pablicus/BOT_CORE_UI_INTEGRATION.md`. It does not alter the main app.js/index.html, Auth, service worker or other runtime files that this builder inspects.

This candidate preserves the entire newer `pablicus` tree `bc3fd42a17aa8d8ec5f8c0da624529a586857b75` unchanged in its SOURCE, by a merge commit with that main revision as second parent. There are no conflicting edits to its files and no overwrite or force update of main. The existing new standalone module is not replaced or loaded by our panel. This candidate's module has the different names bots-client.js / bots-panel.js / bots-panel.css and is hooked into the full messenger only by the explicit offline builder.

The builder BASE_COMMIT records the originally verified shell snapshot; its per-file guards remain correct for the newer main because those files did not change. Running the builder on this branch will also carry through the four concurrent standalone additions without modification. The generated local archive is the full original verified shell plus this integrated module; it does not claim to be a byte-for-byte export of the entire GitHub repository. The four unrelated concurrently added standalone files remain in GitHub and are not required by the candidate runtime.

Tests and screenshots concern the new integrated modal, not the independently added standalone bots-candidate.html. No production deployment is performed by this branch. User confirmation is still required before any main messenger release.
