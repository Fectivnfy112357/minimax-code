# WebUI TUI-Harness migration plan

Migration of `packages/webui/` to a TUI-driven backend over the desktop application's
visual language. The WebUI is currently a half-finished client that uses a
`runtimeOwnerKind: 'cli'` harness host; this plan changes it to use the TUI
identity (so the harness renders the TUI system prompt and command semantics), and
builds out the client surface against the desktop design tokens and the desktop
visual reference.

The repository already locks in the boundaries:

- [ADR 0001](../adr/0001-webui-is-a-peer-client-of-the-harness.md): the WebUI is a
  peer client of the harness layer (`@mavis/local-runtime-v2`), not a CLI wrapper.
- [ADR 0003](../adr/0003-no-dependency-on-tui-internals.md): the WebUI may **read**
  the terminal client's code as a reference but must not **import** it; it must
  write its own narrow adapter.
- [ADR 0009](../adr/0009-webui-reuses-the-desktop-visual-language.md): the WebUI
  reuses the desktop application's design tokens.
- [webui-visual-language.md](webui-visual-language.md) defines the tokens, theme
  mechanism, typography and layout rules the WebUI already adopts.

This document fills in what those ADRs leave unspecified: **which** terminal-client
behaviour we mirror, **which** visual assets we lift from the desktop build, and
**in what order**.

## Scope

| Category | Decision |
| --- | --- |
| Backend identity | `runtimeOwnerKind: 'tui'` (was `'cli'`). Drives `promptProfile: 'tui'` → `_v2/tui/SYSTEM.md.hbs` and the `isCommandLineRuntimeOwner` branch in `application/agent/profile-source.ts`. |
| Command system | Mirror the runtime-independent parts of `TUI_COMMAND_DESCRIPTORS`: `help`, `new`, `compact`, `status`, `usage`, `model`. Skip TUI-only commands (`/theme` editor, `/editor`, TUI-local login). |
| Compaction | Carry over the `/compact` command and `session.compaction.{started,completed,failed}` projection. Wire to the existing `requestCompaction` and `watchEvents` ports. |
| Usage / context | Carry over the context-window visualization and the session usage view. |
| Questionnaire / permission | Carry over the projection logic from `packages/tui/src/tui/controller/chat-controller-support.ts`. Same IPC channels; React-side state machines are re-authored. |
| Visual asset scope | Image assets (27 PNG/JPG) and KaTeX font faces (2.2 MB / 30 woff+woff2+ttf) are checked in. CSS compiled product (548 KB / 25 minified files) and Next.js chunks (37 MB) are not. |
| Pages | Re-author four pages against the visual language: `/login`, `/onboarding`, `/archon`, `/404`. Defer `/archon-mini-chat`, `/log-viewer`, `/pdf`, `/doc`, `/docx`. |
| Settings | Modal inside `/archon` (route unchanged). Cover: `general` (theme, language), `appearance` (font size, density), `account` (login state, sign out), `account-onboarding`, `model` (model selection, thinking level, context control), `data directory` (relocate). Skip desktop-only items: `shortcut`, `notification`, `tray`, `run-on-startup`, `power-save-blocker`, `Computer Use toggle`. |
| KaTeX | Integrate KaTeX into `markdown.tsx` so `$...$` / `$$...$$` blocks render. Fonts come from the desktop bundle, rest of the KaTeX runtime is added as a dependency. |

The visual asset rules above are consistent with
[`webui-visual-language.md`](webui-visual-language.md), which already establishes
that the WebUI reuses the desktop tokens by re-authoring them rather than copying
the compiled product.

## Out of scope (left to later milestones)

- Global shortcut binding, system notifications, tray, run-on-startup,
  power-save-blocker, Computer Use toggle: all desktop-only and irrelevant in a
  browser tab.
- `archon-mini-chat`, `log-viewer`, `pdf` / `doc` / `docx` preview pages: deferred
  to the next milestone; the visual language doc already covers the building blocks.
- A standalone `/settings` route: not needed while the modal lives inside `/archon`.
- Resumption of the desktop build's OAuth callback via `minimax://` deeplink:
  inherited limitation; the WebUI continues to read the credential file directly
  via `packages/webui/src/server/auth-context.ts`.

## Backend migration: TUI identity, command catalogue, event projections

The backend work lands in three steps. None of it touches the client build.

### Step B1 — Switch the runtime owner identity to TUI

**Files**

- `packages/webui/src/server/assembly.ts`

**Change**

- `WebuiForwardedRuntimeHostOptions.runtimeOwnerKind`: `"cli"` → `"tui"`.
- Update the type alias `WebuiForwardedRuntimeHostOptions.runtimeOwnerKind` from
  the literal `"cli"` to a union including `"tui"`, and adjust the type
  declaration comment that pairs with
  `packages/tui/src/runtime/embedded-host.ts:84`.
- The inline comments referencing ADR 0001 and the `runtimeOwnerKind: 'cli' /
  capabilityProfile: 'cli'` pair (assembly.ts:8-15) get a follow-up sentence
  pointing to the new identity.

**Effect on the harness**

- `runtimeOwnerKind === 'tui'` → `promptProfile: 'tui'` →
  `_v2/tui/SYSTEM.md.hbs` is loaded for the primary agent.
- `isCommandLineRuntimeOwner('tui')` returns true; memory stays disabled and cron
  stays disabled — same as today.
- `capabilityProfile: 'cli'` stays; only the owner identity changes.

**Verification**

- `pnpm --filter webui typecheck`
- Boot the WebUI against a managed MiniMax login and a session in coding mode;
  inspect the system prompt the runtime receives. The first line of the rendered
  prompt must read "You are a coding agent running in the MiniMax Code terminal,
  developed by MiniMax" (the TUI SYSTEM persona header), not the desktop / webui
  variant. This is the cheapest end-to-end check; the harness has no flag to
  surface the rendered prompt directly.
- `pnpm check:source` and `pnpm check:webui-boundary` — they assert no retired
  sources and no tui-internals imports; both should still pass because only
  literal values change.

### Step B2 — Command catalogue

**Goal.** Expose a WebUI-callable command surface that mirrors the runtime-
independent descriptors in `packages/tui/src/application/command-descriptors.ts`,
without importing that file.

**New files**

- `packages/webui/src/server/commands/descriptors.ts`

  Pure data: name, description, optional argument schema, help group, alias map.
  Only the six commands listed under "Scope / Command system" above. The shape
  follows `packages/tui/src/application/command-descriptors.ts:43-...` but with
  the TUI-only entries removed.
- `packages/webui/src/server/commands/runner.ts`

  Routes a `{ command, input, sessionId }` request through the existing
  `CliService` port. Per command:

  - `help`: returns the catalogue; no runtime call.
  - `new`: `createSession` with an explicit `workspaceDir` carried from the
    caller (refusing implicit workspaces per assembly step 8).
  - `compact`: `requestCompaction(sessionId, agentName, input || undefined)`;
    surfaces `NOTHING_TO_COMPACT` as `handled: true, output: 'No compaction is
    needed for this conversation yet.'` and other failures as
    `runtimeRejected`.
  - `status`: `getSession(request)`; formats the compact label set already used
    in `packages/tui/src/tui/transcript/context-visualization.ts:20` (`SYSTEM_PROMPT`,
    `Tools`, `Skills`, `Model`, `Workspace`).
  - `usage`: `getSessionUsage(request)`; output reuses the token / cost / cache
    layout from `packages/tui/src/tui/transcript/context-visualization.ts`.
  - `model`: `listModels` for completion, `selectModel` for switching;
    selection input follows `resolveModelSelection` in
    `packages/tui/src/acp/commands.ts:193`.

**Wired into the WebUI transport**

- `packages/webui/src/server/operations.ts` gains a `runCommand` operation that
  delegates to `commands/runner.ts`. Reuses the existing operation-registry
  pattern; no new envelope kind.
- `packages/webui/src/server/port.ts` gains the corresponding
  `WebuiRunCommandRequest` / `WebuiRunCommandResult` types.
- `packages/webui/src/client/transport.ts` gains `runCommand`; uses the
  existing request / response / error frame kind.

**Verification**

- Unit tests in `packages/webui/test/unit/commands.test.ts` covering each of the
  six commands against a stub `CliService` mirroring the tui app tests'
  fixtures (`packages/tui/test/unit/tui-runtime-adapter.test.ts:312-340`).
- Add the new test file to `test/vitest-suites.json` under the `webui` group
  (or the matching gate; check the existing grouping first).
- `pnpm --filter webui test` and the full `pnpm verify`.

### Step B3 — Event projections

**Goal.** Mirror the runtime-event projections the TUI consumes, in particular
the compaction projection and the permission / questionnaire projection, so the
WebSocket event stream can drive the client state machines.

**New files**

- `packages/webui/src/server/projections/context-snapshot.ts`

  Reads `SessionStreamFrame` messages and produces a
  `WebuiContextSnapshotResponse` carrying `compaction.state`, `compaction.lastAt`,
  `usage`, `window`, `usedTokens`, `compactionThresholdTokens`. Mirrors
  `packages/tui/src/runtime/projections/context-snapshot.ts:93` (`projectCompaction`)
  without depending on it.
- `packages/webui/src/server/projections/compaction.ts`

  Subscribes to `session.compaction.started` / `completed` / `failed` events and
  emits the snapshot diffs above. Mirrors the predicate at
  `packages/tui/src/tui/controller/runtime/runtime-event-flow.ts:1115`.
- `packages/webui/src/server/projections/usage.ts`

  Mirrors `packages/tui/src/application/response-usage.ts:14`:
  `isTurnCompactionMessage` is reimplemented locally so the WebUI does not
  double-count compaction messages into usage totals.
- `packages/webui/src/server/projections/permissions.ts`

  Mirrors the chat-controller permission / questionnaire code-state mapping at
  `packages/tui/src/tui/controller/chat-controller-support.ts:134`. Two states:
  `queue-required` (permission / elicitation waiting) and the running state.
- `packages/webui/src/server/projections/index.ts`

  Barrel exporting the projections and a single `reduceEvents(state, frame)`
  used by `operations.ts`.

**Wired into**

- `packages/webui/src/server/operations.ts` — the existing
  `watchEvents`-driven operations use the projections instead of touching the raw
  frames.
- `packages/webui/src/client/stream-loop.ts` — the reducer consumes the projected
  shapes, not the raw `SessionStreamFrame`. The frame schema in
  `packages/webui/src/server/envelope.ts` does not change.

**Verification**

- Unit tests in `packages/webui/test/unit/projections.test.ts` driving the
  reducers with fixture frames copied from
  `packages/tui/test/unit/runtime-event-normalizer.test.ts:702-720`.
- WebSocket round-trip smoke test in
  `packages/webui/test/unit/webui-stream.test.ts` (already exists at line 344,
  uses `__webuiProbeReduce`; extend its fixtures).

## Client migration: visual surface and pages

The client work is the larger half of the milestone. It does not change the
server surface contract; it only changes the React components and the assets
they reference.

### Asset carry

- 27 PNG / JPG files in `packages/webui/src/client/assets/img/` (mirroring the
  layout of `../../minimax-webui/app/out/assets/img/`).
- 30 KaTeX font files (`KaTeX_*` woff / woff2 / ttf) in
  `packages/webui/src/client/assets/fonts/katex/`.
- One shared `LICENSE` note alongside the fonts stating that the KaTeX font
  faces are MIT-licensed; `release/dependency-licenses.json` records the KaTeX
  runtime dependency added in step C3.

The image binaries are checked in by category, not as a flat copy of the
desktop build. Categories:

| Source file(s) | Use site |
| --- | --- |
| `onboard_v2_{1..4}_{en,cn}.png` | `/onboarding` step illustrations |
| `desktop_im.png` / `desktop_im_dark.png` / `computer_use.png` / `pic_windows.png` / `remote_control_phone_{en,zh}.png` | capability intro cards in `/onboarding` and the `/settings` modal |
| `wechat.png` / `share_wechat_friends.png` / `discord.jpg` / `feishu.png` / `feishu-feedback-group.png` | `/login` social entry rows |
| `pic_{1,2,3}.png` / `pic_{1,2}_cn.png` | empty states in `/archon` |
| `breakDown.png` / `emptypicture.png` | empty-state and placeholder artwork |
| `beian.png` | footer of `/login` and `/onboarding` |

**Verification**

- `pnpm check:source` — image binaries are listed under
  `release/public-source.json`. Update with
  `node scripts/source-inventory.mjs --write` after adding them.
- `release/dependency-licenses.json` — KaTeX is added with the MIT license.
- Manually: open each page in a browser and confirm the assets resolve.

### Page re-authoring

Four pages are re-authored. They use the existing React + Vite toolchain in
`packages/webui/src/client/`, not the Next.js export from the desktop build.

**Shared components** (new, under `packages/webui/src/client/components/`):

- `ArchonShell.tsx` — the two-column layout (left rail ~18% width, main surface
  lighter than the rail). Header, footer, model badge, send button. Lays out
  exactly the way `webui-visual-language.md` describes the conversation surface.
- `LeftRail.tsx` — session list, new-session action, settings entry, account
  entry. Styling tokens from `tokens.css` only.
- `Composer.tsx` — large-radius field, attach button, trailing model selector,
  solid dark circular send button. Suggestion-chip row underneath; workspace
  capsule and local tag below.
- `Transcript.tsx` — renders message cells driven by the projected frames
  (compaction rows, tool previews, assistant / user cells). Same projection
  output the tui produces, expressed in HTML.
- `SettingsModal.tsx` — `/settings` modal opened from the rail.
- `LoginCard.tsx`, `OnboardingSteps.tsx`, `NotFound.tsx`.

The styles in `packages/webui/src/client/styles/tokens.css` are the source of
truth; the compiled product from the desktop build is not lifted. The visual
language doc is explicit about this, and ADR 0009 plus the LICENSE-STATUS
audit both forbid checking the compiled product in.

**Page routes** (each is a thin entry that composes the shared components):

- `pages/Login.tsx` → mounted at `/login`
- `pages/Onboarding.tsx` → `/onboarding`
- `pages/Archon.tsx` → `/archon` (includes the `/settings` modal)
- `pages/NotFound.tsx` → `/*`

A minimal client-side router replaces the current single-view `app.tsx`. The
choice is between keeping the existing flat SPA and adding a tiny `route()`
helper, or pulling in `react-router-dom`. Default: flat SPA + `route()` helper
under `packages/webui/src/client/router.ts`. Lift to `react-router-dom` only if
the modal history or back-button behaviour requires it.

**Verification per page**

- `pnpm --filter webui build` and `pnpm --filter webui typecheck`.
- Boot the WebUI and walk through: `/login` → `/onboarding` (1 of 4 steps) →
  `/archon` (send one message, watch the streamed reply, run `/compact` and
  observe the compaction row) → open `/settings` and change the theme (light /
  dark).
- `pnpm --filter webui test:unit` with new fixture pages under
  `packages/webui/test/unit/pages/`.

### Step C1 — Image assets land

- Copy the 27 image files into `packages/webui/src/client/assets/img/`.
- Update `release/public-source.json` with `node scripts/source-inventory.mjs --write`.
- No CSS or component changes.

### Step C2 — KaTeX font files land

- Copy the 30 font files into `packages/webui/src/client/assets/fonts/katex/`.
- Add a `LICENSE.katex-fonts` note next to them.
- Update `release/public-source.json`.
- `pnpm check:source`.

### Step C3 — KaTeX runtime wired into markdown

- Add `katex` to `packages/webui/package.json` dependencies.
- Update `packages/webui/src/client/markdown.tsx` so the existing block-code path
  delegates `language: 'math'` (and the inline `$...$` token in plain text) to
  `katex.renderToString`. CSS comes from `katex/dist/katex.min.css`, imported
  once from `packages/webui/src/client/main.tsx`.
- Mirror only the math surface; do not pull in `katex/contrib/auto-render` (no
  need for the auto-detection regex pass in a controlled renderer).

### Step C4 — Settings modal

The settings surface lives in `Archon.tsx` and is opened from `LeftRail.tsx`.
Sections, in order:

1. **general** — theme (light / dark, written to `localStorage` and reflected
   through `.light` / `.dark` on `<html>` per
   `webui-visual-language.md:47-60`), language (zh / en, stored in
   `localStorage`; the WebUI does not own a language picker of its own today).
2. **appearance** — font size (12 / 14 / 16), density (comfortable / compact),
   each toggling a `data-density` attribute on `<html>`.
3. **account** — show the authenticated user from `getAccountStatus`, with a
   sign-out button that calls the existing credential invalidator
   (`authContext.invalidator`).
4. **account-onboarding** — re-entry to `/onboarding` for users who skipped it.
5. **model** — list from `listModels`, selection via `selectModel`; shows the
   currently configured thinking level and the context-window usage from
   `getSessionUsage`.
6. **data directory** — calls `getLocalRuntimeDataDirInfo` and
   `relocateLocalRuntimeDataDir` from the desktop settings IPC channel
   (re-implemented in the WebUI server using the runtime host's dataDir
   capability).

The desktop's shortcut / notification / tray / run-on-startup / power-save-
blocker / Computer Use entries are intentionally absent.

### Step C5 — Streaming transcript

Driven by `packages/webui/src/server/projections/*` plus a thin reducer in
`packages/webui/src/client/stream-loop.ts`. Compaction rows, tool-result previews
and assistant / user cells are styled with the visual tokens; nothing here is a
terminal emulator.

The reducer keeps the existing probe hook `__webuiProbeReduce` so the existing
`packages/webui/test/unit/webui-stream.test.ts` continues to work as a fixture
reference.

## Verification matrix

| Gate | Command | Notes |
| --- | --- | --- |
| Source check | `pnpm check:source` | Picks up the new image, font and `commands/*` files via `release/public-source.json`. |
| Standalone type check | `pnpm check:webui-boundary` and `pnpm check:standalone` | Confirms the WebUI bundle does not pull `packages/tui/src/tui`. |
| Build | `pnpm --filter webui build` | esbuild artifact with Vite dev server per ADR 0010. |
| Type check | `pnpm --filter webui typecheck` | Browser + server code under the same package. |
| Tests | `pnpm --filter webui test:unit` | New tests in `packages/webui/test/unit/commands.test.ts`, `projections.test.ts`, `pages/*.test.tsx`. |
| Full verify | `pnpm verify` | Run on the reviewed commit with a clean tracked tree. The `docs` profile is not applicable because `docs/webui/*`, `release/*` and `AGENTS.md` changes do not qualify under `scripts/ci-changes.mjs`. |

## Phasing

The steps above are ordered so each phase ships a runnable artifact with green
gates.

| Phase | Steps | Outcome |
| --- | --- | --- |
| 1 — Identity switch | B1 | WebUI runs the TUI system prompt and inherits `isCommandLineRuntimeOwner` semantics. No client-side change. |
| 2 — Command surface | B2 | `/compact`, `/usage`, `/model`, etc. callable from a future client without further server work. Still no client change beyond a hidden test page if needed. |
| 3 — Projections | B3 | Streaming frames the client consumes carry compaction, permission, usage and questionnaire state. Still ships without a new page. |
| 4 — Assets | C1, C2, C3 | Image and KaTeX assets land; `markdown.tsx` renders math. |
| 5 — Pages and settings | C4, C5 | Four pages render. The settings modal is openable and writes back to the runtime host. |

Each phase ends with `pnpm verify` on the reviewed commit before the next one
starts, per AGENTS.md.

## Risks

- The TUI persona header is wired through `_v2/tui/SYSTEM.md.hbs`, which is
  marked as "Mandatory V2 Agent prompt" by the harness. If the file is missing
  the harness throws and the WebUI fails to start; the build pipeline must
  preserve it during packaging.
- KaTeX is a runtime dependency the WebUI does not currently carry. The new
  dependency must be recorded in `release/dependency-licenses.json`; verify
  before opening the PR.
- The desktop CSS product (548 KB / 25 minified files) is **not** lifted. Any
  pixel-perfect comparison must happen against the desktop conversation
  surface screenshot, not the compiled CSS, per
  `webui-visual-language.md:104-107`.
- The `archon` page renders against the streamed events produced by the new
  projections; the existing `__webuiProbeReduce` probe in
  `packages/webui/test/unit/webui-stream.test.ts` is the only end-to-end check
  today. If it stays stable through phases 1-3, phase 5 lands on a known-good
  reducer.
