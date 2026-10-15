"""Render the broadcast media pack from the saved Canva background.

Requires Python with Pillow and ffmpeg. Run from any directory.
"""

from pathlib import Path
import json
import math
import random
import subprocess

from PIL import Image, ImageDraw, ImageFont, ImageOps

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
W, H = 1920, 1080
FPS = 30
SANS = Path('/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf')
REGULAR = Path('/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf')
MONO = Path.home() / '.local/share/fonts/JetBrainsMonoNerdFont/JetBrainsMonoNerdFontMono-Bold.ttf'
if not MONO.exists():
    MONO = Path('/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf')
CYAN = (79, 210, 255)
WHITE = (248, 251, 255)
for folder in ('clips', 'overlays'):
    (ROOT / 'media' / folder).mkdir(parents=True, exist_ok=True)


def font(size, mono=False, regular=False):
    return ImageFont.truetype(str(MONO if mono else REGULAR if regular else SANS), size)


def centered(draw, xy, text, face, fill):
    draw.text(xy, text, font=face, fill=fill, anchor='mm')


def render_video(path, frame_at, frames, width=W, height=H, fps=FPS):
    command = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
               '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', f'{width}x{height}',
               '-framerate', str(fps), '-i', 'pipe:0', '-an', '-c:v', 'libx264',
               '-threads', '4', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p',
               '-movflags', '+faststart', str(path)]
    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    try:
        for frame in range(frames):
            process.stdin.write(frame_at(frame).convert('RGB').tobytes())
            if frame % (fps * 10) == 0:
                print(f'{path.name}: {frame // fps}s / {frames // fps}s', flush=True)
    finally:
        process.stdin.close()
    if process.wait() != 0:
        raise RuntimeError(f'ffmpeg failed for {path}')


def countdown():
    base = ImageOps.fit(Image.open(HERE / 'canva-background.jpg').convert('RGB'), (W, H))
    draw = ImageDraw.Draw(base)
    draw.rounded_rectangle((786, 239, 1134, 290), radius=25, fill=(11, 29, 53), outline=(34, 70, 105), width=1)
    draw.ellipse((816, 258, 828, 270), fill=CYAN)
    centered(draw, (975, 263), 'LIVE BROADCAST', font(22), (187, 229, 247))
    centered(draw, (960, 373), 'Starting soon', font(100), WHITE)
    centered(draw, (960, 455), 'Thanks for joining. We’ll be live in a moment.', font(30, regular=True), (156, 175, 199))
    draw.rounded_rectangle((600, 529, 1320, 774), radius=32, fill=(7, 17, 33), outline=(26, 47, 72), width=2)
    centered(draw, (960, 854), 'SETTLE IN. WE’RE ALMOST READY.', font(20), (111, 143, 177))
    timer_face = font(182, mono=True)
    labels = {}
    for remaining in range(61):
        label = f'{remaining // 60:02d}:{remaining % 60:02d}'
        tile = Image.new('RGBA', (680, 210))
        centered(ImageDraw.Draw(tile), (340, 98), label, timer_face, WHITE)
        labels[remaining] = tile

    def frame_at(n):
        remaining = 0 if n == 60 * FPS - 1 else 60 - n // FPS
        im = base.copy()
        im.paste(labels[remaining], (620, 545), labels[remaining])
        d = ImageDraw.Draw(im)
        d.rounded_rectangle((690, 736, 1230, 743), radius=3, fill=(28, 48, 68))
        progress = max(0, 1 - n / (60 * FPS - 1))
        if progress > 0:
            right = 690 + max(2, round(540 * progress))
            d.rounded_rectangle((690, 736, right, 743), radius=3, fill=CYAN)
        pulse = 140 + int(60 * (0.5 + 0.5 * math.sin(n / FPS * math.tau / 2)))
        d.ellipse((816, 258, 828, 270), fill=(50, pulse, 255))
        return im

    for n, label in [(0, 'start'), (900, 'halfway'), (1799, 'finish')]:
        frame_at(n).save(HERE / f'countdown-{label}.jpg', quality=93)
    output = ROOT / 'media/clips/starting-soon-1-minute.mp4'
    render_video(output, frame_at, 60 * FPS)
    return {'file': str(output.relative_to(ROOT)), 'duration_seconds': 60,
            'dimensions': [W, H], 'fps': FPS, 'audio': False,
            'timer': '01:00 at start; updates at each second; 00:00 on final frame'}


# Transparent full-canvas overlays use animated WebP, which the current studio
# displays over cameras. They loop with a transparent pause; hide after use.
OW, OH, OFPS = 1280, 720, 25


def envelope(t, duration):
    return max(0, min(1, t / 0.25, (duration - t) / 0.45))


def write_overlay(name, frame_at, seconds):
    frames = [frame_at(i / OFPS) for i in range(round(seconds * OFPS))]
    path = ROOT / 'media/overlays' / f'{name}.webp'
    frames[0].save(path, 'WEBP', save_all=True, append_images=frames[1:],
                   duration=40, loop=0, lossless=False, quality=90, method=4,
                   allow_mixed=True)
    preview = frame_at(1.8)
    checker = Image.new('RGBA', (OW, OH), (20, 29, 45, 255))
    checker.alpha_composite(preview)
    checker.convert('RGB').save(HERE / f'{name}-preview.jpg', quality=93)
    print(f'{path.name}: rendered {len(frames)} transparent frames', flush=True)
    return {'file': str(path.relative_to(ROOT)), 'duration_seconds': seconds,
            'dimensions': [OW, OH], 'fps': OFPS, 'alpha': True, 'loop': True}


def celebrations():
    rng = random.Random(703)
    particles = [(rng.choice([-1, 1]), rng.uniform(220, 950), rng.uniform(200, 490),
                  rng.uniform(-0.3, 0.3), rng.uniform(6, 12), rng.uniform(0, math.tau),
                  rng.choice([(79, 210, 255), (157, 128, 255), (255, 113, 171), (255, 210, 96), (248, 251, 255)]))
                 for _ in range(155)]

    def confetti(t):
        im = Image.new('RGBA', (OW, OH))
        if t > 4.25:
            return im
        d = ImageDraw.Draw(im)
        alpha = round(255 * envelope(t, 4.25))
        for side, vx, vy, delay, size, phase, color in particles:
            age = max(0, t - delay)
            start = 0 if side == 1 else OW
            x = start + side * vx * (1 - math.exp(-1.3 * age))
            y = OH - vy * age + 112 * age * age
            angle = phase + age * 5
            points = [(x + math.cos(angle + a) * size, y + math.sin(angle + a) * size * 0.55)
                      for a in (0, math.pi / 2, math.pi, 3 * math.pi / 2)]
            d.polygon(points, fill=(*color, alpha))
        return im

    stars = [(rng.uniform(20, 1260), rng.uniform(20, 700), rng.uniform(0, 2.5),
              rng.uniform(4, 10), rng.uniform(0, math.tau)) for _ in range(100)]

    def gold(t):
        im = Image.new('RGBA', (OW, OH))
        if t > 4.25:
            return im
        d = ImageDraw.Draw(im)
        fade = envelope(t, 4.25)
        for x, y, phase, size, angle in stars:
            brightness = max(0, math.sin(t * 3 + phase)) ** 3
            alpha = round(240 * brightness * fade)
            y -= 27 * t
            points = []
            for k in range(8):
                a = k * math.pi / 4 + angle * 0.12
                radius = size if k % 2 == 0 else size * 0.22
                points.append((x + math.cos(a) * radius, y + math.sin(a) * radius))
            d.polygon(points, fill=(255, 216, 121, alpha))
        for cx, cy, delay in [(195, 180, 0.15), (1080, 230, 0.7), (945, 530, 1.4)]:
            age = t - delay
            if 0 < age < 1.8:
                for i in range(32):
                    a = i * math.tau / 32
                    radius = 105 * (1 - math.exp(-2.6 * age))
                    x = cx + radius * math.cos(a)
                    y = cy + radius * math.sin(a) + age * age * 24
                    length = max(1, 13 * (1 - age / 1.8))
                    d.line((x, y, x - length * math.cos(a), y - length * math.sin(a)),
                           fill=(255, 210, 99, round(255 * (1 - age / 1.8) * fade)), width=2)
        return im

    return [write_overlay('celebration-confetti', confetti, 5.4),
            write_overlay('celebration-gold-sparkles', gold, 5.4)]


def icon(draw, kind, cx, cy, color, scale=1):
    s = scale
    if kind == 'like':
        pts = [(-17, -3), (-7, -3), (1, -17), (7, -17), (7, -4), (21, -4),
               (23, 2), (17, 19), (-7, 19), (-7, -1), (-17, -1)]
        draw.polygon([(cx + x*s, cy + y*s) for x, y in pts], fill=color)
        draw.rectangle((cx-22*s, cy-1*s, cx-12*s, cy+19*s), fill=color)
    elif kind == 'share':
        for px, py in [(cx-15*s, cy), (cx+15*s, cy-16*s), (cx+15*s, cy+16*s)]:
            draw.ellipse((px-5*s, py-5*s, px+5*s, py+5*s), fill=color)
        draw.line((cx-12*s, cy-2*s, cx+12*s, cy-15*s), fill=color, width=max(2, round(3*s)))
        draw.line((cx-12*s, cy+2*s, cx+12*s, cy+15*s), fill=color, width=max(2, round(3*s)))
    else:
        draw.rounded_rectangle((cx-22*s, cy-16*s, cx+22*s, cy+16*s), radius=8*s, fill=color)
        triangle = (12,22,39,color[3]) if sum(color[:3]) > 600 else (255,255,255,color[3])
        draw.polygon([(cx-5*s, cy-8*s), (cx-5*s, cy+8*s), (cx+8*s, cy)], fill=triangle)


def ctas():
    def minimal(t):
        im = Image.new('RGBA', (OW, OH))
        if t >= 6.4:
            return im
        opacity = envelope(t, 6.4)
        y = 619 + round(45 * (1 - min(1, t / 0.4)) ** 3)
        d = ImageDraw.Draw(im)
        alpha = round(255 * opacity)
        d.rounded_rectangle((299, y-48, 981, y+48), radius=25, fill=(12,22,39,alpha), outline=(51,73,102,alpha), width=2)
        labels = [('like','LIKE',385), ('share','SHARE',581), ('subscribe','SUBSCRIBE',808)]
        for i, (kind, text, x) in enumerate(labels):
            active = t >= 1.0 + i * 1.1
            color = (79,210,255,alpha) if active else (149,165,190,alpha)
            if kind == 'subscribe':
                d.rounded_rectangle((721,y-30,954,y+30), radius=14, fill=(226,47,72,alpha))
                color = (255,255,255,alpha)
            icon(d, kind, x-39, y-2, color, 0.68)
            centered(d, (x+(49 if i == 2 else 18), y-1), 'SUBSCRIBED' if active and i == 2 else text, font(19), color)
        # A cursor travels to each action and sends a small click ripple.
        i = min(2, max(0, int((t-0.7)/1.1)))
        cx = [392, 589, 832][i]
        if 0.45 < t < 4.8:
            cursor = [(cx,y+20),(cx+8,y+47),(cx+14,y+38),(cx+24,y+41)]
            d.polygon(cursor, fill=(255,255,255,alpha), outline=(20,35,55,alpha))
        return im

    def playful(t):
        im = Image.new('RGBA', (OW, OH))
        d = ImageDraw.Draw(im)
        for i, (kind, label, color, x) in enumerate([
            ('like','LIKE',(36,164,235),364), ('share','SHARE',(129,95,231),640),
            ('subscribe','SUBSCRIBE',(239,64,95),916)]):
            age = t - i * 0.28
            if age <= 0 or t > 6.2:
                continue
            enter = min(1, age / 0.45)
            y = 607 + 55 * (1-enter) ** 2 - 10 * math.exp(-2*age) * math.sin(age*13)
            alpha = round(255 * min(1, age/0.16, max(0, (6.2-t)/0.4)))
            d.rounded_rectangle((x-124,y-40,x+124,y+40), radius=25, fill=(*color,alpha))
            icon(d, kind, x-78, y, (255,255,255,alpha), 0.7)
            centered(d, (x+18,y-1), label, font(22), (255,255,255,alpha))
            if age < 1.25:
                for j in range(7):
                    a = j * math.tau / 7
                    r = 35 + age * 85
                    px,py = x+math.cos(a)*r,y+math.sin(a)*r*0.62
                    d.ellipse((px-3,py-3,px+3,py+3), fill=(*color,round(alpha*(1-age/1.25))))
        return im

    return [write_overlay('like-share-subscribe-minimal', minimal, 7.6),
            write_overlay('like-share-subscribe-playful', playful, 7.6)]


if __name__ == '__main__':
    outputs = [countdown(), *celebrations(), *ctas()]
    (HERE / 'manifest.json').write_text(json.dumps({
        'background_canva_media_id': 'MAHW9i45KMc',
        'license': 'LicenseRef-Individual-Noncommercial-1.0',
        'license_documents': ['LICENSE', 'MEDIA_LICENSE.md', 'THIRD_PARTY_NOTICES.md'],
        'assets': outputs,
    }, indent=2) + '\n')
    print('Broadcast pack finished.', flush=True)
