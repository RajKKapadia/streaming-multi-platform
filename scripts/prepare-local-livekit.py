import json
import os
import secrets
import sys
from pathlib import Path


def main() -> None:
    if not sys.platform.startswith("linux"):
        raise SystemExit("This stack uses Linux host networking; run it on the Linux workstation.")

    root = Path(__file__).resolve().parents[1]
    # Persistent bind mount for Egress segments; survives container replacement.
    recordings = Path(os.environ.get("RECORDINGS_ROOT") or root / ".local" / "recordings")
    recordings.mkdir(parents=True, exist_ok=True, mode=0o770)
    target = root / ".local" / "livekit"
    expected = [target / name for name in ("app.env", "livekit.yaml", "egress.yaml")]
    existing = [path for path in expected if path.exists()]
    if existing:
        if len(existing) != len(expected):
            raise SystemExit("Local configuration is incomplete. Restore the missing files before retrying.")
        print("Reusing existing local LiveKit configuration; credentials were preserved.")
        return

    target.mkdir(parents=True, exist_ok=True, mode=0o700)
    target.chmod(0o700)
    key = "local_" + secrets.token_hex(12)
    secret = secrets.token_hex(32)
    server = {
        "port": 7880,
        "bind_addresses": ["127.0.0.1"],
        "rtc": {
            "node_ip": "127.0.0.1",
            "use_external_ip": False,
            "enable_loopback_candidate": True,
            "udp_port": 7882,
            "tcp_port": 7881,
        },
        "redis": {"address": "127.0.0.1:6389"},
        "keys": {key: secret},
        "logging": {"level": "info"},
    }
    egress = {
        "ws_url": "ws://127.0.0.1:7880",
        "insecure": True,
        "redis": {"address": "127.0.0.1:6389"},
        "enable_chrome_sandbox": True,
        "logging": {"level": "info"},
    }
    content = {
        "app.env": (
            "LIVEKIT_URL=ws://127.0.0.1:7880\n"
            f"LIVEKIT_API_KEY={key}\n"
            f"LIVEKIT_API_SECRET={secret}\n"
        ),
        # JSON is valid YAML, and avoids requiring a Python YAML package.
        "livekit.yaml": json.dumps(server, indent=2) + "\n",
        "egress.yaml": json.dumps(egress, indent=2) + "\n",
    }
    old_umask = os.umask(0o077)
    try:
        for name, body in content.items():
            path = target / name
            with path.open("x") as output:
                output.write(body)
            # Individual file mounts must be readable by the containers' users.
            # The enclosing directory stays 0700 to protect credentials on the host.
            if name.endswith(".yaml"):
                path.chmod(0o644)
    finally:
        os.umask(old_umask)

    print("Created private local configuration in .local/livekit/.")
    print("The root .env was not changed. No containers were started.")


if __name__ == "__main__":
    main()
