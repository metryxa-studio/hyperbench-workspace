# Tracing connections

Use this guide when a question crosses files, repositories, build configuration, or software/hardware interfaces. Trace the selected system, not every implementation with a similar name.

## Resolve identity before following a path

Keep a small set of identifiers as you discover them: physical part and board revision, connector/net name, controller instance, driver instance, message/topic, and consumer. Record the evidence for an alias instead of equating similar spellings. An address can be reused on another bus; a driver can have several instances; a connector label can survive a board redesign.

| Boundary | Evidence to retrieve | Common false connection |
| --- | --- | --- |
| Hardware → board support | Schematic, package pin assignment, pinmux and bus configuration | A logical GPIO number treated as a connector pin |
| Board support → driver | Selected build options, device binding, startup command and arguments | A driver present in the tree assumed to be enabled |
| Driver → sample | Register layout, transaction, decode/conversion and publication | A correctly named field assumed to have the correct scale |
| Publisher → subscriber | Topic/instance, schema version, routing, validity handling | Matching field names assumed to imply delivery |
| Request → actuator | Mode/state gate, routing, accepted command, output mapping | A high-level goal assumed to have issued a low-level command |
| Repository → dependency | Manifest/lockfile/submodule revision and the actual call/interface | Current upstream source substituted for the pinned dependency |
| Code → running system | Build identifier, configuration, logs or instrumented events | Reachable source code assumed to have executed |

Read the selection mechanism that makes the candidate relevant. For devicetree-based projects, examine the board, overlays, bindings, and effective generated tree when available. Resource properties depend on the bus and binding; a `reg` value does not have one universal meaning. Labels and aliases need resolution to a specific node. See [Zephyr's devicetree structure](https://docs.zephyrproject.org/latest/build/dts/intro-syntax-structure.html) for framework details, then use the version appropriate to the project.

## Work outward from the first useful observation

If an actuator never receives a request, inspect the request producer and its gates before diagnosing the physical actuator. If the request arrives but no completion event follows, inspect the handoff, execution, and acknowledgment. Absence of a log entry is useful only if the logger was active, the interval is covered, and the event would have been recorded.

Across a message boundary, compare the producer and consumer definitions directly. Check spelling, nesting, optional/default values, units, frame, sequence number, and timestamp origin. A renamed field interpreted as a default can look like a failed sensor or stalled controller. A saved architecture edge does not resolve this compatibility question.

When a value changes representation, follow one concrete sample through the transformation. For example, retain the original bytes, signed width, scale, offset, and output unit. For poses, retain the originating frame and time; later transforms cannot repair an unidentified frame. A test can confirm the conversion while leaving physical sensor accuracy unmeasured.

## Search without inventing an index

Begin with a distinctive local anchor: a connector label, register constant, configuration key, error text, or message field. Read its definition and nearby use, then use the discovered names for the next search. Enumerate likely directories when the filename is known only approximately. Avoid repeatedly scanning an entire large repository after a result reports incomplete coverage.

For several repositories, keep each hop qualified by repository and revision. Inspect dependency pins before consulting a newer checkout. If generated code is absent, retrieve its source schema and generation configuration; report the missing generated artifact instead of inventing its contents. Do not fetch private dependencies or change the checkout merely to make a trace appear complete.

## Check the interpretation

A citation proves that a passage exists; read enough context to establish what it means. A build dependency is not necessarily a runtime call. An interrupt registration is not an observed interrupt. A source-supported route can still be inactive because a runtime mode or parameter disables it.

Finish with the supported chain, the conditions that select it, and any unresolved junction. If a separate reviewer is useful, give them the chain and evidence and ask which connection is least supported. Use the disagreement to retrieve a specific missing artifact rather than generating a second whole-project summary.
