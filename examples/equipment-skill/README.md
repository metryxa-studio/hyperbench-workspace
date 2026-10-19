# Equipment debugging example

An originally authored fictional device, a deliberately faulty decoder, and twelve deterministic checks. Requires Node.js; no board, simulator, model key, or extra package.

Run from the repository root:

```sh
node examples/equipment-skill/check.mjs
```

The supplied decoder fails three checks. Work on a copy of this directory when asking an agent to repair it; the example intentionally preserves the failing starting point.

## Try the document-to-skill workflow

1. Import `device.md` into a Hyperbench project and link your working copy as a repository.
2. Open **Documents → Equipment skills**, select the document, and enter **Harbor H2 revision D**.
3. Copy the request into your connected agent. Review the proposed skill's assumptions, citations, and checks before accepting and downloading it.
4. Give the agent the approved skill and ask:

> Revision D samples are being rejected by this decoder. Investigate using the supplied device specification and host checks, repair the decoder in this working copy, and preserve revision B behavior. Report the failing input and before/after results. Distinguish the host decoder result from anything that would still need a device measurement.

A useful investigation preserves the fault and unsupported-input controls; making every input usable is not a repair. Successful checks establish agreement with the fictional status contract only. The generated skill should not invent pin assignments or a reset procedure.
