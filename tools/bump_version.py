#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
sw.js の VERSION を1つ上げる。

build_network.py は駅データを作り直したときに VERSION を上げるが、
運賃表(fares.js)や画面(index.html / style.css / app.js)だけを直した場合は
それが走らない。VERSION が変わらないと利用者の端末に修正が届かないため、
コードだけ直したときはこのスクリプトを実行する。

使い方:
    python tools/bump_version.py
"""

import io
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SW = os.path.join(os.path.dirname(HERE), "sw.js")


def main():
    with io.open(SW, encoding="utf-8") as f:
        text = f.read()

    m = re.search(r'^const VERSION = "([^"]*)";', text, re.M)
    if not m:
        print("エラー: sw.js の VERSION 行が見つかりません", file=sys.stderr)
        sys.exit(1)

    old = m.group(1)
    today = time.strftime("%Y-%m-%d")
    if old.startswith(today + "-"):
        try:
            n = int(old.rsplit("-", 1)[1]) + 1
        except ValueError:
            n = 1
    else:
        n = 1
    new = "%s-%d" % (today, n)

    with io.open(SW, "w", encoding="utf-8") as f:
        f.write(text[:m.start(1)] + new + text[m.end(1):])
    print("sw.js の VERSION: %s → %s" % (old, new))
    print("これでアップロード後に利用者へ更新が届きます。")


if __name__ == "__main__":
    main()
