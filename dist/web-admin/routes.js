import { z } from "zod";
import { AuthService } from "../auth/service.js";
const verifyAdminSchema = z.object({
    scope: z.string().optional(),
    token: z.string().min(10).optional()
});
const errorMessages = {
    invalid_link: "The sign-in link is invalid.",
    invalid_or_expired_link: "The sign-in link is invalid or expired.",
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
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link
      href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css"
      rel="stylesheet"
      crossorigin="anonymous"
    />
  </head>
  <body class="bg-light">
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
        <p class="text-muted">Request a magic link with your BBC admin email.</p>
        ${renderErrorBanner(errorKey)}
        <div class="card shadow-sm">
          <div class="card-body">
            <form id="requestMagicLinkForm" class="vstack gap-3">
              <div>
                <label for="adminEmail" class="form-label">Admin email</label>
                <input id="adminEmail" name="email" type="email" class="form-control" required />
              </div>
              <button id="loginSubmit" type="submit" class="btn btn-primary">Send magic link</button>
            </form>
            <div id="loginStatus" class="alert py-2 mt-3 mb-0" hidden></div>
          </div>
        </div>
      </div>
    </div>
  </main>`;
    const script = `
  (function () {
    var form = document.getElementById("requestMagicLinkForm");
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
      if (!email) {
        showStatus("danger", "Admin email is required.");
        if (submitButton) submitButton.disabled = false;
        return;
      }

      try {
        var response = await fetch("/admin/auth/magic-link/request", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email })
        });

        if (response.status !== 204) {
          var text = await response.text();
          var message = "Failed to request magic link.";
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

        showStatus("success", "If this email is allowlisted, check your inbox for a sign-in link.");
      } catch (error) {
        showStatus("danger", error instanceof Error ? error.message : "Failed to request magic link.");
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
        <button id="refreshAllBtn" type="button" class="btn btn-outline-secondary btn-sm">Refresh all</button>
        <form method="post" action="/admin/logout">
          <button type="submit" class="btn btn-outline-danger btn-sm">Sign out</button>
        </form>
      </div>
    </div>
    ${renderErrorBanner(errorKey)}

    <section class="card shadow-sm mb-3">
      <div class="card-header"><strong>Projects</strong></div>
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
              </tr>
            </thead>
            <tbody id="projectRows">
              <tr><td colspan="8" class="text-muted">Loading projects...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="card shadow-sm mb-3">
      <div class="card-header"><strong>Tools & Tokens</strong></div>
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
              <button id="copyMintedTokenBtn" type="button" class="btn btn-sm btn-dark mt-2">Copy token</button>
              <div id="copyTokenMessage" class="small mt-1"></div>
            </div>
          </div>
          <div class="col-lg-4">
            <h2 class="h6">Revoke tool token</h2>
            <form id="revokeTokenForm" class="row g-2">
              <div class="col-12">
                <input name="toolId" type="number" min="1" class="form-control form-control-sm" placeholder="tool id" required />
              </div>
              <div class="col-12">
                <input name="tokenInput" class="form-control form-control-sm" placeholder="token id or full token" required />
              </div>
              <div class="col-12">
                <button type="submit" class="btn btn-outline-danger btn-sm">Revoke token</button>
              </div>
            </form>
            <div id="tokenRevokeMessage" class="alert py-2 mt-2 mb-0" hidden></div>
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
              </tr>
            </thead>
            <tbody id="toolRows">
              <tr><td colspan="5" class="text-muted">Loading tools...</td></tr>
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
                <th>ID</th>
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
  </main>`;
    const script = `
  (function () {
    var projectRows = document.getElementById("projectRows");
    var toolRows = document.getElementById("toolRows");
    var usageRows = document.getElementById("usageRows");
    var mintedTokenPanel = document.getElementById("mintedTokenPanel");
    var mintedTokenValue = document.getElementById("mintedTokenValue");
    var mintedTokenExpiry = document.getElementById("mintedTokenExpiry");
    var copyTokenMessage = document.getElementById("copyTokenMessage");
    var copyMintedTokenBtn = document.getElementById("copyMintedTokenBtn");

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

    function extractTokenId(inputValue) {
      var trimmed = String(inputValue || "").trim();
      if (!trimmed) return "";
      if (trimmed.indexOf(".") === -1) return trimmed;
      var parts = trimmed.split(".");
      if (parts.length < 2) return "";
      return parts[1] || "";
    }

    function renderProjects(projects) {
      if (!projectRows) return;
      if (!projects.length) {
        projectRows.innerHTML = '<tr><td colspan="8" class="text-muted">No projects found.</td></tr>';
        return;
      }
      projectRows.innerHTML = projects
        .map(function (project) {
          return "<tr>" +
            "<td>" + esc(project.id) + "</td>" +
            "<td>" + esc(project.slug) + "</td>" +
            "<td>" + esc(project.name) + "</td>" +
            "<td>" + esc(project.environment) + "</td>" +
            "<td>" + esc(project.ownerEmail) + "</td>" +
            "<td>" + esc(project.status) + "</td>" +
            "<td class=\\"text-nowrap\\">" + esc(formatNumber(project.rpmCap)) + "</td>" +
            "<td class=\\"text-nowrap\\">" + esc(formatNumber(project.dailyTokenCap)) + "</td>" +
          "</tr>";
        })
        .join("");
    }

    function renderTools(tools) {
      if (!toolRows) return;
      if (!tools.length) {
        toolRows.innerHTML = '<tr><td colspan="5" class="text-muted">No tools found.</td></tr>';
        return;
      }
      toolRows.innerHTML = tools
        .map(function (tool) {
          return "<tr>" +
            "<td>" + esc(tool.id) + "</td>" +
            "<td>" + esc(tool.slug) + "</td>" +
            "<td>" + esc(tool.projectId) + "</td>" +
            "<td>" + esc(tool.mode) + "</td>" +
            "<td>" + esc(tool.status) + "</td>" +
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

    async function loadProjects() {
      var data = await requestJson("/admin/projects");
      renderProjects(Array.isArray(data.projects) ? data.projects : []);
    }

    async function loadTools() {
      var data = await requestJson("/admin/tools");
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
          await requestJson("/admin/tools", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          setMessage("toolCreateMessage", "success", "Tool created.");
          await loadTools();
          createToolForm.reset();
        } catch (error) {
          setMessage("toolCreateMessage", "danger", error instanceof Error ? error.message : "Failed to create tool.");
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

    var revokeTokenForm = document.getElementById("revokeTokenForm");
    if (revokeTokenForm) {
      revokeTokenForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        clearMessage("tokenRevokeMessage");
        var formData = new FormData(revokeTokenForm);
        var toolId = toInt(formData.get("toolId"));
        var tokenId = extractTokenId(formData.get("tokenInput"));
        if (!toolId || !tokenId) {
          setMessage("tokenRevokeMessage", "danger", "Tool id and token id are required.");
          return;
        }

        try {
          await requestJson("/admin/tools/" + toolId + "/tokens/" + encodeURIComponent(tokenId) + "/revoke", {
            method: "POST"
          });
          setMessage("tokenRevokeMessage", "success", "Tool token revoked.");
          revokeTokenForm.reset();
        } catch (error) {
          setMessage("tokenRevokeMessage", "danger", error instanceof Error ? error.message : "Failed to revoke token.");
        }
      });
    }

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
      if (projectRows) projectRows.innerHTML = '<tr><td colspan="8" class="text-danger">' + esc(message) + "</td></tr>";
      if (toolRows) toolRows.innerHTML = '<tr><td colspan="5" class="text-danger">' + esc(message) + "</td></tr>";
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
        if (!email || !app.env.adminEmailAllowlist.has(email.toLowerCase())) {
            reply.clearCookie("admin_session", { path: "/" });
            return reply.type("text/html").send(loginPageHtml(errorKey ?? "session_expired"));
        }
        return reply.type("text/html").send(dashboardPageHtml(email, errorKey));
    });
    app.get("/admin/verify", async (request, reply) => {
        const parsed = verifyAdminSchema.safeParse(request.query);
        if (!parsed.success || parsed.data.scope !== "admin" || !parsed.data.token) {
            return reply.redirect("/admin?error=invalid_link");
        }
        const consumed = await deps.authService.consumeMagicLink("admin", parsed.data.token);
        if (!consumed || !app.env.adminEmailAllowlist.has(consumed.email.toLowerCase())) {
            return reply.redirect("/admin?error=invalid_or_expired_link");
        }
        const sessionToken = await deps.authService.createSession("admin", consumed.email);
        AuthService.setSessionCookie(reply, "admin", sessionToken);
        return reply.redirect("/admin");
    });
    app.post("/admin/logout", async (_request, reply) => {
        reply.clearCookie("admin_session", { path: "/" });
        return reply.code(303).redirect("/admin?error=signed_out");
    });
}
