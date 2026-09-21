# @mavis/webui

Browser client and loopback service for the process-local harness layer. The
package owns the authenticated WebSocket envelope, session/stream transport,
interaction replies, queue admission, model and usage inspection, and the
React client shell described by the WebUI v1 scope.

## Boundaries

- Server code and client code each type-check under their own
  `tsconfig.server.json` and `tsconfig.client.json`. The standalone
  `tsconfig.standalone.json` does not cover either.
- The browser bundle has its own metafile under `dist-webui/metafile.json`
  and is checked by `scripts/check-webui-boundary.mjs`.
- The terminal renderer (`packages/tui/src/tui/`) must not appear in the
  WebUI build graph.
- The server adapter forwards the WebSocket connection signal to runtime
  stream delivery. Closing a browser connection releases that stream iterator
  without calling the explicit session-abort operation.
- A composer submission made during an active turn uses `enqueueMessage`; the
  queue list is refreshed and only an unstarted (`queued`) item is removable.

## Scripts

- `pnpm --filter @mavis/webui typecheck:server`
- `pnpm --filter @mavis/webui typecheck:client`
- `pnpm --filter @mavis/webui test`
