/**
 * License gate — shows a modal prompting for license key entry
 * if the platform has an invalid or missing license.
 * Include this script on any page that should enforce licensing.
 */
(async function checkLicense() {
  try {
    const res = await fetch('/api/license');
    const data = await res.json();

    // Valid license or no license configured (unlicensed mode) — do nothing
    if (data.valid && !data.error) return;

    // Invalid license — show the modal
    showLicenseModal(data);
  } catch {
    // Can't reach API — don't block, might be loading
  }
})();

function showLicenseModal(licenseData) {
  // Don't show on the admin settings page (they can enter it there)
  if (location.pathname === '/admin') return;

  const overlay = document.createElement('div');
  overlay.id = 'license-modal-overlay';
  overlay.innerHTML = `
    <div style="
      position:fixed;inset:0;z-index:99999;
      background:rgba(0,0,0,0.85);
      display:flex;align-items:center;justify-content:center;
      backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
      font-family:'DM Sans',system-ui,sans-serif;
    ">
      <div style="
        background:var(--bg-surface, #0c1221);
        border:1px solid var(--border-dim, rgba(56,189,248,0.08));
        border-radius:16px;
        padding:40px;
        max-width:480px;
        width:90%;
        box-shadow:0 20px 60px rgba(0,0,0,0.5);
      ">
        <div style="text-align:center;margin-bottom:24px">
          <div style="font-size:32px;margin-bottom:8px">&#9919;</div>
          <h2 style="font-size:20px;font-weight:700;color:var(--text-primary, #fff);margin-bottom:4px">
            MyAIforOne
          </h2>
          <p style="font-size:13px;color:var(--text-muted, #94a3b8)">
            Enter your license key to activate the platform
          </p>
        </div>

        <div style="margin-bottom:16px">
          <input
            id="license-modal-key"
            type="text"
            placeholder="MA1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            style="
              width:100%;padding:12px 14px;
              background:var(--bg-input, rgba(0,0,0,0.35));
              border:1px solid var(--border-dim, rgba(56,189,248,0.08));
              border-radius:10px;
              color:var(--text-primary, #fff);
              font-family:'IBM Plex Mono',monospace;font-size:13px;
              outline:none;transition:border-color 0.2s;
            "
            onfocus="this.style.borderColor='var(--accent, #22d3ee)'"
            onblur="this.style.borderColor='var(--border-dim, rgba(56,189,248,0.08))'"
          />
        </div>

        <div id="license-modal-error" style="
          display:none;margin-bottom:12px;padding:8px 12px;
          border-radius:8px;background:var(--red-bg, rgba(248,113,113,0.1));
          color:var(--red, #f87171);font-size:12px;
        "></div>

        <div id="license-modal-success" style="
          display:none;margin-bottom:12px;padding:8px 12px;
          border-radius:8px;background:var(--green-bg, rgba(74,222,128,0.1));
          color:var(--green, #4ade80);font-size:12px;
        "></div>

        <button
          id="license-modal-btn"
          onclick="activateLicense()"
          style="
            width:100%;padding:12px;
            background:var(--accent, #22d3ee);color:#000;
            font-weight:600;font-size:14px;
            border:none;border-radius:10px;cursor:pointer;
            transition:opacity 0.2s;
          "
          onmouseover="this.style.opacity='0.85'"
          onmouseout="this.style.opacity='1'"
        >
          Activate
        </button>

        <div style="text-align:center;margin-top:16px">
          <a href="/admin?tab=settings" style="font-size:11px;color:var(--text-muted, #94a3b8);text-decoration:none">
            or go to Admin Settings &rarr;
          </a>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Focus the input
  setTimeout(() => {
    const input = document.getElementById('license-modal-key');
    if (input) {
      input.focus();
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') activateLicense();
      });
    }
  }, 100);
}

async function activateLicense() {
  const input = document.getElementById('license-modal-key');
  const btn = document.getElementById('license-modal-btn');
  const errorEl = document.getElementById('license-modal-error');
  const successEl = document.getElementById('license-modal-success');
  const key = input.value.trim();

  if (!key) {
    errorEl.textContent = 'Please enter a license key';
    errorEl.style.display = 'block';
    successEl.style.display = 'none';
    return;
  }

  btn.textContent = 'Verifying...';
  btn.disabled = true;
  errorEl.style.display = 'none';
  successEl.style.display = 'none';

  try {
    // Save the key to config
    const saveRes = await fetch('/api/config/service', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey: key }),
    });

    if (!saveRes.ok) {
      throw new Error('Failed to save license key');
    }

    // Wait a moment for re-verification to complete
    await new Promise(r => setTimeout(r, 1500));

    // Check if it's valid now
    const checkRes = await fetch('/api/license');
    const data = await checkRes.json();

    if (data.valid && data.org) {
      successEl.textContent = `Activated! Welcome, ${data.name || data.org}. Expires ${new Date(data.expiresAt).toLocaleDateString()}.`;
      successEl.style.display = 'block';
      btn.textContent = 'Activated';

      // Remove the modal after a moment
      setTimeout(() => {
        const overlay = document.getElementById('license-modal-overlay');
        if (overlay) overlay.remove();
      }, 2000);
    } else {
      errorEl.textContent = data.error || 'Invalid or expired license key. Please check and try again.';
      errorEl.style.display = 'block';
      btn.textContent = 'Activate';
      btn.disabled = false;
    }
  } catch (e) {
    errorEl.textContent = 'Connection error. Please try again.';
    errorEl.style.display = 'block';
    btn.textContent = 'Activate';
    btn.disabled = false;
  }
}
