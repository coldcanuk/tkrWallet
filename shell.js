/* First paint for the MV3 popup. Must load before app.css.
 * 100vh in a toolbar popup is the monitor, not the 600px window. */
(function () {
  "use strict";
  var root = typeof document !== "undefined" ? document.documentElement : null;
  if (!root) {
    return;
  }
  var search = "";
  var protocol = "";
  try {
    search = String(location.search || "");
    protocol = String(location.protocol || "");
  } catch (e) {
    return;
  }
  root.classList.remove("extension-popup", "extension-panel");
  if (/(^|[?&])mode=panel([&#]|$)/.test(search)) {
    root.classList.add("extension-panel");
  } else if (protocol === "chrome-extension:") {
    root.classList.add("extension-popup");
  }
})();
