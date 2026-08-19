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
    if (raw.generated) $("dataDate").textContent = raw.generated;
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
  h2.tabIndex = -1;
  h2.textContent = `${from.name} → ${to.name}`;
  resultEl.appendChild(h2);

  // いちばん伝えたいこと: 都営線にどこから入るか
  resultEl.appendChild(headline(best));

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
    `<span class="was">通常 ${best.totalRegular}円</span>` +
    `<span class="arrow" aria-hidden="true">→</span>` +
    `<span class="now">${best.totalActual}円</span>` +
    (save > 0 ? `<span class="save">${save}円 おトク</span>` : "");
  box.appendChild(money);
  return box;
}

function routeCard(opt, i, total) {
  const card = document.createElement("article");
  card.className = "route-card" + (i === 0 ? " primary" : "");

  const head = document.createElement("header");
  head.className = "rc-head";
  const tag = i === 0 ? "いちばん安い" : "比較: 少し速い";
  head.innerHTML =
    `<span class="rc-tag">${esc(tag)}</span>` +
    `<span class="rc-fare"><b>${opt.totalActual}円</b><span class="rc-was">通常 ${opt.totalRegular}円</span></span>` +
    `<span class="rc-meta">約${opt.time}分 ・ 乗換${opt.transfers}回</span>`;
  card.appendChild(head);

  card.appendChild(timeline(opt));

  if (total > 1 && i === 0) {
    const p = document.createElement("p");
    p.className = "rc-hint";
    p.textContent = "↓ 下は、お金はかかるけれど速い経路です。";
    card.appendChild(p);
  }
  return card;
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
    tl.appendChild(stopNode(startName, role, differs ? prevEnd : null, mark, hard && hard.note));

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

function stopNode(name, role, alsoKnownAs, freeMark, hardNote) {
  const li = document.createElement("li");
  li.className = "tl-stop" + (role ? " endpoint" : "");
  const dot = `<span class="tl-dot" aria-hidden="true"></span>`;
  let html = `${dot}<span class="tl-name">${esc(name)}</span>`;
  if (role) html += `<span class="tl-role">${esc(role)}</span>`;
  if (alsoKnownAs) html += `<span class="tl-aka">${esc(alsoKnownAs)}から乗換</span>`;
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
  }

  li.innerHTML =
    `<span class="tl-bar" aria-hidden="true"></span>` +
    `<span class="tl-line">${esc(lineName)}</span>` +
    `<span class="tl-stops">${stops}駅</span>` +
    fare +
    (isFareHead && g.legs.length > 1
      ? `<span class="tl-through">${esc(net.operators[g.op].name)}線内は通し運賃</span>` : "");
  return li;
}

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
