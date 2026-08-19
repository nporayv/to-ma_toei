// 経路探索エンジン
//
// 考え方:
//   都営交通(都営地下鉄・都電荒川線・日暮里舎人ライナー)は無料乗車券で運賃0円。
//   それ以外の会社は「その会社に乗った距離」ごとに運賃がかかる。
//   したがって最安経路とは「他社線に乗る距離と会社数をできるだけ減らし、
//   残りを都営線でまかなう経路」になる。
//
//   運賃は会社ごとの通し計算なので、1本のedgeに値段を割り振ることができない。
//   そこで「駅・現在の事業者・その事業者で乗った距離」を状態とするラベル法
//   (多目的ダイクストラ)で探索し、運賃と所要時間のパレート最適な経路を集める。

const TRANSFER_MIN = 5;      // 同一駅での乗換にかかる時間(分)
const THROUGH_MIN = 1;       // 直通運転で会社が変わるだけの場合(分)
const WALK_SPEED = 80;       // 徒歩speed(m/分)
const WALK_EXTRA = 3;        // 改札の出入りなど(分)
const MAX_LABELS = 10;       // 1状態あたりに保持するラベル数の上限
const TIME_SLACK = 60;       // 最速経路からこれ以上遅い経路は捨てる(分)

// 相互直通運転している路線の組(乗り換え不要)
const THROUGH_PAIRS = new Set([
  // 都営線の直通
  "23002-99302", "23006-99302", "27001-99302", "99302-99340",
  "26002-99303", "24001-99304", "24007-99304",
  // 東京メトロの直通
  "21002-28003", "11313-28004", "11320-28005", "25001-28005",
  "21001-28006", "22001-28006", "22003-28006", "28006-99338",
  "21001-28010", "22001-28010", "22003-28010", "26001-28010", "28010-99310",
  "21002-28008", "26003-28008",
  "26002-28009", "28009-99307", "28009-29003",
  "26001-29003", "11321-99337"
]);

function throughKey(a, b) {
  return a < b ? a + "-" + b : b + "-" + a;
}

// 改札を出る・地上を歩くなど、負担の大きい乗換。
// 駅データには乗換の難易度が入っていないため、都営線がらみの主なものを手で持つ。
// 利用者に移動の困難がある前提のサービスなので、単に時間を足すだけでなく画面にも出す。
// キー: 駅グループID|小さい方の路線ID|大きい方の路線ID
const HARD_TRANSFERS = {
  // 浅草線と大江戸線の蔵前は入口がまったく別の駅舎。時間がかかるだけでなく、
  // 案内表示が乏しく道に迷いやすい。初めての人には事前に伝える必要がある。
  "9930112|99301|99302": { min: 9, note: "別の駅舎です。改札を出て地上を約200m歩きます(迷いやすいので注意)" },
  // 上野御徒町(大江戸線)と御徒町(JR)も改札外。地上を渡る。
  "1130221|11302|99301": { min: 8, note: "改札を出て地上を歩きます" },
  "1130221|11332|99301": { min: 8, note: "改札を出て地上を歩きます" },
  // 三越前(銀座線・半蔵門線)と新日本橋(JR総武快速)は地下通路が長い。
  "1131402|11314|28001": { min: 8, note: "地下通路を長く歩きます" },
  "1131402|11314|28008": { min: 8, note: "地下通路を長く歩きます" }
};

function hardTransfer(stationId, lineA, lineB) {
  const a = String(lineA), b = String(lineB);
  const key = stationId + "|" + (a < b ? a + "|" + b : b + "|" + a);
  return HARD_TRANSFERS[key] || null;
}

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].pri <= a[i].pri) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].pri < a[m].pri) m = l;
        if (r < a.length && a[r].pri < a[m].pri) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

class Network {
  constructor(raw) {
    this.raw = raw;
    this.operators = raw.operators;

    this.stations = new Map();
    for (const [id, name, lat, lon, aliases] of raw.stations) {
      this.stations.set(id, { id, name, lat, lon, aliases, lines: [] });
    }

    this.lines = new Map();
    for (const l of raw.lines) {
      this.lines.set(l.id, l);
      for (const s of l.stations) {
        const st = this.stations.get(s);
        if (st && !st.lines.includes(l.id)) st.lines.push(l.id);
      }
    }

    // 隣接リスト
    this.adj = new Map();
    for (const id of this.stations.keys()) this.adj.set(id, []);

    // 隣接関係は駅データ.jpの join データ由来。単なる並び順ではないので、
    // 分岐(例: 鶴見線)や環状線の閉じ方(山手線・大江戸線)も正しく表現される。
    for (const l of raw.lines) {
      for (const [i, j] of l.edges) {
        const a = l.stations[i], b = l.stations[j];
        const sa = this.stations.get(a), sb = this.stations.get(b);
        if (!sa || !sb) continue;
        const m = haversineM(sa.lat, sa.lon, sb.lat, sb.lon);
        const min = Math.max(1.5, (m / 1000) * 2.0);
        this.adj.get(a).push({ to: b, line: l.id, meters: m, min, walk: false });
        this.adj.get(b).push({ to: a, line: l.id, meters: m, min, walk: false });
      }
    }
    for (const [a, b, m] of raw.walk) {
      if (!this.adj.has(a) || !this.adj.has(b)) continue;
      const min = m / WALK_SPEED + WALK_EXTRA;
      this.adj.get(a).push({ to: b, line: null, meters: m, min, walk: true });
      this.adj.get(b).push({ to: a, line: null, meters: m, min, walk: true });
    }

    // 無料になる路線・駅
    this.freeLines = new Set(
      raw.lines.filter((l) => this.operators[l.op] && this.operators[l.op].free).map((l) => l.id)
    );
    this.freeStations = new Set();
    for (const l of raw.lines) {
      if (this.freeLines.has(l.id)) l.stations.forEach((s) => this.freeStations.add(s));
    }

    // 名前検索用の索引
    this.index = [];
    for (const st of this.stations.values()) {
      this.index.push({ id: st.id, key: st.name, station: st });
      for (const a of st.aliases) this.index.push({ id: st.id, key: a, station: st });
    }
  }

  opOf(lineId) {
    const l = this.lines.get(lineId);
    return l ? l.op : "other";
  }

  // その路線での駅名を返す。乗換駅は路線ごとに駅名が違うことがあるため
  // (例: 東日本橋=浅草線 / 馬喰横山=新宿線 / 馬喰町=JR)。
  labelOf(stationId, lineId) {
    const l = this.lines.get(lineId);
    const over = l && l.labels && l.labels[stationId];
    return over || (this.stations.get(stationId) || {}).name || "";
  }
  isFreeOp(op) {
    return !!(this.operators[op] && this.operators[op].free);
  }

  search(query, limit = 12) {
    const q = normalize(query);
    if (!q) return [];
    const hits = new Map();
    for (const e of this.index) {
      const k = normalize(e.key);
      let score = -1;
      if (k === q) score = 0;
      else if (k.startsWith(q)) score = 1;
      else if (k.includes(q)) score = 2;
      if (score < 0) continue;
      const prev = hits.get(e.id);
      if (!prev || score < prev.score) {
        hits.set(e.id, { score, station: e.station, matched: e.key });
      }
    }
    return [...hits.values()]
      .sort((a, b) => a.score - b.score
        || (this.freeStations.has(b.station.id) ? 1 : 0) - (this.freeStations.has(a.station.id) ? 1 : 0)
        || b.station.lines.length - a.station.lines.length)
      .slice(0, limit);
  }
}

function normalize(s) {
  return (s || "")
    .trim()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[ｹケ]/g, "ヶ")
    .replace(/駅$/, "")
    .toLowerCase();
}

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const p1 = (lat1 * Math.PI) / 180, p2 = (lat2 * Math.PI) / 180;
  const dp = p2 - p1, dl = ((lon2 - lon1) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// --- 最速経路(所要時間のみのダイクストラ)。運賃比較の基準に使う。 ----------
function searchFastest(net, from, to) {
  const best = new Map([[from, 0]]);
  const prev = new Map();
  const heap = new MinHeap();
  heap.push({ pri: 0, st: from, line: null });
  while (heap.size) {
    const cur = heap.pop();
    if (cur.pri > (best.get(cur.st) ?? Infinity)) continue;
    if (cur.st === to) break;
    for (const e of net.adj.get(cur.st) || []) {
      let t = cur.pri + e.min;
      if (cur.line !== null && e.line !== cur.line && !e.walk) {
        t += THROUGH_PAIRS.has(throughKey(String(cur.line), String(e.line))) ? THROUGH_MIN : TRANSFER_MIN;
      }
      if (t < (best.get(e.to) ?? Infinity)) {
        best.set(e.to, t);
        prev.set(e.to, { from: cur.st, line: e.line, meters: e.meters, walk: e.walk });
        heap.push({ pri: t, st: e.to, line: e.walk ? null : e.line });
      }
    }
  }
  if (!best.has(to)) return null;
  return { steps: rebuild(prev, from, to), time: best.get(to) };
}

function rebuild(prev, from, to) {
  const steps = [];
  let cur = to;
  while (cur !== from) {
    const p = prev.get(cur);
    if (!p) return null;
    steps.push({ from: p.from, to: cur, line: p.line, meters: p.meters, walk: p.walk });
    cur = p.from;
  }
  return steps.reverse();
}

// --- 運賃を考慮した多目的探索 ---------------------------------------------
// 状態: (駅, いま乗っている事業者, その事業者で乗った距離)
// ラベル: 確定済み運賃 paid / 現事業者の距離 segM / 所要時間 time
function searchByFare(net, from, to, opts, timeLimit) {
  const start = { st: from, op: null, segM: 0, paid: 0, time: 0, line: null, prev: null, step: null };
  const pool = new Map();  // "駅|事業者" -> ラベル配列(非劣解のみ)
  const results = [];
  const heap = new MinHeap();

  const costOf = (lb) => lb.paid + (lb.op ? fareForSegment(lb.op, toFareKm(lb.segM), {
    free: net.isFreeOp(lb.op), kind: opts.kind, companion: opts.companion
  }).actual : 0);

  // A*の下界: 目的駅までの直線距離から見積もる最短所要時間。
  // 実際の所要時間は 2.0分/km 以上かかるので 1.8分/km は必ず下回る(許容的)。
  const goal = net.stations.get(to);
  const hCache = new Map();
  const h = (id) => {
    let v = hCache.get(id);
    if (v === undefined) {
      const s = net.stations.get(id);
      v = (haversineM(s.lat, s.lon, goal.lat, goal.lon) / 1000) * 1.8;
      hCache.set(id, v);
    }
    return v;
  };

  // 見つかった最良値。運賃・時間ともに上回れないラベルは捨てる。
  let bestCost = Infinity, bestTime = Infinity;

  heap.push({ pri: 0, lb: start });

  while (heap.size) {
    const { lb } = heap.pop();
    if (lb.time > timeLimit) continue;

    if (lb.st === to) {
      const c = costOf(lb);
      results.push({ label: lb, cost: c, time: lb.time });
      bestCost = Math.min(bestCost, c);
      bestTime = Math.min(bestTime, lb.time);
      continue;
    }
    // 運賃でも時間でも既知の最良解を超えられないなら打ち切る
    if (costOf(lb) >= bestCost && lb.time + h(lb.st) >= bestTime) continue;

    for (const e of net.adj.get(lb.st) || []) {
      let paid = lb.paid, segM = lb.segM, op = lb.op, time = lb.time + e.min;

      if (e.walk) {
        // 別の駅へ歩くので、いまの事業者の運賃はここで確定する
        if (op) paid += fareForSegment(op, toFareKm(segM), {
          free: net.isFreeOp(op), kind: opts.kind, companion: opts.companion
        }).actual;
        op = null; segM = 0;
      } else {
        const eop = net.opOf(e.line);
        if (lb.line !== null && e.line !== lb.line) {
          time += THROUGH_PAIRS.has(throughKey(String(lb.line), String(e.line))) ? THROUGH_MIN : TRANSFER_MIN;
        }
        if (op === eop) {
          segM += e.meters;                       // 同じ会社に乗り続ける
        } else {
          if (op) paid += fareForSegment(op, toFareKm(segM), {
            free: net.isFreeOp(op), kind: opts.kind, companion: opts.companion
          }).actual;
          op = eop; segM = e.meters;              // 会社が変わる=運賃が切り替わる
        }
      }
      const lower = h(e.to);
      if (time + lower > timeLimit) continue;

      const next = {
        st: e.to, op, segM, paid, time,
        line: e.walk ? null : e.line, prev: lb,
        step: { from: lb.st, to: e.to, line: e.line, meters: e.meters, walk: e.walk }
      };
      const cost = costOf(next);
      if (cost >= bestCost && time + lower >= bestTime) continue;

      const key = e.to + "|" + (op || "-");
      const list = pool.get(key) || [];
      // 支払済み運賃・区間距離・時間のすべてで劣るラベルは捨てる
      if (list.some((o) => o.paid <= paid && o.segM <= segM && o.time <= time)) continue;
      const kept = list.filter((o) => !(paid <= o.paid && segM <= o.segM && time <= o.time));
      kept.push({ paid, segM, time });
      kept.sort((a, b) => a.paid - b.paid || a.time - b.time);
      pool.set(key, kept.slice(0, MAX_LABELS));

      heap.push({ pri: cost * 1000 + time + lower, lb: next });
    }
  }

  // 運賃と所要時間のパレート最適解だけを残す
  results.sort((a, b) => a.cost - b.cost || a.time - b.time);
  const front = [];
  let fastestSoFar = Infinity;
  for (const r of results) {
    if (r.time < fastestSoFar - 0.01) { front.push(r); fastestSoFar = r.time; }
  }
  return front.map((r) => collectSteps(r.label));
}

function collectSteps(label) {
  const steps = [];
  for (let l = label; l && l.step; l = l.prev) steps.push(l.step);
  return steps.reverse();
}

// --- 経路の評価(運賃・区間の組み立て) -------------------------------------
function evaluateRoute(net, steps, opts) {
  if (!steps || !steps.length) return null;

  // 1) 同じ路線の連続をひとつの「区間(leg)」にまとめる
  const legs = [];
  for (const s of steps) {
    const last = legs[legs.length - 1];
    if (last && !s.walk && !last.walk && last.line === s.line) {
      last.path.push(s.to); last.meters += s.meters;
    } else {
      legs.push({ walk: s.walk, line: s.line, path: [s.from, s.to], meters: s.meters });
    }
  }

  // 2) 事業者ごとの通し運賃を計算する
  let fareGroups = [];
  for (const leg of legs) {
    leg.op = leg.walk ? null : net.opOf(leg.line);
    const g = fareGroups[fareGroups.length - 1];
    if (!leg.walk && g && g.op === leg.op) { g.meters += leg.meters; g.legs.push(leg); }
    else if (!leg.walk) fareGroups.push({ op: leg.op, meters: leg.meters, legs: [leg] });
    else fareGroups.push({ op: null, meters: leg.meters, legs: [leg], walk: true });
  }
  for (const g of fareGroups) {
    if (g.walk) { g.regular = 0; g.actual = 0; continue; }
    const f = fareForSegment(g.op, toFareKm(g.meters), {
      free: net.isFreeOp(g.op), kind: opts.kind, companion: opts.companion
    });
    g.regular = f.regular; g.actual = f.actual; g.note = f.note;
    g.free = net.isFreeOp(g.op);
    g.legs.forEach((l) => { l.group = g; });
  }

  // 3) 所要時間・乗換回数。負担の大きい乗換はここで印をつける。
  let time = 0, transfers = 0, prevLine = null;
  const notes = [];
  for (const s of steps) {
    time += s.walk ? s.meters / WALK_SPEED + WALK_EXTRA : Math.max(1.5, (s.meters / 1000) * 2.0);
    if (!s.walk && prevLine !== null && s.line !== prevLine) {
      const th = THROUGH_PAIRS.has(throughKey(String(prevLine), String(s.line)));
      const hard = hardTransfer(s.from, prevLine, s.line);
      time += hard ? hard.min : (th ? THROUGH_MIN : TRANSFER_MIN);
      if (!th) transfers++;
      if (hard) notes.push({ station: s.from, line: s.line, note: hard.note });
    }
    if (s.walk) { transfers++; prevLine = null; } else prevLine = s.line;
  }

  // 4) 都営線の出入口を特定する(このサービスの中心的な情報)
  const freeLegs = legs.filter((l) => !l.walk && l.group && l.group.free);
  const usesFree = freeLegs.length > 0;

  return {
    legs, fareGroups,
    totalRegular: fareGroups.reduce((a, g) => a + g.regular, 0),
    totalActual: fareGroups.reduce((a, g) => a + g.actual, 0),
    time: Math.round(time),
    transfers,
    hardTransfers: notes,
    usesFree,
    freeEntry: usesFree ? freeLegs[0].path[0] : null,
    freeEntryLine: usesFree ? freeLegs[0].line : null,
    freeExit: usesFree ? freeLegs[freeLegs.length - 1].path.slice(-1)[0] : null,
    freeExitLine: usesFree ? freeLegs[freeLegs.length - 1].line : null,
    stationCount: steps.filter((s) => !s.walk).length
  };
}

/**
 * 経路を検索する。
 * @returns {{options:Array, fastest:Object, best:Object}}
 */
function planRoutes(net, from, to, opts) {
  if (from === to) return { options: [], fastest: null, best: null, same: true };

  const fast = searchFastest(net, from, to);
  if (!fast) return { options: [], fastest: null, best: null, unreachable: true };

  const fastest = evaluateRoute(net, fast.steps, opts);
  const raw = searchByFare(net, from, to, opts, fast.time + TIME_SLACK);

  const options = [];
  const seen = new Set();
  for (const steps of raw.concat([fast.steps])) {
    const ev = evaluateRoute(net, steps, opts);
    if (!ev) continue;
    const key = ev.legs.map((l) => l.line + ":" + l.path[0] + ">" + l.path.slice(-1)[0]).join("/");
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(ev);
  }
  options.sort((a, b) => a.totalActual - b.totalActual || a.time - b.time);

  // 運賃・時間ともに他に劣る案は表示しない
  const shown = [];
  let bt = Infinity;
  for (const o of options) {
    if (o.time < bt - 0.5) { shown.push(o); bt = o.time; }
  }
  return { options: shown.slice(0, 4), fastest, best: shown[0] || null };
}
