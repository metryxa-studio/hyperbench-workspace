---
name: hardware-pr-review
description: Review a hardware or firmware PR using its local diff and source/document contracts; run focused regression, property, or fuzz tests when appropriate. Use when asked to assess a PR, patch, or changed interface.
---

# Hardware PR review

Review the behavior a patch can change, including the hardware configuration that makes the path reachable. A useful result identifies a concrete regression, supports a repair, or explains a specific evidence gap. Source reasoning and executed tests are different kinds of evidence; retain both without presenting one as the other.

## Establish the comparison

Record the requested base and head commits, local modifications, board/configuration, and relevant document revision. Use the actual PR comparison. For a historical reproduction, verify the chosen parent or merge base: today's target branch can contain unrelated repairs. Preserve local work and use an isolated checkout when different revisions must be built.

Start with `project_context` when Hyperbench is available. Locate changed producers, consumers, configuration gates, and linked component documents. Repository search is bounded literal search; narrow it by path or identifier when results truncate. Inspect schematic page images when pin mappings or wiring affect the contract. A diagram annotation is a lead until source or document evidence establishes the connection.

## Select the failure to investigate

Trace one changed boundary far enough to state its trigger, expected behavior, and observable failure. Include initialization and recovery paths, not just steady operation. Check whether a configuration disables the changed code or chooses another implementation.

| Patch touches | Questions worth answering |
| --- | --- |
| FIFO, DMA, buffers | Does length include protocol overhead? What happens at capacity, wrap, short transfer, and reset? |
| Workqueues, IRQs, callbacks | Who owns pending work? Can completion disappear, repeat, or occur after teardown? |
| Flash or persistent settings | Which writes have committed when reset occurs? Can startup recover without losing earlier records? |
| Units, coordinates, controllers | Which frame, sign, scale, and timestamp reach the consumer? Does mode entry preserve those assumptions? |
| Protocols and resource pools | Can ordinary traffic starve control messages? Are negotiated settings retained across later messages? |

Rank by reachable impact and evidence, rather than by how easily a test can be written. Read [testing strategies](references/testing-strategies.md) when choosing a harness or generated inputs. Read [discovery cases](references/discovery-cases.md) when a plausible test needs a stronger observation or control.

## Check that the test can answer the question

List the input or state the harness must control and the output it must measure. A simulator that exposes sample age cannot establish whether a driver's last SPI frame contains the correct bytes. Missing capability is a test limitation, not a reason to substitute an unrelated passing check.

Choose existing repository tests and helpers before adding infrastructure. Use a host test for deterministic logic, a device emulator for register interactions, or system simulation when the failure depends on mode transitions and timing. Inspect the actual board configuration, selected test, and resulting report; discovery, compilation, skips, and execution are separate outcomes.

Define the assertion before the run. It should distinguish the failure from legitimate behavior and from a shortcut such as disabling processing. Include a nearby valid-input or issue-off control when it clarifies causality. Test public results when possible; identify internal-state assertions and their limits when no suitable public observation exists.

## Execute within the available capabilities

Hyperbench MCP provides context, not a local command runner. Use the connected agent's own shell/test tools for local execution under its permissions. Registered SSH benches can execute only when enabled and authorized for the intended operation. A connectivity probe does not authorize flashing or actuator commands. An SSH timeout may leave remote work running; check its state before retrying.

Set finite time, input, memory, and concurrency limits appropriate to the harness. For native targets, enable compatible sanitizers if they help expose the suspected fault. Keep valid seeds and record generated sequences so failures can be replayed. Stop expanding a run when the useful observation is unavailable or the environment cannot execute the target.

## Triage and report

Replay a failure under the same test, configuration, and toolchain on both revisions. If the PR also repairs its test fixture, apply that corrected fixture consistently; otherwise a test change can masquerade as a product fix. Separate the first relevant failure from cleanup cascades, unrelated baseline failures, and setup errors. Reduce the triggering input or sequence while preserving the observation.

For each finding, report the affected path/lines, trigger, expected and observed behavior, revision, command, result, and reproduction artifact. Label it as source-supported, reproduced on a host, reproduced in simulation, or measured on hardware. State untested configurations and missing measurements. A clean bounded run supports only the exercised contract. Add regression tests or code changes only within the requested scope; leave unrelated system edits untouched.
