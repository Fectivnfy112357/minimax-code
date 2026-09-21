# MiniMax Code

This repository is a fork of the public MiniMax Code projection. It carries two
products on one runtime: the existing terminal client, and a WebUI client that is
under construction. The vocabulary below is the language both clients and the
runtime already use, plus the terms this work introduces.

## Language

### Layers and clients

**Harness layer**:
Everything below the interface layer: the session, turn, agent and model services
that execute work and persist it. It exposes an in-process API only; it has no
network interface.
_Avoid_: backend, core, engine

**Client**:
An interface implementation that sits on the harness layer and exposes sessions to
a person or a program. This repository ships three of them inside `packages/tui`:
the interactive terminal (TUI), `exec` (headless), and ACP.
_Avoid_: frontend, UI layer, app

**WebUI client**:
The fourth client: a browser interface served by `packages/webui`, running as a
peer of the TUI against the same harness layer.
_Avoid_: web CLI, web front end for the CLI, web version

### Sessions

**Session**:
A durable unit of work with one working directory and one selected model, persisted
in the data directory.
_Avoid_: conversation, chat, thread

**Turn**:
One submitted request inside a session, from submission to completion, including the
tool execution and interactions it requires.
_Avoid_: request, run, task

**Working directory**:
The directory a session is bound to. It is the execution boundary for file and Git
tools, is chosen explicitly when the session is created, and cannot be changed
afterwards.
_Avoid_: cwd, project path, root

**Stream frame**:
The unit the harness pushes to a client while a turn runs. One frame may carry a
whole message, a text chunk, a runtime event, an action delta, a status change or a
resynchronisation notice.
_Avoid_: chunk, delta, event

**Resynchronisation (resync)**:
The state where a client's cursor has fallen outside the range the harness still
holds, so the client must discard its incremental view and reload authoritative
history.
_Avoid_: replay, reflow

**Permission prompt**:
A harness request asking the client to authorise a tool call before it runs.
_Avoid_: approval, confirmation, consent

**Questionnaire**:
A structured question the harness asks mid-turn. The turn stays paused until the
client answers, dismisses it, or the session is aborted.
_Avoid_: survey, form, prompt

### Runtime ownership

**Runtime owner**:
One running harness instance, identified per process. A session's live execution,
stream subscriptions and pending interactions belong to the owner that created
them.
_Avoid_: daemon, server, backend instance

**surface**:
The value a client declares to identify which interface it is, from the fixed set
the harness knows. It gates interaction capabilities and the cold-start execution
policy.
_Avoid_: client type, mode, channel

### Storage and repository

**Data directory**:
Where credentials, configuration and session history live. The CLI default is
`~/.minimax`; the WebUI client shares it.
_Avoid_: user data, profile dir

**Upstream**:
`MiniMax-AI/minimax-code`, the reviewed public projection of an internal monorepo.
This repository is a fork of it, and its history arrives through a three-way merge.
_Avoid_: origin, source repo, official repo
