#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PWA用のアイコンを生成する。 python tools/make_icons.py で実行。

フォントに依存しないよう図形だけで描く。
図柄は「経路」: 上半分が有料区間(白)、下半分が無料区間(緑)の路線図に見立てている。
"""

import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "icons")

BG = (182, 0, 122)        # 都営カラー
PAID = (255, 255, 255)    # 有料区間
FREE = (74, 222, 128)     # 無料区間
STOP = (255, 255, 255)


def draw_icon(size, padding_ratio):
    """padding_ratio: マスカブル用に中央へ寄せる余白の割合"""
    ss = 4  # アンチエイリアス用に4倍で描いて縮小する
    s = size * ss
    img = Image.new("RGBA", (s, s), BG + (255,))
    d = ImageDraw.Draw(img)

    pad = s * padding_ratio
    inner = s - pad * 2
    cx = s / 2

    # 路線の縦棒
    bar_w = inner * 0.17
    top = pad + inner * 0.10
    bottom = pad + inner * 0.90
    mid = pad + inner * 0.50

    d.rounded_rectangle([cx - bar_w / 2, top, cx + bar_w / 2, mid],
                        radius=bar_w / 2, fill=PAID)
    d.rounded_rectangle([cx - bar_w / 2, mid - bar_w / 2, cx + bar_w / 2, bottom],
                        radius=bar_w / 2, fill=FREE)

    # 駅を表す丸(出発・乗換・到着)
    r_out = inner * 0.115
    r_in = r_out * 0.52
    for cy, ring in ((top, STOP), (mid, FREE), (bottom, FREE)):
        d.ellipse([cx - r_out, cy - r_out, cx + r_out, cy + r_out], fill=ring)
        d.ellipse([cx - r_in, cy - r_in, cx + r_in, cy + r_in], fill=BG + (255,))

    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    # 通常アイコンは余白すこし、マスカブルは丸く切られるので中央へ寄せる
    specs = [
        ("icon-192.png", 192, 0.10),
        ("icon-512.png", 512, 0.10),
        ("icon-maskable-512.png", 512, 0.20),
        ("apple-touch-icon.png", 180, 0.10),
        ("favicon-32.png", 32, 0.06),
    ]
    for name, size, pad in specs:
        p = os.path.join(OUT, name)
        draw_icon(size, pad).save(p)
        print("%-26s %4dpx  %5.1f KB" % (name, size, os.path.getsize(p) / 1024))


if __name__ == "__main__":
    main()
