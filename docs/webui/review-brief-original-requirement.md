# Original requirement (as captured from the user's messages)

## Status

This file is the **audit trail** for the WebUI TUI-harness migration
plan. It captures the user's original requirement and the decisions that
were locked in **before** the plan was written. The current plan is at
[`webui-tui-harness-migration.md`](webui-tui-harness-migration.md);
the companion ADR amendment is at
[`../adr/0011-shared-event-corpus-in-local-runtime-v2.md`](../adr/0011-shared-event-corpus-in-local-runtime-v2.md).

The plan was reviewed by two independent models:

- **codex luna** (`codex/gpt-5.6-luna`)
- **hermes deepseek v4.1** (`hermes/opencode-go:deepseek-v4.1-flash`)

Both reviewers returned a `REQUEST CHANGES` verdict. The plan and the
ADR amendment together address every BLOCKER, MAJOR and MINOR that
either reviewer raised. NITs were resolved in passing.

## Context

The repository at `/home/fectivnfy/my_data/project/my_project/minimax-code/`
contains a half-finished WebUI client at `packages/webui/`. Adjacent to the
repository, at `../minimax-webui/`, there is a separately developed WebUI
project that was extracted by unpacking the desktop (Electron + Windows NSIS)
application; the user describes it as "从 desktop 解包出来的 webui 项目".

## User's stated requirement

> 当前目录的上一层有一个 minimax webui 项目，这个项目是从 desktop 解包出来的
> webui 项目。
>
> 现在有个需求那就是基于 minimax 的 harness 进行开发 webui 的工作，如你所见开发了
> 一半也就是当前项目下的 webui 包，接下来的工作是继续在当前 webui 包的基础上
> 要把 tui 翻译成 webui，注意这里指的是 tui 层使用 harness 的方式，也就是要根据
> tui 迁移到 webui 的工作，但是只迁移后端逻辑也就是 tui 跟 harness 的交互逻辑，
> 就比如刚才的提示词，webui 使用的提示词应该是 tui 的，而当前项目的 webui 的
> 视觉层要通过刚才的 desktop 解包的 webui 进行迁移，这么说你能明白吗，当前的
> webui 项目要根据两个客户端进行迁移，后端逻辑从 tui 迁移过来，视觉效果要从
> desktop 迁移过来

## Decisions the user has locked in

1. **Backend logic from TUI**: only the **runtime-independent** parts of TUI's
   interaction with the harness, i.e. contracts and event projections. NOT a
   copy of tui's React/Ink rendering layer.
2. **Visual layer from desktop-extracted WebUI**: the visual language,
   component structure, page skeletons — re-authored as React components
   inside the existing `packages/webui/src/client/` tree. NOT a copy of the
   Next.js chunks, the compiled CSS, or the antd / Tailwind runtime.
3. **CSS compiled product**: do NOT carry over the 548 KB / 25 minified files
   from `../minimax-webui/app/out/_next/static/css/`. The visual language
   tokens in `packages/webui/src/client/styles/tokens.css` are the source of
   truth.
4. **Commands**: only the WebUI-applicable subset of `TUI_COMMAND_DESCRIPTORS`
   — `help`, `new`, `compact`, `status`, `usage`, `model`. Skip
   TUI-only commands.
5. **Settings modal sections** (lives inside `/archon`):
   - general (theme, language)
   - appearance (font size, density)
   - account (login state, sign out)
   - account-onboarding (re-entry)
   - model (selection, thinking level, context control)
   - data directory (relocate)
   - NOT: shortcut, notification, tray visibility, run-on-startup,
     power-save-blocker, Computer Use toggle
6. **KaTeX**: include the font files (2.2 MB / 30 woff+woff2+ttf) AND wire
   `katex` into `markdown.tsx` so `$...$` / `$$...$$` render.
7. **Pages** (v1 scope):
   - `/login`, `/onboarding`, `/archon`, `/404`
   - NOT: `/archon-mini-chat`, `/log-viewer`, `/pdf`, `/doc`, `/docx`
8. **Images**: include all 27 PNG/JPG image assets from
   `../minimax-webui/app/out/assets/img/`.
9. **ADR constraints to respect** (already in the repo):
   - ADR 0001: WebUI is a peer client of the harness, not a CLI wrapper.
   - ADR 0003: WebUI may READ tui internals as a reference, but must NOT
     IMPORT them. "Reading that code before writing the equivalent is
     expected; depending on it is not."
   - ADR 0009: WebUI reuses the desktop visual language.

## What to review

The implementation plan at
`docs/webui/webui-tui-harness-migration.md` (395 lines, new file).
Reviewers should focus on:

1. Does the plan faithfully express the user's requirement, or does it
   silently introduce or drop scope?
2. Are the locked-in decisions reflected correctly and consistently?
3. Does the plan respect the three ADRs (0001, 0003, 0009)?
4. Are the file paths and references correct against the current repo state?
5. Are there any obvious sequencing, verification or risk-assessment gaps?
6. Does the plan read as something that can actually be executed by a
   follow-up implementation step without re-deciding things?
