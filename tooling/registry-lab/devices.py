"""Fail-closed device selection. No writes and no implicit disk discovery."""

import dataclasses
import hashlib
import json
import os
import re
import stat
from pathlib import Path

GIB = 1024**3
ROLES = ("data", "log", "replay")


class Refusal(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise Refusal(message)


def unescape(value):
    return re.sub(r"\\([0-7]{3})", lambda match: chr(int(match[1], 8)), value)


def mounts(text):
    result = []
    require(len(text) <= 1024 * 1024, "mountinfo too large")
    for line in text.splitlines():
        left, separator, right = line.partition(" - ")
        fields, trailing = left.split(), right.split()
        require(
            separator and len(fields) >= 6 and len(trailing) >= 3, "malformed mountinfo"
        )
        require(re.fullmatch(r"[0-9]+:[0-9]+", fields[2]), "invalid mount device")
        result.append(
            {
                "id": fields[2],
                "path": unescape(fields[4]),
                "fstype": trailing[0],
                "options": fields[5] + "," + trailing[2],
            }
        )
    require(result, "empty mountinfo")
    return result


def flatten(tree):
    nodes, edges, names = {}, {}, {}

    def visit(node, parent=None):
        key = node.get("maj:min")
        require(
            isinstance(key, str) and re.fullmatch(r"[0-9]+:[0-9]+", key),
            "invalid lsblk device identity",
        )
        name = node.get("name")
        require(
            isinstance(name, str)
            and name.startswith("/dev/")
            and not any(c.isspace() for c in name),
            "unsafe device name",
        )
        require(name not in names or names[name] == key, "ambiguous device name")
        names[name] = key
        if key in nodes:
            require(
                nodes[key]["name"] == name and nodes[key]["size"] == node["size"],
                "ambiguous device identity",
            )
        nodes[key] = node
        edges.setdefault(key, set())
        if parent:
            edges[parent].add(key)
        for child in node.get("children", []):
            visit(child, key)

    require(isinstance(tree.get("blockdevices"), list), "missing lsblk inventory")
    for node in tree["blockdevices"]:
        visit(node)
    return nodes, edges


def descendants(edges, key):
    seen, pending = set(), [key]
    while pending:
        current = pending.pop()
        if current in seen:
            continue
        seen.add(current)
        pending.extend(edges.get(current, ()))
    return seen


@dataclasses.dataclass(frozen=True)
class Snapshot:
    tree: dict
    mount_table: tuple[dict, ...]
    swap_ids: frozenset[str]
    boot_id: str
    sysfs: dict

    def select(self, paths, owned_maps=None, owned_mounts=None):
        owned_maps = owned_maps or set()
        owned_mounts = owned_mounts or set()
        require(set(paths) == set(ROLES), "select exactly data, log and replay devices")
        nodes, edges = flatten(self.tree)
        by_name = {node["name"]: key for key, node in nodes.items()}
        selected, identities = {}, set()
        for role in ROLES:
            path = paths[role]
            require(path in by_name, f"{role}: device absent from inventory")
            key = by_name[path]
            node = nodes[key]
            require(key not in identities, "scratch devices alias one another")
            identities.add(key)
            require(node.get("type") == "disk", f"{role}: whole scratch disk required")
            require(
                node.get("ro") is False and node.get("rm") is False,
                f"{role}: read-only/removable device",
            )
            require(
                isinstance(node.get("size"), int) and GIB <= node["size"] <= 4 * GIB,
                f"{role}: expected 1–4 GiB scratch disk",
            )
            dependent = descendants(edges, key)
            require(
                all(nodes[item]["name"] in owned_maps for item in dependent - {key}),
                f"{role}: partitions or unowned device dependencies",
            )
            for mount in self.mount_table:
                if mount["id"] in dependent:
                    require(
                        mount["path"] in owned_mounts,
                        f"{role}: mounted or backs mounted storage",
                    )
            require(not self.swap_ids.intersection(dependent), f"{role}: active swap")
            require(
                not node.get("mountpoints")
                or all(p is None or p in owned_mounts for p in node["mountpoints"]),
                f"{role}: mounted whole disk",
            )
            identity = self.sysfs.get(key)
            require(
                identity is not None and not identity["partition"],
                f"{role}: missing/partition sysfs identity",
            )
            require(
                set(identity["holders"]).issubset(owned_maps), f"{role}: unowned holder"
            )
            selected[role] = {
                "path": path,
                "id": key,
                "size": node["size"],
                "model": node.get("model"),
                "serial": node.get("serial"),
                "wwn": node.get("wwn"),
                "sysfs": identity["path"],
                "boot_id": self.boot_id,
            }
        return selected


def fingerprint(selected):
    return hashlib.sha256(
        json.dumps(selected, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def collect(run):
    require(os.uname().sysname == "Linux", "native device inspection requires Linux")
    tree = json.loads(
        run(
            [
                "lsblk",
                "--json",
                "--bytes",
                "--paths",
                "--output",
                "NAME,MAJ:MIN,SIZE,TYPE,FSTYPE,MOUNTPOINTS,RO,RM,MODEL,SERIAL,WWN",
            ]
        )
    )
    nodes, _ = flatten(tree)
    sysfs = {}
    for key in nodes:
        link = Path("/sys/dev/block") / key
        if link.exists():
            holders = ["/dev/" + p.name for p in (link / "holders").iterdir()]
            sysfs[key] = {
                "path": str(link.resolve(strict=True)),
                "partition": (link / "partition").exists(),
                "holders": holders,
            }
    mount_table = mounts(Path("/proc/self/mountinfo").read_text())
    swaps = Path("/proc/swaps").read_text().splitlines()
    require(swaps and swaps[0].startswith("Filename"), "missing swap inventory")
    swap_ids = set()
    for row in swaps[1:]:
        fields = row.split()
        require(len(fields) == 5, "malformed swap inventory")
        metadata = os.stat(unescape(fields[0]))
        dev = metadata.st_rdev if stat.S_ISBLK(metadata.st_mode) else metadata.st_dev
        swap_ids.add(f"{os.major(dev)}:{os.minor(dev)}")
    boot_id = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
    require(re.fullmatch(r"[0-9a-f-]{36}", boot_id), "missing boot identity")
    return Snapshot(tree, tuple(mount_table), frozenset(swap_ids), boot_id, sysfs)


def verify_block_nodes(selected):
    for device in selected.values():
        path = Path(device["path"])
        metadata = path.lstat()
        require(stat.S_ISBLK(metadata.st_mode), "device is not a direct block node")
        require(
            f"{os.major(metadata.st_rdev)}:{os.minor(metadata.st_rdev)}"
            == device["id"],
            "device node identity changed",
        )
