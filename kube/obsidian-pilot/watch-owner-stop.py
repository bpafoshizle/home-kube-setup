#!/usr/bin/env python3
"""Observe actual clean container exits; Pod disappearance alone is not proof."""
import argparse
import datetime
import json
import os
import subprocess
import threading
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pod", required=True)
    parser.add_argument("--uid", required=True)
    parser.add_argument("--proof-file", required=True)
    args = parser.parse_args()
    command = ["kubectl", "--context=kubernetes-admin@kubernetes", "--request-timeout=0",
               "-n", "obsidian-pilot", "get", "pod", args.pod,
               "--watch", "--output-watch-events", "-o", "json"]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    timer = threading.Timer(180, process.terminate)
    timer.start()
    decoder = json.JSONDecoder()
    buffer = ""
    deletion_seen = None
    try:
        for line in process.stdout:
            buffer += line
            while buffer.strip():
                try:
                    event, end = decoder.raw_decode(buffer.lstrip())
                except json.JSONDecodeError:
                    break
                buffer = buffer.lstrip()[end:]
                pod = event.get("object", {})
                if pod.get("metadata", {}).get("uid") != args.uid:
                    continue
                if pod["metadata"].get("deletionTimestamp") and deletion_seen is None:
                    deletion_seen = time.monotonic()
                statuses = pod.get("status", {}).get("containerStatuses", [])
                if {item["name"] for item in statuses} != {"livesync", "cortex"}:
                    continue
                if not all("terminated" in item["state"] for item in statuses):
                    continue
                exits = {item["name"]: item["state"]["terminated"]["exitCode"] for item in statuses}
                elapsed = time.monotonic() - deletion_seen if deletion_seen is not None else None
                if not all(value == 0 for value in exits.values()) or elapsed is None or elapsed >= 14:
                    raise SystemExit("Container exits observed but clean shutdown within guard limit not established; keep replacement gated")
                proof = {"pod": args.pod, "podUID": args.uid, "node": pod["spec"]["nodeName"],
                         "actualContainerExitsObserved": exits, "secondsAfterDeletionNotice": round(elapsed, 3),
                         "observedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
                fd = os.open(args.proof_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, "w") as output:
                    json.dump(proof, output)
                    output.flush()
                    os.fsync(output.fileno())
                print(json.dumps(proof), flush=True)
                return
        raise SystemExit("No positive clean-exit proof observed; keep replacement gated")
    finally:
        timer.cancel()
        process.terminate()
        process.wait(timeout=10)


if __name__ == "__main__":
    main()
