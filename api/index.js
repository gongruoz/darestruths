// #region agent log
const _log = (message, data, hypothesisId) => {
  fetch("http://127.0.0.1:7415/ingest/d5903de1-1d40-449c-a008-8e78e3d514a5", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "1d20f9" },
    body: JSON.stringify({
      sessionId: "1d20f9",
      location: "api/index.js",
      message,
      data: data || {},
      hypothesisId: hypothesisId || null,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
};
// #endregion

const app = require("../server");

// #region agent log
_log("api/index.js loaded, exporting handler", { hasApp: !!app }, "H1");
// #endregion

const handler = (req, res) => {
  // #region agent log
  _log("handler invoked", { method: req.method, url: req.url, path: req.path }, "H2");
  // #endregion
  return app(req, res);
};

module.exports = handler;
