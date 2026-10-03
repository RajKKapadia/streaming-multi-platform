# Multi-platform Broadcast Studio — V1

## Project and scope

Project root: `/home/logan/Desktop/My-Projects/streaming-multi-platform`.

The starting directory contains `package.json` with Turbo installed and `bun.lock`. There are no applications, workspace definitions, Turbo tasks, or existing application code to migrate.

Use Turborepo, Bun 1.4.2, TypeScript, React/Vite, Express, shadcn/ui, Tailwind, Zustand, and LiveKit Cloud. Create two applications, web and API, plus shared UI, studio-rendering, and contract packages. Configure root development, build, type-check, lint, and test commands.

V1 supports one host and three guests, one selected broadcast screen share, eight layouts, folder-based assets, and YouTube/X/Twitch destinations configured using stream URLs and keys. There is no database, OAuth, recording, scheduling, platform comment integration, or asset-upload interface.

## Broadcast output

The default program and encoded output are **1920 × 1080 at 60 fps**, replacing the earlier 720p30 target.

- Render a fixed 16:9 program at 1920 × 1080 logical pixels; scale the studio preview to its available space.
- Set LiveKit Egress encoding explicitly: width 1920, height 1080, framerate 60, H.264 Main video at 6000 kbps, AAC audio at 128 kbps stereo/48 kHz, and a two-second keyframe interval. Use explicit encoding options because the stock H264_1080P_60 preset lists OPUS audio.
- Request 1080p60 camera capture where supported and 60 fps screen capture where the browser supports it. Show actual track settings; lower-rate cameras, clips, or screen captures retain their original motion cadence even when encoded in a 60 fps output.
- Destination profiles may override bitrate. The shared 6000 kbps profile is the initial default; do not silently reduce the program resolution or frame rate.
- Group enabled destinations by encoding profile. Use one Egress per distinct profile, with multiple destination URLs when their settings match. All renderers consume the same program state and playback timeline.
- X requires an ingest test against the user's actual account. Its English Producer documentation currently lists 1080p30 as the maximum, while some localized documentation lists 1080p and 60 fps separately. Do not promise universal X 1080p60 compatibility. Offer an explicit 1080p30 compatibility profile for X if testing requires it; it must not downgrade the main 1080p60 program.
- Treat 1080p60 delivery as an acceptance requirement: verify the received output and sustained frame delivery under the full participant/effects workload.

References:

- [LiveKit encoding options and 1080p60 preset](https://docs.livekit.io/reference/other/egress/api/)
- [YouTube encoder specifications](https://support.google.com/youtube/answer/2853702?hl=en)
- [Twitch broadcast specifications](https://help.twitch.tv/s/article/broadcasting-guidelines?language=en_US)
- [X Producer specifications](https://help.x.com/en/using-x/how-to-use-live-producer)

## Pages and studio controls

- Pre-join: display name, camera preview, microphone level, device selection, mic/camera toggles, and Enter studio. Entry does not start broadcasting.
- Settings dialog: camera, microphone, capture resolution/frame-rate request, mirrored self-preview, echo cancellation, camera blur, and virtual backgrounds.
- Studio: program preview, layout strip, backstage cards, add/remove controls, guest invite link, bottom media controls, media sidebar, destination status, Go live, and End stream.
- Destination dialog: YouTube/X/Twitch cards, URL/key entry, enable switches, output profile, and individual output status. Create platform broadcasts in their own dashboards.
- Guest view: the same pre-join flow followed by a restricted studio with the guest's own media controls and a muted program preview.

The host starts on stage. Guests join backstage. Removing a participant excludes their microphone from the broadcast without removing them from the room. Camera mirroring applies only to self-preview, not the program output.

| Layout | Behavior |
| --- | --- |
| Solo | Featured camera fills the program |
| Split | First two staged cameras occupy equal halves |
| Inset grid | Up to four cameras sit over the program background |
| Spotlight | Featured camera is large; the others form a side column |
| Screen + presenter | Screen and featured camera sit side by side |
| Screen + camera rail | Large screen with up to four camera thumbnails |
| Picture-in-picture | Full-size screen with the featured camera inset |
| Screen only | Screen fills the program |

Stage order follows Add order. A Feature action selects the prominent camera. Screen layouts are disabled until a screen is staged. Staging another screen replaces the selected one; stopping the selected share returns to the camera grid. Camera tiles crop proportionally, and screen tiles preserve the whole image. Layout changes do not remove admitted participants' audio.

## Folder-based media

Create these directories under the repository-root `media` folder:

```text
media/
  logos/
  overlays/
  clips/
  backgrounds/
  music/
  sounds/
```

The host places files there. Express scans the library on opening the panel and when Refresh is pressed. Display readable filename labels, image thumbnails, and media durations. No registration or upload workflow is needed.

Support PNG/JPEG/WebP images; transparent PNG/WebP and animated GIF overlays; MP4/WebM clips; and MP3/WAV/OGG audio. Probe media in the browser before enabling playback, identify unsupported codecs or damaged files, and do not automatically transcode files.

- Logo: one active logo, top-left/top-right placement, show/hide.
- Overlay: one active overlay, show/hide, optional 200 ms fade, preserved transparency.
- Background: selected image, solid color, or gradient behind live sources.
- Clip: replaces the entire composition, hides live branding, and silences live microphones. Loop defaults off. Intro/outro files are ordinary manually launched clips.
- Music: one track, play/pause/stop, volume, and loop controls.
- Sound effects: one effect at a time, mixed with live voices and music.

Playing a clip suspends music and effects. Completion or Stop restores the current stage and resumes paused music from its saved position. Ending an outro does not end the broadcast automatically. Clip playback must not change participants' microphone mute settings.

Music, effects, and clip audio reach viewers. An optional host headphone monitor plays effects audio only and defaults off. Guests do not receive effects audio in V1. Keep preview video elements muted; never monitor the host's own microphone.

## Architecture, state, and API

Use `/join/:studioId`, `/studio/:studioId`, and `/broadcast/:studioId` in the web application. Share one ProgramCanvas between preview and broadcast. The cloud renderer contains only program visuals and audio.

Use LiveKit's template Egress source and the current server SDK/API. Prefer the current StartEgress API when exposed by the installed SDK; isolate the Egress adapter so a supported SDK's Room Composite API can be used without changing application contracts. Integrate the Egress helper and signal readiness only after room connection and initial asset readiness.

- Zustand holds local UI state; localStorage retains non-secret device preferences and visual presets.
- Express validates and serializes host commands, then publishes versioned state through LiveKit room metadata. Reconnecting clients consume the current snapshot. Do not introduce a separate WebSocket server.
- Shared contracts describe admitted participants, staged cameras, featured camera, selected screen, layout, branding, clip playback, music, and effects. Keep stream keys and access credentials out of room metadata.
- Playback state includes an instance ID, server start time, playback position, duration, loop state, and volume. Clients calculate server-clock offset and synchronize playback. Load metadata before issuing a play command; Express clears completed non-looping playback. A reconnect resumes the current timeline rather than replaying completed media.
- Configure a host passcode and signing secret in the server environment. Exchange the passcode on pre-join for a signed HttpOnly session. Guest links use expiring, room-scoped invitations.
- Only the host can change stage state, media, destinations, or broadcasts. Enforce four human participants separately from hidden Egress recorder participants.
- LiveKit credentials and default destination keys remain in server environment variables. Destination-dialog changes are session overrides in Express memory. Return masked keys and sanitized Egress status.

Minimum API capabilities:

| Endpoint family | Purpose |
| --- | --- |
| Host session | Authenticate the host and issue the session cookie |
| Studio create/resume | Create or resume the personal studio |
| Studio invite/join | Issue guest invitations and role-scoped LiveKit tokens |
| Studio state/commands | Read state and apply validated host controls |
| Asset manifest | Scan and return categorized media |
| Media serving | Serve eligible assets with byte-range support |
| Destinations | Read masked settings and update session overrides |
| Broadcast start/stop/status | Manage encoding groups and their outputs |

Asset IDs reference eligible files within the configured media root. Reject traversal and symlinks escaping that root. Serve media to authorized clients and the cloud renderer through scoped read access. Never use browser-local blob URLs as cloud-rendered assets.

Prevent duplicate Egress starts per profile. Track destination status independently and retain healthy outputs when another fails. Reconcile running Egress jobs and room state after API restart. Session destination overrides are not persistent; the current active broadcast must still be discoverable and stoppable after restart.

## Development milestones

1. **Foundation and broadcast proof:** scaffold workspaces, Express session/token controls, and a minimal 1080p60 renderer. Verify camera and microphone delivery on unlisted YouTube before full UI work.
2. **Screens and devices:** build the screenshot-based pre-join, settings, studio shell, and destination dialog; handle permissions, actual capture capabilities, and device changes.
3. **Participants and layouts:** implement invitations, four-person handling, backstage controls, all eight layouts, screen sharing, and stage-filtered program audio.
4. **Folder media:** implement scanning, thumbnails, Refresh, logo/overlay/background controls, and synchronized clips/music/effects with host monitoring.
5. **Destinations and camera effects:** implement encoding groups, independent YouTube/X/Twitch status, blur/virtual backgrounds, and X profile validation.
6. **Recovery and polish:** finish reconnect/refresh behavior, playback failures, duplicate-action protection, keyboard accessibility, and responsive layout.

`bun run dev` starts Vite and Express, with API/media requests proxied through Vite. `bun run build` builds the frontend. `bun run start` serves the built frontend, API, and media through Express. Use an HTTPS Cloudflare Tunnel to the built application for cloud-renderer and remote-guest testing, with its URL configured as the public application URL.

## Verification and acceptance

- Type-check, lint, build, and run focused Bun tests for authorization, folder containment, stage/audio transitions, playback restoration, and duplicate broadcast actions.
- Exercise all eight layouts with four humans, camera-off states, featured-camera changes, and screen-share termination.
- Confirm backstage microphones never reach viewers and clips silence program microphones without changing room mute settings.
- Verify actual 1920 × 1080 / 60 fps encoding and sustained delivery in received output, including a motion source that genuinely supplies 60 fps. Test all participants plus screen sharing, animated overlays, camera effects, music, and clips.
- Inspect audio/video sync, screen-text readability, missing frames, actual source capture rates, and output health over a sustained session. An encoding configuration alone is not proof of delivered quality.
- Verify media additions and Refresh, invalid codecs, missing active files, looping, clip completion, renderer reconnect, and optional host monitoring without doubled audio.
- Exercise host refresh, guest reconnect, API restart while broadcasting, multiple profile groups, one failed destination, and End stream stopping every managed Egress job.
- Complete unlisted YouTube acceptance first, then test Twitch and X using eligible accounts and prepared broadcasts. Verify X ingestion before promising 1080p60 there.

Document environment setup, folder formats, output profiles, public renderer access, platform broadcast preparation, and the difference between a 60 fps encoded output and lower-rate source media.
