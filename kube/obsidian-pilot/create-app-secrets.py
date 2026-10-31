#!/usr/bin/env python3
"""Fresh disposable credentials; stdin-only Kubernetes delivery, never rotation."""
import base64
import json
import os
from pathlib import Path
import secrets
import stat
import subprocess

ROOT = Path(__file__).resolve().parents[2]
KUBECTL = ["kubectl", "--context=kubernetes-admin@kubernetes", "--request-timeout=20s"]


def api(*args, payload=None):
    result = subprocess.run(KUBECTL + list(args), input=payload, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError("Kubernetes credential operation failed; output withheld")
    return result.stdout


def main():
    directory = ROOT / "sensitive/obsidian-pilot"
    info = directory.stat()
    if directory.is_symlink() or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise RuntimeError("Unsafe credential directory")
    path = directory / "application.json"
    if not path.exists():
        values = {"database": "obsidian-pilot", "username": "obsidian-pilot",
                  "password": secrets.token_urlsafe(48), "e2eePassphrase": secrets.token_urlsafe(48),
                  "mcpToken": secrets.token_urlsafe(48)}
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as output:
            json.dump(values, output)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
    info = path.stat()
    if path.is_symlink() or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600:
        raise RuntimeError("Unsafe credential file")
    values = json.loads(path.read_text())
    if (set(values) != {"database", "username", "password", "e2eePassphrase", "mcpToken"} or
            values["database"] != "obsidian-pilot" or values["username"] != "obsidian-pilot" or
            not all(isinstance(values[key], str) and len(values[key]) >= 32
                    for key in ["password", "e2eePassphrase", "mcpToken"])):
        raise RuntimeError("Invalid credential structure")
    database = {key: values[key] for key in ["database", "username", "password"]}
    resources = [
        ("couchdb", "obsidian-pilot-database-bootstrap", {"credentials.json": json.dumps(database)}),
        ("obsidian-pilot", "livesync-bootstrap", {"credentials.json": json.dumps({
            **database, "e2eePassphrase": values["e2eePassphrase"]})}),
        ("obsidian-pilot", "cortex-auth", {"token": values["mcpToken"]}),
        ("obsidian-pilot", "database-access", {"credentials.json": json.dumps(database)}),
    ]
    for namespace, name, plaintext in resources:
        data = {key: base64.b64encode(value.encode()).decode() for key, value in plaintext.items()}
        resource = {"apiVersion": "v1", "kind": "Secret", "type": "Opaque",
                    "metadata": {"name": name, "namespace": namespace,
                                 "labels": {"app.kubernetes.io/part-of": "obsidian-pilot"}}, "data": data}
        previous = api("-n", namespace, "get", "secret", name, "--ignore-not-found", "-o", "json")
        if previous.strip():
            current = json.loads(previous)
            if (current.get("data") != data or current.get("type") != "Opaque" or
                    current["metadata"].get("labels", {}).get("app.kubernetes.io/part-of") != "obsidian-pilot"):
                raise RuntimeError("Existing Secret mismatch; no replacement authorized")
        else:
            api("create", "-f", "-", "--dry-run=server", payload=json.dumps(resource))
            api("create", "-f", "-", payload=json.dumps(resource))
        readback = json.loads(api("-n", namespace, "get", "secret", name, "-o", "json"))
        if readback.get("data") != data:
            raise RuntimeError("Private Secret readback mismatch")
    print("Pilot-only credentials securely stored; four scoped Secrets verified without rotation or value display.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit("Pilot Secret setup refused; details withheld to protect credentials. No implicit rotation.")
