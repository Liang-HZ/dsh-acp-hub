# dsh-acp-hub

Observable ACP (Agent Client Protocol) delegation hub for **DeepSeek Harness** (`dsh` >= `0.2.2-rc.1`).

将 DeepSeek Harness 中的任务异步委派给本地任意外部 ACP 智能体（MiniMax Code、OpenCode、CodeBuddy、Codex、Claude Code、Qoder、Gemini CLI、ZCode 或自定义 CLI），实时流式镜像到原生 DSH 子会话，支持多轮按需续接、逐轮用量核算、会话级 MCP 联动注入与原生 MCP / Skills 真源透视。

---

## Features / 核心功能

- **Asynchronous ACP Delegation & Native Child Sessions**
  - Registers `delegate_acp`, `list_acp_agents`, per-agent direct tools & `/<agent>` slash commands, plus `/acp-stop` for cancellation.
  - Streams live reasoning, text, plans, and coalesced parallel/straggler tool calls into DSH `session-acp-*` logs that pass DSH `0.2.2+` format validation and cold restore cleanly.
  - Supports configurable per-agent session continuation (`allowResume`) with human follow-up inside the subagent pane or strict clean-slate isolation.
- **Per-Step Usage & Status Dock**
  - Projects `sessionStats`, `tokenUsage`, `contextPressure`, `contextBreakdown`, `subagent`, and `subagentTiming` for full activity/token/context-ring display inside ACP child panes.
  - Supports SQLite step-level attribution for MiniMax (`~/.minimax/v2/sqlite/runtime-state.sqlite`) and ZCode (`~/.zcode/cli/db/db.sqlite`), as well as standard ACP `usage_update` reporting.
- **Live Model, Reasoning Effort & Permission Mode Sync**
  - Probes each ACP agent's live `session/new` models, per-model reasoning efforts, and native permission modes, with a two-column provider/model cascading selector.
  - Collapses low-frequency command-line (`command` + `args` via POSIX shell tokenization), fixed `cwd`, and environment variables into a compact drawer while keeping daily toggles at the top.
- **Dynamic Session MCP Linkage & True-Source Inspector**
  - Merges active DSH host MCPs (from runtime Cordis `loader` and `cordis.patch.yml`) with each client's local MCP config (supports ZCode, MiniMax, CodeBuddy, OpenCode, Codex TOML, Claude Code, and Qoder), redacting credentials from UI APIs.
  - Automatically locks (`checked` + `disabled`) MCP servers already enabled in the target client and skips duplicate injection at `session/new` / `session/resume`, while letting you inject disabled or DSH-only MCPs per delegation session.
  - Inspects native MCP servers and local Skills side-by-side with read-only true-source jump actions (`open`, Finder reveal). Automatically detects optional local tools (`Magpie.app` and `Skills Hub` on `127.0.0.1:7799`) when installed on macOS.

---

## Supported ACP Agents / 支持的客户端预设

| Agent ID | Name | Default Command Line | Notes |
|---|---|---|---|
| `minimax` | MiniMax Code | `mcode acp` | Official ACP subcommand |
| `opencode` | OpenCode | `opencode acp` | Official ACP subcommand |
| `codebuddy` | CodeBuddy | `codebuddy --acp` | Official ACP flag |
| `codex` | Codex | `codex-acp` | Official ACP bridge |
| `claude` | Claude Code | `claude-agent-acp` | Official ACP bridge |
| `qoder` | Qoder | `qodercli --acp` | Official ACP flag |
| `gemini` | Gemini CLI | `gemini --acp` | Official ACP flag |
| `zcode` | ZCode | `zcode-acp` | Requires a local ACP adapter binary (`zcode-acp`) on `PATH` or `~/agentrelay/zcode-acp` |

You can also add any custom ACP-compatible command line directly from the **ACP Hub** settings panel.

---

## Installation / 安装

Install from GitHub using DeepSeek Harness CLI (`dsh`):

```sh
dsh plugin add github:Liang-HZ/dsh-acp-hub
```

Or add the repository URL in **DSH Settings → Plugins**. Restart DeepSeek Harness (or reload the desktop profile) after installing, then open **ACP Hub** from the sidebar panel list to add and enable agents.

> Note: User agent settings persist in `~/.dsh/acp-hub.json` (and automatically migrate from legacy `~/.dsh/acp-mirror.json` if present).

---

## Verification / 本地验证

```sh
npm install
npm run test:contract
```

`npm run test:contract` runs syntax checks (`node --check index.js && node --check client.js`) and executes `runHostContractSmokeTest()` covering DSH v4 parallel/straggler tool invariants, POSIX command-line round-trip parsing, multi-source YAML/JSON MCP discovery & credential redaction, ACP wire-format conversion, MiniMax SQLite normalization, decorative event resilience, and legacy config migration.

---

## License

[MIT](./LICENSE)
