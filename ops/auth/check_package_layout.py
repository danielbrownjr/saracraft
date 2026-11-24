#!/usr/bin/env python3
"""Read-only structural preflight for SaraCraft authentication packaging.

This is not the PR #8 trusted manifest verifier, a provenance check, or
authorization to install anything. Run in disposable staging before root-only
promotion; the promoted layout must still pass strict manifest verification
and the launcher's trusted-tree audit.
"""
import argparse
import os
from pathlib import Path
import stat
import sys


class PackageLayoutError(ValueError):
    pass


def check_tree(root: Path) -> int:
    root = Path(root)
    if not root.is_absolute() or not stat.S_ISDIR(root.lstat().st_mode):
        raise PackageLayoutError("Candidate root must be an existing real absolute directory")
    count = 0

    def fail(error):
        raise PackageLayoutError("Could not enumerate package tree") from error

    for directory, dirs, files in os.walk(root, topdown=True, followlinks=False, onerror=fail):
        for name in [*dirs, *files]:
            entry = Path(directory) / name
            metadata = entry.lstat()
            if not (stat.S_ISREG(metadata.st_mode) or stat.S_ISDIR(metadata.st_mode)):
                raise PackageLayoutError("Package contains symlink or special file")
            if metadata.st_mode & 0o6022:
                raise PackageLayoutError("Package contains unsafe permission bits")
            if stat.S_ISREG(metadata.st_mode) and metadata.st_nlink != 1:
                raise PackageLayoutError("Package contains a hardlinked file")
            count += 1
    return count


def check_packages(release: Path, runtime: Path) -> tuple[int, int]:
    release_count = check_tree(release)
    runtime_count = check_tree(runtime)
    entry = release / "controller/connection/provision-auth.js"
    binary = runtime / "bin/node"
    if not stat.S_ISREG(entry.lstat().st_mode):
        raise PackageLayoutError("Provisioner entry must be a regular file")
    binary_info = binary.lstat()
    if not stat.S_ISREG(binary_info.st_mode) or not binary_info.st_mode & 0o111:
        raise PackageLayoutError("Node must be a regular executable")
    if not (release / "controller/connection/package-lock.json").is_file():
        raise PackageLayoutError("Pinned connection dependency lockfile is missing")
    return release_count, runtime_count


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("release", type=Path)
    parser.add_argument("node_runtime", type=Path)
    args = parser.parse_args(argv)
    try:
        counts = check_packages(args.release, args.node_runtime)
    except (OSError, ValueError):
        print("Authentication package structural preflight failed.", file=sys.stderr)
        return 1
    print(f"Package structural preflight OK: release={counts[0]}, runtime={counts[1]} entries")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
