import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  generateApiKey,
  rotateApiKey,
  SmsOtpManager,
  provisionZeroFrictionSandbox,
  OMR_BENCHMARK_BASELINES
} from "../../packages/database/src/index.mjs";
import {
  parseMusicXML,
  renderScoreToSVG,
  BENCHMARK_SCORES
} from "../../packages/score-player/src/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCORE_PLAYER_DIR = path.resolve(__dirname, "../../packages/score-player/src");
const PUBLIC_DIR = path.resolve(__dirname, "./public");

export const DEFAULT_WEB_PORT = 3100;

/**
 * Creates the Linnet Score Commercial & DX Web Application server (Plane 1):
 * - `/`           (marketing) Landing Page, Live OMR Playground (S-04), Benchmark Matrix (S-12), GBP Pricing Calculator (S-09)
 * - `/auth`       (auth) Split-Screen Sign-In/Up with SMS OTP, Passkeys, GitHub/Google OAuth & 60s Sandbox Hook (S-02, S-10, D-01)
 * - `/dashboard`  (dashboard) Overview, API Keys Vault (/keys), Job Inspector (/logs), Webhooks/CORS (/webhooks), Billing (/billing)
 */
export function createWebAppServer({ port = Number(process.env.PORT || DEFAULT_WEB_PORT) } = {}) {
  const defaultWebOrigin = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : `http://localhost:${port}`;
  const otpManager = new SmsOtpManager();

  // Seed default UK Sandbox Tenant State for immediate interactive demonstration
  const defaultOnboarding = provisionZeroFrictionSandbox({
    userId: "usr_london_01",
    organizationName: "Royal Conservatoire EdTech",
    icpSegment: "edtech",
    acquisitionChannel: "seo",
    apiTermsAccepted: true
  });

  const state = {
    organization: {
      ...defaultOnboarding.organization,
      ukVatNumber: "GB 948 2103 44",
      hardSpendCapGbpPence: 25000, // £250.00 cap
      pagesUsedThisMonth: 14,
      jobsUsedThisMonth: 9,
      firstApiCallAt: new Date(Date.now() - 42000).toISOString(),
      allowedOrigins: [defaultWebOrigin, "https://app.conservatoire.ac.uk"]
    },
    user: {
      id: "usr_london_01",
      email: "cto@conservatoire.ac.uk",
      phoneNumber: "+447700900077",
      phoneNumberVerified: true,
      lastStepUpVerifiedAt: null
    },
    apiKeys: [
      {
        ...defaultOnboarding.sandboxKeyRecord,
        lastUsedAt: "2 mins ago",
        lastUsedOrigin: "https://app.conservatoire.ac.uk"
      },
      {
        ...generateApiKey({
          environment: "live",
          name: "UK Production Backend",
          orgId: defaultOnboarding.organization.id,
          createdByUserId: "usr_london_01"
        }),
        lastUsedAt: "14 secs ago",
        lastUsedOrigin: "https://app.conservatoire.ac.uk"
      }
    ],
    omrJobs: [
      {
        id: "job_01j8x9k2m4p7q",
        timestamp: "2026-10-28 18:32:10 UTC",
        scoreCategory: "solo_piano",
        inputFormat: "pdf",
        outputFormat: "mxl",
        pages: 2,
        durationMs: 1380,
        confidencePct: 99.2,
        status: "200 OK",
        errorCode: null
      },
      {
        id: "job_01j8x9f7v2n1z",
        timestamp: "2026-10-28 18:24:05 UTC",
        scoreCategory: "choral_satb",
        inputFormat: "png",
        outputFormat: "musicxml",
        pages: 1,
        durationMs: 1290,
        confidencePct: 99.4,
        status: "200 OK",
        errorCode: null
      },
      {
        id: "job_01j8x8w3k9m0p",
        timestamp: "2026-10-28 18:10:44 UTC",
        scoreCategory: "general",
        inputFormat: "jpg",
        outputFormat: "mxl",
        pages: 1,
        durationMs: 210,
        confidencePct: 0,
        status: "422 Unprocessable",
        errorCode: "ERR_LOW_DPI_IMAGE"
      }
    ],
    oneTimeFlashKey: defaultOnboarding.oneTimeRawKeyFlash,
    quickstartCurl: defaultOnboarding.quickstartCurl,
    p1EditingRequests: 0,
    appWaitlistSubscribers: []
  };

  function readJsonBody(req) {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  function sendJson(res, status, data) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data));
  }

  function sendHtml(res, html) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  }

  const requestListener = async (req, res) => {
    const reqHost = req.headers?.host;
    const reqProto = String(req.headers?.["x-forwarded-proto"] || "http").split(",")[0].trim();
    const reqOrigin = reqHost ? `${reqProto}://${reqHost}` : defaultWebOrigin;
    const url = new URL(req.url || "/", reqOrigin);

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { status: "ok", service: "linnet-score-web" });
      return;
    }

    // Static CSS & Web Component SDK bundles
    if (url.pathname === "/styles.css") {
      res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
      res.end(fs.readFileSync(path.join(PUBLIC_DIR, "styles.css"), "utf8"));
      return;
    }

    if (url.pathname.startsWith("/sdk/")) {
      const fileName = path.basename(url.pathname);
      const filePath = path.join(SCORE_PLAYER_DIR, fileName);
      if (fs.existsSync(filePath)) {
        res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
        res.end(fs.readFileSync(filePath, "utf8"));
        return;
      }
    }

    // API: Send SMS OTP (Better-Auth phoneNumber flow)
    if (req.method === "POST" && url.pathname === "/api/auth/otp/send") {
      try {
        const body = await readJsonBody(req);
        const challenge = otpManager.issueChallenge({
          rawPhone: body.phoneNumber,
          ipAddress: req.socket.remoteAddress || "127.0.0.1",
          purpose: body.purpose || "signin"
        });
        sendJson(res, 200, {
          sent: true,
          phoneNumber: challenge.phoneNumber,
          expiresAt: challenge.expiresAt,
          demoOtpPreview: challenge.otpCodeForDispatch
        });
      } catch (err) {
        sendJson(res, 400, { error: { code: err.code || "ERR_OTP_SEND", message: err.message } });
      }
      return;
    }

    // API: Verify SMS OTP & Trigger 60-Second Zero-Friction Onboarding or Step-Up MFA
    if (req.method === "POST" && url.pathname === "/api/auth/otp/verify") {
      try {
        const body = await readJsonBody(req);
        const verified = otpManager.verifyChallenge({
          rawPhone: body.phoneNumber,
          otpCode: body.otpCode
        });
        state.user.phoneNumber = verified.phoneNumber;
        state.user.phoneNumberVerified = true;
        state.user.lastStepUpVerifiedAt = verified.verifiedAt;

        if (body.organizationName) {
          const provisioned = provisionZeroFrictionSandbox({
            userId: state.user.id,
            organizationName: body.organizationName,
            icpSegment: body.icpSegment || "learning_app",
            acquisitionChannel: "direct",
            apiTermsAccepted: Boolean(body.apiTermsAccepted)
          });
          state.organization = {
            ...state.organization,
            ...provisioned.organization
          };
          state.oneTimeFlashKey = provisioned.oneTimeRawKeyFlash;
          state.quickstartCurl = provisioned.quickstartCurl;
        }

        sendJson(res, 200, {
          verified: true,
          phoneNumber: verified.phoneNumber,
          verifiedAt: verified.verifiedAt,
          quickstartCurl: state.quickstartCurl,
          oneTimeRawKey: state.oneTimeFlashKey
        });
      } catch (err) {
        sendJson(res, 400, { error: { code: err.code || "ERR_OTP_VERIFY", message: err.message } });
      }
      return;
    }

    // API: Rotate Production API Key (Requires SMS OTP / Passkey Step-Up MFA)
    if (req.method === "POST" && url.pathname === "/api/keys/rotate") {
      try {
        const body = await readJsonBody(req);
        const targetKey = state.apiKeys.find((k) => k.id === body.keyId) || state.apiKeys[1];
        const rotated = rotateApiKey({
          existingKey: targetKey,
          gracePeriodHours: 24,
          lastStepUpVerifiedAt: state.user.lastStepUpVerifiedAt
        });
        state.apiKeys.unshift({
          ...rotated.replacementKey,
          lastUsedAt: "Just rotated",
          lastUsedOrigin: "—"
        });
        sendJson(res, 200, {
          rotated: true,
          graceExpiresAt: rotated.deprecatedKey.expiresAt,
          newKeyPrefix: rotated.replacementKey.keyPrefix,
          oneTimeRawKey: rotated.replacementKey.rawKey
        });
      } catch (err) {
        sendJson(res, 403, { error: { code: err.code || "ERR_STEP_UP_REQUIRED", message: err.message } });
      }
      return;
    }

    // API: Record P1 Score Editing SDK Demand Signal (Charter S-14, Risk R-03)
    if (req.method === "POST" && url.pathname === "/api/telemetry/p1-editing-demand") {
      state.p1EditingRequests += 1;
      state.organization.requestedEditingSdkAt = new Date().toISOString();
      sendJson(res, 200, {
        recorded: true,
        totalSignals: state.p1EditingRequests,
        message: "Recorded P1 Score Editing SDK demand signal (Charter S-14 / R-03)."
      });
      return;
    }

    // API: Linnet Mobile App (iOS App Store & Google Play) Early Access / Download Waitlist
    if (req.method === "POST" && url.pathname === "/api/app-waitlist") {
      const body = await readJsonBody(req);
      const contact = String(body.contact || "").trim();
      const platform = String(body.platform || "ios_and_android").trim();
      if (!contact) {
        sendJson(res, 400, { error: { code: "ERR_MISSING_CONTACT", message: "Please enter a phone number or email." } });
        return;
      }
      state.appWaitlistSubscribers.push({
        contact,
        platform,
        createdAt: new Date().toISOString()
      });
      sendJson(res, 200, {
        registered: true,
        totalWaitlist: state.appWaitlistSubscribers.length,
        message: `You're on the list! We will notify ${contact} as soon as Linnet launches on iOS App Store & Google Play.`
      });
      return;
    }

    // Route Group 1: (marketing) Commercial Landing Page & Live OMR Playground
    if (url.pathname === "/") {
      sendHtml(res, renderMarketingLandingPage(reqOrigin));
      return;
    }

    // Route Group 2: (auth) Low-Friction Sign-In / Sign-Up (SMS OTP + Passkeys + OAuth)
    if (url.pathname === "/auth") {
      sendHtml(res, renderAuthPage());
      return;
    }

    // Route Group 3: (dashboard) B2B & Music School Tenant Control Plane
    if (url.pathname === "/dashboard") {
      sendHtml(res, renderDashboardPage(state, reqOrigin));
      return;
    }

    // Route Group 4: (/practice/:jobId) No-Code Student Practice Room for Music Schools & Students
    if (url.pathname.startsWith("/practice/")) {
      const jobId = decodeURIComponent(url.pathname.slice("/practice/".length)) || "job_01j8x9k2m4p7q";
      const preset = url.searchParams.get("preset") || "solo_piano";
      sendHtml(res, renderStudentPracticePage(state, jobId, preset));
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  };

  const server = http.createServer(requestListener);
  server.dispatchRequest = async ({ method = "GET", path = "/", body = null, headers: reqHeaders = {} }) => {
    const payload = body ? JSON.stringify(body) : "";
    const normalizedHeaders = Object.fromEntries(
      Object.entries(reqHeaders).map(([k, v]) => [k.toLowerCase(), v])
    );
    const req = {
      method,
      url: path,
      headers: normalizedHeaders,
      socket: { remoteAddress: "127.0.0.1" },
      on(event, cb) {
        if (event === "data" && payload) cb(Buffer.from(payload, "utf8"));
        if (event === "end") cb();
      }
    };
    let statusCode = 200;
    let headers = {};
    let responseBody = "";
    const res = {
      writeHead(status, hdrs = {}) {
        statusCode = status;
        headers = hdrs;
      },
      end(chunk = "") {
        responseBody += String(chunk);
      }
    };
    await requestListener(req, res);
    return {
      status: statusCode,
      headers,
      text: () => responseBody,
      json: () => JSON.parse(responseBody)
    };
  };

  return server;
}

function renderHeader(activePath) {
  return `
  <header class="site-header" id="site-header">
    <div class="container nav-inner" id="nav-inner">
      <a href="/" class="brand-logo">
        <span>Linnet Score</span>
      </a>
      <nav class="site-nav" aria-label="Primary Navigation">
        <button
          class="menu-button btn btn-sandstone"
          type="button"
          popovertarget="site-menu"
          popovertargetaction="toggle"
          aria-controls="site-menu"
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
          <span>Menu</span>
        </button>
        <ul id="site-menu" class="site-menu" popover="auto">
          <li><a href="/#playground" class="nav-link">OMR Playground</a></li>
          <li><a href="/#linnet-app" class="nav-link">Linnet Mobile App</a></li>
          <li><a href="/#schools" class="nav-link">For Music Schools</a></li>
          <li><a href="/#pricing" class="nav-link">Pricing</a></li>
          <li><a href="/auth" class="nav-link" ${activePath === "/auth" ? 'aria-current="page"' : ""}>Sign In / OTP</a></li>
          <li><a href="/dashboard" class="btn btn-cypress" ${activePath === "/dashboard" ? 'aria-current="page"' : ""}>Dashboard &amp; Educator Studio →</a></li>
        </ul>
      </nav>
    </div>
  </header>
  <script type="module">
    if (!Object.hasOwn(HTMLElement.prototype, "popover")) {
      import("https://unpkg.com/@oddbird/popover-polyfill@latest/dist/popover.min.js");
    }

    const header = document.getElementById("site-header");
    const inner = document.getElementById("nav-inner");
    const menu = document.getElementById("site-menu");
    let lastHeaderWidth = 0;

    function isMenuPopoverOpen() {
      if (!menu) return false;
      try {
        return menu.matches(":popover-open");
      } catch {
        return menu.classList.contains(":popover-open");
      }
    }

    function syncNavLayout() {
      if (!header || !inner || !menu) return;
      const wasOpen = isMenuPopoverOpen();
      header.classList.add("is-measuring");
      menu.removeAttribute("popover");
      header.classList.add("is-wide");
      const wide = inner.scrollWidth <= inner.clientWidth;
      header.classList.toggle("is-wide", wide);
      if (!wide) {
        menu.setAttribute("popover", "auto");
        if (wasOpen && typeof menu.showPopover === "function") {
          try {
            menu.showPopover();
          } catch {}
        }
      }
      lastHeaderWidth = header.getBoundingClientRect().width;
      requestAnimationFrame(() => header.classList.remove("is-measuring"));
    }

    if (header && inner && menu) {
      syncNavLayout();
      if ("ResizeObserver" in window) {
        const ro = new ResizeObserver(() => {
          const currentWidth = header.getBoundingClientRect().width;
          const isCurrentlyWide = header.classList.contains("is-wide");
          if (isCurrentlyWide || currentWidth > lastHeaderWidth) {
            syncNavLayout();
          }
        });
        ro.observe(header);
        ro.observe(menu);
      }
      if (document.fonts?.ready) {
        document.fonts.ready.then(syncNavLayout);
      }
      menu.querySelectorAll("a").forEach((link) => {
        link.addEventListener("click", () => {
          if (!header.classList.contains("is-wide") && typeof menu.hidePopover === "function") {
            try {
              menu.hidePopover();
            } catch {}
          }
        });
      });
    }
  </script>`;
}

function renderMarketingLandingPage(webOrigin = `http://localhost:${DEFAULT_WEB_PORT}`) {
  const initialScoreModel = parseMusicXML(BENCHMARK_SCORES.solo_piano.musicXML);
  const ssrSvg = renderScoreToSVG(initialScoreModel);

  const benchmarkRows = OMR_BENCHMARK_BASELINES.map(
    (b) => `
    <tr>
      <th scope="row">${b.title}</th>
      <td><span class="status-pill status-sage">P0 Supported</span></td>
      <td class="font-mono">&gt;= ${b.minRecommendedDpi} DPI</td>
      <td class="font-mono">${b.notePitchAccuracyPct}%</td>
      <td class="font-mono">${b.rhythmDurationAccuracyPct}%</td>
      <td class="font-mono">${(b.medianLatencyMs / 1000).toFixed(2)}s</td>
    </tr>`
  ).join("");

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Linnet Score — Sheet Music Intelligence, Engineered for Developers</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  ${renderHeader("/")}

  <main class="container main-section">
    <!-- Hero Section (Deliverable S-08) -->
    <section style="text-align: center; max-width: 820px; margin: 0 auto 56px;">
      <h1 class="hero-title">Sheet Music Intelligence, Engineered for Developers.</h1>
      <p class="hero-lead">
        Powered by the proven sheet-music-to-sound engine behind <strong>Linnet</strong>. Whether you are a <strong>software company</strong> embedding our OMR REST API &amp; <code>&lt;linnet-score-player&gt;</code> SDK, a <strong>music school</strong> sharing interactive practice scores with students, or a <strong>musician</strong> looking for our mobile practice companion—everything starts here.
      </p>
      <div class="hero-actions">
        <a href="/auth" class="btn btn-cypress">Businesses &amp; Schools — Get Free 50-Page API Key</a>
        <a href="#linnet-app" class="btn btn-sandstone">Musicians &amp; Students — Get the Linnet App</a>
        <a href="/practice/job_01j8x9k2m4p7q" class="btn btn-sandstone">Try Student Practice Room</a>
      </div>
    </section>

    <!-- Interactive Live OMR Playground (Deliverable S-04, S-05, S-06) -->
    <section id="playground" class="cashmere-card" style="margin-bottom: 56px;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 20px;">
        <div>
          <h2 class="section-title" style="margin-bottom: 4px;">Interactive Live OMR Playground</h2>
          <p style="margin: 0; color: var(--text-umber); font-size: 14px;">Upload a sheet music PDF/PNG or select a verified UK benchmark score to see SVG engraving and hear client-side Web Audio synthesis.</p>
        </div>
        <span id="playground-telemetry" class="status-pill status-sage" aria-live="polite">200 OK · 1.38s · 99.2% Confidence · eu-west-2</span>
      </div>

      <div class="split-grid">
        <!-- Left Pane: Score Selection & Upload -->
        <div class="alabaster-panel" style="display: flex; flex-direction: column; justify-content: space-between; gap: 16px;">
          <div>
            <div style="font-weight: 600; font-size: 13px; color: var(--text-umber); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 10px;">1. Select Benchmark Score (S-12)</div>
            <div style="display: flex; flex-direction: column; gap: 8px;">
              <button type="button" class="btn btn-cypress" data-preset-btn="solo_piano" style="justify-content: flex-start;">🎹 Solo Piano — Chopin Op. 9 No. 2</button>
              <button type="button" class="btn btn-sandstone" data-preset-btn="choral_satb" style="justify-content: flex-start;">🎶 Choral SATB — J.S. Bach BWV 244</button>
              <button type="button" class="btn btn-sandstone" data-preset-btn="lead_sheet" style="justify-content: flex-start;">🎷 Lead Sheet — Autumn Jazz Standard</button>
            </div>
          </div>

          <div id="playground-dropzone" class="dropzone">
            <div style="font-weight: 600; font-size: 13.5px; margin-bottom: 4px;">Drop PDF, PNG, or JPG Score</div>
            <div style="font-size: 12px; color: var(--text-umber); margin-bottom: 10px;">Min 150 DPI · Max 25 MB · Encrypted eu-west-2</div>
            <label for="playground-file-input" class="btn btn-sandstone" style="font-size: 12.5px; padding: 6px 12px; cursor: pointer;">
              Choose Score File
              <input type="file" accept=".pdf,.png,.jpg,.jpeg" id="playground-file-input" hidden />
            </label>
            <div id="upload-feedback" aria-live="polite" style="font-size: 12px; margin-top: 8px; color: var(--status-sage);"></div>
          </div>

          <div style="font-size: 12px; color: var(--text-umber);">
            Need to embed this in your app? <a href="/auth" style="color: var(--brand-cypress); font-weight: 600;">Claim your 50-page free Sandbox key in 60s →</a>
          </div>
        </div>

        <!-- Right Pane: Rendered <linnet-score-player> + MusicXML Code Tree + API Response Tabs -->
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <div class="playground-tabs" role="tablist" aria-label="OMR Playground output views">
            <button type="button" class="playground-tab" role="tab" id="tab-viewer" aria-selected="true" tabindex="0" data-tab-target="viewer">Rendered Score + Audio SDK</button>
            <button type="button" class="playground-tab" role="tab" id="tab-musicxml" aria-selected="false" tabindex="-1" data-tab-target="musicxml">Raw MusicXML 4.0 Tree</button>
            <button type="button" class="playground-tab" role="tab" id="tab-json" aria-selected="false" tabindex="-1" data-tab-target="json">API Response Telemetry</button>
          </div>

          <div class="playground-panels">
            <div id="tab-panel-viewer" role="tabpanel" aria-labelledby="tab-viewer" tabindex="0">
              <linnet-score-player id="playground-player" preset="solo_piano" tempo="104" loop="false">
                <div class="alabaster-panel">${ssrSvg}</div>
              </linnet-score-player>
            </div>

            <div id="tab-panel-musicxml" role="tabpanel" aria-labelledby="tab-musicxml" hidden="until-found">
              <pre id="tab-musicxml-code" class="alabaster-panel font-mono" style="margin: 0; font-size: 12px; max-height: 310px; overflow: auto;"></pre>
            </div>

            <div id="tab-panel-json" role="tabpanel" aria-labelledby="tab-json" hidden="until-found">
              <pre id="tab-json-code" class="alabaster-panel font-mono" style="margin: 0; font-size: 12px; max-height: 310px; overflow: auto;"></pre>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Supported Score Types & Benchmark Transparency Matrix (Deliverable S-12 & Mitigating Risk R-01) -->
    <section id="benchmarks" style="margin-bottom: 56px;">
      <h2 id="benchmarks-heading" class="section-title" style="margin-bottom: 8px;">OMR Benchmark Baseline &amp; Supported Score Matrix</h2>
      <p style="color: var(--text-umber); margin-bottom: 20px;">
        Per Project Charter Deliverable <code>S-12</code> and Risk Mitigation <code>R-01</code>, we publish repeatable accuracy benchmarks across supported engraved score categories and clearly flag unsupported inputs before integration.
      </p>
      <div class="cashmere-card">
        <div tabindex="0" role="region" aria-labelledby="benchmarks-heading" class="table-wrapper">
          <table class="linnet-table table-benchmarks">
            <thead>
              <tr>
                <th>Benchmark Corpus</th>
                <th>Support Tier</th>
                <th>Min DPI</th>
                <th>Pitch Accuracy</th>
                <th>Rhythm Accuracy</th>
                <th>Median Latency</th>
              </tr>
            </thead>
            <tbody>
              ${benchmarkRows}
              <tr>
                <th scope="row">Dense Handwritten Manuscripts / Graphic Scores</th>
                <td><span class="status-pill status-terracotta">Out of P0 Scope (R-01)</span></td>
                <td class="font-mono">N/A</td>
                <td class="font-mono">—</td>
                <td class="font-mono">—</td>
                <td class="font-mono">Returns ERR_UNSUPPORTED_LAYOUT</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- 10-Line SDK Integration Showcase & No-Code Music School Studio (Deliverables S-05, S-06, S-07) -->
    <section id="schools" class="split-grid split-grid--even" style="margin-bottom: 56px;">
      <div class="cashmere-card">
        <span class="status-pill status-sage" style="margin-bottom: 10px;">For App Developers &amp; Music-Tech Products</span>
        <h3 class="card-title" style="margin-bottom: 8px;">1. Digitize via API &amp; Embed <code>&lt;linnet-score-player&gt;</code></h3>
        <p style="font-size: 14px; color: var(--text-umber);">Send a sheet music PDF/photo to our London <code>eu-west-2</code> Go Gateway and render interactive notation + sound in 10 lines of code:</p>
        <pre class="alabaster-panel font-mono" style="font-size: 12px; overflow-x: auto;">curl -X POST https://api.linnet.dev/v1/omr/jobs \\
  -H "Authorization: Bearer lnt_live_8f9a..." \\
  -F "file=@./chopin-nocturne.pdf"

&lt;linnet-score-player job-id="job_01j8x9k2m4p7q" tempo="112" loop="true"&gt;&lt;/linnet-score-player&gt;</pre>
      </div>
      <div class="cashmere-card">
        <span class="status-pill status-ochre" style="margin-bottom: 10px;">For Music Schools, Conservatoires &amp; Teachers</span>
        <h3 class="card-title" style="margin-bottom: 8px;">2. No-Code Student Practice Links &amp; LMS Embeds</h3>
        <p style="font-size: 14px; color: var(--text-umber);">
          Don't have a software team? Upload any sheet music PDF in the <strong>Educator Studio</strong> to give your music students a dedicated practice link where they can hear the melody, slow down the tempo, and loop bars between lessons:
        </p>
        <div class="alabaster-panel" style="display: flex; flex-direction: column; gap: 10px;">
          <div class="font-mono" style="font-size: 12px; color: var(--brand-cypress); word-break: break-all;">${webOrigin}/practice/job_01j8x9k2m4p7q</div>
          <div class="flex-wrap-row">
            <a href="/practice/job_01j8x9k2m4p7q" class="btn btn-cypress" style="padding: 7px 14px; font-size: 13px;">🎓 Open Live Student Practice Room →</a>
            <a href="/dashboard#educator-studio" class="btn btn-sandstone" style="padding: 7px 14px; font-size: 13px;">Open Educator Studio</a>
          </div>
        </div>
      </div>
    </section>

    <!-- Linnet Mobile App for Musicians & Students (Evolving from NoteAva / notavaa.com) -->
    <section id="linnet-app" class="cashmere-card" style="margin-bottom: 56px; background: var(--brand-cypress); color: var(--bg-alabaster);">
      <div class="split-grid split-grid--app">
        <div>
          <span class="status-pill" style="background: rgba(250, 246, 240, 0.15); color: var(--bg-alabaster); margin-bottom: 14px;">📱 For Individual Musicians &amp; Music Students · Powered by NoteAva</span>
          <h2 class="section-title" style="color: var(--bg-alabaster); margin-bottom: 12px;">The Linnet App: Take a Photo of Sheet Music &amp; Hear It Play.</h2>
          <p style="color: var(--border-sandstone); font-size: 15.5px; margin-bottom: 18px;">
            Practicing at home and unsure how a measure, rhythm, or interval is supposed to sound? With the <strong>Linnet</strong> mobile practice companion, simply snap a photo of your paper sheet music and listen to an accurate playback immediately—without waiting until your next music lesson.
          </p>
          <ul style="color: var(--border-sandstone); font-size: 14px; padding-left: 20px; margin-bottom: 22px;">
            <li><strong>Instant Camera-to-Sound Scanning:</strong> Photograph any printed exercise or piece and hear the melody and rhythm.</li>
            <li><strong>Step-by-Step Student Practice:</strong> Adjust tempo, loop tricky passages, and verify notes &amp; timing with confidence.</li>
          </ul>
          <div class="flex-wrap-row">
            <span class="btn" style="background: rgba(250, 246, 240, 0.12); color: var(--bg-alabaster); border-color: rgba(228, 214, 200, 0.3); cursor: default;"> App Store (Coming Soon)</span>
            <span class="btn" style="background: rgba(250, 246, 240, 0.12); color: var(--bg-alabaster); border-color: rgba(228, 214, 200, 0.3); cursor: default;">▶ Google Play (Coming Soon)</span>
          </div>
        </div>

        <form id="app-waitlist-form" class="alabaster-panel" style="color: var(--text-obsidian); display: flex; flex-direction: column; gap: 12px;">
          <div class="font-serif" style="font-size: 24px;">Get Early Access &amp; Direct App Download Link</div>
          <p style="margin: 0; font-size: 13px; color: var(--text-umber);">
            Enter your UK/international mobile number (SMS) or email to receive the direct beta download &amp; instant notification when <strong>Linnet</strong> goes live on the App Store and Google Play:
          </p>
          <input type="text" id="waitlist-contact-input" placeholder="+44 7700 900077 or student@music.ac.uk" required style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border-sandstone); font: inherit;" />
          <select id="waitlist-platform-select" style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border-sandstone); font: inherit; background: var(--bg-alabaster);">
            <option value="ios_and_android">iOS (iPhone / iPad) &amp; Android</option>
            <option value="ios">iOS App Store Only</option>
            <option value="android">Google Play / Direct Android APK</option>
          </select>
          <button type="submit" class="btn btn-cypress">Notify Me &amp; Send Early Access Link</button>
          <div id="waitlist-status-msg" aria-live="polite" style="font-size: 12.5px; color: var(--status-sage);"></div>
        </form>
      </div>
    </section>

    <!-- Transparent GBP (£) Pricing Calculator (Deliverable S-09 & Decision D-05) -->
    <section id="pricing" class="cashmere-card">
      <div style="display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 16px; margin-bottom: 24px;">
        <div style="flex: 1 1 320px;">
          <h2 class="section-title" style="margin-bottom: 6px;">Transparent UK GBP (£) Pricing Calculator</h2>
          <p style="margin: 0; color: var(--text-umber);">Start with 50 free pages in the Sandbox Tier (no credit card required). Configure hard spend caps on any paid plan.</p>
        </div>
        <div class="alabaster-panel pricing-calc-box">
          <label for="calc-pages-slider" style="display: flex; justify-content: space-between; font-size: 13px; font-weight: 600; margin-bottom: 6px; gap: 8px;">
            <span>Estimated Monthly Pages:</span>
            <span class="font-mono" id="calc-pages-label">1,500 pages/mo</span>
          </label>
          <input type="range" id="calc-pages-slider" min="50" max="10000" step="50" value="1500" style="width: 100%; accent-color: var(--brand-cypress);" />
          <div style="display: flex; justify-content: space-between; font-size: 12px; color: var(--text-umber); margin-top: 4px; gap: 8px;">
            <span>Recommended Tier: <strong id="calc-tier-name" style="color: var(--brand-cypress);">Growth</strong></span>
            <span class="font-mono" id="calc-total-gbp" style="font-weight: 700; color: var(--text-obsidian);">£109 / mo + VAT</span>
          </div>
        </div>
      </div>

      <div class="kpi-grid">
        <div class="alabaster-panel">
          <div class="font-serif" style="font-size: 24px;">Sandbox</div>
          <div class="font-mono" style="font-size: 26px; font-weight: 700; margin: 8px 0;">£0 <span style="font-size: 13px; font-weight: 400; color: var(--text-umber);">/ month</span></div>
          <p style="font-size: 13px; color: var(--text-umber);">50 free pages/mo · Instant <code>lnt_test_</code> key · Localhost + 1 staging origin.</p>
        </div>
        <div class="alabaster-panel" style="border: 2px solid var(--brand-cypress);">
          <div class="font-serif" style="font-size: 24px;">Growth</div>
          <div class="font-mono" style="font-size: 26px; font-weight: 700; margin: 8px 0;">£79 <span style="font-size: 13px; font-weight: 400; color: var(--text-umber);">/ month</span></div>
          <p style="font-size: 13px; color: var(--text-umber);">Includes 1,000 pages/mo (+£0.06/page overage) · 5 CORS Allowed Origins · Webhooks.</p>
        </div>
        <div class="alabaster-panel">
          <div class="font-serif" style="font-size: 24px;">Scale</div>
          <div class="font-mono" style="font-size: 26px; font-weight: 700; margin: 8px 0;">£299 <span style="font-size: 13px; font-weight: 400; color: var(--text-umber);">/ month</span></div>
          <p style="font-size: 13px; color: var(--text-umber);">Includes 5,000 pages/mo (+£0.04/page overage) · 99.9% SLA · 24h key rotation window.</p>
        </div>
        <div class="alabaster-panel">
          <div class="font-serif" style="font-size: 24px;">Enterprise &amp; OEM</div>
          <div class="font-mono" style="font-size: 26px; font-weight: 700; margin: 8px 0;">£1,250+ <span style="font-size: 13px; font-weight: 400; color: var(--text-umber);">/ month</span></div>
          <p style="font-size: 13px; color: var(--text-umber);">25,000+ pages/mo · OEM/Reseller licensing (R-05) · Dedicated worker concurrency.</p>
        </div>
      </div>
    </section>
  </main>

  <script type="module">
    import { defineLinnetScorePlayer, BENCHMARK_SCORES } from "/sdk/index.mjs";
    defineLinnetScorePlayer();

    const player = document.getElementById("playground-player");
    const telemetryPill = document.getElementById("playground-telemetry");
    const xmlCodeEl = document.getElementById("tab-musicxml-code");
    const jsonCodeEl = document.getElementById("tab-json-code");
    const uploadFeedback = document.getElementById("upload-feedback");
    const fileInput = document.getElementById("playground-file-input");
    const dropzone = document.getElementById("playground-dropzone");
    const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
    const panels = {
      viewer: document.getElementById("tab-panel-viewer"),
      musicxml: document.getElementById("tab-panel-musicxml"),
      json: document.getElementById("tab-panel-json")
    };

    function selectPreset(presetKey, uploadMeta = null) {
      const preset = BENCHMARK_SCORES[presetKey];
      if (!preset) return;
      player?.setAttribute("preset", presetKey);
      if (telemetryPill) {
        telemetryPill.textContent = \`200 OK · \${(preset.latencyMs / 1000).toFixed(2)}s · \${preset.confidencePct}% Confidence · eu-west-2\`;
      }
      if (xmlCodeEl) {
        xmlCodeEl.textContent = preset.musicXML;
      }
      if (jsonCodeEl) {
        jsonCodeEl.textContent = JSON.stringify({
          id: preset.id,
          status: "completed",
          score_category: preset.category,
          support_tier: preset.supportTier,
          processing_time_ms: preset.latencyMs,
          confidence_score: preset.confidencePct / 100,
          storage_region: "eu-west-2",
          gdpr_auto_delete_hours: 24,
          ...(uploadMeta ? {
            mode: "prototype_preview",
            uploaded_filename: uploadMeta.uploadedFilename,
            file_size_bytes: uploadMeta.fileSizeBytes
          } : {})
        }, null, 2);
      }

      document.querySelectorAll("[data-preset-btn]").forEach((btn) => {
        btn.className = btn.getAttribute("data-preset-btn") === presetKey ? "btn btn-cypress" : "btn btn-sandstone";
      });
    }

    selectPreset("solo_piano");

    document.querySelectorAll("[data-preset-btn]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (uploadFeedback) uploadFeedback.textContent = "";
        selectPreset(btn.getAttribute("data-preset-btn"));
      });
    });

    function activateTab(selectedTab, moveFocus = false) {
      const target = selectedTab?.getAttribute("data-tab-target");
      if (!target) return;
      for (const tab of tabs) {
        const isSelected = tab === selectedTab;
        tab.setAttribute("aria-selected", String(isSelected));
        tab.tabIndex = isSelected ? 0 : -1;
      }
      for (const [key, panel] of Object.entries(panels)) {
        if (!panel) continue;
        if (key === target) {
          panel.hidden = false;
          if (key === "viewer") panel.setAttribute("tabindex", "0");
          else panel.removeAttribute("tabindex");
        } else {
          panel.hidden = "until-found";
          panel.removeAttribute("tabindex");
        }
      }
      selectedTab.scrollIntoView({ block: "nearest", inline: "nearest", container: "nearest" });
      if (moveFocus) selectedTab.focus();
    }

    tabs.forEach((tab, idx) => {
      tab.addEventListener("click", () => activateTab(tab));
      tab.addEventListener("keydown", (e) => {
        let nextIdx = null;
        if (e.key === "ArrowRight") nextIdx = (idx + 1) % tabs.length;
        else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + tabs.length) % tabs.length;
        else if (e.key === "Home") nextIdx = 0;
        else if (e.key === "End") nextIdx = tabs.length - 1;
        if (nextIdx !== null) {
          e.preventDefault();
          activateTab(tabs[nextIdx], true);
        }
      });
    });

    Object.entries(panels).forEach(([key, panel]) => {
      panel?.addEventListener("beforematch", () => {
        const matchingTab = tabs.find((t) => t.getAttribute("data-tab-target") === key);
        if (matchingTab) activateTab(matchingTab);
      });
    });

    function handleUploadedScoreFile(file) {
      if (!file || !uploadFeedback) return;
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      if (!["pdf", "png", "jpg", "jpeg"].includes(ext)) {
        uploadFeedback.style.color = "var(--status-terracotta)";
        uploadFeedback.textContent = "ERR_INVALID_MIME_TYPE: Only .pdf, .png, or .jpg files are supported.";
        return;
      }
      if (file.size > 25 * 1024 * 1024) {
        uploadFeedback.style.color = "var(--status-terracotta)";
        uploadFeedback.textContent = "File exceeds the 25 MB upload limit.";
        return;
      }

      const lower = file.name.toLowerCase();
      const matchedPreset = /choral|satb|bach/.test(lower)
        ? "choral_satb"
        : /jazz|lead|chord/.test(lower)
          ? "lead_sheet"
          : "solo_piano";

      selectPreset(matchedPreset, {
        uploadedFilename: file.name,
        fileSizeBytes: file.size
      });
      uploadFeedback.style.color = "var(--status-sage)";
      uploadFeedback.textContent = \`Digitized "\${file.name}" (\${Math.max(1, Math.round(file.size / 1024))} KB) — Prototype preview loaded\`;
    }

    fileInput?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) handleUploadedScoreFile(file);
    });

    dropzone?.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("is-dragover");
    });

    dropzone?.addEventListener("dragleave", () => {
      dropzone.classList.remove("is-dragover");
    });

    dropzone?.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("is-dragover");
      const file = e.dataTransfer?.files?.[0];
      if (file) handleUploadedScoreFile(file);
    });

    // Interactive GBP Pricing Calculator (Deliverable S-09)
    const slider = document.getElementById("calc-pages-slider");
    const pagesLabel = document.getElementById("calc-pages-label");
    const tierName = document.getElementById("calc-tier-name");
    const totalGbp = document.getElementById("calc-total-gbp");

    slider?.addEventListener("input", () => {
      const pages = Number(slider.value);
      pagesLabel.textContent = \`\${pages.toLocaleString("en-GB")} pages/mo\`;
      if (pages <= 50) {
        tierName.textContent = "Sandbox";
        totalGbp.textContent = "£0 / mo";
      } else if (pages <= 4500) {
        const overage = Math.max(0, pages - 1000) * 0.06;
        tierName.textContent = "Growth";
        totalGbp.textContent = \`£\${Math.round(79 + overage)} / mo + VAT\`;
      } else {
        const overage = Math.max(0, pages - 5000) * 0.04;
        tierName.textContent = "Scale";
        totalGbp.textContent = \`£\${Math.round(299 + overage)} / mo + VAT\`;
      }
    });

    // Linnet Mobile App Waitlist Handler
    const waitlistForm = document.getElementById("app-waitlist-form");
    const waitlistContact = document.getElementById("waitlist-contact-input");
    const waitlistPlatform = document.getElementById("waitlist-platform-select");
    const waitlistMsg = document.getElementById("waitlist-status-msg");

    waitlistForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const res = await fetch("/api/app-waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact: waitlistContact.value,
          platform: waitlistPlatform.value
        })
      });
      const data = await res.json();
      waitlistMsg.textContent = data.message || data.error?.message || "";
    });
  </script>
</body>
</html>`;
}

function renderAuthPage() {
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sign In / Instant Sandbox — Linnet Score</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  ${renderHeader("/auth")}

  <main class="container main-section">
    <div class="split-grid split-grid--auth">
      <!-- Left Panel (#FAF6F0 Alabaster): Multi-Modal Auth with SMS OTP, Passkeys & OAuth -->
      <section class="cashmere-card">
        <span class="status-pill status-sage" style="margin-bottom: 12px;">Zero-Friction 60-Second Sandbox Provisioning</span>
        <h1 class="page-title" style="margin-bottom: 8px;">Sign in or claim your UK Sandbox API Key</h1>
        <p style="color: var(--text-umber); font-size: 14.5px; margin-bottom: 20px;">
          Authenticate via <strong>SMS OTP</strong>, <strong>WebAuthn Passkey</strong>, or <strong>GitHub / Google Workspace SSO</strong>. Your default workspace and 50-page Sandbox key are provisioned immediately.
        </p>

        <!-- Instant SSO / Passkey Buttons -->
        <div class="auth-sso-grid">
          <a href="/dashboard" class="btn btn-sandstone" style="font-size: 13px;">🔑 Passkey</a>
          <a href="/dashboard" class="btn btn-sandstone" style="font-size: 13px;">🐙 GitHub SSO</a>
          <a href="/dashboard" class="btn btn-sandstone" style="font-size: 13px;">🏢 Google SSO</a>
        </div>

        <div style="text-align: center; font-size: 12px; color: var(--text-umber); margin: 16px 0;">— OR VERIFY VIA UK / INTERNATIONAL SMS OTP —</div>

        <!-- SMS OTP Form -->
        <form id="sms-otp-form" class="alabaster-panel" style="display: flex; flex-direction: column; gap: 14px;">
          <div>
            <label for="org-name-input" style="display: block; font-size: 12.5px; font-weight: 600; color: var(--text-umber); margin-bottom: 4px;">Organization Workspace Name</label>
            <input id="org-name-input" type="text" value="London Music-Tech Labs" required style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border-sandstone); background: var(--bg-alabaster); font: inherit;" />
          </div>

          <div class="auth-fields-grid">
            <div>
              <label for="phone-input" style="display: block; font-size: 12.5px; font-weight: 600; color: var(--text-umber); margin-bottom: 4px;">Phone Number (E.164 / UK +44)</label>
              <input id="phone-input" type="tel" class="font-mono" value="+44 7700 900077" required style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border-sandstone); background: var(--bg-alabaster);" />
            </div>
            <div>
              <label for="icp-select" style="display: block; font-size: 12.5px; font-weight: 600; color: var(--text-umber); margin-bottom: 4px;">Product Segment (Charter D-01)</label>
              <select id="icp-select" style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border-sandstone); background: var(--bg-alabaster); font: inherit;">
                <option value="learning_app">Music Learning / Practice App</option>
                <option value="sheet_music_platform">Choir / Digital Score Platform</option>
                <option value="publisher">Sheet Music Publisher</option>
                <option value="edtech">EdTech / Conservatoire LMS</option>
                <option value="other">Other B2B Integration</option>
              </select>
            </div>
          </div>

          <label style="display: flex; align-items: flex-start; gap: 8px; font-size: 12.5px; color: var(--text-umber);">
            <input type="checkbox" id="terms-checkbox" checked required style="margin-top: 3px; accent-color: var(--brand-cypress);" />
            <span>I accept the <strong>Linnet Score UK API Terms &amp; Anti-Resale Policy (Deliverable S-10 / Risk R-05)</strong>. Standalone API wrapping or resale requires an OEM agreement.</span>
          </label>

          <button type="submit" class="btn btn-cypress" id="send-otp-btn">Send 6-Digit SMS Verification Code (OTP)</button>

          <div id="otp-verify-box" style="display: none; border-top: 1px solid var(--border-sandstone); padding-top: 14px;">
            <div class="flex-wrap-row" style="justify-content: space-between;">
              <span style="font-size: 13px; font-weight: 600;">Enter 6-Digit Code (5-min TTL · Max 3 Attempts)</span>
              <span class="status-pill status-sage font-mono" id="otp-demo-hint"></span>
            </div>
            <input id="otp-code-input" type="text" maxlength="6" placeholder="123456" class="font-mono" style="width: 100%; padding: 12px; font-size: 20px; letter-spacing: 0.35em; text-align: center; border-radius: 8px; border: 1.5px solid var(--brand-cypress); margin: 10px 0;" />
            <button type="button" class="btn btn-cypress" id="verify-otp-btn" style="width: 100%;">Verify OTP &amp; Provision 50-Page Sandbox Key →</button>
          </div>
          <div id="auth-status-msg" aria-live="polite" style="font-size: 13px;"></div>
        </form>
      </section>

      <!-- Right Panel (#1B3B2B Lush Cypress): Live OMR Manuscript Scanner & cURL Preview -->
      <section style="background: var(--brand-cypress); color: var(--bg-alabaster); border-radius: 16px; padding: clamp(20px, 3.5vw, 32px); display: flex; flex-direction: column; justify-content: space-between; gap: 18px;">
        <div>
          <span class="status-pill" style="background: rgba(250, 246, 240, 0.14); color: var(--bg-alabaster); margin-bottom: 16px;">Core IP Isolated · Private VPC mTLS</span>
          <h2 class="section-title" style="color: var(--bg-alabaster); margin-bottom: 12px;">From signup to first production OMR call in under 60 seconds.</h2>
          <p style="color: var(--border-sandstone); font-size: 14.5px;">
            The moment your SMS OTP or Passkey verifies, our onboarding hook provisions your isolated PostgreSQL RLS workspace and pre-populates your working Sandbox cURL command:
          </p>
        </div>

        <pre class="font-mono" style="background: rgba(28, 25, 23, 0.45); border: 1px solid rgba(228, 214, 200, 0.25); color: var(--bg-alabaster); padding: 18px; border-radius: 12px; font-size: 12.5px; overflow-x: auto;">curl -X POST https://api.linnet.dev/v1/omr/jobs \\
  -H "Authorization: Bearer lnt_test_8f9a2b..." \\
  -F "file=@./chopin-nocturne.pdf" \\
  -F "output_format=mxl"

# HTTP/1.1 201 Created (1.34s · eu-west-2)
{
  "id": "job_01j8x9k2m4p7q",
  "status": "completed",
  "confidence_score": 0.992,
  "output_download_url": "https://api.linnet.dev/v1/omr/jobs/job_01j8x9k2m4p7q/score"
}</pre>
      </section>
    </div>
  </main>

  <script type="module">
    const form = document.getElementById("sms-otp-form");
    const phoneInput = document.getElementById("phone-input");
    const orgInput = document.getElementById("org-name-input");
    const icpSelect = document.getElementById("icp-select");
    const termsCheckbox = document.getElementById("terms-checkbox");
    const verifyBox = document.getElementById("otp-verify-box");
    const demoHint = document.getElementById("otp-demo-hint");
    const otpInput = document.getElementById("otp-code-input");
    const verifyBtn = document.getElementById("verify-otp-btn");
    const statusMsg = document.getElementById("auth-status-msg");

    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      statusMsg.textContent = "Dispatching 6-digit SMS OTP via eu-west-2 gateway...";
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: phoneInput.value, purpose: "signup" })
      });
      const data = await res.json();
      if (!res.ok) {
        statusMsg.style.color = "var(--status-terracotta)";
        statusMsg.textContent = data.error?.message || "Failed to send OTP";
        return;
      }
      verifyBox.style.display = "block";
      otpInput.value = data.demoOtpPreview;
      demoHint.textContent = \`Sandbox Demo OTP: \${data.demoOtpPreview}\`;
      statusMsg.style.color = "var(--status-sage)";
      statusMsg.textContent = \`SMS OTP sent to \${data.phoneNumber}\`;
    });

    verifyBtn?.addEventListener("click", async () => {
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: phoneInput.value,
          otpCode: otpInput.value,
          organizationName: orgInput.value,
          icpSegment: icpSelect.value,
          apiTermsAccepted: termsCheckbox.checked
        })
      });
      const data = await res.json();
      if (!res.ok) {
        statusMsg.style.color = "var(--status-terracotta)";
        statusMsg.textContent = data.error?.message || "OTP verification failed";
        return;
      }
      window.location.href = "/dashboard";
    });
  </script>
</body>
</html>`;
}

function renderDashboardPage(state, webOrigin = `http://localhost:${DEFAULT_WEB_PORT}`) {
  const keyRows = state.apiKeys
    .map(
      (k) => `
      <tr>
        <th scope="row">${k.name}</th>
        <td class="font-mono">${k.keyPrefix}••••••••••••••••</td>
        <td><span class="status-pill ${k.environment === "live" ? "status-sage" : "status-ochre"}">${k.environment}</span></td>
        <td class="font-mono">${k.lastUsedAt || "Never"}</td>
        <td class="font-mono">${k.lastUsedOrigin || "—"}</td>
        <td>
          <button type="button" class="btn btn-sandstone" style="padding: 5px 10px; font-size: 12px;" data-rotate-key="${k.id}">Rotate (24h Grace)</button>
        </td>
      </tr>`
    )
    .join("");

  const jobRows = state.omrJobs
    .map(
      (j) => `
      <tr>
        <th scope="row" class="font-mono">${j.id}</th>
        <td class="font-mono">${j.timestamp}</td>
        <td>${j.scoreCategory}</td>
        <td class="font-mono">${j.inputFormat.toUpperCase()} → ${j.outputFormat.toUpperCase()}</td>
        <td class="font-mono">${j.pages}</td>
        <td class="font-mono">${j.durationMs}ms</td>
        <td>
          <span class="status-pill ${j.errorCode ? "status-terracotta" : "status-sage"}">
            ${j.errorCode ? j.errorCode : j.status}
          </span>
        </td>
        <td>
          <button
            type="button"
            class="btn btn-sandstone"
            style="padding: 5px 10px; font-size: 12px;"
            data-inspect-job="${j.id}"
            data-job-category="${j.scoreCategory}"
            data-job-error="${j.errorCode || ""}"
            data-job-status="${j.status}"
            data-job-latency="${j.durationMs}"
          >Inspect &amp; Play</button>
        </td>
      </tr>`
    )
    .join("");

  const quotaPct = Math.min(100, Math.round((state.organization.pagesUsedThisMonth / state.organization.monthlyPageQuota) * 100));

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>B2B Tenant Dashboard — ${state.organization.name} · Linnet Score</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  ${renderHeader("/dashboard")}

  <main class="container main-section">
    <!-- Workspace Header -->
    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 24px;">
      <div>
        <div style="font-size: 13px; color: var(--text-umber);">Tenant Workspace · RLS Scoped (<code>org_id: ${state.organization.id.slice(0, 12)}...</code>)</div>
        <h1 class="page-title" style="margin: 0;">${state.organization.name}</h1>
      </div>
      <div class="flex-wrap-row">
        <span class="status-pill status-sage">📱 SMS OTP Verified (${state.user.phoneNumber})</span>
        <span class="status-pill status-ochre">Tier: ${state.organization.planTier.toUpperCase()}</span>
      </div>
    </div>

    <!-- 30-Second Quickstart Banner (Deliverable S-07 & Critical DX Metric) -->
    <section class="cashmere-card" style="margin-bottom: 28px; border-left: 4px solid var(--brand-cypress);">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 10px;">
        <div>
          <h2 class="card-title" style="margin: 0;">30-Second Quickstart — Your Active Sandbox cURL</h2>
          <p style="margin: 0; font-size: 13.5px; color: var(--text-umber);">Pre-populated with your provisioned Sandbox token. Run this command to digitize your first score:</p>
        </div>
        <span class="status-pill status-sage">Time to First Integration: 42.0s</span>
      </div>
      <pre class="alabaster-panel font-mono" style="margin: 0; font-size: 12.5px; overflow-x: auto;">${state.quickstartCurl}</pre>
    </section>

    <!-- 4 Cashmere KPI Cards (Deliverable S-03, S-11) -->
    <section class="kpi-grid" style="margin-bottom: 32px;">
      <div class="cashmere-card">
        <div style="font-size: 13px; color: var(--text-umber);">Pages Processed This Month</div>
        <div class="font-mono" style="font-size: 30px; font-weight: 700; margin: 6px 0;">${state.organization.pagesUsedThisMonth} / ${state.organization.monthlyPageQuota}</div>
        <div style="background: var(--border-sandstone); height: 8px; border-radius: 999px; overflow: hidden;">
          <div style="background: var(--accent-moss); width: ${quotaPct}%; height: 100%;"></div>
        </div>
      </div>
      <div class="cashmere-card">
        <div style="font-size: 13px; color: var(--text-umber);">Average OMR Processing Latency</div>
        <div class="font-mono" style="font-size: 30px; font-weight: 700; margin: 6px 0;">1.34s</div>
        <div style="font-size: 12px; color: var(--status-sage);">p95: 1.82s · eu-west-2 Workers</div>
      </div>
      <div class="cashmere-card">
        <div style="font-size: 13px; color: var(--text-umber);">API Gateway Success Rate</div>
        <div class="font-mono" style="font-size: 30px; font-weight: 700; margin: 6px 0;">99.94%</div>
        <div style="font-size: 12px; color: var(--status-sage);">SLA Target: 99.9% (S-11)</div>
      </div>
      <div class="cashmere-card">
        <div style="font-size: 13px; color: var(--text-umber);">Hard Spend Cap &amp; UK Billing</div>
        <div class="font-mono" style="font-size: 30px; font-weight: 700; margin: 6px 0;">£250.00</div>
        <div style="font-size: 12px; color: var(--text-umber);">VAT: ${state.organization.ukVatNumber}</div>
      </div>
    </section>

    <!-- API Keys Vault (/keys — Deliverable S-02) -->
    <section class="cashmere-card" style="margin-bottom: 32px;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 16px;">
        <div>
          <h2 id="keys-heading" class="card-title" style="margin: 0;">API Keys Vault (SHA-256 Hashed · Deliverable S-02)</h2>
          <p style="margin: 0; font-size: 13.5px; color: var(--text-umber);">Raw keys are never stored in PostgreSQL. Rotating a <code>live</code> key requires SMS OTP step-up verification and grants a 24h dual-validity window.</p>
        </div>
        <button type="button" class="btn btn-cypress" id="open-step-up-modal-btn">Verify SMS OTP Step-Up MFA</button>
      </div>
      <div tabindex="0" role="region" aria-labelledby="keys-heading" class="table-wrapper">
        <table class="linnet-table table-keys">
          <thead>
            <tr>
              <th>Key Name</th>
              <th>Key Prefix (SHA-256 Vault)</th>
              <th>Environment</th>
              <th>Last Used</th>
              <th>Origin Header (R-05)</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="api-keys-tbody">
            ${keyRows}
          </tbody>
        </table>
      </div>
    </section>

    <!-- OMR Job Inspector & Request Logs (/logs — Deliverable S-11) -->
    <section class="cashmere-card" style="margin-bottom: 32px;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 16px;">
        <div>
          <h2 id="jobs-heading" class="card-title" style="margin: 0;">OMR Job Inspector &amp; Request Logs (Deliverable S-11)</h2>
          <p style="margin: 0; font-size: 13.5px; color: var(--text-umber);">Inspect per-call telemetry, structured error codes (<code>ERR_LOW_DPI_IMAGE</code>), and test digitized outputs in the embedded Score Viewer.</p>
        </div>
        <span class="status-pill status-sage" id="p1-demand-badge">P1 Score Editing Requests (S-14): ${state.p1EditingRequests}</span>
      </div>
      <div tabindex="0" role="region" aria-labelledby="jobs-heading" class="table-wrapper">
        <table class="linnet-table table-jobs">
          <thead>
            <tr>
              <th>Job ID</th>
              <th>Timestamp</th>
              <th>Score Category</th>
              <th>Format</th>
              <th>Pages</th>
              <th>Latency</th>
              <th>HTTP Status / Diagnostic</th>
              <th>Inspector</th>
            </tr>
          </thead>
          <tbody>
            ${jobRows}
          </tbody>
        </table>
      </div>
    </section>

    <!-- No-Code Music School & Educator Studio (For Music Students) -->
    <section id="educator-studio" class="cashmere-card" style="margin-bottom: 32px; border-left: 4px solid var(--accent-moss);">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 14px;">
        <div>
          <span class="status-pill status-sage" style="margin-bottom: 6px;">🎓 For Music Schools, Conservatoires &amp; Teachers</span>
          <h2 class="card-title" style="margin: 0;">No-Code Educator Studio — Share Interactive Scores with Music Students</h2>
          <p style="margin: 0; font-size: 13.5px; color: var(--text-umber);">
            Generate a ready-to-share <strong>Student Practice Link</strong> or paste an <code>&lt;iframe&gt;</code> embed into Canvas, Moodle, Google Classroom, or your school website so students can hear the melody and practice with tempo/loop controls.
          </p>
        </div>
        <a href="/practice/job_01j8x9k2m4p7q" class="btn btn-cypress">Open Live Student Practice Room →</a>
      </div>

      <div class="split-grid split-grid--even">
        <div class="alabaster-panel">
          <div style="font-size: 12px; font-weight: 600; color: var(--text-umber); margin-bottom: 6px;">SHAREABLE STUDENT PRACTICE LINK (MOBILE &amp; DESKTOP)</div>
          <div class="font-mono" style="font-size: 13px; color: var(--brand-cypress); word-break: break-all;">${webOrigin}/practice/job_01j8x9k2m4p7q?preset=solo_piano</div>
        </div>
        <div class="alabaster-panel">
          <div style="font-size: 12px; font-weight: 600; color: var(--text-umber); margin-bottom: 6px;">NO-CODE SCHOOL PORTAL / LMS EMBED SNIPPET</div>
          <code class="font-mono" style="font-size: 12px;">&lt;iframe src="${webOrigin}/practice/job_01j8x9k2m4p7q" width="100%" height="380" frameborder="0"&gt;&lt;/iframe&gt;</code>
        </div>
      </div>
    </section>

    <!-- Webhooks & SDK CORS Allowed Origins (/webhooks & /billing — Mitigating Risk R-05 & Deliverable S-09) -->
    <section class="split-grid split-grid--even">
      <div class="cashmere-card">
        <h3 class="card-title" style="margin-bottom: 8px;">SDK Allowed Origins (CORS Anti-Resale Lock · R-05)</h3>
        <p style="font-size: 13.5px; color: var(--text-umber);">Only these whitelisted domains can render <code>&lt;linnet-score-player&gt;</code> with your publishable token:</p>
        <ul class="font-mono" style="font-size: 13px; padding-left: 18px;">
          ${state.organization.allowedOrigins.map((o) => `<li>${o}</li>`).join("")}
        </ul>
        <div style="font-size: 12.5px; color: var(--text-umber); margin-top: 12px;">
          Webhook Signing Secret: <code class="font-mono">whsec_4a9c•••••••••••••••• (HMAC-SHA256)</code>
        </div>
      </div>

      <div class="cashmere-card">
        <h3 class="card-title" style="margin-bottom: 8px;">Usage &amp; UK Stripe Billing (Deliverable S-09 · D-05)</h3>
        <p style="font-size: 13.5px; color: var(--text-umber);">Hybrid subscription + metered overage engine synced via Stripe Billing Metered Events API.</p>
        <div class="alabaster-panel" style="font-size: 13px; margin-bottom: 12px;">
          <div><strong>Active Pricing Metric (D-05):</strong> <code>${state.organization.pricingMetric}</code> (Tracks both pages &amp; jobs)</div>
          <div><strong>UK VAT ID (R-07):</strong> <code>${state.organization.ukVatNumber}</code></div>
          <div><strong>24h GDPR Storage Bucket (D-07):</strong> <code>linnet-score-ephemeral-eu-west-2</code></div>
        </div>
      </div>
    </section>
  </main>

  <!-- Native <dialog closedby="any"> Modal 1: SMS OTP Step-Up & One-Time Key Rotation Modal -->
  <dialog id="step-up-dialog" class="linnet-dialog" closedby="any" aria-labelledby="step-up-dialog-title" data-user-phone="${state.user.phoneNumber}">
    <h2 id="step-up-dialog-title" class="card-title" style="margin-bottom: 8px;">Step-Up SMS OTP Verification &amp; Key Rotation</h2>
    <p style="font-size: 13.5px; color: var(--text-umber); margin-bottom: 16px;">
      Rotating a production <code>lnt_live_</code> API key requires step-up verification via SMS OTP. The newly generated raw key will be shown <strong>only once</strong> below.
    </p>
    <div class="dialog-otp-row">
      <button type="button" class="btn btn-sandstone" id="dialog-send-otp-btn">1. Send SMS OTP to ${state.user.phoneNumber}</button>
      <input type="text" id="dialog-otp-input" placeholder="6-digit OTP" class="font-mono" style="padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border-sandstone); width: 140px;" />
      <button type="button" class="btn btn-cypress" id="dialog-verify-rotate-btn">2. Verify &amp; Rotate Key</button>
    </div>
    <div id="dialog-otp-status" aria-live="polite" style="font-size: 12.5px; margin-bottom: 10px;"></div>
    <pre id="rotated-key-output" class="alabaster-panel font-mono" style="display: none; font-size: 12.5px; color: var(--status-sage);"></pre>
    <form method="dialog" style="margin-top: 16px; text-align: right;">
      <button type="submit" class="btn btn-sandstone">Close</button>
    </form>
  </dialog>

  <!-- Native <dialog closedby="any"> Modal 2: OMR Job Inspector with Embedded <linnet-score-player> -->
  <dialog id="job-inspector-dialog" class="linnet-dialog" closedby="any" aria-labelledby="inspector-dialog-title" style="max-width: 780px;">
    <h2 id="inspector-dialog-title" class="card-title" style="margin-bottom: 6px;">OMR Job Inspector &amp; Score Player Preview</h2>
    <p id="inspector-job-meta" class="font-mono" style="font-size: 12px; color: var(--text-umber); margin-bottom: 14px;"></p>
    <div id="inspector-error-box" class="alabaster-panel" hidden style="border-left: 4px solid var(--status-terracotta); color: var(--status-terracotta); font-size: 13.5px; margin-bottom: 12px;"></div>
    <linnet-score-player id="inspector-player" preset="solo_piano" enable-feedback="true"></linnet-score-player>
    <form method="dialog" style="margin-top: 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
      <span id="inspector-feedback-status" style="font-size: 12.5px; color: var(--status-sage);"></span>
      <button type="submit" class="btn btn-sandstone">Close Inspector</button>
    </form>
  </dialog>

  <script type="module">
    import { defineLinnetScorePlayer } from "/sdk/index.mjs";
    defineLinnetScorePlayer();

    // Mandatory Safari / legacy fallback for <dialog closedby="any"> (Modern Web Guidance: light-dismiss-a-dialog)
    document.querySelectorAll("dialog.linnet-dialog").forEach((dialog) => {
      if (!("closedBy" in HTMLDialogElement.prototype)) {
        dialog.addEventListener("click", (event) => {
          if (event.target !== dialog) return;
          const rect = dialog.getBoundingClientRect();
          const isDialogContent =
            rect.top <= event.clientY &&
            event.clientY <= rect.top + rect.height &&
            rect.left <= event.clientX &&
            event.clientX <= rect.left + rect.width;
          if (isDialogContent) return;
          dialog.close();
        });
      }
    });

    const stepUpDialog = document.getElementById("step-up-dialog");
    const inspectorDialog = document.getElementById("job-inspector-dialog");
    const inspectorPlayer = document.getElementById("inspector-player");
    const inspectorErrorBox = document.getElementById("inspector-error-box");
    const otpInput = document.getElementById("dialog-otp-input");
    const otpStatus = document.getElementById("dialog-otp-status");
    const rotatedOutput = document.getElementById("rotated-key-output");
    const keysTbody = document.getElementById("api-keys-tbody");
    const userPhone = stepUpDialog?.dataset.userPhone || "+447700900077";

    document.getElementById("open-step-up-modal-btn")?.addEventListener("click", () => {
      stepUpDialog.showModal();
    });

    document.querySelectorAll("[data-rotate-key]").forEach((btn) => {
      btn.addEventListener("click", () => {
        stepUpDialog.showModal();
      });
    });

    document.getElementById("dialog-send-otp-btn")?.addEventListener("click", async () => {
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: userPhone, purpose: "step_up_key_rotation" })
      });
      const data = await res.json();
      if (!res.ok) {
        if (otpStatus) {
          otpStatus.style.color = "var(--status-terracotta)";
          otpStatus.textContent = data.error?.message || "Failed to dispatch OTP";
        }
        return;
      }
      if (data.demoOtpPreview) {
        otpInput.value = data.demoOtpPreview;
        if (otpStatus) {
          otpStatus.style.color = "var(--status-sage)";
          otpStatus.textContent = \`Demo OTP sent to \${data.phoneNumber}: \${data.demoOtpPreview}\`;
        }
      }
    });

    document.getElementById("dialog-verify-rotate-btn")?.addEventListener("click", async () => {
      const verifyRes = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: userPhone, otpCode: otpInput.value })
      });
      if (!verifyRes.ok) {
        const verifyErr = await verifyRes.json();
        rotatedOutput.style.display = "block";
        rotatedOutput.style.color = "var(--status-terracotta)";
        rotatedOutput.textContent = \`OTP Error: \${verifyErr.error?.message || "Invalid OTP"}\`;
        return;
      }
      const rotRes = await fetch("/api/keys/rotate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const rotData = await rotRes.json();
      rotatedOutput.style.display = "block";
      if (rotRes.ok) {
        rotatedOutput.style.color = "var(--status-sage)";
        rotatedOutput.textContent = \`NEW LIVE KEY (Copy now — shown once):\\n\${rotData.oneTimeRawKey}\\nOld key valid until: \${rotData.graceExpiresAt}\`;
        if (keysTbody && rotData.newKeyRecord) {
          const row = document.createElement("tr");
          row.innerHTML = \`
            <th scope="row">\${rotData.newKeyRecord.name}</th>
            <td class="font-mono">\${rotData.newKeyRecord.keyPrefix}••••••••••••••••</td>
            <td><span class="status-pill status-sage">\${rotData.newKeyRecord.environment}</span></td>
            <td class="font-mono">Just now</td>
            <td class="font-mono">—</td>
            <td><span class="status-pill status-sage">Active</span></td>
          \`;
          keysTbody.prepend(row);
        }
      } else {
        rotatedOutput.style.color = "var(--status-terracotta)";
        rotatedOutput.textContent = \`Error: \${rotData.error?.message}\`;
      }
    });

    document.querySelectorAll("[data-inspect-job]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const jobId = btn.getAttribute("data-inspect-job");
        const category = btn.getAttribute("data-job-category") || "solo_piano";
        const errorCode = btn.getAttribute("data-job-error") || "";
        const latency = btn.getAttribute("data-job-latency") || "0";

        document.getElementById("inspector-job-meta").textContent = \`Job ID: \${jobId} · Category: \${category} · \${latency}ms · eu-west-2 (24h GDPR Ephemeral)\`;

        if (errorCode) {
          if (inspectorPlayer) inspectorPlayer.hidden = true;
          if (inspectorErrorBox) {
            inspectorErrorBox.hidden = false;
            inspectorErrorBox.textContent = \`\${errorCode}: Input scan did not meet the 150 DPI minimum threshold required for reliable OMR extraction. Re-scan at >= 150 DPI and resubmit.\`;
          }
        } else {
          if (inspectorErrorBox) inspectorErrorBox.hidden = true;
          if (inspectorPlayer) {
            inspectorPlayer.hidden = false;
            const validPreset = ["solo_piano", "choral_satb", "lead_sheet"].includes(category) ? category : "solo_piano";
            inspectorPlayer.setAttribute("preset", validPreset);
          }
        }

        inspectorDialog.showModal();
      });
    });

    // Listen for Charter S-14 / R-03 P1 Score Editing demand signal from <linnet-score-player>
    document.addEventListener("linnet:feedback", async () => {
      const res = await fetch("/api/telemetry/p1-editing-demand", { method: "POST" });
      const data = await res.json();
      document.getElementById("inspector-feedback-status").textContent = data.message;
      document.getElementById("p1-demand-badge").textContent = \`P1 Score Editing Requests (S-14): \${data.totalSignals}\`;
    });
  </script>
</body>
</html>`;
}

function renderStudentPracticePage(state, jobId, presetKey) {
  const validPreset = BENCHMARK_SCORES[presetKey] ? presetKey : "solo_piano";
  const preset = BENCHMARK_SCORES[validPreset];
  const initialScoreModel = parseMusicXML(preset.musicXML);
  const ssrSvg = renderScoreToSVG(initialScoreModel);

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Student Practice Room — ${preset.label} · Linnet Score</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  ${renderHeader("/practice")}

  <main class="container main-section">
    <div class="cashmere-card" style="margin-bottom: 24px;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 18px;">
        <div>
          <span class="status-pill status-sage" style="margin-bottom: 6px;">🎓 Student Practice Companion · Assigned by ${state.organization.name}</span>
          <h1 class="page-title" style="margin: 0;">${preset.label}</h1>
          <p style="margin: 4px 0 0; font-size: 14px; color: var(--text-umber);">
            Press <strong>▶ Play Score</strong> to hear how your piece should sound, drag the <strong>Tempo slider</strong> to practice slowly, or turn on <strong>↻ Loop</strong> to repeat measures between lessons.
          </p>
        </div>
        <div class="flex-wrap-row">
          <a href="/practice/${jobId}?preset=solo_piano" class="btn ${validPreset === "solo_piano" ? "btn-cypress" : "btn-sandstone"}" style="font-size: 12.5px; padding: 7px 12px;">🎹 Solo Piano</a>
          <a href="/practice/${jobId}?preset=choral_satb" class="btn ${validPreset === "choral_satb" ? "btn-cypress" : "btn-sandstone"}" style="font-size: 12.5px; padding: 7px 12px;">🎶 Choral SATB</a>
          <a href="/practice/${jobId}?preset=lead_sheet" class="btn ${validPreset === "lead_sheet" ? "btn-cypress" : "btn-sandstone"}" style="font-size: 12.5px; padding: 7px 12px;">🎷 Jazz Lead Sheet</a>
        </div>
      </div>

      <linnet-score-player id="student-player" preset="${validPreset}" loop="true">
        <div class="alabaster-panel">${ssrSvg}</div>
      </linnet-score-player>
    </div>

    <div class="alabaster-panel flex-wrap-row" style="justify-content: space-between;">
      <div>
        <strong>Want to scan your own paper sheet music books at home?</strong>
        <span style="color: var(--text-umber); font-size: 14px; margin-left: 6px;">Get the <strong>Linnet Mobile App</strong> (powered by NoteAva) for iOS &amp; Android.</span>
      </div>
      <a href="/#linnet-app" class="btn btn-cypress" style="font-size: 13px; padding: 8px 14px;">📱 Get the Linnet Mobile App →</a>
    </div>
  </main>

  <script type="module">
    import { defineLinnetScorePlayer } from "/sdk/index.mjs";
    defineLinnetScorePlayer();
  </script>
</body>
</html>`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || DEFAULT_WEB_PORT);
  const host = process.env.HOST || "0.0.0.0";
  const server = createWebAppServer({ port });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[Linnet Score Web Control Plane] Port ${port} is already in use. Try: PORT=${port + 1} npm run start:web`);
      process.exit(1);
    }
    throw err;
  });
  server.listen(port, host, () => {
    const displayHost = host === "0.0.0.0" ? "localhost" : host;
    console.log(`[Linnet Score Web Control Plane] Running on http://${displayHost}:${port}`);
  });
}
