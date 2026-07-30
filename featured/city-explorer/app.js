/* 城市漫游 / City Explorer
   Pick a city; the hand-drawn SVG map + attraction list swap with a soft fade.
   Everything is inline & offline — no map tiles, no network. All state is in
   plain JS variables (the preview iframe sandbox has no Web Storage). */
(function () {
  "use strict";

  // Each city: a muted accent hue, an emoji, a bespoke SVG "map背景" (river/coast,
  // roads, park blocks) so switching is visibly distinct, plus 4–6 attractions
  // with a bilingual name, one-line description, emoji, category, rating and an
  // (x,y) position on the 400×320 map canvas.
  var CATS = {
    "历史": "#b07d56", "自然": "#6f9b6f", "美食": "#d08a4f",
    "艺术": "#9a7bb5", "地标": "#5b8bb0", "购物": "#c76b8e"
  };

  var CITIES = [
    {
      id: "beijing", name: "北京", en: "Beijing", emoji: "🏯", hue: "#c0392b",
      soft: "#f0c4bd",
      map: '<path d="M0 0 H400 V320 H0 Z" fill="#f6efe4"/>' +
           '<rect x="150" y="60" width="100" height="90" rx="4" fill="#e9d7bf" opacity=".7"/>' +
           '<path d="M0 150 H400 M200 0 V320" stroke="#dcc9ad" stroke-width="10" fill="none"/>' +
           '<path d="M60 40 H340 M60 40 V280 M340 40 V280 M60 280 H340" stroke="#cbb391" stroke-width="4" fill="none" opacity=".8"/>' +
           '<circle cx="200" cy="105" r="30" fill="#e4b7ae" opacity=".6"/>' +
           '<rect x="40" y="220" width="70" height="55" rx="8" fill="#cfe3c4"/>' +
           '<rect x="300" y="210" width="60" height="70" rx="8" fill="#cfe3c4"/>',
      spots: [
        { n: "故宫", en: "Forbidden City", cat: "历史", e: "🏯", r: 5, x: 200, y: 105, d: "五个世纪的皇家宫殿，红墙金瓦气势恢弘。" },
        { n: "天坛", en: "Temple of Heaven", cat: "历史", e: "🛕", r: 4, x: 210, y: 245, d: "明清皇帝祭天之所，圆形祈年殿是经典地标。" },
        { n: "颐和园", en: "Summer Palace", cat: "自然", e: "🌊", r: 5, x: 70, y: 70, d: "湖光山色的皇家园林，长廊与十七孔桥闻名。" },
        { n: "南锣鼓巷", en: "Nanluoguxiang", cat: "美食", e: "🥟", r: 4, x: 150, y: 55, d: "老北京胡同里的小吃与文创，烟火气十足。" },
        { n: "798 艺术区", en: "798 Art District", cat: "艺术", e: "🎨", r: 4, x: 330, y: 60, d: "由老厂房改造的当代艺术聚落，画廊林立。" },
        { n: "长城", en: "Great Wall", cat: "地标", e: "🧱", r: 5, x: 330, y: 250, d: "蜿蜒于群山之巅的世界奇迹，登高望远。" }
      ]
    },
    {
      id: "shanghai", name: "上海", en: "Shanghai", emoji: "🌆", hue: "#2c7d9b",
      soft: "#b9dbe6",
      map: '<path d="M0 0 H400 V320 H0 Z" fill="#eef3f4"/>' +
           '<path d="M250 0 C 220 90, 300 160, 240 320 L400 320 L400 0 Z" fill="#cfe6ef" opacity=".8"/>' +
           '<path d="M250 0 C 220 90, 300 160, 240 320" stroke="#9fcdda" stroke-width="4" fill="none"/>' +
           '<path d="M0 120 Q120 100 210 150 M40 240 Q120 210 200 250" stroke="#d3ddd1" stroke-width="8" fill="none"/>' +
           '<rect x="60" y="40" width="46" height="46" rx="6" fill="#dfe7dd"/>' +
           '<rect x="120" y="60" width="30" height="30" rx="5" fill="#dfe7dd"/>',
      spots: [
        { n: "外滩", en: "The Bund", cat: "地标", e: "🌃", r: 5, x: 250, y: 120, d: "黄浦江畔的万国建筑群，夜景璀璨迷人。" },
        { n: "东方明珠", en: "Oriental Pearl", cat: "地标", e: "🗼", r: 4, x: 300, y: 90, d: "陆家嘴的标志性电视塔，可俯瞰全城。" },
        { n: "豫园", en: "Yu Garden", cat: "历史", e: "🏮", r: 4, x: 150, y: 160, d: "明代江南园林，亭台楼阁与城隍庙相邻。" },
        { n: "田子坊", en: "Tianzifang", cat: "艺术", e: "🎭", r: 4, x: 90, y: 210, d: "石库门里弄改造的创意街区，小店密布。" },
        { n: "南京路", en: "Nanjing Road", cat: "购物", e: "🛍️", r: 4, x: 180, y: 90, d: "百年商业步行街，霓虹与百货云集。" }
      ]
    },
    {
      id: "chengdu", name: "成都", en: "Chengdu", emoji: "🐼", hue: "#3f8f5b",
      soft: "#c2e2cc",
      map: '<path d="M0 0 H400 V320 H0 Z" fill="#eef4ea"/>' +
           '<circle cx="200" cy="160" r="120" fill="#dbead5" opacity=".7"/>' +
           '<circle cx="200" cy="160" r="80" fill="none" stroke="#c3d9bd" stroke-width="4"/>' +
           '<circle cx="200" cy="160" r="120" fill="none" stroke="#c3d9bd" stroke-width="4"/>' +
           '<path d="M200 40 V280 M80 160 H320" stroke="#cadfc4" stroke-width="6"/>' +
           '<path d="M40 60 Q140 120 60 260" stroke="#a8d0e0" stroke-width="7" fill="none"/>',
      spots: [
        { n: "大熊猫基地", en: "Panda Base", cat: "自然", e: "🐼", r: 5, x: 300, y: 70, d: "近距离观赏憨态可掬的大熊猫，成都名片。" },
        { n: "宽窄巷子", en: "Kuanzhai Alley", cat: "美食", e: "🍜", r: 5, x: 130, y: 130, d: "青砖老巷里的茶馆与川味小吃，慢生活。" },
        { n: "武侯祠", en: "Wuhou Shrine", cat: "历史", e: "🏛️", r: 4, x: 170, y: 220, d: "纪念诸葛亮的三国圣地，红墙竹影。" },
        { n: "锦里", en: "Jinli Street", cat: "美食", e: "🌶️", r: 4, x: 210, y: 240, d: "仿古商业街，糖油果子与担担面香气扑鼻。" },
        { n: "杜甫草堂", en: "Du Fu Cottage", cat: "艺术", e: "📜", r: 4, x: 90, y: 90, d: "诗圣杜甫故居，园林清幽，诗意盎然。" }
      ]
    },
    {
      id: "xian", name: "西安", en: "Xi'an", emoji: "🏛️", hue: "#a86f2e",
      soft: "#ecd6b0",
      map: '<path d="M0 0 H400 V320 H0 Z" fill="#f4eede"/>' +
           '<rect x="70" y="60" width="260" height="200" rx="6" fill="none" stroke="#c9ad7f" stroke-width="10"/>' +
           '<rect x="70" y="60" width="260" height="200" fill="#eadfc4" opacity=".5"/>' +
           '<path d="M200 60 V260 M70 160 H330" stroke="#d3ba8c" stroke-width="6"/>' +
           '<circle cx="200" cy="160" r="18" fill="#d8b98a"/>',
      spots: [
        { n: "兵马俑", en: "Terracotta Army", cat: "历史", e: "🗿", r: 5, x: 340, y: 110, d: "秦始皇陵的地下军团，气势磅礴震撼世界。" },
        { n: "大雁塔", en: "Giant Wild Goose Pagoda", cat: "历史", e: "🛕", r: 4, x: 240, y: 230, d: "唐代高僧玄奘译经之处，古塔巍然。" },
        { n: "古城墙", en: "City Wall", cat: "地标", e: "🧱", r: 5, x: 200, y: 60, d: "中国保存最完整的古城墙，可骑行环游。" },
        { n: "回民街", en: "Muslim Quarter", cat: "美食", e: "🍢", r: 5, x: 150, y: 130, d: "羊肉泡馍与肉夹馍的天堂，越夜越热闹。" },
        { n: "钟楼", en: "Bell Tower", cat: "地标", e: "🔔", r: 4, x: 200, y: 155, d: "古城中心的明代钟楼，华灯初上格外美。" }
      ]
    },
    {
      id: "paris", name: "巴黎", en: "Paris", emoji: "🗼", hue: "#7b5ea7",
      soft: "#d9cbe8",
      map: '<path d="M0 0 H400 V320 H0 Z" fill="#f1eef6"/>' +
           '<path d="M0 130 C 100 100, 180 180, 260 150 S 400 170, 400 150 L400 200 C 320 210, 200 240, 100 210 S 0 200, 0 190 Z" fill="#cfe0ef" opacity=".8"/>' +
           '<path d="M0 130 C 100 100, 180 180, 260 150 S 400 170, 400 150" stroke="#a9c6de" stroke-width="4" fill="none"/>' +
           '<path d="M200 20 L120 300 M200 20 L280 300 M60 90 L360 250" stroke="#d8cbe4" stroke-width="5"/>' +
           '<circle cx="200" cy="90" r="8" fill="#c9b6dd"/>',
      spots: [
        { n: "埃菲尔铁塔", en: "Eiffel Tower", cat: "地标", e: "🗼", r: 5, x: 120, y: 110, d: "巴黎的钢铁诗篇，夜晚闪烁的浪漫象征。" },
        { n: "卢浮宫", en: "Louvre", cat: "艺术", e: "🖼️", r: 5, x: 240, y: 140, d: "世界最大艺术博物馆，蒙娜丽莎在此微笑。" },
        { n: "圣母院", en: "Notre-Dame", cat: "历史", e: "⛪", r: 4, x: 270, y: 160, d: "塞纳河中的哥特杰作，飞扶壁令人惊叹。" },
        { n: "蒙马特", en: "Montmartre", cat: "艺术", e: "🎨", r: 4, x: 210, y: 60, d: "山丘上的艺术家村，圣心大教堂洁白如雪。" },
        { n: "香榭丽舍", en: "Champs-Élysées", cat: "购物", e: "🛍️", r: 4, x: 150, y: 170, d: "从凯旋门延伸的华丽大道，橱窗令人流连。" }
      ]
    },
    {
      id: "tokyo", name: "东京", en: "Tokyo", emoji: "🗾", hue: "#c85c7e",
      soft: "#f0cdd8",
      map: '<path d="M0 0 H400 V320 H0 Z" fill="#f6eef1"/>' +
           '<path d="M260 320 C 240 220, 340 180, 300 60 L400 60 L400 320 Z" fill="#cfe4ec" opacity=".8"/>' +
           '<path d="M260 320 C 240 220, 340 180, 300 60" stroke="#a9cfda" stroke-width="4" fill="none"/>' +
           '<circle cx="170" cy="150" r="90" fill="none" stroke="#e6ccd4" stroke-width="6"/>' +
           '<path d="M40 60 L300 300 M40 300 L280 40" stroke="#e6ccd4" stroke-width="4" opacity=".7"/>',
      spots: [
        { n: "浅草寺", en: "Senso-ji", cat: "历史", e: "⛩️", r: 5, x: 220, y: 80, d: "东京最古老的寺庙，雷门大灯笼是必拍地标。" },
        { n: "东京塔", en: "Tokyo Tower", cat: "地标", e: "🗼", r: 4, x: 180, y: 210, d: "红白相间的铁塔，昭和时代的城市象征。" },
        { n: "涩谷", en: "Shibuya", cat: "购物", e: "🚦", r: 5, x: 100, y: 190, d: "全球最繁忙的十字路口，潮流与霓虹交汇。" },
        { n: "上野公园", en: "Ueno Park", cat: "自然", e: "🌸", r: 4, x: 150, y: 90, d: "樱花名所与博物馆群，春日粉云漫天。" },
        { n: "银座", en: "Ginza", cat: "美食", e: "🍣", r: 4, x: 210, y: 170, d: "高级料亭与百货云集，寿司与甜点的殿堂。" }
      ]
    }
  ];

  // --- elements ---
  var $ = function (id) { return document.getElementById(id); };
  var appEl = $("app");
  var selectorEl = $("citySelector");
  var mapEl = $("cityMap");
  var legendEl = $("mapLegend");
  var listEl = $("attractionsList");
  var mcEmoji = $("mcEmoji"), mcName = $("mcName"), mcCount = $("mcCount");
  var listCity = $("listCity");
  var card = $("detailCard"), backdrop = $("detailBackdrop");
  var dHero = $("detailHero"), dEmoji = $("detailEmoji"), dChip = $("detailChip");
  var dTitle = $("detailTitle"), dEn = $("detailEn"), dRating = $("detailRating"), dDesc = $("detailDesc");

  var SVGNS = "http://www.w3.org/2000/svg";
  var current = null;

  function setHue(city) {
    appEl.style.setProperty("--accent", city.hue);
    appEl.style.setProperty("--accent-soft", city.soft);
  }

  // Build the city selector pills once
  CITIES.forEach(function (city, i) {
    var b = document.createElement("button");
    b.className = "city-pill" + (i === 0 ? " active" : "");
    b.type = "button";
    b.innerHTML = '<span class="pin" aria-hidden="true">' + city.emoji + '</span>' + city.name;
    b.addEventListener("click", function () { selectCity(city, b); });
    selectorEl.appendChild(b);
  });

  function selectCity(city, pill) {
    if (current && current.id === city.id) return;
    Array.prototype.forEach.call(selectorEl.children, function (p) { p.classList.remove("active"); });
    if (pill) pill.classList.add("active");

    mapEl.classList.add("switching");
    setHue(city);
    // Let the fade-out play, then swap contents and fade back in.
    setTimeout(function () {
      current = city;
      renderMap(city);
      renderLegend(city);
      renderList(city);
      mcEmoji.textContent = city.emoji;
      mcName.textContent = city.name + " · " + city.en;
      mcCount.textContent = city.spots.length + " 处景点";
      listCity.textContent = city.name + "景点";
      mapEl.classList.remove("switching");
    }, 260);
  }

  function el(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    for (var k in attrs) if (attrs.hasOwnProperty(k)) n.setAttribute(k, attrs[k]);
    return n;
  }

  function renderMap(city) {
    mapEl.innerHTML = city.map; // background paths (trusted, authored inline above)
    city.spots.forEach(function (s, idx) {
      var g = el("g", { "class": "pin-group", "tabindex": "0", "role": "button",
                        "aria-label": s.n + " " + s.en });
      g.dataset.idx = idx;
      var color = CATS[s.cat] || city.hue;
      // teardrop pin body
      var body = el("g", { "class": "pin-body" });
      var head = el("path", {
        "class": "pin-head",
        "d": "M" + s.x + " " + s.y +
             " c -9 -12 -13 -18 -13 -26 a13 13 0 0 1 26 0 c 0 8 -4 14 -13 26 Z",
        "fill": color, "stroke": "#fff", "stroke-width": "2"
      });
      var dot = el("circle", { cx: s.x, cy: s.y - 26, r: 5, fill: "#fff" });
      var emo = el("text", { x: s.x, y: s.y - 22, "text-anchor": "middle",
                             "font-size": "11" });
      emo.textContent = s.e;
      body.appendChild(head); body.appendChild(dot); body.appendChild(emo);
      var label = el("text", { "class": "pin-label", x: s.x, y: s.y + 14,
                               "text-anchor": "middle" });
      label.textContent = s.n;
      g.appendChild(body); g.appendChild(label);
      g.addEventListener("click", function () { focusSpot(idx, true); });
      g.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); focusSpot(idx, true); }
      });
      mapEl.appendChild(g);
    });
  }

  function renderLegend(city) {
    var used = {};
    city.spots.forEach(function (s) { used[s.cat] = true; });
    legendEl.innerHTML = "";
    Object.keys(used).forEach(function (cat) {
      var span = document.createElement("span");
      var dot = document.createElement("b");
      dot.style.background = CATS[cat] || city.hue;
      span.appendChild(dot);
      span.appendChild(document.createTextNode(cat));
      legendEl.appendChild(span);
    });
  }

  function renderList(city) {
    listEl.innerHTML = "";
    city.spots.forEach(function (s, idx) {
      var li = document.createElement("li");
      li.className = "attr-item";
      li.tabIndex = 0;
      li.dataset.idx = idx;
      li.style.animationDelay = (idx * 55) + "ms";
      li.setAttribute("role", "button");
      li.innerHTML =
        '<span class="attr-emoji" style="background:' + hexWithAlpha(CATS[s.cat] || city.hue, .22) + '">' + s.e + '</span>' +
        '<span class="attr-text">' +
          '<span class="attr-name">' + esc(s.n) + '</span>' +
          '<span class="attr-cat">' + esc(s.cat) + ' · ' + esc(s.en) + '</span>' +
        '</span>' +
        '<span class="attr-arrow" aria-hidden="true">›</span>';
      li.addEventListener("click", function () { focusSpot(idx, true); });
      li.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); focusSpot(idx, true); }
      });
      listEl.appendChild(li);
    });
  }

  // Highlight a spot on both the map and the list; optionally open the detail card.
  function focusSpot(idx, openCard) {
    Array.prototype.forEach.call(mapEl.querySelectorAll(".pin-group"), function (g) {
      g.classList.toggle("active", g.dataset.idx === String(idx));
    });
    Array.prototype.forEach.call(listEl.children, function (li) {
      li.classList.toggle("active", li.dataset.idx === String(idx));
    });
    if (openCard) openDetail(current.spots[idx]);
  }

  function openDetail(s) {
    var color = CATS[s.cat] || current.hue;
    dHero.style.background = "linear-gradient(135deg," + color + "," + current.soft + ")";
    dEmoji.textContent = s.e;
    dChip.textContent = s.cat;
    dChip.style.color = color;
    dChip.style.background = hexWithAlpha(color, .18);
    dTitle.textContent = s.n;
    dEn.textContent = s.en;
    dRating.textContent = "★★★★★☆☆☆☆☆".slice(5 - s.r, 10 - s.r);
    dDesc.textContent = s.d;
    backdrop.hidden = false;
    card.hidden = false;
  }

  function closeDetail() {
    card.hidden = true;
    backdrop.hidden = true;
  }

  $("detailClose").addEventListener("click", closeDetail);
  backdrop.addEventListener("click", closeDetail);
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && !card.hidden) closeDetail();
  });

  // --- helpers ---
  function esc(str) {
    return String(str).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function hexWithAlpha(hex, a) {
    var m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    var n = parseInt(m[1], 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }

  // --- init ---
  setHue(CITIES[0]);
  current = null;
  selectCity(CITIES[0], selectorEl.children[0]);
})();
