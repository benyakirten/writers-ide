#!/usr/bin/env python3
"""Build the opt-in Rust test executable as the ordinary Linux lab user.

Run from any directory. Installs nothing and never configures disks. The native
controller requires this build record and a clean matching source revision.
"""

import hashlib
import json
import os
import signal
import subprocess
import tempfile
import time
from pathlib import Path


def main():
    if os.geteuid() == 0:
        raise SystemExit("Do not build as root. Run this without sudo.")
    if os.uname().sysname != "Linux":
        raise SystemExit("Build this workload in the Linux VM, not on the Mac.")
    root = Path(__file__).resolve().parents[2]
    destination = root / "src-tauri/target/registry-lab"
    destination.mkdir(parents=True, exist_ok=True)
    rustc = subprocess.run(
        ["rustc", "--version", "--verbose"],
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    ).stdout
    revision = subprocess.run(
        ["git", "--no-pager", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    ).stdout.strip()
    dirty = bool(
        subprocess.run(
            ["git", "--no-optional-locks", "status", "--porcelain"],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        ).stdout
    )

    # Keep compiler messages on stderr visible, while parsing bounded JSON
    # from stdout. One build job reduces memory pressure in the disposable VM.
    # Do not apply RLIMIT_FSIZE to cargo: its artifacts can exceed this log cap.
    with tempfile.TemporaryFile(mode="w+") as output:
        process = subprocess.Popen(
            [
                "cargo",
                "test",
                "--manifest-path",
                str(root / "src-tauri/Cargo.toml"),
                "--locked",
                "--lib",
                "--no-run",
                "--jobs",
                "1",
                "--message-format=json",
            ],
            cwd=root,
            stdout=output,
            start_new_session=True,
        )
        deadline = time.monotonic() + 3600
        try:
            while process.poll() is None:
                if (
                    time.monotonic() >= deadline
                    or os.fstat(output.fileno()).st_size > 64 * 1024**2
                ):
                    raise SystemExit(
                        "Build time/log bound reached; refusing build record."
                    )
                time.sleep(0.25)
            if process.returncode:
                raise SystemExit("Cargo build failed; no build record written.")
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
        if output.tell() > 64 * 1024**2:
            raise SystemExit("Compiler JSON log exceeded bound; refusing build record.")
        output.seek(0)
        executables = []
        for line in output:
            record = json.loads(line)
            if (
                record.get("reason") == "compiler-artifact"
                and record.get("target", {}).get("name") == "writers_ide_lib"
                and record.get("profile", {}).get("test")
                and record.get("executable")
            ):
                executables.append(record["executable"])
    if len(executables) != 1:
        raise SystemExit("Expected one library-test executable.")
    executable = Path(executables[0]).resolve(strict=True)
    with executable.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    record = {
        "schema": "writers-ide.registry-native-lab-build/1",
        "executable": str(executable),
        "sha256": digest,
        "rustc": rustc,
        "source_revision": revision,
        "source_dirty": dirty,
    }
    output = destination / "build.json"
    output.write_text(json.dumps(record, indent=2) + "\n")
    print(f"Build record: {output}")
    if dirty:
        print(
            "Working tree is dirty. Native execution will refuse this record; rebuild after the source is committed."
        )


if __name__ == "__main__":
    main()
