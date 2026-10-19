# Validation

Application and equipment-skill checks below were run on 19 October 2026. These results cover the tested paths, not a guarantee that every client or hardware target works.

| Check | Result |
| --- | --- |
| TypeScript and production build | Pass. |
| Backend, HTTP, and MCP | 66 pass; the optional live-SSH test is skipped without a disposable target. |
| Chromium workflows | 33 pass, including narrow layouts, delayed responses, partial failures, persistence, and reconnecting. |
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

All three skills passed frontmatter validation and a review against the implemented MCP tools. The package includes all eleven skill Markdown files and the four-file equipment example. A fresh installation into a path containing spaces passed; repeating skill installation refused to overwrite existing files.

An agent that did not author the skills investigated three synthetic fixtures without being given the expected answers:

| Fixture | Observed result |
| --- | --- |
| Conflicting board revisions and a missing schematic image | Traced the selected software route and left the connector pin unresolved; did not treat an old saved diagram as proof. |
| Commands rejected after a controller session changed | Replayed the capture, identified retained sequence state, and tested a state intervention while preserving duplicate-rejection controls. No physical motion was claimed. |
| Packet-decoder PR | Ran the same 7,476 generated cases on each revision with native sanitizers. Base passed; head exposed one trailing-byte acceptance regression through 3,121 failing input variants. |

The evaluation found an ambiguous assumption that MCP was always available; the retrieval skill now explicitly supports supplied local artifacts. Temporary fixtures, binaries, and reports were kept outside the repository. These checks establish behavior on these examples, not a measured improvement over the old skills or performance across hardware targets. The historical public bugs discussed in the references were source-checked, not rerun in this skill update.

## Equipment skills

The browser checks cover source selection, clipboard denial, draft polling, failed acceptance and retry, accepted-only export, persistence, removal, and the 20-skill/24-source limits. Backend and MCP checks cover project isolation, canonical document hashes, page bounds, immutable review, concurrent access, and referenced-document deletion. An actual stdio session read the example document and submitted a draft that was reviewed in the browser.

An independent agent received the fictional device specification, faulty decoder, checks, and debugging guidance without the expected diagnosis. In a temporary copy it reproduced the three failures, repaired revision selection, and passed all twelve checks. An exhaustive comparison covered all 512 byte/revision combinations and preserved all 256 revision B outputs. The repository example intentionally retains the fault so others can reproduce the workflow.

This establishes behavior on one synthetic host example. It is not a skill-versus-no-skill comparison, a physical hardware test, or a measured performance improvement. The new references, application changes, and example are independently authored; no IoT-SkillsBench tasks, code, or skill text are bundled.

## Release and scope

The equipment-skill changes require a source build. They are not included in the existing npm 0.1.0 release or the earlier 0.1.1 GitHub archive.

All skill prose and worked examples were written for this tool. A scoped comparison of the nine skill files against 55 pinned reference files from workersio, Caveman, and hardware-agency-agents found no shared normalized sequence of six or more words. Two five-word matches were reviewed as ordinary connective language. This is a phrase-overlap check, not a universal originality guarantee or a semantic-plagiarism test. Required license notices remain intact.

Automatic OCR, code indexing, and model execution are outside this package. Agents retain their own model, permissions, and approval policies. A passing stdio MCP check does not establish compatibility with every desktop agent client.
