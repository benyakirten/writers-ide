"""Portable safety/format tests: synthetic inventory and in-memory block images only."""

import copy
import dataclasses
import io
import json
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import lab
from devices import GIB, Refusal, Snapshot, fingerprint, mounts
from log_format import ENTRY, FLUSH, FUA, MAGIC, MARK, SUPER, LogError, inspect, replay


def disk(name, number, **overrides):
    return {
        "name": "/dev/" + name,
        "maj:min": "252:" + str(number),
        "size": 4 * GIB,
        "type": "disk",
        "ro": False,
        "rm": False,
        "fstype": None,
        "mountpoints": [None],
        **overrides,
    }


def snapshot():
    nodes = [
        disk("vda", 0, size=32 * GIB),
        disk("vdb", 16),
        disk("vdc", 32),
        disk("vdd", 48),
    ]
    return Snapshot(
        {"blockdevices": nodes},
        ({"id": "252:0", "path": "/", "fstype": "ext4", "options": "rw"},),
        frozenset(),
        "boot-identity",
        {
            node["maj:min"]: {
                "path": "/sys/devices/" + node["name"].removeprefix("/dev/"),
                "partition": False,
                "holders": [],
            }
            for node in nodes
        },
    )


def paths():
    return dict(data="/dev/vdb", log="/dev/vdc", replay="/dev/vdd")


def image(entries, sector_size=512):
    output = io.BytesIO()
    output.write(
        SUPER.pack(MAGIC, 1, len(entries), sector_size).ljust(sector_size, b"\0")
    )
    for sector, data, flags in entries:
        mark = data if flags == MARK else b""
        length = 0 if flags == MARK else len(data) // sector_size
        header = ENTRY.pack(sector, length, flags, len(mark)) + mark
        output.write(header.ljust(sector_size, b"\0"))
        if flags != MARK:
            output.write(data)
    output.seek(0)
    return output


class DeviceSafety(unittest.TestCase):
    def test_blank_unmounted_distinct_disks(self):
        selected = snapshot().select(paths())
        self.assertEqual(selected["data"]["id"], "252:16")
        self.assertEqual(len(fingerprint(selected)), 64)

    def test_alias_missing_and_partial_selection(self):
        for selected in (
            {**paths(), "log": "/dev/vdb"},
            {**paths(), "data": "/dev/missing"},
            {"data": "/dev/vdb"},
        ):
            with self.subTest(selected=selected), self.assertRaises(Refusal):
                snapshot().select(selected)

    def test_system_disk_is_refused_even_when_sized_like_scratch(self):
        current = snapshot()
        current.tree["blockdevices"][0]["size"] = 4 * GIB
        with self.assertRaises(Refusal):
            current.select({**paths(), "data": "/dev/vda"})

    def test_lvm_boot_partition_and_unknown_holders_are_refused(self):
        for kind in ("part", "lvm", "crypt", "raid1"):
            current = snapshot()
            child = disk("child", 99, type=kind)
            current.tree["blockdevices"][1]["children"] = [child]
            with self.subTest(kind=kind), self.assertRaises(Refusal):
                current.select(paths())
        current = snapshot()
        current.sysfs["252:16"]["holders"] = ["/dev/dm-9"]
        with self.assertRaises(Refusal):
            current.select(paths())

    def test_readonly_removable_partition_missing_sysfs_and_bad_size(self):
        for override in (
            {"ro": True},
            {"rm": True},
            {"size": GIB - 1},
            {"size": 5 * GIB},
            {"type": "part"},
        ):
            current = snapshot()
            current.tree["blockdevices"][1].update(override)
            with self.subTest(override=override), self.assertRaises(Refusal):
                current.select(paths())
        current = snapshot()
        del current.sysfs["252:16"]
        with self.assertRaises(Refusal):
            current.select(paths())

    def test_mount_swap_and_misleading_mountpoints(self):
        current = snapshot()
        for change in (
            {"swap_ids": frozenset({"252:16"})},
            {
                "mount_table": (
                    *current.mount_table,
                    {
                        "id": "252:16",
                        "path": "/data",
                        "fstype": "ext4",
                        "options": "rw",
                    },
                )
            },
        ):
            with self.subTest(change=change), self.assertRaises(Refusal):
                dataclasses.replace(current, **change).select(paths())
        current.tree["blockdevices"][1]["mountpoints"] = ["/hidden"]
        with self.assertRaises(Refusal):
            current.select(paths())

    def test_only_exact_owned_mapping_and_mount_are_allowed(self):
        current = snapshot()
        child = disk("dm-1", 99, type="dm", mountpoints=["/run/lab/source"])
        current.tree["blockdevices"][1]["children"] = [child]
        current.sysfs["252:16"]["holders"] = ["/dev/dm-1"]
        current = dataclasses.replace(
            current,
            mount_table=(
                *current.mount_table,
                {
                    "id": "252:99",
                    "path": "/run/lab/source",
                    "fstype": "ext4",
                    "options": "rw",
                },
            ),
        )
        with self.assertRaises(Refusal):
            current.select(paths())
        self.assertEqual(
            current.select(paths(), {"/dev/dm-1"}, {"/run/lab/source"})["data"]["id"],
            "252:16",
        )
        with self.assertRaises(Refusal):
            current.select(paths(), {"/dev/dm-1"}, {"/run/somewhere-else"})

    def test_owned_direct_replay_mount_is_allowed_not_arbitrary_mounts(self):
        current = snapshot()
        current.tree["blockdevices"][3]["mountpoints"] = ["/run/lab/replay"]
        current = dataclasses.replace(
            current,
            mount_table=(
                *current.mount_table,
                {
                    "id": "252:48",
                    "path": "/run/lab/replay",
                    "fstype": "ext4",
                    "options": "rw",
                },
            ),
        )
        current.select(paths(), owned_mounts={"/run/lab/replay"})
        with self.assertRaises(Refusal):
            current.select(paths())

    def test_fingerprint_detects_identity_size_and_boot_changes(self):
        selected = snapshot().select(paths())
        original = fingerprint(selected)
        for key, value in (
            ("size", GIB),
            ("id", "252:17"),
            ("boot_id", "new-boot"),
            ("sysfs", "/different/path"),
        ):
            changed = copy.deepcopy(selected)
            changed["data"][key] = value
            self.assertNotEqual(fingerprint(changed), original)

    def test_mountinfo_escapes_and_malformed_inputs(self):
        result = mounts("10 1 252:16 / /a\\040b rw - ext4 /dev/vdb rw,data=ordered\n")
        self.assertEqual(result[0]["path"], "/a b")
        for text in ("", "broken", "10 1 invalid / / rw - ext4 dev rw"):
            with self.subTest(text=text), self.assertRaises(Refusal):
                mounts(text)

    def test_full_blank_scan_rejects_nonzero_tail_and_truncation(self):
        lab.require_blank(io.BytesIO(bytes(2048)), 2048)
        for content, size in ((bytes(2047) + b"X", 2048), (bytes(2048), 4096)):
            with self.assertRaises(Refusal):
                lab.require_blank(io.BytesIO(content), size)


class LogFormat(unittest.TestCase):
    def test_prefix_replay_excludes_later_writes(self):
        source = image(
            [
                (0, b"A" * 512, 0),
                (0, b"durable", MARK),
                (1, b"B" * 512, FUA),
                (0, b"later", MARK),
            ]
        )
        log = inspect(source, 2048)
        target = io.BytesIO(bytes(2048))
        replay(log, source, target, log.cuts()["durable"])
        self.assertEqual(target.getvalue()[:1024], b"A" * 512 + bytes(512))
        replay(log, source, target, log.cuts()["later"])
        self.assertEqual(target.getvalue()[:1024], b"A" * 512 + b"B" * 512)

    def test_4k_sector_and_flush_without_payload(self):
        source = image(
            [(0, b"A" * 4096, FUA), (0, b"", FLUSH), (0, b"cut", MARK)], 4096
        )
        log = inspect(source, 8192)
        self.assertEqual(log.sector_size, 4096)
        self.assertEqual(log.cuts()["cut"], 2)

    def test_bad_super_and_truncated_data_are_refused(self):
        good = image([(0, b"A" * 512, 0)]).getvalue()
        for content in (b"", b"bad" + good[3:], good[:-1]):
            with self.assertRaises(LogError):
                inspect(io.BytesIO(content), 4096)
        for magic, version, count, sector in (
            (MAGIC, 2, 1, 512),
            (MAGIC, 1, 100001, 512),
            (MAGIC, 1, 1, 1024),
            (MAGIC, 1, 0, 512),
        ):
            with self.assertRaises(LogError):
                inspect(
                    io.BytesIO(
                        SUPER.pack(magic, version, count, sector).ljust(512, b"\0")
                    ),
                    4096,
                )

    def test_unknown_flags_discard_and_out_of_range_writes_are_refused(self):
        for sector, data, flags in (
            (0, bytes(512), 32),
            (0, bytes(512), 4),
            (16, bytes(512), 0),
        ):
            with self.assertRaises(LogError):
                inspect(image([(sector, data, flags)]), 4096)

    def test_duplicate_unsafe_marks_and_log_budget_are_refused(self):
        for records in (
            [(0, b"same", MARK), (0, b"same", MARK)],
            [(0, b"../bad", MARK)],
            [(0, b"a\0b", MARK)],
            [(0, b"\xff", MARK)],
        ):
            with self.assertRaises(LogError):
                inspect(image(records), 4096)
        with self.assertRaises(LogError):
            inspect(image([(0, bytes(512), 0)]), 4096, log_limit=1024)

    def test_invalid_cut_and_short_write_fail(self):
        source = image([(0, bytes(512), 0)])
        parsed = inspect(source, 4096)
        for cut in (-1, 1):
            with self.assertRaises(LogError):
                replay(parsed, source, io.BytesIO(bytes(4096)), cut)

        class Short(io.BytesIO):
            def write(self, data):
                return 0

        with self.assertRaises(LogError):
            replay(parsed, source, Short(), 0)


class Controller(unittest.TestCase):
    def test_default_is_inspection_and_requires_independent_consent(self):
        args = lab.parser().parse_args([])
        self.assertFalse(args.execute)
        selected = snapshot().select(paths())
        with patch("lab.os.uname") as uname:
            uname.return_value.sysname = "Linux"
            for expect, erase, record, uid in (
                (None, None, None, 1000),
                (fingerprint(selected), None, "record", 1000),
                ("stale", "ERASE-THREE-SCRATCH-DISKS", "record", 1000),
                (fingerprint(selected), "ERASE-THREE-SCRATCH-DISKS", None, 1000),
                (fingerprint(selected), "ERASE-THREE-SCRATCH-DISKS", "record", 0),
            ):
                args.expect, args.erase, args.build_record = expect, erase, record
                with (
                    self.subTest(expect=expect, erase=erase, record=record, uid=uid),
                    self.assertRaises(Refusal),
                ):
                    lab.execution_consent(args, selected, uid)
            args.expect, args.erase, args.build_record = (
                fingerprint(selected),
                "ERASE-THREE-SCRATCH-DISKS",
                "record",
            )
            lab.execution_consent(args, selected, 1000)

    def test_inspection_never_constructs_campaign_or_mutates_devices(self):
        selected = snapshot().select(paths())
        with (
            patch("lab.os.uname") as uname,
            patch("lab.initial_selection", return_value=(snapshot(), selected)),
            patch("lab.Campaign") as campaign,
            patch("lab.zero_prefix") as erase,
            patch("builtins.print"),
        ):
            uname.return_value.sysname = "Linux"
            lab.main(
                ["--data", "/dev/vdb", "--log", "/dev/vdc", "--replay", "/dev/vdd"]
            )
            campaign.assert_not_called()
            erase.assert_not_called()

    def test_identity_change_stops_before_reset(self):
        campaign = lab.Campaign.__new__(lab.Campaign)
        campaign.commands = lambda args: ""
        campaign.state = {"mappings": [], "mounts": []}
        campaign.paths = paths()
        campaign.selected = snapshot().select(paths())
        changed = snapshot()
        changed.sysfs["252:16"]["path"] = "/sys/replaced"
        with (
            patch("lab.collect", return_value=changed),
            patch("lab.verify_block_nodes"),
            patch("lab.zero_prefix") as erase,
        ):
            with self.assertRaises(Refusal):
                campaign.reset()
            erase.assert_not_called()

    def test_foreign_mapping_uuid_or_table_prevents_removal(self):
        campaign = lab.Campaign.__new__(lab.Campaign)
        mapping = {"name": "owned", "uuid": "expected", "table": "expected-table"}
        for outputs in (("foreign",), ("expected", "foreign-table")):
            calls = []
            values = iter(outputs)

            def commands(args):
                calls.append(args)
                return next(values)

            campaign.commands = commands
            with self.assertRaises(Refusal):
                campaign.check_mapping(mapping)
            self.assertFalse(any("remove" in call for call in calls))

    def test_protocol_refuses_unknown_or_wrong_action_before_acknowledging(self):
        campaign = lab.Campaign.__new__(lab.Campaign)
        campaign.acknowledged, campaign.result = False, None
        campaign.mark = lambda label: None
        campaign.event = lambda event: None
        for event, action in (
            ({"event": "anything"}, "capture"),
            ({"event": "acknowledged", "generation": "bad"}, "capture"),
            ({"event": "mark", "label": "test"}, "validate"),
            ({"event": "validated", "state": "new"}, "capture"),
        ):
            with self.subTest(event=event, action=action), self.assertRaises(Refusal):
                campaign.workload_event(event, action)

    def test_log_marks_do_not_request_flush_and_duplicates_fail(self):
        campaign = lab.Campaign.__new__(lab.Campaign)
        campaign.mark_labels, campaign.mapping = [], "/dev/mapper/owned"
        campaign.guard = lambda: None
        calls = []
        campaign.commands = lambda args: calls.append(args)
        campaign.mark("after-barrier")
        self.assertEqual(
            calls,
            [["dmsetup", "message", "/dev/mapper/owned", "0", "mark", "after-barrier"]],
        )
        with self.assertRaises(Refusal):
            campaign.mark("after-barrier")
        with self.assertRaises(Refusal):
            campaign.mark("unsafe label")

    def test_atomic_receipt_retains_old_record_on_serialization_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "run.json"
            lab.save_json(path, {"status": "old"})
            with self.assertRaises(TypeError):
                lab.save_json(path, {"bad": object()})
            self.assertEqual(json.loads(path.read_text()), {"status": "old"})

    def test_deadline_and_unsafe_cleanup_refuse(self):
        commands = lab.Commands(seconds=-1)
        with self.assertRaises(Refusal):
            commands.remaining()
        with self.assertRaises(Refusal):
            lab.cleanup(
                lambda args: self.fail("must not execute cleanup commands"), "/"
            )


if __name__ == "__main__":
    unittest.main()
