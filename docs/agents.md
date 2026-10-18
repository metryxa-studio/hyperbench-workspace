# Connect your agent

Hyperbench implements standard MCP over stdio. The agent starts a local process and exchanges tool requests with it. No Hyperbench account or provider credential is needed.

Create a project in the UI, then use **Connect agent** to get its ID, your data directory, and the absolute executable path. A project-scoped connection prevents this server from reading another project's context. The host agent's own filesystem tools retain their existing permissions.

## Client formats

| Client | Setup |
| --- | --- |
| Codex | `hyperbench connect codex --project ID` prints a TOML section for the client's configuration. |
| Claude Code | `hyperbench connect claude --project ID` prints a registration command. |
| Cursor | `hyperbench connect cursor --project ID` prints an `mcpServers` JSON entry. |
| Gemini CLI | `hyperbench connect gemini --project ID` prints an `mcpServers` JSON entry. |
| Other MCP clients | Use `hyperbench connect generic --project ID` and adapt the entry to the client's documented configuration location. |

Preserve existing configuration. The printer does not install or modify the client. Restart/reconnect its MCP connection after changing settings. Do not paste the browser's session token into client configuration: stdio does not use it.

The launch command is the installed Node executable with these arguments:

```text
/path/to/hyperbench-workspace/bin/hyperbench.mjs mcp --data-dir /path/to/data --project PROJECT_ID
```

Use absolute paths. The UI supplies them, including paths with spaces. If the client cannot find Node or the package, regenerate the configuration after reinstalling. Multiple clients can connect to the same SQLite workspace. Review drafts in the browser; the server has no tool that accepts a draft.

## Skills

Install the three folders under `skills/` into a skill directory your client supports, or load one `SKILL.md` as instructions. Use the host's own tools and approvals to run tests or fuzzers. The skills do not install compilers, send PR comments, or authorize bench operations.

## Verify

Ask the agent to call `list_projects`, then `project_context` for the configured project. It should see the repositories and documents visible in the UI. Ask for one source line range and one document page before relying on a larger task.

For PDF diagrams, the client and model must support image tool results. Text-only clients can still search extracted text. Request a crop when pin labels are too small; missing OCR text does not mean the PDF is empty.

## Locality

Hyperbench does not initiate model calls. Tool results go to the agent that requested them; that agent may send them to a cloud model. Model choice, retention settings, shell permissions, and network access remain controlled by the user's agent.

Protocol references: [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk), [OpenAI MCP setup examples](https://developers.openai.com/learn/docs-mcp). These describe integration formats; they are not a claim that every client/version was tested here. See the validation report for actual checks.
