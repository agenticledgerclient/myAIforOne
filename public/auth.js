/**
 * auth.js — Shared authentication wrapper for MyAIforOne web UI.
 *
 * When service.auth.enabled is false (default / personal gateway), this script
 * is a no-op. Every page loads it but nothing changes for unlicensed installs.
 *
 * When auth is enabled (shared gateway deployments):
 * - Checks /api/auth/status on load
 * - Shows a login overlay if not authenticated
 * - Stores bearer token in localStorage
 * - Patches window.fetch to auto-attach Authorization header
 * - Handles 401 responses by showing login again
 */

(function () {
  const TOKEN_KEY = "ma1_auth_token";

  function getStoredToken() {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  }

  function storeToken(token) {
    try { if (token) localStorage.setItem(TOKEN_KEY, token); } catch {}
  }

  function clearToken() {
    try { localStorage.removeItem(TOKEN_KEY); } catch {}
  }

  // ── Login overlay ──────────────────────────────────────────────────────────
  function showLoginOverlay(onSuccess) {
    if (document.getElementById("ma1-login-overlay")) return;

    const overlay = document.createElement("div");
    overlay.id = "ma1-login-overlay";
    overlay.style.cssText = [
      "position:fixed;inset:0;z-index:99999",
      "background:rgba(0,0,0,0.85)",
      "display:flex;align-items:center;justify-content:center",
    ].join(";");

    overlay.innerHTML = `
      <div style="background:var(--bg-primary,#0f0f1a);border:1px solid var(--border,#2a2a40);border-radius:14px;padding:32px;width:320px;max-width:90vw">
        <div style="font-size:20px;font-weight:700;color:var(--text-primary,#fff);margin-bottom:6px">Sign In</div>
        <div style="font-size:13px;color:var(--text-muted,#888);margin-bottom:20px">Enter your gateway password to continue</div>
        <input id="ma1-password" type="password" placeholder="Password"
          style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;border:1px solid var(--border,#2a2a40);background:var(--bg-secondary,#1a1a2e);color:var(--text-primary,#fff);font-size:14px;outline:none;margin-bottom:10px"
          onkeydown="if(event.key==='Enter')document.getElementById('ma1-login-btn').click()" />
        <div id="ma1-login-err" style="display:none;color:#f55;font-size:12px;margin-bottom:8px"></div>
        <button id="ma1-login-btn"
          style="width:100%;padding:10px;border-radius:8px;border:none;background:var(--accent,#6366f1);color:#fff;font-size:14px;font-weight:600;cursor:pointer"
          onclick="window._ma1Login()">Sign In</button>
      </div>
    `;
    document.body.appendChild(overlay);

    window._ma1Login = async function () {
      const pw = document.getElementById("ma1-password").value;
      const err = document.getElementById("ma1-login-err");
      err.style.display = "none";
      try {
        const r = await window._ma1RawFetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: pw }),
        });
        const data = await r.json();
        if (!r.ok || !data.token) {
          err.textContent = data.error || "Invalid password";
          err.style.display = "block";
          return;
        }
        storeToken(data.token);
        overlay.remove();
        delete window._ma1Login;
        onSuccess(data.token);
      } catch (e) {
        err.textContent = "Network error: " + e.message;
        err.style.display = "block";
      }
    };

    // Focus password field
    setTimeout(() => document.getElementById("ma1-password")?.focus(), 50);
  }

  // ── Patch window.fetch ─────────────────────────────────────────────────────
  const _originalFetch = window.fetch.bind(window);
  window._ma1RawFetch = _originalFetch; // kept for login endpoint (no auth loop)

  window.fetch = async function (input, init) {
    const token = getStoredToken();
    if (token) {
      init = init || {};
      init.headers = init.headers || {};
      if (init.headers instanceof Headers) {
        if (!init.headers.has("Authorization")) init.headers.set("Authorization", `Bearer ${token}`);
      } else {
        if (!init.headers["Authorization"]) init.headers["Authorization"] = `Bearer ${token}`;
      }
    }

    const response = await _originalFetch(input, init);

    // If 401, clear token and show login overlay
    if (response.status === 401) {
      clearToken();
      return new Promise((resolve) => {
        showLoginOverlay((newToken) => {
          // Retry the original request with the new token
          const retryInit = init || {};
          retryInit.headers = retryInit.headers || {};
          if (retryInit.headers instanceof Headers) {
            retryInit.headers.set("Authorization", `Bearer ${newToken}`);
          } else {
            retryInit.headers["Authorization"] = `Bearer ${newToken}`;
          }
          resolve(_originalFetch(input, retryInit));
        });
      });
    }

    return response;
  };

  // ── On load: check auth status ─────────────────────────────────────────────
  async function initAuth() {
    let status;
    try {
      const r = await _originalFetch("/api/auth/status");
      if (!r.ok) return; // can't reach server — let page handle errors
      status = await r.json();
    } catch {
      return; // network error — don't block the page
    }

    if (!status.authEnabled) return; // auth off — personal gateway, no-op

    if (status.authenticated) return; // already authenticated (unlikely without token, but handles session cookies)

    const existingToken = getStoredToken();
    if (existingToken) {
      // Verify token is still valid
      try {
        const r = await _originalFetch("/api/auth/status", {
          headers: { Authorization: `Bearer ${existingToken}` },
        });
        const data = await r.json();
        if (data.authenticated) return; // token still good
      } catch {}
    }

    // Need to log in
    showLoginOverlay(() => {
      // After login, reload so all page data loads with auth
      window.location.reload();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAuth);
  } else {
    initAuth();
  }
})();
