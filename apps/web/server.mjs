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
          newKeyRecord: {
            id: rotated.replacementKey.id,
            name: rotated.replacementKey.name,
            keyPrefix: rotated.replacementKey.keyPrefix,
            environment: rotated.replacementKey.environment
          },
          oneTimeRawKey: rotated.replacementKey.rawKey
        });
      } catch (err) {
        sendJson(res, 403, { error: { code: err.code || "ERR_STEP_UP_REQUIRED", message: err.message } });
      }
      return;
    }

    // API: Record Score Editing Beta Request
    if (req.method === "POST" && url.pathname === "/api/telemetry/p1-editing-demand") {
      state.p1EditingRequests += 1;
      state.organization.requestedEditingSdkAt = new Date().toISOString();
      sendJson(res, 200, {
        recorded: true,
        totalSignals: state.p1EditingRequests,
        message: "Added to the Score Editing SDK early-access list."
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
      sendHtml(res, renderStudentPracticePage(state, jobId, preset, reqOrigin));
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

const ICONS = {
  brandMark: `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
  menu: `<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`,
  piano: `<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="9" y1="4" x2="9" y2="13"/><line x1="15" y1="4" x2="15" y2="13"/><line x1="12" y1="13" x2="12" y2="20"/></svg>`,
  choir: `<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l10-2v11"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="14" r="3"/></svg>`,
  jazz: `<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><circle cx="9" cy="18" r="3"/><path d="M12 7c4 0 6 2.5 6 6"/></svg>`,
  upload: `<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  copy: `<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  check: `<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  key: `<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></svg>`,
  github: `<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.7.5.09.68-.22.68-.49 0-.24-.01-1.05-.01-1.91-2.78.62-3.37-1.21-3.37-1.21-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.62.07-.62 1 .07 1.53 1.05 1.53 1.05.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.36-2.22-.26-4.55-1.14-4.55-5.08 0-1.12.39-2.04 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.27 2.75 1.05A9.38 9.38 0 0 1 12 6.8c.85 0 1.71.12 2.51.34 1.91-1.32 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.71 1.03 1.63 1.03 2.75 0 3.95-2.34 4.82-4.57 5.07.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.59.69.49A10.22 10.22 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z"/></svg>`,
  building: `<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="9" y1="7" x2="10" y2="7"/><line x1="14" y1="7" x2="15" y2="7"/><line x1="9" y1="12" x2="10" y2="12"/><line x1="14" y1="12" x2="15" y2="12"/><path d="M10 22v-5h4v5"/></svg>`,
  phone: `<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>`,
  school: `<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>`
};

function renderCopyControl(targetId, ariaLabel) {
  return `<span class="copy-control">
    <button type="button" class="copy-button" command="--copy" commandfor="${targetId}" aria-label="${ariaLabel}">
      <span class="icon-copy">${ICONS.copy}</span>
      <span class="icon-check">${ICONS.check}</span>
    </button>
    <span class="copy-tip" role="status"></span>
  </span>`;
}

function renderHeader(activePath) {
  return `
  <header class="site-header" id="site-header">
    <div class="container nav-inner" id="nav-inner">
      <a href="/" class="brand-logo">
        <span class="brand-mark">${ICONS.brandMark}</span>
        <span>Linnet Score</span>
      </a>
      <nav class="site-nav" aria-label="Primary Navigation">
        <button
          id="menu-button"
          class="menu-button"
          type="button"
          popovertarget="site-menu"
          popovertargetaction="toggle"
          aria-controls="site-menu"
          aria-expanded="false"
          aria-label="Open navigation menu"
        >
          <span class="menu-icon" aria-hidden="true">
            <span class="menu-bar menu-bar--top"></span>
            <span class="menu-bar menu-bar--bottom"></span>
          </span>
        </button>
        <ul id="site-menu" class="site-menu" popover="auto">
          <li><a href="/#playground" class="nav-link">Playground</a></li>
          <li><a href="/#benchmarks" class="nav-link">Benchmarks</a></li>
          <li><a href="/#schools" class="nav-link">Educators</a></li>
          <li><a href="/#pricing" class="nav-link">Pricing</a></li>
          <li><a href="/auth" class="nav-link" ${activePath === "/auth" ? 'aria-current="page"' : ""}>Sign In</a></li>
          <li><a href="/dashboard" class="btn btn-cypress" ${activePath === "/dashboard" ? 'aria-current="page"' : ""}>Dashboard</a></li>
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
    const menuButton = document.getElementById("menu-button");
    let lastHeaderWidth = 0;

    function isMenuPopoverOpen() {
      if (!menu) return false;
      try {
        return menu.matches(":popover-open");
      } catch {
        return menu.classList.contains(":popover-open");
      }
    }

    function syncMenuButtonState() {
      if (!menuButton || !header) return;
      const expanded = !header.classList.contains("is-wide") && isMenuPopoverOpen();
      menuButton.setAttribute("aria-expanded", String(expanded));
      menuButton.setAttribute("aria-label", expanded ? "Close navigation menu" : "Open navigation menu");
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
      syncMenuButtonState();
      requestAnimationFrame(() => header.classList.remove("is-measuring"));
    }

    if (header && inner && menu) {
      syncNavLayout();
      menu.addEventListener("toggle", syncMenuButtonState);
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

    // Shared Invoker Commands copy-button handler (single path: native CommandEvent or fallback)
    let lastCopyMessage = "";
    const copyTimers = new WeakMap();

    function legacyCopy(text) {
      const field = Object.assign(document.createElement("textarea"), { value: text });
      field.setAttribute("readonly", "");
      field.style.cssText = "position:fixed;inset-block-start:0;opacity:0";
      document.body.append(field);
      field.select();
      try {
        return document.execCommand("copy");
      } finally {
        field.remove();
      }
    }

    function reportCopy(button, ok) {
      const tip = button.nextElementSibling;
      if (!tip) return;
      clearTimeout(copyTimers.get(button));
      button.removeAttribute("data-copied");
      button.removeAttribute("data-failed");
      let message = ok ? "Copied" : "Copy failed";
      if (message === lastCopyMessage) message += "\u00A0";
      lastCopyMessage = message;
      tip.textContent = "";
      void button.offsetWidth;
      button.setAttribute(ok ? "data-copied" : "data-failed", "");
      requestAnimationFrame(() => {
        tip.textContent = message;
      });
      copyTimers.set(
        button,
        setTimeout(() => {
          button.removeAttribute("data-copied");
          button.removeAttribute("data-failed");
          tip.textContent = "";
        }, 2000)
      );
    }

    async function copyFromTarget(button, target) {
      const text = target.matches("input, textarea") ? target.value : target.innerText.trim();
      if (!text) return;
      try {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          if (!legacyCopy(text)) throw new Error("Copy failed");
        }
        reportCopy(button, true);
      } catch {
        reportCopy(button, false);
      }
    }

    if ("CommandEvent" in window) {
      document.addEventListener(
        "command",
        (event) => {
          if (event.command === "--copy" && event.source && event.target) {
            copyFromTarget(event.source, event.target);
          }
        },
        true
      );
    } else {
      document.addEventListener("click", (event) => {
        const button = event.target.closest?.('button[command="--copy"]');
        if (!button) return;
        const target = document.getElementById(button.getAttribute("commandfor"));
        if (target) copyFromTarget(button, target);
      });
    }

    // Shared top-layer dialog exit fallback (animate-to-from-top-layer)
    let supportsDisplayTransition;
    function canTransitionDisplay() {
      if (supportsDisplayTransition !== undefined) return supportsDisplayTransition;
      if (!window.CSS?.supports?.("transition-behavior", "allow-discrete") || !document.body) {
        return false;
      }
      const probe = document.createElement("div");
      probe.style.cssText = "transition: display 1s allow-discrete !important; display: block;";
      document.body.appendChild(probe);
      getComputedStyle(probe).display;
      probe.style.display = "none";
      supportsDisplayTransition = getComputedStyle(probe).display === "block";
      probe.remove();
      return supportsDisplayTransition;
    }

    window.linnetCloseDialog = async function closeTopLayer(dialog) {
      if (!dialog || !dialog.open) return;
      const supportsNativeTopLayer = Boolean(window.CSS?.supports?.("overlay", "auto") && canTransitionDisplay());
      if (!supportsNativeTopLayer) {
        dialog.setAttribute("data-closing", "");
        const animations = dialog.getAnimations({ subtree: true });
        if (animations.length > 0) {
          await Promise.race([
            Promise.allSettled(animations.map((a) => a.finished)),
            new Promise((r) => setTimeout(r, 400))
          ]);
        }
        if (!dialog.hasAttribute("data-closing")) return;
        dialog.removeAttribute("data-closing");
      }
      dialog.close();
    };
  </script>`;
}

function renderFooter() {
  return `
  <footer class="site-footer">
    <div class="container">
      <div class="footer-grid">
        <div class="footer-brand-block">
          <div class="footer-monogram" aria-hidden="true">${ICONS.brandMark}</div>
          <div>
            <div class="footer-brand-title">Linnet Score</div>
            <p class="footer-brand-copy">Optical Music Recognition REST API &amp; Web Component SDK engineered for the UK and EU market.</p>
          </div>
        </div>

        <div>
          <h3 class="footer-col-title">Platform</h3>
          <ul class="footer-col-list">
            <li><a href="/#playground">Live OMR Playground</a></li>
            <li><a href="/#schools">API &amp; Educator Studio</a></li>
            <li><a href="/#benchmarks">OMR Benchmarks</a></li>
            <li><a href="/#linnet-app">Linnet Mobile App</a></li>
          </ul>
        </div>

        <div>
          <h3 class="footer-col-title">Developers</h3>
          <ul class="footer-col-list">
            <li><a href="/#pricing">UK GBP Pricing</a></li>
            <li><a href="/auth">Get Free Sandbox Key</a></li>
            <li><a href="/dashboard">Tenant Dashboard</a></li>
            <li><a href="/practice/job_01j8x9k2m4p7q">Student Practice Room</a></li>
          </ul>
        </div>
      </div>

      <div class="footer-bottom">
        <span>© 2026 Linnet Score · Built on NoteAva OMR</span>
        <span>UK GDPR Ready · Client-Side Web Audio Synthesis</span>
      </div>
    </div>
  </footer>`;
}

function renderMarketingLandingPage(webOrigin = `http://localhost:${DEFAULT_WEB_PORT}`) {
  const initialScoreModel = parseMusicXML(BENCHMARK_SCORES.solo_piano.musicXML);
  const ssrSvg = renderScoreToSVG(initialScoreModel);

  const benchmarkRows = OMR_BENCHMARK_BASELINES.map(
    (b) => `
    <tr>
      <th scope="row">${b.title}</th>
      <td><span class="status-pill status-sage">Supported</span></td>
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
    <!-- Editorial Hero Stage with Flanking Tilted Visual Cards & Blur-to-Sharp Entrance -->
    <section class="hero-stage">
      <div class="hero-grid">
        <aside class="hero-float-card hero-float-card--left" aria-hidden="true">
          <div class="hero-float-face">
            <div class="hero-card-kicker">Chopin · Op. 9 No. 2</div>
            <svg viewBox="0 0 180 56" width="100%" height="56" style="display: block;">
              <line x1="6" y1="12" x2="174" y2="12" stroke="#1C1917" stroke-opacity="0.35" stroke-width="1" />
              <line x1="6" y1="20" x2="174" y2="20" stroke="#1C1917" stroke-opacity="0.35" stroke-width="1" />
              <line x1="6" y1="28" x2="174" y2="28" stroke="#1C1917" stroke-opacity="0.35" stroke-width="1" />
              <line x1="6" y1="36" x2="174" y2="36" stroke="#1C1917" stroke-opacity="0.35" stroke-width="1" />
              <line x1="6" y1="44" x2="174" y2="44" stroke="#1C1917" stroke-opacity="0.35" stroke-width="1" />
              <ellipse cx="34" cy="36" rx="4.8" ry="3.5" transform="rotate(-18 34 36)" fill="#1C1917" />
              <line x1="38.5" y1="36" x2="38.5" y2="15" stroke="#1C1917" stroke-width="1.3" />
              <ellipse cx="70" cy="24" rx="4.8" ry="3.5" transform="rotate(-18 70 24)" fill="#1B3B2B" />
              <line x1="74.5" y1="24" x2="74.5" y2="6" stroke="#1B3B2B" stroke-width="1.3" />
              <ellipse cx="106" cy="28" rx="4.8" ry="3.5" transform="rotate(-18 106 28)" fill="#1C1917" />
              <line x1="110.5" y1="28" x2="110.5" y2="8" stroke="#1C1917" stroke-width="1.3" />
              <ellipse cx="144" cy="32" rx="4.8" ry="3.5" transform="rotate(-18 144 32)" fill="#1C1917" />
              <line x1="148.5" y1="32" x2="148.5" y2="12" stroke="#1C1917" stroke-width="1.3" />
            </svg>
            <div class="hero-card-stat">99.4% Pitch Fidelity</div>
          </div>
        </aside>

        <div class="hero-center">
          <div class="hero-emblem hero-blur-in" style="--reveal-delay: 0ms;" aria-hidden="true">${ICONS.brandMark}</div>

          <h1 class="hero-title hero-blur-in" style="--reveal-delay: 60ms;">Sheet Music Intelligence, Engineered for Developers.</h1>
          <p class="hero-lead hero-blur-in" style="--reveal-delay: 120ms;">
            Powered by the optical music recognition engine behind <strong>Linnet</strong>. Embed our OMR REST API &amp; <code>&lt;linnet-score-player&gt;</code> SDK, share interactive practice links with students, or capture printed scores on mobile.
          </p>

          <div class="hero-actions hero-blur-in" style="--reveal-delay: 170ms;">
            <a href="/auth" class="btn btn-cypress">Get Free Sandbox Key</a>
            <a href="/practice/job_01j8x9k2m4p7q" class="btn btn-sandstone">Try Student Practice Room</a>
          </div>
          <a href="#linnet-app" class="hero-sublink hero-blur-in" style="--reveal-delay: 210ms;">Individual musician? Explore the Linnet mobile companion →</a>
        </div>

        <aside class="hero-float-card hero-float-card--right hero-float-card--dark" aria-hidden="true">
          <div class="hero-float-face">
            <div class="hero-card-kicker">POST /v1/omr/jobs</div>
            <pre class="hero-card-code">&lt;note&gt;
  &lt;pitch&gt;
    &lt;step&gt;E&lt;/step&gt;
    &lt;alter&gt;-1&lt;/alter&gt;
    &lt;octave&gt;5&lt;/octave&gt;
  &lt;/pitch&gt;
&lt;/note&gt;</pre>
            <div class="hero-card-stat">1.34s · MusicXML 4.0</div>
          </div>
        </aside>
      </div>
    </section>

    <!-- Interactive Live OMR Playground -->
    <section id="playground" class="cashmere-card" style="margin-bottom: 56px;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 16px;">
        <div>
          <h2 class="section-title blur-heading" style="margin-bottom: 4px;">Interactive Live OMR Playground</h2>
          <p style="margin: 0; color: var(--text-umber); font-size: 14px;">Upload a sheet music PDF or image, or pick a benchmark score to inspect the SVG engraving and audition playback.</p>
        </div>
        <span id="playground-telemetry" class="status-pill status-sage" aria-live="polite">200 OK · 1.38s · 99.2% Confidence · eu-west-2</span>
      </div>

      <div class="scan-steps" aria-label="OMR pipeline stages">
        <span class="scan-step is-active" data-scan-step="1">1. DPI &amp; Format Check</span>
        <span class="scan-step" data-scan-step="2">2. Staff &amp; Note OMR</span>
        <span class="scan-step" data-scan-step="3">3. MusicXML 4.0 Ready</span>
      </div>

      <div class="split-grid">
        <!-- Left Pane: Score Selection & Upload -->
        <div class="alabaster-panel" style="display: flex; flex-direction: column; justify-content: space-between; gap: 16px;">
          <div>
            <div style="font-weight: 600; font-size: 13px; color: var(--text-umber); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 10px;">1. Select Benchmark Score</div>
            <div style="display: flex; flex-direction: column; gap: 8px;">
              <button type="button" class="btn btn-cypress preset-btn" data-preset-btn="solo_piano">
                <span class="preset-btn-title">${ICONS.piano}<span>Solo Piano — Chopin Op. 9 No. 2</span></span>
                <span class="preset-btn-meta">Grand staff · 3/4 time · 99.4% note fidelity</span>
              </button>
              <button type="button" class="btn btn-sandstone preset-btn" data-preset-btn="choral_satb">
                <span class="preset-btn-title">${ICONS.choir}<span>Choral SATB — J.S. Bach BWV 244</span></span>
                <span class="preset-btn-meta">4-voice polyphony · 4/4 time · 98.7% pitch accuracy</span>
              </button>
              <button type="button" class="btn btn-sandstone preset-btn" data-preset-btn="lead_sheet">
                <span class="preset-btn-title">${ICONS.jazz}<span>Lead Sheet — Autumn Jazz Standard</span></span>
                <span class="preset-btn-meta">Treble &amp; chord symbols · 4/4 time · 99.1% fidelity</span>
              </button>
            </div>
          </div>

          <div id="playground-dropzone" class="dropzone">
            <div style="display: inline-flex; align-items: center; justify-content: center; gap: 6px; font-weight: 600; font-size: 13.5px; margin-bottom: 4px;">
              ${ICONS.upload}
              <span>Drop PDF, PNG, or JPG Score</span>
            </div>
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
              <div class="score-stage" id="playground-stage">
                <div id="playground-scan-overlay" class="scan-overlay" aria-hidden="true">
                  <div class="scan-beam"></div>
                </div>
                <linnet-score-player id="playground-player" preset="solo_piano" tempo="104" loop="false">
                  <div class="alabaster-panel">${ssrSvg}</div>
                </linnet-score-player>
              </div>
              <div class="player-hint">Tip: Click any notehead on the staff to audition its pitch and move the playback cursor.</div>
            </div>

            <div id="tab-panel-musicxml" role="tabpanel" aria-labelledby="tab-musicxml" hidden="until-found">
              <div class="copyable-code">
                <pre id="tab-musicxml-code" class="alabaster-panel font-mono" style="margin: 0; font-size: 12px; max-height: 310px; overflow: auto; padding-right: 48px;"></pre>
                ${renderCopyControl("tab-musicxml-code", "Copy MusicXML source")}
              </div>
            </div>

            <div id="tab-panel-json" role="tabpanel" aria-labelledby="tab-json" hidden="until-found">
              <div class="copyable-code">
                <pre id="tab-json-code" class="alabaster-panel font-mono" style="margin: 0; font-size: 12px; max-height: 310px; overflow: auto; padding-right: 48px;"></pre>
                ${renderCopyControl("tab-json-code", "Copy API telemetry JSON")}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Segmented Pill-Tab Workflow Showcase Deck -->
    <section id="schools" class="showcase-section reveal-section">
      <div class="showcase-header">
        <div class="eyebrow"><span class="eyebrow-dot" aria-hidden="true"></span>Workflows &amp; SDK Architecture</div>
        <h2 class="section-title blur-heading" style="margin-bottom: 10px;">Built for Developers, Music Schools &amp; Publishers.</h2>
        <p style="margin: 0; color: var(--text-umber); font-size: 15px;">Explore each integration surface—from zero-dependency Web Component playback to no-code student practice links.</p>

        <div class="showcase-pills" role="group" aria-label="Filter platform workflow cards">
          <button type="button" class="showcase-pill" data-showcase-pill="all" aria-pressed="true">All</button>
          <button type="button" class="showcase-pill" data-showcase-pill="api" aria-pressed="false">API &amp; SDK</button>
          <button type="button" class="showcase-pill" data-showcase-pill="schools" aria-pressed="false">Music Schools</button>
          <button type="button" class="showcase-pill" data-showcase-pill="playback" aria-pressed="false">Client Playback</button>
          <button type="button" class="showcase-pill" data-showcase-pill="security" aria-pressed="false">UK Security</button>
        </div>
      </div>

      <div class="showcase-deck" tabindex="0" role="region" aria-label="Linnet Score platform workflow cards">
        <article class="showcase-card" data-showcase-card="api">
          <div class="showcase-card-surface">
            <div>
              <span class="status-pill status-sage" style="margin-bottom: 10px;">For App Developers</span>
              <h3 class="card-title" style="margin-bottom: 8px;">1. Digitize via API &amp; Embed <code>&lt;linnet-score-player&gt;</code></h3>
              <p style="font-size: 14px; color: var(--text-umber);">Send a sheet music PDF or photo to our London <code>eu-west-2</code> gateway and render interactive notation in a few lines of code:</p>
            </div>
            <div class="copyable-code">
              <pre id="landing-curl-snippet" class="alabaster-panel font-mono" style="margin: 0; font-size: 12px; overflow-x: auto; padding-right: 48px;">curl -X POST https://api.linnet.dev/v1/omr/jobs \\
  -H "Authorization: Bearer lnt_live_8f9a..." \\
  -F "file=@./chopin-nocturne.pdf"

&lt;linnet-score-player job-id="job_01j8x9k2m4p7q" tempo="112" loop="true"&gt;&lt;/linnet-score-player&gt;</pre>
              ${renderCopyControl("landing-curl-snippet", "Copy cURL and Web Component snippet")}
            </div>
          </div>
        </article>

        <article class="showcase-card" data-showcase-card="schools">
          <div class="showcase-card-surface">
            <div>
              <span class="status-pill status-ochre" style="margin-bottom: 10px;">For Conservatoires &amp; Teachers</span>
              <h3 class="card-title" style="margin-bottom: 8px;">2. No-Code Student Practice Links &amp; LMS Embeds</h3>
              <p style="font-size: 14px; color: var(--text-umber);">
                No engineering team required. Upload any sheet music PDF in the <strong>Educator Studio</strong> to give students a shareable practice link with tempo and loop controls:
              </p>
            </div>
            <div class="alabaster-panel" style="display: flex; flex-direction: column; gap: 10px;">
              <div class="copyable-wrap">
                <div id="landing-practice-url" class="font-mono" style="font-size: 12px; color: var(--brand-cypress); word-break: break-all;">${webOrigin}/practice/job_01j8x9k2m4p7q</div>
                ${renderCopyControl("landing-practice-url", "Copy Student Practice Room URL")}
              </div>
              <div class="flex-wrap-row">
                <a href="/practice/job_01j8x9k2m4p7q" class="btn btn-cypress" style="padding: 7px 14px; font-size: 13px;">${ICONS.school} Open Live Student Practice Room →</a>
                <a href="/dashboard#educator-studio" class="btn btn-sandstone" style="padding: 7px 14px; font-size: 13px;">Open Educator Studio</a>
              </div>
            </div>
          </div>
        </article>

        <article class="showcase-card" data-showcase-card="playback">
          <div class="showcase-card-surface">
            <div>
              <span class="status-pill status-sage" style="margin-bottom: 10px;">Zero-Dependency SDK</span>
              <h3 class="card-title" style="margin-bottom: 8px;">3. Client-Side SVG &amp; Web Audio Engine</h3>
              <p style="font-size: 14px; color: var(--text-umber);">
                API calls return structured MusicXML 4.0—never heavy server audio streams. Browser synthesis keeps playback instant, polyphonic, and zero-latency.
              </p>
            </div>
            <div class="alabaster-panel" style="display: flex; flex-direction: column; gap: 10px;">
              <svg viewBox="0 0 280 54" width="100%" height="54" aria-hidden="true" style="display: block;">
                <line x1="8" y1="12" x2="272" y2="12" stroke="#1C1917" stroke-opacity="0.3" stroke-width="1" />
                <line x1="8" y1="20" x2="272" y2="20" stroke="#1C1917" stroke-opacity="0.3" stroke-width="1" />
                <line x1="8" y1="28" x2="272" y2="28" stroke="#1C1917" stroke-opacity="0.3" stroke-width="1" />
                <line x1="8" y1="36" x2="272" y2="36" stroke="#1C1917" stroke-opacity="0.3" stroke-width="1" />
                <line x1="8" y1="44" x2="272" y2="44" stroke="#1C1917" stroke-opacity="0.3" stroke-width="1" />
                <line x1="126" y1="6" x2="126" y2="48" stroke="#1B3B2B" stroke-width="2" />
                <ellipse cx="48" cy="36" rx="5" ry="3.6" transform="rotate(-18 48 36)" fill="#1C1917" />
                <ellipse cx="88" cy="28" rx="5" ry="3.6" transform="rotate(-18 88 28)" fill="#1C1917" />
                <ellipse cx="126" cy="20" rx="5" ry="3.6" transform="rotate(-18 126 20)" fill="#1B3B2B" />
                <ellipse cx="174" cy="24" rx="5" ry="3.6" transform="rotate(-18 174 24)" fill="#1C1917" />
                <ellipse cx="224" cy="32" rx="5" ry="3.6" transform="rotate(-18 224 32)" fill="#1C1917" />
              </svg>
              <div class="capability-pills">
                <span class="capability-pill">104 BPM Lookahead</span>
                <span class="capability-pill">Click-to-Audition</span>
                <span class="capability-pill">A4 = 440 Hz</span>
              </div>
            </div>
          </div>
        </article>

        <article class="showcase-card" data-showcase-card="security">
          <div class="showcase-card-surface">
            <div>
              <span class="status-pill status-ochre" style="margin-bottom: 10px;">Enterprise Isolation</span>
              <h3 class="card-title" style="margin-bottom: 8px;">4. UK Residency &amp; Tenant Guardrails</h3>
              <p style="font-size: 14px; color: var(--text-umber);">
                Designed for regulated UK/EU education and publishing teams: ephemeral document storage, per-tenant RLS isolation, and origin-locked SDK embeds.
              </p>
            </div>
            <div class="capability-pills">
              <span class="capability-pill">eu-west-2 London</span>
              <span class="capability-pill">24h Auto-Delete</span>
              <span class="capability-pill">SHA-256 Key Vault</span>
              <span class="capability-pill">PostgreSQL RLS</span>
              <span class="capability-pill">CORS Origin Lock</span>
              <span class="capability-pill">HMAC Webhooks</span>
            </div>
          </div>
        </article>
      </div>
    </section>

    <!-- Supported Score Types & Benchmark Transparency Matrix -->
    <section id="benchmarks" class="reveal-section" style="margin-bottom: 56px;">
      <h2 id="benchmarks-heading" class="section-title blur-heading" style="margin-bottom: 8px;">OMR Benchmark Baseline &amp; Supported Score Matrix</h2>
      <p style="color: var(--text-umber); margin-bottom: 20px;">
        We publish repeatable accuracy benchmarks across supported engraved score categories and clearly flag unsupported layouts before integration.
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
                <td><span class="status-pill status-terracotta">Not Supported</span></td>
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

    <!-- Deep Lush Cypress Linnet Mobile App Showcase with Angled Phone Mockup -->
    <section id="linnet-app" class="app-showcase reveal-section">
      <div class="app-showcase-grid">
        <div id="linnet-phone-stage" class="phone-stage">
          <div class="linnet-phone" aria-hidden="true">
            <div class="linnet-phone-speaker"></div>
            <div class="linnet-phone-screen">
              <div class="phone-screen-top">
                <span>LINNET CAPTURE</span>
                <span>99.4%</span>
              </div>
              <div class="phone-viewfinder">
                <svg viewBox="0 0 180 68" width="100%" height="68" style="display: block;">
                  <line x1="6" y1="16" x2="174" y2="16" stroke="#1C1917" stroke-opacity="0.35" stroke-width="1" />
                  <line x1="6" y1="24" x2="174" y2="24" stroke="#1C1917" stroke-opacity="0.35" stroke-width="1" />
                  <line x1="6" y1="32" x2="174" y2="32" stroke="#1C1917" stroke-opacity="0.35" stroke-width="1" />
                  <line x1="6" y1="40" x2="174" y2="40" stroke="#1C1917" stroke-opacity="0.35" stroke-width="1" />
                  <line x1="6" y1="48" x2="174" y2="48" stroke="#1C1917" stroke-opacity="0.35" stroke-width="1" />
                  <ellipse cx="36" cy="40" rx="5" ry="3.6" transform="rotate(-18 36 40)" fill="#1C1917" />
                  <line x1="40.5" y1="40" x2="40.5" y2="19" stroke="#1C1917" stroke-width="1.3" />
                  <ellipse cx="78" cy="28" rx="5" ry="3.6" transform="rotate(-18 78 28)" fill="#1B3B2B" />
                  <line x1="82.5" y1="28" x2="82.5" y2="9" stroke="#1B3B2B" stroke-width="1.4" />
                  <ellipse cx="120" cy="32" rx="5" ry="3.6" transform="rotate(-18 120 32)" fill="#1C1917" />
                  <line x1="124.5" y1="32" x2="124.5" y2="13" stroke="#1C1917" stroke-width="1.3" />
                  <ellipse cx="154" cy="36" rx="5" ry="3.6" transform="rotate(-18 154 36)" fill="#1C1917" />
                  <line x1="158.5" y1="36" x2="158.5" y2="16" stroke="#1C1917" stroke-width="1.3" />
                </svg>
                <div class="phone-scan-beam"></div>
              </div>
              <div class="phone-screen-bottom">
                <span>Nocturne Op. 9 No. 2</span>
                <span class="font-mono" style="color: #E4D6C8;">104 BPM</span>
              </div>
            </div>
          </div>

          <div class="phone-orbit-row" aria-hidden="true">
            <span class="phone-orbit-chip phone-orbit-chip--tl">99.4% Pitch</span>
            <span class="phone-orbit-chip phone-orbit-chip--tr">MusicXML 4.0</span>
            <span class="phone-orbit-chip phone-orbit-chip--bl">1.34s Scan</span>
            <span class="phone-orbit-chip phone-orbit-chip--br">eu-west-2</span>
          </div>

          <button type="button" id="phone-motion-toggle" class="phone-motion-toggle">Pause motion</button>
        </div>

        <div style="display: flex; flex-direction: column; gap: 16px;">
          <div>
            <span class="status-pill" style="background: rgba(250, 246, 240, 0.15); color: var(--bg-alabaster); margin-bottom: 12px;">${ICONS.phone} For Individual Musicians &amp; Music Students · Powered by NoteAva</span>
            <h2 class="section-title blur-heading" style="color: var(--bg-alabaster); margin-bottom: 12px;">The Linnet App: Photograph Printed Music &amp; Hear It Play.</h2>
            <p style="color: var(--border-sandstone); font-size: 15px; margin: 0 0 14px;">
              Practicing at home and unsure how a measure, rhythm, or interval is supposed to sound? Snap a photo of paper sheet music and listen to an accurate playback immediately between lessons.
            </p>
            <div class="flex-wrap-row">
              <span class="btn" style="background: rgba(250, 246, 240, 0.12); color: var(--bg-alabaster); border-color: rgba(228, 214, 200, 0.3); cursor: default;">App Store (Coming Soon)</span>
              <span class="btn" style="background: rgba(250, 246, 240, 0.12); color: var(--bg-alabaster); border-color: rgba(228, 214, 200, 0.3); cursor: default;">Google Play (Coming Soon)</span>
            </div>
          </div>

          <form id="app-waitlist-form" class="alabaster-panel" style="color: var(--text-obsidian); display: flex; flex-direction: column; gap: 12px;">
            <div class="font-serif" style="font-size: 22px;">Get Early Access &amp; Direct App Link</div>
            <p style="margin: 0; font-size: 13px; color: var(--text-umber);">
              Enter your mobile number (SMS) or email for the direct beta download when <strong>Linnet</strong> launches on iOS and Android:
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
      </div>
    </section>

    <!-- Transparent GBP (£) Pricing Calculator -->
    <section id="pricing" class="cashmere-card reveal-section">
      <div style="display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 16px; margin-bottom: 24px;">
        <div style="flex: 1 1 320px;">
          <h2 class="section-title blur-heading" style="margin-bottom: 6px;">Transparent UK GBP (£) Pricing Calculator</h2>
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
        <div class="alabaster-panel pricing-tier-card" data-tier-card="sandbox">
          <span class="recommended-tag">Recommended</span>
          <div class="font-serif" style="font-size: 24px;">Sandbox</div>
          <div class="font-mono" style="font-size: 26px; font-weight: 700; margin: 8px 0;">£0 <span style="font-size: 13px; font-weight: 400; color: var(--text-umber);">/ month</span></div>
          <p style="font-size: 13px; color: var(--text-umber);">50 free pages/mo · Instant <code>lnt_test_</code> key · Localhost + 1 staging origin.</p>
        </div>
        <div class="alabaster-panel pricing-tier-card is-recommended" data-tier-card="growth">
          <span class="recommended-tag">Recommended</span>
          <div class="font-serif" style="font-size: 24px;">Growth</div>
          <div class="font-mono" style="font-size: 26px; font-weight: 700; margin: 8px 0;">£79 <span style="font-size: 13px; font-weight: 400; color: var(--text-umber);">/ month</span></div>
          <p style="font-size: 13px; color: var(--text-umber);">Includes 1,000 pages/mo (+£0.06/page overage) · 5 CORS Allowed Origins · Webhooks.</p>
        </div>
        <div class="alabaster-panel pricing-tier-card" data-tier-card="scale">
          <span class="recommended-tag">Recommended</span>
          <div class="font-serif" style="font-size: 24px;">Scale</div>
          <div class="font-mono" style="font-size: 26px; font-weight: 700; margin: 8px 0;">£299 <span style="font-size: 13px; font-weight: 400; color: var(--text-umber);">/ month</span></div>
          <p style="font-size: 13px; color: var(--text-umber);">Includes 5,000 pages/mo (+£0.04/page overage) · 99.9% SLA · 24h key rotation window.</p>
        </div>
        <div class="alabaster-panel pricing-tier-card" data-tier-card="enterprise">
          <span class="recommended-tag">Recommended</span>
          <div class="font-serif" style="font-size: 24px;">Enterprise &amp; OEM</div>
          <div class="font-mono" style="font-size: 26px; font-weight: 700; margin: 8px 0;">£1,250+ <span style="font-size: 13px; font-weight: 400; color: var(--text-umber);">/ month</span></div>
          <p style="font-size: 13px; color: var(--text-umber);">25,000+ pages/mo · Commercial OEM &amp; reseller licensing · Dedicated worker concurrency.</p>
        </div>
      </div>
    </section>
  </main>
  ${renderFooter()}

  <script type="module">
    import { defineLinnetScorePlayer, BENCHMARK_SCORES } from "/sdk/index.mjs";
    defineLinnetScorePlayer();

    const player = document.getElementById("playground-player");
    const stage = document.getElementById("playground-stage");
    const scanSteps = Array.from(document.querySelectorAll("[data-scan-step]"));
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

    let scanTimer = null;
    let stepTimer1 = null;
    let stepTimer2 = null;

    function setActiveScanStep(stepNum) {
      scanSteps.forEach((step) => {
        step.classList.toggle("is-active", Number(step.dataset.scanStep) === stepNum);
      });
    }

    function triggerScanAnimation() {
      clearTimeout(scanTimer);
      clearTimeout(stepTimer1);
      clearTimeout(stepTimer2);
      setActiveScanStep(1);
      if (stage) {
        stage.classList.remove("is-scanning");
        void stage.offsetWidth;
        stage.classList.add("is-scanning");
      }
      stepTimer1 = setTimeout(() => setActiveScanStep(2), 200);
      stepTimer2 = setTimeout(() => setActiveScanStep(3), 460);
      scanTimer = setTimeout(() => {
        stage?.classList.remove("is-scanning");
      }, 720);
    }

    function selectPreset(presetKey, uploadMeta = null, animateScan = false) {
      const preset = BENCHMARK_SCORES[presetKey];
      if (!preset) return;
      if (animateScan) {
        triggerScanAnimation();
      } else {
        setActiveScanStep(3);
      }
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
        btn.className = btn.getAttribute("data-preset-btn") === presetKey ? "btn btn-cypress preset-btn" : "btn btn-sandstone preset-btn";
      });
    }

    selectPreset("solo_piano", null, false);

    document.querySelectorAll("[data-preset-btn]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (uploadFeedback) uploadFeedback.textContent = "";
        selectPreset(btn.getAttribute("data-preset-btn"), null, true);
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
      }, true);
      uploadFeedback.style.color = "var(--status-sage)";
      uploadFeedback.textContent = \`Digitized "\${file.name}" (\${Math.max(1, Math.round(file.size / 1024))} KB) — Preview loaded\`;
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

    // Interactive GBP Pricing Calculator
    const slider = document.getElementById("calc-pages-slider");
    const pagesLabel = document.getElementById("calc-pages-label");
    const tierName = document.getElementById("calc-tier-name");
    const totalGbp = document.getElementById("calc-total-gbp");
    const tierCards = Array.from(document.querySelectorAll("[data-tier-card]"));

    function updateRecommendedTier(activeKey) {
      tierCards.forEach((card) => {
        card.classList.toggle("is-recommended", card.getAttribute("data-tier-card") === activeKey);
      });
    }

    slider?.addEventListener("input", () => {
      const pages = Number(slider.value);
      pagesLabel.textContent = \`\${pages.toLocaleString("en-GB")} pages/mo\`;
      if (pages <= 50) {
        tierName.textContent = "Sandbox";
        totalGbp.textContent = "£0 / mo";
        updateRecommendedTier("sandbox");
      } else if (pages <= 4500) {
        const overage = Math.max(0, pages - 1000) * 0.06;
        tierName.textContent = "Growth";
        totalGbp.textContent = \`£\${Math.round(79 + overage)} / mo + VAT\`;
        updateRecommendedTier("growth");
      } else {
        const overage = Math.max(0, pages - 5000) * 0.04;
        tierName.textContent = "Scale";
        totalGbp.textContent = \`£\${Math.round(299 + overage)} / mo + VAT\`;
        updateRecommendedTier("scale");
      }
    });

    // Segmented Pill-Tab Workflow Showcase Interactivity
    const showcasePills = Array.from(document.querySelectorAll("[data-showcase-pill]"));
    const showcaseCards = Array.from(document.querySelectorAll("[data-showcase-card]"));
    const showcaseDeck = document.querySelector(".showcase-deck");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    showcasePills.forEach((pill) => {
      pill.addEventListener("click", () => {
        const key = pill.getAttribute("data-showcase-pill");
        showcasePills.forEach((btn) => btn.setAttribute("aria-pressed", String(btn === pill)));

        if (key === "all") {
          showcaseCards.forEach((card) => card.classList.remove("is-highlighted"));
          showcaseDeck?.scrollTo({ left: 0, behavior: reducedMotion ? "auto" : "smooth" });
          return;
        }

        const targetCard = showcaseCards.find((card) => card.getAttribute("data-showcase-card") === key);
        showcaseCards.forEach((card) => card.classList.toggle("is-highlighted", card === targetCard));
        targetCard?.scrollIntoView({
          behavior: reducedMotion ? "auto" : "smooth",
          inline: "center",
          block: "nearest"
        });
      });
    });

    // Mobile Phone Stage Motion Toggle (WCAG 2.2.2)
    const phoneStage = document.getElementById("linnet-phone-stage");
    const phoneMotionToggle = document.getElementById("phone-motion-toggle");
    phoneMotionToggle?.addEventListener("click", () => {
      if (!phoneStage) return;
      const paused = phoneStage.classList.toggle("is-paused");
      phoneMotionToggle.textContent = paused ? "Resume motion" : "Pause motion";
    });

    // Blur-to-sharp heading reveal fallback for browsers without Scroll-Driven ViewTimeline support
    if (!CSS.supports("(animation-timeline: view()) and (animation-range: entry)") &&
        window.matchMedia("(prefers-reduced-motion: no-preference)").matches &&
        "IntersectionObserver" in window) {
      const blurHeadings = Array.from(document.querySelectorAll(".blur-heading"));
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              entry.target.classList.remove("is-fallback-pending");
              entry.target.classList.add("is-revealed");
              observer.unobserve(entry.target);
            }
          }
        },
        { threshold: 0.15 }
      );
      blurHeadings.forEach((el) => {
        el.classList.add("is-fallback-pending");
        observer.observe(el);
      });
    }

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
          <a href="/dashboard" class="btn btn-sandstone" style="font-size: 13px;">${ICONS.key}<span>Passkey</span></a>
          <a href="/dashboard" class="btn btn-sandstone" style="font-size: 13px;">${ICONS.github}<span>GitHub SSO</span></a>
          <a href="/dashboard" class="btn btn-sandstone" style="font-size: 13px;">${ICONS.building}<span>Google SSO</span></a>
        </div>

        <div style="text-align: center; font-size: 12px; color: var(--text-umber); margin: 16px 0;">— OR VERIFY VIA UK / INTERNATIONAL SMS OTP —</div>

        <!-- SMS OTP Form -->
        <form id="sms-otp-form" class="alabaster-panel" style="display: flex; flex-direction: column; gap: 14px;">
          <div>
            <label for="org-name-input" style="display: block; font-size: 12.5px; font-weight: 600; color: var(--text-umber); margin-bottom: 4px;">Organization Workspace Name</label>
            <input id="org-name-input" type="text" autocomplete="organization" value="London Music-Tech Labs" required style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border-sandstone); background: var(--bg-alabaster); font: inherit;" />
          </div>

          <div class="auth-fields-grid">
            <div>
              <label for="phone-input" style="display: block; font-size: 12.5px; font-weight: 600; color: var(--text-umber); margin-bottom: 4px;">Phone Number (E.164 / UK +44)</label>
              <input id="phone-input" type="tel" autocomplete="tel" class="font-mono" value="+44 7700 900077" required style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border-sandstone); background: var(--bg-alabaster);" />
            </div>
            <div>
              <label for="icp-select" style="display: block; font-size: 12.5px; font-weight: 600; color: var(--text-umber); margin-bottom: 4px;">Product Segment</label>
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
            <span>I accept the <strong>Linnet Score UK API Terms &amp; Anti-Resale Policy</strong>. Standalone API wrapping or resale requires an OEM agreement.</span>
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
          <p style="color: var(--border-sandstone); font-size: 14.5px; margin-bottom: 0;">
            The moment your SMS OTP or Passkey verifies, our onboarding hook provisions your isolated PostgreSQL RLS workspace and pre-populates your working Sandbox cURL command.
          </p>
        </div>

        <div id="auth-scanner-card" class="auth-scanner-card">
          <div class="auth-scanner-header">
            <span>Live OMR Pipeline Preview · eu-west-2</span>
            <button type="button" id="auth-scanner-toggle" class="auth-scanner-toggle">Pause scan</button>
          </div>
          <svg viewBox="0 0 360 76" width="100%" height="76" aria-hidden="true" style="display: block;">
            <line x1="16" y1="20" x2="344" y2="20" stroke="rgba(228, 214, 200, 0.36)" stroke-width="1" />
            <line x1="16" y1="28" x2="344" y2="28" stroke="rgba(228, 214, 200, 0.36)" stroke-width="1" />
            <line x1="16" y1="36" x2="344" y2="36" stroke="rgba(228, 214, 200, 0.36)" stroke-width="1" />
            <line x1="16" y1="44" x2="344" y2="44" stroke="rgba(228, 214, 200, 0.36)" stroke-width="1" />
            <line x1="16" y1="52" x2="344" y2="52" stroke="rgba(228, 214, 200, 0.36)" stroke-width="1" />
            <line x1="176" y1="20" x2="176" y2="52" stroke="rgba(228, 214, 200, 0.5)" stroke-width="1" />
            <ellipse cx="64" cy="40" rx="5.5" ry="4" transform="rotate(-18 64 40)" fill="#FAF6F0" />
            <line x1="69" y1="40" x2="69" y2="17" stroke="#FAF6F0" stroke-width="1.4" />
            <ellipse cx="104" cy="32" rx="5.5" ry="4" transform="rotate(-18 104 32)" fill="#FAF6F0" />
            <line x1="109" y1="32" x2="109" y2="11" stroke="#FAF6F0" stroke-width="1.4" />
            <ellipse cx="144" cy="36" rx="5.5" ry="4" transform="rotate(-18 144 36)" fill="#FAF6F0" />
            <line x1="149" y1="36" x2="149" y2="14" stroke="#FAF6F0" stroke-width="1.4" />
            <ellipse cx="210" cy="28" rx="5.5" ry="4" transform="rotate(-18 210 28)" fill="#FAF6F0" />
            <line x1="215" y1="28" x2="215" y2="50" stroke="#FAF6F0" stroke-width="1.4" />
            <ellipse cx="256" cy="36" rx="5.5" ry="4" transform="rotate(-18 256 36)" fill="#FAF6F0" />
            <line x1="261" y1="36" x2="261" y2="14" stroke="#FAF6F0" stroke-width="1.4" />
            <ellipse cx="302" cy="44" rx="5.5" ry="4" transform="rotate(-18 302 44)" fill="#FAF6F0" />
            <line x1="307" y1="44" x2="307" y2="22" stroke="#FAF6F0" stroke-width="1.4" />
          </svg>
          <div class="auth-scanner-beam" aria-hidden="true"></div>
        </div>

        <div class="copyable-code">
          <pre id="auth-curl-preview" class="font-mono" style="background: rgba(28, 25, 23, 0.45); border: 1px solid rgba(228, 214, 200, 0.25); color: var(--bg-alabaster); padding: 18px 48px 18px 18px; border-radius: 12px; font-size: 12.5px; overflow-x: auto; margin: 0;">curl -X POST https://api.linnet.dev/v1/omr/jobs \\
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
          ${renderCopyControl("auth-curl-preview", "Copy Sandbox cURL preview")}
        </div>
      </section>
    </div>
  </main>
  ${renderFooter()}

  <script type="module">
    const scannerCard = document.getElementById("auth-scanner-card");
    const scannerToggle = document.getElementById("auth-scanner-toggle");
    scannerToggle?.addEventListener("click", () => {
      if (!scannerCard) return;
      const paused = scannerCard.classList.toggle("is-paused");
      scannerToggle.textContent = paused ? "Resume scan" : "Pause scan";
    });

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
        <div style="font-size: 13px; color: var(--text-umber);">Tenant Workspace · Isolated Scope (<code>org_id: ${state.organization.id.slice(0, 12)}...</code>)</div>
        <h1 class="page-title" style="margin: 0;">${state.organization.name}</h1>
      </div>
      <div class="flex-wrap-row">
        <span class="status-pill status-sage">${ICONS.phone} SMS OTP Verified (${state.user.phoneNumber})</span>
        <span class="status-pill status-ochre">Tier: ${state.organization.planTier.toUpperCase()}</span>
      </div>
    </div>

    <!-- 30-Second Quickstart Banner -->
    <section class="cashmere-card" style="margin-bottom: 28px; border-left: 4px solid var(--brand-cypress);">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 10px;">
        <div>
          <h2 class="card-title" style="margin: 0;">30-Second Quickstart — Your Active Sandbox cURL</h2>
          <p style="margin: 0; font-size: 13.5px; color: var(--text-umber);">Pre-populated with your provisioned Sandbox token. Run this command to digitize your first score:</p>
        </div>
        <span class="status-pill status-sage">Time to First Integration: 42.0s</span>
      </div>
      <div class="copyable-code">
        <pre id="quickstart-curl" class="alabaster-panel font-mono" style="margin: 0; font-size: 12.5px; overflow-x: auto; padding-right: 48px;">${state.quickstartCurl}</pre>
        ${renderCopyControl("quickstart-curl", "Copy quickstart cURL command")}
      </div>
    </section>

    <!-- KPI Cards -->
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
        <div style="font-size: 12px; color: var(--status-sage);">99.9% SLA · London Gateway</div>
      </div>
      <div class="cashmere-card">
        <div style="font-size: 13px; color: var(--text-umber);">Hard Spend Cap &amp; UK Billing</div>
        <div class="font-mono" style="font-size: 30px; font-weight: 700; margin: 6px 0;">£250.00</div>
        <div style="font-size: 12px; color: var(--text-umber);">VAT: ${state.organization.ukVatNumber}</div>
      </div>
    </section>

    <!-- API Keys Vault -->
    <section class="cashmere-card" style="margin-bottom: 32px;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 16px;">
        <div>
          <h2 id="keys-heading" class="card-title" style="margin: 0;">API Keys Vault (SHA-256 Hashed)</h2>
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
              <th>Origin Header</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="api-keys-tbody">
            ${keyRows}
          </tbody>
        </table>
      </div>
    </section>

    <!-- OMR Job Inspector & Request Logs -->
    <section class="cashmere-card" style="margin-bottom: 32px;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 16px;">
        <div>
          <h2 id="jobs-heading" class="card-title" style="margin: 0;">OMR Job Inspector &amp; Request Logs</h2>
          <p style="margin: 0; font-size: 13.5px; color: var(--text-umber);">Inspect per-call telemetry, structured error codes (<code>ERR_LOW_DPI_IMAGE</code>), and audition digitized outputs in the embedded Score Viewer.</p>
        </div>
        <span class="status-pill status-sage" id="p1-demand-badge">Score Editing Waitlist Requests: ${state.p1EditingRequests}</span>
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
          <span class="status-pill status-sage" style="margin-bottom: 6px;">${ICONS.school} For Music Schools, Conservatoires &amp; Teachers</span>
          <h2 class="card-title" style="margin: 0;">No-Code Educator Studio — Share Interactive Scores with Music Students</h2>
          <p style="margin: 0; font-size: 13.5px; color: var(--text-umber);">
            Generate a ready-to-share <strong>Student Practice Link</strong> or paste an <code>&lt;iframe&gt;</code> embed into Canvas, Moodle, Google Classroom, or your school website so students can hear the melody and practice with tempo and loop controls.
          </p>
        </div>
        <a href="/practice/job_01j8x9k2m4p7q" class="btn btn-cypress">Open Live Student Practice Room →</a>
      </div>

      <div class="split-grid split-grid--even">
        <div class="alabaster-panel">
          <div style="font-size: 12px; font-weight: 600; color: var(--text-umber); margin-bottom: 6px;">SHAREABLE STUDENT PRACTICE LINK (MOBILE &amp; DESKTOP)</div>
          <div class="copyable-wrap">
            <div id="edu-practice-url" class="font-mono" style="font-size: 13px; color: var(--brand-cypress); word-break: break-all;">${webOrigin}/practice/job_01j8x9k2m4p7q?preset=solo_piano</div>
            ${renderCopyControl("edu-practice-url", "Copy student practice link")}
          </div>
        </div>
        <div class="alabaster-panel">
          <div style="font-size: 12px; font-weight: 600; color: var(--text-umber); margin-bottom: 6px;">NO-CODE SCHOOL PORTAL / LMS EMBED SNIPPET</div>
          <div class="copyable-code">
            <code id="edu-iframe-code" class="font-mono" style="display: block; font-size: 12px; padding-right: 44px; word-break: break-all;">&lt;iframe src="${webOrigin}/practice/job_01j8x9k2m4p7q" width="100%" height="380" frameborder="0"&gt;&lt;/iframe&gt;</code>
            ${renderCopyControl("edu-iframe-code", "Copy LMS iframe embed code")}
          </div>
        </div>
      </div>
    </section>

    <!-- Webhooks & SDK CORS Allowed Origins -->
    <section class="split-grid split-grid--even">
      <div class="cashmere-card">
        <h3 class="card-title" style="margin-bottom: 8px;">SDK Allowed Origins</h3>
        <p style="font-size: 13.5px; color: var(--text-umber);">Only these whitelisted domains can render <code>&lt;linnet-score-player&gt;</code> with your publishable token:</p>
        <ul class="font-mono" style="font-size: 13px; padding-left: 18px;">
          ${state.organization.allowedOrigins.map((o) => `<li>${o}</li>`).join("")}
        </ul>
        <div style="font-size: 12.5px; color: var(--text-umber); margin-top: 12px;">
          Webhook Signing Secret: <code class="font-mono">whsec_4a9c•••••••••••••••• (HMAC-SHA256)</code>
        </div>
      </div>

      <div class="cashmere-card">
        <h3 class="card-title" style="margin-bottom: 8px;">Usage &amp; UK Stripe Billing</h3>
        <p style="font-size: 13.5px; color: var(--text-umber);">Hybrid subscription and metered overage billing synced via the Stripe Metered Events API.</p>
        <div class="alabaster-panel" style="font-size: 13px; margin-bottom: 12px;">
          <div><strong>Active Billing Metric:</strong> <code>${state.organization.pricingMetric}</code> (Tracks both pages &amp; jobs)</div>
          <div><strong>UK VAT ID:</strong> <code>${state.organization.ukVatNumber}</code></div>
          <div><strong>24h GDPR Storage Bucket:</strong> <code>linnet-score-ephemeral-eu-west-2</code></div>
        </div>
      </div>
    </section>
  </main>
  ${renderFooter()}

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
    <div id="rotated-key-wrap" class="copyable-code" style="display: none;">
      <pre id="rotated-key-output" class="alabaster-panel font-mono" style="display: none; font-size: 12.5px; color: var(--status-sage); padding-right: 48px;"></pre>
      ${renderCopyControl("rotated-key-output", "Copy rotated live API key")}
    </div>
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

    // Smooth top-layer exit + Safari/legacy fallback for <dialog closedby="any">
    document.querySelectorAll("dialog.linnet-dialog").forEach((dialog) => {
      const closeSmoothly = () => {
        if (window.linnetCloseDialog) window.linnetCloseDialog(dialog);
        else dialog.close();
      };

      dialog.addEventListener("cancel", (event) => {
        if (window.linnetCloseDialog) {
          event.preventDefault();
          closeSmoothly();
        }
      });

      dialog.querySelector('form[method="dialog"]')?.addEventListener("submit", (event) => {
        if (window.linnetCloseDialog) {
          event.preventDefault();
          closeSmoothly();
        }
      });

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
          closeSmoothly();
        });
      }
    });

    const stepUpDialog = document.getElementById("step-up-dialog");
    const inspectorDialog = document.getElementById("job-inspector-dialog");
    const inspectorPlayer = document.getElementById("inspector-player");
    const inspectorErrorBox = document.getElementById("inspector-error-box");
    const otpInput = document.getElementById("dialog-otp-input");
    const otpStatus = document.getElementById("dialog-otp-status");
    const rotatedWrap = document.getElementById("rotated-key-wrap");
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
        if (rotatedWrap) rotatedWrap.style.display = "block";
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
      if (rotatedWrap) rotatedWrap.style.display = "block";
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

    // Track demand signals for early Score Editing waitlist requests
    document.addEventListener("linnet:feedback", async () => {
      const res = await fetch("/api/telemetry/p1-editing-demand", { method: "POST" });
      const data = await res.json();
      document.getElementById("inspector-feedback-status").textContent = data.message;
      document.getElementById("p1-demand-badge").textContent = \`Score Editing Waitlist Requests: \${data.totalSignals}\`;
    });
  </script>
</body>
</html>`;
}

function renderStudentPracticePage(state, jobId, presetKey, webOrigin = `http://localhost:${DEFAULT_WEB_PORT}`) {
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
          <span class="status-pill status-sage" style="margin-bottom: 6px;">${ICONS.school} Student Practice Companion · Assigned by ${state.organization.name}</span>
          <h1 class="page-title" style="margin: 0;">${preset.label}</h1>
          <p style="margin: 4px 0 10px; font-size: 14px; color: var(--text-umber);">
            Press <strong>Play Score</strong> to hear how your piece should sound, click any note to audition its pitch, or turn on <strong>Loop</strong> to repeat measures between lessons.
          </p>
          <div class="copyable-wrap">
            <code id="practice-share-url" class="font-mono" style="font-size: 12px; color: var(--brand-cypress); word-break: break-all;">${webOrigin}/practice/${jobId}?preset=${validPreset}</code>
            ${renderCopyControl("practice-share-url", "Copy student practice link")}
          </div>
        </div>
        <div class="flex-wrap-row">
          <a href="/practice/${jobId}?preset=solo_piano" class="btn ${validPreset === "solo_piano" ? "btn-cypress" : "btn-sandstone"}" style="font-size: 12.5px; padding: 7px 12px;">${ICONS.piano}<span>Solo Piano</span></a>
          <a href="/practice/${jobId}?preset=choral_satb" class="btn ${validPreset === "choral_satb" ? "btn-cypress" : "btn-sandstone"}" style="font-size: 12.5px; padding: 7px 12px;">${ICONS.choir}<span>Choral SATB</span></a>
          <a href="/practice/${jobId}?preset=lead_sheet" class="btn ${validPreset === "lead_sheet" ? "btn-cypress" : "btn-sandstone"}" style="font-size: 12.5px; padding: 7px 12px;">${ICONS.jazz}<span>Jazz Lead Sheet</span></a>
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
      <a href="/#linnet-app" class="btn btn-cypress" style="font-size: 13px; padding: 8px 14px;">${ICONS.phone}<span>Get the Linnet Mobile App →</span></a>
    </div>
  </main>
  ${renderFooter()}

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
