# Architecture

| Layer | Responsibility |
| --- | --- |
| `ui/` | Browser project navigation, repository/document viewers, system editor, draft review, SSH bench management and command runner |
| `src/server.ts` | Authenticated loopback HTTP API and static UI serving |
| `src/mcp.ts` | Project-scoped context tools, draft proposals, and registered bench tools over stdio |
| `src/core/` | SQLite metadata, filesystem boundaries, Git operations, PDF/text handling, SSH execution, revision checks |
| `skills/` | Retrieval, debugging, and PR review instructions for the host agent |
| `bin/` and `src/cli.ts` | Start, connect, skills, doctor, and MCP commands |

HTTP and MCP call the same workspace operations. SQLite coordinates separate processes. System saves compare their expected revision inside a transaction. A draft carries its base revision and cannot be accepted after the saved model changes.

Test benches are project-owned SQLite records. The authenticated browser API manages registration, updates, removal, connection testing, and commands. MCP exposes only listing, the fixed connection probe, and commands; an agent cannot register a host or enable a disabled bench through these tools. Bench updates and removal compare expected revisions. Every operation checks project membership, and project-scoped MCP connections reject calls to another project before workspace dispatch.

The SSH executor launches the local OpenSSH client without a local shell, using key/agent authentication and strict host-key checking. Optional identity and known-hosts file paths reference local files; key contents and passwords are not stored. Remote commands are shell commands on the registered host and can change hardware or files. Execution requires an enabled bench; the harmless fixed connection probe also works while disabled. Output is bounded to 256 KiB and commands default to 30 seconds (maximum 300 seconds). Killing the local SSH client on timeout does not guarantee termination of remote children. Host aliases can use the user's SSH configuration, so that configuration remains part of the user's trusted local environment.

MCP marks bench execution as writable, potentially destructive, non-idempotent, and open-world. Its connection probe is read-only and open-world. These annotations inform client policy; the client still owns user authorization and approvals. Tool output from a remote host is untrusted evidence, not instructions to the agent.

The browser listens only on the IPv4 loopback address. API routes require a random bearer token, exact host, and same-origin requests. The token is passed in a URL fragment, removed from the displayed URL, and kept in session storage. Static responses cannot read user state. Original document downloads require the same authentication and use attachment disposition.

Repository registration stores paths. Reads validate project membership, relative paths, resolved containment, file types, and size bounds. Searches are bounded operations over current files; nothing builds a code index. Repositories are not deleted when context is removed. Document imports are local copies; PDF extraction/rendering runs in this process without contacting a service.

There is no Code-OSS shell, provider harness, embedding store, cloud account, webhook listener, Rust code indexer, or shared credential. A standard browser and Node runtime are the local execution environment.

## Public-source boundary

This repository began with fresh Git history. Only the context workspace and its own assets belong here. Do not copy private application histories, customer repositories, extracted documents, model credentials, local SQLite files, or the separate code indexer into it.

Skill organization was informed by the repositories named in the product request: workersio/skills, Seahan1/hardware-agency-agents, 0sec-labs/0, and greptileai/skills. No prose or skill implementation was copied from them.
