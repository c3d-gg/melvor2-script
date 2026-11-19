"""Minimal Godot 4 PCK reader (embedded or standalone). List files, extract by glob.

usage: python -I pck.py <exe-or-pck> list
       python -I pck.py <exe-or-pck> extract <outdir> <glob> [<glob>...]
"""
import fnmatch
import os
import struct
import sys

PACK_DIR_ENCRYPTED = 1
PACK_REL_FILEBASE = 2
FILE_ENCRYPTED = 1
FILE_REMOVAL = 2


def open_pack(path):
    f = open(path, "rb")
    f.seek(0, 2)
    end = f.tell()
    f.seek(0)
    forced = os.environ.get("PCK_OFFSET")
    if forced:
        start = int(forced, 0)
        f.seek(start)
        if f.read(4) != b"GDPC":
            raise SystemExit(f"no GDPC at {forced}")
    elif f.read(4) == b"GDPC":
        start = 0
    else:
        # Embedded: last 12 bytes = uint64 pck size + "GDPC".
        f.seek(end - 4)
        if f.read(4) != b"GDPC":
            raise SystemExit("no PCK found")
        f.seek(end - 12)
        (size,) = struct.unpack("<Q", f.read(8))
        start = end - size - 12
        f.seek(start)
        if f.read(4) != b"GDPC":
            raise SystemExit(f"bad embedded header at {start}")
    ver, major, minor, patch = struct.unpack("<4I", f.read(16))
    hdr = {"format": ver, "godot": f"{major}.{minor}.{patch}", "start": start}
    flags = 0
    file_base = 0
    dir_offset = None
    if ver >= 2:
        flags, file_base = struct.unpack("<IQ", f.read(12))
        if ver >= 3:
            (dir_offset,) = struct.unpack("<Q", f.read(8))
    f.read(16 * 4)  # reserved
    if ver >= 2 and (flags & PACK_REL_FILEBASE):
        file_base += start
    if dir_offset is not None:
        f.seek(start + dir_offset)
    hdr["flags"] = flags
    hdr["dir_encrypted"] = bool(flags & PACK_DIR_ENCRYPTED)
    if hdr["dir_encrypted"]:
        return f, hdr, None
    (count,) = struct.unpack("<I", f.read(4))
    files = []
    for _ in range(count):
        (plen,) = struct.unpack("<I", f.read(4))
        name = f.read(plen).rstrip(b"\0").decode("utf-8", "replace")
        off, size = struct.unpack("<QQ", f.read(16))
        md5 = f.read(16)
        fflags = 0
        if ver >= 2:
            (fflags,) = struct.unpack("<I", f.read(4))
        files.append((name, file_base + off, size, fflags))
    return f, hdr, files


def main():
    path, cmd = sys.argv[1], sys.argv[2]
    f, hdr, files = open_pack(path)
    print("header:", hdr, file=sys.stderr)
    if files is None:
        raise SystemExit("directory is encrypted")
    if cmd == "list":
        for name, off, size, fl in files:
            print(f"{size:>12} {'E' if fl & FILE_ENCRYPTED else '-'} {name}")
    elif cmd == "extract":
        out, globs = sys.argv[3], sys.argv[4:]
        n = 0
        for name, off, size, fl in files:
            rel = name.replace("res://", "")
            if not any(fnmatch.fnmatch(rel, g) for g in globs):
                continue
            if fl & FILE_ENCRYPTED:
                print("skip (encrypted):", rel, file=sys.stderr)
                continue
            dest = os.path.join(out, *rel.split("/"))
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            f.seek(off)
            with open(dest, "wb") as o:
                o.write(f.read(size))
            n += 1
        print(f"extracted {n} files", file=sys.stderr)


if __name__ == "__main__":
    main()
