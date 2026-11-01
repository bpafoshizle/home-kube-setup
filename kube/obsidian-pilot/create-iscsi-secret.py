#!/usr/bin/env python3
"""Create only the pilot kubelet CHAP Secret, without printing secret material."""
import base64
import json
import os
from pathlib import Path
import stat
import subprocess

ROOT = Path(__file__).resolve().parents[2]
CONTEXT = "kubernetes-admin@kubernetes"
NAMESPACE = "obsidian-pilot"
NAME = "cortex-iscsi-chap"


def kubectl(*args, payload=None):
    result = subprocess.run(
        ["kubectl", "--context=" + CONTEXT, "--request-timeout=20s", *args],
        input=payload, text=True, capture_output=True,
    )
    if result.returncode:
        # Validation/authentication errors must not accidentally echo secret input.
        raise SystemExit("CHAP Secret operation failed; output withheld. Inspect non-secret resource status.")
    return result.stdout


def main():
    path = ROOT / "sensitive/obsidian-pilot/chap.json"
    if path.is_symlink() or path.parent.is_symlink():
        raise SystemExit("Refusing symlinked credential storage")
    for item, mode in [(path, 0o600), (path.parent, 0o700)]:
        info = item.stat()
        if stat.S_IMODE(info.st_mode) != mode or info.st_uid != os.getuid():
            raise SystemExit("Credential storage ownership/mode check failed")
    credentials = json.loads(path.read_text())
    if set(credentials) != {"username", "password"} or not all(
            isinstance(value, str) and value for value in credentials.values()):
        raise SystemExit("Invalid credential structure")
    data = {"node.session.auth." + key: base64.b64encode(value.encode()).decode()
            for key, value in credentials.items()}
    resource = {
        "apiVersion": "v1", "kind": "Secret",
        "metadata": {"name": NAME, "namespace": NAMESPACE,
                     "labels": {"app.kubernetes.io/part-of": NAMESPACE}},
        "type": "kubernetes.io/iscsi-chap", "data": data,
    }
    # Create, never apply: no credential-bearing last-applied annotation and no
    # implicit replacement/rotation if a Secret already exists.
    kubectl("create", "-f", "-", "--dry-run=server", payload=json.dumps(resource))
    kubectl("create", "-f", "-", payload=json.dumps(resource))
    readback = json.loads(kubectl("get", "secret", NAME, "-n", NAMESPACE, "-o", "json"))
    if readback.get("data") != data or readback.get("type") != resource["type"]:
        raise SystemExit("Secret created but readback mismatch; do not use")
    print("Pilot kubelet CHAP Secret created; exact private readback matched. No application receives it.")


if __name__ == "__main__":
    main()
