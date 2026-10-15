# Broadcast Studio

A personal browser studio for one host and three guests, built with Bun, Turborepo, React/Vite, Express, and LiveKit Cloud. It includes eight layouts, screen sharing, folder media, camera effects, and manual YouTube/Twitch/X RTMP destinations. No database is required.

## License

Available to individual people for personal, noncommercial use under the [Individual Noncommercial License 1.0](LICENSE). Commercial use, monetized or sponsored streams, paid client work, and use on behalf of an organization require separate written permission from [RajKKapadia](https://github.com/RajKKapadia). This is a custom source-available license, not an OSI-approved open-source license.

Included artwork and demo media have [separate scope, attribution, and provenance details](MEDIA_LICENSE.md). [Third-party components](THIRD_PARTY_NOTICES.md) retain their own licenses. Personal files placed in `media/` and the local X article drafts are excluded from Git; the generated media ZIP under `assets/broadcast-pack/` is included.

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

In Destinations, configure each platform, enable it, and Save:

- **Twitch:** copy the Primary Stream key from Creator Dashboard → Settings → Stream. Only the key is required; the app supplies `rtmp://live.twitch.tv/app`. An optional server override is under Advanced server settings. Twitch starts broadcasting when video arrives.
- **YouTube:** open YouTube Studio → Go live → Stream and copy its selected stream key. The app supplies `rtmps://a.rtmps.youtube.com:443/live2`; Advanced server settings allows a different ingest address. An immediate stream starts when encoder video arrives. For a scheduled broadcast, wait for YouTube's preview, then click Go live in YouTube Studio or enable Auto-start for that broadcast. First-time live streaming activation can take up to 24 hours.
- **X:** create or select a source in [X Live Studio](https://x.com/i/live-studio). Copy that source's RTMP/RTMPS URL and secret stream key into separate fields; X needs its source-specific address. Start the output here, wait for X's preview, then Go Live in X (or configure its Auto-start). A disabled Go Live button or “Waiting for stream” requires checking that video is reaching the selected source. Legacy Media Studio Producer uses the same source-first flow.

Optional environment defaults are `YOUTUBE_RTMP_URL` / `YOUTUBE_STREAM_KEY`, `TWITCH_STREAM_KEY`, and `X_RTMP_URL` / `X_STREAM_KEY`. Twitch uses its built-in server, and a blank YouTube URL uses its built-in server. Destinations start disabled. Stream keys remain on the server; dialog overrides last only until the API restarts. Blank untouched key fields preserve the saved key; explicitly clearing a key removes it. Close and save the dialog before **Start streaming**. Confirm playback on each platform's watch page. If YouTube remains Preparing or No data, verify the selected stream key matches the app's destination and inspect YouTube's Stream health. Scheduled YouTube broadcasts require **Go live** after the preview appears, or Auto-start. End stream stops every active Egress group, and leaves participants in the studio.

The studio's **SENDING** indicator describes video output; confirm viewer availability in each platform dashboard. Before launching Egress, the API checks the public renderer page and its authenticated media manifest. An expired tunnel is rejected with a setup error. After changing a tunnel URL, update `PUBLIC_APP_URL` and restart the API. An aborted job with “Start signal not received” means the renderer never became ready; it is shown as failed rather than active.

YouTube and Twitch default to 1920 × 1080, **60 fps**, H.264 Main, AAC at 128 kbps / 48 kHz, and a two-second keyframe interval. YouTube uses **17,000 kbps** following [YouTube's H.264 1080p60 recommendation](https://support.google.com/youtube/answer/2853702?hl=en), while Twitch uses **6000 kbps**. YouTube transcodes received video, so a Twitch-sized bitrate can lose camera detail after recompression. Existing YouTube destination overrides can use **Use recommended YouTube quality**, then Save. X defaults to **720p60 at 9000 kbps with three-second keyframes** for smoother motion. X also offers 1080p30 for finer detail and 720p30 for lower encoding load; 1080p60 and bitrates above 12000 kbps are rejected. These profiles follow [X Producer's specifications](https://help.x.com/en/using-x/how-to-use-live-producer). The program renders at 1920 × 1080 logical pixels and scales to each output. Matching destination profiles share one Egress; different profiles get their own Egress. The defaults now need **three concurrent Egress jobs**. Your LiveKit project must allow them. The X profile does not lower other outputs.

Capture requests 1080p60 where available. Settings shows actual camera resolution and frame rate. A 30 fps camera, screen source, or clip still has 30 fps motion inside a 60 fps encoded output. Check Recommended Encoder Settings for your source in X Live Studio and confirm received playback. Existing saved profiles remain until changed; select 720p60 in Destinations and save before the next stream. The program redraws when state changes or finite media ends; live video frames run independently of React.

Camera publishing prioritizes resolution when the browser is under encoding or bandwidth pressure. The LiveKit camera default prioritizes frame rate by reducing resolution, which can make a webcam pixelated even inside a 1080p program. The studio instead allows frame rate to fall to preserve detail; this cannot guarantee smooth motion on an overloaded computer or connection. Settings → Camera shows both capture settings and the highest active outgoing camera layer, including browser-reported CPU or bandwidth limitations. The broadcast renderer disables adaptive subscriptions so its camera quality does not depend on the preview tile size.

Platform references: [Twitch stream keys](https://help.twitch.tv/s/article/twitch-stream-key-faq?language=en_US), [X Live Studio](https://help.x.com/en/using-x/live-studio), [legacy X Producer encoder specifications](https://help.x.com/en/using-x/how-to-use-live-producer), and [YouTube encoder setup](https://support.google.com/youtube/answer/2907883?hl=en) / [Auto-start settings](https://support.google.com/youtube/answer/9854503?hl=en).

## Media

Place your own licensed files in these root folders and click Refresh in Media. Subfolders are supported. Set `MEDIA_ROOT` to use another absolute folder with the same structure.

| Folder | Supported formats | Behavior |
| --- | --- | --- |
| `media/logos` | PNG, JPEG, WebP | One logo; show/hide, top left/right |
| `media/overlays` | PNG, WebP, GIF | One full-program overlay; optional 200 ms fade |
| `media/backgrounds` | PNG, JPEG, WebP | Virtual camera backgrounds in Settings → Visual effects |
| `media/clips` | MP4, WebM | Full program takeover; optional loop |
| `media/music` | MP3, WAV, OGG | One music track; pause/resume/stop, loop, volume |
| `media/sounds` | MP3, WAV, OGG | One sound effect at a time; preloaded repeat playback; volume |

In Settings → Visual effects, try blur or a virtual background before entering a display name or passcode. Effects update the camera preview as you select them; the Blur amount slider adjusts strength from 1 to 30 and saves your choice in this browser. Library background images are available through public preview URLs; other media and studio controls require authorization. You can also choose a local image without uploading it.

Blur and virtual backgrounds use GPU edge stabilization to reduce flicker around stationary hands and objects. Moving edges respond faster to reduce trailing silhouettes. The person segmentation model can still remove microphones and boom arms; check your actual camera preview before broadcasting. The Picture in picture layout uses a narrower top-right camera inset while keeping its height and right margin.

To exclude more objects, open Settings → Visual effects, select blur or a virtual background, then set Foreground to **Person only (experimental)**. It uses hair, skin, and clothing categories and excludes background/accessories. Some object fragments may remain. Removing an object that covers your body reveals the background in that area; this mode cannot reconstruct hidden clothing or skin. It may reduce frame rate. **Stable foreground** remains the default, and your foreground choice is saved in this browser.

Use browser-compatible codecs (for example, H.264/AAC in MP4, or VP8/VP9/Opus in WebM). Playback is enabled only after browser probing succeeds; files are not transcoded. Unsupported or damaged files display an error. Images retain transparency. No upload or asset registration workflow is needed. The media endpoint supports byte ranges and rejects escaping symlinks.

Clips hide live branding and exclude live microphones from the **program** without muting participants in the room. Music pauses at its current position and resumes when the clip ends or is stopped; sound effects stop. Outgoing voices remain controlled by stage membership even when their cameras are invisible in the selected layout. Removing someone from stage leaves them in the room. Guests return backstage after disconnecting.

The **People** sidebar lists the host and currently joined guests, including people backstage, with camera/microphone indicators and stage status. It updates when people join or leave; hosts can add or remove guests from stage there. Open **Messages** beside Media and People to chat with everyone in the studio. Enter sends; Shift + Enter adds a new line. An unread badge appears while the conversation is closed. The latest 100 messages are shared with participants joining later and stay available until the API restarts. Messages are limited to 2,000 characters and never appear in the broadcast. Interface preview messages stay on your device.

Screen shares appear beside their owner's camera in the People row, with matching tile sizes. Scroll the row horizontally when needed. The host's share goes straight to a screen layout. A guest's share stays backstage until the host clicks **Stage screen** on its card. Staging a screen switches a camera layout to **Screen + presenter**; an existing screen layout is preserved. **Remove** keeps capture running, while **Stop sharing** ends your capture. When the selected share ends, the stage returns to the camera grid.

The host and guests hear each other's room voices, plus music, sounds, and clip audio. Media monitoring starts on for everyone; the headphone button mutes media only for you and does not change the broadcast or anyone else's audio. If playback is blocked, click **Enable audio**. Use headphones while monitoring media. Camera and screen preview videos stay muted, and your own microphone is never played locally. For a virtual background, open Settings → Visual effects during setup or in the studio, choose Virtual background, choose a PNG/JPEG/WebP from your computer or the shared library, and Apply settings. Local images stay selected until the page reloads and are not uploaded. Shared backgrounds from `media/backgrounds` refresh whenever Settings opens. On setup, you can enter your display name and host passcode directly in Visual effects and click **Load backgrounds** to access the library without joining; invited guests load it using their invitation. After adding files while Settings is open, click **Refresh backgrounds** beside the image selector. These images appear only in the virtual-background selector; Media → Stage background offers gradients and solid colors for the program layout.

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
5. Test Twitch and X separately; start with X's default 30 fps profile and confirm the dashboard preview before starting the platform broadcast.

Runtime state is stored in LiveKit room metadata. Use one Express process for V1 so host commands and start/stop operations remain serialized. Active jobs are discovered from LiveKit after restart; keys and dialog overrides are not stored in room metadata. Guest invitations expire after 12 hours, sessions after 12 hours, and renderer/media read access after 24 hours. An individual uninterrupted broadcast should stay within that access window.

See [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) for the agreed scope, and [LiveKit's custom template guide](https://docs.livekit.io/transport/media/ingress-egress/egress/custom-template/) for the renderer readiness protocol.
