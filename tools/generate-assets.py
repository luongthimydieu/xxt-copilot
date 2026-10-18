"""
XXT Copilot store assets generator.

Outputs:
  xxt-copilot/icons/icon16.png, icon32.png, icon48.png, icon128.png
  xxt-copilot/store-assets/logo-300.png
  xxt-copilot/store-assets/promo-small-440x280.png
  xxt-copilot/store-assets/promo-large-1400x560.png

Requires Pillow (bundled with the DSH runtime).
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON_DIR = os.path.join(ROOT, 'icons')
ASSET_DIR = os.path.join(ROOT, 'store-assets')
os.makedirs(ICON_DIR, exist_ok=True)
os.makedirs(ASSET_DIR, exist_ok=True)

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
    image = Image.new('RGBA', (width, height))
    pixels = image.load()
    denominator = max(1, width + height - 2)
    for y in range(height):
        for x in range(width):
            t = (x + y) / denominator
            pixels[x, y] = (
                int(start[0] + (end[0] - start[0]) * t),
                int(start[1] + (end[1] - start[1]) * t),
                int(start[2] + (end[2] - start[2]) * t),
                255,
            )
    return image


def rounded_icon(size):
    image = gradient(size, size, (99, 102, 241), (236, 72, 153))
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=max(2, int(size * 0.22)), fill=255)
    image.putalpha(mask)

    draw = ImageDraw.Draw(image)
    # 白色文档图形：外框 + 三条内容线 + 右下角勾
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
    # 勾
    draw.line(
        [(int(size * 0.50), int(size * 0.68)), (int(size * 0.57), int(size * 0.75)), (int(size * 0.72), int(size * 0.55))],
        fill=(255, 255, 255, 255),
        width=max(1, int(size * 0.06)),
        joint='curve',
    )
    return image


def save_icons():
    for size in (16, 32, 48, 128):
        rounded_icon(size).save(os.path.join(ICON_DIR, f'icon{size}.png'))
    # 商店 logo 300×300（1:1，官方建议 300）
    rounded_icon(300).save(os.path.join(ASSET_DIR, 'logo-300.png'))
    # 再复制一份 128 进 store-assets 方便上传
    rounded_icon(128).save(os.path.join(ASSET_DIR, 'logo-128.png'))


def promo(width, height, title_size, subtitle_size):
    image = gradient(width, height, (79, 70, 229), (219, 39, 119))
    draw = ImageDraw.Draw(image)
    # 左侧图标
    icon_size = int(height * 0.52)
    icon = rounded_icon(icon_size)
    icon_x = int(width * 0.075)
    icon_y = (height - icon_size) // 2
    image.alpha_composite(icon, (icon_x, icon_y))

    title_font = pick_font(title_size, bold=True)
    sub_font = pick_font(subtitle_size)
    text_x = icon_x + icon_size + int(width * 0.045)
    title = 'XXT Copilot'
    subtitle = '学习通课程题目整理 · 本地校对与导出'
    title_bbox = draw.textbbox((0, 0), title, font=title_font)
    sub_bbox = draw.textbbox((0, 0), subtitle, font=sub_font)
    total_h = (title_bbox[3] - title_bbox[1]) + int(height * 0.09) + (sub_bbox[3] - sub_bbox[1])
    current_y = (height - total_h) // 2 - title_bbox[1]
    draw.text((text_x, current_y), title, font=title_font, fill=(255, 255, 255, 255))
    current_y += (title_bbox[3] - title_bbox[1]) + int(height * 0.09)
    draw.text((text_x, current_y), subtitle, font=sub_font, fill=(255, 255, 255, 235))
    return image


def main():
    save_icons()
    promo(440, 280, 44, 18).save(os.path.join(ASSET_DIR, 'promo-small-440x280.png'))
    promo(1400, 560, 88, 36).save(os.path.join(ASSET_DIR, 'promo-large-1400x560.png'))
    print('icons ->', ICON_DIR)
    print('assets ->', ASSET_DIR)


if __name__ == '__main__':
    main()
