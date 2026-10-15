# Broadcast Studio functionality animation

- `broadcast-studio-demo.gif`: looping, captioned walkthrough of the studio functionality.
- `broadcast-studio-demo.mp4`: the same walkthrough in a smaller video file.
- `poster.jpg`: static preview.

The screenshots show the actual app's built-in interface preview, with sample participants. Screen layouts are shown without an active screen source. Destination switches are unsaved preview settings, and the animated output diagram illustrates the configured workflow. No broadcast was started.

The walkthrough covers setup, eight-layout selection, featured cameras, guest staging, presentation layouts, media/background controls, studio messages, camera settings, virtual background options, and YouTube/Twitch/X output configuration.

The project-authored screenshots and animation are available for individual, personal, noncommercial use under [LICENSE](../../LICENSE). See [MEDIA_LICENSE.md](../../MEDIA_LICENSE.md) for attribution and third-party exceptions. Credit **Broadcast Studio — RajKKapadia**, link to the project, state the license, and identify changes when publishing or sharing them; a description or credits page is sufficient.

Regenerate from the saved screenshots with Python 3, Pillow and FFmpeg:

```sh
python3 assets/functionality-demo/render.py
```
