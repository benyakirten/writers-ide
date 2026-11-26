#!/usr/bin/env python3
"""Explicit Linux scratch-device experiment. Default operation is inspection.

Never invoke with --execute without separate owner approval for the exact disks.
The VM/controller is trusted cooperative test infrastructure, not a native-attacker
security boundary. No production qualification or publication is enabled.
"""

import argparse
import fcntl
import hashlib
import json
import mmap
import os
import pwd
import re
import resource
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

# Importing the controller under sudo must not create root-owned checkout caches.
sys.dont_write_bytecode = True

from devices import ROLES, Refusal, collect, fingerprint, require, verify_block_nodes
from log_format import MAX_LOG_BYTES
from log_format import inspect as inspect_log
from log_format import replay as replay_log

DATA_BYTES = 128 * 1024 * 1024
EVIDENCE_BYTES = 512 * 1024 * 1024
COMMAND_BYTES = 1024 * 1024
MAX_CUTS = 160
PREFIX = b"WIDE_REGISTRY_LAB "
TEST = "plugin_registry::generation::publisher::storage_lab::native_storage_lab_entry"
CASES = (
    ("first", "none"),
    ("replace", "none"),
    ("first", "generation"),
    ("first", "parent"),
    ("first", "selector"),
    ("first", "final"),
)
PATH = "/usr/sbin:/usr/bin:/sbin:/bin"


def tool(name):
    resolved = shutil.which(name, path=PATH)
    require(
        resolved is not None,
        f"missing tool: {name}; install it as a separate setup step",
    )
    return resolved


def child_limit():
    resource.setrlimit(resource.RLIMIT_FSIZE, (COMMAND_BYTES, COMMAND_BYTES))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


class Commands:
    def __init__(self, seconds=3600):
        self.deadline = time.monotonic() + seconds

    def remaining(self):
        remaining = self.deadline - time.monotonic()
        require(
            remaining > 0, "campaign runtime limit reached; owned resources retained"
        )
        return remaining

    def __call__(self, args):
        args = [tool(args[0]), *map(str, args[1:])]
        with tempfile.TemporaryFile() as output:
            process = subprocess.Popen(
                args,
                stdin=subprocess.DEVNULL,
                stdout=output,
                stderr=subprocess.STDOUT,
                env={"PATH": PATH, "LC_ALL": "C"},
                start_new_session=True,
                preexec_fn=child_limit,
            )
            try:
                process.wait(timeout=min(120, self.remaining()))
            except BaseException:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
                raise
            output.seek(0)
            data = output.read(COMMAND_BYTES + 1)
            require(len(data) <= COMMAND_BYTES, "command output limit")
            text = data.decode("utf-8", errors="replace")
            require(
                process.returncode == 0,
                f"command failed ({process.returncode}): {args!r}\n{text[-4096:]}",
            )
            return text


def initial_selection(commands, paths):
    snapshot = collect(commands)
    selected = snapshot.select(paths)
    verify_block_nodes(selected)
    for device in selected.values():
        signatures = json.loads(
            commands(["wipefs", "--no-act", "--json", device["path"]])
        )
        require(
            signatures.get("signatures") == [],
            f"existing signature on {device['path']}; not a blank scratch disk",
        )
        # Signature absence alone cannot distinguish a new disk from raw data.
        with open(device["path"], "rb", buffering=0) as source:
            require_blank(source, device["size"], commands.remaining)
    verify_block_nodes(selected)
    return snapshot, selected


def require_blank(source, size, deadline=lambda: None):
    remaining = size
    zeros = bytes(1024 * 1024)
    while remaining:
        deadline()
        block = source.read(min(remaining, len(zeros)))
        require(
            block and block == zeros[: len(block)],
            "scratch disk contains unrecognized data; refusing erasure",
        )
        remaining -= len(block)


def device_locks(selected):
    handles = []
    try:
        for identity in sorted(device["id"] for device in selected.values()):
            path = (
                "/run/wide-registry-lab-device-" + identity.replace(":", "-") + ".lock"
            )
            fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
            stream = os.fdopen(fd, "r+")
            handles.append(stream)
            metadata = os.fstat(fd)
            require(
                stat.S_ISREG(metadata.st_mode)
                and metadata.st_uid == 0
                and not metadata.st_mode & 0o077,
                "untrusted device lock",
            )
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BaseException:
        for stream in handles:
            stream.close()
        raise
    return handles


def execution_consent(args, selected, uid):
    require(os.uname().sysname == "Linux", "Linux only")
    require(uid > 0, "invoke through sudo from a non-root lab user")
    require(
        args.expect == fingerprint(selected),
        "inspection fingerprint absent or changed; inspect again",
    )
    require(
        args.erase == "ERASE-THREE-SCRATCH-DISKS",
        "separate erase confirmation required",
    )
    require(args.build_record is not None, "unprivileged Rust build record required")


def cut_invariant(mode, omission, label, state, selected, stable_parent):
    require(stable_parent, "durable stable-parent baseline was lost")
    require(state in {"old", "new", "recovery"}, "unexpected selected generation")
    if label == "baseline-ready":
        require(
            state == ("old" if mode == "replace" else "recovery"),
            "durable baseline was not reconstructed",
        )
    elif not selected:
        require(
            state == ("old" if mode == "replace" else "recovery"),
            "pre-selection baseline/selection invariant failed",
        )
    elif mode == "replace":
        require(state in {"old", "new"}, "replacement lost both valid selections")
    else:
        require(
            state in {"new", "recovery"}, "first creation selected an old generation"
        )
    if label == "acknowledged-success" and omission == "none":
        require(state == "new", "acknowledged publication did not survive replay")


def file_hash(path):
    with open(path, "rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def as_user(uid, gid, args):
    return [
        "setpriv",
        "--reuid",
        str(uid),
        "--regid",
        str(gid),
        "--init-groups",
        "--no-new-privs",
        "--",
        *args,
    ]


def save_json(path, value):
    text = json.dumps(value, indent=2) + "\n"
    require(len(text.encode()) <= COMMAND_BYTES, "JSON evidence bound")
    temporary = path.with_suffix(".new")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as stream:
        stream.write(text)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def zero_prefix(path, size):
    # Caller validates identity, ownership and absence of mounts first.
    with open(path, "r+b", buffering=0) as target:
        remaining = size
        zeros = bytes(1024 * 1024)
        while remaining:
            chunk = zeros[: min(remaining, len(zeros))]
            require(target.write(chunk) == len(chunk), "short scratch reset")
            remaining -= len(chunk)
        os.fsync(target.fileno())


class Campaign:
    def __init__(self, commands, selected, workload, uid, gid):
        self.commands, self.selected, self.uid, self.gid = commands, selected, uid, gid
        self.paths = {role: device["path"] for role, device in selected.items()}
        self.workload = Path(workload).resolve(strict=True)
        metadata = self.workload.lstat()
        require(
            stat.S_ISREG(metadata.st_mode)
            and metadata.st_uid == uid
            and metadata.st_mode & 0o111
            and not metadata.st_mode & 0o6000,
            "workload must be an executable owned by the unprivileged lab user",
        )
        require(metadata.st_size <= 512 * 1024 * 1024, "workload executable size limit")
        self.run_id = uuid.uuid4().hex
        self.evidence = Path("/var/tmp") / ("wide-registry-lab-" + self.run_id)
        self.base = Path("/run") / ("wide-registry-lab-" + self.run_id)
        require(
            self.evidence.parent.resolve() == self.evidence.parent
            and self.base.parent.resolve() == self.base.parent,
            "unexpected run parent symlink",
        )
        self.evidence.mkdir(mode=0o700)
        self.base.mkdir(mode=0o711)
        self.source, self.target = self.base / "source", self.base / "replay"
        self.source.mkdir()
        self.target.mkdir()
        self.state = {
            "schema": "writers-ide.registry-native-lab/1",
            "run_id": self.run_id,
            "devices": selected,
            "base": str(self.base),
            "mappings": [],
            "mounts": [],
            "uid": uid,
            "gid": gid,
            "status": "created",
            "qualified": False,
            "runtime_publication_enabled": False,
            "physical_power_loss_tested": False,
            "limits": {
                "data_bytes": DATA_BYTES,
                "log_bytes": MAX_LOG_BYTES,
                "evidence_bytes": EVIDENCE_BYTES,
                "cases": len(CASES),
                "cuts": MAX_CUTS,
                "seconds": 3600,
            },
            "workload_sha256": file_hash(self.workload),
        }
        self.persist()
        self.trace_path = self.evidence / "trace.jsonl"
        self.trace = self.trace_path.open("x", encoding="utf-8")
        self.trace_bytes = 0
        self.cut_count = 0
        self.mark_labels = []
        self.acknowledged = False
        self.result = None
        self.stable_parent = False
        self.mapping = None
        self.budget_used = 0

    def persist(self):
        save_json(self.evidence / "run.json", self.state)

    def event(self, value):
        text = json.dumps(value, sort_keys=True) + "\n"
        self.trace_bytes += len(text.encode())
        require(self.trace_bytes <= 8 * COMMAND_BYTES, "trace limit; evidence retained")
        require(
            self.budget_used + self.trace_bytes + 2 * COMMAND_BYTES <= EVIDENCE_BYTES,
            "evidence budget reached",
        )
        self.trace.write(text)
        self.trace.flush()
        os.fsync(self.trace.fileno())

    def guard(self):
        owned = set()
        for mapping in self.state["mappings"]:
            self.check_mapping(mapping)
            path = "/dev/mapper/" + mapping["name"]
            owned.update((path, os.path.realpath(path)))
        snapshot = collect(self.commands)
        current = snapshot.select(
            self.paths, owned, {mount["path"] for mount in self.state["mounts"]}
        )
        require(
            current == self.selected,
            "scratch identity changed; stop without guessing cleanup",
        )
        verify_block_nodes(current)
        for mount in self.state["mounts"]:
            self.check_mount(mount, snapshot)
        return snapshot

    def check_mapping(self, mapping):
        identity = self.commands(
            [
                "dmsetup",
                "info",
                "--columns",
                "--noheadings",
                "-o",
                "uuid",
                mapping["name"],
            ]
        ).strip()
        require(identity == mapping["uuid"], "mapping ownership changed")
        table = self.commands(["dmsetup", "table", mapping["name"]]).strip()
        require(table == mapping["table"], "mapping table changed")

    def create_mapping(self, suffix, table):
        self.guard()
        name = "wide-lab-" + self.run_id + "-" + suffix
        mapping = {
            "name": name,
            "uuid": "WIDE-LAB-" + self.run_id + "-" + suffix,
            "table": table,
        }
        # Persist intent first. A failed command may still have created resources.
        self.state["mappings"].append(mapping)
        self.persist()
        self.commands(
            ["dmsetup", "create", name, "--uuid", mapping["uuid"], "--table", table]
        )
        self.check_mapping(mapping)
        return "/dev/mapper/" + name

    def remove_mapping(self, path):
        name = Path(path).name
        mapping = next(item for item in self.state["mappings"] if item["name"] == name)
        self.guard()
        self.commands(["dmsetup", "remove", name])
        self.state["mappings"].remove(mapping)
        self.persist()

    def check_mount(self, mount, snapshot=None):
        snapshot = snapshot or collect(self.commands)
        matches = [
            entry for entry in snapshot.mount_table if entry["path"] == mount["path"]
        ]
        require(
            len(matches) == 1
            and matches[0]["id"] == mount["id"]
            and matches[0]["fstype"] == "ext4",
            "owned mount changed or missing",
        )
        require(
            "nobarrier" not in matches[0]["options"].split(","), "barriers disabled"
        )

    def mount(self, device, path):
        self.guard()
        require(not os.path.ismount(path), "mount path already in use")
        metadata = os.stat(device)
        mount = {
            "path": str(path),
            "id": f"{os.major(metadata.st_rdev)}:{os.minor(metadata.st_rdev)}",
            "device": device,
        }
        self.state["mounts"].append(mount)
        self.persist()
        self.commands(
            [
                "mount",
                "-t",
                "ext4",
                "-o",
                "rw,data=ordered,barrier=1,nodiscard",
                device,
                path,
            ]
        )
        self.check_mount(mount)
        # Give the workload access only to the mounted scratch filesystem.
        os.chown(path, self.uid, self.gid)

    def unmount(self, path):
        self.guard()
        mount = next(item for item in self.state["mounts"] if item["path"] == str(path))
        self.commands(["umount", path])
        self.state["mounts"].remove(mount)
        self.persist()

    def reset(self):
        self.guard()
        require(
            not self.state["mounts"] and not self.state["mappings"],
            "reset requires no owned mounts or mappings",
        )
        for role in ROLES:
            self.guard()
            zero_prefix(
                self.paths[role], MAX_LOG_BYTES if role == "log" else DATA_BYTES
            )

    def start_logging(self):
        log = self.create_mapping(
            "log", f"0 {MAX_LOG_BYTES // 512} linear {self.selected['log']['id']} 0"
        )
        # Kernel dmsetup table output uses major:minor identifiers.
        log_stat = os.stat(log)
        log_id = f"{os.major(log_stat.st_rdev)}:{os.minor(log_stat.st_rdev)}"
        self.mapping = self.create_mapping(
            "data",
            f"0 {DATA_BYTES // 512} log-writes {self.selected['data']['id']} {log_id}",
        )
        return log

    def mark(self, label):
        require(re.fullmatch(r"[A-Za-z0-9_-]{1,128}", label), "unsafe log mark")
        require(
            label not in self.mark_labels and len(self.mark_labels) < 96,
            "duplicate/excessive mark",
        )
        self.guard()
        self.commands(["dmsetup", "message", self.mapping, "0", "mark", label])
        self.mark_labels.append(label)

    def stop_logging(self, log):
        self.remove_mapping(self.mapping)
        self.mapping = None
        self.remove_mapping(log)

    def save_log(self, name):
        self.guard()
        destination = self.evidence / (name + ".log")
        with open(self.paths["log"], "rb", buffering=0) as source:
            parsed = inspect_log(source, DATA_BYTES)
            require(
                self.budget_used
                + self.trace_bytes
                + parsed.used_bytes
                + 2 * COMMAND_BYTES
                <= EVIDENCE_BYTES,
                "evidence disk budget reached",
            )
            with destination.open("xb") as target:
                source.seek(0)
                remaining = parsed.used_bytes
                while remaining:
                    data = source.read(min(1024 * 1024, remaining))
                    require(data, "short saved log")
                    require(target.write(data) == len(data), "short saved-log write")
                    remaining -= len(data)
                target.flush()
                os.fsync(target.fileno())
        self.budget_used += parsed.used_bytes
        return destination, parsed

    def workload_event(self, value, action):
        require(
            isinstance(value, dict)
            and value.get("event") in {"mark", "acknowledged", "validated"},
            "unknown workload event",
        )
        event = value["event"]
        if event == "mark":
            require(action in {"baseline", "capture"}, "unexpected validator mark")
            self.mark(value.get("label", ""))
        elif event == "acknowledged":
            require(
                action == "capture"
                and not self.acknowledged
                and value.get("generation") == "02" * 16,
                "invalid publication acknowledgment",
            )
            self.acknowledged = True
        else:
            require(
                action == "validate"
                and self.result is None
                and value.get("state")
                in {"old", "new", "recovery", "unexpected-generation"},
                "invalid validator result",
            )
            require(
                isinstance(value.get("stable_parent"), bool),
                "validator omitted stable-parent evidence",
            )
            self.result = value["state"]
            self.stable_parent = value["stable_parent"]
        self.event({"action": action, **value})

    def workload_run(self, action, mode, omission):
        self.guard()
        mount = self.target if action == "validate" else self.source
        env = {
            "PATH": PATH,
            "LC_ALL": "C",
            "HOME": pwd.getpwuid(self.uid).pw_dir,
            "WIDE_REGISTRY_LAB_OPT_IN": "scratch-only-v1",
            "WIDE_REGISTRY_LAB_ACTION": action,
            "WIDE_REGISTRY_LAB_MODE": mode,
            "WIDE_REGISTRY_LAB_OMIT": omission,
            "WIDE_REGISTRY_LAB_MOUNT": str(mount),
        }
        args = [
            tool("setpriv"),
            "--reuid",
            str(self.uid),
            "--regid",
            str(self.gid),
            "--init-groups",
            "--no-new-privs",
            "--",
            str(self.workload),
            "--exact",
            TEST,
            "--ignored",
            "--nocapture",
            "--format=terse",
            "--test-threads=1",
        ]
        process = subprocess.Popen(
            args,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            env=env,
            start_new_session=True,
            preexec_fn=child_limit,
        )
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        pending, total, events = b"", 0, 0
        deadline = time.monotonic() + min(180, self.commands.remaining())
        try:
            while selector.get_map():
                require(time.monotonic() < deadline, "workload timeout")
                self.commands.remaining()
                for key, _ in selector.select(timeout=0.25):
                    chunk = os.read(key.fileobj.fileno(), 4096)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    total += len(chunk)
                    require(total <= COMMAND_BYTES, "workload output bound")
                    pending += chunk
                    while b"\n" in pending:
                        line, pending = pending.split(b"\n", 1)
                        if line.startswith(PREFIX):
                            require(len(line) <= 2048, "workload event bound")
                            events += 1
                            require(events <= 96, "workload event count bound")
                            self.workload_event(json.loads(line[len(PREFIX) :]), action)
                            process.stdin.write(b"ok\n")
                            process.stdin.flush()
                        else:
                            self.event(
                                {
                                    "action": action,
                                    "output": line.decode("utf-8", errors="replace"),
                                }
                            )
            process.wait(timeout=max(0.1, deadline - time.monotonic()))
            require(
                process.returncode == 0 and events > 0,
                "workload failed or emitted no evidence",
            )
            require(not pending, "unterminated workload output")
        except BaseException:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            raise
        finally:
            selector.close()
            process.stdin.close()
            process.stdout.close()

    def calibration(self):
        self.reset()
        log = self.start_logging()
        self.mark_labels = []
        fd = os.open(self.mapping, os.O_RDWR | os.O_DIRECT)
        try:
            with mmap.mmap(-1, 4096) as buffer:
                buffer[:] = b"A" * 4096
                require(os.pwrite(fd, buffer, 0) == 4096, "short calibration A")
                os.fsync(fd)
                self.mark("calibration-durable")
                buffer[:] = b"B" * 4096
                require(os.pwrite(fd, buffer, 4096) == 4096, "short calibration B")
                self.mark("calibration-volatile")
                os.fsync(fd)
                self.mark("calibration-flushed")
        finally:
            os.close(fd)
        self.stop_logging(log)
        path, parsed = self.save_log("calibration")
        cuts = parsed.cuts()
        for label, second in (
            ("calibration-volatile", bytes(4096)),
            ("calibration-flushed", b"B" * 4096),
        ):
            require(label in cuts, "calibration mark missing")
            self.cut_count += 1
            require(self.cut_count <= MAX_CUTS, "campaign cut-count limit")
            self.guard()
            zero_prefix(self.paths["replay"], DATA_BYTES)
            with (
                path.open("rb") as source,
                open(self.paths["replay"], "r+b", buffering=0) as target,
            ):
                replay_log(parsed, source, target, cuts[label])
                os.fsync(target.fileno())
                target.seek(0)
                require(
                    target.read(4096) == b"A" * 4096 and target.read(4096) == second,
                    "cache-loss calibration failed; campaign cannot supply evidence",
                )
        self.event(
            {"calibration": "passed", "model": "dm-log-writes-completed-flush-prefixes"}
        )

    def run_case(self, index, mode, omission):
        self.reset()
        self.mark_labels, self.acknowledged = [], False
        log = self.start_logging()
        self.guard()
        self.commands(
            [
                "mkfs.ext4",
                "-F",
                "-m",
                "0",
                "-E",
                "lazy_itable_init=0,lazy_journal_init=0,nodiscard",
                self.mapping,
            ]
        )
        self.mount(self.mapping, self.source)
        self.event(
            {
                "case_environment": {
                    "mode": mode,
                    "omission": omission,
                    "filesystem": self.commands(["dumpe2fs", "-h", self.mapping]),
                    "mount": [
                        entry
                        for entry in collect(self.commands).mount_table
                        if entry["path"] == str(self.source)
                    ],
                }
            }
        )
        self.workload_run("baseline", mode, omission)
        self.workload_run("capture", mode, omission)
        require(
            self.acknowledged and "acknowledged-success" in self.mark_labels,
            "publication acknowledgment missing",
        )
        self.unmount(self.source)
        self.stop_logging(log)
        name = f"case-{index}-{mode}-{omission}"
        path, parsed = self.save_log(name)
        cuts = parsed.cuts()
        require(
            all(label in cuts for label in self.mark_labels),
            "log mark missing; incomplete capture",
        )
        marks = list(self.mark_labels)
        results = []
        require("after-native-selection" in marks, "native selection boundary missing")
        selection_cut = marks.index("after-native-selection")
        for mark_index, label in enumerate(marks):
            self.cut_count += 1
            require(self.cut_count <= MAX_CUTS, "campaign cut-count limit")
            self.guard()
            zero_prefix(self.paths["replay"], DATA_BYTES)
            with (
                path.open("rb") as source,
                open(self.paths["replay"], "r+b", buffering=0) as target,
            ):
                replay_log(parsed, source, target, cuts[label])
                os.fsync(target.fileno())
            self.mount(self.paths["replay"], self.target)
            self.result, self.stable_parent = None, False
            self.workload_run("validate", mode, omission)
            self.unmount(self.target)
            cut_invariant(
                mode,
                omission,
                label,
                self.result,
                mark_index >= selection_cut,
                self.stable_parent,
            )
            results.append({"mark": label, "entry": cuts[label], "state": self.result})
        acknowledged = next(
            item["state"] for item in results if item["mark"] == "acknowledged-success"
        )
        control = (
            None
            if omission == "none"
            else (
                "detected" if acknowledged != "new" else "masked-by-native-persistence"
            )
        )
        result = {
            "case": name,
            "mode": mode,
            "omission": omission,
            "results": results,
            "control": control,
        }
        save_json(self.evidence / (name + ".json"), result)
        self.event({"case": name, "control": control, "cuts": len(results)})
        return result

    def run(self):
        snapshot = self.guard()
        require(
            any(
                m["path"] == "/" and m["fstype"] == "ext4" for m in snapshot.mount_table
            ),
            "experiment evidence requires the VM's ext4 root",
        )
        require(
            os.stat(self.evidence).st_dev == os.stat("/").st_dev,
            "evidence must be on the VM system filesystem",
        )
        available = os.statvfs(self.evidence)
        require(
            available.f_bavail * available.f_frsize >= 2 * EVIDENCE_BYTES,
            "insufficient evidence disk space",
        )
        virt = self.commands(["systemd-detect-virt", "--vm"]).strip()
        require(
            virt in {"qemu", "kvm", "apple"}, "unrecognized disposable-VM environment"
        )
        self.state["environment"] = {
            "kernel": os.uname().release,
            "architecture": os.uname().machine,
            "virtualization": virt,
            "mounts": [m for m in snapshot.mount_table if m["path"] == "/"],
            "dm_targets": self.commands(["dmsetup", "targets"]),
            "kernel_config": Path("/boot/config-" + os.uname().release).read_text(),
            "os_release": Path("/etc/os-release").read_text(),
            "source_revision": self.commands(
                as_user(self.uid, self.gid, ["git", "--no-pager", "rev-parse", "HEAD"])
            ).strip(),
            "source_dirty": bool(
                self.commands(
                    as_user(
                        self.uid,
                        self.gid,
                        ["git", "--no-optional-locks", "status", "--porcelain"],
                    )
                )
            ),
            "tool_versions": {
                name: self.commands([name, "--version"])
                for name in ("python3", "lsblk", "mount")
            },
            "host_cache_configuration": "not-observed; record UTM and host settings separately",
        }
        require(
            "log-writes" in self.state["environment"]["dm_targets"],
            "log-writes target is not loaded",
        )
        require(
            self.state["environment"]["source_revision"]
            == self.state["build"]["source_revision"],
            "source revision changed since workload build",
        )
        require(
            not self.state["environment"]["source_dirty"],
            "commit or otherwise resolve the source working tree before a native run; no automatic commits",
        )
        for name in ("mkfs.ext4", "dumpe2fs", "mount", "umount", "dmsetup", "setpriv"):
            tool(name)
        self.state["status"] = "running"
        self.persist()
        self.calibration()
        results = [
            self.run_case(index, mode, omission)
            for index, (mode, omission) in enumerate(CASES)
        ]
        self.state["status"] = "bounded-model-campaign-completed-not-qualified"
        self.state["controls"] = [r["control"] for r in results if r["control"]]
        self.persist()
        self.trace.close()
        print(f"Evidence retained at {self.evidence}; no platform is qualified.")


def cleanup(commands, directory):
    directory = Path(directory)
    require(
        directory.is_absolute()
        and directory.resolve(strict=True) == directory
        and directory.parent == Path("/var/tmp")
        and re.fullmatch(r"wide-registry-lab-[0-9a-f]{32}", directory.name),
        "invalid owned evidence directory",
    )
    for path in (directory, directory / "run.json"):
        metadata = path.lstat()
        require(
            metadata.st_uid == 0 and not metadata.st_mode & 0o077,
            "untrusted cleanup receipt permissions",
        )
    require(
        (directory / "run.json").stat().st_size < COMMAND_BYTES, "receipt too large"
    )
    state = json.loads((directory / "run.json").read_text())
    require(
        state.get("schema") == "writers-ide.registry-native-lab/1"
        and directory.name == "wide-registry-lab-" + state["run_id"],
        "invalid cleanup receipt",
    )
    locks = device_locks(state["devices"])
    try:
        cleanup_owned(commands, directory, state)
    finally:
        for stream in locks:
            stream.close()


def cleanup_owned(commands, directory, state):
    # Cleanup never erases disks or removes evidence. Validate live ownership
    # before each unmount/remove, with no force/lazy flags or guessed resources.
    probe = Campaign.__new__(Campaign)
    probe.commands, probe.state, probe.selected = commands, state, state["devices"]
    probe.paths = {role: device["path"] for role, device in probe.selected.items()}
    probe.guard()
    base = "/run/wide-registry-lab-" + state["run_id"]
    require(state["base"] == base, "invalid cleanup mount base")
    for mapping in reversed(state["mappings"]):
        require(
            mapping["name"].startswith("wide-lab-" + state["run_id"] + "-")
            and mapping["uuid"].startswith("WIDE-LAB-" + state["run_id"] + "-"),
            "foreign mapping receipt",
        )
        actual = commands(
            [
                "dmsetup",
                "info",
                "--columns",
                "--noheadings",
                "-o",
                "uuid",
                mapping["name"],
            ]
        ).strip()
        require(actual == mapping["uuid"], "mapping ownership changed")
        require(
            commands(["dmsetup", "table", mapping["name"]]).strip() == mapping["table"],
            "mapping table changed",
        )
    for mount in reversed(list(state["mounts"])):
        probe.guard()
        require(
            mount["path"] in {base + "/source", base + "/replay"},
            "foreign mount receipt",
        )
        live = collect(commands)
        matches = [m for m in live.mount_table if m["path"] == mount["path"]]
        require(
            len(matches) == 1 and matches[0]["id"] == mount["id"],
            "mount identity changed or was never established; inspect manually",
        )
        commands(["umount", mount["path"]])
        state["mounts"].remove(mount)
        save_json(directory / "run.json", state)
    for mapping in reversed(list(state["mappings"])):
        probe.guard()
        # Recheck again immediately before removal.
        require(
            commands(
                [
                    "dmsetup",
                    "info",
                    "--columns",
                    "--noheadings",
                    "-o",
                    "uuid",
                    mapping["name"],
                ]
            ).strip()
            == mapping["uuid"],
            "mapping ownership changed",
        )
        commands(["dmsetup", "remove", mapping["name"]])
        state["mappings"].remove(mapping)
        save_json(directory / "run.json", state)
    state["cleanup"] = "owned-mounts-and-mappings-removed; disks-and-evidence-retained"
    save_json(directory / "run.json", state)
    print("Owned mounts/mappings removed. Evidence and disk contents retained.")


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    for role in ROLES:
        result.add_argument("--" + role)
    result.add_argument(
        "--execute",
        action="store_true",
        help="DESTRUCTIVE: explicit approved scratch-device campaign",
    )
    result.add_argument("--expect", help="fingerprint from current inspection")
    result.add_argument(
        "--erase", help="requires exact ERASE-THREE-SCRATCH-DISKS confirmation"
    )
    result.add_argument(
        "--build-record", help="build_workload.py JSON record; build without sudo"
    )
    result.add_argument(
        "--cleanup",
        help="explicit owned-resource cleanup using a retained root-owned evidence directory",
    )
    return result


def main(argv=None):
    args = parser().parse_args(argv)
    commands = Commands()
    require(
        os.uname().sysname == "Linux",
        "controller requires Linux; safety unit tests are portable",
    )
    if args.cleanup:
        require(
            os.geteuid() == 0
            and not args.execute
            and not any(getattr(args, role) for role in ROLES),
            "cleanup requires root and no execution/device arguments",
        )
        cleanup(commands, args.cleanup)
        return
    paths = {role: getattr(args, role) for role in ROLES}
    if not any(paths.values()):
        require(not args.execute, "execution requires explicit scratch devices")
        print(json.dumps(collect(commands).tree, indent=2))
        return
    _, selected = initial_selection(commands, paths)
    if not args.execute:
        print(
            json.dumps(
                {
                    "operation": "inspection-only",
                    "devices": selected,
                    "fingerprint": fingerprint(selected),
                    "erasure_authorized": False,
                    "qualified": False,
                },
                indent=2,
            )
        )
        return
    require(
        os.geteuid() == 0,
        "controller execution requires sudo; workload remains unprivileged",
    )
    uid, gid = (
        int(os.environ.get("SUDO_UID", "0")),
        int(os.environ.get("SUDO_GID", "0")),
    )
    execution_consent(args, selected, uid)
    require(
        gid > 0 and pwd.getpwuid(uid).pw_gid == gid, "unexpected lab-user primary group"
    )
    record_path = Path(args.build_record).resolve(strict=True)
    metadata = record_path.lstat()
    require(
        stat.S_ISREG(metadata.st_mode)
        and metadata.st_uid == uid
        and metadata.st_size <= 65536,
        "invalid build record",
    )
    record = json.loads(record_path.read_text())
    require(
        record.get("schema") == "writers-ide.registry-native-lab-build/1"
        and record.get("source_dirty") is False,
        "build record is dirty or unsupported",
    )
    executable_metadata = Path(record["executable"]).stat()
    require(
        stat.S_ISREG(executable_metadata.st_mode)
        and executable_metadata.st_uid == uid
        and executable_metadata.st_size <= 512 * 1024 * 1024,
        "invalid workload identity or size",
    )
    require(
        file_hash(record["executable"]) == record["sha256"],
        "workload changed since build",
    )
    locks = device_locks(selected)
    try:
        _, rechecked = initial_selection(commands, paths)
        require(
            rechecked == selected, "device selection changed while acquiring ownership"
        )
        campaign = Campaign(commands, selected, record["executable"], uid, gid)
        campaign.state["build"] = record
        try:
            campaign.run()
        except BaseException as error:
            campaign.state["status"] = "failed-evidence-retained"
            campaign.state["error"] = str(error)[:4096]
            campaign.persist()
            print(
                f"Stopped. Evidence and owned-resource receipt: {campaign.evidence}",
                file=sys.stderr,
            )
            raise
    finally:
        for stream in locks:
            stream.close()


if __name__ == "__main__":
    try:
        main()
    except (Refusal, OSError, ValueError, subprocess.TimeoutExpired) as error:
        print(f"REFUSED/STOPPED: {error}", file=sys.stderr)
        sys.exit(1)
