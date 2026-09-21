# The first version assembles the full tool capability set

The first WebUI version ships the same tool capabilities as the terminal client:
local tools, mcode-tools and Browser Use. It would have been cheaper to ship local
tools only, but a client that cannot run the agent's browser work is not a
substitute for the terminal, and the assembly cost does not fall when it is
deferred — it is the same wiring, found later.

The non-obvious part: the WebUI runs in a browser, but that browser is not the
agent's browser provider. Browser Use needs an explicit adapter, tool exposure,
asset registration and questionnaire admission binding in the host assembly, and a
lifecycle that closes the provider on shutdown. Hosting the client in a browser buys
nothing here.

## Consequences

The WebUI host assembly carries the same broker readiness and provider lifecycle
work the terminal client does, and cannot be reduced to passing capability flags
into the host. Its shutdown path must release both.
