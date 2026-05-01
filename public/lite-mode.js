/**
 * lite-mode.js — Hides Pro-only features when running in Lite edition.
 *
 * When the service config has edition === "lite", this script:
 *  - Hides Boards, Projects, Automations nav links and gear buttons
 *  - Hides the AI Gym mode toggle on the Home page
 *  - Hides the Channels tab on the Admin page
 *  - Redirects away from Pro-only pages if accessed directly
 *  - Exposes window._ma1Edition and window._ma1MaxAgents for other scripts
 *
 * On Pro installs (default) this is a no-op.
 * Load after server-mode.js, before page-specific scripts.
 */

(function () {
  // Pages that are Pro-only — redirect to / if accessed in Lite
  var PRO_PAGES = new Set(["/boards", "/projects", "/automations", "/gym"]);

  // Gear-button hrefs to hide (topbar utility buttons)
  var PRO_GEAR_HREFS = new Set(["/boards"]);

  // Sub-nav link hrefs to hide
  var PRO_SUBNAV_HREFS = new Set(["/boards", "/projects", "/automations"]);

  async function initLiteMode() {
    var edition, maxAgents;
    try {
      var r = await fetch("/api/config/service");
      if (!r.ok) return;
      var data = await r.json();
      edition = data.edition || "pro";
      maxAgents = data.maxAgents || 0;
    } catch (e) {
      return; // can't determine edition — do nothing
    }

    // Expose for other scripts
    window._ma1Edition = edition;
    window._ma1MaxAgents = maxAgents;

    if (edition !== "lite") return;

    // Redirect away from Pro-only pages
    var path = window.location.pathname;
    if (PRO_PAGES.has(path)) {
      window.location.href = "/";
      return;
    }

    // Hide Pro-only gear buttons in topbar (e.g., Boards)
    document.querySelectorAll("a.gear-btn").forEach(function (el) {
      var href = el.getAttribute("href");
      if (PRO_GEAR_HREFS.has(href)) {
        el.style.display = "none";
      }
    });

    // Hide Pro-only sub-nav links (Boards, Projects, Automations)
    document.querySelectorAll("a.sub-nav-link").forEach(function (el) {
      var href = el.getAttribute("href");
      if (PRO_SUBNAV_HREFS.has(href)) {
        el.style.display = "none";
      }
    });

    // Hide AI Gym mode toggle on Home page
    var gymBtn = document.getElementById("modeCoach");
    if (gymBtn) {
      gymBtn.style.display = "none";
    }

    // Hide Channels tab on Admin page
    document.querySelectorAll("button.type-tab").forEach(function (el) {
      if (el.getAttribute("data-tab") === "channels") {
        el.style.display = "none";
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initLiteMode);
  } else {
    initLiteMode();
  }
})();
