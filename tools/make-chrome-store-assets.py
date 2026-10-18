"""
Build Chrome Web Store image assets for XXT Copilot.

Inputs:
  tools/_screenshots/raw-1.png .. raw-3.png   (captured by Edge headless)

Outputs (store-assets/chrome/):
  screenshot-1-catalog-1280x800.png
  screenshot-2-progress-1280x800.png
  screenshot-3-results-1280x800.png
  promo-small-zh-440x280.png
  promo-small-en-440x280.png
  promo-top-zh-1400x560.png
  promo-top-en-1400x560.png

All outputs are 24-bit RGB PNG (no alpha), as required by Chrome Web Store.
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_DIR = os.path.join(ROOT, 'tools', '_screenshots')
OUT_DIR = os.path.join(ROOT, 'store-assets', 'chrome')
os.makedirs(OUT_DIR, exist_ok=True)

FONT_CANDIDATES = [
    r'C:\Windows\Fonts\msyhbd.ttc',
    r'C:\Windows\Fonts\msyh.ttc',
    r'C:\Windows\Fonts\simhei.ttf',
    r'C:\Windows\Fonts\arialbd.ttf',
    r'C:\Windows\Fonts\arial.ttf',
]


def pick_font(size, bold=False):
    candidates = ([r'C:\Windows\Fonts\msyhbd.ttc', r'C:\Windows\Fonts\arialbd.ttf'] if bold else []) + FONT_CANDIDATES
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


def gradient(width, height, start, end):
    image = Image.new('RGB', (width, height))
    pixels = image.load()
    denom = max(1, width + height - 2)
    for y in range(height):
        for x in range(width):
            t = (x + y) / denom
            pixels[x, y] = (
                int(start[0] + (end[0] - start[0]) * t),
                int(start[1] + (end[1] - start[1]) * t),
                int(start[2] + (end[2] - start[2]) * t),
            )
    return image


def rounded_icon(size):
    image = gradient(size, size, (99, 102, 241), (236, 72, 153)).convert('RGBA')
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=max(2, int(size * 0.22)), fill=255)
    image.putalpha(mask)

    draw = ImageDraw.Draw(image)
    left = int(size * 0.25)
    top = int(size * 0.18)
    right = int(size * 0.75)
    bottom = int(size * 0.82)
    stroke = max(1, int(size * 0.055))
    draw.rounded_rectangle([left, top, right, bottom], radius=max(1, int(size * 0.08)), outline=(255, 255, 255, 245), width=stroke)
    line_x0 = int(size * 0.34)
    line_x1 = int(size * 0.58)
    for index, ratio in enumerate((0.38, 0.52, 0.66)):
        y = int(size * ratio)
        draw.line([(line_x0, y), (line_x1 - (index * size * 0.03), y)], fill=(255, 255, 255, 220), width=max(1, int(size * 0.045)))
    draw.line(
        [(int(size * 0.50), int(size * 0.68)), (int(size * 0.57), int(size * 0.75)), (int(size * 0.72), int(size * 0.55))],
        fill=(255, 255, 255, 255),
        width=max(1, int(size * 0.06)),
        joint='curve',
    )
    return image


def normalize_screenshot(source_path, target_path):
    image = Image.open(source_path).convert('RGBA')
    background = Image.new('RGB', (1280, 800), (255, 255, 255))
    image.thumbnail((1280, 800), Image.LANCZOS)
    x = (1280 - image.width) // 2
    y = (800 - image.height) // 2
    background.paste(image, (x, y), image)
    background.save(target_path, 'PNG')
    print('wrote', target_path, background.size, background.mode)


def screenshot_thumb(results_path, width, height):
    thumb = Image.open(results_path).convert('RGB')
    thumb.thumbnail((width, height), Image.LANCZOS)
    return thumb


def small_promo(language, path):
    width, height = 440, 280
    image = gradient(width, height, (79, 70, 229), (219, 39, 119))
    icon = rounded_icon(104)
    image.paste(icon, (26, 88), icon)
    draw = ImageDraw.Draw(image)
    title_font = pick_font(38, bold=True)
    sub_font = pick_font(16)
    badge_font = pick_font(13, bold=True)
    if language == 'zh':
        title = 'XXT Copilot'
        subtitle = '学习通课程题目整理'
        badge = 'Microsoft Edge 加载项'
        badge_fill = (255, 255, 255)
        badge_text = (79, 70, 229)
    else:
        title = 'XXT Copilot'
        subtitle = 'Course question organizer'
        badge = 'Microsoft Edge Add-ons'
        badge_fill = (255, 255, 255)
        badge_text = (79, 70, 229)
    draw.text((146, 82), title, font=title_font, fill=(255, 255, 255))
    draw.text((148, 132), subtitle, font=sub_font, fill=(255, 255, 255, 235))
    # 小徽标
    bbox = draw.textbbox((0, 0), badge, font=badge_font)
    bw = bbox[2] - bbox[0] + 24
    bh = bbox[3] - bbox[1] + 14
    top = 182
    draw.rounded_rectangle([148, top, 148 + bw, top + bh], radius=bh // 2, fill=badge_fill)
    draw.text((148 + 12, top + 6), badge, font=badge_font, fill=badge_text)
    image.save(path, 'PNG')
    print('wrote', path, image.size, image.mode)


def top_promo(language, path):
    width, height = 1400, 560
    image = gradient(width, height, (79, 70, 229), (219, 39, 119))
    draw = ImageDraw.Draw(image)
    icon = rounded_icon(160)
    image.paste(icon, (86, 200), icon)

    if language == 'zh':
        title = 'XXT Copilot'
        subtitle = '学习通课程题目·本地整理与导出'
        badge = '已在 Microsoft Edge 加载项商店上架'
    else:
        title = 'XXT Copilot'
        subtitle = 'Organize course questions locally'
        badge = 'Available on Microsoft Edge Add-ons'
    title_font = pick_font(76, bold=True)
    sub_font = pick_font(28)
    badge_font = pick_font(20, bold=True)
    draw.text((286, 172), title, font=title_font, fill=(255, 255, 255))
    draw.text((290, 262), subtitle, font=sub_font, fill=(255, 255, 255, 235))
    bbox = draw.textbbox((0, 0), badge, font=badge_font)
    bw = bbox[2] - bbox[0] + 30
    bh = bbox[3] - bbox[1] + 18
    top = 320
    draw.rounded_rectangle([290, top, 290 + bw, top + bh], radius=bh // 2, fill=(255, 255, 255))
    draw.text((290 + 15, top + 7), badge, font=badge_font, fill=(79, 70, 229))

    # 右侧结果表格截图卡片
    results_path = os.path.join(OUT_DIR, 'screenshot-3-results-1280x800.png')
    if os.path.exists(results_path):
        thumb = screenshot_thumb(results_path, 560, 350)
        card_x = 790
        card_y = 105
        pad = 6
        draw.rounded_rectangle(
            [card_x - 10, card_y - 10, card_x + 560 + 10, card_y + 350 + 10],
            radius=18,
            fill=(255, 255, 255, 255),
        )
        image.paste(thumb, (card_x, card_y))
        draw.rectangle([card_x, card_y, card_x + 560, card_y + 350], outline=(255, 255, 255), width=0)
    image.save(path, 'PNG')
    print('wrote', path, image.size, image.mode)


def main():
    steps = [
        ('raw-1.png', 'screenshot-1-catalog-1280x800.png'),
        ('raw-2.png', 'screenshot-2-progress-1280x800.png'),
        ('raw-3.png', 'screenshot-3-results-1280x800.png'),
    ]
    for source_name, target_name in steps:
        source = os.path.join(RAW_DIR, source_name)
        if not os.path.exists(source):
            print('missing screenshot:', source, file=sys.stderr)
            return 1
        normalize_screenshot(source, os.path.join(OUT_DIR, target_name))
    small_promo('zh', os.path.join(OUT_DIR, 'promo-small-zh-440x280.png'))
    small_promo('en', os.path.join(OUT_DIR, 'promo-small-en-440x280.png'))
    top_promo('zh', os.path.join(OUT_DIR, 'promo-top-zh-1400x560.png'))
    top_promo('en', os.path.join(OUT_DIR, 'promo-top-en-1400x560.png'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
