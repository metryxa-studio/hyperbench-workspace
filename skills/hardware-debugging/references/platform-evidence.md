# Platform evidence recipes

Use the matching recipe when configuration or runtime selection could explain the symptom. Paths below are clues verified against Zephyr 4.2.0 and PX4 1.16; resolve them in the user's actual revision. Retrieve the relevant artifacts, not every platform document.

## Zephyr: a peripheral is absent or unready

Start with the failing build's output directory, board target, configuration log, and selected image if the project uses multiple images. A nearby successful build may have different overlays or configuration.

| Observation | Retrieve | Distinguishing check |
| --- | --- | --- |
| An option in `prj.conf` appears ineffective | `<build>/zephyr/.config`, configuration warnings, selected `CONF_FILE` and extra fragments | Compare the requested option with the merged value; inspect its dependencies before changing driver code. |
| A pin, bus, or address differs from the intended overlay | `<build>/zephyr/zephyr.dts`, overlay paths reported during configuration, matching binding under `dts/bindings/` | Find the application-selected node and compare its effective properties with the supplied schematic. |
| Linking reports `__device_dts_ord_<N>` | `<build>/zephyr/include/generated/zephyr/devicetree_generated.h`, effective DTS, driver build selection | Map the ordinal to a node; check both node enablement and whether the matching driver was compiled. |

These generated artifacts expose decisions that source fragments alone cannot establish. See the versioned [Kconfig guide](https://docs.zephyrproject.org/4.2.0/build/kconfig/setting.html) and [devicetree diagnostics](https://docs.zephyrproject.org/4.2.0/build/dts/troubleshooting.html).

If the image links but the device remains unready, inspect that driver's initialization return path and captured boot diagnostics. Compare initialization failure with a later transfer failure; they exercise different code. A node enabled in DTS does not establish successful initialization or correct wiring. The [device lookup guide](https://docs.zephyrproject.org/4.2.0/build/dts/howtos.html#get-a-struct-device-from-a-devicetree-node) explains this distinction.

If stale generated files remain plausible, preserve the failing artifacts and compare a separately configured build using the same target and inputs. A successful rebuild alone does not identify which configuration difference mattered.

## PX4: a sensor disappears or looks stale

First match the recording to the firmware. Inspect available ULog `ver_sw`, `ver_hw`, and parameter records, including changes during the recording. Compare them with the intended checkout and configuration. An old recording cannot establish the current vehicle's state. See [ULog metadata](https://docs.px4.io/v1.16/en/dev_log/ulog_file_format).

Then select the relevant branch:

- **No driver activity:** inspect the selected `boards/<vendor>/<board>/<variant>.px4board`, startup output, and applicable scripts under `ROMFS/px4fmu_common/init.d/` or `init.d-posix/`. Follow the branch that starts the driver. A compiled module is not necessarily started; a continued boot is not proof every driver initialized. [Startup reference](https://docs.px4.io/v1.16/en/concept/system_startup).
- **Topic exists but data looks wrong:** locate its message definition under `msg/` and the actual publisher and subscriber. Record the topic instance and device identity. For example, v1.16.0 [`SensorAccel.msg`](https://github.com/PX4/PX4-Autopilot/blob/v1.16.0/msg/SensorAccel.msg) distinguishes `timestamp`, `timestamp_sample`, and `device_id`. Inspect the publisher before interpreting their differences. If available and authorized, a bounded `listener` capture and `uorb top` observation can distinguish publication from consumer behavior. Check command availability and instance selection in the target build. [uORB diagnostics](https://docs.px4.io/v1.16/en/middleware/uorb#listing-topics-and-listening-in).
- **Topic missing only from the log:** inspect logging coverage before blaming acquisition. On the SD card, `etc/logging/logger_topics.txt` can replace default topic selection and restrict instances or rates. Check the recorded interval and dropout information. Live publication and incomplete recording can coexist. [Logging reference](https://docs.px4.io/v1.16/en/dev_log/logging).

Use an existing local decoder for `.ulg` files; Hyperbench does not provide one. Keep the original file and identify the decoder and exported fields alongside any imported text summary.

## Compact result

| Field | Record |
| --- | --- |
| Build/run | Revision, target, configuration, artifact paths |
| Observation | Phase, interval, instance, expected versus measured value |
| Check | Exact command or comparison; exit status and incomplete output |
| Conclusion | Explanation supported or weakened; next unresolved distinction |

Research context: [IoT-SkillsBench](https://arxiv.org/abs/2603.19583) motivated platform-specific guidance. These recipes are independently written from official platform documentation; no benchmark instructions, code, or tasks are included.
