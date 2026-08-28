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

    # 成田スカイアクセス線。線路の実態ではなく「アクセス特急の停車駅だけを結んだ
    # 運転系統」として登録されており、日暮里〜青砥が途中5駅を飛ばした1本の辺になる。
    # 辺の長さは駅間の直線距離なので、通過する駅を飛ばすぶん実際の線路より短くなり、
    # この線を通る経路すべてで距離と運賃が過小に出ていた
    # (日暮里〜京成高砂を9.6kmと見積もり200円。実際は10.6kmで280円)。
    #
    # 同じ線路は京成本線(京成上野〜京成高砂)と北総線(京成高砂〜印旛日本医大)として
    # 別に登録されており、そちらは公式の駅間キロを持っているので、除いても線路は失われない。
    # 運賃の面でも、成田空港へは京成本線経由のほうが安いため(日暮里から1060円 /
    # スカイアクセス経由1280円)、最安経路を探す本サービスでは選ばれることがない。
    #
    # ただし成田湯川駅だけはこの線にしかないため、検索できなくなる。
    "23006",
}

# ---------------------------------------------------------------------------
# 事業者。company_cd は company.csv のもの。
# free=True は「都営交通無料乗車券」で無料になる事業者。
#   出典: https://www.kotsu.metro.tokyo.jp/other/kanren/fare/free.html
#   → 都営地下鉄・都バス・都電・日暮里舎人ライナー が対象 = 東京都交通局(company_cd 119)
# ---------------------------------------------------------------------------
FREE_COMPANY = "119"  # 東京都交通局

# 同じ会社でも運賃体系が違う路線は、路線単位で別の事業者として扱う。
# 会社が同じでも運賃は通算されないため、ここで分けないと実際より安く出る。
LINE_OPERATOR = {
    # 東京都交通局。無料乗車券の対象だが「本来いくらか」を出すため運賃表は分ける。
    "99305": "toden",   # 東京さくらトラム(都電荒川線) 均一運賃
    "99342": "toneri",  # 日暮里・舎人ライナー
    # 京成松戸線(旧・新京成線)。2025年4月1日に京成へ吸収合併されたが、
    # 運賃体系は独立したまま残り、京成線とは通算されず合算になる。
    # まとめて扱うと松戸線をまたぐ経路で実際より安く出る。
    # https://www.tetsudo.com/column/1204/
    "99329": "keisei_matsudo",
}

# ---------------------------------------------------------------------------
# 公式の駅間キロが手に入る路線は、係数で推定せずそのまま使う。
#
# 路線単位の補正係数では、路線内のばらつきを吸収できない。京成本線は都心部が
# 1.2前後、郊外部が1.05前後で、一律にすると都心の短距離が1駅ぶん近く出てしまい、
# 日暮里〜京成高砂(10.6km)を9.6kmと見積もって200円と案内していた(実際280円)。
#
# 値は「路線の一方の端からの累計営業キロ」。駅間キロは差分で求めるので、
# どちらの端を起点にしても、途中の駅が1つ抜けていても影響しない。
#
# 出典: 京成電鉄 駅別運賃表(日暮里 KS02)。営業キロと運賃が併記されている。
#       https://www.keisei.co.jp/keisei/tetudou/fare/pdf/103.pdf
# 他社もこの形の表を出していれば、同じように足せる。
# 2026-08-28: 旧worktree(claude/transit-guidance-service-50840a)から移植。
# ---------------------------------------------------------------------------
EDGE_KM = {
    # 京成本線(京成上野からの累計)。成田から先は空港線・東成田線に分かれる。
    "23001": {
        "京成上野": 0, "日暮里": 2.1, "新三河島": 3.4, "町屋": 4.3, "千住大橋": 5.9,
        "京成関屋": 7.3, "堀切菖蒲園": 8.8, "お花茶屋": 9.9, "青砥": 11.5,
        "京成高砂": 12.7, "京成小岩": 14.5, "江戸川": 15.7, "国府台": 16.4,
        "市川真間": 17.3, "菅野": 18.2, "京成八幡": 19.1, "鬼越": 20.1,
        "京成中山": 20.8, "東中山": 21.6, "京成西船": 22.2, "海神": 23.6,
        "京成船橋": 25.1, "大神宮下": 26.4, "船橋競馬場": 27.2, "谷津": 28.2,
        "京成津田沼": 29.7, "京成大久保": 32.1, "実籾": 34.0, "八千代台": 36.6,
        "京成大和田": 38.7, "勝田台": 40.3, "志津": 42.1, "ユーカリが丘": 43.2,
        "京成臼井": 45.7, "京成佐倉": 51.0, "大佐倉": 53.0, "京成酒々井": 55.0,
        "宗吾参道": 57.0, "公津の杜": 58.6, "京成成田": 61.2,
        "空港第2ビル": 68.3, "成田空港": 69.3, "東成田": 68.3,
    },
    # 京成押上線(日暮里からの累計。青砥〜京成高砂は本線の1.2km)
    "23002": {
        "押上": 15.1, "京成曳舟": 14.0, "八広": 12.8, "四ツ木": 12.0,
        "京成立石": 10.5, "青砥": 9.4, "京成高砂": 10.6,
    },
    # 京成金町線(日暮里からの累計)
    "23003": {"京成高砂": 10.6, "柴又": 11.6, "京成金町": 13.1},
    # 京成千葉線(日暮里からの累計)
    "23004": {
        "京成津田沼": 27.6, "京成幕張本郷": 29.7, "京成幕張": 31.6, "検見川": 32.9,
        "京成稲毛": 35.7, "みどり台": 37.5, "西登戸": 38.5, "新千葉": 39.3,
        "京成千葉": 39.9, "千葉中央": 40.5,
    },
    # 京成千原線(日暮里からの累計)
    "23005": {
        "千葉中央": 40.5, "千葉寺": 43.0, "大森台": 44.7, "学園前": 47.8,
        "おゆみ野": 49.3, "ちはら台": 51.4,
    },
    # 京成松戸線(京成津田沼からの累計)
    "99329": {
        "京成津田沼": 0, "新津田沼": 1.2, "前原": 2.6, "薬園台": 4.0, "習志野": 4.8,
        "北習志野": 5.5, "高根木戸": 6.4, "高根公団": 7.0, "滝不動": 8.0, "三咲": 9.4,
        "二和向台": 10.2, "鎌ヶ谷大仏": 11.1, "初富": 13.2, "新鎌ヶ谷": 14.4,
        "北初富": 15.1, "くぬぎ山": 16.9, "元山": 17.8, "五香": 19.1, "常盤平": 20.9,
        "八柱": 22.7, "みのり台": 23.5, "松戸新田": 24.1, "上本郷": 24.8, "松戸": 26.5,
    },
    # JR中央本線 東京起点の営業キロ。
    # 特急・快速の路線は停車駅だけを結んだ辺になっていて、東京〜四ツ谷が
    # 途中3駅(神田・御茶ノ水・水道橋・飯田橋・市ケ谷)を飛ばした1本の辺だった。
    # 線路は北へ大きく回るので直線3.4kmに対し実際は6.6km。半分近く短く見積もっていた。
    # 高尾より先は本サービスの対象外なので入れていない(その区間は係数で推定する)。
    "11311": {
        "東京": 0, "神田": 1.3, "御茶ノ水": 2.6, "水道橋": 3.4, "飯田橋": 4.3,
        "市ケ谷": 5.3, "四ツ谷": 6.6, "信濃町": 7.9, "千駄ケ谷": 9.1, "代々木": 9.9,
        "新宿": 10.3, "大久保": 11.7, "東中野": 13.0, "中野": 14.7, "高円寺": 16.1,
        "阿佐ケ谷": 17.2, "荻窪": 18.6, "西荻窪": 20.6, "吉祥寺": 22.5, "三鷹": 24.1,
        "武蔵境": 26.4, "東小金井": 28.2, "武蔵小金井": 29.9, "国分寺": 32.8,
        "西国分寺": 34.5, "国立": 36.4, "立川": 37.5, "日野": 41.4, "豊田": 44.2,
        "八王子": 47.4, "西八王子": 49.8, "高尾": 53.1,
    },
    # JR中央線(快速)。上と同じ線路なので営業キロも同じ。
    "11312": {
        "東京": 0, "神田": 1.3, "御茶ノ水": 2.6, "四ツ谷": 6.6, "新宿": 10.3,
        "中野": 14.7, "高円寺": 16.1, "阿佐ケ谷": 17.2, "荻窪": 18.6, "西荻窪": 20.6,
        "吉祥寺": 22.5, "三鷹": 24.1, "武蔵境": 26.4, "東小金井": 28.2,
        "武蔵小金井": 29.9, "国分寺": 32.8, "西国分寺": 34.5, "国立": 36.4,
        "立川": 37.5, "日野": 41.4, "豊田": 44.2, "八王子": 47.4, "西八王子": 49.8,
        "高尾": 53.1,
    },
    # 北総線(京成高砂からの累計)
    "99340": {
        "京成高砂": 0, "新柴又": 1.3, "矢切": 3.2, "北国分": 4.7, "秋山": 6.2,
        "東松戸": 7.5, "松飛台": 8.9, "大町": 10.4, "新鎌ヶ谷": 12.7, "西白井": 15.8,
        "白井": 17.8, "小室": 19.8, "千葉ニュータウン中央": 23.8, "印西牧の原": 28.5,
        "印旛日本医大": 32.3,
    },
}

# ---------------------------------------------------------------------------
# 路線ごとの公式営業キロ(その路線が持つ全区間の合計。支線を含む路線は合算)。
#
# 駅の緯度経度から求めた直線距離の合計は、線路の曲がりを拾えないため実際より短く出る。
# そこで路線ごとに 公式営業キロ ÷ 直線距離の合計 を補正係数として求め、network.json に埋める。
# 以前は全路線を一律1.04で補正していたが、実際に必要な係数は路線ごとに大きく違う
# (ゆりかもめ1.19・箱根登山1.28 に対し、有楽町線1.00・井の頭線0.99)。
#
# ★値を変えるときは必ず一次情報で裏を取ること。ここが狂うとその路線の全区間の運賃が狂う。
# ★路線内でも係数はばらつく(京成本線の都心部は1.2前後、郊外部は1.05前後)。
#   一律係数で吸収できるのは路線間の差までで、路線内のばらつきは残る。
# ---------------------------------------------------------------------------
DEFAULT_FACTOR = 1.04
FACTOR_MIN, FACTOR_MAX = 0.95, 1.45

LINE_KM = {
    # --- 都営交通(無料。運賃には効かないが所要時間の精度に効く) ---
    "99301": 40.7,   # 都営大江戸線 都庁前〜光が丘12.9 + 環状部27.8
    "99302": 18.3,   # 都営浅草線 西馬込〜押上
    "99303": 26.5,   # 都営三田線 目黒〜西高島平
    "99304": 23.5,   # 都営新宿線 新宿〜本八幡
    "99305": 12.2,   # 都電荒川線 三ノ輪橋〜早稲田
    "99342": 9.7,    # 日暮里・舎人ライナー 日暮里〜見沼代親水公園

    # --- 東京メトロ ---
    "28001": 14.3,   # 銀座線 浅草〜渋谷
    "28002": 27.4,   # 丸ノ内線 池袋〜荻窪24.2 + 中野坂上〜方南町3.2
    "28003": 20.3,   # 日比谷線 北千住〜中目黒
    "28004": 30.8,   # 東西線 中野〜西船橋
    "28005": 24.0,   # 千代田線 代々木上原〜綾瀬21.9 + 綾瀬〜北綾瀬2.1
    "28006": 28.3,   # 有楽町線 和光市〜新木場
    "28008": 16.8,   # 半蔵門線 渋谷〜押上
    "28009": 21.3,   # 南北線 目黒〜赤羽岩淵
    "28010": 20.2,   # 副都心線 和光市〜渋谷

    # --- JR東日本(運転系統ごとの営業キロ) ---
    "11302": 34.5,   # 山手線(環状)
    "11312": 53.1,   # 中央線快速 東京〜高尾
    "11313": 60.7,   # 中央・総武線 三鷹〜千葉
    "11332": 59.1,   # 京浜東北線 大宮〜東京30.3 + 東京〜横浜28.8
    "11320": 39.6,   # 常磐線 上野〜取手
    "11321": 36.9,   # 埼京線 大崎〜大宮
    "11305": 71.8,   # 武蔵野線 府中本町〜西船橋
    "11306": 42.6,   # 横浜線 東神奈川〜八王子
    "11307": 22.1,   # 根岸線 横浜〜大船
    "11308": 73.3,   # 横須賀線 東京〜久里浜
    "11303": 39.6,   # 南武線 川崎〜立川35.5 + 尻手〜浜川崎4.1
    "11315": 37.2,   # 青梅線 立川〜奥多摩
    "11316": 11.1,   # 五日市線 拝島〜武蔵五日市
    "11322": 30.6,   # 川越線 大宮〜高麗川
    "11301": 104.6,  # 東海道本線 東京〜熱海
    "11343": 3.6,    # 上野東京ライン 東京〜上野

    # --- 京成グループ ---
    "23001": 76.4,   # 京成本線 京成上野〜成田空港69.3 + 東成田線7.1
    "23002": 6.9,    # 京成押上線 押上〜青砥5.7 + 青砥〜京成高砂1.2(本線)
    "23003": 2.5,    # 京成金町線 京成高砂〜金町
    "23004": 12.9,   # 京成千葉線 京成津田沼〜千葉中央
    "23005": 10.9,   # 京成千原線 千葉中央〜ちはら台
    "99329": 26.5,   # 京成松戸線 京成津田沼〜松戸
    "99340": 32.3,   # 北総線 京成高砂〜印旛日本医大

    # --- 京急 ---
    "27001": 56.7,   # 京急本線 泉岳寺〜浦賀
    "27002": 6.5,    # 京急空港線 京急蒲田〜羽田空港第1・第2ターミナル
    "27003": 4.5,    # 京急大師線 京急川崎〜小島新田
    "27004": 5.9,    # 京急逗子線 金沢八景〜逗子・葉山
    "27005": 13.4,   # 京急久里浜線 堀ノ内〜三崎口

    # --- 京王 ---
    "24001": 37.9,   # 京王線 新宿〜京王八王子
    "24002": 22.6,   # 京王相模原線 調布〜橋本
    "24003": 8.6,    # 京王高尾線 北野〜高尾山口
    "24006": 12.7,   # 京王井の頭線 渋谷〜吉祥寺
    "24007": 3.6,    # 京王新線 新宿〜笹塚

    # --- 東急 ---
    "26001": 24.2,   # 東急東横線 渋谷〜横浜
    "26002": 11.9,   # 東急目黒線 目黒〜日吉
    "26003": 31.5,   # 東急田園都市線 渋谷〜中央林間
    "26004": 12.4,   # 東急大井町線 大井町〜溝の口
    "26005": 10.9,   # 東急池上線 五反田〜蒲田
    "26006": 5.6,    # 東急多摩川線 多摩川〜蒲田
    "26007": 5.0,    # 東急世田谷線 三軒茶屋〜下高井戸
    "26009": 5.8,    # 東急新横浜線 日吉〜新横浜
    "99310": 4.1,    # みなとみらい線 横浜〜元町・中華街

    # --- 小田急 ---
    "25001": 82.5,   # 小田急小田原線 新宿〜小田原
    "25002": 27.6,   # 小田急江ノ島線 相模大野〜片瀬江ノ島
    "25003": 10.6,   # 小田急多摩線 新百合ヶ丘〜唐木田

    # --- 東武 ---
    "21001": 75.0,   # 東武東上線 池袋〜寄居
    "21002": 114.5,  # 東武伊勢崎線 浅草〜伊勢崎
    "21003": 94.5,   # 東武日光線 東武動物公園〜東武日光
    "21004": 62.7,   # 東武アーバンパークライン 大宮〜船橋
    "21005": 3.4,    # 東武亀戸線 曳舟〜亀戸
    "21007": 10.9,   # 東武越生線 坂戸〜越生

    # --- 西武 ---
    "22001": 57.8,   # 西武池袋線 池袋〜吾野
    "22003": 2.6,    # 西武有楽町線 小竹向原〜練馬
    "22007": 47.5,   # 西武新宿線 西武新宿〜本川越
    "22008": 14.3,   # 西武拝島線 小平〜拝島
    "22010": 7.8,    # 西武国分寺線 国分寺〜東村山
    "22011": 9.2,    # 西武多摩湖線 国分寺〜多摩湖
    "22012": 8.0,    # 西武多摩川線 武蔵境〜是政

    # --- 相鉄 ---
    "29001": 24.6,   # 相鉄本線 横浜〜海老名
    "29002": 11.3,   # 相鉄いずみ野線 二俣川〜湘南台
    "29004": 6.3,    # 相鉄新横浜線 西谷〜新横浜

    # --- その他(都営線と接続するもの・都心で使われるもの) ---
    "99309": 58.3,   # つくばエクスプレス 秋葉原〜つくば
    "99337": 12.2,   # りんかい線 新木場〜大崎
    "99311": 14.7,   # ゆりかもめ 新橋〜豊洲(レインボーブリッジの周回で直線距離と大きく違う)
    "99336": 17.8,   # 東京モノレール 浜松町〜羽田空港第2ターミナル
    "99338": 16.2,   # 東葉高速線 西船橋〜東葉勝田台
    "99307": 14.6,   # 埼玉高速鉄道線 赤羽岩淵〜浦和美園
    "99316": 40.4,   # 横浜市営ブルーライン 湘南台〜あざみ野
    "99343": 13.0,   # 横浜市営グリーンライン 中山〜日吉
    "99334": 16.0,   # 多摩モノレール 上北台〜多摩センター
    "99317": 10.8,   # 金沢シーサイドライン 新杉田〜金沢八景
    "99320": 10.0,   # 江ノ島電鉄線 藤沢〜鎌倉
    "99321": 12.7,   # ニューシャトル 大宮〜内宿
    "99326": 6.6,    # 湘南モノレール 大船〜湘南江の島
    # 箱根登山鉄道鉄道線 小田原〜強羅(営業キロ程表 2022年10月1日改定)。
    # 急勾配・スイッチバックで直線距離よりかなり長く、精度に大きく効く。
    # 未指定だと「その他」事業者の中央値(直線距離の近い他路線)に引きずられ、
    # 強羅→小田原が710円→670円のように実際よりさらに安く出ていた(2026-08-28に発見)。
    "99339": 15.0,
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
    "jr": "JR東日本", "metro": "東京メトロ", "keisei": "京成電鉄",
    "keisei_matsudo": "京成松戸線", "keikyu": "京急電鉄",
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
    if line_cd in LINE_OPERATOR:
        return LINE_OPERATOR[line_cd]
    if company_cd == FREE_COMPANY:
        return "toei"
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


def name_variants(group, line, station_g):
    """駅名の表記ゆれを吸収する。

    駅データ側は「押上（スカイツリー前）」のように括弧書きが付くことがあり、
    運賃表の「押上」と一致しない。路線ごとの駅名(labels)も候補に入れる。
    """
    out = []
    label = (line.get("labels") or {}).get(str(station_g))
    if label:
        out.append(label)
    out.append(group["name"])
    out.extend(sorted(group["names"]))
    def normalize(n):
        return n.replace("１", "1").replace("２", "2").replace("３", "3")

    seen, res = set(), []
    for n in out:
        base = [n, re.sub(r"[（(].*", "", n)]
        for v in base + [normalize(b) for b in base]:
            v = v.strip()
            if v and v not in seen:
                seen.add(v)
                res.append(v)
    return res


def fix_skip_edges(lines_out, groups, exact_edges=frozenset()):
    """途中駅を飛ばしている辺の距離を、実際の線路に沿った距離に直す。

    駅データ.jp の「路線」は線路そのものではなく運転系統なので、特急や快速の
    停車駅だけを結んだ路線が混じっている。その辺の長さは端から端までの直線距離に
    なるため、飛ばした駅を経由する実際の線路よりずっと短くなり、運賃が安く出る。

      JR中央本線(東京〜塩尻)の 東京〜四ツ谷 … 直線3.4km / 実際の線路は6.6km
      成田スカイアクセス線の 日暮里〜青砥   … 直線7.9km / 実際の線路は9.4km

    同じ事業者の別路線をたどって途中駅を経由できるなら、その道のりが実際の線路に
    あたるので、そちらの距離を採用する。距離は長くなる方向にしか動かないので、
    誤って当てはまっても運賃が安く出ることはない。

    2回まわすのは、飛ばし辺どうしが重なっている場合に1回では直りきらないため。
    """
    import heapq

    pos = {int(g): (st["lat"], st["lon"]) for g, st in groups.items()}
    index = {}   # (路線id, 辺の番号) -> 現在の営業キロ
    for l in lines_out:
        for e in range(len(l["edges"])):
            index[(l["id"], e)] = l["km"][e]

    fixed, skipped = [], []
    for _ in range(2):
        adj = {}
        for l in lines_out:
            for e, (i, j) in enumerate(l["edges"]):
                a, b = l["stations"][i], l["stations"][j]
                km = index[(l["id"], e)]
                adj.setdefault(a, []).append((b, km, l["id"], l["op"]))
                adj.setdefault(b, []).append((a, km, l["id"], l["op"]))

        changed = False
        for l in lines_out:
            for e, (i, j) in enumerate(l["edges"]):
                a, b = l["stations"][i], l["stations"][j]
                if (l["id"], e) in exact_edges:
                    continue  # 公式の駅間キロがある辺は動かさない
                direct = index[(l["id"], e)]
                straight = haversine(pos[a][0], pos[a][1], pos[b][0], pos[b][1]) / 1000
                if straight < 1.5:
                    continue  # 短い辺は駅を飛ばしようがない
                # 探すのは2.5倍まで。ただし実際に直すのは1.5倍まで。
                # これを超える差が要る辺は、線路の実態ではなく単なる遠回りを拾っている
                # 可能性が高い(横須賀線の 横浜〜新川崎 は京浜東北線と南武線を経由する
                # 別経路20.7kmを拾って倍近くに伸びていた)。
                # 直さずに一覧で知らせるので、EDGE_KM に公式の営業キロを入れて対処する。
                limit = direct * 2.5
                best, hops, heap = {a: 0.0}, {a: 0}, [(0.0, a)]
                while heap:
                    d, cur = heapq.heappop(heap)
                    if cur == b or d > limit:
                        break
                    if d > best.get(cur, 1e9):
                        continue
                    for to, km, lid, op in adj.get(cur, []):
                        if lid == l["id"] or op != l["op"]:
                            continue
                        # a と b を直接つなぐ辺は使わない。同じ区間の飛ばし辺が
                        # 別の路線にもあると(中央本線と中央線快速の 四ツ谷〜新宿)、
                        # それが「回り道」として見つかって互いに庇い合ってしまう。
                        if (cur == a and to == b) or (cur == b and to == a):
                            continue
                        nd = d + km
                        if nd < best.get(to, 1e9) and nd <= limit:
                            best[to] = nd
                            hops[to] = hops[cur] + 1
                            heapq.heappush(heap, (nd, to))
                alt = best.get(b)
                if alt is None or hops.get(b, 0) < 2 or alt <= direct * 1.02:
                    continue
                if alt > direct * 1.5:
                    skipped.append((l["name"], groups[str(a)]["name"],
                                    groups[str(b)]["name"], direct, alt))
                    continue
                index[(l["id"], e)] = round(alt, 2)
                changed = True
                fixed.append((l["name"], groups[str(a)]["name"], groups[str(b)]["name"],
                              direct, alt, hops[b] - 1))
        if not changed:
            break

    for l in lines_out:
        l["km"] = [index[(l["id"], e)] for e in range(len(l["edges"]))]

    if skipped:
        uniq = {(n, a, b): (d, alt) for n, a, b, d, alt in skipped}
        skipped = [(n, a, b, d, alt) for (n, a, b), (d, alt) in uniq.items()]
        log("注意: 途中駅を飛ばしている可能性があるが、差が大きすぎて自動では直せない辺 %d本"
            "(公式の営業キロを EDGE_KM に入れてください)" % len(skipped))
        for name, a, b, d, alt in sorted(skipped, key=lambda x: -(x[4] - x[3]))[:8]:
            log("    %s %s〜%s  この辺%.1fkm / 別経路だと%.1fkm" % (name, a, b, d, alt))
    if fixed:
        # 同じ辺を2回直したときは後の値だけ残す
        last = {}
        for name, a, b, d, alt, mid in fixed:
            key = (name, a, b)
            last[key] = (last[key][0] if key in last else d, alt, mid)
        log("途中駅を飛ばしていた辺 %d本の距離を線路に沿った値に直しました" % len(last))
        for (name, a, b), (d, alt, mid) in sorted(last.items(), key=lambda kv: -(kv[1][1] - kv[1][0]))[:8]:
            log("    %s %s〜%s  %.1fkm → %.1fkm (途中%d駅)" % (name, a, b, d, alt, mid))


def attach_factors(lines_out, groups):
    """路線ごとの距離補正係数を求めて各路線に付ける。

    f = 公式営業キロ ÷ 直線距離の合計。
    公式キロを持たない路線は、同じ事業者の中央値を使う(路線の性格が近いため)。
    事業者にも実績がなければ全体の既定値に落とす。
    """
    straight = {}
    for l in lines_out:
        total = 0.0
        for i, j in l["edges"]:
            a, b = groups[str(l["stations"][i])], groups[str(l["stations"][j])]
            total += haversine(a["lat"], a["lon"], b["lat"], b["lon"])
        straight[l["id"]] = total / 1000.0

    # 公式キロがある路線の係数を先に求める
    known, by_op = {}, {}
    for l in lines_out:
        km = LINE_KM.get(str(l["id"]))
        if km is None or straight[l["id"]] <= 0:
            continue
        f = km / straight[l["id"]]
        if not (FACTOR_MIN <= f <= FACTOR_MAX):
            # 公式キロの入力ミスか、駅データ側の路線の取り方が想定と違う合図。
            # 黙って通すとその路線の全区間の運賃が狂うため必ず知らせる。
            log("警告: %s の補正係数が %.3f (直線%.2fkm / 公式%.1fkm)。"
                "公式キロか路線の範囲を確認してください" % (l["name"], f, straight[l["id"]], km))
            f = min(max(f, FACTOR_MIN), FACTOR_MAX)
        known[l["id"]] = f
        by_op.setdefault(l["op"], []).append(f)

    def median(xs):
        xs = sorted(xs)
        n = len(xs)
        return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2

    op_median = {op: median(v) for op, v in by_op.items()}
    overall = median(list(known.values())) if known else DEFAULT_FACTOR

    guessed = []
    for l in lines_out:
        if l["id"] in known:
            l["f"] = round(known[l["id"]], 3)
        else:
            f = op_median.get(l["op"], overall)
            l["f"] = round(f, 3)
            guessed.append(l)

    # まず全路線の各辺に、係数で伸ばした営業キロの推定値を入れる
    for l in lines_out:
        arr = []
        for i, j in l["edges"]:
            a, b = groups[str(l["stations"][i])], groups[str(l["stations"][j])]
            m = haversine(a["lat"], a["lon"], b["lat"], b["lon"])
            arr.append(round(m / 1000 * l["f"], 2))
        l["km"] = arr

    # 公式の駅間キロがある路線は、推定値を上書きする
    exact_lines = 0
    exact_edges = set()
    for l in lines_out:
        cum = EDGE_KM.get(str(l["id"]))
        if not cum:
            continue
        km_of = {}
        for g in l["stations"]:
            for name in name_variants(groups[str(g)], l, g):
                if name in cum:
                    km_of[g] = cum[name]
                    break
        if not km_of:
            log("警告: %s の公式キロ程が1駅も駅データと一致しません。駅名を確認してください"
                % l["name"])
            continue
        # 表は路線の一部だけでもよい。載っていない駅の前後は推定値のまま残す。
        missing = [groups[str(g)]["name"] for g in l["stations"] if g not in km_of]
        if missing and len(missing) <= 5:
            log("    %s: 公式キロ程に無い駅 %s (この駅の前後は推定値)"
                % (l["name"], "・".join(missing)))
        for e, (i, j) in enumerate(l["edges"]):
            a, b = l["stations"][i], l["stations"][j]
            if a in km_of and b in km_of:
                l["km"][e] = round(abs(km_of[a] - km_of[b]), 2)
                exact_edges.add((l["id"], e))
        exact_lines += 1
    if exact_lines:
        log("公式の駅間キロを使った路線: %d (辺 %d本)" % (exact_lines, len(exact_edges)))

    log("距離補正: 公式キロあり %d路線 / 事業者の中央値で補った %d路線 (全体の中央値 %.3f)"
        % (len(known), len(guessed), overall))
    return exact_edges


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

    exact_edges = attach_factors(lines_out, groups)
    fix_skip_edges(lines_out, groups, exact_edges)

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
