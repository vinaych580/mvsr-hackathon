/* ================================================================
   Mitti Mantra — Auth Module
   Handles Google + Email/Password authentication via Firebase.
   - Auth guard: redirects unauthenticated users to login.html
   - Nav injection: adds user avatar / login button to every page.
   - Exposes window.mmAuth for other scripts.
   ================================================================ */
(function () {
  'use strict';

  const auth = firebase.auth();

  /* ---------- page classification ---------- */
  const page = location.pathname.split('/').pop() || 'index.html';
  const PUBLIC = ['index.html', 'login.html', ''];
  const isPublic = PUBLIC.includes(page);

  /* ---------- auth state ---------- */
  let _ready = false;

  auth.onAuthStateChanged(function (user) {
    _ready = true;

    /* Guard: redirect to login on protected pages */
    if (!user && !isPublic) {
      sessionStorage.setItem('mm_auth_redirect', location.href);
      location.replace('login.html');
      return;
    }

    /* If user is on login page but already signed in, go to dashboard */
    if (user && page === 'login.html') {
      var dest = sessionStorage.getItem('mm_auth_redirect') || 'dashboard.html';
      sessionStorage.removeItem('mm_auth_redirect');
      location.replace(dest);
      return;
    }

    _injectNavAuth(user);

    /* Reveal protected content now that auth has resolved */
    document.querySelectorAll('.auth-pending').forEach(function (el) {
      el.classList.remove('auth-pending');
    });
  });

  /* ---------- nav auth UI injection ---------- */
  function _injectNavAuth(user) {
    var cta = document.querySelector('.nav__cta');
    if (!cta) return;

    /* Remove any previously injected auth element */
    var old = cta.querySelector('.nav-auth');
    if (old) old.remove();

    var el = document.createElement('div');
    el.className = 'nav-auth';

    if (user) {
      var photo = user.photoURL || _avatarFallback(user.displayName || user.email);
      var name = user.displayName || user.email.split('@')[0];
      el.innerHTML =
        '<div class="nav-auth__user">' +
          '<img class="nav-auth__avatar" src="' + _escHtml(photo) + '" alt="" referrerpolicy="no-referrer">' +
          '<span class="nav-auth__name">' + _escHtml(name) + '</span>' +
        '</div>' +
        '<button class="btn btn-ghost btn--sm nav-auth__out">Sign out</button>';
      el.querySelector('.nav-auth__out').addEventListener('click', function () {
        auth.signOut().then(function () { location.href = 'index.html'; });
      });
    } else {
      el.innerHTML = '<a href="login.html" class="btn btn-primary btn--sm">Login</a>';
    }

    /* Insert before the burger button if it exists, otherwise append */
    var burger = cta.querySelector('.nav__burger');
    if (burger) {
      cta.insertBefore(el, burger);
    } else {
      cta.appendChild(el);
    }
  }

  /* ---------- helpers ---------- */
  function _escHtml(s) {
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(s || ''));
    return d.innerHTML;
  }

  function _avatarFallback(name) {
    var initial = (name || '?').charAt(0).toUpperCase();
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36">' +
      '<rect width="36" height="36" rx="18" fill="%232f6b3a"/>' +
      '<text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" ' +
      'fill="white" font-size="16" font-family="Inter,sans-serif">' + initial + '</text></svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  /* ---------- public API ---------- */
  window.mmAuth = {
    currentUser: function () { return auth.currentUser; },
    ready: function () { return _ready; },

    signInWithGoogle: function () {
      var provider = new firebase.auth.GoogleAuthProvider();
      return auth.signInWithPopup(provider);
    },

    signInWithEmail: function (email, password) {
      return auth.signInWithEmailAndPassword(email, password);
    },

    signUpWithEmail: function (email, password) {
      return auth.createUserWithEmailAndPassword(email, password);
    },

    signOut: function () {
      return auth.signOut().then(function () { location.href = 'index.html'; });
    },

    onAuthStateChanged: function (cb) {
      return auth.onAuthStateChanged(cb);
    }
  };
})();
