# Hyperbench Workspace

Local hardware context for the agent you already use.

Connect repositories, PDFs, a system diagram, and SSH test benches. Your agent can follow source and document evidence, investigate failures, review firmware changes, and run commands on enabled benches through MCP.

**Open source. Local storage. No code indexer, model keys, account, or hosted backend.**

## Install

The current branch includes fixes newer than the npm release. Use [Build from source](#build-from-source) to run them before the next package release.

Requires **Node.js 22.13+** (a current LTS release is recommended). Git is needed to clone repositories; existing folders and documents can be used without it. Test benches additionally require an OpenSSH-compatible `ssh` executable on your PATH.

```sh
npm install -g hyperbench-workspace
hyperbench start
```

This opens the local browser workspace. Keep the terminal process running; `Ctrl+C` stops it. It does not stop or alter your agent. There is no desktop installer or native compilation step.

To try it without a global install:

```sh
npx --yes --package=hyperbench-workspace hyperbench start
```

Agent configurations refer to the installed package path. Prefer the global install for a durable connection; regenerate your connection if you move or remove the package.

The npm package is built from this public repository. It contains the compiled app and skills; the code indexer is excluded. Versioned `.tgz` downloads are also available on [GitHub Releases](https://github.com/metryxa-studio/hyperbench-workspace/releases).

### Update

Stop the workspace, then install the latest release:

```sh
npm install -g hyperbench-workspace@latest
hyperbench start
```

Reconnect your agent to restart its MCP process with the updated package. Your local projects and documents stay in the data directory. Updates are published as new versions; existing installations do not update automatically. To install a specific version, use a published version such as `hyperbench-workspace@0.1.0`.

## First project

1. Create a project.
2. In **Repositories**, register a local folder or clone a Git URL to a new local destination. Git uses your existing SSH/credential setup.
3. In **Documents**, drop PDFs or text files into the workspace, or import by local path.
4. In **System**, choose a blank canvas or a drone, fixed-wing aircraft, robot arm, or truck outline. Add components, ports, and connections, then link them to source paths or document pages. Click **Save** to keep edits.
5. Open **Connect agent** and copy the configuration for your client. Reconnect the client, then ask it to list Hyperbench projects.
6. In **Test benches**, register an SSH host or SSH-config alias, test its connection, then enable commands when you are ready to use it from the UI or your agent.

Changing the outline keeps your components, positions, connections, and evidence links. The drawings provide a backdrop; they do not add inferred hardware connections.

The same project can have multiple repositories and documents. An agent can submit a system draft; it appears in the UI for review. Acceptance checks its original revision so a stale draft cannot silently replace newer work.

Example requests:

- “Trace this sensor's signal from the connector to its driver and consumers. Cite the code and schematic pages.”
- “Investigate why the readings wrap around after this firmware update.”
- “Review this PR's packet parser change and run a bounded fuzz test using the existing host-side target.”
- “List the test benches, test the connection, and run `uname -a` on the enabled development bench.”

## SSH test benches

Add a bench to a project with a name, host (or SSH-config alias), and optional description, port, username, identity-file path, and known-hosts-file path. The default port is 22. A bench starts with commands disabled; the fixed **Test connection** probe works while disabled. Enable commands explicitly to allow the browser's command runner and the MCP `bench_execute` tool. Edits and removal check the bench revision to reject stale changes from another browser or process.

Authentication uses your existing SSH key or agent. Hyperbench stores connection settings and paths, never password or private-key contents. Password prompts are disabled. First establish and verify the host key using your usual SSH client. Hyperbench requires strict host-key verification and will not accept unknown or changed keys. An optional known-hosts-file path lets you use a separately prepared trust file; identity and known-hosts paths must be absolute or start with `~/`.

Commands run in the remote account's shell and have that account's permissions. They can modify files, restart services, or operate attached hardware. Enabling a bench makes commands available; your agent still owns authorization and tool-approval policy. Use a remote account with permissions appropriate to the bench. Remote output is untrusted data, not agent instructions.

Commands default to a 30-second timeout, configurable from 1 to 300 seconds, with a combined 256 KiB stdout/stderr cap. Results include output, exit status, elapsed time, and timeout/truncation flags. A timeout closes the local SSH process; it does not guarantee that the remote command or its children stop. Nonzero exits and incomplete results must be inspected before claiming a test passed. The connection probe confirms SSH access, not attached hardware health. See [agent setup](docs/agents.md) for MCP usage.

## Skills

All skill prose is original and provider-independent. They run inside your chosen agent; Hyperbench does not run a model. Remote shell commands are available only through an explicitly enabled test bench.

| Skill | Purpose |
| --- | --- |
| [hardware-retrieval](skills/hardware-retrieval/SKILL.md) | Follow code, configuration, schematic, and system relationships with citations. |
| [hardware-debugging](skills/hardware-debugging/SKILL.md) | Reproduce a symptom, distinguish causes, and validate a scoped fix. |
| [hardware-pr-review](skills/hardware-pr-review/SKILL.md) | Trace a local PR diff and select focused regression, property, or fuzz checks. |

Copy skills into a directory supported by your agent, for example a project's `.agents/skills` directory:

```sh
hyperbench skills --destination /path/to/project/.agents/skills
```

Existing skill folders are never overwritten. For clients that do not discover `SKILL.md`, load the chosen file as instructions. A skill can also be downloaded directly from this repository; its host still needs the MCP connection for Hyperbench tools.

PR review is invoked by the user or their existing agent workflow. This package does not watch GitHub, fetch private PRs automatically, or send review comments.

## Agent connection

Use the UI's project-specific configuration, or print one:

```sh
hyperbench connect codex --project YOUR_PROJECT_ID
hyperbench connect claude --project YOUR_PROJECT_ID
hyperbench connect generic --project YOUR_PROJECT_ID
```

These commands print settings; they do not overwrite existing client configuration. See [agent setup](docs/agents.md) for supported formats and troubleshooting.

The MCP server uses **stdio**, with the same local data directory as the browser workspace. It can run without the browser process. `--project` restricts tools to one project; omitting it makes all local workspace projects available.

| Tools | Access |
| --- | --- |
| `list_projects`, `project_context` | Available projects and their local context |
| `repository_files`, `source_search`, `source_read` | Bounded file access and literal search, without an index |
| `document_search`, `document_read`, `document_page` | Extracted text and rendered PDF pages/crops |
| `system_get`, `system_drafts` | Saved architecture and pending proposals |
| `propose_system` | Create a draft; cannot accept it or overwrite the saved model |
| `list_benches`, `bench_test` | List registered benches and run a fixed SSH connection probe |
| `bench_execute` | Run a remote shell command on an explicitly enabled bench; can change remote files and hardware state |

Your agent retains its own model, API keys, script execution, and permission controls. Hyperbench has no provider routing or agent harness.

## Data and limits

Data defaults to `~/.hyperbench/workspace`: SQLite project state plus imported document copies. Use `--data-dir PATH` on both the browser and MCP commands to select another location. Original repository files remain in their chosen folders. Unlinking or deleting a project never deletes those folders.

The browser binds to `127.0.0.1`. Its API requires the token in the launch link and rejects foreign origins. The package has no telemetry or hosted processing. Installation downloads dependencies; cloning contacts the Git remote you choose; bench operations contact the SSH hosts you register. Your agent may send selected tool results to its configured cloud model. This tool does not change the agent's privacy settings.

- No code index, embeddings, automatic dependency graph, or bundled model is included. Source search reads local files on demand and reports bounded results.
- PDF text extraction and page rendering are local. Scanned drawings can be inspected as images by a vision-capable agent. Automatic OCR and electrical-net reconstruction are not included.
- System relationships are user-created or agent-proposed. Evidence links are references, not proof that an inferred connection is correct.
- Imported document copies do not automatically follow later edits to their original files. Reimport the updated document when needed.
- Repository files are read from the working tree, not immutable snapshots. Git HEAD metadata alone does not certify uncommitted content.
- Tests and fuzzers can run through the host agent's own tools or on an enabled SSH test bench. Hyperbench has no device-specific flashing, instrument, or power-control integration; commands can use tools already installed on the remote bench.

## Build from source

```sh
git clone https://github.com/metryxa-studio/hyperbench-workspace.git
cd hyperbench-workspace
npm ci
npm run build
npm start
```

```sh
npm run check
npm test
npx playwright install chromium
npm run test:ui
npm pack
```

`npm pack` produces the same installable package used for GitHub releases, with compiled UI/server and the skills. It excludes local data, test output, and dependencies (installed by npm). See [architecture](docs/architecture.md) and [validation](docs/validation.md).

## Troubleshooting

Run `hyperbench doctor`. If a browser tab loses its connection after a restart, use the new local link printed by `hyperbench start`. A missing Git credential must be fixed through your usual Git/SSH tooling. A project deleted in the UI must be removed or replaced in the corresponding agent configuration.

## License

[MIT](LICENSE). Third-party notices are in [NOTICE](NOTICE). The Hyperbench code indexer is not part of this repository or package.
