# Schematics and worked trace

Use this guide when document geometry determines the answer. Extracted PDF text is useful for finding a page; its reading order does not describe a circuit.

## Inspect the right drawing

Identify the board revision and assembly variant before interpreting a pin. Read title blocks and sheet references. Separate PDF page numbers from printed sheet numbers in citations, particularly when they differ. A schematic from a different revision is a lead, not a verified map for the user's board.

Use `document_search` to locate names, then `document_read` for surrounding text. Render the relevant page with `document_page`; crop a small region when labels are difficult to distinguish. Crops use normalized page coordinates. Include enough context to retain the connector name, pin numbers, net labels, and junctions; a close-up of one isolated word can lose the connection it was meant to establish.

The client and model must support image results for visual inspection. If they do not, report that limit and request a suitable image-capable workflow or the original electrical design/netlist. Empty extracted text does not establish that a drawing is blank. Locally available OCR can help locate labels if authorized, but OCR output alone cannot establish a wire path.

| Check | Why it changes the interpretation |
| --- | --- |
| Pin number and viewing orientation | Connector mating views, package views, and board views can differ |
| Crossings, junction marks, and net labels | Nearby lines may be separate; distant labels may identify a shared net |
| Sheet and label scope | A repeated label may be local to a sheet or connected through hierarchical ports |
| Population options and jumpers | The drawing may include paths absent on the assembled variant |
| Direction and electrical domain | Signal names do not establish drive direction, voltage compatibility, or inversion |
| Conditioning components | Buffers, level shifters, resistors, and switches can change the apparent connection |

Follow a net to its endpoint or an explicit sheet reference. Read the drawing's conventions; do not guess whether an unclear crossing joins. Use a datasheet or native netlist to resolve ambiguity when available. Label uncertain connectivity explicitly, especially before proposing wiring changes.

## Worked trace: an external temperature reading

This is an invented example, not a claim about a particular product or repository.

The user asks which component consumes the temperature signal on connector P4. The project has revision C hardware, two linked repositories, and a saved diagram naming a temperature sensor.

1. The revision C schematic shows P4 pin 2 on `THERM_DATA`, running to a controller pin. A revision B sheet maps P4 differently. Retain the revision C page/crop and exclude the older drawing from the asserted path.
2. The active board configuration maps that controller pin to bus instance 1. An inactive example configuration also contains the sensor's name; it does not select the user's device.
3. The driver instance on bus 1 reads the sensor and publishes `temperature_raw`. Read the conversion and its type declaration: this identifies what the field represents, rather than inferring units from the name.
4. The application's message adapter converts the value and publishes `temperature_c`. Its consumer checks a validity flag before accepting it. Follow both definitions across the repository boundary and record their dependency revisions.
5. No run log is supplied. The result establishes the configured source path, not that the sensor is connected or producing valid measurements now.

The answer should name that path, cite each artifact, and state the runtime gap. It should not claim that the saved diagram independently verified the wiring, or replace a missing revision C pin mapping with the revision B one.

## When the evidence disagrees

Preserve the competing observations: for example, the saved diagram says bus 2 while the active configuration says bus 1. Identify their versions and origins. Retrieve the selection or measurement that can resolve the disagreement. Do not silently edit the diagram to match the first source found.

If a model update is requested, propose only the supported interpretation and retain uncertainty in the component description or proposal summary. Layout artwork is decorative; selecting a drone, truck, or arm outline does not supply a physical design or validate any connection.
