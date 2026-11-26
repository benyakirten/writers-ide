# Native registry storage lab

This is opt-in Linux test infrastructure for Writer's IDE's registry publisher. It is not an application feature. It does not qualify a filesystem or enable production publication.

The Python controller manages dedicated scratch devices. A prebuilt Rust library-test executable runs the actual private publisher and validates reconstructed images as an ordinary user. The controller does not build code as root. Its default operation only inspects devices.

**Status: implemented, native execution not yet verified.** Local safety tests use synthetic inventories, memory streams, regular temporary files and fake workload processes. Rust fixture tests use isolated temporary directories. No native scratch-device campaign has been run. The [publication investigation](../../docs/plugins/registry-publication-investigation.md#native-persistence-argument-and-controlled-experiment-plan) explains the approved contract and evidence gaps.

## Safety boundary

Use a dedicated disposable Linux VM. Do not attach user disks or share Mac directories with it. Do not run other containers or storage experiments inside that VM. Device inspection sees the controller's mount namespace; it is not a security boundary against hostile native programs or hidden mounts in other namespaces.

The owner has supplied evidence of a UTM ARM64 guest with kernel `6.8.0-151-generic` and a loaded `log-writes v1.1.0` target. Its system disk is 32 GiB. Three separate 4 GiB virtual disks were added for scratch data, logging and replay. Displayed device names are not stable identifiers. Inspect again after every reboot or drive change.

**Implementation approval does not authorize erasure.** Before executing the campaign, obtain separate approval for the exact three devices and review their inspection fingerprint. Never use the VM system disk, its partitions, or its LVM volumes as a scratch target. The controller refuses nonblank devices, mounts, swap, unowned holders, partitions, aliases and changed identities. Missing information is refusal, not permission.

The controller uses cooperative per-device locks. It rechecks device identities, mapping UUIDs/tables and owned mounts before storage transitions. It cannot defeat an arbitrary native program changing devices between checks. It must not be used on a general-purpose Linux installation.

## Files and responsibilities

- [`lab.py`](lab.py): inspection, consent checks, privileged mapping/mount operations, workload protocol, calibration, campaign and explicit cleanup.
- [`devices.py`](devices.py): inventory parsing, dependency checks, identities and inspection fingerprint.
- [`log_format.py`](log_format.py): bounded log parser and prefix replay. The format is reviewed against [Linux v6.8 `dm-log-writes.c`](https://github.com/torvalds/linux/blob/v6.8/drivers/md/dm-log-writes.c). It supports version 1 and 512/4096-byte logical sectors. Unknown flags, malformed/duplicate marks, inline payloads and discard records are refused.
- [`build_workload.py`](build_workload.py): ordinary-user build and compiler/source/executable record.
- [`publication_storage_lab.rs`](../../src-tauri/src/plugin_registry/publication_storage_lab.rs): private test-only publisher adapter, baseline preparation and real selector/SQLite validation. Native execution is an ignored test. It requires a Linux process, a non-root effective user and the controller's opt-in environment and handshake.
- [`test_lab.py`](test_lab.py), [`test_controller.py`](test_controller.py): non-destructive safety, protocol and replay tests.

The replay implementation uses Python's standard library. It does not install or execute an external replay binary. Kernel marks contain a byte length excluding the terminating NUL. A mark is an observation point, not a persistence barrier. Later source unmount/removal writes are not replayed past the chosen mark.

## Non-destructive validation

Run from the repository root with Python **3.11 or newer** on Linux or macOS:

```sh
python3 -B -m unittest discover -s tooling/registry-lab -v
```

These tests do not require sudo, block devices, mounts, containers or the Linux logging target. The Native Registry workflow runs them on Ubuntu with Python 3.12. It never executes the destructive campaign.

Run the Rust fixtures from `src-tauri`:

```sh
cargo test --locked --lib storage_lab
```

The ignored native entry is not a test to invoke manually with `--ignored`. The controller supplies its explicit scratch mount, action, mode and bounded protocol. Ordinary tests exercise the same adapter in temporary directories and do not claim crash durability.

## VM prerequisites and build

All commands in this section run **inside the disposable Linux VM**. Installing packages changes the VM system disk and downloads packages. It does not format scratch disks. Keep package installation separate from the native experiment.

Use Python 3.11+, Git, Rust 1.90+ and Cargo. Install Rust as the ordinary lab user through a reviewed method, such as the [official rustup installer](https://rustup.rs/). Do not install or run Cargo under sudo. The Linux Tauri build uses the same development packages as [Native Registry CI](../../.github/workflows/native_registry.yml):

```sh
sudo apt-get update
sudo apt-get install python3 git dmsetup e2fsprogs util-linux build-essential libwebkit2gtk-4.1-dev libxdo-dev libssl-dev librsvg2-dev libayatana-appindicator3-dev patchelf
```

Confirm that the guest kernel provides and can load the logging target:

```sh
sudo modprobe dm_log_writes
sudo dmsetup targets
```

The second command must list `log-writes`. Loading the module does not create a mapping or format a disk. If the module is absent or fails to load, stop instead of substituting a different fault mechanism.

Use a normal checkout on the VM system filesystem, not a shared Mac directory or scratch disk. Check out the committed source revision under review. Resolve uncommitted source changes before a native run; the controller refuses a dirty or mismatched build. No tool commits changes automatically.

Building the full Tauri library can take substantial disk space and memory. Check available resources before building. The owner's VM root LV was expanded separately under explicit administrative setup approval; the experiment controller does not perform that operation. Do not resize the system disk or LVM automatically to make a build pass. Close Docker Desktop if memory is constrained. The helper limits Cargo to one build job.

From the checkout root, without sudo:

```sh
python3 -B tooling/registry-lab/build_workload.py
```

The helper runs a locked, no-run library-test build. It writes `src-tauri/target/registry-lab/build.json` with the exact executable path, SHA-256, Rust compiler version and source revision. Native execution checks that record against the current clean checkout and executable. A failed build does not produce a usable new record. No scratch device is opened by this helper.

## Inspection before execution

First inspect the current device layout:

```sh
lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINTS
```

The following example matches the owner's earlier layout **only if it is still unchanged**: `/dev/vda` is the system disk, and `/dev/vdb`, `/dev/vdc` and `/dev/vdd` are the three new scratch disks. Verify those facts before using the example. From the checkout root:

```sh
sudo python3 -B tooling/registry-lab/lab.py --data /dev/vdb --log /dev/vdc --replay /dev/vdd
```

There is no `--execute` flag here. The controller reads inventory, mount/swap information and signatures. It also scans the full selected disks for zero bytes, so inspection can take time. A raw nonzero disk is refused even if it has no recognized filesystem signature. It does not format, clear, mount or map the disks. Sudo supplies read access, not erase authorization.

The result contains the selected roles and a SHA-256 fingerprint of device numbers, sizes, sysfs identities, model/serial observations and guest boot identity. This is an accidental-change check, not authentication or storage qualification. Keep the result for review. A reboot or changed device invalidates the earlier result.

**Stop after inspection until explicit erase approval is obtained.** Native execution additionally requires all of:

| Argument                      | Required input                                                        |
| ----------------------------- | --------------------------------------------------------------------- |
| `--execute`                   | Explicit native-campaign request. Absent by default.                  |
| `--data`, `--log`, `--replay` | The three separately approved whole-device paths.                     |
| `--expect`                    | The exact current inspection fingerprint.                             |
| `--erase`                     | The literal confirmation `ERASE-THREE-SCRATCH-DISKS`.                 |
| `--build-record`              | The unprivileged helper's `src-tauri/target/registry-lab/build.json`. |

Do not construct a native command from a screenshot alone. Review the inspection output and the build/setup evidence first. The script is invoked through sudo by the ordinary lab user. It drops to that user's identity with `setpriv` before invoking the Rust executable and enables `no-new-privs`. It never invokes Cargo as root.

## Campaign and evidence

The controller uses only a **128 MiB data prefix**, a **256 MiB log prefix** and a **128 MiB replay prefix** on the confirmed scratch disks. All three disks must initially be blank. Prefix zeroing is bounded scratch initialization, not secure erasure. Logs, trace and fixed-size summaries share a 512 MiB evidence budget. There are six publication cases and at most 160 replay cuts. The campaign has a one-hour deadline; workload and command subprocesses also have timeouts. Deadlines do not guarantee that a kernel task stuck in uninterruptible device I/O can be killed immediately.

1. Calibrate cache-loss sensitivity with direct writes. A completed flush must preserve the first pattern. A cut before the next flush must omit a later unsynchronized pattern. A later flushed cut must contain both. Abort if this calibration fails.
2. Format the data mapping as ext4 without discard or lazy inode/journal initialization. Mount with `data=ordered`, barriers enabled and discard disabled. Save filesystem features and effective mount observations.
3. Prepare a durable stable-parent baseline. Replacement also prepares and publishes a durable old generation through the actual native publisher.
4. Run the consuming publisher with native operations and marks immediately before/after relevant calls. Synchronize the acknowledgment trace outside scratch storage before allowing the acknowledged-success mark.
5. Remove the source mapping after capture. Save and validate the bounded log. Reconstruct each marked prefix on a freshly zeroed replay target. Later orderly source cleanup is outside these prefixes.
6. Mount the reconstructed ext4 filesystem for normal journal recovery. The unprivileged Rust validator uses the real 64-byte selector, generation binding and `Store::open`. It does not scan generations, switch back, repair selection or use fallback authority. Normal opening may create SQLite sidecars.

Normal cases cover first creation and replacement. Four first-creation controls omit the generation-directory, stable-parent, selector-file or final-root barrier. These omissions exist only in the test adapter. An acknowledged control that loses the new generation is reported as detected. If incidental native persistence masks an omission, the report says so; it does not infer that the barrier is unnecessary.

Before selection, replacement must retain the old ready generation and first creation must have no valid selected generation. After replacement selection but before acknowledgment, either complete old or new selection is allowed. A normal acknowledged publication must retain the new valid, reachable generation. The baseline's stable parent must survive all cuts.

Evidence is retained in a root-owned `/var/tmp/wide-registry-lab-<run-id>` directory on the VM system filesystem. It includes the ownership receipt, build/compiler identity, kernel configuration, source revision, mount/filesystem observations, protocol trace, captured logs and per-cut results. It is **not** the sanitized CI environment report: native evidence can contain guest paths and device identities. Review it before sharing.

The receipt and summary explicitly keep `qualified` and `runtime_publication_enabled` false. Physical power loss is not tested. Host UTM/cache settings remain separately supplied evidence. Successful prefix replay is evidence for the stated block-level model, not all storage devices, sector tears or early-write reorderings.

## Failures and cleanup

On failure, stop. The controller retains diagnostics and resource intents. It does not retry publication, select another generation, reset the VM or automatically tear down uncertain resources. Live log data may still be on the scratch log disk. Do not recreate or wipe those disks before reviewing the failure.

Explicit `--cleanup` accepts the retained evidence directory printed by that run. It checks the root-owned receipt, guest/device identity, live mapping UUIDs/tables and mounts before removing only recorded resources. It never formats a disk, uses forced/lazy unmount, or deletes evidence. An incomplete create/mount command may leave an uncertain receipt; cleanup refuses rather than guessing whether the resource exists or belongs to it. Inspect such cases manually before proceeding.

After normal completion, source/replay mounts and mappings have been removed, but disk contents and evidence remain. Per-device lock files are not unlinked. Reusing nonblank scratch devices is deliberately refused by a new campaign. Review and archive evidence first; any later reset/replacement of scratch disks needs its own explicit approval.
