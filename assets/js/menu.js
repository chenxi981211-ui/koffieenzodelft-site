/* Digital menu card + order-at-your-table.
   Data lives in data/menu.json; the cart lives in localStorage. */
(function () {
  'use strict';

  var CART_KEY = 'kz.cart';
  var TABLE_KEY = 'kz.table';

  var state = {
    menu: null,
    cart: load(CART_KEY, []),
    table: load(TABLE_KEY, null),
    search: '',
    category: 'all',
    diet: null,
    pending: null           // item waiting for its options to be picked
  };

  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };

  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
  }


  function icon(name, cls) {
    return '<svg class="' + (cls || 'ico') + '" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
  }

  function lang() { return document.documentElement.getAttribute('data-lang') || 'nl'; }
  function t(obj) { return obj ? (obj[lang()] || obj.nl || obj.en || '') : ''; }
  function money(n) { return '€ ' + n.toFixed(2).replace('.', ','); }

  /* ── boot ─────────────────────────────────────────────── */
  fetch('data/menu.json')
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      state.menu = data;
      renderChips();
      renderFavourites();
      renderMenu();
      renderNotes();
      renderCart();
      initTable();
    })
    .catch(function (err) {
      var root = $('[data-menu-root]');
      if (root) {
        root.innerHTML = '<p class="menu-loading">' +
          '<span lang="nl">De kaart kon niet geladen worden. Ververs de pagina of vraag ons even.</span>' +
          '<span lang="en">The menu could not be loaded. Refresh the page or just ask us.</span></p>';
      }
      console.error('menu.json', err);
    });

  /* ── table number ─────────────────────────────────────── */
  function initTable() {
    var params = new URLSearchParams(location.search);
    var fromUrl = params.get('tafel') || params.get('table');
    if (fromUrl && /^\d{1,2}$/.test(fromUrl)) {
      state.table = fromUrl;
      save(TABLE_KEY, state.table);
    }
    if (params.get('bestellen') === '1' && !state.table) {
      // arriving from an "order at your table" link: ask in the page, never in a modal
      var ask = $('[data-table-ask]');
      if (ask) ask.hidden = false;
    }
    paintTable();
  }

  function paintTable() {
    var chip = $('[data-table-chip]');
    if (chip) {
      chip.hidden = !state.table;
      var num = $('[data-table-number]');
      if (num) num.textContent = state.table || '—';
    }
    var input = $('[data-table-input]');
    if (input && state.table) input.value = state.table;
  }


  /* ── what guests mention most ─────────────────────────────
     Sourced from the quotes in data/reviews.json, not from sales figures —
     the note under the heading says so plainly. */
  function renderFavourites() {
    var section = document.querySelector('[data-favourites]');
    var list = document.querySelector('[data-fav-list]');
    var fav = state.menu.favourites;
    if (!section || !list || !fav || !fav.items || !fav.items.length) return;

    document.querySelector('[data-fav-title]').innerHTML =
      '<span lang="nl">' + fav.title.nl + '</span><span lang="en">' + fav.title.en + '</span>';
    document.querySelector('[data-fav-note]').innerHTML =
      '<span lang="nl">' + fav.note.nl + '</span><span lang="en">' + fav.note.en + '</span>';
    if (fav.dietNote) {
      document.querySelector('[data-fav-diet]').innerHTML =
        icon('leaf') + '<span lang="nl">' + fav.dietNote.nl + '</span>' +
        '<span lang="en">' + fav.dietNote.en + '</span>';
    }

    list.innerHTML = fav.items.map(function (entry) {
      var item = findItem(entry.id);
      if (!item) return '';
      var art = entry.image
        ? '<figure class="fav__photo"><img src="' + entry.image + '" alt="" loading="lazy"></figure>'
        : '<figure class="fav__photo fav__photo--drawn">' + icon(entry.icon || 'cake', 'ico') + '</figure>';
      return '<article class="fav">' + art +
        '<h3 class="fav__name">' +
          '<span lang="nl">' + item.nl + '</span><span lang="en">' + item.en + '</span>' +
        '</h3>' +
        (entry.quote ? '<p class="fav__quote">\u201c' + entry.quote + '\u201d</p>' : '') +
        '<p class="fav__foot"><span class="fav__price">' + money(item.price) + '</span>' +
          '<button type="button" class="fav__add" data-add="' + item.id + '">' +
            '<span lang="nl">Toevoegen</span><span lang="en">Add</span>' +
          '</button></p>' +
      '</article>';
    }).join('');
    section.hidden = false;
  }

  /* ── rendering: category chips ────────────────────────── */
  function renderChips() {
    var wrap = $('[data-category-chips]');
    if (!wrap) return;
    var cats = [{ id: 'all', nl: 'Alles', en: 'Everything', icon: 'star' }].concat(state.menu.categories);
    wrap.innerHTML = cats.map(function (c) {
      return '<button type="button" class="chip' + (c.id === state.category ? ' is-active' : '') +
        '" data-category="' + c.id + '">' + (c.icon ? icon(c.icon) : '') +
        '<span lang="nl">' + c.nl + '</span><span lang="en">' + c.en + '</span></button>';
    }).join('');
  }

  /* ── rendering: the menu ──────────────────────────────── */
  /* ── searching ────────────────────────────────────────────
     Guests type what they call the thing, not what the card calls it:
     "sandwich" should find the tosti, and a slip like "sandwish" should
     still land. So: match on names, descriptions, category and a list of
     synonyms per item, ignore accents, and allow a small edit distance. */
  function normalise(str) {
    return (str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ');
  }

  function editDistance(a, b) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > 2) return 99;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur[0] = i;
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(
          prev[j] + 1,
          cur[j - 1] + 1,
          prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1)
        );
      }
      for (j = 0; j <= b.length; j++) prev[j] = cur[j];
    }
    return prev[b.length];
  }

  function haystackFor(item) {
    if (item._hay) return item._hay;
    var cat = null;
    state.menu.categories.forEach(function (c) {
      c.items.forEach(function (i) { if (i.id === item.id) cat = c; });
    });
    var parts = [item.nl, item.en, item.id.replace(/-/g, ' ')];
    if (item.desc) parts.push(item.desc.nl, item.desc.en);
    if (item.keywords) parts = parts.concat(item.keywords);
    if (cat) parts.push(cat.nl, cat.en);
    (item.options || []).forEach(function (o) { parts.push(o.nl, o.en); });
    item._hay = normalise(parts.join(' '));
    item._words = item._hay.split(/\s+/).filter(Boolean);
    return item._hay;
  }

  function tokenMatches(token, item) {
    var hay = haystackFor(item);
    if (hay.indexOf(token) !== -1) return true;
    if (token.length < 4) return false;
    var slack = token.length >= 7 ? 2 : 1;
    for (var i = 0; i < item._words.length; i++) {
      var word = item._words[i];
      if (Math.abs(word.length - token.length) > slack) continue;
      if (editDistance(token, word) <= slack) return true;
    }
    return false;
  }

  function itemMatches(item) {
    if (state.diet && (item.diet || []).indexOf(state.diet) === -1) return false;
    if (!state.search) return true;
    var tokens = normalise(state.search).split(/\s+/).filter(Boolean);
    return tokens.every(function (token) { return tokenMatches(token, item); });
  }

  function qtyOf(itemId) {
    return state.cart.reduce(function (sum, line) {
      return line.id === itemId ? sum + line.qty : sum;
    }, 0);
  }

  function dietIcons(item) {
    return (item.diet || []).filter(function (d) { return d === 'vegan'; })
      .map(function (d) {
        var label = t(state.menu.diet[d]);
        return '<span class="item__diet" title="' + label + '" aria-label="' + label + '">' +
          icon('leaf') + '</span>';
      }).join('');
  }

  function renderMenu() {
    var root = $('[data-menu-root]');
    if (!root) return;

    var searching = !!state.search;
    var html = state.menu.categories.filter(function (cat) {
      return searching || state.category === 'all' || state.category === cat.id;
    }).map(function (cat) {
      var items = cat.items.filter(itemMatches);
      if (!items.length) return '';

      return '<section class="menu-section" id="cat-' + cat.id + '">' +
        '<div class="menu-section__head">' +
          '<h2>' + (cat.icon ? icon(cat.icon) : '') +
            '<span lang="nl">' + cat.nl + '</span><span lang="en">' + cat.en + '</span></h2>' +
          (cat.note ? '<p class="menu-section__note">' +
            '<span lang="nl">' + cat.note.nl + '</span><span lang="en">' + cat.note.en + '</span></p>' : '') +
        '</div>' +
        '<div class="menu-grid">' + items.map(itemCard).join('') + '</div>' +
        (cat.extras ? extrasCard(cat) : '') +
      '</section>';
    }).join('');

    root.innerHTML = html;
    var empty = $('[data-menu-empty]');
    if (empty) empty.hidden = !!html;
    paintQuantities();
  }

  function itemCard(item) {
    var qty = qtyOf(item.id);
    // name … dotted leader … price, the way a printed card sets it
    return '<article class="item' + (qty ? ' is-in-cart' : '') + '" data-item="' + item.id + '">' +
      '<div class="item__line">' +
        '<h3 class="item__name">' +
          '<span lang="nl">' + item.nl + '</span><span lang="en">' + item.en + '</span>' +
          dietIcons(item) +
        '</h3>' +
        '<span class="item__leader" aria-hidden="true"></span>' +
        '<span class="item__price">' + money(item.price) + '</span>' +
        '<div class="item__control"></div>' +
      '</div>' +
      (item.desc ? '<p class="item__desc">' +
        '<span lang="nl">' + item.desc.nl + '</span><span lang="en">' + item.desc.en + '</span></p>' : '') +
    '</article>';
  }

  function extrasCard(cat) {
    return '<p class="menu-notes__card" style="margin-top:1rem">' +
      '<strong><span lang="nl">Erbij:</span><span lang="en">Add on:</span></strong> ' +
      cat.extras.map(function (x) {
        return '<span lang="nl">' + x.nl + '</span><span lang="en">' + x.en + '</span> +' + money(x.price).replace('€ ', '€');
      }).join(' · ') + '</p>';
  }

  /* stepper / add button per card */
  function paintQuantities() {
    $$('.item').forEach(function (card) {
      var id = card.dataset.item;
      var qty = qtyOf(id);
      var slot = $('.item__control', card);
      card.classList.toggle('is-in-cart', qty > 0);
      if (!slot) return;
      if (qty > 0) {
        slot.outerHTML = '<div class="item__stepper item__control">' +
          '<button type="button" data-dec="' + id + '" aria-label="Eén minder">−</button>' +
          '<span>' + qty + '</span>' +
          '<button type="button" data-inc="' + id + '" aria-label="Eén meer">+</button>' +
        '</div>';
      } else {
        slot.outerHTML = '<button type="button" class="item__add item__control" data-add="' + id +
          '" aria-label="Toevoegen">+</button>';
      }
    });
  }

  function renderNotes() {
    Object.keys(state.menu.notes).forEach(function (key) {
      var el = $('[data-note="' + key + '"]');
      if (!el) return;
      var note = state.menu.notes[key];
      el.innerHTML = '<span lang="nl">' + note.nl + '</span><span lang="en">' + note.en + '</span>';
    });
  }

  /* ── cart ─────────────────────────────────────────────── */
  function findItem(id) {
    var found = null;
    state.menu.categories.forEach(function (cat) {
      cat.items.forEach(function (item) { if (item.id === id) found = item; });
    });
    return found;
  }

  function linePrice(line) {
    var item = findItem(line.id);
    if (!item) return 0;
    var extra = (line.options || []).reduce(function (sum, optId) {
      var opt = (item.options || []).filter(function (o) { return o.id === optId; })[0];
      return sum + (opt ? opt.price : 0);
    }, 0);
    return (item.price + extra) * line.qty;
  }

  function cartTotal() {
    return state.cart.reduce(function (sum, line) { return sum + linePrice(line); }, 0);
  }
  function cartCount() {
    return state.cart.reduce(function (sum, line) { return sum + line.qty; }, 0);
  }

  function addToCart(id, options) {
    var key = JSON.stringify((options || []).slice().sort());
    var existing = state.cart.filter(function (line) {
      return line.id === id && JSON.stringify((line.options || []).slice().sort()) === key;
    })[0];
    if (existing) existing.qty += 1;
    else state.cart.push({ id: id, qty: 1, options: options || [] });
    persist();
    toast(lang() === 'nl' ? 'Toegevoegd' : 'Added');
  }

  function changeQty(id, delta) {
    // adjust the last matching line, so options stay intact
    for (var i = state.cart.length - 1; i >= 0; i--) {
      if (state.cart[i].id !== id) continue;
      state.cart[i].qty += delta;
      if (state.cart[i].qty <= 0) state.cart.splice(i, 1);
      break;
    }
    persist();
  }

  function persist() {
    save(CART_KEY, state.cart);
    paintQuantities();
    renderCart();
  }

  function renderCart() {
    var count = cartCount();
    var total = cartTotal();

    var bar = $('[data-order-bar]');
    if (bar) bar.hidden = count === 0;
    $$('[data-cart-count]').forEach(function (el) { el.textContent = String(count); });
    $$('[data-cart-total]').forEach(function (el) { el.textContent = money(total); });

    var list = $('[data-cart-list]');
    if (!list) return;
    if (!count) {
      list.innerHTML = '<li class="cart__empty">' +
        '<span lang="nl">Je bestelling is nog leeg — tik op + bij iets lekkers.</span>' +
        '<span lang="en">Your order is still empty — tap + on something tasty.</span>' +
        '<button type="button" class="btn btn--ghost btn--sm" data-close-sheet>' +
        '<span lang="nl">Naar de kaart</span><span lang="en">To the menu</span></button></li>';
      var submit = $('[data-submit-order]');
      if (submit) submit.disabled = true;
      return;
    }
    var submitBtn = $('[data-submit-order]');
    if (submitBtn) submitBtn.disabled = false;

    list.innerHTML = state.cart.map(function (line, index) {
      var item = findItem(line.id);
      if (!item) return '';
      var opts = (line.options || []).map(function (optId) {
        var opt = (item.options || []).filter(function (o) { return o.id === optId; })[0];
        return opt ? t(opt) : '';
      }).filter(Boolean).join(', ');

      return '<li class="cart__row">' +
        '<span class="cart__name"><span lang="nl">' + item.nl + '</span><span lang="en">' + item.en + '</span></span>' +
        '<span class="item__stepper">' +
          '<button type="button" data-line-dec="' + index + '" aria-label="Eén minder">−</button>' +
          '<span>' + line.qty + '</span>' +
          '<button type="button" data-line-inc="' + index + '" aria-label="Eén meer">+</button>' +
        '</span>' +
        '<span class="cart__price">' + money(linePrice(line)) + '</span>' +
        (opts ? '<p class="cart__opts">+ ' + opts + '</p>' : '') +
      '</li>';
    }).join('');
  }

  /* ── options dialog ───────────────────────────────────── */
  function openOptions(item) {
    state.pending = { id: item.id, options: [] };
    var dialog = $('[data-options]');
    $('[data-options-title]').innerHTML =
      '<span lang="nl">' + item.nl + '</span><span lang="en">' + item.en + '</span>';
    $('[data-options-list]').innerHTML = item.options.map(function (opt) {
      return '<label class="option">' +
        '<input type="checkbox" value="' + opt.id + '">' +
        '<span><span lang="nl">' + opt.nl + '</span><span lang="en">' + opt.en + '</span></span>' +
        '<span class="option__price">+' + money(opt.price) + '</span>' +
      '</label>';
    }).join('');
    updateOptionsPrice();
    dialog.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function updateOptionsPrice() {
    var item = findItem(state.pending.id);
    if (!item) return;
    var extra = state.pending.options.reduce(function (sum, optId) {
      var opt = item.options.filter(function (o) { return o.id === optId; })[0];
      return sum + (opt ? opt.price : 0);
    }, 0);
    $('[data-options-price]').textContent = '· ' + money(item.price + extra);
  }

  function closeOptions() {
    $('[data-options]').hidden = true;
    state.pending = null;
    if ($('[data-sheet]').hidden) document.body.style.overflow = '';
  }

  /* ── order sheet ──────────────────────────────────────── */
  function openSheet() {
    var sheet = $('[data-sheet]');
    showView('cart');
    sheet.hidden = false;
    sheet.querySelector('.sheet__panel').style.transform = '';
    document.body.style.overflow = 'hidden';
    var input = $('[data-table-input]');
    if (input && !input.value && state.table) input.value = state.table;
    // a history entry, so the phone's back gesture closes the sheet
    if (!history.state || !history.state.kzSheet) {
      history.pushState({ kzSheet: true }, '');
    }
    var close = sheet.querySelector('.sheet__close');
    if (close) close.focus();
  }

  function closeSheet(fromPopstate) {
    var sheet = $('[data-sheet]');
    if (sheet.hidden) return;
    sheet.hidden = true;
    sheet.querySelector('.sheet__panel').style.transform = '';
    document.body.style.overflow = '';
    if (!fromPopstate && history.state && history.state.kzSheet) history.back();
  }

  window.addEventListener('popstate', function () {
    if (!$('[data-sheet]').hidden) closeSheet(true);
    if (!$('[data-options]').hidden) closeOptions();
  });

  /* swipe the sheet down to dismiss it */
  (function () {
    var panel = null, startY = 0, delta = 0, dragging = false;
    document.addEventListener('touchstart', function (e) {
      var p = e.target.closest('.sheet__panel');
      if (!p || p.scrollTop > 0) return;
      panel = p; startY = e.touches[0].clientY; delta = 0; dragging = true;
      panel.style.transition = 'none';
    }, { passive: true });

    document.addEventListener('touchmove', function (e) {
      if (!dragging) return;
      delta = e.touches[0].clientY - startY;
      if (delta > 0) panel.style.transform = 'translateY(' + delta + 'px)';
    }, { passive: true });

    document.addEventListener('touchend', function () {
      if (!dragging) return;
      dragging = false;
      panel.style.transition = '';
      if (delta > 110) {
        if (panel.closest('[data-options]')) closeOptions();
        else closeSheet();
      }
      panel.style.transform = '';
    });
  })();

  function showView(name) {
    $$('[data-sheet-view]').forEach(function (view) {
      view.hidden = view.dataset.sheetView !== name;
    });
  }

  function submitOrder() {
    var input = $('[data-table-input]');
    var table = (input && input.value.trim()) || state.table;
    if (!table) {
      input.focus();
      toast(lang() === 'nl' ? 'Vul even je tafelnummer in' : 'Please add your table number');
      return;
    }
    state.table = table;
    save(TABLE_KEY, table);
    paintTable();

    var code = 'KZ-' + Math.random().toString(36).slice(2, 5).toUpperCase();
    var order = {
      code: code,
      table: table,
      note: ($('[data-order-note]') || {}).value || '',
      lines: state.cart,
      total: cartTotal(),
      placedAt: new Date().toISOString()
    };
    save('kz.lastOrder', order);
    console.info('Order ready to send to the counter:', order);

    $('[data-order-code]').textContent = code;
    $('[data-ticket-table]').textContent = table;
    showView('done');

    state.cart = [];
    persist();
  }

  /* ── toast ────────────────────────────────────────────── */
  var toastTimer;
  function toast(message) {
    var el = $('[data-toast]');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 1800);
  }

  /* ── events ───────────────────────────────────────────── */
  document.addEventListener('click', function (e) {
    var el;

    if ((el = e.target.closest('[data-category]'))) {
      state.category = el.dataset.category;
      $$('[data-category]').forEach(function (c) { c.classList.toggle('is-active', c === el); });
      renderMenu();
      var toolbar = $('.toolbar');
      if (toolbar && window.scrollY > toolbar.offsetTop) {
        window.scrollTo({ top: toolbar.offsetTop - 60, behavior: 'smooth' });
      }
      return;
    }

    if ((el = e.target.closest('[data-diet]'))) {
      state.diet = state.diet === el.dataset.diet ? null : el.dataset.diet;
      $$('[data-diet]').forEach(function (c) {
        c.classList.toggle('is-active', c.dataset.diet === state.diet);
        c.setAttribute('aria-pressed', String(c.dataset.diet === state.diet));
      });
      renderMenu();
      return;
    }

    if ((el = e.target.closest('[data-add]'))) {
      var item = findItem(el.dataset.add);
      if (item && item.options && item.options.length) openOptions(item);
      else addToCart(el.dataset.add, []);
      return;
    }
    if ((el = e.target.closest('[data-inc]'))) { changeQty(el.dataset.inc, 1); return; }
    if ((el = e.target.closest('[data-dec]'))) { changeQty(el.dataset.dec, -1); return; }

    if ((el = e.target.closest('[data-line-inc]'))) {
      state.cart[+el.dataset.lineInc].qty += 1;
      persist();
      return;
    }
    if ((el = e.target.closest('[data-line-dec]'))) {
      var idx = +el.dataset.lineDec;
      state.cart[idx].qty -= 1;
      if (state.cart[idx].qty <= 0) state.cart.splice(idx, 1);
      persist();
      return;
    }

    if (e.target.closest('[data-confirm-options]')) {
      addToCart(state.pending.id, state.pending.options);
      closeOptions();
      return;
    }
    if (e.target.closest('[data-close-options]')) { closeOptions(); return; }

    if (e.target.closest('[data-open-order]')) { openSheet(); return; }
    if (e.target.closest('[data-close-sheet]')) { closeSheet(); return; }
    if (e.target.closest('[data-submit-order]')) { submitOrder(); return; }

    if (e.target.closest('[data-table-ask-save]')) {
      var askInput = $('#table-ask-input');
      var value = askInput.value.trim();
      if (!value) { askInput.focus(); return; }
      state.table = value;
      save(TABLE_KEY, value);
      $('[data-table-ask]').hidden = true;
      paintTable();
      toast(lang() === 'nl' ? 'Tafel ' + value + ' — bestel maar' : 'Table ' + value + ' — order away');
      return;
    }
    if (e.target.closest('[data-table-ask-skip]')) {
      $('[data-table-ask]').hidden = true;
      return;
    }

    if (e.target.closest('[data-change-table]')) {
      openSheet();
      var tableInput = $('[data-table-input]');
      if (tableInput) { tableInput.focus(); tableInput.select(); }
    }
  });

  document.addEventListener('change', function (e) {
    var box = e.target.closest('[data-options-list] input');
    if (box && state.pending) {
      state.pending.options = $$('[data-options-list] input:checked').map(function (i) { return i.value; });
      updateOptionsPrice();
    }
    var tableInput = e.target.closest('[data-table-input]');
    if (tableInput) {
      var val = tableInput.value.trim();
      if (val) { state.table = val; save(TABLE_KEY, val); paintTable(); }
    }
  });

  var searchInput = $('#menu-search');
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      state.search = searchInput.value.trim();
      if (state.search && state.category !== 'all') {
        state.category = 'all';
        $$('[data-category]').forEach(function (c) {
          c.classList.toggle('is-active', c.dataset.category === 'all');
        });
      }
      renderMenu();
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$('[data-options]').hidden) closeOptions();
    else if (!$('[data-sheet]').hidden) closeSheet();
  });

  /* placeholders + re-render follow the language switch */
  function applyLangBits() {
    $$('[data-placeholder-nl]').forEach(function (el) {
      el.setAttribute('placeholder', el.dataset['placeholder' + (lang() === 'nl' ? 'Nl' : 'En')]);
    });
  }
  document.addEventListener('kz:lang', function () {
    applyLangBits();
    if (state.menu) { renderNotes(); renderCart(); }
  });
  applyLangBits();
})();
