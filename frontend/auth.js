/**
 * Handles Firebase Authentication and Auth UI (Login Modal, Nav Avatar).
 */
(() => {
  'use strict';

  let currentUser = null;
  let authReady = false;

  const getAuth = () => window.MittiFirebase?.auth;
  const getProvider = () => window.MittiFirebase?.googleProvider;

  // Build the Auth UI modal styles dynamically
  const injectStyles = () => {
    if (document.getElementById('auth-styles')) return;
    const style = document.createElement('style');
    style.id = 'auth-styles';
    style.textContent = `
      .auth-modal {
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.5); backdrop-filter: blur(4px);
        display: none; align-items: center; justify-content: center;
        z-index: 9999; opacity: 0; transition: opacity 0.3s;
      }
      .auth-modal.open { display: flex; opacity: 1; }
      .auth-card {
        background: var(--surface, #fff); border-radius: var(--r-xl, 16px);
        padding: 32px; width: 100%; max-width: 400px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.15); position: relative;
        transform: translateY(20px); transition: transform 0.3s;
      }
      .auth-modal.open .auth-card { transform: translateY(0); }
      .auth-close {
        position: absolute; top: 16px; right: 16px; background: none;
        border: none; cursor: pointer; color: var(--ink-faint, #888);
      }
      .auth-title { font-family: 'Fraunces', serif; font-size: 1.5rem; color: var(--ink); margin: 0 0 8px; text-align: center; }
      .auth-sub { font-size: 0.9rem; color: var(--ink-soft); text-align: center; margin-bottom: 24px; }
      
      .btn-google {
        width: 100%; display: flex; align-items: center; justify-content: center; gap: 10px;
        background: var(--surface); border: 1px solid var(--border, #ddd); color: var(--ink);
        padding: 12px; border-radius: 8px; font-weight: 500; cursor: pointer; transition: background 0.2s;
        margin-bottom: 20px;
      }
      .btn-google:hover { background: var(--bg-soft, #f7f7f7); }
      .btn-google svg { width: 18px; height: 18px; }
      
      .auth-div { display: flex; align-items: center; text-align: center; color: var(--ink-faint); margin-bottom: 20px; font-size: 0.8rem; }
      .auth-div::before, .auth-div::after { content: ''; flex: 1; border-bottom: 1px solid var(--border, #eee); }
      .auth-div::before { margin-right: .5em; }
      .auth-div::after { margin-left: .5em; }
      
      .auth-form { display: flex; flex-direction: column; gap: 14px; }
      .auth-form input {
        padding: 12px; border-radius: 8px; border: 1px solid var(--border, #ccc);
        background: var(--surface); color: var(--ink); font-family: inherit;
      }
      .auth-form button { margin-top: 8px; }
      .auth-switch { text-align: center; font-size: 0.85rem; color: var(--ink-soft); margin-top: 16px; }
      .auth-switch a { color: var(--brand); cursor: pointer; font-weight: 600; text-decoration: none; }
      
      .auth-error { color: #d32f2f; font-size: 0.85rem; text-align: center; margin-bottom: 10px; display: none; }
      
      /* Nav User Avatar */
      .nav-user { position: relative; display: inline-block; }
      .nav-avatar { width: 40px; height: 40px; border-radius: 50%; cursor: pointer; border: 2px solid transparent; transition: border-color 0.2s, transform 0.2s; object-fit: cover; }
      .nav-avatar:hover { border-color: var(--brand); transform: scale(1.04); }
      .nav-avatar--initial {
        display: inline-flex; align-items: center; justify-content: center;
        background: linear-gradient(135deg, var(--brand) 0%, var(--brand-deep) 100%);
        color: #fff; font-weight: 600; font-size: 1rem; font-family: inherit;
        padding: 0; line-height: 1;
      }
      .nav-drop {
        position: absolute; right: 0; top: 120%; background: var(--surface);
        border: 1px solid var(--border, #eee); box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        border-radius: 8px; width: 180px; display: none; flex-direction: column; overflow: hidden;
      }
      .nav-user.active .nav-drop { display: flex; }
      .nav-drop button { text-align: left; padding: 12px 16px; background: none; border: none; cursor: pointer; color: var(--ink); font-size: 0.9rem; }
      .nav-drop button:hover { background: var(--bg-soft, #f7f7f7); }
    `;
    document.head.appendChild(style);
  };

  // Build the DOM
  const injectModal = () => {
    if (document.getElementById('authModal')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="auth-modal" id="authModal">
        <div class="auth-card">
          <button class="auth-close" id="authClose"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
          <h2 class="auth-title" id="authTitle">Welcome Back</h2>
          <p class="auth-sub" id="authSub">Sign in to sync your farm data</p>
          
          <button class="btn-google" id="btnGoogle">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            Continue with Google
          </button>
          
          <div class="auth-div">or continue with email</div>
          
          <div class="auth-error" id="authError"></div>
          
          <form class="auth-form" id="authForm">
            <input type="email" id="authEmail" placeholder="Email address" required>
            <input type="password" id="authPassword" placeholder="Password" required>
            <button type="submit" class="btn btn-primary" id="authSubmit">Sign In</button>
          </form>
          
          <div class="auth-switch">
            <span id="authSwitchText">Don't have an account?</span> 
            <a id="authSwitchBtn">Sign Up</a>
          </div>
        </div>
      </div>
    `);

    // Event listeners
    const modal = document.getElementById('authModal');
    let isSignUp = false;

    document.getElementById('authClose').onclick = () => modal.classList.remove('open');
    modal.onclick = (e) => { if(e.target === modal) modal.classList.remove('open'); }

    document.getElementById('authSwitchBtn').onclick = () => {
      isSignUp = !isSignUp;
      document.getElementById('authTitle').textContent = isSignUp ? "Create Account" : "Welcome Back";
      document.getElementById('authSub').textContent = isSignUp ? "Sign up to track your farm" : "Sign in to sync your farm data";
      document.getElementById('authSubmit').textContent = isSignUp ? "Sign Up" : "Sign In";
      document.getElementById('authSwitchText').textContent = isSignUp ? "Already have an account?" : "Don't have an account?";
      document.getElementById('authSwitchBtn').textContent = isSignUp ? "Sign In" : "Sign Up";
      document.getElementById('authError').style.display = 'none';
    };

    document.getElementById('btnGoogle').onclick = async () => {
      const auth = getAuth();
      if(!auth) return alert("Firebase not initialized. Check your config.");
      try {
        await auth.signInWithPopup(getProvider());
        modal.classList.remove('open');
      } catch (err) {
        showErr(err.message);
      }
    };

    document.getElementById('authForm').onsubmit = async (e) => {
      e.preventDefault();
      const auth = getAuth();
      if(!auth) return alert("Firebase not initialized.");
      const email = document.getElementById('authEmail').value;
      const pwd = document.getElementById('authPassword').value;
      try {
        if (isSignUp) {
          await auth.createUserWithEmailAndPassword(email, pwd);
        } else {
          await auth.signInWithEmailAndPassword(email, pwd);
        }
        modal.classList.remove('open');
      } catch (err) {
        showErr(err.message);
      }
    };
    
    function showErr(msg) {
      const errEl = document.getElementById('authError');
      errEl.textContent = msg;
      errEl.style.display = 'block';
    }
  };

  const updateNavUI = () => {
    const navCta = document.querySelector('.nav__cta');
    if (!navCta) return;
    
    // Remove existing auth related buttons if any
    const existing = navCta.querySelectorAll('.auth-trigger, .nav-user');
    existing.forEach(e => e.remove());

    if (currentUser) {
      // Show User Avatar.
      // If Firebase gave us a photoURL, render an <img>; otherwise render a
      // pure-CSS initials badge so we never depend on inline SVG data URIs
      // (which have bitten us before via quote-escape bugs).
      const initial = (currentUser.displayName || currentUser.email || '?').trim().charAt(0).toUpperCase();
      const avatarHTML = currentUser.photoURL
        ? `<img src="${currentUser.photoURL}" alt="User" class="nav-avatar" id="navAvatar" referrerpolicy="no-referrer">`
        : `<button type="button" class="nav-avatar nav-avatar--initial" id="navAvatar" aria-label="Account menu">${initial}</button>`;

      const userDiv = document.createElement('div');
      userDiv.className = 'nav-user';
      userDiv.innerHTML = `
        ${avatarHTML}
        <div class="nav-drop">
          <button onclick="window.location.href='dashboard.html'">Go to Dashboard</button>
          <hr style="margin:0; border:0; border-top:1px solid var(--border)">
          <button id="btnSignOut">Sign Out</button>
        </div>
      `;
      navCta.prepend(userDiv);

      document.getElementById('navAvatar').onclick = (e) => {
        e.stopPropagation();
        userDiv.classList.toggle('active');
      };
      document.getElementById('btnSignOut').onclick = () => {
        getAuth()?.signOut().then(() => {
          if(window.location.pathname.includes('dashboard')) window.location.href = 'index.html';
        });
      };
      
      // If we're on index, swap the primary CTA to go straight to dashboard
      const ctaBtn = navCta.querySelector('.btn-primary');
      if (ctaBtn && ctaBtn.textContent.includes("Try it free")) {
        ctaBtn.textContent = "Dashboard";
        ctaBtn.href = "dashboard.html";
      }
      
    } else {
      // Show Sign In Button if not on dashboard (dashboard guards itself)
      if (!window.location.pathname.includes('dashboard')) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-primary auth-trigger';
        btn.textContent = 'Sign In';
        btn.style.marginLeft = '8px';
        btn.onclick = () => document.getElementById('authModal').classList.add('open');
        navCta.append(btn);
        
        // Hide standard CTA if not logged in so we promote signing in
        const ctaBtn = navCta.querySelector('.btn-primary:not(.auth-trigger)');
        if (ctaBtn) ctaBtn.style.display = 'none';
      }
    }
  };

  window.MittiAuth = {
    openModal: () => document.getElementById('authModal')?.classList.add('open'),
    getUser: () => currentUser,
    isReady: () => authReady
  };

  // Wait for DOM and Firebase
  document.addEventListener('DOMContentLoaded', () => {
    injectStyles();
    injectModal();

    // Close any open user dropdown when clicking outside. Installed ONCE
    // (previous versions re-attached this inside updateNavUI, causing a
    // listener leak on repeated auth-state changes).
    document.addEventListener('click', (e) => {
      document.querySelectorAll('.nav-user.active').forEach((nu) => {
        if (!nu.contains(e.target)) nu.classList.remove('active');
      });
    });
    
    // Auth Listener
    const initializeAuth = () => {
      const auth = getAuth();
      if (auth) {
        auth.onAuthStateChanged(user => {
          authReady = true;
          currentUser = user;
          if (user && window.MittiUserData) {
             window.MittiUserData.ensureUserProfile(user);
          }
          updateNavUI();
          // Dispatch custom event for dashboard/other scripts to react
          window.dispatchEvent(new CustomEvent('mitti-auth-state', { detail: { user } }));
        });
      }
    };
    
    if (window.MittiFirebase && window.MittiFirebase.auth) {
      initializeAuth();
    } else {
      window.addEventListener('mitti-firebase-ready', initializeAuth);
    }
  });

})();
