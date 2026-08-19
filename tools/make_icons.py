#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PWA用のアイコンを生成する。 python tools/make_icons.py で実行。

意匠上の制約:
  ・白地に赤十字は赤十字標章条約および国内法で使用が禁じられているため、十字形は使わない。
  ・ヘルプマークは東京都の登録商標で改変できないため、模倣しない。
  → 経路(線と3つの駅)のモチーフを、RayVのロゴに合わせた白地・赤で表現する。

白地のままだと明るいホーム画面で輪郭が消えるため、通常アイコンには赤い枠を付ける。
マスカブル(Androidで円などに切り抜かれる)は枠が切れてしまうので、枠なしで中央に寄せる。
"""

import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "icons")

RED = (208, 42, 43)       # RayVのロゴに合わせた赤
WHITE = (255, 255, 255)


def draw_icon(size, pad_ratio, border):
    ss = 4  # アンチエイリアス用に4倍で描いて縮小する
    s = size * ss
    img = Image.new("RGBA", (s, s), WHITE + (255,))
    d = ImageDraw.Draw(img)

    if border:
        bw = s * 0.055
        d.rounded_rectangle([bw / 2, bw / 2, s - bw / 2, s - bw / 2],
                            radius=s * 0.20, outline=RED, width=int(bw))

    pad = s * pad_ratio
    inner = s - pad * 2
    cx = s / 2
    top = pad + inner * 0.11
    mid = pad + inner * 0.50
    bottom = pad + inner * 0.89
    bar = inner * 0.15

    d.rounded_rectangle([cx - bar / 2, top, cx + bar / 2, bottom],
                        radius=bar / 2, fill=RED)

    r_out = inner * 0.115
    r_in = r_out * 0.5
    for cy in (top, mid, bottom):
        d.ellipse([cx - r_out, cy - r_out, cx + r_out, cy + r_out], fill=RED)
        d.ellipse([cx - r_in, cy - r_in, cx + r_in, cy + r_in], fill=WHITE + (255,))

    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    specs = [
        # (ファイル名, 大きさ, 余白, 枠)
        ("icon-192.png", 192, 0.14, True),
        ("icon-512.png", 512, 0.14, True),
        ("icon-maskable-512.png", 512, 0.24, False),  # 切り抜かれるので枠なし・中央寄せ
        ("apple-touch-icon.png", 180, 0.14, True),
        ("favicon-32.png", 32, 0.10, True),
    ]
    for name, size, pad, border in specs:
        p = os.path.join(OUT, name)
        draw_icon(size, pad, border).save(p)
        print("%-26s %4dpx  %5.1f KB" % (name, size, os.path.getsize(p) / 1024))


if __name__ == "__main__":
    main()
