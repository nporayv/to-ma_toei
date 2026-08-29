#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PWA用のアイコンを生成する。 python tools/make_icons.py で実行。

意匠: 街の格子を一本の経路が抜けていく図(2026-08-28に採用した「最短」案)。
      格子は淡い赤、経路は RayV の赤。始点と終点に駅の点を置く。

意匠上の制約:
  ・白地に赤十字は赤十字標章条約および国内法で使用が禁じられているため、十字形は使わない。
    格子は淡色の細線が等間隔に並ぶ地紋であって、標章とは形も色も異なる。
  ・ヘルプマークは東京都の登録商標で改変できないため、模倣しない。
    赤ベタの角丸四角はヘルプマークの第一印象そのものなので、地は白のままにしてある。
  ・花・笑顔・ハート・手など、福祉を直接連想させる記号は使わない。

★以前のアイコンが「顔」に見えた理由と、その回避★
  旧版は (1)角丸の枠が輪郭=頭に見え (2)中身が縦一本の左右対称で顔の中心線と一致し
  (3)白抜きドーナツ状の点が瞳孔の形をしていた、の3つが揃っていた。
  この案は横方向の折れ線・左右非対称・枠なし・白抜きの点なし で、3つとも外している。
  ★改変するときはこの3条件を復活させないこと。★

枠について:
  旧版は「白地だと明るいホーム画面で輪郭が消える」ため赤い枠を付けていたが、
  枠は頭の輪郭に見える原因だったので使わない。代わりに格子を端まで伸ばし、
  地紋そのものにアイコンの範囲を示させている(GRID_BLEED)。
  余白のある見た目に戻したい場合は GRID_BLEED = False にする。
"""

import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "icons")

RED = (208, 42, 43)        # RayVのロゴに合わせた赤
GRID = (245, 216, 217)     # 街路の格子。経路より十分に淡くする
WHITE = (255, 255, 255)

# 意匠は 64×64 の升目で定義し、出力の大きさに合わせて拡大する。
ROUTE = [(10, 50), (34, 50), (34, 18), (54, 18)]  # 左下から右上へ、2回折れる
GRID_X = (18, 34, 50)
GRID_Y = (18, 34, 50)
GRID_BLEED = True          # 格子を端まで伸ばす(枠の代わりに範囲を示す)
GRID_INSET = 8             # GRID_BLEED = False のときの格子の端

ROUTE_W = 7.0              # 経路の太さ
DOT_R = 5.0                # 駅の点の半径
GRID_W = 4.0               # 格子の太さ


def _disc(d, x, y, r, fill):
    d.ellipse([x - r, y - r, x + r, y + r], fill=fill)


def _polyline(d, pts, width, fill):
    """角と端を丸めた折れ線。PILに丸キャップが無いので頂点に円を重ねる。"""
    w = max(1, int(round(width)))
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        d.line([x1, y1, x2, y2], fill=fill, width=w)
    for x, y in pts:
        _disc(d, x, y, width / 2.0, fill)


def draw_icon(size, grid=True, scale=1.0, route_w=ROUTE_W, dot_r=DOT_R):
    """scale は経路だけを中心に寄せる倍率。マスカブル(円に切り抜かれる)用。"""
    ss = 4                      # アンチエイリアス用に4倍で描いて縮小する
    s = size * ss
    u = s / 64.0                # 升目1つぶんの画素数
    img = Image.new("RGBA", (s, s), WHITE + (255,))
    d = ImageDraw.Draw(img)

    if grid:
        gw = max(1, int(round(GRID_W * u)))
        lo, hi = (0, s) if GRID_BLEED else (GRID_INSET * u, (64 - GRID_INSET) * u)
        for gx in GRID_X:
            d.line([gx * u, lo, gx * u, hi], fill=GRID, width=gw)
        for gy in GRID_Y:
            d.line([lo, gy * u, hi, gy * u], fill=GRID, width=gw)

    def place(p):
        x, y = p
        return ((32 + (x - 32) * scale) * u, (32 + (y - 32) * scale) * u)

    pts = [place(p) for p in ROUTE]
    _polyline(d, pts, route_w * scale * u, RED)
    r = dot_r * scale * u
    _disc(d, pts[0][0], pts[0][1], r, RED)
    _disc(d, pts[-1][0], pts[-1][1], r, RED)

    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    specs = [
        # (ファイル名, 大きさ, 格子, 経路の倍率, 経路の太さ, 点の半径)
        ("icon-192.png",           192, True,  1.00, ROUTE_W, DOT_R),
        ("icon-512.png",           512, True,  1.00, ROUTE_W, DOT_R),
        # Androidで円などに切り抜かれる。内側8割に収まるよう経路だけ縮める。
        ("icon-maskable-512.png",  512, True,  0.74, ROUTE_W, DOT_R),
        ("apple-touch-icon.png",   180, True,  1.00, ROUTE_W, DOT_R),
        # 32pxでは格子がつぶれて濁るので省き、経路を少し太くする。
        ("favicon-32.png",          32, False, 1.00, 8.0,     5.5),
    ]
    for name, size, grid, scale, rw, dr in specs:
        p = os.path.join(OUT, name)
        draw_icon(size, grid=grid, scale=scale, route_w=rw, dot_r=dr).save(p)
        print("%-26s %4dpx  %5.1f KB" % (name, size, os.path.getsize(p) / 1024))


if __name__ == "__main__":
    main()
