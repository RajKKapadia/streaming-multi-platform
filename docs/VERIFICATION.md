# Local verification — 2026-10-03

- `bun install --frozen-lockfile --offline`: passed; no dependency changes.
- `bun run check-types`: passed for all five workspaces.
- `bun run lint`: passed with no lint warnings.
- `bun run test`: 17 tests passed, 0 failed. Tests use a fake LiveKit gateway; HTTP checks run on a temporary local port.
- `bun run build`: passed. Vite reports large SDK chunks; Turbo reports that the starting folder is not a Git repository.
- `bun run start`: built application served successfully on port 3001.
- `bun run dev`: Vite and Express started successfully on ports 5173 and 3001.

Chrome checks exercised prejoin, all eight program layouts using camera-off sample participants, feature/add/remove actions, screen-layout disabling after share termination, device/effects dialogs, destination controls, and X's separate 30 fps profile. The final desktop preview and logical program both measured 16:9 without cropping. A 390 × 844 responsive check confirmed the stage, participant controls, footer, and scrolling media panel. No browser console errors were observed in the final development preview.

The root environment is not configured for LiveKit or host authentication. No real camera/microphone permission was granted during browser checks, no cloud Egress job was started, and no platform received a broadcast. Actual 1080p60 delivery, sustained frame rate, codecs/stereo audio, AV sync, camera effects, real guest reconnection, and real platform/API-restart behavior remain live acceptance checks. See the README checklist.

The development entry point reuses its React root during hot updates. A fresh reload and entry-point hot-update check produced no new console errors.

Snapshots: `studio-preview.jpg`, `prejoin-preview.jpg`, and `mobile-preview.jpg`. These show interface preview mode, not a received broadcast.
