"""Local, synthetic tests: no SSH, NAS access, credentials or Kubernetes calls."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


initializer = load("initializer", ROOT / "ansible/files/initialize-obsidian-pilot-cortex.py")
secret = load("secret", Path(__file__).with_name("create-iscsi-secret.py"))
app_secrets = load("app_secrets", Path(__file__).with_name("create-app-secrets.py"))


class InitializeTests(unittest.TestCase):
    def probe(self, *, serial=initializer.LUN_UUID, size=5368709120,
              mounts=None, signature="", content=None, flags=None):
        disk = {"type": "disk", "size": size, "serial": serial,
                "fstype": None, "mountpoints": mounts or [None]}
        device = MagicMock()
        device.name = "sda"
        stream = MagicMock()
        chunk = MagicMock()
        chunk.__eq__.return_value = True
        chunk.__len__.return_value = size
        stream.__enter__.return_value.read.side_effect = [chunk, b""]
        device.open.return_value = io.BytesIO(content) if content is not None else stream
        source = MagicMock()
        source.is_block_device.return_value = True
        source.resolve.return_value = device
        holders = MagicMock()
        holders.__truediv__.return_value.__truediv__.return_value.iterdir.return_value = []
        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(initializer, "DEVICE", source))
            if content is None:
                stack.enter_context(patch.object(initializer, "bytes", return_value=b"\0", create=True))
            stack.enter_context(patch.object(initializer, "Path", return_value=holders))
            stack.enter_context(patch.object(initializer.os, "geteuid", return_value=0))
            stack.enter_context(patch.object(initializer.os, "uname", return_value=type("Host", (), {"nodename": "bletchley002"})()))
            stack.enter_context(patch("sys.argv", ["initializer", *(flags or [])]))
            stack.enter_context(patch.object(initializer, "run", side_effect=[json.dumps({"blockdevices": [disk]}), signature]))
            mutate = stack.enter_context(patch.object(initializer.subprocess, "run", return_value=type("Probe", (), {"returncode": 2, "stdout": b""})()))
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            initializer.main()
            self.assertEqual(mutate.call_count, 1)
            self.assertEqual(mutate.call_args.args[0][0], "blkid")

    def test_blank_check_does_not_format_or_mount(self):
        self.probe()

    def test_wrong_serial_refuses_even_with_initialization_flag(self):
        with self.assertRaisesRegex(SystemExit, "UUID does not match"):
            self.probe(serial="unrelated-disk", flags=["--initialize-blank-lun"])

    def test_wrong_capacity_refuses(self):
        with self.assertRaisesRegex(SystemExit, "capacity"):
            self.probe(size=1024)

    def test_mounted_device_refuses(self):
        with self.assertRaisesRegex(SystemExit, "state or mounts"):
            self.probe(mounts=["/somewhere"])

    def test_existing_signature_refuses(self):
        with self.assertRaisesRegex(SystemExit, "disk signature"):
            self.probe(signature="ext4")

    def test_nonzero_unsigned_data_refuses(self):
        with self.assertRaisesRegex(SystemExit, "Nonzero data"):
            self.probe(content=b"unrecognized data")

    def test_short_read_refuses(self):
        with self.assertRaisesRegex(SystemExit, "Short device read"):
            self.probe(content=b"\0" * 32)


class SecretTests(unittest.TestCase):
    def test_stdin_create_and_readback_without_secret_output(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            directory = root / "sensitive/obsidian-pilot"
            directory.mkdir(parents=True, mode=0o700)
            credentials = {"username": "synthetic-user", "password": "synthetic-password"}
            path = directory / "chap.json"
            path.write_text(json.dumps(credentials))
            path.chmod(0o600)
            calls = []

            def api(*args, payload=None):
                calls.append((args, payload))
                if args[0] == "get":
                    return calls[1][1]
                return "created"

            output = io.StringIO()
            with patch.object(secret, "ROOT", root), patch.object(secret, "kubectl", side_effect=api), contextlib.redirect_stdout(output):
                secret.main()
            self.assertEqual([call[0][0] for call in calls], ["create", "create", "get"])
            self.assertIn("--dry-run=server", calls[0][0])
            resource = json.loads(calls[1][1])
            self.assertNotIn("annotations", resource["metadata"])
            self.assertEqual(resource["type"], "kubernetes.io/iscsi-chap")
            for value in credentials.values():
                self.assertNotIn(value, output.getvalue())

    def test_fresh_app_credentials_scoped_idempotent_and_not_logged(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            directory = root / "sensitive/obsidian-pilot"
            directory.mkdir(parents=True, mode=0o700)
            resources = {}
            creates = []

            def api(*args, payload=None):
                if args[0] == "-n":
                    current = resources.get((args[1], args[4]))
                    return json.dumps(current) if current else ""
                resource = json.loads(payload)
                self.assertNotIn("annotations", resource["metadata"])
                if "--dry-run=server" not in args:
                    key = (resource["metadata"]["namespace"], resource["metadata"]["name"])
                    resources[key] = resource
                    creates.append(key)
                return "created"

            output = io.StringIO()
            with patch.object(app_secrets, "ROOT", root), patch.object(app_secrets, "api", side_effect=api), contextlib.redirect_stdout(output):
                app_secrets.main()
                app_secrets.main()
            credentials = json.loads((directory / "application.json").read_text())
            self.assertEqual(len(creates), 4)
            self.assertEqual((directory / "application.json").stat().st_mode & 0o777, 0o600)
            self.assertEqual(set(resources[("obsidian-pilot", "cortex-auth")]["data"]), {"token"})
            for key in ["password", "e2eePassphrase", "mcpToken"]:
                self.assertNotIn(credentials[key], output.getvalue())
            resources[("obsidian-pilot", "cortex-auth")]["data"]["token"] = "unexpected"
            with patch.object(app_secrets, "ROOT", root), patch.object(app_secrets, "api", side_effect=api):
                with self.assertRaisesRegex(RuntimeError, "no replacement"):
                    app_secrets.main()
            self.assertEqual(len(creates), 4)


if __name__ == "__main__":
    unittest.main()
