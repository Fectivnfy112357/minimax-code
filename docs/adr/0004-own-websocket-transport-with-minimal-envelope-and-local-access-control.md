# The WebUI owns its transport: WebSocket, minimal envelope, loopback access control

Business payloads reuse the existing `@mavis/protocol/local` data structures, but
the WebUI adds its own thin envelope on top: request correlation, operation name,
protocol version, a response/error/event distinction, subscription identity, and
reconnect cursors. The process-local contract cannot be exposed as-is — it carries
`AsyncIterable` sources and `AbortSignal` contexts, and it contains no RPC envelope,
authentication headers or network identity of any kind.

The service binds to loopback only, validates Host and Origin, requires a
per-start credential, exposes an operation allowlist with runtime validation of
every request body, and bounds message size and backpressure. It reads files and
runs tools, so "a single local user" is not the same thing as "no access control".

## Considered Options

- **Passing data structures through with no envelope** — rejected: no way to
  correlate responses, terminate a subscription, or resume after a disconnect.
- **Restoring an HTTP front door inside the runtime** — not available: both
  `packages/local-runtime/src/http/` and `packages/local-runtime-v2/src/http/` are
  retired source paths that the public source check forbids.

## Consequences

The browser never receives provider credentials; the server resolves them. Remote
access is a separate decision, not a bind-address change: it would add
authentication, TLS or a trusted reverse proxy, CSRF and Origin policy, deployment
and upgrade handling, and a user-isolation model.
