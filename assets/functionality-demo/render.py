"""Render a captioned GIF from screenshots of the real studio preview.

Requires Python/Pillow and FFmpeg. Run from any directory with python3 render.py.
"""

from pathlib import Path
import json
import math
import subprocess

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
CAPTURES = ROOT / "captures"
W, H, FPS = 1280, 856, 12
BG = "#081728"
WHITE = "#f2f7ff"
MUTED = "#a9bdd3"
BLUE = "#62b7ff"
FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")


def font(size, bold=False):
    return ImageFont.truetype(str(FONT_DIR / ("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf")), size)


FONTS = {s: font(s) for s in [13, 14, 16, 17, 18, 20, 24, 28, 34, 42, 48]}
BOLD = {s: font(s, True) for s in [14, 18, 20, 24, 28, 34, 42, 48]}

# Each screenshot was captured through the app's built-in interface preview.
# Output setup switches are draft settings; no stream was started or saved.
SCENES = [
    dict(kind="intro", seconds=1.8, chapter="OVERVIEW", title="Broadcast Studio", subtitle="A walkthrough of the functionality we built."),
    dict(file="01-setup-full.jpg", seconds=2.4, chapter="01 / SETUP", title="Get ready before entering", subtitle="Check your name, camera and microphone. Entering does not start the broadcast.", crop=(110, 255, 1155, 805), focus=(775, 270, 1017, 514), pointer=(910, 456)),
    dict(file="02-studio-grid.jpg", seconds=1.8, chapter="02 / LAYOUTS", title="Choose from eight stage layouts", subtitle="Build a program with a host and up to three guests.", focus=(170, 458, 666, 508), pointer=(328, 485)),
    dict(file="03-spotlight.jpg", seconds=1.3, chapter="02 / LAYOUTS", title="Put a speaker in the spotlight", subtitle="Switch the composition while keeping the conversation on stage.", focus=(176, 135, 752, 460), pointer=(390, 485)),
    dict(file="04-feature-guest.jpg", seconds=1.3, chapter="02 / LAYOUTS", title="Feature a different camera", subtitle="The host chooses who leads the program.", focus=(176, 135, 752, 460), pointer=(148, 644)),
    dict(file="07-people-on-stage.jpg", seconds=1.4, chapter="03 / PEOPLE", title="Manage everyone in the studio", subtitle="See guest device indicators and control who appears on stage.", focus=(938, 150, 1207, 654), pointer=(1175, 466)),
    dict(file="08-guest-backstage.jpg", seconds=1.8, chapter="03 / PEOPLE", title="Move a guest backstage", subtitle="Removing someone from the program keeps them in the studio.", focus=(942, 422, 1206, 500), pointer=(1167, 468)),
    dict(file="05-screen-presenter.jpg", seconds=1.8, chapter="04 / SCREEN", title="Present with a shared screen", subtitle="Screen + presenter layout. This preview has no active screen source.", focus=(175, 132, 753, 460), pointer=(446, 485)),
    dict(file="06-picture-in-picture.jpg", seconds=1.2, chapter="04 / SCREEN", title="Keep the presenter in the picture", subtitle="Picture in picture is another available presentation layout.", focus=(175, 132, 753, 460), pointer=(568, 485)),
    dict(file="10-background-media.jpg", seconds=2.0, chapter="05 / MEDIA", title="Give your program its own look", subtitle="Backgrounds, logos, overlays, clips, music and sounds are built into the studio.", focus=(940, 320, 1204, 521), pointer=(1153, 373)),
    dict(file="09-studio-chat.jpg", seconds=2.2, chapter="06 / MESSAGES", title="Talk to everyone in the studio", subtitle="Messages reach on-stage and backstage participants and stay out of the broadcast.", focus=(936, 105, 1207, 667), pointer=(1080, 204)),
    dict(file="11-camera-settings.jpg", seconds=1.6, chapter="07 / SETTINGS", title="Choose your capture settings", subtitle="Select your camera, resolution, frame rate and audio devices.", focus=(465, 498, 891, 619), pointer=(566, 565)),
    dict(file="12-visual-effects.jpg", seconds=1.8, chapter="07 / SETTINGS", title="Add camera effects", subtitle="Background blur and virtual backgrounds are available in Visual effects.", focus=(465, 391, 900, 604), pointer=(690, 422)),
    dict(file="13-youtube.jpg", seconds=1.8, chapter="08 / DESTINATIONS", title="Configure your YouTube output", subtitle="Set the stream key and output profile. Default: 1080p60.", focus=(375, 115, 544, 204), pointer=(463, 157)),
    dict(file="14-twitch.jpg", seconds=1.4, chapter="08 / DESTINATIONS", title="Add Twitch to your destinations", subtitle="A supplied ingest server and a separate stream key. Default: 1080p60.", focus=(548, 115, 715, 204), pointer=(633, 157)),
    dict(file="15-x-output.jpg", seconds=1.8, chapter="08 / DESTINATIONS", title="Set up the X output", subtitle="Use your X source's server URL and stream key. Default: 1080p30.", focus=(721, 115, 889, 204), pointer=(805, 157)),
    dict(kind="routing", seconds=3.6, chapter="OUTPUT WORKFLOW", title="One program. Three destinations.", subtitle="Configured RTMP outputs carry the same program to each selected platform."),
]

for scene in SCENES:
    scene["frames"] = round(scene["seconds"] * FPS)

TOTAL_FRAMES = sum(s["frames"] for s in SCENES)


def text(d, xy, value, size=18, color=WHITE, bold=False):
    d.text(xy, value, font=(BOLD if bold else FONTS)[size], fill=color)


def centered(d, box, value, size=18, color=WHITE, bold=False):
    f = (BOLD if bold else FONTS)[size]
    bounds = d.textbbox((0, 0), value, font=f)
    x = (box[0] + box[2] - (bounds[2] - bounds[0])) / 2
    y = (box[1] + box[3] - (bounds[3] - bounds[1])) / 2 - bounds[1]
    d.text((x, y), value, font=f, fill=color)


def ease(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def panel(frame, image, box):
    x, y, width, height = box
    source = image.resize((width, height), Image.Resampling.LANCZOS)
    mask = Image.new("L", (width, height))
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, width - 1, height - 1), radius=14, fill=255)
    frame.paste(source, (x, y), mask)
    ImageDraw.Draw(frame).rounded_rectangle((x, y, x + width, y + height), radius=14, outline="#304860", width=1)


def base(scene, frame_index):
    frame = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(frame)
    # The visual system deliberately keeps annotations outside the app UI.
    d.ellipse((64, 25, 76, 37), fill=BLUE)
    text(d, (87, 22), "BROADCAST STUDIO", 14, BLUE, True)
    right = scene["chapter"]
    width = d.textlength(right, font=BOLD[14])
    text(d, (1216 - width, 22), right, 14, MUTED, True)
    text(d, (64, 53), scene["title"], 34, WHITE, True)
    text(d, (64, 103), scene["subtitle"], 17, MUTED)
    text(d, (64, 815), "INTERFACE DEMO  /  SAMPLE PARTICIPANTS", 13, MUTED)
    text(d, (958, 815), "Built-in studio preview", 13, MUTED)
    d.rounded_rectangle((64, 800, 1216, 803), radius=2, fill="#23364a")
    progress = (frame_index + 1) / TOTAL_FRAMES
    d.rounded_rectangle((64, 800, 64 + 1152 * progress, 803), radius=2, fill=BLUE)
    return frame


IMAGES = {}
for scene in SCENES:
    if "file" not in scene:
        continue
    im = Image.open(CAPTURES / scene["file"]).convert("RGB")
    if scene.get("crop"):
        im = im.crop(scene["crop"])
    IMAGES[scene["file"]] = im


def screenshot_scene(frame, scene, local_frame):
    im = IMAGES[scene["file"]]
    panel(frame, im, (64, 140, 1152, 648))
    d = ImageDraw.Draw(frame)
    # Focus regions and cursor coordinates refer to the original screenshots,
    # except setup, whose coordinates refer to the documented crop.
    sx, sy = 1152 / im.width, 648 / im.height
    fx0, fy0, fx1, fy1 = scene["focus"]
    focus = (64 + fx0 * sx, 140 + fy0 * sy, 64 + fx1 * sx, 140 + fy1 * sy)
    # Delay the focus ring slightly to lead the viewer's eye into the shot.
    if local_frame >= 4:
        d.rounded_rectangle(focus, radius=8, outline="#35a4ff", width=3)
    target = scene["pointer"]
    target = (64 + target[0] * sx, 140 + target[1] * sy)
    start = (target[0] - 68, target[1] + 40)
    k = ease(local_frame / 6)
    x, y = (start[i] + (target[i] - start[i]) * k for i in range(2))
    if 6 <= local_frame <= 13:
        r = 8 + (local_frame - 6) * 2
        d.ellipse((x - r, y - r, x + r, y + r), outline=BLUE, width=3)
    # A small, high contrast animated pointer.
    poly = [(x, y), (x + 1, y + 24), (x + 8, y + 18), (x + 14, y + 29), (x + 20, y + 26), (x + 14, y + 15), (x + 24, y + 14)]
    d.polygon(poly, fill="#ffffff", outline="#062644", width=2)


def intro_scene(frame, local_frame):
    d = ImageDraw.Draw(frame)
    text(d, (64, 206), "Set up.", 48, WHITE, True)
    text(d, (64, 272), "Stage.", 48, WHITE, True)
    text(d, (64, 338), "Stream.", 48, BLUE, True)
    panel(frame, IMAGES["02-studio-grid.jpg"], (440, 208, 776, 437))
    for i, (number, label) in enumerate([("4", "people in one studio"), ("8", "stage layouts"), ("3", "streaming platforms")]):
        y = 464 + i * 77
        d.rounded_rectangle((64, y, 111, y + 47), radius=10, fill="#153450")
        centered(d, (64, y, 111, y + 47), number, 24, BLUE, True)
        text(d, (126, y + 12), label, 18, WHITE)
    for i, label in enumerate(["LAYOUTS", "GUESTS", "SCREEN", "MEDIA", "CHAT", "EFFECTS", "RTMP"]):
        x = 64 + i * 166
        visible = ease((local_frame - i * 1.5) / 5)
        if visible > 0:
            d.rounded_rectangle((x, 727, x + 149, 767), radius=10, fill="#17334e", outline="#285274")
            centered(d, (x, 727, x + 149, 767), label, 14, BLUE, True)


def routing_scene(frame, local_frame):
    d = ImageDraw.Draw(frame)
    panel(frame, IMAGES["10-background-media.jpg"].crop((176, 132, 752, 460)), (64, 271, 520, 296))
    text(d, (65, 235), "YOUR PROGRAM", 18, BLUE, True)
    centered(d, (64, 584, 584, 616), "Cameras + screen + branding + media", 17, WHITE)
    cards = [(748, 214, 1200, 346), (748, 390, 1200, 522), (748, 566, 1200, 698)]
    platforms = [("YouTube", "1080p60", "#ff5d73", "YT"), ("Twitch", "1080p60", "#bc90ff", "TW"), ("X", "1080p30 default", "#edf4ff", "X")]
    center_y = 419
    for i, (box, platform) in enumerate(zip(cards, platforms)):
        name, profile, color, mark = platform
        cy = (box[1] + box[3]) / 2
        d.line([(585, center_y), (665, center_y), (665, cy), (748, cy)], fill="#345473", width=3)
        d.rounded_rectangle(box, radius=18, fill="#102c43", outline="#345b7c", width=2)
        d.rounded_rectangle((775, box[1] + 37, 829, box[1] + 91), radius=12, fill=color)
        centered(d, (775, box[1] + 37, 829, box[1] + 91), mark, 18, BG, True)
        text(d, (853, box[1] + 30), name, 28, WHITE, True)
        text(d, (853, box[1] + 77), profile, 18, MUTED)
        # Animated packets describe the configured output path, not live status.
        path = [(585, center_y), (665, center_y), (665, cy), (748, cy)]
        lengths = [math.dist(path[k], path[k + 1]) for k in range(3)]
        full = sum(lengths)
        phase = ((local_frame / FPS * 0.7 + i * 0.28) % 1) * full
        for k, length in enumerate(lengths):
            if phase <= length:
                proportion = phase / max(1, length)
                px = path[k][0] + (path[k + 1][0] - path[k][0]) * proportion
                py = path[k][1] + (path[k + 1][1] - path[k][1]) * proportion
                d.ellipse((px - 6, py - 6, px + 6, py + 6), fill=color)
                break
            phase -= length
    centered(d, (64, 735, 1216, 770), "Output workflow illustration  /  Destination setup shown in preview", 16, MUTED)


def main():
    video = ROOT / "broadcast-studio-demo.mp4"
    gif = ROOT / "broadcast-studio-demo.gif"
    encode = subprocess.Popen([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
        "-r", str(FPS), "-i", "pipe:0", "-an", "-c:v", "libx264",
        "-preset", "fast", "-crf", "16", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", str(video),
    ], stdin=subprocess.PIPE)
    index = 0
    samples = []
    poster = None
    try:
        for scene_number, scene in enumerate(SCENES):
            print(f"Rendering {scene_number + 1}/{len(SCENES)}: {scene['title']}", flush=True)
            for local in range(scene["frames"]):
                frame = base(scene, index)
                if scene.get("kind") == "intro":
                    intro_scene(frame, local)
                elif scene.get("kind") == "routing":
                    routing_scene(frame, local)
                else:
                    screenshot_scene(frame, scene, local)
                if local == scene["frames"] // 2:
                    samples.append((scene["title"], frame.copy()))
                    if scene.get("kind") == "intro":
                        poster = frame.copy()
                encode.stdin.write(frame.tobytes())
                index += 1
        encode.stdin.close()
        if encode.wait() != 0:
            raise RuntimeError("Video encoding failed")
    except Exception:
        encode.kill()
        raise
    poster.save(ROOT / "poster.jpg", quality=95)
    # A single palette avoids flicker, and Bayer dithering keeps file size small.
    subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(video),
        "-filter_complex", "[0:v]split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle",
        "-loop", "0", str(gif),
    ], check=True)
    contact = Image.new("RGB", (1280, math.ceil(len(samples) / 4) * 235), "#dfe8f2")
    cd = ImageDraw.Draw(contact)
    for i, (title, frame) in enumerate(samples):
        thumbnail = frame.resize((312, 209), Image.Resampling.LANCZOS)
        x, y = (i % 4) * 320 + 4, (i // 4) * 235
        contact.paste(thumbnail, (x, y))
        cd.text((x + 3, y + 212), title, font=FONTS[13], fill=BG)
    contact.save(ROOT / "contact-sheet.jpg", quality=93)
    report = {
        "dimensions": [W, H], "fps": FPS, "rendered_frames": index,
        "duration_seconds": index / FPS, "loop": "forever",
        "gif_bytes": gif.stat().st_size, "mp4_bytes": video.stat().st_size,
        "capture_source": "Actual app UI using built-in interface preview",
        "broadcast_started": False,
        "scenes": [{k: s[k] for k in ["title", "chapter", "seconds"]} for s in SCENES],
    }
    (ROOT / "verification.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2), flush=True)


if __name__ == "__main__":
    main()
