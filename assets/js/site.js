/* Shared site behaviour: language, navigation, scroll reveals. */
(function () {
  'use strict';

  var LANG_KEY = 'kz.lang';
  var root = document.documentElement;

  /* ── language ─────────────────────────────────────────── */
  function setLang(lang) {
    root.setAttribute('data-lang', lang);
    root.setAttribute('lang', lang);
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) { /* private mode */ }
    document.querySelectorAll('[data-set-lang]').forEach(function (btn) {
      var on = btn.dataset.setLang === lang;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
    document.dispatchEvent(new CustomEvent('kz:lang', { detail: { lang: lang } }));
  }

  var stored = null;
  try { stored = localStorage.getItem(LANG_KEY); } catch (e) { /* ignore */ }
  var prefersDutch = (navigator.language || 'nl').toLowerCase().indexOf('nl') === 0;
  setLang(stored || (prefersDutch ? 'nl' : 'en'));

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-set-lang]');
    if (btn) setLang(btn.dataset.setLang);
  });

  /* ── mobile nav ───────────────────────────────────────── */
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.focus();
      }
    });
  }

  /* ── sticky header state ──────────────────────────────── */
  var header = document.querySelector('.site-header');
  if (header) {
    var onScroll = function () {
      header.classList.toggle('is-stuck', window.scrollY > 40);
    };
    var measure = function () {
      root.style.setProperty('--header-h', header.offsetHeight + 'px');
    };
    onScroll();
    measure();
    window.addEventListener('scroll', function () { onScroll(); measure(); }, { passive: true });
    window.addEventListener('resize', measure);
  }

  /* ── reveal on scroll ─────────────────────────────────── */
  var reveals = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window) ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    reveals.forEach(function (el) { el.classList.add('is-in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    reveals.forEach(function (el, i) {
      el.style.transitionDelay = (i % 4) * 70 + 'ms';
      io.observe(el);
    });
  }


  /* ── shared data loading ──────────────────────────────────
     The single-file build inlines these as <script type="application/json">;
     the normal site fetches them. Either way the callers see a promise. */
  function loadData(id, path) {
    var inline = document.getElementById(id);
    if (inline) {
      try { return Promise.resolve(JSON.parse(inline.textContent)); }
      catch (e) { return Promise.reject(e); }
    }
    return fetch(path).then(function (r) {
      if (!r.ok) throw new Error(path + ': HTTP ' + r.status);
      return r.json();
    });
  }
  window.kzLoadData = loadData;

  /* ── opening hours: the week, plus where we are in it ───── */
  function minutes(hhmm) {
    var bits = hhmm.split(':');
    return parseInt(bits[0], 10) * 60 + parseInt(bits[1], 10);
  }

  function renderHours(data) {
    var list = document.querySelector('[data-hours-list]');
    var statuses = document.querySelectorAll('[data-hours-status]');
    if (!list && !statuses.length) return;

    var now = new Date();
    var today = now.getDay();
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var byDay = {};
    data.week.forEach(function (d) { byDay[d.day] = d; });

    // Monday-first, the way a Dutch shop lists it
    var order = [1, 2, 3, 4, 5, 6, 0];
    if (list) {
      list.innerHTML = order.map(function (day) {
        var d = byDay[day];
        var hours = d.closed
          ? '<span lang="nl">gesloten</span><span lang="en">closed</span>'
          : d.open + '–' + d.close;
        return '<li' + (day === today ? ' class="is-today"' : '') + '>' +
          '<span class="hours__day"><span lang="nl">' + d.nl + '</span>' +
          '<span lang="en">' + d.en + '</span></span>' +
          '<span class="hours__time">' + hours + '</span></li>';
      }).join('');
    }

    if (!statuses.length) return;
    var t = byDay[today];
    var open = t && !t.closed && nowMin >= minutes(t.open) && nowMin < minutes(t.close);
    var soon = t && !t.closed && !open && nowMin < minutes(t.open);
    var next = null;
    for (var i = 1; i <= 7 && !next; i++) {
      var cand = byDay[(today + i) % 7];
      if (cand && !cand.closed) next = cand;
    }

    var nl, en, state;
    if (open) {
      state = 'open';
      nl = 'Nu open — tot ' + t.close;
      en = 'Open now — until ' + t.close;
    } else if (soon) {
      state = 'soon';
      nl = 'Vandaag open vanaf ' + t.open;
      en = 'Open today from ' + t.open;
    } else {
      state = 'closed';
      nl = next ? 'Nu gesloten — ' + next.nl + ' weer open om ' + next.open : 'Nu gesloten';
      en = next ? 'Closed now — open again ' + next.en + ' at ' + next.open : 'Closed now';
    }
    statuses.forEach(function (status) {
      status.dataset.state = state;
      status.innerHTML = '<span class="hours__dot" aria-hidden="true"></span>' +
        '<span lang="nl">' + nl + '</span><span lang="en">' + en + '</span>';
    });
  }

  loadData('hours-data', 'data/hours.json').then(renderHours).catch(function (e) {
    console.warn('hours', e);
  });

  /* ── guest quotes; the section stays away until there are any ── */
  function renderReviews(data) {
    var section = document.querySelector('[data-reviews]');
    var list = document.querySelector('[data-reviews-list]');
    if (!section || !list) return;
    var quotes = (data && data.quotes) || [];
    if (!quotes.length) return;               // nothing to show, nothing to see

    list.innerHTML = quotes.map(function (q) {
      var text = typeof q.text === 'string'
        ? '<span>' + q.text + '</span>'
        : '<span lang="nl">' + (q.text.nl || '') + '</span><span lang="en">' + (q.text.en || '') + '</span>';
      return '<figure class="voice reveal">' +
        '<blockquote>' + text + '</blockquote>' +
        '<figcaption>' + (q.name || '') +
        (q.source ? ' <span class="voice__source">· ' + q.source + '</span>' : '') +
        '</figcaption></figure>';
    }).join('');
    section.hidden = false;

    var link = document.querySelector('[data-reviews-link]');
    if (link && data.source && data.source.url) link.href = data.source.url;

    // a rating badge, but only if a real number was supplied
    var badge = document.querySelector('[data-reviews-rating]');
    var rating = data.rating || {};
    if (badge && rating.score) {
      var full = Math.round(rating.score);
      var stars = '';
      for (var i = 1; i <= 5; i++) stars += i <= full ? '\u2605' : '\u2606';
      badge.innerHTML = '<span class="rating__stars" aria-hidden="true">' + stars + '</span>' +
        '<strong>' + String(rating.score).replace('.', ',') + '</strong>' +
        (rating.count ? '<span class="rating__count">' +
          '<span lang="nl">uit ' + rating.count + ' reviews</span>' +
          '<span lang="en">from ' + rating.count + ' reviews</span></span>' : '');
      badge.hidden = false;
    }
    section.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('is-in'); });
  }

  loadData('reviews-data', 'data/reviews.json').then(renderReviews).catch(function (e) {
    console.warn('reviews', e);
  });


  /* ── contact form ─────────────────────────────────────────
     No server behind this site, so the form composes the message and hands
     it to the visitor's own mail app. Set data-endpoint on the form to POST
     it somewhere instead (Formspree, a worker, your own inbox service). */
  var contactForm = document.querySelector('[data-contact-form]');
  if (contactForm) {
    contactForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var data = new FormData(contactForm);
      var name = (data.get('name') || '').toString().trim();
      var email = (data.get('email') || '').toString().trim();
      var message = (data.get('message') || '').toString().trim();
      var status = contactForm.querySelector('[data-contact-status]');
      var nl = document.documentElement.getAttribute('data-lang') === 'nl';

      if (!name || !message) {
        status.textContent = nl
          ? 'Vul je naam en een bericht in, dan komt het aan.'
          : 'Add your name and a message and it will reach us.';
        status.dataset.state = 'error';
        return;
      }

      var endpoint = contactForm.dataset.endpoint;
      if (endpoint) {
        status.dataset.state = 'sending';
        status.textContent = nl ? 'Versturen…' : 'Sending…';
        fetch(endpoint, {
          method: 'POST',
          headers: { 'Accept': 'application/json' },
          body: data
        }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          contactForm.reset();
          status.dataset.state = 'sent';
          status.textContent = nl
            ? 'Dank je! We lezen het en mailen je terug.'
            : 'Thank you! We read it and will email you back.';
        }).catch(function () {
          status.dataset.state = 'error';
          status.textContent = nl
            ? 'Versturen lukte niet — mail ons gerust op info@koffieenzodelft.nl.'
            : 'That did not send — please email us at info@koffieenzodelft.nl.';
        });
        return;
      }

      var subject = (nl ? 'Bericht via de site — ' : 'Message from the site — ') + name;
      var body = message + '\n\n— ' + name + (email ? ' (' + email + ')' : '');
      window.location.href = 'mailto:info@koffieenzodelft.nl?subject=' +
        encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
      status.dataset.state = 'sent';
      status.textContent = nl
        ? 'Je mailprogramma opent met het bericht erin — even op verzenden drukken.'
        : 'Your mail app opens with the message ready — just hit send.';
    });
  }

  /* ── the map loads only when asked, so Google isn't called on arrival ── */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-load-map]');
    if (!btn) return;
    var card = btn.closest('[data-map]');
    var frame = document.createElement('iframe');
    frame.src = 'https://www.google.com/maps?q=' +
      encodeURIComponent('Koffie & Zo, Peperstraat 17, 2611 CH Delft') + '&output=embed';
    frame.title = 'Koffie & Zo op de kaart';
    frame.loading = 'lazy';
    frame.referrerPolicy = 'no-referrer-when-downgrade';
    frame.className = 'map-card__frame';
    card.innerHTML = '';
    card.appendChild(frame);
    card.classList.add('is-loaded');
  });

  /* ── highlight the section you're reading ─────────────── */
  var sections = Array.prototype.filter.call(
    document.querySelectorAll('main section[id]'),
    function (s) { return document.querySelector('.nav a[href="#' + s.id + '"]'); }
  );
  if (sections.length && 'IntersectionObserver' in window) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        document.querySelectorAll('.nav a').forEach(function (a) { a.classList.remove('is-current'); });
        var link = document.querySelector('.nav a[href="#' + entry.target.id + '"]');
        if (link) link.classList.add('is-current');
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach(function (s) { spy.observe(s); });
  }
})();
