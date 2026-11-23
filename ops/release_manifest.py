#!/usr/bin/env python3
"""Offline release-tree manifest tool; never installs software or accesses credentials.

A manifest is evidence for an administrator-controlled promotion, NOT a signature.
Do not trust a manifest supplied by the same writable party as the release.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

SCHEMA = "saracraft-release-tree-v1"

def inventory(root):
    root = Path(root)
    if root.is_symlink() or not root.is_dir():
        raise ValueError("Release root must be a real directory")
    records = []
    for directory, dirs, names in os.walk(root, topdown=True, followlinks=False):
        for item in sorted(dirs + names):
            path = Path(directory) / item
            if path.is_symlink():
                raise ValueError("Symlinks are not permitted in this release manifest")
            mode = path.lstat().st_mode
            if not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
                raise ValueError("Only regular files and directories are permitted")
        dirs.sort()
        for name in sorted(names):
            path = Path(directory) / name
            relative = path.relative_to(root).as_posix()
            digest = hashlib.sha256()
            with path.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
            records.append({"path": relative, "sha256": digest.hexdigest(), "size": path.stat().st_size})
    return sorted(records, key=lambda row: row["path"])

def build(root, output):
    # Write only an explicitly chosen output outside the release directory.
    root = Path(root).resolve(strict=True)
    output = Path(output).absolute()
    if output.is_relative_to(root) or output.is_symlink() or output.exists():
        raise ValueError("Output must be a new file outside the release root")
    manifest = {"schema": SCHEMA, "files": inventory(root)}
    with output.open("x", encoding="utf-8") as stream:
        json.dump(manifest, stream, sort_keys=True, separators=(",", ":"))
        stream.write("\n")
    return len(manifest["files"])

def verify(root, manifest_path):
    manifest_file = Path(manifest_path)
    if manifest_file.is_symlink() or not manifest_file.is_file():
        raise ValueError("Manifest must be a real file")
    with manifest_file.open(encoding="utf-8") as stream:
        manifest = json.load(stream)
    if not isinstance(manifest, dict) or set(manifest) != {"schema", "files"} or manifest["schema"] != SCHEMA:
        raise ValueError("Unsupported manifest schema")
    expected = manifest["files"]
    if not isinstance(expected, list) or any(not isinstance(x, dict) or set(x) != {"path", "sha256", "size"} for x in expected):
        raise ValueError("Invalid manifest rows")
    actual = inventory(root)
    if actual != expected:
        raise ValueError("Release tree differs from approved manifest")
    return len(actual)

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
    print(f"{args.action}: {count} verified file(s)")
    return 0

if __name__ == "__main__":
    sys.exit(main())
