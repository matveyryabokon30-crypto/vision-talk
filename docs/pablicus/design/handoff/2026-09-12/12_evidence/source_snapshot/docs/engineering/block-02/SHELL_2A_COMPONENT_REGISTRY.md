# Pablicus 2A — Component and Token Registry

Canonical runtime declaration: `pablicus/component-registry.js` (`PablicusUI`, version 1). A frozen declaration is not a working future feature. No component is mounted by the registry. Duplicate registration and unknown lookup fail explicitly.

## CURRENT STATE / TARGET STATE

Existing implementations remain mounted by their existing domain owner. The target is one shared interface per component with explicit context and lifecycle. Agent-oriented entries and new object surfaces are interface-only.

| Component | Owner | Existing implementation / status | Contract or region |
|---|---|---|---|
| AppShell | PablicusShell | app-shell.js | #home / #app |
| TopBar | PablicusShell | app-shell.js | .homeHeader / #app > header |
| BottomNavigation | PablicusShell | app-shell.js | #mainNav |
| Tab/SegmentedControl | view instance | index.html | #chatViewTabs / #chatFilters |
| Button | mounting view | index.html | semantic button, type, accessible name, focus-visible, disabled |
| IconButton | mounting view | message-menu.js | shared icon, accessible name, 44px target |
| Input | mounting view | index.html | label, input type, composition, error description |
| Composer | PablicusChat | rich-composer.js | chat.js |
| SearchField | search view | chat-library.js | query state belongs to scoped search, not root navigation |
| List | mounted domain view | chat-list-view.js | stable IDs, bounded lifecycle |
| ListItem | mounted domain view | app.js | one explicit resource ID and action |
| Avatar | mounted domain view | app.js | decorative initials or meaningful image alt |
| Badge | mounted domain view | app.js | count meaning available without color |
| Chip | PablicusWorkspaceQuick | workspace-quick.js | Bounded mounting lifecycle |
| Card | mounted domain view | bots.js | content owns local actions, never root shell |
| Modal | dialog instance | index.html | native dialog, label, initial focus, escape, focus return |
| Sheet | sheet instance | chat-canvas.js | bounded history entry, leave consent, focus return |
| Toast | app service | app.js | status, finite lifetime, no secret text |
| EmptyState | mounted domain view | app.js | Bounded mounting lifecycle |
| LoadingState | mounted domain view | chat-canvas.js | Bounded mounting lifecycle |
| ErrorState | mounted domain view | chat-canvas.js | visible error and explicit retry; never fake success |
| Menu | menu instance | message-menu.js | outside/keyboard listeners disposed with instance |
| ContextMenu | menu instance | message-menu.js | no global navigation interception |
| AgentTaskCard | future agent view | INTERFACE_ONLY | runId, initiator, status, cancel action; no executor |
| PrivateAgentResult | future result view | INTERFACE_ONLY | resultId, scope, provenance, authorized actions; private by default |
| ActionConfirmation | future confirmation view | INTERFACE_ONLY | exact action, parameters, revision, expiry; explicit confirm/cancel |
| WorkObjectPreview | object view | INTERFACE_ONLY | objectId, revision, source, permitted actions; object is not message |
| SidePanel | PablicusShell | INTERFACE_ONLY | desktop object surface; same object/route as FullScreenObjectView |
| FullScreenObjectView | PablicusShell | INTERFACE_ONLY | mobile object surface, close guard, focus return, same object/route as SidePanel |

## Design tokens

Single global source: `pablicus/design-tokens.css`. Existing palette/brand preserved. This qualifies the registry; it does not claim every historical component literal has been migrated.

| Group | Tokens |
|---|---|
| color | `--color-accent` |
| surface | `--surface-primary` |
| text | `--text-primary` |
| border | `--border-subtle` |
| radius | `--radius-control`, `--radius-pill` |
| spacing | `--space-1`, `--space-2`, `--space-3`, `--space-4`, `--space-6` |
| typography | `--font-family-ui`, `--font-body`, `--font-input`, `--line-height-body` |
| iconSizes | `--icon-size` |
| controlSizes | `--control-size` |
| elevation | `--elevation-overlay` |
| motion | `--motion-duration`, `--motion-easing` |
| safeArea | `--safe-area-top`, `--safe-area-bottom`, `--safe-area-left`, `--safe-area-right` |
| breakpoints | `--breakpoint-tablet`, `--breakpoint-desktop` |
| zIndex | `--layer-base`, `--layer-shell`, `--layer-popover`, `--layer-sheet`, `--layer-toast` |

## Composer contract

```json
{
  "version": 1,
  "implementation": "PablicusRichComposer.create",
  "adapter": "PablicusChat",
  "extensionPoints": [
    "text",
    "attachments",
    "richBlocks",
    "commands",
    "aiInlineActions",
    "mentions",
    "agentInvocation",
    "taskCreation",
    "workObjectLinking"
  ],
  "existingOperations": [
    "capture",
    "restore",
    "focus",
    "blur",
    "destroy"
  ],
  "context": [
    "userId",
    "conversationId",
    "sessionGeneration",
    "routeGeneration",
    "revision",
    "signal"
  ],
  "states": [
    "idle",
    "composing",
    "saving",
    "saved",
    "sending",
    "error",
    "cancelled"
  ],
  "invariants": [
    "original Blob retained",
    "stable IDs and order",
    "save before send",
    "identity currentness",
    "no silent unsupported operation"
  ],
  "extensionRequest": {
    "fields": [
      "kind",
      "context",
      "selection",
      "payload"
    ],
    "result": [
      "applied",
      "cancelled",
      "unsupported",
      "error"
    ]
  },
  "messageDocV2Implemented": false,
  "agentExecutionImplemented": false,
  "note": "Existing v1 draft/IndexedDB remains canonical. Future adapters validate context and permission before execution; declarations do not grant capabilities."
}
```

## Information architecture

```json
{
  "roots": [
    {
      "id": "chats",
      "label": "Чаты"
    },
    {
      "id": "tasks",
      "label": "Дела"
    },
    {
      "id": "profile",
      "label": "Вы"
    }
  ],
  "parentRoots": {
    "chats": "chats",
    "feed": "chats",
    "tasks": "tasks",
    "bots": "tasks",
    "profile": "profile"
  },
  "entries": {
    "Chats": {
      "root": "chats",
      "entry": "conversation list",
      "state": "EXISTING"
    },
    "Groups": {
      "root": "chats",
      "entry": "conversation directory",
      "state": "CONTRACT_ONLY"
    },
    "Channels": {
      "root": "chats",
      "entry": "conversation directory",
      "state": "CONTRACT_ONLY"
    },
    "Spaces": {
      "root": "chats",
      "entry": "space switcher / directory",
      "state": "CONTRACT_ONLY",
      "category": "A"
    },
    "Threads": {
      "root": "chats",
      "entry": "within conversation",
      "state": "CONTRACT_ONLY",
      "category": "A"
    },
    "Search": {
      "root": "chats",
      "entry": "search field / scoped results",
      "state": "CONTRACT_ONLY_GLOBAL",
      "category": "A"
    },
    "Saved": {
      "root": "chats",
      "entry": "personal conversation / You shortcut",
      "state": "EXISTING_SAVED_CONVERSATION_ONLY",
      "category": "A"
    },
    "AIConversations": {
      "root": "chats",
      "entry": "new private AI conversation",
      "state": "CONTRACT_ONLY"
    },
    "AIComposer": {
      "root": "chats",
      "entry": "composer contextual actions",
      "state": "CONTRACT_ONLY",
      "category": "A"
    },
    "Profile": {
      "root": "profile",
      "entry": "profile and settings",
      "state": "EXISTING"
    },
    "PublicIdentity": {
      "root": "profile",
      "entry": "username / profile link",
      "state": "EXISTING_BASELINE",
      "category": "A"
    },
    "Tasks": {
      "root": "tasks",
      "entry": "task list",
      "state": "EXISTING"
    },
    "WorkObjects": {
      "root": "tasks",
      "entry": "task / conversation Canvas object",
      "state": "EXISTING_CANVAS_ONLY"
    },
    "BotsFactory": {
      "root": "tasks",
      "entry": "nested tools entry",
      "state": "EXISTING_SPECIFICATION_ONLY"
    }
  }
}
```

## Calls readiness — CATEGORY_B / no implementation

```json
{
  "category": "B",
  "implemented": false,
  "slots": [
    "audioCallAction",
    "videoCallAction",
    "activeCallSurface",
    "screenShareState",
    "voiceLiveEntry"
  ],
  "context": [
    "sessionId",
    "conversationId",
    "spaceId",
    "participants",
    "permissions",
    "mediaState"
  ],
  "surface": "Non-root session overlay; independent from editor/list resource. Mobile full screen and desktop panel share session ID.",
  "deferred": [
    "WebRTC/TURN",
    "background behavior",
    "media security",
    "cost",
    "physical-device QA"
  ]
}
```

## MIGRATION ACTIONS

Shared heading/layout and root projection are extracted into the shell, without remounting duplicate component instances. RichComposer remains the editor implementation; Chat and WorkspaceEditor remain adapters. Each future mounted component must declare its region, route/resource/user context, abort/dispose ownership, focus behavior and permitted actions. Compatibility code cannot reorder shared DOM, intercept root navigation or install a repair observer.

## DEFERRED TO LATER BLOCK 2

Full common-component adoption, component-specific token migration, comprehensive keyboard/screen-reader/overlay qualification and actual physical mobile review. CATEGORY_A IA declarations must become qualified capabilities under subsequent approved execution.

## DEFERRED TO BLOCK 3

MessageDoc v2, rich-object document semantics and interactive-message implementations.

## DEFERRED TO BLOCK 5

Agent/AI execution, real service factory, marketplace and commerce. AgentTaskCard, PrivateAgentResult and ActionConfirmation describe UI boundaries only.
