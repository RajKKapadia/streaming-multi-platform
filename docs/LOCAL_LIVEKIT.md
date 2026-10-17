# Local LiveKit on the Linux workstation

This first stage runs LiveKit Server, dedicated Redis, and Egress on the same
Linux host as the browser studio. Egress can process multiple jobs; the current
YouTube, Twitch, and X defaults create three separate rendering/encoding jobs.
Start acceptance with one destination before exercising all three.

The stack uses Linux host networking. LiveKit signaling and Redis bind to
localhost. Egress reaches LiveKit and the studio through the host's localhost.
This configuration does not support guests on other devices or the internet yet.

## Start the containers

From the repository root, run:

```sh
python3 scripts/prepare-local-livekit.py
docker compose --env-file .local/livekit/app.env -f compose.livekit.yaml config --quiet
docker compose --env-file .local/livekit/app.env -f compose.livekit.yaml pull
docker compose --env-file .local/livekit/app.env -f compose.livekit.yaml up -d
docker compose --env-file .local/livekit/app.env -f compose.livekit.yaml ps
```

Use `sudo docker` if the local user cannot access the Docker daemon. The prepare
script is safe to rerun: it preserves existing credentials and leaves the root
`.env` untouched. Generated credentials and configuration are ignored by Git.

Images are pinned to LiveKit Server `v1.13.10`, Egress `v1.15.0`, and Redis
`7.4.6-alpine`. Server versions before `v1.13.5` do not support the app's current
`StartEgress` API.

| Component | Local address / resources |
| --- | --- |
| LiveKit signaling/API | `http://127.0.0.1:7880` / `ws://127.0.0.1:7880` |
| LiveKit media | UDP `7882`, TCP `7881` |
| Dedicated Redis | `127.0.0.1:6389`; ephemeral, no saved room state |
| Egress | Up to 16 CPUs and 20 GiB RAM; 1 GiB shared memory |

These are initial limits for this 20-core / 62 GiB workstation, not measured
capacity guarantees. Egress uses software encoding; this setup does not configure
GPU acceleration. Its Chrome sandbox is enabled and uses the documented
`SYS_ADMIN` capability. Do not scale this host-networked Egress service directly:
additional workers need distinct template ports or a different network layout.

Inspect startup errors with:

```sh
docker compose --env-file .local/livekit/app.env -f compose.livekit.yaml logs --tail=100 livekit egress redis
docker stats --no-stream
```

## Connect and verify the application next

After the containers start, leave them running for verification. Container startup
alone does not prove WebRTC media, Chrome rendering, or platform delivery.

The app still uses the root `.env` until explicitly launched with the local
credentials or that file is updated. `.local/livekit/app.env` contains only local
LiveKit credentials, so the host passcode, signing secret, media folder, and
destination settings can continue to come from the existing root `.env`.

The app currently requires an HTTPS `PUBLIC_APP_URL` before starting Egress.
The next application step is to configure a separate internal renderer URL or a
reachable HTTPS renderer, then verify:

1. Local host/guest audio and video, room metadata, layouts, screen sharing, and
   reconnection using separate browser sessions on this workstation.
2. The authenticated renderer/media endpoints, subscribed tracks, and Chrome's
   readiness signal.
3. One prepared destination, then all three for 30–60 minutes, including media
   effects, audio/video sync, received playback quality, CPU/memory/upload usage,
   partial output failure, API restart, and clean stop.

The default destination video bitrates total 32 Mbps. Audio, protocol overhead,
and future remote-guest traffic add to the required upload bandwidth.

Internet guests require a separate network configuration: trusted HTTPS/WSS,
reachable advertised media addresses, firewall/router rules, and TURN as needed.
An HTTPS application tunnel alone does not provide a WebRTC media route.

## Stop this stack

```sh
docker compose --env-file .local/livekit/app.env -f compose.livekit.yaml down
```

This stops this Compose project only. Stopping Redis loses this stack's runtime
state; stopping LiveKit or Egress interrupts its active rooms and streams. Local
credentials remain available for the next startup.

References: [LiveKit self-hosting](https://docs.livekit.io/transport/self-hosting/),
[Egress requirements/configuration](https://docs.livekit.io/transport/self-hosting/egress/),
and [Egress API compatibility](https://docs.livekit.io/reference/other/egress/api/#startegress).
