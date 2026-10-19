# Validation

Application checks below were run on 18 October 2026. Skill checks were added on 19 October. These results cover the tested paths, not a guarantee that every client or hardware target works.

| Check | Result |
| --- | --- |
| TypeScript and production build | Pass. |
| Backend, HTTP, and MCP | 58 pass; the optional live-SSH test is skipped without a disposable target. |
| Chromium workflows | 31 pass, including narrow layouts, delayed responses, partial failures, persistence, and reconnecting. |
| Fresh package install | Startup, paths with spaces, skills, browser APIs, MCP, and explicit draft acceptance pass on Node 26. |
| Runtime dependency audit | No known vulnerabilities reported at check time. |

The browser suite covers projects, system editing, outlines, evidence links, document import/render/download, repository reads/search, draft review, concurrent saves, agent configuration, and bench settings/command results. The backend suite checks filesystem boundaries, credential exclusions, bounded responses, malformed input, project isolation, revision conflicts across processes, stdio MCP, and interrupted requests. SSH process tests use a controlled executable to verify arguments, timeouts, and output limits.

## Reproduce

```sh
npm ci
npm run check
npm test
npm run build
npx playwright install chromium
npm run test:ui
npm pack
node scripts/verify-package.mjs hyperbench-workspace-0.1.1.tgz
```

The package verifier installs into a temporary directory containing spaces and checks startup, skills, browser APIs, MCP reads, and draft acceptance. It requires registry access and removes its temporary installation afterward. Tests, screenshots, traces, temporary user state, and dependencies are excluded from the published package.

The GitHub Check workflow runs backend/build checks on Linux, macOS, and Windows with Node 22/24, plus Chromium on Linux. Consult the workflow run for results on a specific commit.

## Optional live SSH check

Prepare a disposable SSH target and a JSON file outside the repository containing `host`, `port`, `username`, `identityFile`, and `knownHostsFile`. Use absolute paths for the key and verified host-trust file. The target needs a POSIX shell with `printf`, `uname`, `hostname`, `pwd`, `sleep`, and `yes`.

```sh
HYPERBENCH_SSH_TEST_CONFIG=/absolute/path/connection.json npm test
```

This checks a connection probe, remote output and exit status, timeout/output limits, and host-key rejection through a real MCP client. It does not establish hardware health or guarantee remote processes stop after an SSH timeout.

## Skill checks

The three expanded skills passed frontmatter validation and a review against the implemented MCP tools. A fresh package install copied all nine skill Markdown files, including nested references, byte-for-byte into a destination with spaces. A repeated installation refused to overwrite them.

An agent that did not author the skills investigated three synthetic fixtures without being given the expected answers:

| Fixture | Observed result |
| --- | --- |
| Conflicting board revisions and a missing schematic image | Traced the selected software route and left the connector pin unresolved; did not treat an old saved diagram as proof. |
| Commands rejected after a controller session changed | Replayed the capture, identified retained sequence state, and tested a state intervention while preserving duplicate-rejection controls. No physical motion was claimed. |
| Packet-decoder PR | Ran the same 7,476 generated cases on each revision with native sanitizers. Base passed; head exposed one trailing-byte acceptance regression through 3,121 failing input variants. |

The evaluation found an ambiguous assumption that MCP was always available; the retrieval skill now explicitly supports supplied local artifacts. Temporary fixtures, binaries, and reports were kept outside the repository. These checks establish behavior on these examples, not a measured improvement over the old skills or performance across hardware targets. The historical public bugs discussed in the references were source-checked, not rerun in this skill update.

## Release and scope

The npm registry remains at 0.1.0. Current source changes are not published there; the existing 0.1.1 GitHub archive also predates these fixes. Build from the current source to use them.

All skill prose and worked examples were written for this tool. A scoped comparison of the nine skill files against 55 pinned reference files from workersio, Caveman, and hardware-agency-agents found no shared normalized sequence of six or more words. Two five-word matches were reviewed as ordinary connective language. This is a phrase-overlap check, not a universal originality guarantee or a semantic-plagiarism test. Required license notices remain intact.

Automatic OCR, code indexing, and model execution are outside this package. Agents retain their own model, permissions, and approval policies. A passing stdio MCP check does not establish compatibility with every desktop agent client.
