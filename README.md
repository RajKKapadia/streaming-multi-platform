# Broadcast Studio

A personal browser studio for one host and three guests, built with Bun, Turborepo, React/Vite, Express, and LiveKit Cloud. It includes eight layouts, screen sharing, folder media, camera effects, and manual YouTube/Twitch/X RTMP destinations. No database is required.

## Run locally

Use Bun 1.4.2 or newer.

```sh
bun install --frozen-lockfile
cp .env.example .env
bun run dev
```

Open `http://localhost:5173`. **Explore studio preview** works without credentials and uses clearly labeled sample participants. To connect real participants, edit the root `.env`:

```dotenv
HOST_PASSCODE=your-private-passcode-at-least-eight-characters
SESSION_SECRET=your-random-secret-at-least-32-characters
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret
PUBLIC_APP_URL=http://localhost:3001
```

Generate the signing secret with `openssl rand -hex 32`. Keep `.env` private. Both development and production load this root file; restart the API after editing it. The API defaults to port 3001; set `PORT` in the root `.env` to change it. The development frontend proxies to that configured port. Enter your display name and host passcode on prejoin. Click **Start mic check** to test the microphone independently, or enable both devices in the camera preview. Enabling devices is optional; entering does not go live. M toggles microphone, C toggles camera.

## Public application and broadcasting

LiveKit Egress and remote guests need a reachable HTTPS application, including its media endpoints. Build and serve the application from Express:

```sh
bun run build
bun run start
```

Open `http://localhost:3001`. With Cloudflare's `cloudflared` installed, run in another terminal:

```sh
cloudflared tunnel --url http://localhost:3001
```

Set `PUBLIC_APP_URL` to the tunnel's HTTPS URL and restart `bun run start`. Use that same HTTPS URL for the host and guests, so camera permissions, invitations, and secure session cookies share the right origin. A changing tunnel URL needs a new API restart and new invitations. A tunnel that requires interactive login will block Egress; scoped renderer and media tokens provide application access without a host login.

Create an eligible live broadcast in each platform dashboard, then enter its **server URL and stream key separately** in Destinations, enable it, and Save. Optional environment defaults are `YOUTUBE_RTMP_URL` / `YOUTUBE_STREAM_KEY`, `TWITCH_RTMP_URL` / `TWITCH_STREAM_KEY`, and `X_RTMP_URL` / `X_STREAM_KEY`. They start disabled. Stream keys remain on the server; dialog overrides last only until the API restarts. Blank untouched key fields preserve the saved key; explicitly clearing a key removes it. Close and save the dialog before Go live. End stream stops every active Egress group, and leaves participants in the studio.

Default encoding is 1920 × 1080, **60 fps**, H.264 Main at 6000 kbps, AAC at 128 kbps / 48 kHz, and a two-second keyframe interval. The program renders at 1920 × 1080 logical pixels. Matching destination profiles share one Egress; different bitrates or X's explicit 1080p30 compatibility profile get their own Egress. Your LiveKit project must allow the required concurrent Egress jobs. The X profile does not lower other outputs.

Capture requests 1080p60 where available. Settings shows actual camera resolution and frame rate. A 30 fps camera, screen source, or clip still has 30 fps motion inside a 60 fps encoded output. X 1080p60 compatibility requires testing with your actual account; select its 30 fps profile if needed.

## Media

Place your own licensed files in these root folders and click Refresh in Media. Subfolders are supported. Set `MEDIA_ROOT` to use another absolute folder with the same structure.

| Folder | Supported formats | Behavior |
| --- | --- | --- |
| `media/logos` | PNG, JPEG, WebP | One logo; show/hide, top left/right |
| `media/overlays` | PNG, WebP, GIF | One full-program overlay; optional 200 ms fade |
| `media/backgrounds` | PNG, JPEG, WebP | Image behind cameras; gradients and solid colors are built in |
| `media/clips` | MP4, WebM | Full program takeover; optional loop |
| `media/music` | MP3, WAV, OGG | One music track; pause/resume/stop, loop, volume |
| `media/sounds` | MP3, WAV, OGG | One sound effect at a time; volume |

Use browser-compatible codecs (for example, H.264/AAC in MP4, or VP8/VP9/Opus in WebM). Playback is enabled only after browser probing succeeds; files are not transcoded. Unsupported or damaged files display an error. Images retain transparency. No upload or asset registration workflow is needed. The media endpoint supports byte ranges and rejects escaping symlinks.

Clips hide live branding and exclude live microphones from the **program** without muting participants in the room. Music pauses at its current position and resumes when the clip ends or is stopped; sound effects stop. Outgoing voices remain controlled by stage membership even when their cameras are invisible in the selected layout. Removing someone from stage leaves them in the room. Guests return backstage after disconnecting.

Screen shares appear as separate preview cards below People. The host's share goes straight to a screen layout. A guest's share stays backstage until the host clicks **Stage screen** on its card. Staging a screen switches a camera layout to **Screen + presenter**; an existing screen layout is preserved. **Remove from stage** keeps capture running, while **Stop sharing** ends your capture. When the selected share ends, the stage returns to the camera grid.

The host and guests hear each other's room voices. Effects audio reaches viewers; guests do not hear it. The host headphone monitor defaults off and plays effects only. Wear headphones when enabling it. Preview videos stay muted and the host's microphone is never played locally. Camera blur and virtual backgrounds are applied in Settings; add background images and Refresh before selecting a virtual background.

## Checks and live acceptance

```sh
bun run check-types
bun run lint
bun run test
bun run build
```

Tests cover authentication/role restrictions, expiring tokens, media containment, guest reservations across restart, stage/audio policy, eight camera-off layouts, clip restoration, encoding groups, duplicate starts, partial failures, and recovery/stop. The HTTP tests bind a temporary localhost port.

Automated checks and the interface preview do **not** prove live delivery. Complete these with actual LiveKit and prepared platform accounts:

1. Start an unlisted YouTube stream and verify its received resolution, codec/audio, 60 fps encoding, and sustained motion delivery using a real 60 fps source.
2. Exercise four people, every layout, featured-camera changes, backstage audio exclusion, selected screen termination, and reconnects.
3. Check clips, animated overlays, camera effects, music, sounds, volume, loops, audio/video sync, and host monitoring without doubled audio.
4. Restart the API during broadcasting, return to the studio, inspect each output, and End stream. Enable two profiles and check partial platform failure without losing healthy outputs.
5. Test Twitch and X separately; use X's explicit 30 fps profile if required.

Runtime state is stored in LiveKit room metadata. Use one Express process for V1 so host commands and start/stop operations remain serialized. Active jobs are discovered from LiveKit after restart; keys and dialog overrides are not stored in room metadata. Guest invitations expire after 12 hours, sessions after 12 hours, and renderer/media read access after 24 hours. An individual uninterrupted broadcast should stay within that access window.

See [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) for the agreed scope, and [LiveKit's custom template guide](https://docs.livekit.io/transport/media/ingress-egress/egress/custom-template/) for the renderer readiness protocol.
