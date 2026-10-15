# Third-party licenses

The root `LICENSE` covers project-controlled material only. Dependencies and
other third-party components retain their original licenses, which are not
replaced by the project's individual-only or noncommercial restrictions.
Consult the exact dependency versions in `bun.lock` and their accompanying
license and notice files when distributing a build or a dependency bundle.
This list identifies the main components; it is not a replacement for those
license texts or a complete inventory of transitive dependencies.

| Component | License | Upstream |
| --- | --- | --- |
| React and React DOM | MIT | [React](https://github.com/facebook/react/blob/main/LICENSE) |
| Express | MIT | [Express](https://github.com/expressjs/express/blob/master/LICENSE) |
| LiveKit client, server SDK, Egress SDK, and track processors | Apache-2.0 | [LiveKit](https://github.com/livekit) |
| Lucide React | ISC; included Feather-derived portions have MIT notices | [Lucide](https://github.com/lucide-icons/lucide/blob/main/LICENSE) |
| Radix UI primitives | MIT | [Radix Primitives](https://github.com/radix-ui/primitives/blob/main/LICENSE) |
| Tailwind CSS | MIT | [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss/blob/main/LICENSE) |
| Lightning CSS, used by the build tools | MPL-2.0 | [Lightning CSS](https://github.com/parcel-bundler/lightningcss/blob/master/LICENSE) |
| MediaPipe Tasks Vision | Apache-2.0 | [MediaPipe](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE) |
| Optional MediaPipe multiclass selfie segmentation model | Apache-2.0 | [Google model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf) |

MediaPipe model files are fetched at runtime and are not committed to this
repository. LiveKit and other hosted services have their own account and
service terms. See [MEDIA_LICENSE.md](MEDIA_LICENSE.md) for artwork provenance,
fonts, local audio, and trademark exceptions.
