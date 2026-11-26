"""Bounded dm-log-writes v1 reader/replayer, not a physical device model.

Format reference: Linux v6.8 drivers/md/dm-log-writes.c. Unknown records fail
closed. Discards are refused; the controller disables mkfs/mount discard.
No device is opened by this module. Callers supply already validated streams.
"""

import dataclasses
import struct

MAGIC = 0x6A736677736872
FLUSH, FUA, DISCARD, MARK, METADATA = 1, 2, 4, 8, 16
MAX_LOG_BYTES = 256 * 1024 * 1024
MAX_ENTRIES = 100_000
MAX_RECORD_BYTES = 16 * 1024 * 1024
SUPER = struct.Struct("<QQQI")
ENTRY = struct.Struct("<QQQQ")


class LogError(ValueError):
    pass


@dataclasses.dataclass(frozen=True)
class Record:
    offset: int
    length: int
    payload: int
    flags: int
    mark: str | None


@dataclasses.dataclass(frozen=True)
class Log:
    records: tuple[Record, ...]
    used_bytes: int
    sector_size: int

    def cuts(self):
        return {r.mark: i for i, r in enumerate(self.records) if r.mark is not None}


def exact(stream, size):
    value = stream.read(size)
    if len(value) != size:
        raise LogError("truncated log")
    return value


def inspect(stream, device_bytes, log_limit=MAX_LOG_BYTES):
    stream.seek(0)
    magic, version, count, sector_size = SUPER.unpack(exact(stream, SUPER.size))
    if magic != MAGIC or version != 1 or sector_size not in (512, 4096):
        raise LogError("unknown log format or sector size")
    if not 0 < count <= MAX_ENTRIES or not 0 < log_limit <= MAX_LOG_BYTES:
        raise LogError("invalid log bounds")
    cursor = sector_size
    records, marks = [], set()
    for _ in range(count):
        if cursor + sector_size > log_limit:
            raise LogError("log byte limit")
        stream.seek(cursor)
        header = exact(stream, sector_size)
        sector, sectors, flags, data_len = ENTRY.unpack_from(header)
        if flags & ~(FLUSH | FUA | MARK | METADATA) or flags & DISCARD:
            raise LogError("unknown flags or unsupported discard")
        offset, length = sector * sector_size, sectors * sector_size
        payload = cursor + sector_size
        mark = None
        if flags & MARK:
            if (
                flags != MARK
                or sectors
                or sector
                or not 0 < data_len <= sector_size - ENTRY.size
            ):
                raise LogError("malformed mark")
            raw = header[ENTRY.size : ENTRY.size + data_len]
            # log_mark stores strlen(data), excluding the terminating NUL.
            try:
                mark = raw.decode("ascii")
            except UnicodeDecodeError as error:
                raise LogError("non-ASCII mark") from error
            if (
                not mark
                or len(mark) > 128
                or not all(c.isalnum() or c in "-_" for c in mark)
            ):
                raise LogError("unsafe mark")
            if mark in marks:
                raise LogError("duplicate mark")
            marks.add(mark)
        else:
            if data_len or length > MAX_RECORD_BYTES or offset + length > device_bytes:
                raise LogError("invalid write range or inline payload")
            if payload + length > log_limit:
                raise LogError("payload exceeds log bound")
            if length:
                stream.seek(payload + length - 1)
                exact(stream, 1)
        records.append(Record(offset, length, payload, flags, mark))
        cursor = payload + (0 if mark is not None else length)
    return Log(tuple(records), cursor, sector_size)


def replay(log, source, target, cut):
    """Apply one prefix to a freshly zeroed baseline. No source tail is applied."""
    if not 0 <= cut < len(log.records):
        raise LogError("invalid replay cut")
    for record in log.records[: cut + 1]:
        remaining = record.length
        if not remaining:
            continue
        source.seek(record.payload)
        target.seek(record.offset)
        while remaining:
            data = exact(source, min(remaining, 1024 * 1024))
            written = target.write(data)
            if written != len(data):
                raise LogError("short replay write")
            remaining -= written
    target.flush()
