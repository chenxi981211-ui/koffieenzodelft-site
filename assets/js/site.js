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
