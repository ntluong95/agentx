# AgentX

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo.svg">
  <img src="assets/logo-light.svg" alt="AgentX" width="72" height="72">
</picture>

Ask for a change; AgentX takes it through design approval, implementation,
independent review, and a pull request you merge.

https://github.com/user-attachments/assets/83ec539a-6551-4807-8517-0c73e5d171d7

[YouTube](https://www.youtube.com/watch?v=6pRWkhlQSAc)

## Contents

- [Quickstart](#quickstart)
- [Project setup](#project-setup)
- [Install](#install)
- [How AgentX works](#how-agentx-works)
- [Log](#log)
- [Troubleshooting](#troubleshooting)

## Quickstart

Install Orca, then AgentX.

1. Install the [desktop app](https://www.onorca.dev/docs/install).
2. Register the CLI (it ships with the app): Settings → General → Orca CLI.
   See the [CLI overview](https://www.onorca.dev/docs/cli/overview).
3. Enable orchestration: Settings → Experimental. See
   [orchestration](https://www.onorca.dev/docs/cli/orchestration).
4. Preflight:

```bash
orca open
orca status --json
orca orchestration run-list --json
```

`agentx:delivery` stops if this preflight fails. On Linux the binary is
`orca-ide` (see the [install docs](https://www.onorca.dev/docs/install)).

Optional agent skills `orca-cli` and `orchestration`:
https://www.onorca.dev/docs/cli/skills

Then:

1. Install `agentx` in the harness ([Install](#install)).
2. Open a session in the project.
3. Invoke `agentx:setup` (optional).
4. Ask for a change.

## Project setup

In the project, invoke `agentx:setup`.

It asks Quick (this harness for both phases) or Customize (pick harness,
model, and effort for `implement` and `review`), then writes one managed
block into `AGENTS.md`. Skip it and `agentx:delivery` uses the current
harness and that harness's defaults.

## Install

The plugin is `agentx`, published from `https://github.com/ntluong95/agentx.git`. The skill name is `delivery`; invoke it as `agentx:delivery`. The runtime needs Node 18 or newer on PATH.

Four harnesses are supported today: Claude Code, Codex CLI, Cursor
Agent CLI, and OMP. That list is not closed. `harnesses.json` at the
repository root carries four more as `deferred`: GitHub Copilot CLI,
Antigravity CLI, Grok Build, and Kiro CLI.

### Claude Code

```bash
claude plugin marketplace add https://github.com/ntluong95/agentx.git
claude plugin install agentx@agentx

claude plugin list                 # verify it is installed
claude plugin update agentx          # update (restart required to apply)
claude plugin uninstall agentx       # uninstall
```

A Claude Code Control was observed running `scripts/agentx` straight out of
the marketplace source directory it was added from, not from
`~/.claude/plugins/cache`. A hash check that covers only the cache proves
nothing; it must cover every location that can serve the skill.

### Codex CLI

```bash
codex plugin marketplace add https://github.com/ntluong95/agentx.git
codex plugin add agentx@agentx

codex plugin list                  # verify it is installed
codex plugin marketplace upgrade   # update: see below
codex plugin remove agentx@agentx      # uninstall
```

`codex plugin marketplace add --ref <ref>` pins the marketplace to a tag
such as `v0.17.0` or an exact full commit SHA. There is no
`codex plugin update`: use `codex plugin marketplace upgrade`. Do not use
`codex plugin install`.

`codex plugin marketplace add` was observed keeping a stale marketplace of
the same name, installing the previous version, and reporting success. A
harness reporting a successful install is not evidence. To refresh, remove
the marketplace and the plugin, then add and install again.

### Cursor Agent CLI

```bash
cursor-agent plugin marketplace add https://github.com/ntluong95/agentx.git

# verify it is installed
cursor-agent plugin marketplace list

# re-index, no fetch
cursor-agent plugin marketplace update agentx

# refresh: remove and re-add (remove drops the marketplace, not the plugin)
cursor-agent plugin marketplace remove agentx
cursor-agent plugin marketplace add https://github.com/ntluong95/agentx.git
```

Cursor Agent CLI cannot install from a local snapshot:
`cursor-agent plugin marketplace add` takes a git URL only, and installing
what it indexes needs the interactive `/plugin` panel. It reads the Claude
plugin cache; a Cursor copy with a different hash wins over that cache.

The snapshot is addressed by commit, so `marketplace update` only re-indexes
and does not fetch. Remove and re-add the marketplace to pick up new commits,
then choose `Uninstall` from the `Installed` tab and install again from the
`Marketplace` tab of the `/plugin` panel.

Add the marketplace first with `cursor-agent plugin marketplace add`, then in
a Cursor Agent session type `/plugin` and press Enter. Open the `Marketplace`
tab, type `agentx` in the search box, press Enter on `agentx (agentx)`, and choose
`Install for you (user scope)` (or `Install for all collaborators on this
repository (project scope)`).

To uninstall, open the `Installed` tab, select `agentx`, and choose
`Uninstall`. `cursor-agent plugin marketplace remove` removes the marketplace
entry and leaves the plugin installed.

Type `/agentx` to filter the palette to AgentX's `/delivery` and `/setup`.

### OMP

Install from a dedicated clone, or unpack a git-archive snapshot. Never
point `omp plugin install` at a working checkout of this repository: that
command links the path rather than copying it, so OMP runs whatever the
checkout holds.

```bash
git clone https://github.com/ntluong95/agentx.git agentx
# or unpack a git archive snapshot
omp plugin install /path/to/agentx

omp plugin list --json             # verify it is installed
omp skill list --json              # verify the skills loaded

# update: git pull in that dedicated clone, then a new OMP session
omp plugin uninstall agentx          # uninstall; needs bun on PATH
omp plugin disable agentx            # stop OMP loading AgentX's skills and extension
```

When `bun` is absent, `omp plugin uninstall agentx` is unavailable.
`omp plugin disable agentx` stops OMP loading AgentX's skills and extension; it
leaves `agentx` in `omp plugin list`. Then delete
`~/.omp/plugins/node_modules/agentx`, `rmdir` the then-empty
`~/.omp/plugins/node_modules` directory, and rewrite
`~/.omp/plugins/omp-plugins.lock.json` with `jq 'del(.plugins.agentx)'`.

The `agentx` marketplace does not install OMP's extension. Installing from a
git URL was not checked.

AgentX's `setup` and `delivery` are not namespaced in OMP and take precedence
over a project's own skills of those names. OMP has no workspace-trust gate:
a repository's `.omp/extensions`, `.omp/skills` and `.omp/config.yml` take
effect without a prompt, and approvals follow the user's
`tools.approvalMode`.

To pin OMP, set Model to a `selector` from `omp models --json` and Effort
to one of that model's `thinking` levels. The helper appends
`agentx-pin: <selector>` or `agentx-pin: <selector> <effort>` to the spec.
No `.omp/config.yml` is needed.

### Checked versions

These are the versions this README's commands were last locally checked
against — observations, not a promised minimum:

| Tool | Checked version |
| --- | --- |
| Claude Code | 2.1.274 |
| Codex CLI | 0.154.0 |
| Cursor Agent CLI | 2026.09.15-d2fe57e |
| OMP | 18.3.4 |
| Orca | 1.4.212 |

## How AgentX works

Ask for a change. Approve the design when asked. AgentX implements, a
different session reviews, then opens a PR. You merge. A Spike investigates
only — no delivery run.

### Repository graph contracts

AgentX can validate and compile a repository-stored Mermaid flowchart into a
deterministic task manifest without starting Orca:

```bash
skills/delivery/scripts/agentx validate-graph --graph path/to/workflow.mmd
skills/delivery/scripts/agentx compile-graph --graph path/to/workflow.mmd
```

It can also prepare or materialize that manifest through Orca. A dry run writes
the deterministic operation ledger and performs no Orca mutation:

```bash
mkdir -m 700 .agentx-journal
skills/delivery/scripts/agentx materialize-graph \
  --graph path/to/workflow.mmd \
  --journal .agentx-journal/workflow.json \
  --orca /absolute/path/to/orca \
  --dry-run
```

Omit `--dry-run` only in a disposable or approved environment. The journal
directory must already be private (`0700`) or be created by AgentX; AgentX
records deterministic Orca request ids before each mutation and recovers lost
responses through `request-show`.

The graph mode is opt-in. Mermaid arrows are task dependencies. Same-file
`%%@agentx { ... }` JSON comments carry policy such as agent, workspace,
fallback and artifact metadata. Existing `agentx:delivery` behavior is
unchanged.

Live provider probes and recovery scenario initializers call real Orca commands and create live runs,
so they refuse to start unless `--approve-live` is supplied:

```bash
node probe/run-orchestration-probes.js --provider codex --approve-live
node probe/run-orchestration-probes.js --scenario crash-recovery --approve-live
```

Control loads `orca skills get orchestration` and follows that supervised
loop. `agentx preflight` runs in setup, and again after `NO_ACK`. After
`DISPATCHED`, Control waits by the harness Control wake: `background`
runs `agentx wait`; `waker` runs `agentx wait-bg` as its last command and
ends the turn. It never acts on an Orca nudge. `SETTLED` hands over the
batch; `ATTENTION` with a `nextAction` other than `none` runs the argv Orca
printed, and `ATTENTION` with `nextAction: none` and `requiresAction` means
the plane lost sight of the worker — check it, stop, abandon and release it,
then dispatch the same prompt file once more; `STALLED` is read then waited
or recovered; `NO_ACK` and `FAILED` retry once; `DEADLINE` is a checkpoint
(`worker-list` and last output; wait again if progressing; a second
`DEADLINE` with no progress goes to the human); `ERROR` goes to the
human.

The workflow contract is [`skills/delivery/SKILL.md`](skills/delivery/SKILL.md).

## Log

`~/.agentx/log.jsonl` is machine-local JSON Lines, one object per line. It
is off unless `~/.agentx/` exists; `mkdir ~/.agentx` turns it on, and AgentX
never creates that directory. A missing directory means nothing is
written and nothing is created.

The file may contain sensitive content. It quotes worker screen output
in full, so it can hold repository contents, error text, and whatever a
harness printed.

## Troubleshooting

- **`agentx:delivery` stops immediately.** Orca is not running or a required
  capability is absent, including orchestration. Run the Quickstart
  preflight, then retry.
- **A stale skills copy shadows a newer plugin.** Codex also loads
  `~/.agents/skills`, and a copy left there — or a symlink to it from
  `~/.claude/skills` — wins over the plugin. Claude Code was observed
  running `scripts/agentx` from the marketplace source directory, not from
  `~/.claude/plugins/cache`. Cursor Agent CLI reads the Claude plugin
  cache, and a Cursor copy with a different hash wins over it. Compare
  `skills/delivery/SKILL.md` by hash at every location that can serve the
  skill, including marketplace source directories, then update or remove
  the shadowing install. A harness reporting a successful install is not
  evidence of which copy ran; the hash is.
- **Codex still behaves the same after `codex plugin marketplace upgrade`.**
  Confirm the remote has new commits. A delivery already running keeps the
  plugin version from its start; open a new session after the upgrade.
- **`AGENTS.md` pins don't seem to apply in Claude Code.** Put
  `@AGENTS.md` in `CLAUDE.md`; Claude Code does not read `AGENTS.md`
  directly.

## Contributing, security, and license

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — issue-first workflow, fork/branch/pull
  request flow, and review expectations. External contributors do not need
  AgentX or Orca.
- [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) — Contributor Covenant 2.1.
- [`SECURITY.md`](SECURITY.md) — how to report a vulnerability privately.
- [`docs/decisions.md`](docs/decisions.md) — settled, open, and rejected
  design decisions, with rationale.

[MIT](LICENSE)
