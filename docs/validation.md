# Validation

Release checks for 0.1.0, run on 17 October 2026. These results describe the checks performed, not a guarantee that every agent client or hardware design is supported.

| Check | Result |
| --- | --- |
| TypeScript | `npm run check` passes. |
| Core, HTTP, MCP and real stdio integration | 44 tests pass on macOS with Node 22 and Node 26. |
| Chromium workflows | 8 tests pass, including a 390 px layout. |
| Production build | CLI/server bundle and browser assets build successfully. |
| Fresh package | Install, doctor, skill copying, browser API, MCP reads and explicit draft acceptance pass from a temporary directory containing spaces. |
| npm release | Registry installation of `hyperbench-workspace@0.1.0` passes the package checks on Node 22 and Node 26. A global install by the short name also launches the `hyperbench` executable successfully. The published archive matches the tested GitHub release. |
| Dependency audit | No known vulnerabilities reported by `npm audit --omit=dev` at check time. |
| Skill format | All three `SKILL.md` files pass the skill format validator. |

The automated browser tests cover project creation and persistence, local repository reading/search, document upload/link/removal, agent draft review, stale-save rejection, PDF images/text/download integrity, optional connection ports, and narrow-window navigation. Browser clicks also exercised the real PX4 project, Pixracer schematic pages, and connection setup.

The backend suite checks project boundaries, traversal and symlink rejection, binary/credential exclusions, bounded reads and responses, concurrent saves across processes, safe deletion, document rendering, missing blobs, Git clone behavior, HTTP authentication/origins, and interrupted-request shutdown. Symlink tests also disable `O_NOFOLLOW` to exercise platforms where the flag is unavailable. FIFO checks run only on POSIX.

## Real repository and document check

An existing local PX4 checkout was registered in an isolated workspace. Its original files were not modified.

| Operation | Observed time |
| --- | ---: |
| Register the already-cloned checkout | 8 ms |
| Bounded source search, three returned matches | 471 ms |
| Import and extract the five-page Pixracer PDF | 412 ms |
| Render a page-five connector crop | 36 ms |

The search reported truncation; this is not a complete-repository recall benchmark. Registration timing excludes Git download. Source reading returned the 78-line `msg/versioned/BatteryStatus.msg`. The page-five image was visually inspected for connector names, labels, and pin numbers. No OCR or electrical-net inference was claimed.

## Skills and provenance review

An independent reviewer compared all three skill texts with 11 selected documents from the requested reference repositories: workersio/skills, Seahan1/hardware-agency-agents, 0sec-labs/0, and greptileai/skills. The comparison found no shared normalized sequence of five or more words. This is a scoped originality check, not proof of uniqueness against every published document. Skill prose was written for this tool; third-party license notices retain their required wording.

A separate temporary firmware-parser scenario exercised source/document retrieval, diagnosis, and focused regression review. The base parser passed 589,824 generated cases. A changed parser reproduced a signedness failure with a four-byte frame: `54 00 80 d4`. The expected value was −327.68 °C; the changed parser returned +327.68 °C. That was a synthetic host-side test, not a physical hardware result or a live GitHub PR.

## Reproduce

```sh
npm ci
npm run check
npm test
npm run build
npx playwright install chromium
npm run test:ui
npm pack
node scripts/verify-package.mjs hyperbench-workspace-0.1.0.tgz
node scripts/verify-package.mjs --registry hyperbench-workspace@0.1.0
```

The package check installs into a temporary folder and removes it afterward. It requires package-registry access. The GitHub workflow also runs the backend matrix on Linux, macOS and Windows with Node 22/24, plus Chromium on Linux; consult that run for platform results.

The real stdio tests use an independent MCP SDK client process. No claim is made that every named desktop agent was installed or authenticated during this release check. Automatic OCR, hardware bench access, background indexing, and model execution are outside this package.
