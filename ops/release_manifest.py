#!/usr/bin/env python3
"""Offline release-tree manifest and strict ownership audit.

A manifest verifies bytes relative to separately trusted custody; it is NOT a
signature, runtime enforcement, or protection against changes after promotion.
CLI verify REQUIRES a root-owned, non-writable release and all its ancestors.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

SCHEMA = "saracraft-release-tree-v2"
FORBIDDEN = stat.S_ISUID | stat.S_ISGID
UNSAFE_WRITE = stat.S_IWGRP | stat.S_IWOTH


def _type_and_mode(info):
    kind = "directory" if stat.S_ISDIR(info.st_mode) else "file" if stat.S_ISREG(info.st_mode) else None
    if kind is None:
        raise ValueError("Release contains a special file")
    return kind, stat.S_IMODE(info.st_mode)


def _entry(path, rel):
    info = path.lstat()
    kind, mode = _type_and_mode(info)
    result = {
        "path": rel, "type": kind, "mode": mode,
        "uid": info.st_uid, "gid": info.st_gid,
    }
    if kind == "file":
        result["nlink"] = info.st_nlink
        result["size"] = info.st_size
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        result["sha256"] = digest.hexdigest()
    return result


def inventory(root):
    root = Path(root)
    if root.is_symlink() or not root.is_dir():
        raise ValueError("Release root must be a real directory")
    records = [_entry(root, ".")]
    for directory, dirs, names in os.walk(root, topdown=True, followlinks=False):
        for item in sorted(dirs + names):
            path = Path(directory) / item
            if path.is_symlink():
                raise ValueError("Symlinks are not permitted in this release manifest")
            kind, _ = _type_and_mode(path.lstat())
            if item in dirs and kind != "directory" or item in names and kind != "file":
                raise ValueError("Release entry type changed")
            records.append(_entry(path, path.relative_to(root).as_posix()))
        dirs.sort()
    return sorted(records, key=lambda row: row["path"])


def audit_tree(root, *, owner_uid=0, owner_gid=0, check_ancestors=True):
    """Validate current metadata independently of manifest contents.

    UID/GID overrides are for local offline test fixtures only. CLI never
    accepts overrides and always audits root ownership through '/'.
    """
    root = Path(root).absolute()
    paths = [root, *root.parents] if check_ancestors else [root]
    for path in paths:
        info = path.lstat()
        kind, mode = _type_and_mode(info)
        if kind != "directory" or info.st_uid != owner_uid or info.st_gid != owner_gid:
            raise ValueError("Release ancestor must be a root-owned directory")
        if mode & (UNSAFE_WRITE | FORBIDDEN):
            raise ValueError("Release ancestor has unsafe mode")
    for record in inventory(root):
        path = root if record["path"] == "." else root / record["path"]
        info = path.lstat()
        _, mode = _type_and_mode(info)
        if info.st_uid != owner_uid or info.st_gid != owner_gid:
            raise ValueError("Release entry is not owned by the trusted identity")
        if mode & (UNSAFE_WRITE | FORBIDDEN):
            raise ValueError("Release entry permissions are unsafe")
        if record["type"] == "file" and info.st_nlink != 1:
            raise ValueError("Release file has an external hardlink")
    return True


def build(root, output):
    # Create an untrusted candidate snapshot; promotion requires strict verify.
    root = Path(root).resolve(strict=True)
    output = Path(output).absolute()
    parent = output.parent.resolve(strict=True)
    if parent.is_relative_to(root) or output.is_symlink() or output.exists():
        raise ValueError("Output must be a new file outside the release root")
    manifest = {"schema": SCHEMA, "entries": inventory(root)}
    with output.open("x", encoding="utf-8") as stream:
        json.dump(manifest, stream, sort_keys=True, separators=(",", ":"))
        stream.write("\n")
    return len(manifest["entries"])


def _compare_manifest(root, manifest_path):
    manifest_file = Path(manifest_path)
    if manifest_file.is_symlink() or not manifest_file.is_file():
        raise ValueError("Manifest must be a real file")
    with manifest_file.open(encoding="utf-8") as stream:
        manifest = json.load(stream)
    if not isinstance(manifest, dict) or set(manifest) != {"schema", "entries"} or manifest["schema"] != SCHEMA:
        raise ValueError("Unsupported manifest schema")
    expected = manifest["entries"]
    if not isinstance(expected, list):
        raise ValueError("Invalid manifest entries")
    if expected != inventory(root):
        raise ValueError("Release tree differs from approved manifest")
    return len(expected)


def verify(root, manifest_path):
    # Fail closed. Never trust the unprivileged build or metadata-only SHA list.
    # This is an inspection, not atomic locking of the release against later writes.
    audit_tree(root)
    count = _compare_manifest(root, manifest_path)
    audit_tree(root)
    return count


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("build", "verify"))
    parser.add_argument("release_root")
    parser.add_argument("manifest")
    args = parser.parse_args(argv)
    try:
        count = build(args.release_root, args.manifest) if args.action == "build" else verify(args.release_root, args.manifest)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print("Release manifest check failed: " + type(exc).__name__, file=sys.stderr)
        return 1
    print(f"{args.action}: {count} verified entry/entries")
    return 0


if __name__ == "__main__":
    sys.exit(main())
