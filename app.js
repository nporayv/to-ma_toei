// 画面の組み立てと操作

const OP_COLORS = {
  jr: "#2f8f4e", metro: "#0f9bd7", keisei: "#005aaa", keikyu: "#e5171f",
  tokyu: "#da0442", keio: "#c8107e", odakyu: "#0071bc", tobu: "#0f6cbd",
  seibu: "#1c6bb0", sotetsu: "#0a2f6b", tx: "#1155a8", rinkai: "#0075c2",
  yurikamome: "#0a72b5", monorail: "#0068b7", hokuso: "#1f4f9c",
  shinkeisei: "#c8102e", toyo: "#0f76bc", saitama: "#00a0c6",
  yokohama: "#0b419b", tamamono: "#0075c2", mm: "#004098", other: "#6b7280"
};

let net = null;
let selected = { from: null, to: null };

const $ = (id) => document.getElementById(id);
const resultEl = $("result");

// --- 端末に残しておく設定(表示色・よく使う駅・履歴) ------------------------
// すべて端末の中だけに保存する。外部には送らない。
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem("toei-" + key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem("toei-" + key, JSON.stringify(value)); } catch (e) { /* 無視 */ }
  }
};

const MAX_SAVED = 5;    // よく使う駅
const MAX_HISTORY = 10; // 検索履歴

// --- 見た目の切り替え ------------------------------------------------------
// 見た目は「意匠(デザイン)」と「表示色(明暗)」の2軸で決まる。
// 意匠はプルダウンで7種類、表示色はボタンで3種類から選ぶ。
// どちらも選んだものを端末に残し、次に開いたときも同じ見た目で出す。
// データ読み込みを待たずに効かせたいので、ここで先に設定する。
//
// 見え方の好みは人によって大きく違う。まぶしさが負担になる方、
// 輪郭がはっきりしないと読めない方、明朝でないと目が滑る方がいるため、
// 1つを正解として押しつけず、選べるようにしてある。
const SKINS = ["mincho", "sign", "ticket", "block", "map", "soft", "classic"];
const DEFAULT_SKIN = "mincho";
const THEMES = ["default", "light", "dark"];

(function setupLook() {
  // 意匠
  const applySkin = (skin) => {
    // 保存された値が壊れていたり、廃止した意匠名が残っていても既定に戻して動かす
    const use = SKINS.includes(skin) ? skin : DEFAULT_SKIN;
    document.documentElement.setAttribute("data-skin", use);
    const sel = $("skinSelect");
    if (sel) sel.value = use;
    return use;
  };
  // 読めない値が残っていたら、既定に戻した上で保存し直す(次回も同じ判定を繰り返さない)
  store.set("skin", applySkin(store.get("skin", DEFAULT_SKIN)));
  const sel = $("skinSelect");
  if (sel) {
    sel.addEventListener("change", () => { store.set("skin", applySkin(sel.value)); });
  }

  // 表示色
  const applyTheme = (mode) => {
    const use = THEMES.includes(mode) ? mode : "default";
    document.documentElement.setAttribute("data-theme", use);
    document.querySelectorAll("[data-theme-set]").forEach((b) => {
      b.setAttribute("aria-pressed", b.dataset.themeSet === use ? "true" : "false");
    });
    return use;
  };
  applyTheme(store.get("theme", "default"));
  document.querySelectorAll("[data-theme-set]").forEach((b) => {
    b.addEventListener("click", () => { store.set("theme", applyTheme(b.dataset.themeSet)); });
  });
})();

// --- 起動 -----------------------------------------------------------------
fetch("network.json")
  .then((r) => {
    if (!r.ok) throw new Error("network.json を読み込めません (HTTP " + r.status + ")");
    return r.json();
  })
  .then((raw) => {
    net = new Network(raw);
    setupAutocomplete($("fromInput"), $("fromList"), "from");
    setupAutocomplete($("toInput"), $("toList"), "to");
    document.querySelectorAll(".chip").forEach((c) => {
      c.addEventListener("click", () => runExample(c.dataset.from, c.dataset.to));
    });
    updateOptSummary();
    renderSaved();
    renderHistory();
    renderExamples();
    if (raw.generated) $("dataDate").textContent = raw.generated;

    // アプリのバージョンは sw.js の VERSION を真実の源としている
    // (更新するとキャッシュも入れ替わる仕組みのため、必ず1箇所に集約)
    fetch("./sw.js").then((r) => r.text()).then((t) => {
      const m = t.match(/const VERSION = "([^"]+)"/);
      if (m) $("appVersion").textContent = m[1];
    }).catch(() => {});
    applyUrlQuery();
  })
  .catch((e) => {
    resultEl.innerHTML = "";
    resultEl.appendChild(errorBox(
      "データを読み込めませんでした",
      e.message + " — index.html をローカルサーバー経由で開いてください(file:// では動きません)。"
    ));
  });

// --- 駅名の候補表示 -------------------------------------------------------
function setupAutocomplete(input, list, key) {
  let items = [];
  let active = -1;

  const close = () => {
    list.hidden = true;
    list.innerHTML = "";
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  };

  const choose = (i) => {
    const hit = items[i];
    if (!hit) return;
    selected[key] = hit.station;
    input.value = hit.station.name;
    close();
    input.dispatchEvent(new CustomEvent("station-chosen"));
  };

  const paint = () => {
    [...list.children].forEach((li, i) => {
      const on = i === active;
      li.setAttribute("aria-selected", on ? "true" : "false");
      li.classList.toggle("on", on);
      if (on) {
        input.setAttribute("aria-activedescendant", li.id);
        li.scrollIntoView({ block: "nearest" });
      }
    });
  };

  const open = () => {
    const hits = net.search(input.value);
    items = hits;
    list.innerHTML = "";
    if (!hits.length) {
      // 駅データに読み仮名が無いため、かなだけで打つと一致しない。
      // 黙って閉じると「壊れている」ように見えるので、何をすればよいか出す。
      if (isKanaOnly(input.value)) {
        const li = document.createElement("li");
        li.className = "ac-hint";
        li.textContent = "駅名は漢字で入力してください(例: しんじゅく → 新宿)";
        list.appendChild(li);
        list.hidden = false;
        input.setAttribute("aria-expanded", "true");
      } else {
        close();
      }
      return;
    }
    hits.forEach((hit, i) => {
      const li = document.createElement("li");
      li.id = key + "-opt-" + i;
      li.role = "option";
      li.setAttribute("aria-selected", "false");

      const nm = document.createElement("span");
      nm.className = "ac-name";
      nm.textContent = hit.station.name;
      li.appendChild(nm);

      if (net.freeStations.has(hit.station.id)) {
        const b = document.createElement("span");
        b.className = "badge free";
        b.textContent = "都営";
        li.appendChild(b);
      }

      const sub = document.createElement("span");
      sub.className = "ac-sub";
      sub.textContent = hit.station.lines
        .map((id) => (net.lines.get(id) || {}).name)
        .filter(Boolean).join("・");
      li.appendChild(sub);

      li.addEventListener("mousedown", (e) => { e.preventDefault(); choose(i); });
      list.appendChild(li);
    });
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    active = -1;
  };

  input.addEventListener("input", () => { selected[key] = null; open(); });
  input.addEventListener("focus", () => { if (input.value) open(); });
  input.addEventListener("blur", () => setTimeout(close, 120));
  input.addEventListener("keydown", (e) => {
    if (list.hidden && (e.key === "ArrowDown" || e.key === "ArrowUp")) { open(); return; }
    if (list.hidden) return;
    if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, items.length - 1); paint(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); paint(); }
    else if (e.key === "Enter") {
      if (active >= 0) { e.preventDefault(); choose(active); }
    } else if (e.key === "Escape") { close(); }
  });
}

// 括弧書き・記号を落とした比較用の駅名
function plainName(s) {
  return String(s).replace(/[〈〉（）()\[\]【】\s]/g, "");
}

function isKanaOnly(s) {
  return /^[぀-ゟ゠-ヿー\s]+$/.test((s || "").trim());
}

// 入力欄の文字から駅を決める(候補をクリックしていない場合の保険)
function resolve(key, input) {
  if (selected[key]) return selected[key];
  const hits = net.search(input.value, 1);
  if (hits.length) { selected[key] = hits[0].station; return hits[0].station; }
  return null;
}

// --- 操作 -----------------------------------------------------------------
$("swapBtn").addEventListener("click", () => {
  const a = $("fromInput"), b = $("toInput");
  [a.value, b.value] = [b.value, a.value];
  [selected.from, selected.to] = [selected.to, selected.from];
  a.focus();
});

document.querySelectorAll('input[name="kind"], #companion').forEach((el) => {
  el.addEventListener("change", updateOptSummary);
});

$("clearBtn").addEventListener("click", () => {
  $("fromInput").value = "";
  $("toInput").value = "";
  selected.from = selected.to = null;
  resultEl.innerHTML = "";
  history.replaceState(null, "", location.pathname);
  $("fromInput").focus();
});

$("reshuffleBtn").addEventListener("click", renderExamples);

$("histClearBtn").addEventListener("click", () => {
  store.set("history", []);
  renderHistory();
});

// 保存するのは出発駅だけ。到着駅は毎回変わるため、残しても選び直す手間が減らない。
$("starBtn").addEventListener("click", () => {
  const from = resolve("from", $("fromInput"));
  if (!from) {
    $("starBtn").textContent = "★ 先に出発駅を入れてください";
    setTimeout(() => { $("starBtn").textContent = "★ 出発駅を保存"; }, 1800);
    return;
  }
  addSavedStation(from.name);
  renderSaved();
  renderExamples();
  $("starBtn").textContent = "★ 保存しました";
  setTimeout(() => { $("starBtn").textContent = "★ 出発駅を保存"; }, 1800);
});

function currentOpts() {
  return {
    kind: document.querySelector('input[name="kind"]:checked').value,
    companion: $("companion").checked
  };
}

function updateOptSummary() {
  const o = currentOpts();
  $("optSummary").textContent =
    " (" + (o.kind === "type1" ? "第1種" : "第2種") + (o.companion ? "・介護者あり" : "") + ")";
}

function runExample(from, to) {
  $("fromInput").value = from;
  $("toInput").value = to;
  selected.from = selected.to = null;
  $("searchForm").requestSubmit();
}

// --- よく使う駅(最大5) -----------------------------------------------------
function savedStations() { return store.get("stations", []); }

function addSavedStation(name) {
  const list = savedStations().filter((n) => n !== name);
  list.unshift(name);
  store.set("stations", list.slice(0, MAX_SAVED));
}

function renderSaved() {
  const list = savedStations();
  for (const [boxId, inputId] of [["savedFrom", "fromInput"]]) {
    const box = $(boxId);
    box.hidden = list.length === 0;
    const wrap = box.querySelector(".saved-chips");
    wrap.innerHTML = "";
    for (const name of list) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip small";
      b.textContent = name;
      b.addEventListener("click", () => {
        $(inputId).value = name;
        selected[inputId === "fromInput" ? "from" : "to"] = null;
        $(inputId).focus();
      });
      wrap.appendChild(b);
    }
    // 保存を取り消せるようにしておく
    if (list.length) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "chip small ghost";
      del.textContent = "×消す";
      del.setAttribute("aria-label", "よく使う駅をすべて消す");
      del.addEventListener("click", () => { store.set("stations", []); renderSaved(); renderExamples(); });
      wrap.appendChild(del);
    }
  }
}

// --- 検索履歴(最大10) ------------------------------------------------------
function addHistory(fromName, toName) {
  const key = fromName + "→" + toName;
  const list = store.get("history", []).filter((h) => h.key !== key);
  list.unshift({ key, from: fromName, to: toName });
  store.set("history", list.slice(0, MAX_HISTORY));
  renderHistory();
}

function renderHistory() {
  const list = store.get("history", []);
  $("historySec").hidden = list.length === 0;
  const ul = $("historyList");
  ul.innerHTML = "";
  for (const h of list) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = h.from + " → " + h.to;
    // 押したらフォームに入れて、そのまま検索する
    b.addEventListener("click", () => runExample(h.from, h.to));
    li.appendChild(b);
    ul.appendChild(li);
  }
}

// --- 「ためしに」の例 ------------------------------------------------------
// 保存した駅があればそれを使う。無ければ固定の例を出す。
// この2駅はNPOの活動範囲に合わせたもので、変えたければここを直す。
const HOME_STATION = "青砥";
const HUB_STATION = "秋葉原";
const FALLBACK_EXAMPLES = [
  ["青砥", "中野坂上"], ["吉祥寺", "浅草"], ["町田", "北千住"]
];

const CHEAP_ENOUGH = 500;   // これ以下なら「気軽に行ける」とみなす目安(円)
const PICK_TRIES = 6;

// 都営線が通っている駅からランダムに選び、実際に運賃を計算して安いものを採る。
// ここを「2路線以上の駅から均等」にすると、片道800円かかる遠い駅が普通に出てしまう。
// 外出のきっかけとして出す以上、行ける見込みのある額でなければ意味がない。
function pickCheapPartner(fixedId, fixedIsOrigin) {
  const pool = [...net.freeStations];
  let best = null;
  for (let i = 0; i < PICK_TRIES; i++) {
    const id = pool[Math.floor(Math.random() * pool.length)];
    if (id === fixedId) continue;
    const [a, b] = fixedIsOrigin ? [fixedId, id] : [id, fixedId];
    const plan = planRoutes(net, a, b, currentOpts());
    if (!plan.options.length) continue;
    const fare = plan.options[0].totalActual;
    if (!best || fare < best.fare) best = { id, fare };
    if (fare <= CHEAP_ENOUGH) break;
  }
  return best;
}

function stationIdByName(name) {
  const hit = net.search(name, 1);
  return hit.length ? hit[0].station.id : null;
}

function exampleChip(fromName, toName, fare) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "chip";
  b.innerHTML = esc(fromName) + " → " + esc(toName) +
    (fare === null ? "" : ` <span class="chip-fare${fare === 0 ? " zero" : ""}">${fare}円</span>`);
  b.addEventListener("click", () => runExample(fromName, toName));
  return b;
}

function renderExamples() {
  const row = $("exampleRow");
  row.innerHTML = "";
  const saved = savedStations();

  if (!saved.length) {
    for (const [f, t] of FALLBACK_EXAMPLES) row.appendChild(exampleChip(f, t, null));
    return;
  }

  // 保存した駅を拠点に、安く行ける先を提案する
  const mine = saved[Math.floor(Math.random() * saved.length)];
  const specs = [
    [mine, true], [HOME_STATION, true], [HUB_STATION, false]
  ];
  for (const [name, isOrigin] of specs) {
    const id = stationIdByName(name);
    if (id === null) continue;
    const found = pickCheapPartner(id, isOrigin);
    if (!found) continue;
    const other = net.stations.get(found.id).name;
    row.appendChild(isOrigin
      ? exampleChip(name, other, found.fare)
      : exampleChip(other, name, found.fare));
  }
}

// ?from=青砥&to=中野坂上 で経路を開ける。
// 支援者が「この行き方です」とリンクで渡せるようにするため。
function applyUrlQuery() {
  const q = new URLSearchParams(location.search);
  const from = q.get("from"), to = q.get("to");
  if (from && to) runExample(from, to);
}

// 検索したら、その経路を指すURLにしておく(再読み込み・共有できるように)
function pushQuery(from, to) {
  const q = new URLSearchParams({ from: from.name, to: to.name });
  history.replaceState(null, "", location.pathname + "?" + q.toString());
}

$("searchForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const from = resolve("from", $("fromInput"));
  const to = resolve("to", $("toInput"));
  resultEl.innerHTML = "";

  if (!from || !to) {
    const bad = !from ? $("fromInput").value : $("toInput").value;
    resultEl.appendChild(errorBox(
      (!from ? "出発駅" : "到着駅") + "が見つかりません",
      isKanaOnly(bad)
        ? "駅名は漢字で入力してください(例: しんじゅく → 新宿)。"
        : "駅名を確認してください。対象は東京・神奈川・埼玉・千葉の鉄道です。"));
    return;
  }
  if (from.id === to.id) {
    resultEl.appendChild(errorBox("同じ駅です", "出発駅と到着駅に別の駅を指定してください。"));
    return;
  }

  const plan = planRoutes(net, from.id, to.id, currentOpts());
  if (!plan.options.length) {
    resultEl.appendChild(errorBox("経路が見つかりません",
      "この区間はデータの対象範囲(東京・神奈川・埼玉・千葉の鉄道)の外かもしれません。"));
    return;
  }
  render(from, to, plan);
  pushQuery(from, to);
  addHistory(from.name, to.name);
  resultEl.querySelector("h2").focus();
});

// --- オフライン対応(サービスワーカー) --------------------------------------
// 地下や圏外でも使えるよう、資材を端末に持たせる。
// 新しい版が用意できたら、勝手に切り替えず利用者に確認してから入れ替える。
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").then((reg) => {
      const offerUpdate = (worker) => {
        if (!worker || !navigator.serviceWorker.controller) return;
        $("updateBar").hidden = false;
        $("updateBtn").onclick = () => {
          $("updateBtn").disabled = true;
          worker.postMessage("SKIP_WAITING");
        };
      };
      if (reg.waiting) offerUpdate(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        if (!w) return;
        w.addEventListener("statechange", () => {
          if (w.state === "installed") offerUpdate(w);
        });
      });
    }).catch(() => { /* 未対応の環境でも通常どおり動く */ });

    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) return;      // 更新の繰り返しを防ぐ
      reloading = true;
      location.reload();
    });
  });
}

// --- 表示 -----------------------------------------------------------------
function errorBox(title, msg) {
  const d = document.createElement("div");
  d.className = "error-box";
  d.setAttribute("role", "alert");
  d.innerHTML = `<strong>${esc(title)}</strong><p>${esc(msg)}</p>`;
  return d;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function lineColor(lineId, op) {
  const l = net.lines.get(lineId);
  if (l && l.color && l.color !== "#8a8a8a") return l.color;
  return OP_COLORS[op] || "#6b7280";
}

function render(from, to, plan) {
  const best = plan.options[0];

  const h2 = document.createElement("h2");
  h2.className = "res-title";
  h2.id = "resultTop";
  h2.tabIndex = -1;
  h2.textContent = `${from.name} → ${to.name}`;
  resultEl.appendChild(h2);

  // いちばん伝えたいこと: 都営線にどこから入るか
  resultEl.appendChild(headline(best));

  // 経路が複数あるときは、先頭に一覧を置いて選べるようにする
  if (plan.options.length > 1) resultEl.appendChild(routeIndex(plan.options));

  plan.options.forEach((opt, i) => {
    resultEl.appendChild(routeCard(opt, i, plan.options.length));
  });

  const note = document.createElement("p");
  note.className = "footnote";
  note.textContent = "所要時間は駅間距離からの目安です。実際の時刻表・待ち時間は考慮していません。";
  resultEl.appendChild(note);
}

function headline(best) {
  const box = document.createElement("div");
  box.className = "headline" + (best.usesFree ? "" : " nofree");

  if (best.usesFree) {
    // 経路の表示と揃えるため、都営線側の駅名で出す
    // (例: 大江戸線なら「御徒町」ではなく「上野御徒町」)
    const entry = net.labelOf(best.freeEntry, best.freeEntryLine);
    const exit = net.labelOf(best.freeExit, best.freeExitLine);
    box.innerHTML = `
      <p class="hl-lead">都営線を使って行けます</p>
      <dl class="hl-grid">
        <div><dt>都営線に入る駅</dt><dd class="hl-station">${esc(entry)}</dd></div>
        <div><dt>都営線を出る駅</dt><dd class="hl-station">${esc(exit)}</dd></div>
      </dl>`;
  } else {
    box.innerHTML = `
      <p class="hl-lead">この区間では都営線を使えません</p>
      <p class="hl-sub">遠回りになりすぎるか、都営線が通っていない区間です。下の経路が最も安い行き方です。</p>`;
  }

  const save = best.totalRegular - best.totalActual;
  const money = document.createElement("p");
  money.className = "hl-money";
  money.innerHTML =
    `<span class="was">通常 ${best.totalRegular}円</span><span class="fare-approx">(概算)</span>` +
    `<span class="arrow" aria-hidden="true">→</span>` +
    `<span class="now">${best.totalActual}円</span>` +
    (save > 0 ? `<span class="save">${save}円 割引可能</span>` : "");
  box.appendChild(money);
  return box;
}

// 検索結果の一覧。押すとその経路まで飛ぶ。
function routeIndex(options) {
  const nav = document.createElement("nav");
  nav.className = "route-index";
  nav.setAttribute("aria-label", "見つかった経路の一覧");
  const h = document.createElement("h3");
  h.className = "ri-head";
  h.textContent = `見つかった経路 ${options.length}件`;
  nav.appendChild(h);

  const ul = document.createElement("ul");
  options.forEach((o, i) => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = "#route-" + (i + 1);
    a.className = "ri-link" + (o.usesFree ? " free" : "");
    a.innerHTML =
      `<span class="ri-no">${i + 1}</span>` +
      `<span class="ri-fare">${o.totalActual}円</span>` +
      `<span class="ri-meta">約${o.time}分 ・ 乗換${o.transfers}回</span>` +
      `<span class="ri-tag">${o.usesFree ? "都営線あり" : "都営線なし"}</span>`;
    li.appendChild(a);
    ul.appendChild(li);
  });
  nav.appendChild(ul);
  return nav;
}

// その経路で都営線をどこからどこまで使うか。経路ごとに違うので各カードに出す。
function freeSpan(opt) {
  const p = document.createElement("p");
  if (!opt.usesFree) {
    p.className = "card-free none";
    p.textContent = "この経路では都営線を使いません";
    return p;
  }
  p.className = "card-free";
  const a = net.labelOf(opt.freeEntry, opt.freeEntryLine);
  const b = net.labelOf(opt.freeExit, opt.freeExitLine);
  p.innerHTML = `都営線は <b>${esc(a)}</b> から <b>${esc(b)}</b> まで` +
    `<span class="cf-zero">この区間0円</span>`;
  return p;
}

function backToTop() {
  const a = document.createElement("a");
  a.href = "#resultTop";
  a.className = "back-top";
  a.textContent = "↑ 経路の一覧へ戻る";
  return a;
}

function routeCard(opt, i, total) {
  const card = document.createElement("article");
  card.className = "route-card" + (i === 0 ? " primary" : "");
  card.id = "route-" + (i + 1);

  const head = document.createElement("header");
  head.className = "rc-head";
  const badges = (opt.badges && opt.badges.length ? opt.badges : ["別の経路"])
    .map((b) => `<span class="rc-tag">${esc(b)}</span>`).join("");
  head.innerHTML =
    badges +
    `<span class="rc-fare"><b>${opt.totalActual}円</b><span class="rc-was">通常 ${opt.totalRegular}円</span><span class="fare-approx">(概算)</span></span>` +
    `<span class="rc-meta">約${opt.time}分 ・ 乗換${opt.transfers}回</span>`;
  card.appendChild(head);

  // 内訳を足すと合わないため、乗継割引が効いていることを明示する。
  // (東京メトロと都営地下鉄を直接乗り継ぐと、両社の合算から割り引かれる)
  if (opt.transferDiscount > 0) {
    const d = document.createElement("p");
    d.className = "steps-note";
    d.textContent = "通常運賃には、東京メトロと都営地下鉄の乗継割引 −"
      + opt.transferDiscount + "円 を含みます。無料乗車券を使う場合はメトロ側を単独で買うため、"
      + "この割引は効きません。";
    card.appendChild(d);
  }

  card.appendChild(freeSpan(opt));
  card.appendChild(stepList(opt));
  card.appendChild(timeline(opt));

  if (total > 1) card.appendChild(backToTop());
  return card;
}

// --- やることの手順 --------------------------------------------------------
// 「乗換1回」と数字で言われても、どこで降りればよいかは分からない。
// このサービスの目的は「どこで乗り換えるか」を確実に伝えることなので、
// 図の前に、言葉で手順を出す。
//
// 直通運転でつながる区間はひとまとめにして「1回の乗車」として扱う。
// 乗ったままでよい駅を手順に混ぜると、そこで降りるように見えてしまうため。
function buildRides(opt) {
  const rides = [];
  for (const leg of opt.legs) {
    const last = rides[rides.length - 1];
    if (leg.walk) { rides.push({ walk: leg }); continue; }
    if (leg.through && last && !last.walk) { last.legs.push(leg); continue; }
    rides.push({ legs: [leg] });
  }
  return rides;
}

function lineNameOf(id) { return (net.lines.get(id) || {}).name || ""; }

function stepList(opt) {
  const rides = buildRides(opt);
  const ol = document.createElement("ol");
  ol.className = "steps";

  const add = (kind, main, sub, free) => {
    const li = document.createElement("li");
    li.className = "step " + kind + (free ? " free" : "");
    li.innerHTML = `<span class="step-main">${main}</span>` +
      (sub ? `<span class="step-sub">${sub}</span>` : "");
    ol.appendChild(li);
  };

  rides.forEach((r, i) => {
    if (r.walk) {
      const a = net.stations.get(r.walk.path[0]).name;
      const b = net.stations.get(r.walk.path.slice(-1)[0]).name;
      const min = Math.round(r.walk.meters / 80 + 3);
      // 距離と所要時間は手順の本文に入れる。どれくらい歩くのかは
      // 行けるかどうかの判断に直結するため、補足ではなく主文に置く。
      const dist = `約${Math.round(r.walk.meters)}m・徒歩${min}分`;
      if (i === 0) {
        // 出発駅から乗車駅まで歩く場合。まだ電車に乗っていないので
        // 「降りて」とは言えないし、改札を出る動作も発生しない。
        add("walk start", `<b>${esc(a)}</b> から <b>${esc(b)}</b> まで歩く(${dist})`, null);
      } else {
        add("walk", `<b>${esc(a)}</b> で降りて、<b>${esc(b)}</b> まで歩く(${dist})`,
          "いちど改札を出ます");
      }
      // 最後が徒歩の場合、ここが到着になる。
      // 書かないと「歩く」で手順が終わり、着いたことが分からない。
      if (i === rides.length - 1) add("goal", `<b>${esc(b)}</b> に到着`, "到着です");
      return;
    }

    const first = r.legs[0], last = r.legs[r.legs.length - 1];
    const board = net.labelOf(first.path[0], first.line);
    const alight = net.labelOf(last.path.slice(-1)[0], last.line);
    const allFree = r.legs.every((l) => l.group && l.group.free);

    // 直通で他社線へ乗り入れる場合は、その旨を乗車時に伝える
    const others = r.legs.slice(1).map((l) => lineNameOf(l.line));
    const sub = others.length
      ? `<b>${esc(others[others.length - 1])}</b>へ直通する列車に乗ります。` +
        `途中で乗り換えず、<b>${esc(alight)}</b> まで乗ったままです`
      : `<b>${esc(alight)}</b> まで ${r.legs.reduce((n, l) => n + l.path.length - 1, 0)}駅`;
    add("board", `<b>${esc(board)}</b> で <b>${esc(lineNameOf(first.line))}</b> に乗る`,
      sub, allFree);

    // 次が乗り換えなら、降りる駅と乗り換え先をここで示す
    const next = rides[i + 1];
    if (!next) {
      add("goal", `<b>${esc(alight)}</b> で降りる`, "到着です");
    } else if (!next.walk) {
      const nb = net.labelOf(next.legs[0].path[0], next.legs[0].line);
      const same = plainName(nb) === plainName(alight);
      add("change",
        same
          ? `<b>${esc(alight)}</b> で <b>${esc(lineNameOf(next.legs[0].line))}</b> に乗り換え`
          : `<b>${esc(alight)}</b> で降りて、<b>${esc(nb)}</b> へ移動`,
        same ? "同じ駅の中で乗り換えます" : "駅の中でつながっていますが、少し歩きます");
    }
  });

  const box = document.createElement("div");
  box.className = "steps-box";
  const h = document.createElement("h4");
  h.className = "steps-head";
  // 出発駅から乗車駅まで歩くのは「乗り換え」ではないので数に入れない
  const changes = ol.querySelectorAll(".step.change, .step.walk:not(.start)").length;
  h.textContent = changes === 0 ? "やること(乗り換えなし)" : `やること(乗り換え ${changes} 回)`;
  box.appendChild(h);
  box.appendChild(ol);

  // 直通は全列車ではない。時刻表を持っていない以上、ここは正直に断っておく。
  if (rides.some((r) => !r.walk && r.legs.length > 1)) {
    const p = document.createElement("p");
    p.className = "steps-note";
    p.textContent = "直通列車は本数が限られることがあります。来ない場合は、境界の駅で乗り換えても同じ場所に行けます。";
    box.appendChild(p);
  }
  return box;
}

function timeline(opt) {
  const tl = document.createElement("ol");
  tl.className = "timeline";

  const isFree = (leg) => !!(leg && !leg.walk && leg.group && leg.group.free);

  opt.legs.forEach((leg, idx) => {
    const first = idx === 0;
    const prev = opt.legs[idx - 1];

    // 駅ノード(この区間の出発駅)
    const startName = leg.walk
      ? net.stations.get(leg.path[0]).name
      : net.labelOf(leg.path[0], leg.line);
    const role = first ? "出発" : null;
    // 前の区間の終わりと駅名が変わる=改札内外の乗換で名前が変わる駅
    const prevEnd = prev
      ? (prev.walk ? net.stations.get(prev.path.slice(-1)[0]).name : net.labelOf(prev.path.slice(-1)[0], prev.line))
      : null;
    // 都営線に入る駅/出る駅を目印として出す
    let mark = null;
    if (isFree(leg) && !isFree(prev)) mark = "enter";
    else if (!isFree(leg) && isFree(prev)) mark = "exit";
    // 改札を出て歩くような負担の大きい乗換は、その駅に注意書きを出す
    const hard = (opt.hardTransfers || []).find(
      (h) => !leg.walk && h.station === leg.path[0] && h.line === leg.line
    );
    // 括弧の種類だけが違う表記ゆれ(押上〈スカイツリー前〉/押上（スカイツリー前）)は
    // 「〜から乗換」を出しても意味がないので同じ駅名として扱う
    const differs = prevEnd && plainName(prevEnd) !== plainName(startName);
    tl.appendChild(stopNode(startName, role, differs ? prevEnd : null, mark,
      hard && hard.note, !!leg.through));

    // 移動区間
    tl.appendChild(leg.walk ? walkNode(leg) : rideNode(leg));

    // 最後の区間なら到着駅も出す
    if (idx === opt.legs.length - 1) {
      const endName = leg.walk
        ? net.stations.get(leg.path.slice(-1)[0]).name
        : net.labelOf(leg.path.slice(-1)[0], leg.line);
      tl.appendChild(stopNode(endName, "到着", null, isFree(leg) ? "exit" : null));
    }
  });
  return tl;
}

function stopNode(name, role, alsoKnownAs, freeMark, hardNote, through) {
  const li = document.createElement("li");
  li.className = "tl-stop" + (role ? " endpoint" : "");
  const dot = `<span class="tl-dot" aria-hidden="true"></span>`;
  let html = `${dot}<span class="tl-name">${esc(name)}</span>`;
  if (role) html += `<span class="tl-role">${esc(role)}</span>`;
  // 直通運転はそのまま乗っていればよい。降りる必要がないことをはっきり出す。
  if (through) html += `<span class="tl-through-flag">直通・乗り換え不要</span>`;
  if (alsoKnownAs) {
    html += through
      ? `<span class="tl-aka">${esc(alsoKnownAs)}から直通</span>`
      : `<span class="tl-aka">${esc(alsoKnownAs)}から乗換</span>`;
  }
  if (freeMark === "enter") html += `<span class="tl-flag enter">ここから都営線・無料</span>`;
  if (freeMark === "exit") html += `<span class="tl-flag exit">ここまで都営線・無料</span>`;
  if (hardNote) html += `<span class="tl-hard">乗換注意: ${esc(hardNote)}</span>`;
  li.innerHTML = html;
  return li;
}

function rideNode(leg) {
  const li = document.createElement("li");
  const g = leg.group;
  const color = lineColor(leg.line, g.op);
  li.className = "tl-ride" + (g.free ? " free" : "");
  li.style.setProperty("--line-color", color);

  const lineName = (net.lines.get(leg.line) || {}).name || "";
  const stops = leg.path.length - 1;

  // 運賃はこの事業者の最初の区間にだけ表示する(会社ごとの通し運賃のため)
  const isFareHead = g.legs[0] === leg;
  let fare = "";
  if (isFareHead) {
    // なぜその金額になるのかを添える。割引がきかない理由が分からないと
    // 「手帳を見せれば安くなるはず」と思って窓口で困ることになる。
    fare = g.free
      ? `<span class="tl-fare free">0円<small>無料乗車券</small></span>`
      : `<span class="tl-fare${g.actual === g.regular ? " nodisc" : ""}">${g.actual}円` +
        `<small>${g.actual === g.regular ? esc(g.note || "割引なし") : "通常" + g.regular + "円 → " + esc(g.note || "半額")}</small></span>`;
  } else {
    // 同じ事業者の2区間目以降は運賃を再掲しない。ただし空欄のままだと
    // 「運賃が抜け落ちている」ように見えるので、含まれていることを書く。
    fare = `<span class="tl-fare included">上の運賃に含む</span>`;
  }

  // 途中の駅を開いて確かめられるようにする。
  // 他の乗換案内と経路が違っても、通る駅が分かれば不安にならずに済む。
  const mid = leg.path.slice(1, -1);
  const listId = "stops-" + (++stopListSeq);
  const toggle = mid.length
    ? `<button type="button" class="tl-toggle" aria-expanded="false" aria-controls="${listId}">` +
      `<span class="tl-stops">${stops}駅</span>` +
      `<span class="tl-caret" aria-hidden="true">▾</span>` +
      `<span class="sr-only">途中の駅を表示</span></button>`
    : `<span class="tl-stops">${stops}駅</span>`;

  li.innerHTML =
    `<span class="tl-bar" aria-hidden="true"></span>` +
    `<span class="tl-line">${esc(lineName)}</span>` +
    toggle +
    fare +
    (isFareHead && g.legs.length > 1
      ? `<span class="tl-through">${esc(net.operators[g.op].name)}線内は通し運賃</span>` : "");

  if (mid.length) {
    const ol = document.createElement("ol");
    ol.className = "tl-midstops";
    ol.id = listId;
    ol.hidden = true;
    for (const s of mid) {
      const item = document.createElement("li");
      item.textContent = net.labelOf(s, leg.line);
      ol.appendChild(item);
    }
    li.appendChild(ol);
    const btn = li.querySelector(".tl-toggle");
    btn.addEventListener("click", () => {
      const open = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", open ? "false" : "true");
      ol.hidden = open;
    });
  }
  return li;
}

let stopListSeq = 0;

function walkNode(leg) {
  const li = document.createElement("li");
  li.className = "tl-walk";
  const min = Math.round(leg.meters / 80 + 3);
  li.innerHTML =
    `<span class="tl-bar walk" aria-hidden="true"></span>` +
    `<span class="tl-line">徒歩でのりかえ</span>` +
    `<span class="tl-stops">約${min}分 (${Math.round(leg.meters)}m)</span>`;
  return li;
}
