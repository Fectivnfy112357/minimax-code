# Agent guide — `@mavis/webui`

The root `AGENTS.md` still applies in full: branch naming, generated-file discipline, the
publication boundary, and the "documentation and commit messages in English" rule. This file adds
what is specific to this package.

`packages/webui` is the browser client and the loopback service in front of the process-local
harness layer (`@mavis/local-runtime-v2`). It is the fourth client of that host — it does not speak
ACP and does not drive the CLI. Architecture decisions live in `CONTEXT.md` and `docs/adr/` at the
repo root; the v1 scope and assembly checklist in `docs/webui-v1-scope.md`. `README.md` next to this
file covers the package boundaries and its own scripts.

The package is a leaf: no `exports` map, no other workspace package consumes it. It does not exist in
`upstream/main`, so splitting or renaming files inside it costs no three-way merge conflict — but it
does change `release/public-source.json`, which must be regenerated.

## Layout

```
src/
  client/             shell entry, transport, stream loop, contracts, runtime store, router
    components/       React components (the shell and every panel it renders)
    projection/       pure state and message projections — no React, no transport
    styles/           index.css, tokens.css, shell.css, transcript-widgets.css
    assets/           fonts, images, lottie
  server/             loopback service: envelope, credentials, port, host, assembly
    operation/        the operation registry, split by domain
    commands/         slash-command adapters
    projections/      server-side projections shared by handlers
  shared/             placeholder.ts — a placeholder type surface, imported by nothing here
```

`client/` and `server/` type-check under separate tsconfigs (`tsconfig.client.json`,
`tsconfig.server.json`); `tsconfig.standalone.json` covers neither. The browser bundle has its own
metafile (`dist-webui/metafile.json`) and is checked by `scripts/check-webui-boundary.mjs`.

`@mavis/shared` is a **different** workspace package (`packages/shared`), not `src/shared/` — the
server imports `@mavis/shared/daily-signin` and `@mavis/shared/runtime-boundary-env` from it.

## Core modules

### Client

| Module | Role | Use it by |
| --- | --- | --- |
| `client/main.tsx` | Build entry. Mounts the shell into `#webui-root` and constructs the transport **once** at module scope. | Importing nothing from it — it runs for side effects. |
| `client/contracts.ts` | The client-facing contracts: session/message/workspace view types and the `WebuiTransport` interface (every method optional — `undefined` means "this operation is not wired"). | Importing types from here rather than from a component or the shell. |
| `client/transport.ts` | `createWebuiTransport` — one method per operation, framed over the authenticated WebSocket. | Receiving the transport object as a prop; never constructing a second one. |
| `client/session-runtime-store.ts` | The module-level `sessionRuntimeStates` Map plus its listener registry, and `useSessionRuntimeState`. | Importing the canonical path — components must not reach the store through the shell. |
| `client/stream.ts`, `client/stream-loop.ts` | Stream frame reduction (`reduceWebuiStreamFrame`) and the send/resume loop (`runWebuiStreamLoop`, `buildWebuiStreamLoopSink`). | Through `projection/effect-reducer.ts` and the composer; tests drive them directly. |
| `client/router.ts` | `route(pathname)` → `"login" \| "onboarding" \| "archon" \| "404"`. Pathname routing only. | Importing `route`; the `#session=<id>` deep link is a separate concern, parsed by `readSessionIdFromHash` in `components/WebuiClientFoundationApp.tsx`. |
| `client/slash-palette.ts`, `client/value-readers.ts`, `client/team-mode.ts`, `client/markdown.tsx`, `client/icons.tsx` | Slash-command palette, defensive readers for untrusted payload fields, team-mode helpers, markdown and icon renderers. | Importing directly; these are leaves. |

### Client / projection

Pure modules: no React import, no transport access. They turn server payloads into the view shapes
the components render, and they hold the state machines that are otherwise untestable without a DOM.

| Module | Role |
| --- | --- |
| `message-projection.ts`, `message-parts.ts` | Message → renderable parts (text, tool rows, attachments). |
| `transcript-projection.ts`, `tool-projection.ts` | Transcript grouping and tool-result shaping. |
| `questionnaire-state.ts`, `goal-state.ts`, `workspace-progress.ts` | Interaction, goal and workspace-progress derivations. |
| `composer-state.ts` | Composer request construction and `createdSessionId`. |
| `action-requests.ts` | Request builders for actions (model selection and friends). |
| `effect-reducer.ts` | The pure reducer for the session event effect, plus `applyWebuiEffectCommands`. |

### Server

| Module | Role |
| --- | --- |
| `server/index.ts` | The package's public server surface: a barrel re-exporting `WebuiService`, the registry, credentials, the envelope, the port types, the host and the assembly. It is the server build entry (`scripts/build-webui.mjs`), and the launcher imports it — `scripts/run-webui-server.mjs` does `const { createWebuiRuntimeHost, createHarnessPortFromHost, WebuiService } = await import(".../src/server/index.ts")`, assembles the host, constructs `new WebuiService(...)` and calls `service.start()`. |
| `server/service.ts` | `WebuiService` — HTTP/asset serving, the authenticated WebSocket upgrade, connection lifecycle, and the call into `operation/operation-dispatch.ts`. Construct it with `WebuiServiceOptions`; `start()` resolves `WebuiServiceInfo` (with `boundUrl`). |
| `server/envelope.ts` | Frame validation (`isWebuiFrame`) and the error codes. The envelope shape is an external contract. |
| `server/credentials.ts`, `server/auth-context.ts` | The loopback credential and the per-request auth context. |
| `server/port.ts` | `WebuiHarnessPort` — the boundary to the harness layer. Every operation's request/result types live here. |
| `server/host.ts`, `server/assembly.ts` | The runtime host handle and the assembly that builds it once and spreads it onto the returned object. |
| `server/terminal.ts`, `server/usage-quota.ts`, `server/check-in.ts`, `server/runtime-environment.ts` | Terminal manager, quota client, check-in, runtime environment reporting. |

### Server / operation

The registry is one module per concern. Add code in the layer it belongs to, not in `operations.ts`.

| Module | Role |
| --- | --- |
| `operation/operation-contract.ts` | `WebuiOperation` and friends, `ValidationFailure`, and the three validation primitives (`invalidBody`, `requireRecord`, `requireNonEmptyString`). |
| `operation/names.ts` | Every `*_OPERATION_NAME` constant. |
| `operation/<domain>.ts` | The operation descriptors (name + `validate`) grouped by domain: `session`, `workspace`, `messages`, `goal`, `interaction`, `questionnaire`, `queue`, `provider`. |
| `operation/operation-handlers.ts` | `createOperationHandlers(port, terminal)`. The handler map's type is derived from the descriptors, so each handler's `body` is that operation's request type and a descriptor/handler mismatch fails to compile. |
| `operation/operation-dispatch.ts` | `dispatchWebuiFrame` — one inbound frame → validate → look up → handle → response, stream, or error frame. |
| `operation/operations.ts` | `createOperationRegistry` (the single `registerOperation` call site) and `registerOperation`. Re-exports the descriptors, so importers keep one entry point. The registry order is observable on the wire; preserve it when adding/removing operations. The set of operations it registers is contractually the same as `WebuiHarnessPort`'s — `operation-handlers.ts` derives its `Pick` from the port, so a port method added or removed must reach this file in the same change, and `integration/webui-host-shape-invariant.test.ts` (added in batch C) fails loudly if the two diverge. |

## How a request travels

1. The browser calls a `WebuiTransport` method (`client/transport.ts`), which frames
   `{protocolVersion, kind: "request", requestId, operation, body}`.
2. `WebuiService` validates the frame and hands it to `dispatchWebuiFrame`.
3. The dispatcher looks the operation up in the registry; an unregistered name or a failed
   `validate` becomes an error frame with `invalidBody`.
4. The handler calls the matching `WebuiHarnessPort` method.
5. The result becomes a response frame, or a stream of event frames for the operations that stream
   (`sendMessage`, `resumeSession`, `watchEvents`, `watchTerminal`).

Registry order is the `registerOperation` call order and is observable; keep it stable.

## Dependency rules

The allowed direction, top to bottom:

```
client/  →  components/  →  session-runtime-store.ts  →  projection/  →  contracts.ts / value-readers.ts
```

- **Never import `packages/tui`.** ADR 0003: read it as the specification, compose the equivalent
  here.
- No client module may appear in the server bundle, and no server module in the client bundle —
  `check:webui-boundary` enforces this from the build graph.
- A module has exactly one path. Do not leave a one-line `export * from` shim behind when a file
  moves: repoint every importer (including relative `../` specifiers, which a naive grep misses) and
  delete the shim.
- No new module may import the shell, and no two modules may own the same Map/state.

## Conventions

- **Every operation needs a validator.** `registerOperation` fails closed when one is missing; a
  handler without a validator must not reach the registry.
- **Keep validators strict.** `webui-service.test.ts` asserts the `invalidBody` **code** only, so a
  changed message or a relaxed predicate is invisible to the suite. Pin message text with
  `assert.deepEqual` when you touch a validator, and compare old and new implementations with a
  throwaway probe rather than trusting the suite.
- **`verbatimModuleSyntax` is on.** Type-only imports need the `type` modifier; type re-exports need
  `export type`.
- **No DOM test framework.** Do not add jsdom, happy-dom, `@testing-library/*`, or a devDependency to
  build a DOM environment, and do not change `vitest.oss.config.mjs` (`environment: "node"` is shared
  by every suite). Interaction coverage takes two shapes: extract the transitions into exported pure
  functions and test those, and assert every render branch through `renderToStaticMarkup`. The wiring
  SSR cannot reach goes in the report's untested-boundary section.
- **Never write an assertion whose whole content is that a testid string exists** — it survives every
  mutation and reads as manufactured coverage.
- **CSS:** keep the two stacked generations' *effective* declaration, not the later block; never
  deduplicate rules that differ in at-rule context (`@media`, `@container`) — those are conditional
  overrides. `webui-design-tokens.test.ts` hard-asserts that named component classes appear in the
  compiled stylesheet, so a class no markup references can still be pinned by a test.
- **New Vitest file → register it** in the `webui` group of `test/vitest-suites.json`. It is an
  explicit list, not a glob; an unregistered file never runs.
- **New or moved file → regenerate the inventory**: `node scripts/source-inventory.mjs --write`.
  Content-only edits do not need it.
- Work material (briefs, reports, probes, logs) stays **outside** the repo, in
  `~/my_data/project/my_project/minimax-code-webui-work/`. The inventory scans the working tree, so
  scratch inside the repo silently becomes a publication problem.

## Common changes

### Adding a data operation

Edit in this order so each layer compiles against the previous one:

1. `server/port.ts` — request/result types and the method on `WebuiHarnessPort`.
2. `server/host.ts` — the method on `WebuiRuntimeHostHandle`, delegating to the host object.
3. `server/operation/names.ts` — the `*_OPERATION_NAME` constant.
4. `server/operation/<domain>.ts` — the descriptor (validator + `WebuiOperation`).
5. `server/operation/operation-handlers.ts` — the handler. The map is derived from the descriptors,
   so a missing handler is a compile error.
6. `server/operation/operations.ts` — the `registerOperation` call, in the position the order needs.
7. `client/contracts.ts` — the method on `WebuiTransport` (optional, like its neighbours).
8. `client/transport.ts` — the implementation, then plumb it to the component that needs it.
9. `test/unit/webui-service.test.ts` — extend `ScriptedHarnessPort`. Since batch A,
   `pnpm typecheck:webui` includes `tsconfig.test.json`, so a missing or
   wrongly-typed stub surfaces as a `Type ... is missing the following properties from type 'WebuiHarnessPort'`
   compile error, not a runtime failure. Keep the stubs exhaustive: a forgotten member
   `Partial<WebuiHarnessPort>` would defeat the type-checked-port guarantee batch C relies on.
10. `server/assembly.ts` — only when the implementation needs a session-scoped dependency (oauth
    lease client, quota client). Build it once and spread it onto the object **returned** as `host`:
    the dev launcher rebuilds the port from `createHarnessPortFromHost(assembled.host)` while unit
    tests use `assembled.harnessPort`, so enriching only the inner port keeps every gate green and
    breaks the live server with `runtime host does not expose the <method> client`.

### Splitting or moving a module

Move bodies verbatim; change only import specifiers and the `export` keyword. Verify by comparing
function bodies between the old and new revisions with the repo's own TypeScript compiler API — a
hand-rolled brace matcher silently skips declarations whose parameter types contain a nested `)`
(e.g. `raw: import("ws").RawData`) or whose name is a `#`-private, and then reports "no differences"
for a file it barely compared. Normalise relative import depth (`./x.js` vs `../x.js`) but keep the
target module in the comparison.

### Changing CSS

Rebuild, then compare the **effective** declarations, not the bytes:

```bash
pnpm build:webui
node ~/my_data/project/my_project/minimax-code-webui-work/w0-baseline/css-snapshot.mjs --check
```

The compiled stylesheet's hash is expected to move when shadowed declarations are dropped; the
snapshot reporting zero differences is the equivalence claim.

## Commands

### Run it

```bash
# Dev server (harness-backed, serves the built client) — http://127.0.0.1:8787/
pnpm --filter @mavis/webui dev:server      # WEBUI_SERVER_PORT overrides 8787
pnpm dev:webui                             # Vite dev server for client iteration

# Build the client bundle + stylesheet the dev server serves
pnpm build:webui
```

The client is served from the built `dist-webui/client/`, so client changes need `pnpm build:webui`
before a reload shows them; the server process needs a restart to pick up server changes. A server
you expect to keep browsing must not be tied to an agent session — start it detached.

### Gates

Run these before handing work back; `pnpm verify` runs the same set as CI.

```bash
pnpm typecheck:webui        # server + client tsconfigs
pnpm test:webui             # the webui Vitest group
pnpm build:webui            # prints server/client input counts — a new file must raise them
pnpm check:webui-boundary   # nothing outside the allowed entries entered the graph
node scripts/source-inventory.mjs --write && pnpm check:source
git diff --check
```

`pnpm build:webui` printing the input counts is the cheapest proof that a new module is actually in
the build graph: a file that exists while the counts do not move has been written but never wired.
