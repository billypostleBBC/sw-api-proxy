import { AuthService } from "../auth/service.js";
const errorMessages = {
    invalid_credentials: "Invalid admin credentials. Check email and password.",
    login_failed: "Unable to sign in. Please try again.",
    rate_limited: "Too many login attempts. Please wait a minute and try again.",
    session_expired: "Your admin session has expired. Please sign in again.",
    signed_out: "You have been signed out."
};
function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
function renderLayout(title, body, script = "") {
    return `<!doctype html>
<html lang="en" data-bs-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link
      href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css"
      rel="stylesheet"
      crossorigin="anonymous"
    />
    <style>
      :root {
        color-scheme: dark;
      }
      body {
        background: radial-gradient(circle at top left, rgba(24, 26, 35, 0.9), rgba(10, 11, 16, 0.95));
        color: #e8e9ef;
        min-height: 100vh;
      }
      .card,
      .table,
      .modal-content {
        background-color: rgba(18, 20, 28, 0.96);
        border-color: rgba(255, 255, 255, 0.08);
      }
      .table > :not(caption) > * > * {
        background-color: transparent;
      }
      .table thead th {
        color: #cdd2e1;
        border-bottom-color: rgba(255, 255, 255, 0.12);
      }
      .table tbody tr {
        border-top-color: rgba(255, 255, 255, 0.08);
      }
      .muted-ink {
        color: #9aa3b2;
      }
      .text-muted {
        color: #9aa3b2 !important;
      }
      .form-control,
      .form-select {
        background-color: rgba(15, 17, 24, 0.96);
        color: #e8e9ef;
        border-color: rgba(255, 255, 255, 0.1);
      }
      .form-control::placeholder {
        color: #7e8796;
      }
      .btn-outline-secondary {
        color: #cdd2e1;
        border-color: rgba(255, 255, 255, 0.25);
      }
      .btn-outline-secondary:hover {
        background-color: rgba(255, 255, 255, 0.08);
      }
      .btn-outline-danger {
        border-color: rgba(255, 107, 107, 0.5);
      }
      .btn-outline-danger:hover {
        background-color: rgba(255, 107, 107, 0.18);
      }
      .btn-outline-primary {
        border-color: rgba(108, 170, 255, 0.65);
        color: #cfe1ff;
      }
      .btn-outline-primary:hover {
        background-color: rgba(108, 170, 255, 0.18);
      }
      .btn-outline-warning {
        border-color: rgba(255, 193, 7, 0.5);
        color: #ffd875;
      }
      .btn-outline-warning:hover {
        background-color: rgba(255, 193, 7, 0.18);
      }
      .btn-outline-light {
        border-color: rgba(255, 255, 255, 0.25);
        color: #e8e9ef;
      }
      .btn-outline-light:hover {
        background-color: rgba(255, 255, 255, 0.12);
      }
      .badge {
        letter-spacing: 0.02em;
      }
      .section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
      }
      .ghost-panel {
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 0.5rem;
        padding: 1rem;
      }
      .help-modal {
        backdrop-filter: blur(6px);
      }
    </style>
  </head>
  <body>
    ${body}
    ${script ? `<script>${script}</script>` : ""}
  </body>
</html>`;
}
function renderErrorBanner(errorKey) {
    if (!errorKey) {
        return "";
    }
    const message = errorMessages[errorKey];
    if (!message) {
        return "";
    }
    return `<div class="alert alert-warning" role="alert">${escapeHtml(message)}</div>`;
}
function loginPageHtml(errorKey) {
    const body = `
  <main class="container py-5">
    <div class="row justify-content-center">
      <div class="col-md-8 col-lg-6">
        <h1 class="h3 mb-3">Proxy Admin Login</h1>
        <p class="text-muted">Sign in with your allowlisted admin email and shared password.</p>
        ${renderErrorBanner(errorKey)}
        <div class="card shadow-sm">
          <div class="card-body">
            <form id="adminLoginForm" class="vstack gap-3">
              <div>
                <label for="adminEmail" class="form-label">Admin email</label>
                <input id="adminEmail" name="email" type="email" class="form-control" required />
              </div>
              <div>
                <label for="adminPassword" class="form-label">Password</label>
                <input id="adminPassword" name="password" type="password" class="form-control" required />
              </div>
              <button id="loginSubmit" type="submit" class="btn btn-primary">Sign in</button>
            </form>
            <div id="loginStatus" class="alert py-2 mt-3 mb-0" hidden></div>
          </div>
        </div>
      </div>
    </div>
  </main>`;
    const script = `
  (function () {
    var form = document.getElementById("adminLoginForm");
    var statusEl = document.getElementById("loginStatus");
    var submitButton = document.getElementById("loginSubmit");

    function showStatus(type, message) {
      if (!statusEl) return;
      statusEl.className = "alert alert-" + type + " py-2 mt-3 mb-0";
      statusEl.textContent = message;
      statusEl.hidden = false;
    }

    if (!form) return;
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (statusEl) {
        statusEl.hidden = true;
      }
      if (submitButton) {
        submitButton.disabled = true;
      }

      var emailInput = document.getElementById("adminEmail");
      var email = emailInput && "value" in emailInput ? String(emailInput.value || "").trim() : "";
      var passwordInput = document.getElementById("adminPassword");
      var password = passwordInput && "value" in passwordInput ? String(passwordInput.value || "") : "";
      if (!email || !password) {
        showStatus("danger", "Admin email and password are required.");
        if (submitButton) submitButton.disabled = false;
        return;
      }

      try {
        var response = await fetch("/admin/auth/login", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email, password: password })
        });

        if (response.status !== 200) {
          var text = await response.text();
          var message = "Failed to sign in.";
          if (text) {
            try {
              var parsed = JSON.parse(text);
              message = parsed.message || message;
            } catch (_ignored) {
              message = message;
            }
          }
          throw new Error(message);
        }

        window.location.href = "/admin";
      } catch (error) {
        showStatus("danger", error instanceof Error ? error.message : "Failed to sign in.");
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
        }
      }
    });
  })();`;
    return renderLayout("Proxy Admin Login", body, script);
}
function dashboardPageHtml(email, errorKey) {
    const body = `
  <main class="container-fluid px-3 px-md-4 py-3 py-md-4">
    <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
      <div>
        <h1 class="h3 mb-1">Proxy Admin Dashboard</h1>
        <div class="text-muted small">Signed in as ${escapeHtml(email)}</div>
      </div>
      <div class="d-flex gap-2">
        <button id="helpBtn" type="button" class="btn btn-outline-light btn-sm">Help</button>
        <button id="refreshAllBtn" type="button" class="btn btn-outline-secondary btn-sm">Refresh all</button>
        <form method="post" action="/admin/logout">
          <button type="submit" class="btn btn-outline-danger btn-sm">Sign out</button>
        </form>
      </div>
    </div>
    ${renderErrorBanner(errorKey)}

    <section class="card shadow-sm mb-3">
      <div class="card-header section-header">
        <strong>Projects</strong>
        <div class="d-flex align-items-center gap-2">
          <div class="form-check form-switch m-0">
            <input id="projectsIncludeInactive" class="form-check-input" type="checkbox" />
            <label class="form-check-label small" for="projectsIncludeInactive">Show inactive</label>
          </div>
        </div>
      </div>
      <div class="card-body">
        <div class="row g-3">
          <div class="col-lg-6">
            <h2 class="h6">Create project</h2>
            <form id="createProjectForm" class="row g-2">
              <div class="col-md-6">
                <input name="slug" class="form-control form-control-sm" placeholder="slug" required />
              </div>
              <div class="col-md-6">
                <input name="name" class="form-control form-control-sm" placeholder="name" required />
              </div>
              <div class="col-md-6">
                <input name="environment" class="form-control form-control-sm" placeholder="environment" required />
              </div>
              <div class="col-md-6">
                <input name="ownerEmail" type="email" class="form-control form-control-sm" placeholder="owner email" required />
              </div>
              <div class="col-md-6">
                <input name="rpmCap" type="number" min="1" class="form-control form-control-sm" placeholder="RPM cap" required />
              </div>
              <div class="col-md-6">
                <input name="dailyTokenCap" type="number" min="1" class="form-control form-control-sm" placeholder="Daily token cap" required />
              </div>
              <div class="col-12">
                <button type="submit" class="btn btn-primary btn-sm">Create project</button>
              </div>
            </form>
            <div id="projectCreateMessage" class="alert py-2 mt-2 mb-0" hidden></div>
          </div>
          <div class="col-lg-6">
            <h2 class="h6">Rotate project API key</h2>
            <form id="rotateKeyForm" class="row g-2">
              <div class="col-md-4">
                <input name="projectId" type="number" min="1" class="form-control form-control-sm" placeholder="project id" required />
              </div>
              <div class="col-md-8">
                <input name="apiKey" type="password" class="form-control form-control-sm" placeholder="OpenAI API key" required />
              </div>
              <div class="col-12">
                <button type="submit" class="btn btn-outline-primary btn-sm">Rotate key</button>
              </div>
            </form>
            <div id="keyRotateMessage" class="alert py-2 mt-2 mb-0" hidden></div>
          </div>
        </div>
        <hr />
        <div class="table-responsive">
          <table class="table table-sm table-striped align-middle mb-0">
            <thead>
              <tr>
                <th>ID</th>
                <th>Slug</th>
                <th>Name</th>
                <th>Environment</th>
                <th>Owner</th>
                <th>Status</th>
                <th>RPM cap</th>
                <th>Daily token cap</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="projectRows">
              <tr><td colspan="9" class="text-muted">Loading projects...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="card shadow-sm mb-3">
      <div class="card-header section-header">
        <strong>Tools & Tokens</strong>
        <div class="d-flex align-items-center gap-2">
          <div class="form-check form-switch m-0">
            <input id="toolsIncludeInactive" class="form-check-input" type="checkbox" />
            <label class="form-check-label small" for="toolsIncludeInactive">Show inactive</label>
          </div>
        </div>
      </div>
      <div class="card-body">
        <div class="row g-3">
          <div class="col-lg-4">
            <h2 class="h6">Create tool</h2>
            <form id="createToolForm" class="row g-2">
              <div class="col-12">
                <input name="slug" class="form-control form-control-sm" placeholder="tool slug" required />
              </div>
              <div class="col-12">
                <input name="projectId" type="number" min="1" class="form-control form-control-sm" placeholder="project id" required />
              </div>
              <div class="col-12">
                <select name="mode" class="form-select form-select-sm" required>
                  <option value="server">server</option>
                  <option value="browser">browser</option>
                  <option value="both">both</option>
                </select>
              </div>
              <div class="col-12">
                <button type="submit" class="btn btn-primary btn-sm">Create tool</button>
              </div>
            </form>
            <div id="toolCreateMessage" class="alert py-2 mt-2 mb-0" hidden></div>
          </div>
          <div class="col-lg-4">
            <h2 class="h6">Mint tool token</h2>
            <form id="mintTokenForm" class="row g-2">
              <div class="col-12">
                <input name="toolId" type="number" min="1" class="form-control form-control-sm" placeholder="tool id" required />
              </div>
              <div class="col-12">
                <button type="submit" class="btn btn-outline-primary btn-sm">Mint token</button>
              </div>
            </form>
            <div id="tokenMintMessage" class="alert py-2 mt-2 mb-0" hidden></div>
            <div id="mintedTokenPanel" class="alert alert-warning mt-2 mb-0" hidden>
              <div class="small fw-semibold mb-1">Store this token now (it will not be shown again):</div>
              <code id="mintedTokenValue" class="small d-block text-break"></code>
              <div class="small mt-1">Expires: <span id="mintedTokenExpiry"></span></div>
              <div id="mintedRelayUrlGroup" class="mt-2" hidden>
                <div class="small fw-semibold mb-1">Relay responses URL</div>
                <code id="mintedRelayUrlValue" class="small d-block text-break"></code>
                <button id="copyMintedRelayUrlBtn" type="button" class="btn btn-sm btn-outline-light mt-2">Copy relay URL</button>
                <div id="copyRelayUrlMessage" class="small mt-1"></div>
              </div>
              <button id="copyMintedTokenBtn" type="button" class="btn btn-sm btn-outline-light mt-2">Copy token</button>
              <div id="copyTokenMessage" class="small mt-1"></div>
            </div>
          </div>
          <div class="col-lg-4">
            <h2 class="h6">Token list</h2>
            <div class="ghost-panel">
              <div class="small text-muted mb-2">Select a tool to view tokens.</div>
              <div class="d-flex align-items-center gap-2 mb-2">
                <div class="small fw-semibold">Tool:</div>
                <div id="tokenListToolLabel" class="small">None selected</div>
                <span id="tokenListToolIdBadge" class="badge text-bg-secondary ms-auto" hidden></span>
              </div>
              <div id="tokenListMessage" class="alert py-2 mb-2" hidden></div>
              <div class="table-responsive">
                <table class="table table-sm align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Token ID</th>
                      <th>Status</th>
                      <th>Expires</th>
                      <th>Last used</th>
                      <th>Created</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody id="tokenRows">
                    <tr><td colspan="6" class="text-muted">No tool selected.</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
        <hr />
        <div class="table-responsive">
          <table class="table table-sm table-striped align-middle mb-0">
            <thead>
              <tr>
                <th>ID</th>
                <th>Slug</th>
                <th>Project ID</th>
                <th>Mode</th>
                <th>Status</th>
                <th>Relay responses URL</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="toolRows">
              <tr><td colspan="7" class="text-muted">Loading tools...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="card shadow-sm">
      <div class="card-header"><strong>Usage</strong></div>
      <div class="card-body">
        <form id="usageFilterForm" class="row g-2 mb-3">
          <div class="col-md-3">
            <input name="projectId" type="number" min="1" class="form-control form-control-sm" placeholder="project id (optional)" />
          </div>
          <div class="col-md-3">
            <input name="from" type="datetime-local" class="form-control form-control-sm" />
          </div>
          <div class="col-md-3">
            <input name="to" type="datetime-local" class="form-control form-control-sm" />
          </div>
          <div class="col-md-3 d-flex gap-2">
            <button type="submit" class="btn btn-outline-primary btn-sm">Apply filters</button>
            <button id="usageResetBtn" type="button" class="btn btn-outline-secondary btn-sm">Reset</button>
          </div>
        </form>
        <div id="usageMessage" class="alert py-2 mt-2 mb-3" hidden></div>
        <div class="table-responsive">
          <table class="table table-sm table-striped align-middle mb-0">
            <thead>
              <tr>
                <th>#</th>
                <th>Created</th>
                <th>Project ID</th>
                <th>Tool ID</th>
                <th>Endpoint</th>
                <th>Model</th>
                <th>Input tokens</th>
                <th>Output tokens</th>
                <th>Cost (USD)</th>
                <th>Status</th>
                <th>Latency (ms)</th>
              </tr>
            </thead>
            <tbody id="usageRows">
              <tr><td colspan="11" class="text-muted">Loading usage...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <div id="helpModal" class="modal help-modal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-lg modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="h5 mb-0">Admin Dashboard Help</h2>
            <button id="helpCloseBtn" type="button" class="btn-close btn-close-white" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div class="row g-3">
              <div class="col-lg-6">
                <div class="ghost-panel h-100">
                  <div class="small text-muted">Top actions</div>
                  <ul class="small mb-0">
                    <li><strong>Help</strong> opens this guide.</li>
                    <li><strong>Refresh all</strong> reloads projects, tools, and usage.</li>
                    <li><strong>Sign out</strong> ends the admin session.</li>
                  </ul>
                </div>
              </div>
              <div class="col-lg-6">
                <div class="ghost-panel h-100">
                  <div class="small text-muted">Project operations</div>
                  <ul class="small mb-0">
                    <li>Create a project, then rotate the OpenAI key.</li>
                    <li><strong>Delete</strong> deactivates the project, deactivates its tools, and revokes their tokens.</li>
                    <li>Usage history stays visible in the Usage table.</li>
                    <li>Toggle <strong>Show inactive</strong> to include deactivated projects.</li>
                  </ul>
                </div>
              </div>
              <div class="col-lg-6">
                <div class="ghost-panel h-100">
                  <div class="small text-muted">Tool operations</div>
                  <ul class="small mb-0">
                    <li>Create tools under an existing project.</li>
                    <li><strong>Tokens</strong> loads token summaries for the tool.</li>
                    <li><strong>Delete</strong> deactivates the tool and revokes its tokens.</li>
                    <li>Toggle <strong>Show inactive</strong> to include deactivated tools.</li>
                  </ul>
                </div>
              </div>
              <div class="col-lg-6">
                <div class="ghost-panel h-100">
                  <div class="small text-muted">Token list</div>
                  <ul class="small mb-0">
                    <li>Mint a token for a tool and store it immediately.</li>
                    <li>Use the token list to revoke tokens without pasting secrets.</li>
                    <li>Token IDs and status are visible; raw tokens are not.</li>
                  </ul>
                </div>
              </div>
              <div class="col-12">
                <div class="ghost-panel">
                  <div class="small text-muted">Usage filters</div>
                  <ul class="small mb-0">
                    <li>The first column <strong>#</strong> is the usage event number.</li>
                    <li>Filters use your local browser time and are sent as ISO timestamps.</li>
                    <li>Results are capped to 1000 rows per request.</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button id="helpCloseFooterBtn" type="button" class="btn btn-outline-light btn-sm">Close</button>
          </div>
        </div>
      </div>
    </div>
  </main>`;
    const script = `
  (function () {
    var projectRows = document.getElementById("projectRows");
    var toolRows = document.getElementById("toolRows");
    var usageRows = document.getElementById("usageRows");
    var tokenRows = document.getElementById("tokenRows");
    var tokenListToolLabel = document.getElementById("tokenListToolLabel");
    var tokenListToolIdBadge = document.getElementById("tokenListToolIdBadge");
    var tokenListMessage = document.getElementById("tokenListMessage");
    var projectsIncludeInactive = document.getElementById("projectsIncludeInactive");
    var toolsIncludeInactive = document.getElementById("toolsIncludeInactive");
    var helpBtn = document.getElementById("helpBtn");
    var helpModal = document.getElementById("helpModal");
    var helpCloseBtn = document.getElementById("helpCloseBtn");
    var helpCloseFooterBtn = document.getElementById("helpCloseFooterBtn");
    var activeTokenToolId = null;
    var mintedTokenPanel = document.getElementById("mintedTokenPanel");
    var mintedTokenValue = document.getElementById("mintedTokenValue");
    var mintedTokenExpiry = document.getElementById("mintedTokenExpiry");
    var copyTokenMessage = document.getElementById("copyTokenMessage");
    var copyMintedTokenBtn = document.getElementById("copyMintedTokenBtn");
    var mintedRelayUrlGroup = document.getElementById("mintedRelayUrlGroup");
    var mintedRelayUrlValue = document.getElementById("mintedRelayUrlValue");
    var copyMintedRelayUrlBtn = document.getElementById("copyMintedRelayUrlBtn");
    var copyRelayUrlMessage = document.getElementById("copyRelayUrlMessage");

    function esc(value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function setMessage(id, type, message) {
      var el = document.getElementById(id);
      if (!el) return;
      el.className = "alert alert-" + type + " py-2 mt-2 mb-0";
      el.textContent = message;
      el.hidden = false;
    }

    function clearMessage(id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.hidden = true;
      el.textContent = "";
    }

    function setInlineMessage(el, type, message) {
      if (!el) return;
      el.className = "alert alert-" + type + " py-2 mb-2";
      el.textContent = message;
      el.hidden = false;
    }

    async function requestJson(url, options) {
      var response = await fetch(url, Object.assign({ credentials: "include" }, options || {}));
      if (response.status === 401) {
        window.location.href = "/admin?error=session_expired";
        throw new Error("Admin session required.");
      }

      var text = await response.text();
      var payload = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch (_ignored) {
          payload = null;
        }
      }

      if (!response.ok) {
        var message = (payload && payload.message) || "Request failed (" + response.status + ")";
        throw new Error(message);
      }

      return payload || {};
    }

    function toInt(value) {
      var parsed = Number.parseInt(String(value || "").trim(), 10);
      return Number.isFinite(parsed) ? parsed : null;
    }

    function formatDate(value) {
      if (!value) return "-";
      var date = new Date(value);
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
    }

    function formatNumber(value) {
      var number = Number(value);
      return Number.isFinite(number) ? number.toLocaleString() : "-";
    }

    function statusBadge(status) {
      var safe = String(status || "").toLowerCase();
      if (safe === "active") return '<span class="badge text-bg-success">active</span>';
      if (safe === "inactive") return '<span class="badge text-bg-secondary">inactive</span>';
      if (safe === "revoked") return '<span class="badge text-bg-secondary">revoked</span>';
      return '<span class="badge text-bg-secondary">' + esc(status || "-") + "</span>";
    }

    function setTokenListEmpty(message) {
      if (!tokenRows) return;
      tokenRows.innerHTML = '<tr><td colspan="6" class="text-muted">' + esc(message) + "</td></tr>";
    }

    function renderProjects(projects) {
      if (!projectRows) return;
      if (!projects.length) {
        projectRows.innerHTML = '<tr><td colspan="9" class="text-muted">No projects found.</td></tr>';
        return;
      }
      projectRows.innerHTML = projects
        .map(function (project) {
          var actions = project.status === "active"
            ? '<button type="button" class="btn btn-sm btn-outline-danger" data-action="delete-project" data-project-id="' + esc(project.id) + '">Delete</button>'
            : '<span class="text-muted small">Inactive</span>';
          return "<tr>" +
            "<td>" + esc(project.id) + "</td>" +
            "<td>" + esc(project.slug) + "</td>" +
            "<td>" + esc(project.name) + "</td>" +
            "<td>" + esc(project.environment) + "</td>" +
            "<td>" + esc(project.ownerEmail) + "</td>" +
            "<td>" + statusBadge(project.status) + "</td>" +
            "<td class=\\"text-nowrap\\">" + esc(formatNumber(project.rpmCap)) + "</td>" +
            "<td class=\\"text-nowrap\\">" + esc(formatNumber(project.dailyTokenCap)) + "</td>" +
            "<td>" + actions + "</td>" +
          "</tr>";
        })
        .join("");
    }

    function renderTools(tools) {
      if (!toolRows) return;
      if (!tools.length) {
        toolRows.innerHTML = '<tr><td colspan="7" class="text-muted">No tools found.</td></tr>';
        return;
      }
      toolRows.innerHTML = tools
        .map(function (tool) {
          var relayUrlCell = tool.relayResponsesUrl
            ? '<code class="small text-break">' + esc(tool.relayResponsesUrl) + "</code>"
            : "-";
          var actions = tool.status === "active"
            ? '<div class="d-flex gap-2">' +
              '<button type="button" class="btn btn-sm btn-outline-secondary" data-action="view-tokens" data-tool-id="' + esc(tool.id) + '" data-tool-slug="' + esc(tool.slug) + '">Tokens</button>' +
              '<button type="button" class="btn btn-sm btn-outline-danger" data-action="delete-tool" data-tool-id="' + esc(tool.id) + '">Delete</button>' +
            "</div>"
            : '<span class="text-muted small">Inactive</span>';
          return "<tr>" +
            "<td>" + esc(tool.id) + "</td>" +
            "<td>" + esc(tool.slug) + "</td>" +
            "<td>" + esc(tool.projectId) + "</td>" +
            "<td>" + esc(tool.mode) + "</td>" +
            "<td>" + statusBadge(tool.status) + "</td>" +
            "<td>" + relayUrlCell + "</td>" +
            "<td>" + actions + "</td>" +
          "</tr>";
        })
        .join("");
    }

    function renderTokenList(tokens) {
      if (!tokenRows) return;
      if (!tokens.length) {
        setTokenListEmpty("No tokens found for this tool.");
        return;
      }
      tokenRows.innerHTML = tokens
        .map(function (token) {
          var action = token.status === "active"
            ? '<button type="button" class="btn btn-sm btn-outline-danger" data-action="delete-token" data-token-id="' + esc(token.id) + '">Revoke</button>'
            : '<span class="text-muted small">Revoked</span>';
          return "<tr>" +
            "<td><code class=\\"small\\">" + esc(token.id) + "</code></td>" +
            "<td>" + statusBadge(token.status) + "</td>" +
            "<td class=\\"text-nowrap\\">" + esc(formatDate(token.expiresAt)) + "</td>" +
            "<td class=\\"text-nowrap\\">" + esc(formatDate(token.lastUsedAt)) + "</td>" +
            "<td class=\\"text-nowrap\\">" + esc(formatDate(token.createdAt)) + "</td>" +
            "<td>" + action + "</td>" +
          "</tr>";
        })
        .join("");
    }

    function renderUsage(usage) {
      if (!usageRows) return;
      if (!usage.length) {
        usageRows.innerHTML = '<tr><td colspan="11" class="text-muted">No usage records found.</td></tr>';
        return;
      }
      usageRows.innerHTML = usage
        .map(function (row) {
          return "<tr>" +
            "<td>" + esc(row.id) + "</td>" +
            "<td class=\\"text-nowrap\\">" + esc(formatDate(row.created_at)) + "</td>" +
            "<td>" + esc(row.project_id) + "</td>" +
            "<td>" + esc(row.tool_id) + "</td>" +
            "<td>" + esc(row.endpoint) + "</td>" +
            "<td>" + esc(row.model || "-") + "</td>" +
            "<td>" + esc(formatNumber(row.input_tokens)) + "</td>" +
            "<td>" + esc(formatNumber(row.output_tokens)) + "</td>" +
            "<td>" + esc(row.estimated_cost_usd == null ? "-" : row.estimated_cost_usd) + "</td>" +
            "<td>" + esc(row.status_code) + "</td>" +
            "<td>" + esc(formatNumber(row.latency_ms)) + "</td>" +
          "</tr>";
        })
        .join("");
    }

    function includeInactiveValue(toggle) {
      if (!toggle) return false;
      return Boolean(toggle.checked);
    }

    async function loadProjects() {
      var url = "/admin/projects";
      if (includeInactiveValue(projectsIncludeInactive)) {
        url += "?includeInactive=true";
      }
      var data = await requestJson(url);
      renderProjects(Array.isArray(data.projects) ? data.projects : []);
    }

    async function loadTools() {
      var url = "/admin/tools";
      if (includeInactiveValue(toolsIncludeInactive)) {
        url += "?includeInactive=true";
      }
      var data = await requestJson(url);
      renderTools(Array.isArray(data.tools) ? data.tools : []);
    }

    function usageUrlFromFilters() {
      var form = document.getElementById("usageFilterForm");
      if (!form) return "/admin/usage";
      var formData = new FormData(form);
      var params = new URLSearchParams();

      var projectId = String(formData.get("projectId") || "").trim();
      var fromRaw = String(formData.get("from") || "").trim();
      var toRaw = String(formData.get("to") || "").trim();

      if (projectId) params.set("projectId", projectId);
      if (fromRaw) {
        var fromDate = new Date(fromRaw);
        if (!Number.isNaN(fromDate.getTime())) {
          params.set("from", fromDate.toISOString());
        }
      }
      if (toRaw) {
        var toDate = new Date(toRaw);
        if (!Number.isNaN(toDate.getTime())) {
          params.set("to", toDate.toISOString());
        }
      }

      var query = params.toString();
      return query ? "/admin/usage?" + query : "/admin/usage";
    }

    async function loadUsage() {
      var data = await requestJson(usageUrlFromFilters());
      renderUsage(Array.isArray(data.usage) ? data.usage : []);
    }

    async function loadTokensForTool(toolId, toolSlug) {
      if (tokenListMessage) tokenListMessage.hidden = true;
      activeTokenToolId = toolId;
      if (tokenListToolLabel) tokenListToolLabel.textContent = toolSlug ? toolSlug : "Tool " + toolId;
      if (tokenListToolIdBadge) {
        tokenListToolIdBadge.textContent = "ID " + toolId;
        tokenListToolIdBadge.hidden = false;
      }
      setTokenListEmpty("Loading tokens...");
      try {
        var data = await requestJson("/admin/tools/" + toolId + "/tokens");
        renderTokenList(Array.isArray(data.tokens) ? data.tokens : []);
      } catch (error) {
        setInlineMessage(tokenListMessage, "danger", error instanceof Error ? error.message : "Failed to load tokens.");
        setTokenListEmpty("Unable to load tokens.");
      }
    }

    async function refreshAll() {
      await Promise.all([loadProjects(), loadTools(), loadUsage()]);
    }

    var createProjectForm = document.getElementById("createProjectForm");
    if (createProjectForm) {
      createProjectForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        clearMessage("projectCreateMessage");
        var formData = new FormData(createProjectForm);
        var rpmCap = toInt(formData.get("rpmCap"));
        var dailyTokenCap = toInt(formData.get("dailyTokenCap"));
        if (!rpmCap || !dailyTokenCap) {
          setMessage("projectCreateMessage", "danger", "RPM cap and daily token cap must be positive integers.");
          return;
        }

        var payload = {
          slug: String(formData.get("slug") || "").trim(),
          name: String(formData.get("name") || "").trim(),
          environment: String(formData.get("environment") || "").trim(),
          ownerEmail: String(formData.get("ownerEmail") || "").trim(),
          rpmCap: rpmCap,
          dailyTokenCap: dailyTokenCap
        };

        try {
          await requestJson("/admin/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          setMessage("projectCreateMessage", "success", "Project created.");
          await loadProjects();
          createProjectForm.reset();
        } catch (error) {
          setMessage("projectCreateMessage", "danger", error instanceof Error ? error.message : "Failed to create project.");
        }
      });
    }

    if (projectsIncludeInactive) {
      projectsIncludeInactive.addEventListener("change", async function () {
        clearMessage("projectCreateMessage");
        try {
          await loadProjects();
        } catch (error) {
          setMessage("projectCreateMessage", "danger", error instanceof Error ? error.message : "Failed to load projects.");
        }
      });
    }

    var rotateKeyForm = document.getElementById("rotateKeyForm");
    if (rotateKeyForm) {
      rotateKeyForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        clearMessage("keyRotateMessage");
        var formData = new FormData(rotateKeyForm);
        var projectId = toInt(formData.get("projectId"));
        var apiKey = String(formData.get("apiKey") || "").trim();
        if (!projectId || !apiKey) {
          setMessage("keyRotateMessage", "danger", "Project id and API key are required.");
          return;
        }

        try {
          await requestJson("/admin/projects/" + projectId + "/keys", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider: "openai", apiKey: apiKey })
          });
          setMessage("keyRotateMessage", "success", "Project key rotated.");
          rotateKeyForm.reset();
        } catch (error) {
          setMessage("keyRotateMessage", "danger", error instanceof Error ? error.message : "Failed to rotate project key.");
        }
      });
    }

    var createToolForm = document.getElementById("createToolForm");
    if (createToolForm) {
      createToolForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        clearMessage("toolCreateMessage");
        var formData = new FormData(createToolForm);
        var projectId = toInt(formData.get("projectId"));
        if (!projectId) {
          setMessage("toolCreateMessage", "danger", "Project id must be a positive integer.");
          return;
        }
        var payload = {
          slug: String(formData.get("slug") || "").trim(),
          projectId: projectId,
          mode: String(formData.get("mode") || "server")
        };
        try {
          var data = await requestJson("/admin/tools", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          setMessage(
            "toolCreateMessage",
            "success",
            data.relayResponsesUrl ? "Tool created. Relay URL is now available in the tools table." : "Tool created."
          );
          await loadTools();
          createToolForm.reset();
        } catch (error) {
          setMessage("toolCreateMessage", "danger", error instanceof Error ? error.message : "Failed to create tool.");
        }
      });
    }

    if (toolsIncludeInactive) {
      toolsIncludeInactive.addEventListener("change", async function () {
        clearMessage("toolCreateMessage");
        try {
          await loadTools();
        } catch (error) {
          setMessage("toolCreateMessage", "danger", error instanceof Error ? error.message : "Failed to load tools.");
        }
      });
    }

    var mintTokenForm = document.getElementById("mintTokenForm");
    if (mintTokenForm) {
      mintTokenForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        clearMessage("tokenMintMessage");
        if (mintedTokenPanel) mintedTokenPanel.hidden = true;

        var formData = new FormData(mintTokenForm);
        var toolId = toInt(formData.get("toolId"));
        if (!toolId) {
          setMessage("tokenMintMessage", "danger", "Tool id must be a positive integer.");
          return;
        }

        try {
          var data = await requestJson("/admin/tools/" + toolId + "/tokens", {
            method: "POST"
          });
          setMessage("tokenMintMessage", "success", "Tool token minted.");
          if (mintedTokenPanel && mintedTokenValue && mintedTokenExpiry) {
            mintedTokenValue.textContent = String(data.token || "");
            mintedTokenExpiry.textContent = formatDate(data.expiresAt);
            mintedTokenPanel.hidden = false;
          }
          if (mintedRelayUrlGroup && mintedRelayUrlValue && copyRelayUrlMessage) {
            var relayUrl = String(data.relayResponsesUrl || "");
            mintedRelayUrlValue.textContent = relayUrl;
            mintedRelayUrlGroup.hidden = !relayUrl;
            copyRelayUrlMessage.textContent = "";
          }
          if (activeTokenToolId === toolId) {
            loadTokensForTool(toolId, null).catch(function () {});
          }
          mintTokenForm.reset();
        } catch (error) {
          setMessage("tokenMintMessage", "danger", error instanceof Error ? error.message : "Failed to mint token.");
        }
      });
    }

    if (copyMintedTokenBtn) {
      copyMintedTokenBtn.addEventListener("click", async function () {
        if (!mintedTokenValue || !copyTokenMessage) return;
        var token = String(mintedTokenValue.textContent || "");
        if (!token) {
          copyTokenMessage.textContent = "No token to copy.";
          return;
        }
        try {
          await navigator.clipboard.writeText(token);
          copyTokenMessage.textContent = "Token copied.";
        } catch (_error) {
          copyTokenMessage.textContent = "Clipboard copy failed. Copy manually.";
        }
      });
    }

    if (copyMintedRelayUrlBtn) {
      copyMintedRelayUrlBtn.addEventListener("click", async function () {
        if (!mintedRelayUrlValue || !copyRelayUrlMessage) return;
        var relayUrl = String(mintedRelayUrlValue.textContent || "");
        if (!relayUrl) {
          copyRelayUrlMessage.textContent = "No relay URL to copy.";
          return;
        }
        try {
          await navigator.clipboard.writeText(relayUrl);
          copyRelayUrlMessage.textContent = "Relay URL copied.";
        } catch (_error) {
          copyRelayUrlMessage.textContent = "Clipboard copy failed. Copy manually.";
        }
      });
    }

    if (projectRows) {
      projectRows.addEventListener("click", async function (event) {
        var target = event.target;
        if (!target || !("dataset" in target)) return;
        var action = target.dataset.action;
        if (action !== "delete-project") return;
        var projectId = toInt(target.dataset.projectId);
        if (!projectId) return;
        var confirmed = window.confirm(
          "Delete project " + projectId + "? This deactivates the project, deactivates its tools, revokes their tokens, and keeps usage history visible."
        );
        if (!confirmed) return;
        try {
          await requestJson("/admin/projects/" + projectId, { method: "DELETE" });
          await loadProjects();
          await loadTools();
          if (activeTokenToolId) {
            setTokenListEmpty("Select a tool to view tokens.");
            if (tokenListToolLabel) tokenListToolLabel.textContent = "None selected";
            if (tokenListToolIdBadge) tokenListToolIdBadge.hidden = true;
            activeTokenToolId = null;
          }
        } catch (error) {
          setMessage("projectCreateMessage", "danger", error instanceof Error ? error.message : "Failed to delete project.");
        }
      });
    }

    if (toolRows) {
      toolRows.addEventListener("click", async function (event) {
        var target = event.target;
        if (!target || !("dataset" in target)) return;
        var action = target.dataset.action;
        if (action === "view-tokens") {
          var toolId = toInt(target.dataset.toolId);
          if (!toolId) return;
          var toolSlug = target.dataset.toolSlug || "";
          loadTokensForTool(toolId, toolSlug).catch(function () {});
          return;
        }
        if (action === "delete-tool") {
          var deleteToolId = toInt(target.dataset.toolId);
          if (!deleteToolId) return;
          var confirmed = window.confirm(
            "Delete tool " + deleteToolId + "? This deactivates the tool and revokes its tokens."
          );
          if (!confirmed) return;
          try {
            await requestJson("/admin/tools/" + deleteToolId, { method: "DELETE" });
            await loadTools();
            if (activeTokenToolId === deleteToolId) {
              setTokenListEmpty("Select a tool to view tokens.");
              if (tokenListToolLabel) tokenListToolLabel.textContent = "None selected";
              if (tokenListToolIdBadge) tokenListToolIdBadge.hidden = true;
              activeTokenToolId = null;
            }
          } catch (error) {
            setMessage("toolCreateMessage", "danger", error instanceof Error ? error.message : "Failed to delete tool.");
          }
        }
      });
    }

    if (tokenRows) {
      tokenRows.addEventListener("click", async function (event) {
        var target = event.target;
        if (!target || !("dataset" in target)) return;
        var action = target.dataset.action;
        if (action !== "delete-token") return;
        var tokenId = target.dataset.tokenId || "";
        if (!tokenId || !activeTokenToolId) return;
        var confirmed = window.confirm("Revoke token " + tokenId + "?");
        if (!confirmed) return;
        try {
          await requestJson("/admin/tools/" + activeTokenToolId + "/tokens/" + encodeURIComponent(tokenId), {
            method: "DELETE"
          });
          await loadTokensForTool(activeTokenToolId, null);
        } catch (error) {
          setInlineMessage(tokenListMessage, "danger", error instanceof Error ? error.message : "Failed to revoke token.");
        }
      });
    }

    function openHelpModal() {
      if (!helpModal) return;
      helpModal.classList.add("show");
      helpModal.style.display = "block";
      helpModal.setAttribute("aria-hidden", "false");
      document.body.classList.add("modal-open");
      var backdrop = document.createElement("div");
      backdrop.className = "modal-backdrop fade show";
      backdrop.id = "helpModalBackdrop";
      document.body.appendChild(backdrop);
    }

    function closeHelpModal() {
      if (!helpModal) return;
      helpModal.classList.remove("show");
      helpModal.style.display = "none";
      helpModal.setAttribute("aria-hidden", "true");
      document.body.classList.remove("modal-open");
      var backdrop = document.getElementById("helpModalBackdrop");
      if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }

    if (helpBtn) {
      helpBtn.addEventListener("click", function () {
        openHelpModal();
      });
    }
    if (helpCloseBtn) {
      helpCloseBtn.addEventListener("click", function () {
        closeHelpModal();
      });
    }
    if (helpCloseFooterBtn) {
      helpCloseFooterBtn.addEventListener("click", function () {
        closeHelpModal();
      });
    }
    if (helpModal) {
      helpModal.addEventListener("click", function (event) {
        if (event.target === helpModal) {
          closeHelpModal();
        }
      });
    }
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeHelpModal();
    });

    var usageFilterForm = document.getElementById("usageFilterForm");
    if (usageFilterForm) {
      usageFilterForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        clearMessage("usageMessage");
        try {
          await loadUsage();
        } catch (error) {
          setMessage("usageMessage", "danger", error instanceof Error ? error.message : "Failed to load usage.");
        }
      });
    }

    var usageResetBtn = document.getElementById("usageResetBtn");
    if (usageResetBtn) {
      usageResetBtn.addEventListener("click", async function () {
        clearMessage("usageMessage");
        if (usageFilterForm && "reset" in usageFilterForm) usageFilterForm.reset();
        try {
          await loadUsage();
        } catch (error) {
          setMessage("usageMessage", "danger", error instanceof Error ? error.message : "Failed to load usage.");
        }
      });
    }

    var refreshAllBtn = document.getElementById("refreshAllBtn");
    if (refreshAllBtn) {
      refreshAllBtn.addEventListener("click", async function () {
        clearMessage("usageMessage");
        try {
          await refreshAll();
        } catch (error) {
          setMessage("usageMessage", "danger", error instanceof Error ? error.message : "Failed to refresh data.");
        }
      });
    }

    refreshAll().catch(function (error) {
      var message = error instanceof Error ? error.message : "Failed to load dashboard data.";
      if (projectRows) projectRows.innerHTML = '<tr><td colspan="9" class="text-danger">' + esc(message) + "</td></tr>";
      if (toolRows) toolRows.innerHTML = '<tr><td colspan="7" class="text-danger">' + esc(message) + "</td></tr>";
      if (usageRows) usageRows.innerHTML = '<tr><td colspan="11" class="text-danger">' + esc(message) + "</td></tr>";
    });
  })();`;
    return renderLayout("Proxy Admin Dashboard", body, script);
}
export function registerWebAdminRoutes(app, deps) {
    app.get("/admin", async (request, reply) => {
        const query = request.query;
        const errorKey = typeof query.error === "string" ? query.error : undefined;
        const session = AuthService.getSessionFromCookie(request, "admin");
        if (!session) {
            return reply.type("text/html").send(loginPageHtml(errorKey));
        }
        const email = await deps.authService.getSessionEmail("admin", session);
        if (!email || !app.env.adminEmailAllowlist?.has(email.toLowerCase())) {
            reply.clearCookie("admin_session", { path: "/" });
            return reply.type("text/html").send(loginPageHtml(errorKey ?? "session_expired"));
        }
        return reply.type("text/html").send(dashboardPageHtml(email, errorKey));
    });
    app.post("/admin/logout", async (_request, reply) => {
        reply.clearCookie("admin_session", { path: "/" });
        return reply.code(303).redirect("/admin?error=signed_out");
    });
}
