# WebUI TUI-Harness migration plan

Migration of `packages/webui/` to a TUI-driven backend over the desktop
application's visual language. The WebUI is currently a half-finished client
that uses a `runtimeOwnerKind: 'cli'` harness host; this plan changes it to use
the TUI identity (so the harness renders the TUI system prompt and command
semantics), and builds out the client surface against the desktop design
tokens and the desktop visual reference.

The repository already locks in the boundaries:

- [ADR 0001](../adr/0001-webui-is-a-peer-client-of-the-harness.md): the WebUI
  is a peer client of the harness layer (`@mavis/local-runtime-v2`), not a CLI
  wrapper.
- [ADR 0003](../adr/0003-no-dependency-on-tui-internals.md): the WebUI may
  **read** the terminal client's code as a reference but must not **import** it;
  it must write its own narrow adapter.
- [ADR 0009](../adr/0009-webui-reuses-the-desktop-visual-language.md): the
  WebUI reuses the desktop application's design tokens.
- [0003-amendment-shared-event-corpus](0003-amendment-shared-event-corpus.md):
  the WebUI re-implements TUI's projection logic independently; both clients
  rely on a shared event-corpus fixture in `@mavis/local-runtime-v2` to stay
  aligned with the harness event protocol rather than copying each other.
- [webui-visual-language.md](webui-visual-language.md) defines the tokens,
  theme mechanism, typography and layout rules the WebUI already adopts.

This document fills in what those ADRs leave unspecified: **which** terminal
client behaviour we mirror, **which** visual assets we lift from the desktop
build, and **in what order**.

## How this plan was reviewed

This document is the result of a two-reviewer cross-audit:

- **codex luna** (`codex/gpt-5.6-luna`): review captured in
  [review-brief-original-requirement.md](review-brief-original-requirement.md)
  and the conversation log on the day this plan was written.
- **hermes deepseek v4.1** (`hermes/opencode-go:deepseek-v4.1-flash`):
  review captured in the same conversation log.

The plan addresses every BLOCKER, MAJOR and MINOR flagged by either reviewer.
Where a reviewer pushed back on a substantive design choice (for example the
"WebUI mirrors TUI projection logic" framing), the response was a deliberate
re-design recorded in the relevant ADR amendment, not a paragraph rewrite in
this plan. NITs were resolved in passing.

Specific reviewer-driven changes include: corrected verification gates (root
scripts, not `--filter webui`); a corrected description of what
`runtimeOwnerKind: 'tui'` actually enables at four product-policy sites
including `contentReviewEnabled` for the `cn` region; corrected path
references for permission/questionnaire projection (the actual reference is
`packages/tui/src/tui/controller/runtime/runtime-state-coordinator.ts`,
lines 27-50; the originally cited
`packages/tui/src/tui/controller/chat-controller-support.ts:134` is inside
`requiresQueueFallback`, a session-busy code predicate that has nothing to do
with permission or questionnaire state); corrected KaTeX font count (60
files, not 30); corrected `requestCompaction` port shape (single-object
form, not three positional arguments); narrowed data-directory scope to
read-only display; added `test/vitest-suites.json` registration for every
new test file; added a lockfile-update step for the new `katex` dependency;
made the phase boundaries self-consistent.

## Scope

| Category | Decision |
| --- | --- |
| Backend identity | `runtimeOwnerKind: 'tui'` (was `'cli'`). Drives `promptProfile: 'tui'` → `_v2/tui/SYSTEM.md.hbs` and `tuiProductPolicy` at four sites in `@mavis/local-runtime-v2`. |
| Command system | Mirror the runtime-independent descriptors in `packages/tui/src/application/command-descriptors.ts`. Six commands: `help`, `new`, `compact`, `status`, `usage`, `model`. Skip `doctor`, `context`, `skills`, `mcp`, `export` (TUI-only or session-output-only). |
| Compaction | Carry over the `/compact` command and `session.compaction.{started,completed,failed}` projection. Wire to a new `requestCompaction` server operation that calls the harness with the single-object shape `CliService` expects. |
| Usage / context | Carry over the context-window visualization and the session usage view. |
| Questionnaire / permission | Carry over the projection logic from `packages/tui/src/tui/controller/runtime/runtime-state-coordinator.ts:27-50` (`permission.ask` / `permission.resolved` / `questionnaire.ask` event handling) and `packages/tui/src/runtime/event-normalizer.ts:19-30` (event-shape normalisation). Both are re-implemented locally; the **shared event corpus** described in the ADR amendment is the conformance surface. |
| Visual asset scope | Image assets (27 PNG/JPG) and KaTeX font faces (60 files / 2.2 MB / 20 each of `.ttf` / `.woff` / `.woff2`, content-hashed, in `../minimax-webui/app/out/_next/static/media/KaTeX_*`) are checked in. CSS compiled product (548 KB / 25 minified files in `../minimax-webui/app/out/_next/static/css/`) and Next.js chunks (37 MB in `_next/static/chunks/`) are not. |
| Pages | Re-author four pages against the visual language: `/login`, `/onboarding`, `/archon`, `/404`. Defer `/archon-mini-chat`, `/log-viewer`, `/pdf`, `/doc`, `/docx`. |
| Settings | Modal inside `/archon` (route unchanged). Cover: `general` (theme, language), `appearance` (font size, density), `account` (login state, sign out), `account-onboarding`, `model` (model selection, thinking level, context control). **Reduced scope:** data-directory section is **read-only** display of the current path; relocation is deferred. Skip desktop-only items: `shortcut`, `notification`, `tray`, `run-on-startup`, `power-save-blocker`, `Computer Use toggle`. |
| KaTeX | Wire `katex` into `markdown.tsx` so `$...$` / `$$...$$` render. Fonts come from `../minimax-webui/app/out/_next/static/media/` (verified today: 20 `.ttf`, 20 `.woff`, 20 `.woff2`, total 2.2 MB). `katex` is added as a runtime dependency; `release/dependency-licenses.json` records its MIT license. The CSS is integrated via `postcss-import` against the single ADR-0010 stylesheet, not a second `<link>` in `index.html`. |

The visual asset rules above are consistent with
[`webui-visual-language.md`](webui-visual-language.md), which already
establishes that the WebUI reuses the desktop tokens by re-authoring them
rather than copying the compiled product. The 548 KB / 25-file CSS product
size was re-measured on this branch and is unchanged from the figure cited in
the visual-language doc's note about a 235 KB main file: the latter is the
single largest file, the former is the directory total. Both are reported as
**observed figures** that may shift with future desktop extractions.

## Out of scope (left to later milestones)

- **Data-directory relocation.** The desktop settings IPC has
  `DESKTOP_GET_LOCAL_RUNTIME_DATA_DIR_INFO` and
  `DESKTOP_RELOCATE_LOCAL_RUNTIME_DATA_DIR` handlers
  (`../minimax-webui/app/dist/main/ipc/settings.ipc.js:347-385`); these do
  not exist in `@mavis/local-runtime-v2` and re-implementing them is more
  work than fits this milestone. v1 shows the current path only.
- Global shortcut binding, system notifications, tray, run-on-startup,
  power-save-blocker, Computer Use toggle: all desktop-only and irrelevant in
  a browser tab.
- `archon-mini-chat`, `log-viewer`, `pdf` / `doc` / `docx` preview pages:
  deferred.
- A standalone `/settings` route: not needed while the modal lives inside
  `/archon`.
- Resumption of the desktop build's OAuth callback via `minimax://` deeplink:
  inherited limitation; the WebUI continues to read the credential file
  directly via `packages/webui/src/server/auth-context.ts`.

## How the WebUI gains built-in tools and skills

This question was raised during plan review. The answer is that the WebUI
**already** has built-in tools and skills without further work, because they
live entirely in the harness layer:

| Concern | Where it lives |
| --- | --- |
| Builtin tool ID list | `@mavis/config` — `packages/config/src/agent-capabilities.ts:1-14` (`AGENT_BUILTIN_TOOL_IDS` includes `read`, `write`, `edit`, `bash`, `grep`, `glob`, `web_fetch`, etc.) |
| Builtin MCP tool ID list | `@mavis/config` — `packages/config/src/agent-capabilities.ts:23-...` (`AGENT_BUILTIN_MCP_TOOL_IDS` includes `images_understand`, `gen_videos`, etc.) |
| Tool implementations | `@mavis/agent-tools` — `packages/agent-tools/src/desktop/local-{bash,grep,glob,read,write,edit,web-search,webfetch,skill,task,...}.ts` |
| Skill registry and loaders | `@mavis/agent-modules/skills` — `packages/agent-modules/skills/src/{registry,types,directory-watcher}.ts` |
| Builtin skill `SkillSourceKind` | `@mavis/agent-modules/skills` — `packages/agent-modules/skills/src/types.ts:1` includes `'builtin'` |
| Tool and skill catalog assembly | `@mavis/local-runtime-v2` — `packages/local-runtime-v2/src/service/turn-system/agent-host/assembly/local-turn-tool-catalog.ts:455-470` |
| Capability config (`persona` / `tools` / `builtinTools` / `skills` / `features`) | `@mavis/local-runtime-v2` — `packages/local-runtime-v2/src/service/turn-system/agent-host/preparation/config/local-agent-config-builder.ts:646-651` |
| WebUI side today | `packages/webui/src/server/assembly.ts:174-179` declares only the four interaction capabilities (`cliEmbedded`, `questionnaireReply`, `permissionPrompt`, `elicitation`). It does **not** declare `tools`, `builtinTools` or `skills`; the harness applies its defaults, which include the full builtin set. |

The TUI today (`packages/tui/src/runtime/embedded-host.ts:90-93`) does the
same thing under a different shape: it spreads
`runtimeOptions.capabilities` into the harness host options. The two
clients **do not maintain their own tool or skill lists**. The harness is
the only place those lists are declared and implemented.

There is no tool-or-skill settings UI in the desktop settings modal either
(`../minimax-webui/app/out/_next/static/chunks/app/(pages)/(mavis)/archon/page-*.js`
exposes only `general`, `appearance`, `account`, `account-onboarding`,
`model`), so the locked-in settings scope covers everything that exists.
The plan therefore adds no new tool-or-skill settings UI.

**Advisory for plan C4:** the WebUI's
`WebuiForwardedRuntimeHostOptions.capabilities` type
(`packages/webui/src/server/assembly.ts:174-179`) should add **placeholder
fields** `tools?: readonly string[]`, `builtinTools?: readonly
AgentBuiltinMcpToolId[]`, `skills?: readonly string[]`, `features?: {
mavis: boolean; delegation: boolean; webSearch: boolean }` so that future
settings work extends the harness's shape rather than the TUI's shape.
Even when `undefined`, declaring the fields communicates intent and keeps
the WebUI symmetric with the harness contract.

## Backend migration: TUI identity, command catalogue, event projections

The backend work lands in three steps, plus a phase-zero precondition.

### Phase zero — Inventory pre-step

**Why this is needed first.** `release/public-source.json` is currently
**stale on this branch** (verified by running `node
scripts/source-inventory.mjs` without `--write`): it still lists the
pre-`docs/webui/`-move paths. Until the inventory is committed,
`pnpm check:source` is red on the reviewed commit, and no later gate can
be green.

**Action.** Regenerate the inventory before any plan change:

   ```
   node scripts/source-inventory.mjs --write
   ```

Review the diff. The two moved docs (`docs/webui-visual-language.md` →
`docs/webui/webui-visual-language.md`, `docs/webui-v1-scope.md` →
`docs/webui/webui-v1-scope.md`), this new plan, and the new ADR amendment
must be present. Commit the inventory alongside the plan in the same
review.

### Step B1 — Switch the runtime owner identity to TUI

**Files**

- `packages/webui/src/server/assembly.ts` — change `runtimeOwnerKind`
  literal from `"cli"` to `"tui"` (lines 170, 292); widen the
  `WebuiForwardedRuntimeHostOptions.runtimeOwnerKind` type from the
  literal `"cli"` to `"cli" | "tui"`.
- `packages/webui/test/unit/webui-service.test.ts` — update the assertion
  at line 1618 (`expect(lastOptions?.runtimeOwnerKind).toBe("cli")`) to
  `toBe("tui")` and the comment at line 1735 referencing
  `runtimeOwnerKind: 'cli'`. Add a regression test for the
  `isCommandLineRuntimeOwner` branch in `profile-source.ts:52-53` so the
  memory-disabled / cron-disabled invariant is asserted on the
  WebUI-shaped options.

**Effect on the harness**

- `runtimeOwnerKind: 'tui'` selects `promptProfile: 'tui'` →
  `_v2/tui/SYSTEM.md.hbs` is loaded for the primary agent
  (`packages/local-runtime-v2/src/service/agent/builtin/catalog.ts:605-606`,
  `609-615`).
- `runtimeOwnerKind === 'tui'` **also enables `tuiProductPolicy`** at four
  composition sites in `@mavis/local-runtime-v2`. The plan must own this,
  because the policy turns on without further configuration:
  - `packages/local-runtime-v2/src/services.ts:764` —
    `createGoalEvaluatorVerifier({ tuiProductPolicy: true })`.
  - `packages/local-runtime-v2/src/services.ts:1002-1004` —
    `tuiProductPolicy: true` and `contentReviewEnabled:
    getRuntimeRegion() === "cn"`. **In the `cn` region this turns on
    content review for every WebUI session.**
  - `packages/local-runtime-v2/src/application/session/runtime-session-composition.ts:103,123,134,240,259`
    — `tuiProductPolicy` is read to set
    `implicitCustomProviderThinking`.
  - `packages/local-runtime-v2/src/application/agent/runtime-agent-product.ts:167`
    — `tuiProductPolicy: runtimeOwnerKind === 'tui'`.
- Verified non-effects, so the plan does not change them: `agent-prompt-surface.ts:31`
  maps both `'cli'` and `'tui'` to surface `'cli'`
  (`packages/local-runtime-v2/src/service/turn-system/agent-host/preparation/agent-prompt-surface.ts:31`),
  and `profile-source.ts:52-53` keeps memory and cron disabled for both
  owners. The persona line in `_v2/tui/SYSTEM.md.hbs` is rendered only when
  `persona.enabled` is true, so the visual check below is conditional on
  that flag.
- `capabilityProfile: 'cli'` stays; only the owner identity changes.

**Decision on the product policy.** The locked brief says "backend logic
from TUI". Switching the owner identity is the mechanism for that, and the
`tuiProductPolicy` flags are an inseparable consequence. The plan accepts
this: the WebUI v1 inherits the same TUI product semantics as the
terminal client. If a future milestone wants the WebUI to opt out of one
of the flags (e.g. to disable content review in `cn`), it must propose a
new code path in `@mavis/local-runtime-v2`; the WebUI does not own this.

**Verification**

- `pnpm typecheck:webui` — confirms the literal and type widen cleanly.
- `pnpm test:webui` — runs `webui-service.test.ts` with the updated
  expectation and the new memory/cron regression test.
- Boot the WebUI against a managed MiniMax login and a session in coding
  mode. Inspect the rendered system prompt. With `persona.enabled` true,
  the first line must read "You are a coding agent running in the MiniMax
  Code terminal, developed by MiniMax" (the persona header from
  `_v2/tui/SYSTEM.md.hbs:2`). If `persona.enabled` is false, the check is
  vacuous; flag that explicitly in the PR description.
- `pnpm check:webui-boundary` and `pnpm check:source` — must be green
  after the phase-zero inventory step.

### Step B2 — Command catalogue

**Goal.** Expose a WebUI-callable command surface that mirrors the
runtime-independent descriptors in
`packages/tui/src/application/command-descriptors.ts`, without importing
that file. The descriptor shape used by TUI is exactly
`{ readonly name: string; readonly description: string }` (lines 1-4); the
WebUI re-declares this shape verbatim with no additional fields. Adding
argument schemas, help groups or alias maps is out of scope.

**Locked selection.** Six commands: `help`, `new`, `compact`, `status`,
`usage`, `model`. Skipped: `doctor`, `context`, `skills`, `mcp`, `export`
(TUI-only maintenance commands and session-output commands that do not
fit a browser tool palette).

**New files**

- `packages/webui/src/server/commands/descriptors.ts`

  Pure data: six descriptors with the same shape as
  `TuiCommandDescriptor`. No additional fields.
- `packages/webui/src/server/commands/runner.ts`

  Routes a `{ command, input, sessionId }` request through the
  process-local harness service that the WebUI host exposes. The harness
  is **not** a CLI binary and **not** the ACP adapter (ADR 0001).

  Per command:

  - `help`: returns the catalogue; no runtime call.
  - `new`: `createSession` with an explicit `workspaceDir` carried from
    the caller (refusing implicit workspaces per
    [v1-scope step 8](webui-v1-scope.md#wiring-additive-edits-to-existing-files)).
  - `compact`: `requestCompaction(sessionId, agentName, input ||
    undefined)`. The `requestCompaction` call shape on `CliService` is a
    **single object** `{ name, id, reason: 'ui_request',
    customInstructions }` (see
    `packages/tui/test/unit/tui-runtime-adapter.test.ts:339-344`). The
    runner constructs that object. It surfaces
    `NOTHING_TO_COMPACT` / `unchanged` as
    `{ handled: true, output: 'No compaction is needed for this
    conversation yet.' }` and other failures as `runtimeRejected` with the
    original error code.
  - `status`: `getSession(request)`; output reuses the labels in
    `packages/tui/src/tui/transcript/status-visualization.ts:72` for
    `Model` and `Workspace`. The `context-visualization.ts:20` label map
    is **not** the source for this command (it is for transcript-context
    rendering and labels `MEMORY` / `TOOLS` / `SKILLS` / `MESSAGES` /
    `OTHER`, not `Model` / `Workspace`).
  - `usage`: `getSessionUsage(request)`; output reuses the token / cost /
    cache layout from
    `packages/tui/src/tui/transcript/context-visualization.ts:136,274`.
  - `model`: `listModels` for completion, `selectModel` for switching.
    The input parser mirrors `resolveModelSelection` at
    `packages/tui/src/acp/commands.ts:375-...` (line 193 is the call
    site, not the definition). ADR 0001 note: the reference is the
    semantics of `resolveModelSelection`, **not** the ACP adapter as a
    code dependency. The harness-level `listModels` / `selectModel`
    calls are the WebUI's seam.

**Wired into the WebUI transport**

- `packages/webui/src/server/operations.ts` gains a `runCommand`
  operation that delegates to `commands/runner.ts`. Reuses the existing
  operation-registry pattern; no new envelope kind.
- `packages/webui/src/server/port.ts` gains
  `WebuiRunCommandRequest` and `WebuiRunCommandResult` types and a
  new `requestCompaction` port method (the WebUI currently has no
  compaction port at all). `packages/webui/src/server/host.ts` forwards
  it from the `CliService` shape.
- `packages/webui/src/client/transport.ts` gains a `runCommand` client
  method. Uses the existing request / response / error frame kind; the
  envelope schema in `packages/webui/src/server/envelope.ts` does not
  change.

**This step changes the client.** The plan's earlier draft said phase 2
ships "without a client change". That was wrong: `client/transport.ts`
gains `runCommand`, which is a client-side change. Phase 2 ships with the
client wiring landed in the same commit as the server operation. The
phase table at the end of this document reflects the corrected boundary.

**Verification**

- `packages/webui/test/unit/commands.test.ts` — covers each of the six
  commands against a stub `CliService` mirroring the tui app tests'
  fixtures (`packages/tui/test/unit/tui-runtime-adapter.test.ts:312-340`).
  Tests must include: `NOTHING_TO_COMPACT` mapping; `runtimeRejected`
  mapping; `requestCompaction` single-object call shape; malformed
  command handling; unknown command rejection by the operation
  registry.
- `packages/webui/test/unit/transport-frame.test.ts` (new) — covers
  the `runCommand` request / response / error framing on the client
  transport. The existing `webui-stream.test.ts:344` probe is a
  reducer-fixture contract, not a transport test, and remains.
- Register both new test files in the `webui` group of
  `test/vitest-suites.json` (`scripts/lib/vitest-suites.mjs:42-51`
  enforces membership; without registration `check:source` fails).
- `pnpm test:webui`, `pnpm typecheck:webui`, `pnpm build:webui`,
  `pnpm check:webui-boundary`.

### Step B3 — Event projections

**Goal.** Mirror the runtime-event projections the TUI consumes, in
particular the compaction projection, the permission / questionnaire
projection and the usage projection, so the WebSocket event stream can
drive the client state machines. The shared event corpus described in
the ADR amendment is the conformance surface.

**New files**

- `packages/webui/src/server/projections/context-snapshot.ts`

  Reads `SessionStreamFrame` messages and produces a
  `WebuiContextSnapshotResponse` carrying `compaction.state`,
  `compaction.lastAt`, `usage`, `window`, `usedTokens`,
  `compactionThresholdTokens`. Mirrors the *behaviour* of
  `projectCompaction` at
  `packages/tui/src/runtime/projections/context-snapshot.ts:93-...`
  without depending on it. The behaviour contract is "compaction
  projection reflects the latest `compaction_start` / `compaction` /
  `compaction_failed` message" — both implementations must satisfy it
  against the shared corpus fixtures.
- `packages/webui/src/server/projections/compaction.ts`

  Subscribes to `session.compaction.started` / `completed` / `failed`
  events. The predicate is the same shape as
  `isCompactionEvent` at
  `packages/tui/src/tui/controller/runtime/runtime-event-flow.ts:1115`
  (a tagged-union discriminant on
  `'session.compaction.started' | 'session.compaction.completed' |
  'session.compaction.failed'`).
- `packages/webui/src/server/projections/usage.ts`

  Re-implements `isTurnCompactionMessage` locally. Mirrors
  `packages/tui/src/application/response-usage.ts:14` so the WebUI does
  not double-count compaction messages into usage totals.
- `packages/webui/src/server/projections/permissions.ts`

  Re-implements the permission / questionnaire state mapping from
  `packages/tui/src/tui/controller/runtime/runtime-state-coordinator.ts:27-50`,
  which is the actual location of
  `permission.ask` / `permission.resolved` / `questionnaire.ask` event
  handling. **The originally cited
  `packages/tui/src/tui/controller/chat-controller-support.ts:134` is
  inside `requiresQueueFallback`, a session-busy code predicate that has
  nothing to do with permission or questionnaire state** — that
  citation was wrong. `runtime-state-coordinator` is the correct
  reference.
- `packages/webui/src/server/projections/index.ts`

  Barrel exporting the projections and a single `reduceEvents(state,
  frame)` used by `operations.ts`.

**Wired into**

- `packages/webui/src/server/operations.ts` — the existing
  `watchEvents`-driven operations use the projections instead of touching
  the raw frames.
- `packages/webui/src/client/stream-loop.ts` — the reducer consumes the
  projected shapes, not the raw `SessionStreamFrame`. The frame schema in
  `packages/webui/src/server/envelope.ts` does not change.

**This step changes the client.** `client/stream-loop.ts` is a client
file. Phase 3 ships with the client reducer update landed in the same
commit as the server projections. The phase table reflects the corrected
boundary.

**Verification**

- `packages/webui/test/unit/projections.test.ts` — drives the WebUI
  reducers against the `@mavis/local-runtime-v2` shared event corpus
  fixtures (see the ADR amendment for the corpus layout). Frame fixtures
  come from the same source as
  `packages/tui/test/unit/runtime-event-normalizer.test.ts:702-720`
  (`session.compaction.completed` fixture), so a single harness
  protocol change lights up tests in both clients.
- Register `projections.test.ts` in `test/vitest-suites.json`.
- `pnpm test:webui`, `pnpm typecheck:webui`, `pnpm build:webui`,
  `pnpm check:webui-boundary`.

## Client migration: visual surface and pages

The client work is the larger half of the milestone. It does not change
the server surface contract; it only changes the React components and the
assets they reference.

### Asset carry

- 27 PNG / JPG files in `packages/webui/src/client/assets/img/` (mirroring
  the layout of `../minimax-webui/app/out/assets/img/`, verified today:
  `onboard_v2_{1..4}_{en,cn}.png` × 8, `desktop_im{,_dark}.png`,
  `computer_use.png`, `pic_windows.png`,
  `remote_control_phone_{en,zh}.png`, `wechat.png`,
  `share_wechat_friends.png`, `discord.jpg`, `feishu.png`,
  `feishu-feedback-group.png`, `pic_{1,2,3}.png`, `pic_{1,2}_cn.png`,
  `breakDown.png`, `emptypicture.png`, `beian.png` = 27 total).
- 60 KaTeX font files in
  `packages/webui/src/client/assets/fonts/katex/` (20 `.ttf`, 20 `.woff`,
  20 `.woff2`, 2.2 MB total, verified today in
  `../minimax-webui/app/out/_next/static/media/KaTeX_*`). The desktop
  filenames are content-hashed; the plan renames them to the canonical
  `KaTeX_<family>-<style>.<ext>` form so the build source does not
  reference hashed URLs.
- One shared `LICENSE.katex-fonts` note alongside the fonts and points to
  the upstream `katex` package license (MIT, verified at the upstream
  project). `release/dependency-licenses.json` records the `katex`
  runtime dependency added in step C3.

The 548 KB / 25-file desktop CSS product
(`../minimax-webui/app/out/_next/static/css/`) is **not** lifted.
`packages/webui/src/client/styles/tokens.css` remains the visual source
of truth, per the visual-language doc and ADR 0009.

**Verification**

- `node scripts/source-inventory.mjs --write` regenerates
  `release/public-source.json` to include the new asset paths.
- `release/dependency-licenses.json` lists `katex` with the MIT license.
- `pnpm check:source` is green.
- A source-to-destination filename manifest is committed alongside the
  asset copy so reviewers can diff the file list. A count-only check is
  not sufficient because two images could share the same byte count.
- `pnpm install` must update `pnpm-lock.yaml` (the GitHub CI installs
  with `--frozen-lockfile`; without a committed lockfile change the CI
  fails).

### Step C1 — Image assets land

- Copy the 27 image files into `packages/webui/src/client/assets/img/`,
  categorised by use site (see the table in "Asset carry" above).
- Update `release/public-source.json` via the inventory script.
- Commit the filename manifest alongside the images.
- No CSS or component changes.

### Step C2 — KaTeX font files land

- Copy the 60 font files into
  `packages/webui/src/client/assets/fonts/katex/` and rename to the
  canonical `KaTeX_<family>-<style>.<ext>` form.
- Add the `LICENSE.katex-fonts` note pointing at the upstream KaTeX
  package license.
- Update `release/public-source.json`.
- Add `katex` to `packages/webui/package.json` dependencies and commit
  the `pnpm-lock.yaml` change.
- `pnpm check:source`.

### Step C3 — KaTeX runtime wired into markdown

- Add `katex` to `packages/webui/package.json` dependencies (the same
  version whose fonts ship in C2; pinned to keep the bundled font
  references valid).
- Update `packages/webui/src/client/markdown.tsx` so block-code with
  language `'math'` and the inline `$...$` / `$$...$$` token in plain
  text delegate to `katex.renderToString`. The current markdown
  pipeline uses `marked` which emits no `$...$` token natively, so the
  plan must specify the tokenizer extension that recognises inline
  math. The chosen extension is
  [`marked-katex-extension`](https://www.npmjs.com/package/marked-katex-extension)
  or a hand-rolled marked extension with the same behaviour; either way
  the tokenizer regex is the only allowed math surface, no
  `katex/contrib/auto-render` (which runs an over-eager global regex
  pass).
- CSS integration: the ADR-0010 single-stylesheet rule
  (`scripts/build-webui-styles.mjs` produces the only stylesheet
  consumed by both dev and packaged output; `index.html` links
  `./styles.css`; the esbuild client build has no CSS loader) is not
  compatible with a second `<link>` in `index.html`. The plan adds
  `postcss-import` to the styles pipeline and `@import
  "katex/dist/katex.min.css";` to `packages/webui/src/client/styles/index.css`.
  The build copies the font directory from
  `packages/webui/src/client/assets/fonts/katex/` into the build output
  so the bundled CSS's font URLs resolve.

### Step C4 — Settings modal

The settings surface lives in `Archon.tsx` and is opened from
`LeftRail.tsx`. Sections, in order:

1. **general** — theme (light / dark, written to `localStorage` and
   reflected through `.light` / `.dark` on `<html>` per
   [`webui-visual-language.md:47-60`](webui-visual-language.md)),
   language (zh / en, stored in `localStorage`).
2. **appearance** — font size (12 / 14 / 16), density (comfortable /
   compact), each toggling a `data-density` attribute on `<html>`.
3. **account** — show the authenticated user from `getAccountStatus`,
   with a sign-out button that calls the existing credential invalidator
   (`authContext.invalidator`).
4. **account-onboarding** — re-entry to `/onboarding` for users who
   skipped it.
5. **model** — list from `listModels`, selection via `selectModel`;
   shows the currently configured thinking level and the context-window
   usage from `getSessionUsage`.
6. **data directory** — **read-only display of the current dataDir**.
   The plan explicitly defers relocation: re-implementing
   `DESKTOP_GET_LOCAL_RUNTIME_DATA_DIR_INFO` /
   `DESKTOP_RELOCATE_LOCAL_RUNTIME_DATA_DIR` (the desktop settings IPC
   handlers at
   `../minimax-webui/app/dist/main/ipc/settings.ipc.js:347-385`) would
   require a host lifecycle change in
   `@mavis/local-runtime-v2` and a credential-preservation story for
   the shared `~/.minimax` directory. Neither fits this milestone.

The desktop's shortcut / notification / tray / run-on-startup /
power-save-blocker / Computer Use entries are intentionally absent.

### Step C5 — Streaming transcript

Driven by `packages/webui/src/server/projections/*` plus a thin reducer
in `packages/webui/src/client/stream-loop.ts`. Compaction rows,
tool-result previews and assistant / user cells are styled with the
visual tokens; nothing here is a terminal emulator.

The reducer keeps the existing probe hook `__webuiProbeReduce` so the
existing `packages/webui/test/unit/webui-stream.test.ts` continues to
work as a fixture reference. The probe is a reducer-fixture contract,
**not** an end-to-end smoke test; a real WebSocket round-trip smoke test
is added in phase 5 below.

### Page re-authoring

Four pages are re-authored. They use the existing React + Vite toolchain
in `packages/webui/src/client/`, not the Next.js export from the desktop
build.

**Shared components** (new, under
`packages/webui/src/client/components/`):

- `ArchonShell.tsx` — the two-column layout (left rail ~18% width, main
  surface lighter than the rail). Header, footer, model badge, send
  button. Lays out exactly the way
  `webui-visual-language.md` describes the conversation surface.
- `LeftRail.tsx` — session list, new-session action, settings entry,
  account entry. Styling tokens from `tokens.css` only.
- `Composer.tsx` — large-radius field, attach button, trailing model
  selector, solid dark circular send button. Suggestion-chip row
  underneath; workspace capsule and local tag below.
- `Transcript.tsx` — renders message cells driven by the projected
  frames (compaction rows, tool previews, assistant / user cells). Same
  projection output the tui produces, expressed in HTML.
- `SettingsModal.tsx` — `/settings` modal opened from the rail.
- `LoginCard.tsx`, `OnboardingSteps.tsx`, `NotFound.tsx`.

**Page routes** (each is a thin entry that composes the shared
components):

- `pages/Login.tsx` → mounted at `/login`
- `pages/Onboarding.tsx` → `/onboarding`
- `pages/Archon.tsx` → `/archon` (includes the `/settings` modal)
- `pages/NotFound.tsx` → `/*`

A minimal client-side router replaces the current single-view
`app.tsx`. The choice is between keeping the existing flat SPA and
adding a tiny `route()` helper, or pulling in `react-router-dom`.
Default: flat SPA + `route()` helper under
`packages/webui/src/client/router.ts`. Lift to `react-router-dom` only
if the modal history or back-button behaviour requires it.

### Phase 5 dev server wiring

ADR 0010 says Vite is the WebUI dev server. The wiring is not currently
present in the tree (no vite config anywhere under
`packages/webui/`, no `dev` script in either
`packages/webui/package.json` or the root `package.json`). Phase 5
adds the dev server explicitly:

- `packages/webui/vite.config.ts` — points at
  `packages/webui/src/client/main.tsx`, proxies WebSocket to
  `127.0.0.1:<port>` from the running server.
- `packages/webui/package.json` — `dev: "vite"`,
  `dev:server: "node ../../scripts/run-webui-server.mjs"` (or the
  equivalent server entry that already exists).
- Root `package.json` — `dev:webui: "pnpm --filter @mavis/webui dev"`
  if a top-level convenience script is wanted.

Without the dev server, phase 5's "Boot the WebUI and walk through
`/login` → `/onboarding` → `/archon` → `/settings`" smoke test is not
runnable.

## Verification matrix

The repository's actual gate names, verified against the current root
`package.json` and `scripts/verify.mjs`:

| Gate | Command | Notes |
| --- | --- | --- |
| Boundary | `pnpm build:webui && pnpm check:webui-boundary` | WebUI esbuild artifact with Vite as the dev server (ADR 0010). Boundary asserts no retired sources and no `packages/tui/src/tui` import. |
| Type check | `pnpm typecheck:webui` | Browser and server code under the same package; runs `typecheck:server` and `typecheck:client`. |
| Tests | `pnpm test:webui` | Runs the `webui` group in `test/vitest-suites.json` via `scripts/run-vitest-suite.mjs`. |
| Standalone type check | `pnpm check:standalone` | Confirms the standalone CLI build does not bundle webui sources. |
| Source | `pnpm check:source` | Reads `release/public-source.json` and retired sources. Requires phase-zero inventory step. |
| Inventory | `node scripts/source-inventory.mjs --write`, reviewed before committing | New binary and source files must be in the inventory. |
| Test registration | every new test file listed in `test/vitest-suites.json` under the `webui` group | Without registration, `check:source` fails (see `scripts/lib/vitest-suites.mjs:42-51`). |
| Lockfile | commit the `pnpm-lock.yaml` update for `katex` | CI installs with `--frozen-lockfile` (`.github/workflows/ci.yml:40`). |
| License | `release/dependency-licenses.json` lists `katex` with MIT | No CI gate today; manual review before opening the PR. |
| Full verify | `pnpm verify` | Run on the reviewed commit with a clean tracked tree. |

The plan does not use `pnpm --filter webui typecheck` /
`pnpm --filter webui build` / `pnpm --filter webui test:unit` — those
commands do not exist in this package. The earlier draft of this plan
used them; the corrected commands are above.

`docs`-profile eligibility: this plan, the ADR amendment and the
inventory update all land under `docs/` and are documentation-shaped
under `scripts/ci-changes.mjs:15`, but the implementation steps are
not — the full profile is the correct choice.

## Phasing

The phases below are ordered so each one ships a runnable artifact with
green gates.

| Phase | Steps | Outcome | Client changes? |
| --- | --- | --- | --- |
| 0 — Inventory | regenerate `release/public-source.json` | `pnpm check:source` becomes green from a known-red baseline | No |
| 1 — Identity switch | B1 | WebUI runs the TUI system prompt and inherits `isCommandLineRuntimeOwner` semantics, including `tuiProductPolicy` and `contentReviewEnabled` for `cn` | No |
| 2 — Command surface | B2 | `runCommand` operation and transport method callable from the client; six commands wired | Yes (`client/transport.ts`) |
| 3 — Projections | B3 | Streaming frames the client consumes carry compaction, permission, questionnaire and usage state | Yes (`client/stream-loop.ts`) |
| 4 — Assets and dev server | C1, C2, C3, phase-5 dev server wiring | Image and KaTeX assets land; KaTeX wired into markdown; Vite dev server runnable | No (asset migration only) |
| 5 — Pages and settings | C4, C5 | Four pages render; settings modal is openable and writes back to the runtime host | Yes (client pages and components) |

The phase-1 gate is `pnpm typecheck:webui` + `pnpm test:webui` + manual
prompt inspection. Phase-2 through phase-5 gates include
`pnpm check:webui-boundary`, `pnpm check:standalone`, and
`pnpm check:source`. Each phase ends with `pnpm verify` on the
reviewed commit before the next one starts, per AGENTS.md.

The earlier draft of this plan said phases 1–3 ship "without a client
change". That was wrong: B2 changes `client/transport.ts` and B3 changes
`client/stream-loop.ts`. The corrected boundary is in the table above.

## Risks

The risks below are listed in priority order; the top items are the ones
most likely to bite during implementation.

1. **`tuiProductPolicy` and `contentReviewEnabled` are product-policy
   changes, not infrastructure.** Switching the owner identity to `'tui'`
   turns on four flags in `@mavis/local-runtime-v2` without further
   configuration. In the `cn` region this turns on content review for
   every WebUI session. The plan accepts this as part of "backend logic
   from TUI" but it must be called out in the PR description. Mitigation:
   if the product wants to opt out of one of the flags for WebUI, the
   proposal must add a new code path in `@mavis/local-runtime-v2`. The
   WebUI does not own this.
2. **Projection drift against the harness event protocol.** The ADR
   amendment establishes the shared event corpus as the conformance
   surface. The risk is real but bounded: a harness protocol change
   lights up tests in both clients, and the corpus is reviewed alongside
   every harness protocol PR. The longer-term fix (extract a shared
   client package) is out of scope per the original brief.
3. **`_v2/tui/SYSTEM.md.hbs` is mandatory.** The harness throws if the
   file is missing (`packages/local-runtime-v2/src/service/agent/builtin/catalog.ts:358`).
   The build pipeline must preserve it during packaging. Mitigation: a
   smoke test boots the WebUI with a fresh `~/.minimax` and confirms
   the file is read.
4. **`katex` lockfile, license and bundle weight.** Adding `katex` is
   the largest single new dependency. The lockfile update must be
   committed or CI fails. The license entry must be added to
   `release/dependency-licenses.json`. The CSS bundle weight (the
   katex CSS plus the bundled font directory, on top of the single
   ADR-0010 stylesheet) must be measured after phase 4 and added to the
   PR description; the visual-language doc's "do not lift the compiled
   stylesheet" rule still applies to the desktop CSS, not to the katex
   CSS, but a budget needs to be agreed.
5. **Asset count drift.** The 27-image and 60-font counts are observed
   figures on this branch and may shift with future desktop extractions.
   A filename manifest is committed alongside the asset copy so reviewers
   can see what changed.
6. **Existing `webui-service.test.ts:1618` regression.** B1's file list
   includes the test update; if the test update is missed the existing
   `'cli'` assertion fires.
7. **`postcss-import` adds a build-time dependency.** If the postcss
   pipeline cannot resolve the katex CSS path, the build fails. The plan
   accepts this as a phase-4 exit criterion.
8. **Dev server wiring is missing today.** Phase 5 adds it. Without it,
   the "boot the WebUI and walk through" smoke test cannot run.
9. **Data-directory section is read-only.** Anyone who reads the
   "data directory" section of the settings modal and assumes it
   supports relocation will be disappointed. The section title and
   helper copy must say so explicitly.
10. **`pnpm check:source` is red on this branch before any work starts.**
    Phase zero fixes it. The PR description must call this out so a
    reviewer who runs `check:source` against `main` is not surprised.