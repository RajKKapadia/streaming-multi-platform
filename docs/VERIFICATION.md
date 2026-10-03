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
