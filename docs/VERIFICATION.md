# Local verification — 2026-10-03

- `bun install --frozen-lockfile --offline`: passed; no dependency changes.
- `bun run check-types`: passed for all five workspaces.
- `bun run lint`: passed with no lint warnings.
- `bun run test`: 17 tests passed, 0 failed. Tests use a fake LiveKit gateway; HTTP checks run on a temporary local port.
- `bun run build`: passed. Vite reports large SDK chunks; Turbo reports that the starting folder is not a Git repository.
- `bun run start`: built application served successfully on port 3001.
- `bun run dev`: Vite and Express started successfully on ports 5173 and 3001.

Chrome checks exercised prejoin, all eight program layouts using camera-off sample participants, feature/add/remove actions, screen-layout disabling after share termination, device/effects dialogs, destination controls, and X's separate 30 fps profile. The final desktop preview and logical program both measured 16:9 without cropping. A 390 × 844 responsive check confirmed the stage, participant controls, footer, and scrolling media panel. No browser console errors were observed in the final development preview.

At the time of these initial checks, the root environment was not configured for LiveKit or host authentication. No real camera/microphone permission was granted during those browser checks, no cloud Egress job was started, and no platform received a broadcast. Actual 1080p60 delivery, sustained frame rate, codecs/stereo audio, AV sync, camera effects, real guest reconnection, and real platform/API-restart behavior remain live acceptance checks. See the README checklist.

The development entry point reuses its React root during hot updates. A fresh reload and entry-point hot-update check produced no new console errors.

Snapshots: `studio-preview.jpg`, `prejoin-preview.jpg`, and `mobile-preview.jpg`. These show interface preview mode, not a received broadcast.

## Media fixes — 2026-10-03

The configured development API uses port 3002. Before the fix, Vite forwarded API requests to an unrelated, unconfigured service on port 3001. After reading the root `PORT` setting, the existing frontend health request reports ready with no configuration issues.

Build (including all workspace TypeScript checks), lint, and all 18 repository tests passed. The new state regression covers immediate screen-layout selection and retaining the selected screen layout when changing presenters.

Two isolated Chrome sessions connected to a separate room in the configured LiveKit service. Camera tracks and microphone input were simulated by Chrome; screen capture used an animated canvas through `getDisplayMedia`. The following passed with no browser page errors:

- Microphone-only setup, meter response, mute/unmute, camera enable without unmuting the microphone, and applying device settings with a working meter afterward.
- Joining with a muted camera, turning it back on, guest joining, and both camera tracks continuing to render locally and remotely.
- Guest stage admission and all eight layouts with active camera and screen tracks.
- Host screen capture appearing on stage automatically, guest screen preview appearing backstage, and host staging of the guest's screen.
- Simultaneous host/guest shares: stopping the host's share while the guest's share is selected preserves the guest's program screen.
- Selected screen termination returning to cameras, and guest departure leaving the host camera running.
- A 390 × 844 mobile viewport with no horizontal page overflow.

`stage-layout-options.png` shows the updated controls. These checks verify application behavior and actual LiveKit track transport using simulated sources. They do not verify physical camera/microphone hardware, a browser's native screen-picker UI, screen audio, or platform broadcasting. The originally reported physical camera loss was not reproduced in the isolated sessions.

## Broadcast fixes — 2026-10-03

Read-only inspection of the two recent LiveKit Egress jobs found both aborted with `Start signal not received` (412) and no stream results. Both requests referenced a previous Cloudflare tunnel, whose renderer API currently returns a 530 origin DNS error. This does not establish whether that tunnel was reachable at the original start time. The current configured tunnel successfully serves the built application, authenticated renderer state, and media manifest.

A browser check of the current production renderer also reproduced `getLiveKitURL is not a function`: the Egress SDK's CommonJS entry produced a nested default export in the production bundle. Importing the SDK's shipped TypeScript source fixed the module interop and removed its duplicate client bundle. After rebuilding, Chrome loaded the renderer through the current public HTTPS tunnel with a short-lived hidden recorder token, connected to LiveKit, and logged `START_RECORDING`. No broadcast error was present. This check joined a renderer only; it did not launch a cloud Egress job or send RTMP video to a platform.

The API now checks the public renderer HTML and authenticated manifest before starting Egress. Aborted jobs and renderer startup failures report failed outputs with safe setup guidance. The studio labels running outputs as SENDING rather than claiming platform publication.

Twitch and YouTube have built-in server addresses with optional overrides, and require only their stream keys for the standard RTMP/RTMPS setup. X retains its source-specific URL and defaults to a separate 1080p30 / 9000 kbps profile with three-second keyframes. YouTube/Twitch retain 1080p60 and two-second keyframes. Browser checks confirmed the three destination forms, optional server controls, X profile defaults, and the instructions to start video here before confirming the preview and Go live / Auto-start in X or YouTube.

Build and all workspace type checks passed; lint passed without warnings. All 26 repository tests passed with local networking enabled, including regressions for default servers, key preservation, independent X encoding, renderer preflight, aborted-job reporting, and queued-output status. The first sandboxed test run could not bind its temporary localhost port; the native rerun passed. The built frontend was served by the existing API. After verifying that no outputs were active and no keys or enabled destinations were saved, the idle API was restarted to load the new defaults and preflight check.

The renderer also registers the SDK's recorder-layout callback while continuing to use studio state for program layout. A second public-renderer check supplied recorder layout metadata, matching Egress's metadata handling.

Received video, audio, and platform-side Go Live activation on Twitch, X, and YouTube remain actual-account acceptance checks. No public platform broadcast was created during this verification.

## Studio fit and media audio — 2026-10-04

The studio preview now fits the height left by the People row and layout controls, with a 16:9 frame. Participant cards and spacing are smaller. The device toolbar sits outside the scrolling workspace. Chrome checks at 2176 × 1283, 1920 × 1080, 1440 × 900, 1366 × 768, 1024 × 768, and 390 × 844 found no stage or document vertical overflow and kept the controls visible. The checks also covered simulated output-warning and live-output banners. Final desktop/mobile preview checks found no horizontal page overflow, and mobile header buttons stayed within the viewport.

Before the fix, isolated real LiveKit host and guest sessions reproduced music advancing with both local media players muted. Media monitoring now starts enabled for both roles; each participant's headphone button affects only their own music, sounds, and clips. The host's microphone is still excluded from local monitoring. The broadcast renderer explicitly starts room audio before signaling recording readiness.

Chrome checks against the rebuilt production bundle found unmuted, playing music with nonzero decoded PCM signal in the host, guest, and standalone broadcast renderer. Shared pause/resume worked in all three. Muting the host's local media left the guest and renderer unmuted. A simulated browser autoplay denial exposed Enable audio; clicking it resumed the media and cleared that control. No page errors were observed. Clock and state updates no longer tear down and pause an unchanged media player, and cancelled play requests are retried without treating them as codec or permission failures.

All 34 repository tests passed with local networking enabled. Workspace type checks, lint, production build, and whitespace checks passed. The Vite SDK chunk-size warning remains unchanged. Verification used isolated studios and did not publish to any streaming destination or use physical microphone/camera devices. PCM checks establish decoded browser audio, not physical speaker output or platform reception.

At the final connectivity check, the configured public tunnel returned Cloudflare 530 (origin DNS error), and the production API on port 3001 was stopped. A temporary tunnel to the isolated verification server was opened, but automatic approval review rejected testing the user's actual media through it because that would transmit potentially private media and authenticated traffic through Cloudflare. The temporary tunnel was closed. Public-tunnel playback and actual platform audio receipt remain unverified; the production app and a reachable public URL are required for that acceptance check.

## YouTube setup, sound replay, and UI text — 2026-10-05

Read-only LiveKit inspection found today's YouTube/Twitch job completed normally. Its current `result.stream.info` entries show both destinations finished without errors, with the YouTube output running for about 17 minutes 59 seconds. This establishes reported outbound transport, not watch-page playback or a matching broadcast. The host confirmed using YouTube's immediate Stream tab and starting only from this app. Immediate encoder streams normally start when video arrives, so a missing manual Go live step does not explain this case. YouTube's current Stream page showed No data and today's stream was absent from the channel's replay list. The exact failure was not reproduced; the selected YouTube key could not be compared with the key used by today's job. No new platform broadcast was started during verification. The studio action now says Start streaming, and its banner links to YouTube Studio. Destination guidance distinguishes immediate and scheduled streams, includes stream-key/Stream health checks, and asks for watch-page confirmation. Reference: [YouTube encoder setup](https://support.google.com/youtube/answer/2907883?hl=en).

The status API now reads the current LiveKit stream result format, with legacy `streamResults` support retained. A regression covers one failed YouTube output alongside an active Twitch output, including safe error messages without keys. The running API returned today's actual per-destination finished results after its watch process reloaded the source.

Sound effects now preload and keep one audio element per asset between cues. Each new cue seeks immediately, including rapid retriggers; idle effects remain paused. This removes element recreation and loading from each replay. An isolated browser harness using the real applause OGG and ProgramCanvas passed five cues, including a replay after completion and rapid retriggers. Every cue produced nonzero decoded PCM (peak RMS approximately 0.051–0.055), reused the same element, and stopped correctly. Background music continued playing on the same element throughout. These checks verify local browser playback, not physical speakers or receipt by a streaming platform; today's original intermittent failure was not independently reproduced.

UI text uses darker primary, secondary, and muted colors across setup, settings, panels, source controls, messages, and destination forms. Stage styles are unchanged; the browser still reported white participant name text. Production preview checks at 1280 × 720 and 390 × 844 found no horizontal page/header overflow and kept the device toolbar visible.

All 36 repository tests passed. Workspace type checks, lint, production build, and whitespace checks passed; the existing Vite chunk-size warning remains. Temporary replay-check pages were removed, and the final production build contains the application only.

## X motion and renderer work — 2026-10-06

Read-only LiveKit inspection confirmed the recent X job completed at 1920 × 1080 / 30 fps / 9000 kbps, H.264 Main, AAC 128 kbps / 48 kHz, and three-second keyframes. Its output ran for about 17 minutes 57 seconds without a reported transport error. These results do not measure received frame cadence, packet loss, or X playback. The connected host's interface reported a 1080p / 30 fps camera.

X now defaults to 1280 × 720 / 60 fps at 9000 kbps with three-second keyframes, following [X Producer's recommended 720p60 profile](https://help.x.com/en/using-x/how-to-use-live-producer). The selector also retains 1080p30 and offers 720p30. Server validation rejects 1080p60 for X, video bitrates above 12000 kbps, and mismatched dimensions. Tests confirm 720p60 X uses a separate Egress from 1080p60 YouTube/Twitch, and status reports the requested output dimensions. Existing saved profiles require selecting and saving the new profile before the next stream.

ProgramCanvas no longer redraws every 100 ms. A single timeout handles the next finite media completion; looping or paused media requires no program clock timer. Unchanged state no longer incurs a structured clone. An isolated React Profiler harness compared the prior timer with the new scheduling: after 44 seconds the prior renderer had 442 commits, while the new renderer had two setup commits. A one-second synthetic clip still returned to the camera layout; the new renderer had four total commits after that transition. This measures React work with camera-off test content, not live encoding throughput or a reduction in dropped frames.

All 39 repository tests passed with localhost networking available. All workspace TypeScript checks, lint, production build, and whitespace checks passed. The running public app served the rebuilt bundle. Browser checks in interface preview confirmed X's 720p60 default and switching to 1080p30 and back, with no browser errors. The idle API on port 3002 was restarted to load the new defaults and validation; all destinations were disabled at restart. The user's original studio tab was left unchanged, and was later closed externally. The existing large SDK chunk warning remains. Temporary profiler files and the local test server were removed. No new Egress or platform broadcast was started; received X playback with 60 fps input remains a live acceptance check.


## Short sound effects — 2026-10-06

FFmpeg fully decoded all eight sound assets and measured nonzero PCM in every file. The clips are not empty: Bong, Buzzer, and Scratch last only 0.123–0.165 seconds; Switch lasts 0.618 seconds but most of its audio is at the beginning.

An isolated Chrome harness using the real OGG files and the current ProgramCanvas reproduced the silence. A 350 ms simulated state-delivery delay skipped Bong, Buzzer, Scratch, and Switch entirely. At 2.2 seconds, only applause and laughter produced audio, matching the reported symptom. Shared elapsed-time seeking skipped the short effects; shared expiry could also remove a cue before local playback began.

One-shot sounds now start at their initial position when a new cue arrives and finish on the media element's ended event. Naturally expired shared state preserves the local tail. Explicit stops before expiry, other sound cues, and video clips cancel playback. Completed cue IDs do not replay on repeated state snapshots, and stale room metadata is rejected. Looping sounds, music, and video retain clock-based synchronization.

After the fix, all eight effects produced nonzero decoded browser PCM at both 350 ms and 2.2 seconds of delivery delay. In the 2.2-second check, each started at time zero and emitted exactly one playing event and one ended event. Peak RMS values ranged from approximately 0.143 to 0.586. Completed Bong replay and two rapid applause retriggers also passed while background music continued playing; the applause position was about 0.044 seconds after its final retrigger.

These checks establish local browser decoding and playback, not physical speaker output or streaming-platform receipt. Temporary browser-check sources were removed before the production build.

All 44 repository tests passed with localhost networking enabled. Lint, workspace type checks, production build, and whitespace checks passed. The running API on port 3002 served the new JavaScript bundle byte-for-byte, including the sound cue logic. Existing studio pages need a refresh to load it. The existing Vite chunk-size warning remains.
