/* =========================================================
   AgriSim — Global interactions
   Scroll reveal, nav behavior, count-up, mobile menu, video demo
   ========================================================= */

(() => {
  'use strict';

  /* ---------- Nav: scrolled state ---------- */
  const nav = document.getElementById('nav');
  if (nav) {
    const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 20);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ---------- Mobile menu ---------- */
  const burger = document.getElementById('burger');
  const mPanel = document.getElementById('mPanel');
  const mBackdrop = document.getElementById('mBackdrop');
  const mClose = document.getElementById('mClose');
  const openMenu = () => { mPanel?.classList.add('open'); mBackdrop?.classList.add('open'); document.body.style.overflow = 'hidden'; };
  const closeMenu = () => { mPanel?.classList.remove('open'); mBackdrop?.classList.remove('open'); document.body.style.overflow = ''; };
  burger?.addEventListener('click', openMenu);
  mClose?.addEventListener('click', closeMenu);
  mBackdrop?.addEventListener('click', closeMenu);
  mPanel?.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu));

  /* ---------- Scroll reveal via IntersectionObserver ---------- */
  const revealEls = document.querySelectorAll('.reveal, .reveal-stagger');
  if ('IntersectionObserver' in window && revealEls.length) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('in-view');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });
    revealEls.forEach(el => io.observe(el));
  } else {
    revealEls.forEach(el => el.classList.add('in-view'));
  }

  /* ---------- Count-up numbers ---------- */
  const counters = document.querySelectorAll('[data-count]');
  if (counters.length) {
    const formatNumber = (n) => {
      if (n >= 1000) return Math.round(n / 1000) + 'K';
      return Math.round(n).toString();
    };
    const animateCount = (el) => {
      const target = parseFloat(el.dataset.count);
      const suffix = el.querySelector('small')?.outerHTML || '';
      const duration = 1600;
      const start = performance.now();
      const from = 0;
      const step = (now) => {
        const p = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
        const val = from + (target - from) * eased;
        let display;
        if (target >= 1000) {
          display = (val / 1000).toFixed(val < 10000 ? 1 : 0).replace(/\.0$/, '') + 'K';
        } else {
          display = Math.round(val).toString();
        }
        el.innerHTML = display + suffix;
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    const countIO = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          animateCount(e.target);
          countIO.unobserve(e.target);
        }
      });
    }, { threshold: 0.4 });
    counters.forEach(c => countIO.observe(c));
  }

  /* ---------- Smooth anchor scroll (progressive enhancement) ---------- */
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (id === '#' || id.length < 2) return;
      const el = document.querySelector(id);
      if (!el) return;
      e.preventDefault();
      const navH = 72;
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - navH + 1, behavior: 'smooth' });
    });
  });

  /* ---------- PWA: manifest + service worker registration ---------- */
  if (!document.querySelector('link[rel="manifest"]')) {
    const m = document.createElement('link');
    m.rel = 'manifest';
    m.href = 'manifest.webmanifest';
    document.head.appendChild(m);
  }
  if (!document.querySelector('meta[name="theme-color"]')) {
    const tc = document.createElement('meta');
    tc.name = 'theme-color';
    tc.content = '#2f6b3a';
    document.head.appendChild(tc);
  }
  if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((e) => {
        console.warn('[pwa] SW registration failed:', e.message);
      });
    });
  }

  /* ---------- Subtle parallax on hero image ---------- */
  const heroBgImg = document.querySelector('.hero__bg img');
  if (heroBgImg && window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
    window.addEventListener('scroll', () => {
      const y = window.scrollY;
      if (y < 900) heroBgImg.style.transform = `translateY(${y * 0.2}px) scale(${1 + y * 0.0002})`;
    }, { passive: true });
  }

})();
