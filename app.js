(() => {
  const $ = id => document.getElementById(id);
  const win = $('gptScrim'), gpt = win.querySelector('.gpt'), btn = $('gptBtn');
  const input = $('promptInput'), row = $('rowInput'), launch = $('launchBtn');
  const IMGS = ['assets/result.png', 'assets/result2.png'];   // предпросмотры результата из Figma (варианты генерации чередуются)
  let cur = 'list', timer = null, baseTop = null, entry = 'sabydoc';
  const anchors = {};                                        // верх окна для каждой точки входа запоминается при первом открытии
  const CHIPS = ['Главные показатели компании', 'Для работы с клиентами', 'Для работы с сотрудниками и задачами', 'Товары и остатки'];
  const PH = { sabydoc: 'Например, нужен дашборд с отображением остатков товаров', v1: 'Опишите, какой дашборд вам нужен', v2: 'Опишите, какие виджеты вы хотите видеть на дашборде', v3: 'Опишите, какие виджеты вы хотите видеть на дашборде' };
  let variants = [], vi = 0, titleTouched = false;           // варианты ответа текущего промта и номер показанного

  // Пробуем подцепить экспорт дашборда из Figma
  const img = new Image(); img.onload = () => document.querySelector('.dash-existing').style.setProperty('--dash-img', 'url(assets/dashboard.png)');
  img.src = 'assets/dashboard.png';
  const gif = new Image(); gif.onerror = () => document.querySelector('.gen__img img')?.remove(); gif.src = 'assets/gen.gif';

  const show = (el, on) => el.hidden = !on;
  const closePopups = () => { show($('modelPopup'), false); $('modelBtn').classList.remove('is-open'); };

  // Список: заготовки (Figma 11:373) и история. По ховеру — кнопка «закрепить»; крестик только у истории
  // «Закрепить / Открепить»: закреплённая запись уходит наверх списка (новая закреплённая — самая верхняя), открепили — возвращается на своё место.
  // items хранит порядок «на своих местах»; серая строка «Собери свой дашборд» всегда последняя, записи истории ложатся над ней
  const items = []; let pinSeq = 0;
  const renderList = () => {
    const pinned = items.filter(i => i.pin).sort((a, b) => b.pin - a.pin);
    [...pinned, ...items.filter(i => !i.pin)].forEach(i => $('presets').append(i.el));
  };
  function addItem(p) {
    const it = document.createElement('div');
    it.className = 'pitem' + (p.other ? ' is-other' : '') + (p.user ? ' is-user' : '');
    it.innerHTML = '<span class="pitem__t"></span><span class="pitem__acts">' +
      '<span class="pitem__b pitem__b--pin" title="Закрепить"><i class="ic ic-16">&#xE97C;</i></span>' +
      '<span class="pitem__b pitem__b--del" title="Удалить"><i class="ic ic-16">&#xE65C;</i></span></span>';
    it.querySelector('.pitem__t').textContent = p.text;
    const o = { el: it, pin: 0, other: !!p.other };
    const pinBtn = it.querySelector('.pitem__b--pin');
    pinBtn.onclick = e => {
      e.stopPropagation();
      o.pin = o.pin ? 0 : ++pinSeq;
      it.classList.toggle('is-pinned', !!o.pin);
      pinBtn.title = o.pin ? 'Открепить' : 'Закрепить';
      pinBtn.firstChild.textContent = o.pin ? '\uEA09' : '\uE97C';
      renderList();
    };
    it.querySelector('.pitem__b--del').onclick = e => { e.stopPropagation(); items.splice(items.indexOf(o), 1); it.remove(); };
    it.onclick = () => {
      if (p.other) { input.value = ''; row.value = ''; titleTouched = false; view('sub'); input.focus(); }
      else run(p.prompt || p.text, p.text);
    };
    const at = items.findIndex(i => i.other);
    if (at >= 0 && !p.other) items.splice(at, 0, o); else items.push(o);
    renderList();
    return it;
  }
  PRESETS.forEach(p => addItem(p));

  // Чипсы (вариант 2) / кнопки-ссылки (вариант 3): клик ставит текст в поле, в шапке появляется кнопка запуска
  function buildChips() {
    const box = $('chips'), links = entry === 'v3';
    box.className = 'gpt__chips' + (links ? ' is-links' : '');
    box.innerHTML = '';
    CHIPS.forEach(t => {
      const b = document.createElement('button');
      b.className = links ? 'lnk' : 'chip'; b.textContent = t;
      b.onclick = () => { input.value = t; grow(); sync(); input.focus(); };
      box.append(b);
    });
  }

  // центр конструктора (всей сцены) в координатах скрима
  const mid = () => {
    const st = $('stage').getBoundingClientRect(), w = win.getBoundingClientRect(), k = st.width / 1600;
    return { x: (st.left + st.width / 2 - w.left) / k, y: (st.top + st.height / 2 - w.top) / k };
  };
  // Экраны окна: list — список, sub — «провал» в свой промт, load — генерация (2–3 с), result — предпросмотр
  const view = v => {
    cur = v; clearTimeout(timer);
    show($('gptBody'), v === 'list'); show($('promptZone'), v !== 'list');
    // подсказка / чипсы показываются до замера высоты окна, иначе центр считается по окну без них
    input.placeholder = PH[entry];
    show($('hint'), v === 'sub' && entry === 'v1');
    show($('chips'), v === 'sub' && (entry === 'v2' || entry === 'v3'));
    show($('genZone'), v === 'load'); show($('resultPrev'), v === 'result');
    // повторная генерация («другой ответ») идёт в окне размера результата, чтобы оно не прыгало
    const wide = v === 'result' || (v === 'load' && variants.length > 0);
    gpt.classList.toggle('gpt--wide', wide);
    // положение по вертикали: пока выбираем/вводим промт — не меняется, с результатом окно уходит в центр дашборда
    // «якорь» берётся один раз — при первом открытии по центру; дальше окно стоит там же (запись истории или её удаление его не двигают)
    gpt.dataset.entry = entry; gpt.dataset.view = v;
    if (baseTop === null && !win.hidden && (v === 'list' || (v === 'sub' && entry !== 'sabydoc'))) {
      if (anchors[entry] == null) {
        // окно ввода стоит ровно по центру конструктора (отступ сверху = отступ снизу); при генерации верх остаётся на месте
        anchors[entry] = Math.max(24, (entry === 'sabydoc' ? win.clientHeight / 2 : mid().y) - gpt.offsetHeight / 2);
      }
      baseTop = Math.max(24, Math.min(anchors[entry], win.clientHeight - gpt.offsetHeight - 24));
    }
    // в вариантах пустого окно центрируется по конструктору целиком (центр сцены), а не по дашборду
    gpt.style.left = entry === 'sabydoc' ? '' : (mid().x - win.clientWidth / 2) + 'px';
    gpt.style.marginTop = (wide ? Math.max(24, (entry === 'sabydoc' ? win.clientHeight / 2 : mid().y) - gpt.offsetHeight / 2) : baseTop) + 'px';
    input.readOnly = v === 'load' || v === 'result';

    row.readOnly = v === 'load';
    if (v === 'sub' && !titleTouched) row.value = '';
    show($('refreshBtn'), v === 'result'); show($('doneBtn'), v === 'result');
    show($('variants'), v === 'result' && variants.length > 1);
    renderVariant(); sync(); closePopups();
  };
  const sync = () => show(launch, cur === 'sub' && !!(input.value.trim() || row.value.trim()));
  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; };
  const open = on => {
    show(win, on); btn.classList.toggle('is-open', on); closePopups();
    if (on) {
      input.value = ''; row.value = ''; input.style.height = ''; baseTop = null; variants = []; vi = 0; titleTouched = false;
      if (entry === 'v2' || entry === 'v3') buildChips();
      gpt.style.transition = 'none'; view(entry === 'sabydoc' ? 'list' : 'sub'); gpt.offsetHeight; gpt.style.transition = '';
      if (entry !== 'sabydoc') input.focus();
    } else clearTimeout(timer);
  };
  btn.onclick = () => open(win.hidden);
  $('gptClose').onclick = () => open(false);          // крестик: закрыть без сохранений

  // «назад»: из генерации/результата — к редактированию промта, из ввода — к списку
  $('backBtn').onclick = () => { if (cur === 'sub') view('list'); else { view('sub'); input.focus(); } };
  input.oninput = () => { sync(); grow(); };
  row.oninput = () => { titleTouched = true; sync(); };
  input.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!launch.hidden) launch.click(); } };
  row.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); if (cur === 'sub') { if (!launch.hidden) launch.click(); } else row.blur(); } };

  // Запуск: промт — из белого поля (или из верхней строки, если белое пустое)
  launch.onclick = () => {
    const text = input.value.trim() || row.value.trim();
    run(text, titleTouched && row.value.trim() ? row.value.trim() : text);
  };
  $('refreshBtn').onclick = () => generate();                       // «другой ответ» — новая генерация
  $('stopBtn').onclick = () => { if (variants.length) view('result'); else { view('sub'); input.focus(); } };

  function run(text, title) {
    input.value = text; row.value = title; grow();
    titleTouched = title !== text;
    variants = []; vi = 0;
    generate();
  }
  function generate() {
    view('load');
    timer = setTimeout(() => {
      variants.push({ src: IMGS[variants.length % IMGS.length], row: variants.length % IMGS.length });
      vi = variants.length - 1;
      view('result');
    }, 2000 + Math.random() * 1000);   // имитация генерации 2–3 с
  }

  // Показанный вариант и переключатель вариантов в шапке (Figma 109:10059)
  const resImg = $('resultImg'), prev = $('resultPrev');
  resImg.onload = () => prev.classList.remove('is-empty');
  resImg.onerror = () => prev.classList.add('is-empty');
  function renderVariant() {
    if (!variants.length) return;
    const src = variants[vi].src;
    if (resImg.getAttribute('src') !== src) resImg.setAttribute('src', src);
    $('varCount').textContent = (vi + 1) + ' / ' + variants.length;
    $('varPrev').disabled = vi === 0; $('varNext').disabled = vi === variants.length - 1;
  }
  $('varPrev').onclick = () => { if (vi > 0) { vi--; renderVariant(); } };
  $('varNext').onclick = () => { if (vi < variants.length - 1) { vi++; renderVariant(); } };

  // Ряд из сгенерированного варианта: каждый виджет вырезан из картинки (фон ячейки — его кусок), у ячеек своё наведение и свой пунктир
  // Два верхних виджета лежат в своей строке (своя пунктирная сетка), остальные — в другой: общей обводки у них нет
  function buildRow(R) {
    const top = R.cells.filter(c => c.t < 1), rest = R.cells.filter(c => c.t >= 1);
    const wrap = document.createElement('div');
    wrap.className = 'rgroup';
    const part = (cells, y0, y1, ratio, lines) => {
      const el = document.createElement('div');
      el.className = 'rrow'; el.style.aspectRatio = ratio; el._lines = lines;
      cells.forEach(c => {
        const d = document.createElement('div');
        d.className = 'wcell rcell';
        d.style.cssText = `left:${c.l}%;top:${(c.t - y0 * 100) / (y1 - y0)}%;width:${c.pw}%;height:${c.ph / (y1 - y0)}%;background-image:url(${R.src});` +
          `background-size:${R.W / c.w * 100}% ${R.H / c.h * 100}%;background-position:${c.w === R.W ? 0 : c.x / (R.W - c.w) * 100}% ${c.h === R.H ? 0 : c.y / (R.H - c.h) * 100}%`;
        el.append(d);
      });
      wrap.append(el);
    };
    const yb = cs => Math.max(...cs.map(c => c.t + c.ph)) / 100, yt = cs => Math.min(...cs.map(c => c.t)) / 100;
    const hA = yb(top), tB = yt(rest), bB = yb(rest), e = 0.002;
    const cut = (y0, y1) => R.lines.filter(l => l[1] >= y0 - e && l[3] <= y1 + e && l[1] !== l[3])
      .map(l => [l[0], (l[1] - y0) / (y1 - y0), l[2], (l[3] - y0) / (y1 - y0)]);
    part(top, 0, hA, R.ratio / hA, cut(0, hA));
    part(rest, tB, bB, R.ratio / (bB - tB), cut(tB, bB));
    requestAnimationFrame(drawGrid);
    return wrap;
  }

  // Отменить / Повторить на верхней панели: левая убирает последнюю вставку (дашборд как был), правая возвращает сгенерированный
  const applied = [], redone = [];
  const syncUndo = () => { $('undoBtn').classList.toggle('is-disabled', !applied.length); $('redoBtn').classList.toggle('is-disabled', !redone.length); };
  const toBottom = () => { const g = $('currentGrid'); requestAnimationFrame(() => g.scrollTo({ top: g.scrollHeight, behavior: 'smooth' })); };
  $('undoBtn').onclick = () => { const el = applied.pop(); if (!el) return; el.remove(); redone.push(el); syncUndo(); };
  $('redoBtn').onclick = () => { const el = redone.pop(); if (!el) return; $('insertedGrid').append(el); applied.push(el); syncUndo(); requestAnimationFrame(drawGrid); toBottom(); };

  // Сброс (третья кнопка): дашборд возвращается в изначальное состояние — убираем все вставленные ряды, отмена/повтор очищаются
  $('resetBtn').onclick = () => {
    if (!win.hidden) open(false);
    $('insertedGrid').innerHTML = '';
    applied.length = 0; redone.length = 0; syncUndo();
    $('currentGrid').scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Зелёная галка: вставляем показанный вариант вниз текущего дашборда, промт уходит в историю под названием из верхней строки
  $('doneBtn').onclick = () => {
    const rowEl = buildRow(ROWS[variants[vi].row]);
    $('insertedGrid').append(rowEl);
    applied.push(rowEl); redone.length = 0; syncUndo();
    const title = row.value.trim() || input.value.trim();
    const dup = [...document.querySelectorAll('#presets .pitem.is-user .pitem__t')].some(n => n.textContent === title);
    if (!dup && entry === 'sabydoc') addItem({ text: title, prompt: input.value.trim(), user: true });
    open(false);
    toBottom();
  };

  // Выбор модели: клик по «SabyGPT» в шапке окна открывает попап (Figma 19:15110)
  let model = MODELS[0].n;
  const mp = $('modelPopup');
  const renderModels = () => {
    mp.querySelectorAll('.mitem').forEach(n => n.remove());
    MODELS.forEach(m => {
      const b = document.createElement('div');
      b.className = 'mitem' + (m.n === model ? ' is-selected' : '');
      b.innerHTML = '<i class="mitem__i"></i><span class="mitem__t"></span>' + (m.n === model ? '<i class="mitem__dot"></i>' : '<i class="mitem__sp"></i>');
      b.querySelector('.mitem__i').textContent = m.g; b.querySelector('.mitem__t').textContent = m.n;
            b.onclick = e => { e.stopPropagation(); model = m.n; $('modelName').textContent = m.n; $('modelIcon').textContent = m.g; closePopups(); };
      mp.append(b);
    });
  };
  $('modelBtn').onclick = e => { e.stopPropagation(); const on = mp.hidden; closePopups(); if (on) { renderModels(); show(mp, true); $('modelBtn').classList.add('is-open'); } };
  $('modelPopupX').onclick = e => { e.stopPropagation(); closePopups(); };
  mp.onclick = e => e.stopPropagation();

  document.addEventListener('click', closePopups);

/* Пунктир по границе сетки и по центру между колонками рисуется SVG с crispEdges: ровно 1 физический пиксель экрана при любом масштабе демки
   (CSS-границы и фоны привязываются к пикселям макета и после масштабирования становятся то 1, то 2 px) */
let demoScale = 1;
const dpr = () => window.devicePixelRatio || 1;
const SVGNS = 'http://www.w3.org/2000/svg';
function drawGrid() {
  document.querySelectorAll('.dash-existing, .rrow').forEach(g => {
    if (!g._ro && window.ResizeObserver) { g._ro = new ResizeObserver(drawGrid); g._ro.observe(g); }
    let s = g.querySelector('.dash-lines');
    if (!s) {
      s = document.createElementNS(SVGNS, 'svg');
      s.setAttribute('class', 'dash-lines');
      s.setAttribute('shape-rendering', 'crispEdges');
      g.appendChild(s);
    }
    const r = g.getBoundingClientRect();
    const W = r.width / demoScale, H = r.height / demoScale;   // размеры в px макета
    const p = 1 / (demoScale * dpr());                          // 1 физический пиксель в px макета
    s.setAttribute('width', W); s.setAttribute('height', H); s.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    // рамка сетки; внутри — центр между колонками (у основного дашборда) или середины зазоров между вырезанными виджетами (у ряда результата)
    const L = [[p / 2, 0, p / 2, H], [W - p / 2, 0, W - p / 2, H], [0, p / 2, W, p / 2], [0, H - p / 2, W, H - p / 2]];
    if (g._lines) g._lines.forEach(([x1, y1, x2, y2]) => L.push([x1 * W, y1 * H, x2 * W, y2 * H]));
    else L.push([W / 2, 0, W / 2, H]);
    s.innerHTML = '';
    L.forEach(([x1, y1, x2, y2]) => {
      const l = document.createElementNS(SVGNS, 'line');
      l.setAttribute('x1', x1); l.setAttribute('y1', y1); l.setAttribute('x2', x2); l.setAttribute('y2', y2);
      l.setAttribute('stroke-width', p); l.setAttribute('stroke-dasharray', '4 4');
      s.appendChild(l);
    });
  });
}
window.addEventListener('load', drawGrid);

  DemoFrame.mount({
    stage: document.getElementById('stage'),
    top: 4,
    onScale: (k) => {
      demoScale = k;
      // сдвиг сцены — в целые физические пиксели: на дробной позиции слой размазывается между пикселями и тонкие линии теряют чёткость
      const st = document.getElementById('stage');
      st.style.transform = st.style.transform.replace(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/, (m, a, b) => 'translate(' + Math.round(a * dpr()) / dpr() + 'px, ' + Math.round(b * dpr()) / dpr() + 'px)');
      drawGrid();
    },
    scenarios: [
      { id: 'sabydoc', title: 'Как в Sabydoc' },
      { group: 'Варианты пустого', items: [{ id: 'v1', title: 'Одно поле с подсказкой' }, { id: 'v2', title: 'Одно поле с чипсами' }, { id: 'v3', title: 'Одно поле с кнопками-ссылками' }] }
    ],
    value: { scenario: 'sabydoc' },
    onChange: v => { entry = v.scenario; if (!win.hidden) open(false); },   // точка входа в генерацию; открытое окно закрываем, чтобы оно открылось уже по новому сценарию
    links: [{ title: 'Макет в Figma', href: 'https://www.figma.com/proto/WbLZOk7jbsIlxgK6OVO10b/%D0%93%D0%B5%D0%BD%D0%B5%D1%80%D0%B0%D1%86%D0%B8%D1%8F-%D0%B4%D0%B0%D1%88%D0%B1%D0%BE%D1%80%D0%B4%D0%BE%D0%B2?node-id=19-7988&p=f&t=AqKOkCHVLElFCeZT-8&scaling=min-zoom&content-scaling=fixed&page-id=0%3A1&starting-point-node-id=19%3A7988&hide-ui=1' }],
    team: [{ label: 'Design', name: 'Авдеев Даниил' }, { label: 'Develop' }]
  });
})();
