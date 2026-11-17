(() => {
  const $ = id => document.getElementById(id);
  const win = $('gptScrim'), gpt = win.querySelector('.gpt'), btn = $('gptBtn');
  const input = $('promptInput'), row = $('rowInput'), launch = $('launchBtn');
  const IMGS = ['assets/result.png', 'assets/result2.png'];   // предпросмотры результата из Figma (варианты генерации чередуются)
  let cur = 'list', timer = null, baseTop = null, entry = 'sabydoc'; let switching = false, sharedTop = null;
  const anchors = {};                                        // верх окна для каждой точки входа запоминается при первом открытии
  const CHIPS = ['Главные показатели компании', 'Для работы с клиентами', 'Для работы с сотрудниками и задачами', 'Товары и остатки'];
  const PH = { sabydoc: 'Например, нужен дашборд с отображением остатков товаров', v1: 'Опишите, какой дашборд вам нужен', v2: 'Опишите, какие виджеты вы хотите видеть на дашборде', v3: 'Опишите, какие виджеты вы хотите видеть на дашборде' };
  let curItem = null;                                          // пункт списка, из которого запущена текущая генерация (для «Закрепить» в меню)
  let errMode = false;                                          // сценарий «с ошибкой»: свой промт заканчивается ошибкой, заготовки работают как обычно
  let aborted = false;                                          // после «Прервать»: окно ввода, строка справа от «назад» — кнопка с текстом промта
  let presetMode = false;                                      // промт взят из заготовки: строка справа от «назад» — кнопка, не поле
  let variants = [], vi = 0, titleTouched = false;           // варианты ответа текущего промта и номер показанного

  // Пробуем подцепить экспорт дашборда из Figma
  const img = new Image(); img.onload = () => document.querySelector('.dash-existing').style.setProperty('--dash-img', 'url(assets/dashboard.png)');
  img.src = 'assets/dashboard.png';
  const gif = new Image(); gif.onerror = () => document.querySelector('.gen__img img')?.remove(); gif.src = 'assets/gen.gif';

  const show = (el, on) => el.hidden = !on;
  const closePopups = () => { show($('modelPopup'), false); show($('resetPopup'), false); show($('menuPopup'), false); $('modelBtn').classList.remove('is-open'); };

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
    o.toggle = () => {
      o.pin = o.pin ? 0 : ++pinSeq;
      it.classList.toggle('is-pinned', !!o.pin);
      // маркер-фокус внимания: один на весь список — у пункта, с которым действовали последним (закрепили или открепили), живёт, пока не уйдём из списка
      document.querySelectorAll('.pitem.is-marked').forEach(n => n.classList.remove('is-marked'));
      it.classList.add('is-marked');   // и при закреплении, и при откреплении — чтобы не потерять пункт из виду
      pinBtn.title = o.pin ? 'Открепить' : 'Закрепить';
      pinBtn.firstChild.textContent = o.pin ? '\uEA09' : '\uE97C';
      renderList();
    };
    pinBtn.onclick = e => { e.stopPropagation(); o.toggle(); };
    it.querySelector('.pitem__b--del').onclick = e => { e.stopPropagation(); items.splice(items.indexOf(o), 1); it.remove(); };
    it.onclick = () => {
      if (p.other) { presetMode = false; input.value = ''; row.value = ''; titleTouched = false; view('sub'); input.focus(); }
      else { presetMode = true; curItem = o; run(p.prompt || p.text, p.text); }
    };
    const at = items.findIndex(i => i.other);
    if (at >= 0 && !p.other) items.splice(at, 0, o); else items.push(o);
    renderList();
    return it;
  }
  PRESETS.forEach(p => addItem(p));
  // пункт истории для своего промта (без дублей); клик по нему из списка запускает генерацию
  function addUserItem() {
    const title = row.value.trim() || input.value.trim();
    if (!title) return;
    const dup = [...document.querySelectorAll('#presets .pitem.is-user .pitem__t')].some(n => n.textContent === title);
    if (!dup) addItem({ text: title, prompt: input.value.trim(), user: true });
  }

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
    show($('genZone'), v === 'load'); show($('errZone'), v === 'error'); show($('resultPrev'), v === 'result');
    // повторная генерация («другой ответ») идёт в окне размера результата, чтобы оно не прыгало
    const wide = v === 'result' || (v === 'load' && variants.length > 0);
    gpt.classList.toggle('gpt--wide', wide);
    // положение по вертикали: пока выбираем/вводим промт — не меняется, с результатом окно уходит в центр дашборда
    // «якорь» берётся один раз — при первом открытии по центру; дальше окно стоит там же (запись истории или её удаление его не двигают)
    if (v !== 'sub') aborted = false;
    gpt.dataset.entry = entry; gpt.dataset.view = v;
    if (v !== 'list') document.querySelectorAll('.pitem.is-marked').forEach(n => n.classList.remove('is-marked'));
    if (baseTop === null && !win.hidden && (v === 'list' || (v === 'sub' && (entry !== 'sabydoc' || errMode)))) {
      if (entry === 'sabydoc' && !errMode) {
        if (anchors[entry] == null) anchors[entry] = Math.max(24, win.clientHeight / 2 - gpt.offsetHeight / 2);
      } else {
        // варианты пустого: при ручном открытии — свой центраж; при переключении из правой области верх у всех вариантов общий, чтобы окно не прыгало
        anchors[entry] = (switching && sharedTop !== null) ? sharedTop : Math.max(24, (entry === 'sabydoc' ? win.clientHeight / 2 : mid().y) - gpt.offsetHeight / 2);
        if (!switching || sharedTop === null) sharedTop = anchors[entry];
      }
      baseTop = Math.max(24, Math.min(anchors[entry], win.clientHeight - gpt.offsetHeight - 24));
    }
    // в вариантах пустого окно центрируется по конструктору целиком (центр сцены), а не по дашборду
    gpt.style.left = entry === 'sabydoc' ? '' : (mid().x - win.clientWidth / 2) + 'px';
    gpt.style.marginTop = (wide ? Math.max(24, (entry === 'sabydoc' ? win.clientHeight / 2 : mid().y) - gpt.offsetHeight / 2) : baseTop) + 'px';
    input.readOnly = v === 'load' || v === 'result' || v === 'error';

    row.readOnly = v === 'load';
    const pm = v === 'load' || v === 'result' || v === 'error' || (v === 'sub' && aborted);   // и для заготовки, и для своего промта: строка справа от «назад» — кнопка
    gpt.dataset.rowbtn = pm ? '1' : '0'; gpt.dataset.preset = presetMode && (v === 'load' || v === 'result') ? '1' : '0';   $('rowBtn').textContent = row.value;   // у заготовки белое поле с промтом не нужно: текст уже в кнопке справа от «назад»
    show($('menuBtn'), v === 'result' && presetMode);   // меню «три точки» — только для заготовок, у своего промта его нет
    if (v === 'sub' && !titleTouched && !aborted) row.value = '';
    show($('refreshBtn'), v === 'result'); show($('doneBtn'), v === 'result');
    show($('variants'), v === 'result' && variants.length > 1);
    renderVariant(); sync(); closePopups();
  };
  const sync = () => show(launch, cur === 'sub' && !!(input.value.trim() || row.value.trim()));
  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; input.style.overflowY = input.scrollHeight > 140 ? 'auto' : 'hidden'; };   // скролл только когда текст не влезает в 140px
  const open = on => {
    show(win, on); btn.classList.toggle('is-open', on); closePopups();
    if (on) {
      presetMode = false; aborted = false;
      dragX = 0; dragY = 0; applyDrag();   // при новом открытии окно снова по центру
      input.value = ''; row.value = ''; input.style.height = ''; baseTop = null; variants = []; vi = 0; titleTouched = false;
      if (entry === 'v2' || entry === 'v3') buildChips();
      gpt.style.transition = 'none'; view(entry === 'sabydoc' && !errMode ? 'list' : 'sub'); gpt.offsetHeight; gpt.style.transition = '';
      if (entry !== 'sabydoc' || errMode) input.focus();
    } else clearTimeout(timer);
  };
  // Перетаскивание окна за шапку (кроме кнопок): сдвиг хранится отдельно от расчёта положения, поэтому окно остаётся там, куда его унесли
  let dragX = 0, dragY = 0;
  const applyDrag = () => { gpt.style.translate = (dragX || dragY) ? dragX + 'px ' + dragY + 'px' : ''; };
  const head = gpt.querySelector('.gpt__header');
  head.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('button, input, a')) return;
    e.preventDefault();
    const k = $('stage').getBoundingClientRect().width / 1600, sx = e.clientX, sy = e.clientY, x0 = dragX, y0 = dragY;
    head.classList.add('is-dragging'); try { head.setPointerCapture(e.pointerId); } catch (_) {} closePopups();
    const move = ev => {
      dragX = x0 + (ev.clientX - sx) / k; dragY = y0 + (ev.clientY - sy) / k; applyDrag();
      // окно нельзя унести совсем за край: шапка всегда остаётся в зоне видимости
      const g = gpt.getBoundingClientRect(), w = win.getBoundingClientRect(), m = 60;
      if (g.right < w.left + m) dragX += (w.left + m - g.right) / k;
      if (g.left > w.right - m) dragX -= (g.left - (w.right - m)) / k;
      if (g.top < w.top) dragY += (w.top - g.top) / k;
      if (g.top > w.bottom - 40) dragY -= (g.top - (w.bottom - 40)) / k;
      applyDrag();
    };
    const up = () => { head.classList.remove('is-dragging'); head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', up); };
    head.addEventListener('pointermove', move); head.addEventListener('pointerup', up); head.addEventListener('pointercancel', up);
  });

  btn.onclick = () => open(win.hidden);
  // маркер клика: область взаимодействия — 15px вокруг него; курсор внутри — маркер скрыт, вне — показан
  const mark = btn.querySelector('.clickmark');
  document.addEventListener('mousemove', ev => {
    if (!mark || !win.hidden) return;
    const r = mark.getBoundingClientRect(), pad = 15 * (r.width / 54 || 1);
    mark.classList.toggle('is-near', ev.clientX >= r.left - pad && ev.clientX <= r.right + pad && ev.clientY >= r.top - pad && ev.clientY <= r.bottom + pad);
  });
  $('gptClose').onclick = () => open(false);          // крестик: закрыть без сохранений

  // «назад»: из генерации/результата — к редактированию промта, из ввода — к списку
  $('rowBtn').onclick = () => $('backBtn').click();   // кнопка с текстом промта = «назад» (и после «Прервать»: промт уходит в общий список)
  // меню параметров: попап встаёт так, что его крестик (центр на правом краю попапа, 22px от верха) совпадает с кнопкой-вызывателем
  $('menuBtn').onclick = e => {
    e.stopPropagation();
    const mp2 = $('menuPopup'), on = mp2.hidden; closePopups();
    if (!on) return;
    const pinned = !!(curItem && curItem.pin), pinRow = mp2.querySelector('[data-menu="pin"]');
    pinRow.querySelector('.mitem__t').textContent = pinned ? 'Открепить' : 'Закрепить';
    pinRow.querySelector('.mitem__i').textContent = pinned ? '\uEA09' : '\uE97C';
    show(mp2, true);
    const g = gpt.getBoundingClientRect(), b = $('menuBtn').getBoundingClientRect(), k = g.width / gpt.offsetWidth;
    mp2.style.left = ((b.left + b.width / 2 - g.left) / k - mp2.offsetWidth) + 'px';
    mp2.style.top = ((b.top + b.height / 2 - g.top) / k - 22) + 'px';
  };
  $('menuPopupX').onclick = e => { e.stopPropagation(); closePopups(); };
  $('menuPopup').onclick = e => e.stopPropagation();
  document.querySelectorAll('#menuPopup [data-menu]').forEach(n => n.onclick = e => {
    e.stopPropagation(); closePopups();
    if (n.dataset.menu === 'pin' && curItem) curItem.toggle();   // то же, что скрепка в общем списке
  });
  $('backBtn').onclick = () => {
    if (cur === 'sub') {
      if (aborted && entry === 'sabydoc') addUserItem();   // прерванный промт попадает в общий список как «сгенерированный» вариант
      view('list');
    }
    else if (presetMode || ((cur === 'result' || cur === 'load') && entry === 'sabydoc')) {   // из заготовки, а также во время генерации и из готового результата своего промта — в общий список
      if (!presetMode) addUserItem();   // свой сгенерированный вариант попадает в список
      clearTimeout(timer); presetMode = false; input.value = ''; row.value = ''; input.style.height = ''; titleTouched = false; variants = []; vi = 0;
      baseTop = parseFloat(gpt.style.marginTop) || baseTop;   // окно остаётся на той же высоте, что и после генерации; при новом открытии снова центрируется
      gpt.style.transition = 'none'; view('list'); gpt.offsetHeight; gpt.style.transition = '';   // без анимации сжатия
    } else { view('sub'); input.focus(); }
  };
  input.oninput = () => { sync(); grow(); };
  row.oninput = () => { titleTouched = true; sync(); };
  // Enter в поле промта — перенос строки (по умолчанию); генерация запускается только кнопкой в шапке
  row.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); if (cur === 'sub') input.focus(); else row.blur(); } };   // Enter в верхней строке — к полю промта, без запуска

  // Запуск: промт — из белого поля (или из верхней строки, если белое пустое)
  launch.onclick = () => {
    presetMode = false;
    const text = input.value.trim() || row.value.trim();
    run(text, titleTouched && row.value.trim() ? row.value.trim() : text);
  };
  $('errEdit').onclick = () => { aborted = true; view('sub'); grow(); input.focus(); const n = input.value.length; input.setSelectionRange(n, n); };   // «Измените» описание
  $('errRetry').onclick = () => generate();                       // «повторите» генерацию
  $('refreshBtn').onclick = () => generate();                       // «другой ответ» — новая генерация
  $('stopBtn').onclick = () => {
    clearTimeout(timer);
    if (variants.length) view('result');
    else { presetMode = false; aborted = true; view('sub'); grow(); }   // область генерации уходит, окно остаётся на месте, промт — в кнопке справа от «назад»
  };

  function run(text, title) {
    input.value = text; row.value = title; grow();
    titleTouched = title !== text;
    variants = []; vi = 0;
    generate();
  }
  function generate() {
    view('load');
    timer = setTimeout(() => {
      if (errMode && !presetMode) { view('error'); return; }   // сценарий «с ошибкой»: свой промт — «виджеты не найдены», заготовки — успех
      variants.push({ src: IMGS[variants.length % IMGS.length], row: variants.length % IMGS.length });
      vi = variants.length - 1;
      view('result');
    }, presetMode ? 1000 + Math.random() * 1000 : 3000 + Math.random() * 2000);   // имитация генерации: заготовка 1–2 с, свой промт 3–5 с
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
  const syncUndo = () => { $('undoBtn').classList.toggle('is-disabled', !applied.length); $('redoBtn').classList.toggle('is-disabled', !redone.length); $('resetBtn').classList.toggle('is-disabled', !applied.length); };
  const toBottom = () => { const g = $('currentGrid'); requestAnimationFrame(() => g.scrollTo({ top: g.scrollHeight, behavior: 'smooth' })); };
  $('undoBtn').onclick = () => { const el = applied.pop(); if (!el) return; el.remove(); redone.push(el); syncUndo(); };
  $('redoBtn').onclick = () => { const el = redone.pop(); if (!el) return; $('insertedGrid').append(el); applied.push(el); syncUndo(); requestAnimationFrame(drawGrid); toBottom(); };

  // Сброс (третья кнопка): одним кликом возвращает дашборд к состоянию до любых генераций (вместо многих «Отменить»); после сброса серая, как и пока генераций не было
  const clearDash = behavior => {
    $('insertedGrid').innerHTML = '';
    applied.length = 0; redone.length = 0; syncUndo();
    $('currentGrid').scrollTo({ top: 0, behavior });
  };
  const doReset = () => {
    if (!applied.length) return;
    if (!win.hidden) open(false);
    clearDash('smooth');
  };
  // клик по кнопке сброса поднимает меню «Сбросить изменения»; любой пункт возвращает дашборд в стартовое состояние
  $('resetBtn').onclick = e => {
    e.stopPropagation();
    if ($('resetBtn').classList.contains('is-disabled')) return;
    const on = $('resetPopup').hidden; closePopups(); show($('resetPopup'), on);
  };
  $('resetPopupX').onclick = e => { e.stopPropagation(); closePopups(); };
  $('resetPopup').onclick = e => e.stopPropagation();
  document.querySelectorAll('#resetPopup [data-reset]').forEach(n => n.onclick = e => { e.stopPropagation(); closePopups(); doReset(); });

  // Зелёная галка: вставляем показанный вариант вниз текущего дашборда, промт уходит в историю под названием из верхней строки
  $('doneBtn').onclick = () => {
    const rowEl = buildRow(ROWS[variants[vi].row]);
    $('insertedGrid').append(rowEl);
    applied.push(rowEl); redone.length = 0; syncUndo();
    if (entry === 'sabydoc') addUserItem();
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
    fixedScale: 1,   // демо всегда в натуральную величину: сцена 1600×900, панель 300 — одинаково в любом браузере
    onScale: (k) => {
      demoScale = k;
      // сдвиг сцены — в целые физические пиксели: на дробной позиции слой размазывается между пикселями и тонкие линии теряют чёткость
      const st = document.getElementById('stage');
      st.style.transform = st.style.transform.replace(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/, (m, a, b) => 'translate(' + Math.round(a * dpr()) / dpr() + 'px, ' + Math.round(b * dpr()) / dpr() + 'px)');
      drawGrid();
    },
    scenarios: [
      { id: 'sabydoc', title: 'Как в Sabydoc' },
      { id: 'sabydoc_err', title: 'С ошибкой генерации', indent: 20 },
      { group: 'Варианты пустого', items: [{ id: 'v1', title: 'Одно поле с подсказкой' }, { id: 'v2', title: 'Одно поле с чипсами' }, { id: 'v3', title: 'Одно поле с кнопками-ссылками' }] }
    ],
    value: { scenario: 'sabydoc' },
    onChange: v => { if (applied.length) clearDash('auto'); errMode = v.scenario === 'sabydoc_err'; entry = errMode ? 'sabydoc' : v.scenario; if (!win.hidden) open(false); if (entry !== 'sabydoc' || errMode) { switching = true; open(true); switching = false; } },   // «Варианты пустого» показываем сразу с поднятым окном; остальные — окно закрыто, по клику на кнопку
    links: [{ title: 'Макет в Figma', href: 'https://www.figma.com/proto/WbLZOk7jbsIlxgK6OVO10b/%D0%93%D0%B5%D0%BD%D0%B5%D1%80%D0%B0%D1%86%D0%B8%D1%8F-%D0%B4%D0%B0%D1%88%D0%B1%D0%BE%D1%80%D0%B4%D0%BE%D0%B2?node-id=19-7988&p=f&t=AqKOkCHVLElFCeZT-8&scaling=min-zoom&content-scaling=fixed&page-id=0%3A1&starting-point-node-id=19%3A7988&hide-ui=1' }],
    team: [{ label: 'Design', name: 'Авдеев Даниил' }, { label: 'Develop' }]
  });
})();
