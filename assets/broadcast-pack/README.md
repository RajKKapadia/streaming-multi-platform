# Broadcast media pack

- `media/clips/starting-soon-1-minute.mp4`: exactly 60 seconds, 1920 × 1080, H.264 at 30 fps. Starts at 01:00, changes once each second, and shows 00:00 on the final frame. A smooth progress bar and broadcast indicator animate throughout. Silent.
- `media/overlays/celebration-confetti.webp`: colorful confetti launched from both lower corners, 5.4 seconds.
- `media/overlays/celebration-gold-sparkles.webp`: gold stars and fireworks, 5.4 seconds.
- `media/overlays/like-share-subscribe-minimal.webp`: a dark action bar with cursor clicks and a subscribed state, 7.6 seconds.
- `media/overlays/like-share-subscribe-playful.webp`: three colorful buttons with staggered bounce entrances, 7.6 seconds.

The four overlays have real alpha transparency, a 1280 × 720 canvas, and a transparent pause between loops. The studio scales them to its 1920 × 1080 program canvas. They are silent and loop while enabled; click the selected overlay again to hide it. Only one overlay can be visible at a time in the current studio.

## Use in the studio

Open Media and click Refresh. Find **starting soon 1 minute** under Video clips, leave Loop clips off, and click it to play. Clips take over the program and return to the live stage when finished. Choose the celebration or call-to-action assets under Overlay, then click again to hide them.

## Source and regeneration

The countdown background was generated with the connected Canva image tool. The timer, progress animation, and transparent overlays were rendered locally. The final animation files are local assets; the Canva link opens the background artwork.

[Open generated image](https://www.canva.com/M/MAHW9i45KMc?utm_source=OC-AaBlKrqBJJNF&utm_campaign=agent_connector_create_image_asset_opened)

Run `python3 assets/broadcast-pack/render.py` from the repository root to regenerate the pack. Requires Pillow, FFmpeg with libx264, Noto Sans, and JetBrains Mono or DejaVu Sans Mono. The renderer writes the five named media files and preview images. `manifest.json` records formats and timing.

The root repository excludes media files from Git; keep the generated files or regenerate them from the source background and renderer.

## License and attribution

The project-authored portions of this pack are available for individual, personal, noncommercial use under the [Individual Noncommercial License 1.0](../../LICENSE). Read [MEDIA_LICENSE.md](../../MEDIA_LICENSE.md) for the covered files, attribution, AI-generated background provenance, and third-party exceptions. Monetized or sponsored streams, paid client work, and organizational use require separate written permission.

Credit **Broadcast Studio — RajKKapadia** and link to the [project repository](https://github.com/RajKKapadia/streaming-multi-platform) in accompanying descriptions or credits when publishing these assets or adaptations. State the license and identify changes; no on-screen watermark is required. Keep the license documents with redistributed copies.

`broadcast-assets.zip` includes the license documents at its root. Canva-generated content, fonts, platform trademarks, and other third-party rights are subject to the exceptions in those documents; the project does not grant rights it does not control.
