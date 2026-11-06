/*
 * Pre-paint theme bootstrap.
 *
 * The theme is React state applied in an effect, which runs after the first
 * paint — light-theme users saw a dark flash on every load. This runs before
 * the app bundle and sets the same attribute React will set.
 *
 * It lives in its own file rather than inline because the site ships a strict
 * CSP (`script-src 'self'`), which blocks inline scripts. Keep it tiny and
 * dependency-free: it is on the critical path.
 */
(function () {
  var KEY = "nseSwingTheme";
  var theme = "dark";
  try {
    var stored = window.localStorage.getItem(KEY);
    if (stored === "light" || stored === "dark") {
      theme = stored;
    } else if (window.matchMedia("(prefers-color-scheme: light)").matches) {
      theme = "light";
    }
  } catch (e) {
    /* storage blocked — fall back to dark */
  }
  document.documentElement.setAttribute("data-theme", theme);
})();
