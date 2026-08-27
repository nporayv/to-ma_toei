#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
network.json を生成するビルドスクリプト。

入力: 駅データ.jp (https://ekidata.jp/) からダウンロードしたCSV 4種を tools/csv/ に置く。
      ファイル名の日付部分は問わない(company*.csv / line*.csv / station*.csv / join*.csv)。
      ダウンロードには会員登録が必要。利用規約では加工・再配布が認められている。

      CSVはリポジトリに含めていない(.gitignore済み)。データの出所を一箇所に保つため、
      更新するときは必ず駅データ.jpから取り直すこと。

使い方:
    python tools/build_network.py
    python tools/build_network.py --csv-dir <CSVを置いたディレクトリ>
"""

import argparse
import csv
import glob
import io
import json
import math
import os
import re
import sys
import time

# 自動生成では拾えない徒歩連絡を手で足す。
#
# 下の徒歩乗換は「駅の位置が400m以内」という機械的な条件で作っている。
# ところが実際には、少し離れていても日常的に歩かれている乗り継ぎがある。
# 秋葉原(JR・日比谷線・TX)と岩本町(都営新宿線)は直線415mで、
# 15m足りずに漏れていた。昭和通りを渡って5〜6分の距離で、実際によく使われる。
#
# 閾値そのものを上げると、並行する路線の隣どうし(板橋と北池袋など)まで
# 「乗り換えられる」ことになってしまうため、必要なものだけここに書く。
#
# 書式: (駅ID, 駅ID, 徒歩の距離m)。駅IDは駅データ.jpのもの。
EXTRA_WALK = [
    (1130222, 9930408, 450),  # 秋葉原 ↔ 岩本町 (昭和通り経由・実測はおよそ450m)

    # 2026-08-27 追加: 400〜600mで漏れていた組から、実際に歩かれているものを追加。
    # 選定は docs/walk-transfer-candidates.md (54組の候補一覧)から利用者が選んだ。
    # 距離は直線距離に1割ほど足した推定値。
    (2800111, 2800313, 450),  # 銀座 ↔ 東銀座
    (2800219, 9930101, 460),  # 西新宿 ↔ 都庁前
    (1130221, 2800508, 490),  # 御徒町 ↔ 湯島
    (1130221, 2300101, 500),  # 御徒町 ↔ 京成上野
    (1131403, 2800308, 510),  # 馬喰町 ↔ 小伝馬町
    (2100202, 9930219, 520),  # とうきょうスカイツリー ↔ 本所吾妻橋
    (2800103, 9930111, 520),  # 稲荷町 ↔ 新御徒町
    (2200704, 2800402, 510),  # 中井 ↔ 落合
    (1131308, 2800402, 610),  # 東中野 ↔ 落合
    (1132603, 2800412, 590),  # 越中島 ↔ 門前仲町
    (2800215, 9930403, 610),  # 四谷三丁目 ↔ 曙橋
    (1130101, 2800208, 630),  # 東京 ↔ 大手町
    (2800216, 2800217, 640),  # 新宿御苑前 ↔ 新宿三丁目
    (2800308, 9930408, 640),  # 小伝馬町 ↔ 岩本町
    (2800219, 9930102, 640),  # 西新宿 ↔ 新宿西口
    (2100103, 9930317, 650),  # 下板橋 ↔ 新板橋
    (2200104, 9930134, 650),  # 江古田 ↔ 新江古田
    (2800408, 2800807, 650),  # 竹橋 ↔ 神保町
    (1130207, 2801014, 660),  # 代々木 ↔ 北参道
    (2800312, 2800313, 560),  # 築地 ↔ 東銀座
    (2600404, 2600504, 530),  # 中延 ↔ 荏原中延
    (1130208, 9930102, 460),  # 新宿 ↔ 新宿西口
    (1130208, 2800217, 460),  # 新宿 ↔ 新宿三丁目
    (1130220, 2300101, 470),  # 上野 ↔ 京成上野
    (1130524, 2300120, 540),  # 西船橋 ↔ 京成西船
    (1130209, 2200701, 570),  # 新大久保 ↔ 西武新宿
    (2800407, 2800807, 560),  # 九段下 ↔ 神保町
    (1131402, 2800308, 570),  # 三越前 ↔ 小伝馬町
    (1131320, 1131403, 530),  # 浅草橋 ↔ 馬喰町
    (1130102, 9930307, 530),  # 新橋 ↔ 内幸町
    (2100201, 9930903, 620),  # 浅草 ↔ 浅草(TX)
    (2800102, 9930903, 500),  # 田原町 ↔ 浅草(TX)
    (1130219, 2800304, 620),  # 鶯谷 ↔ 入谷
    (1130220, 2800103, 630),  # 上野 ↔ 稲荷町
    (1131216, 2800224, 640),  # 阿佐ケ谷 ↔ 南阿佐ケ谷
    (1130222, 2800106, 550),  # 秋葉原 ↔ 末広町
    (2800309, 9930410, 640),  # 人形町 ↔ 浜町
    (1130227, 9931103, 510),  # 浜松町 ↔ 竹芝
    (9931111, 9933703, 520),  # 東京ビッグサイト ↔ 国際展示場
    (1130307, 2600110, 520),  # 武蔵小杉 ↔ 新丸子
    (1130213, 9930524, 480),  # 大塚 ↔ 向原
    (9930316, 9930521, 490),  # 西巣鴨 ↔ 庚申塚
]

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
OUT = os.path.join(PROJECT, "network.json")

# 収録範囲: 埼玉・千葉・東京・神奈川
PREFECTURES = {"11", "12", "13", "14"}

# 普通運賃では乗れない路線は経路探索に含めない
EXCLUDE_LINES = {
    "11328",  # JR成田エクスプレス(特急料金が別途必要)
}

# ---------------------------------------------------------------------------
# 事業者。company_cd は company.csv のもの。
# free=True は「都営交通無料乗車券」で無料になる事業者。
#   出典: https://www.kotsu.metro.tokyo.jp/other/kanren/fare/free.html
#   → 都営地下鉄・都バス・都電・日暮里舎人ライナー が対象 = 東京都交通局(company_cd 119)
# ---------------------------------------------------------------------------
FREE_COMPANY = "119"  # 東京都交通局

# 東京都交通局の中でも運賃体系が違うので、運賃表を分けるために路線単位で見分ける
TOEI_LINE_OPERATOR = {
    "99305": "toden",   # 東京さくらトラム(都電荒川線) 均一運賃
    "99342": "toneri",  # 日暮里・舎人ライナー
}

# 1つの路線の中で運賃の事業者が変わる直通路線は、境界駅で2本に分けて扱う。
# 分けないと全区間が片方の事業者の運賃になり、実際とかけ離れた額が出る。
# (例: 相鉄・JR直通線は新宿〜大崎まで含むため、全部を相鉄運賃で計算すると
#  新宿〜海老名50kmが270円になってしまう)
SPLIT_LINES = {
    "29003": {
        "boundary": "羽沢横浜国大",
        "parts": [
            {"suffix": "(JR区間)", "op": "jr"},
            {"suffix": "(相鉄区間)", "op": "sotetsu"},
        ],
    },
}

COMPANY_OPERATOR = {
    "2": "jr", "11": "tobu", "12": "seibu", "13": "keisei", "14": "keio",
    "15": "odakyu", "16": "tokyu", "17": "keikyu", "18": "metro", "19": "sotetsu",
    "119": "toei", "121": "saitama", "123": "tx", "124": "mm", "125": "yurikamome",
    "130": "yokohama", "142": "shinkeisei", "146": "tamamono", "148": "monorail",
    "149": "rinkai", "150": "toyo", "152": "hokuso",
}

OPERATOR_NAMES = {
    "toei": "都営地下鉄", "toden": "都電荒川線", "toneri": "日暮里・舎人ライナー",
    "jr": "JR東日本", "metro": "東京メトロ", "keisei": "京成電鉄", "keikyu": "京急電鉄",
    "tokyu": "東急電鉄", "keio": "京王電鉄", "odakyu": "小田急電鉄", "tobu": "東武鉄道",
    "seibu": "西武鉄道", "sotetsu": "相模鉄道", "tx": "つくばエクスプレス",
    "rinkai": "りんかい線", "yurikamome": "ゆりかもめ", "monorail": "東京モノレール",
    "hokuso": "北総鉄道", "shinkeisei": "新京成電鉄", "toyo": "東葉高速鉄道",
    "saitama": "埼玉高速鉄道", "yokohama": "横浜市営地下鉄", "tamamono": "多摩モノレール",
    "mm": "みなとみらい線", "other": "その他鉄道",
}
FREE_OPERATORS = {"toei", "toden", "toneri"}

# 表示用の路線カラー(公式ラインカラー)。CSVの line_color_c は無料版では空のため自前で持つ。
LINE_COLORS = {
    "99301": "#b6007a", "99302": "#e85298", "99303": "#0079c2", "99304": "#6cbb5a",
    "99305": "#f08300", "99342": "#e60012",
    "28001": "#ff9500", "28002": "#f62e36", "28003": "#b5b5ac", "28004": "#009bbf",
    "28005": "#00bb85", "28006": "#c1a470", "28008": "#8f76d6", "28009": "#00ac9b",
    "28010": "#9c5e31",
    "11302": "#9acd32", "11312": "#f15a22", "11313": "#ffd400", "11332": "#00b2e5",
    "11321": "#00ac9a", "11326": "#c9252f", "11320": "#00b48d",
}


def log(*a):
    print(*a, file=sys.stderr)


def find_csv(csv_dir, prefix):
    hits = sorted(glob.glob(os.path.join(csv_dir, prefix + "*.csv")))
    if not hits:
        log("エラー: %s*.csv が %s に見つかりません。" % (prefix, csv_dir))
        log("       駅データ.jp (https://ekidata.jp/) からダウンロードして置いてください。")
        sys.exit(1)
    return hits[-1]  # 同じ種類が複数あれば新しい日付のものを使う


def read_csv(path):
    with io.open(path, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def haversine(lat1, lon1, lat2, lon2):
    """2点間の大円距離(メートル)。"""
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def operator_of(line_cd, company_cd):
    if company_cd == FREE_COMPANY:
        return TOEI_LINE_OPERATOR.get(line_cd, "toei")
    return COMPANY_OPERATOR.get(company_cd, "other")


def split_line(line, spec, groups, idx):
    """事業者が変わる直通路線を、境界駅で2本に分ける。

    境界駅は両側に残す(そこで乗り継げるようにするため)。
    路線IDは元のIDに 1/2 を足して衝突しないようにする。
    """
    bname = spec["boundary"]
    bg = next((g for g in line["stations"] if groups[str(g)]["name"] == bname
               or groups.get(str(g), {}).get("name") == bname), None)
    if bg is None:
        # 境界駅が見つからないときは分けずにそのまま返す(黙って壊れるのを避ける)
        log("警告: %s の境界駅 %s が見つかりません。分割しませんでした" % (line["name"], bname))
        return [line]

    # 境界駅を取り除いたときに分かれる2つのかたまりを求める
    adj = {}
    for i, j in line["edges"]:
        a, b = line["stations"][i], line["stations"][j]
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)

    seen = {bg}
    groups_of_stations = []
    for start in adj.get(bg, []):
        if start in seen:
            continue
        comp, stack = set(), [start]
        seen.add(start)
        while stack:
            c = stack.pop()
            comp.add(c)
            for n in adj.get(c, []):
                if n not in seen:
                    seen.add(n)
                    stack.append(n)
        groups_of_stations.append(comp)

    if len(groups_of_stations) != 2:
        log("警告: %s を2つに分けられませんでした(%d個)" % (line["name"], len(groups_of_stations)))
        return [line]

    out = []
    for n, (comp, part) in enumerate(zip(groups_of_stations, spec["parts"]), start=1):
        members = comp | {bg}
        seq = [g for g in line["stations"] if g in members]
        pos = {g: i for i, g in enumerate(seq)}
        edges = sorted([pos[line["stations"][i]], pos[line["stations"][j]]]
                       for i, j in line["edges"]
                       if line["stations"][i] in members and line["stations"][j] in members)
        sub = {
            "id": line["id"] * 10 + n,
            "name": line["name"] + part["suffix"],
            "op": part["op"],
            "color": line["color"],
            "stations": seq,
            "edges": edges,
        }
        labels = {k: v for k, v in (line.get("labels") or {}).items() if int(k) in members}
        if labels:
            sub["labels"] = labels
        out.append(sub)
    log("  %s を境界駅 %s で2本に分割しました" % (line["name"], bname))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv-dir", default=os.path.join(HERE, "csv"))
    args = ap.parse_args()
    csv_dir = args.csv_dir

    companies = {r["company_cd"]: r for r in read_csv(find_csv(csv_dir, "company"))}

    # e_status: 0=通常, 1=未開業, 2=廃止。通常のものだけ使う。
    lines = {r["line_cd"]: r for r in read_csv(find_csv(csv_dir, "line"))
             if r["e_status"] == "0" and r["line_cd"] not in EXCLUDE_LINES}
    stations = [r for r in read_csv(find_csv(csv_dir, "station"))
                if r["e_status"] == "0" and r["line_cd"] in lines]

    # 対象都県に1駅でもある路線を採用し、その路線の駅は都県をまたいでも全部入れる
    # (途中で切ると経路がつながらなくなるため)
    target = {r["line_cd"] for r in stations if r["pref_cd"] in PREFECTURES}
    stations = [r for r in stations if r["line_cd"] in target]
    log("対象路線: %d / 駅レコード: %d" % (len(target), len(stations)))

    # 無料になる路線が想定どおりか確認する。ここがずれたまま公開すると
    # 「無料と案内したのに有料だった」という最悪の間違いになる。
    free_lines = {cd for cd in target if lines[cd]["company_cd"] == FREE_COMPANY}
    free_ops = {operator_of(cd, FREE_COMPANY) for cd in free_lines}
    log("無料対象(東京都交通局): %d路線" % len(free_lines))
    for cd in sorted(free_lines):
        log("    %s %s" % (cd, lines[cd]["line_name"]))
    if not free_ops <= FREE_OPERATORS:
        log("エラー: 想定外の無料事業者 %s" % (free_ops - FREE_OPERATORS))
        sys.exit(1)

    # 駅グループへ集約。station_g_cd は公式の乗換駅グループで、
    # 「東日本橋＝馬喰横山＝馬喰町」のように名前が違う乗換駅も統合されている。
    by_cd = {}
    groups = {}
    name_votes = {}
    for r in stations:
        g = r["station_g_cd"]
        by_cd[r["station_cd"]] = g
        st = groups.setdefault(g, {
            "id": g, "lat": float(r["lat"]), "lon": float(r["lon"]), "names": set(),
        })
        st["names"].add(r["station_name"])
        key = (g, r["station_name"])
        name_votes[key] = name_votes.get(key, 0) + 1
    for g, st in groups.items():
        st["name"] = max(st["names"], key=lambda n: (name_votes.get((g, n), 0), -len(n)))
    log("駅グループ: %d" % len(groups))

    # 隣接駅は join.csv から取る。路線の並び順から推測するのと違い、
    # 分岐や環状線(山手線・大江戸線)の閉じ方も正しく表現できる。
    joins = read_csv(find_csv(csv_dir, "join"))
    line_edges = {}
    dropped = 0
    for r in joins:
        cd = r["line_cd"]
        if cd not in target:
            continue
        a, b = by_cd.get(r["station_cd1"]), by_cd.get(r["station_cd2"])
        if a is None or b is None or a == b:
            dropped += 1
            continue
        line_edges.setdefault(cd, set()).add((a, b) if a < b else (b, a))
    log("隣接データ: %d路線ぶん (未採用 %d)" % (len(line_edges), dropped))

    # 路線ごとに、駅一覧・路線別の駅名・隣接関係を出す
    lines_out = []
    for cd in sorted(target, key=int):
        edges = line_edges.get(cd)
        if not edges:
            continue
        seq = sorted({g for e in edges for g in e})
        idx = {g: i for i, g in enumerate(seq)}
        row = lines[cd]
        line = {
            "id": int(cd),
            "name": row["line_name"],
            "op": operator_of(cd, row["company_cd"]),
            "color": LINE_COLORS.get(cd, "#8a8a8a"),
            "stations": [int(g) for g in seq],
            "edges": sorted([idx[a], idx[b]] for a, b in edges),
        }
        # 路線ごとに駅名が違う乗換駅は、その路線での駅名を持たせる
        labels = {}
        for r in stations:
            if r["line_cd"] == cd:
                g = r["station_g_cd"]
                if g in idx and r["station_name"] != groups[g]["name"]:
                    labels[str(int(g))] = r["station_name"]
        if labels:
            line["labels"] = labels

        if cd in SPLIT_LINES:
            lines_out.extend(split_line(line, SPLIT_LINES[cd], groups, idx))
        else:
            lines_out.append(line)

    # 徒歩乗換: 別グループ同士で400m以内、かつ同じ路線で隣接していない組み合わせ
    rail_pairs = set()
    for l in lines_out:
        for i, j in l["edges"]:
            a, b = l["stations"][i], l["stations"][j]
            rail_pairs.add((min(a, b), max(a, b)))

    ids = sorted(groups, key=int)
    buckets = {}
    for g in ids:
        st = groups[g]
        buckets.setdefault((round(st["lat"] / 0.005), round(st["lon"] / 0.005)), []).append(g)

    walk, seen = [], set()
    for g in ids:
        st = groups[g]
        bx, by = round(st["lat"] / 0.005), round(st["lon"] / 0.005)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for h in buckets.get((bx + dx, by + dy), []):
                    if int(h) <= int(g):
                        continue
                    pair = (int(g), int(h))
                    if pair in seen or (min(pair), max(pair)) in rail_pairs:
                        continue
                    ot = groups[h]
                    m = haversine(st["lat"], st["lon"], ot["lat"], ot["lon"])
                    if m <= 400:
                        seen.add(pair)
                        walk.append([pair[0], pair[1], round(m)])
    for a, b, m in EXTRA_WALK:
        if str(a) not in groups or str(b) not in groups:
            log("  ★EXTRA_WALK: 駅ID %d-%d が見つからない" % (a, b))
            continue
        if (min(a, b), max(a, b)) in seen or (min(a, b), max(a, b)) in rail_pairs:
            continue
        seen.add((min(a, b), max(a, b)))
        walk.append([min(a, b), max(a, b), m])
        log("  手動で追加: %s ↔ %s (%dm)" % (groups[str(a)]["name"], groups[str(b)]["name"], m))
    log("徒歩乗換: %d 組" % len(walk))

    used = {l["op"] for l in lines_out}
    out = {
        "generated": time.strftime("%Y-%m-%d"),
        "source": "駅データ.jp (https://ekidata.jp/)",
        "operators": {op: {"name": OPERATOR_NAMES.get(op, op), "free": op in FREE_OPERATORS}
                      for op in sorted(used)},
        "stations": [
            [int(st["id"]), st["name"], round(st["lat"], 6), round(st["lon"], 6),
             sorted(n for n in st["names"] if n != st["name"])]
            for st in (groups[g] for g in ids)
        ],
        "lines": lines_out,
        "walk": walk,
    }
    with io.open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    log("出力: %s (%.0f KB)" % (OUT, os.path.getsize(OUT) / 1024))
    log("路線 %d / 駅 %d" % (len(lines_out), len(out["stations"])))

    bump_service_worker()


def bump_service_worker():
    """sw.js の VERSION を更新する。

    これを忘れると利用者の端末に古い運賃データが残り続けるため、
    データを作り直したら必ず上がるようにしておく。
    """
    sw = os.path.join(PROJECT, "sw.js")
    if not os.path.exists(sw):
        return
    with io.open(sw, encoding="utf-8") as f:
        text = f.read()

    today = time.strftime("%Y-%m-%d")
    m = re.search(r'^const VERSION = "([^"]*)";', text, re.M)
    if not m:
        log("警告: sw.js の VERSION 行が見つからないため更新できませんでした")
        return

    old = m.group(1)
    if old.startswith(today + "-"):
        try:
            n = int(old.rsplit("-", 1)[1]) + 1
        except ValueError:
            n = 1
    else:
        n = 1
    new = "%s-%d" % (today, n)

    with io.open(sw, "w", encoding="utf-8") as f:
        f.write(text[:m.start(1)] + new + text[m.end(1):])
    log("sw.js の VERSION: %s → %s" % (old, new))


if __name__ == "__main__":
    main()
