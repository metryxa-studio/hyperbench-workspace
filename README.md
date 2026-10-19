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

In **Test benches**, register a host or SSH-config alias and test the connection. Commands start disabled; enable them to use the browser command runner or the agent's `bench_execute` tool. Authentication uses your existing SSH key or agent and a verified host key. Hyperbench stores settings and file paths, never passwords or private-key contents.

Commands run with the remote account's permissions and can change files or attached hardware. Your agent retains its authorization and approval policy. A successful connection probe confirms SSH access only; a timeout does not guarantee that remote processes stop. See [agent setup](docs/agents.md#ssh-benches) for authentication, deadlines, output limits, and result handling.

## Skills

Skills run inside your chosen agent; Hyperbench does not run a model. Remote shell commands are available only through an explicitly enabled test bench.

| Skill | Purpose |
| --- | --- |
| [hardware-retrieval](skills/hardware-retrieval/SKILL.md) | Follow code, configuration, schematic, and system relationships with citations. |
| [hardware-debugging](skills/hardware-debugging/SKILL.md) | Reproduce a symptom, distinguish causes, and validate a scoped fix. |
| [hardware-pr-review](skills/hardware-pr-review/SKILL.md) | Trace a local PR diff and select focused regression, property, or fuzz checks. |

Each skill includes focused references and a worked example. Agents read the relevant detail as needed: tracing pins and code, distinguishing failure mechanisms, or designing checks that can reproduce a regression.

Copy skills into a directory supported by your agent, for example a project's `.agents/skills` directory:

```sh
hyperbench skills --destination /path/to/project/.agents/skills
```

Existing skill folders are never overwritten or updated automatically. For clients that do not discover `SKILL.md`, load the chosen file as instructions. To download a skill directly from this repository, keep its entire folder, including `references/`. The skills can guide local-file investigation; using Hyperbench tools requires an MCP connection.

PR review is invoked by the user or their existing agent workflow. This package does not watch GitHub, fetch private PRs automatically, or send review comments.

### Equipment skills from documents

In **Documents → Equipment skills**, select the equipment's datasheets or manuals, enter its model/revision, and copy the request into your connected agent. The agent reads the selected pages and proposes an equipment-specific debugging skill. Review the draft in the browser, accept it, then download `SKILL.md`. Put that file inside a named skill folder supported by your agent; Hyperbench does not install it automatically.

Drafts retain the imported document names, page ranges, and hashes. A useful skill connects a symptom to evidence, a diagnostic check, and an expected observation. Document-derived instructions remain untested until supported by actual test results. Accepting a draft does not certify the equipment. Generation uses your agent and its model/privacy settings; Hyperbench stores drafts locally and makes no model calls.

The debugging skill also includes [version-specific platform guidance](skills/hardware-debugging/references/platform-evidence.md) and an [equipment authoring workflow](skills/hardware-debugging/references/equipment-skills.md).

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
| `equipment_skills`, `propose_equipment_skill` | Read equipment skills and propose document-grounded drafts; acceptance and download stay in the browser |
| `list_benches`, `bench_test` | List registered benches and run a fixed SSH connection probe |
| `bench_execute` | Run a remote shell command on an explicitly enabled bench; can change remote files and hardware state |

Your agent retains its own model, API keys, script execution, and permission controls. Hyperbench has no provider routing or agent harness.

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
node scripts/verify-package.mjs hyperbench-workspace-0.1.1.tgz
```

`npm pack` produces the same installable package used for GitHub releases, with compiled UI/server and the skills. It excludes local data, tests, and dependencies (installed by npm). The package verifier installs into a temporary directory and checks startup, skill installation, browser APIs, and MCP. It requires registry access and removes the temporary installation afterward.

For the live SSH integration test, prepare a disposable target and a JSON file outside the repo containing `host`, `port`, `username`, `identityFile`, and `knownHostsFile`. Use absolute paths to the key and verified trust file. The target needs a POSIX shell with `printf`, `uname`, `hostname`, `pwd`, `sleep`, and `yes`.

```sh
HYPERBENCH_SSH_TEST_CONFIG=/absolute/path/connection.json npm test
```

The live test is skipped when this variable is absent. CI runs backend/build checks on Linux, macOS, and Windows with Node 22/24, plus Chromium on Linux.

## Troubleshooting

Run `hyperbench doctor`. If a browser tab loses its connection after a restart, use the new local link printed by `hyperbench start`. A missing Git credential must be fixed through your usual Git/SSH tooling. A project deleted in the UI must be removed or replaced in the corresponding agent configuration.

## License

[MIT](LICENSE). Third-party notices are in [NOTICE](NOTICE). 
