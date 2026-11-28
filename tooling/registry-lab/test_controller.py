"""Controller integration tests with fake workloads and regular temporary files.

No sudo, block devices, mounts, mappings or native storage experiments are used.
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import lab
from devices import Refusal
from log_format import MARK, inspect
from test_lab import image, snapshot


class Integration(unittest.TestCase):
    def test_root_build_is_refused_before_any_subprocess(self):
        import build_workload

        with (
            patch("build_workload.os.geteuid", return_value=0),
            patch("build_workload.subprocess.run") as run,
        ):
            with self.assertRaisesRegex(SystemExit, "Do not build as root"):
                build_workload.main()
            run.assert_not_called()

    def test_unknown_flags_and_ambiguous_names_are_refused(self):
        for field in ("ro", "rm"):
            current = snapshot()
            current.tree["blockdevices"][1][field] = None
            with self.assertRaises(Refusal):
                current.select(
                    {"data": "/dev/vdb", "log": "/dev/vdc", "replay": "/dev/vdd"}
                )
        current = snapshot()
        duplicate = dict(current.tree["blockdevices"][1])
        duplicate["maj:min"] = "252:98"
        current.tree["blockdevices"].append(duplicate)
        with self.assertRaises(Refusal):
            current.select(
                {"data": "/dev/vdb", "log": "/dev/vdc", "replay": "/dev/vdd"}
            )

    def test_real_pipe_protocol_success_and_malformed_event_stop(self):
        real_popen = subprocess.Popen
        for payload, succeeds in (
            ({"event": "validated", "state": "new", "stable_parent": True}, True),
            ({"event": "unknown"}, False),
        ):
            campaign = lab.Campaign.__new__(lab.Campaign)
            campaign.commands = lab.Commands(seconds=10)
            campaign.uid, campaign.gid = os.getuid(), os.getgid()
            campaign.source = campaign.target = Path("/unused-scratch")
            campaign.workload = Path("/unused-executable")
            campaign.guard = lambda: None
            campaign.result, campaign.acknowledged = None, False
            events = []
            campaign.event = events.append
            children = []
            script = (
                "import sys; print("
                + repr("WIDE_REGISTRY_LAB " + json.dumps(payload))
                + ",flush=True); assert sys.stdin.readline() == 'ok\\n'"
            )

            def spawn(args, **kwargs):
                child = real_popen([sys.executable, "-u", "-c", script], **kwargs)
                children.append(child)
                return child

            with (
                patch("lab.tool", side_effect=lambda name: name),
                patch("lab.subprocess.Popen", side_effect=spawn),
            ):
                if succeeds:
                    campaign.workload_run("validate", "first", "none")
                    self.assertEqual(campaign.result, "new")
                    self.assertTrue(campaign.stable_parent)
                else:
                    with self.assertRaises(Refusal):
                        campaign.workload_run("validate", "first", "none")
            self.assertTrue(all(child.poll() is not None for child in children))

    def test_normal_ack_loss_fails_and_controls_report_detection_or_masking(self):
        for omission, final, outcome in (
            ("none", "new", None),
            ("none", "recovery", "refused"),
            ("final", "recovery", "detected"),
            ("final", "new", "masked-by-native-persistence"),
        ):
            with (
                self.subTest(omission=omission, final=final),
                tempfile.TemporaryDirectory() as directory,
            ):
                root = Path(directory)
                raw = image(
                    [
                        (0, b"baseline-ready", MARK),
                        (0, b"before-GenerationDirectory", MARK),
                        (0, b"after-native-selection", MARK),
                        (0, b"acknowledged-success", MARK),
                    ]
                )
                parsed = inspect(raw, 4096)
                log = root / "log"
                log.write_bytes(raw.getvalue())
                replay = root / "replay"
                replay.write_bytes(bytes(4096))
                campaign = lab.Campaign.__new__(lab.Campaign)
                campaign.evidence = root
                campaign.source, campaign.target = root / "source", root / "target"
                campaign.paths = {"replay": str(replay)}
                campaign.mapping = "/unused-mapping"
                campaign.cut_count = 0
                campaign.guard = campaign.reset = lambda: None
                campaign.start_logging = lambda: "/unused-log"
                campaign.stop_logging = campaign.unmount = lambda path: None
                campaign.mount = lambda device, path: None
                campaign.commands = lambda args: "synthetic-filesystem"
                campaign.event = lambda value: None
                campaign.save_log = lambda name: (log, parsed)
                states = iter(("recovery", "recovery", "new", final))

                def workload(action, mode, omit):
                    if action == "capture":
                        campaign.acknowledged = True
                        campaign.mark_labels = list(parsed.cuts())
                    elif action == "validate":
                        campaign.result = next(states)
                        campaign.stable_parent = True

                campaign.workload_run = workload
                with (
                    patch("lab.collect", return_value=snapshot()),
                    patch("lab.DATA_BYTES", 4096),
                ):
                    if outcome == "refused":
                        with self.assertRaisesRegex(
                            Refusal, "acknowledged publication"
                        ):
                            campaign.run_case(0, "first", omission)
                    else:
                        result = campaign.run_case(0, "first", omission)
                        self.assertEqual(result["control"], outcome)
                        self.assertEqual(len(result["results"]), 4)

    def test_phase_specific_invariants_do_not_accept_early_new_or_lost_old(self):
        for mode, state, selected, stable in (
            ("first", "new", False, True),
            ("replace", "new", False, True),
            ("replace", "recovery", False, True),
            ("replace", "recovery", True, True),
            ("first", "old", True, True),
            ("first", "new", True, False),
        ):
            with (
                self.subTest(mode=mode, state=state, selected=selected),
                self.assertRaises(Refusal),
            ):
                lab.cut_invariant(mode, "none", "boundary", state, selected, stable)
        lab.cut_invariant("replace", "none", "boundary", "old", False, True)
        lab.cut_invariant("replace", "none", "boundary", "new", True, True)

    def test_cleanup_rechecks_device_identity_before_unmount_or_remove(self):
        state = {
            "run_id": "a" * 32,
            "base": "/run/wide-registry-lab-" + "a" * 32,
            "devices": snapshot().select(
                {"data": "/dev/vdb", "log": "/dev/vdc", "replay": "/dev/vdd"}
            ),
            "mounts": [],
            "mappings": [],
        }
        changed = snapshot()
        changed.sysfs["252:16"]["path"] = "/changed-device"
        calls = []
        with (
            patch("lab.collect", return_value=changed),
            patch("lab.verify_block_nodes"),
        ):
            with self.assertRaisesRegex(Refusal, "identity changed"):
                lab.cleanup_owned(
                    lambda args: calls.append(args), Path("/unused-evidence"), state
                )
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
