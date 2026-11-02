// Applies the saved theme before first paint (an external file: the CSP allows no inline scripts).
// Keep the key in step with src/theme.ts.
(function () {
  try {
    var t = localStorage.getItem("nutrisage.theme");
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
})();
