#!/usr/bin/env python3
"""One-shot initialization of the verified disposable LUN; never general mkfs."""
import argparse
import json
import os
from pathlib import Path
import subprocess

LUN_UUID = "9a583351-01a2-45f5-abed-b38a476594dd"
FS_UUID = "256f8624-4e9c-45eb-95de-9103c3c955fe"
DEVICE = Path("/dev/disk/by-path/ip-192.168.0.43:3260-iscsi-"
              "iqn.2000-01.com.synology:lynott.obsidian-pilot-cortex-lun-1")
MOUNT = Path("/run/obsidian-pilot-cortex-init")


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--initialize-blank-lun", action="store_true")
    args = parser.parse_args()
    require(os.geteuid() == 0, "Root is required")
    require(os.uname().nodename == "bletchley002", "Not the authorized first owner")
    require(DEVICE.is_block_device(), "Expected device path is absent")
    device = DEVICE.resolve()
    tree = json.loads(run("lsblk", "--json", "--bytes", "--output",
                         "NAME,TYPE,SIZE,SERIAL,FSTYPE,MOUNTPOINTS", str(device)))
    disk, = tree["blockdevices"]
    require(disk["type"] == "disk" and disk["size"] == 5368709120,
            "Unexpected device type/capacity")
    require(disk["serial"] == LUN_UUID, "NAS LUN UUID does not match SCSI serial")
    require(not disk.get("children") and not disk.get("fstype") and
            not any(disk.get("mountpoints") or []), "Device already has state or mounts")
    require(not list((Path("/sys/class/block") / device.name / "holders").iterdir()),
            "Device has holders")
    require(not run("wipefs", "--no-act", "--noheadings", str(device)),
            "Unexpected disk signature; never erase it")
    probe = subprocess.run(["blkid", "-p", str(device)], capture_output=True)
    require(probe.returncode == 2 and not probe.stdout, "Device is not blank")
    # Read every byte before the irreversible step, not just known signature offsets.
    scanned = 0
    with device.open("rb", buffering=0) as source:
        while chunk := source.read(8 * 1024 * 1024):
            require(chunk == bytes(len(chunk)), "Nonzero data found; refuse formatting")
            scanned += len(chunk)
    require(scanned == disk["size"], "Short device read; refuse formatting")
    print("Verified target path, LUN 1, serial, 5 GiB capacity and all-zero device", flush=True)
    if not args.initialize_blank_lun:
        print("Check only: no format or mount performed")
        return
    require(not MOUNT.exists(), "Initialization mountpoint already exists")
    subprocess.run(["mkfs.ext4", "-L", "obs-pilot-cortex", "-U", FS_UUID,
                    str(DEVICE)], check=True)
    require(run("blkid", "-s", "UUID", "-o", "value", str(DEVICE)) == FS_UUID,
            "Filesystem UUID readback failed")
    MOUNT.mkdir(mode=0o700)
    mounted = False
    try:
        subprocess.run(["mount", "-t", "ext4", "-o", "nosuid,nodev,noexec",
                        str(DEVICE), str(MOUNT)], check=True)
        mounted = True
        marker = MOUNT / ".pilot-storage.json"
        with marker.open("x") as output:
            json.dump({"vault": "obsidian-pilot", "lun_uuid": LUN_UUID,
                       "filesystem_uuid": FS_UUID, "scsi_lun": 1}, output)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        directory = os.open(MOUNT, os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
        subprocess.run(["sync", "-f", str(MOUNT)], check=True)
        print("Single-owner ext4 mount, identity sentinel and filesystem sync completed")
    finally:
        if mounted:
            subprocess.run(["umount", str(MOUNT)], check=True)
        MOUNT.rmdir()
    subprocess.run(["e2fsck", "-f", "-n", str(DEVICE)], check=True)
    print("Unmounted; read-only filesystem check passed. Applications remain unreleased.")


if __name__ == "__main__":
    main()
