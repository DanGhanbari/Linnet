import test from "node:test";
import assert from "node:assert/strict";
import { createWebAppServer, DEFAULT_WEB_PORT } from "../server.mjs";

test("Phase 2 & 3 Exit Gates: Landing Page Playground, SMS OTP Auth + 60s Sandbox Hook, and B2B Dashboard", async () => {
  assert.equal(DEFAULT_WEB_PORT, 3100);
  const server = createWebAppServer();

  // 1. Verify Commercial Landing Page (S-04 Playground, S-08 Website, S-09 GBP Pricing, S-12 Benchmarks)
  const homeRes = await server.dispatchRequest({ method: "GET", path: "/" });
  assert.equal(homeRes.status, 200);
  const homeHtml = homeRes.text();
  assert.ok(homeHtml.includes("Sheet Music Intelligence, Engineered for Developers."));
  assert.ok(homeHtml.includes("<linnet-score-player"));
  assert.ok(homeHtml.includes("OMR Benchmark Baseline"));
  assert.ok(homeHtml.includes("Transparent UK GBP (£) Pricing Calculator"));
  assert.ok(homeHtml.includes('id="playground-telemetry"'));
  assert.ok(homeHtml.includes('popovertarget="site-menu"'));
  assert.ok(homeHtml.includes('id="site-menu"'));
  assert.ok(homeHtml.includes('role="tablist"'));
  assert.ok(homeHtml.includes('hidden="until-found"'));
  assert.ok(homeHtml.includes('class="table-wrapper"'));
  assert.ok(!homeHtml.includes('split-grid" style="grid-template-columns:'));

  // 2. Verify Lush & Nude Design Tokens in /styles.css
  const cssRes = await server.dispatchRequest({ method: "GET", path: "/styles.css" });
  assert.equal(cssRes.status, 200);
  const cssText = cssRes.text();
  assert.ok(cssText.includes("#FAF6F0"));
  assert.ok(cssText.includes("#F2EAE1"));
  assert.ok(cssText.includes("#1B3B2B"));
  assert.ok(cssText.includes("--font-display: 'Chillax'"));
  assert.ok(cssText.includes("--font-sans: 'Figtree'"));

  // 3. Verify SMS OTP Send & Verify + Zero-Friction 60-Second Sandbox Provisioning Hook (S-02, S-10, D-01)
  const otpSendRes = await server.dispatchRequest({
    method: "POST",
    path: "/api/auth/otp/send",
    body: { phoneNumber: "07700 900123", purpose: "signup" }
  });
  assert.equal(otpSendRes.status, 200);
  const otpSendData = otpSendRes.json();
  assert.equal(otpSendData.phoneNumber, "+447700900123");
  assert.match(otpSendData.demoOtpPreview, /^\d{6}$/);

  const otpVerifyRes = await server.dispatchRequest({
    method: "POST",
    path: "/api/auth/otp/verify",
    body: {
      phoneNumber: "+447700900123",
      otpCode: otpSendData.demoOtpPreview,
      organizationName: "Cambridge Choir Tech",
      icpSegment: "sheet_music_platform",
      apiTermsAccepted: true
    }
  });
  assert.equal(otpVerifyRes.status, 200);
  const otpVerifyData = otpVerifyRes.json();
  assert.equal(otpVerifyData.verified, true);
  assert.match(otpVerifyData.oneTimeRawKey, /^lnt_test_/);

  // 4. Verify Step-Up Authorized Production Live Key Rotation (24h Grace Period)
  const rotateRes = await server.dispatchRequest({
    method: "POST",
    path: "/api/keys/rotate",
    body: {}
  });
  assert.equal(rotateRes.status, 200);
  const rotateData = rotateRes.json();
  assert.equal(rotateData.rotated, true);
  assert.match(rotateData.oneTimeRawKey, /^lnt_live_/);

  // 5. Verify B2B Developer & Educator Dashboard (/dashboard) renders updated workspace, keys, logs & Educator Studio
  const authRes = await server.dispatchRequest({ method: "GET", path: "/auth" });
  assert.equal(authRes.status, 200);
  assert.ok(!authRes.text().includes('split-grid" style="grid-template-columns:'));

  const dashRes = await server.dispatchRequest({ method: "GET", path: "/dashboard" });
  assert.equal(dashRes.status, 200);
  const dashHtml = dashRes.text();
  assert.ok(dashHtml.includes("Cambridge Choir Tech"));
  assert.ok(dashHtml.includes("ERR_LOW_DPI_IMAGE"));
  assert.ok(dashHtml.includes('closedby="any"'));
  assert.ok(dashHtml.includes("No-Code Educator Studio"));
  assert.ok(dashHtml.includes("http://localhost:3100"));
  assert.ok(dashHtml.includes("http://localhost:3100/practice/job_01j8x9k2m4p7q?preset=solo_piano"));
  assert.ok(!dashHtml.includes("http://localhost:3000"));
  assert.ok(dashHtml.includes('data-job-category="choral_satb"'));
  assert.ok(dashHtml.includes('data-user-phone="+447700900123"'));
  assert.ok(!dashHtml.includes('split-grid" style="grid-template-columns:'));

  // 6. Verify Student Practice Room (/practice/:jobId) for Music Schools & Students
  const practiceRes = await server.dispatchRequest({
    method: "GET",
    path: "/practice/job_01j8x9k2m4p7q?preset=choral_satb"
  });
  assert.equal(practiceRes.status, 200);
  const practiceHtml = practiceRes.text();
  assert.ok(practiceHtml.includes("Student Practice Companion"));
  assert.ok(practiceHtml.includes("<linnet-score-player"));

  // 7. Verify Linnet Mobile App (iOS App Store & Google Play) Early Access Waitlist API
  const waitlistRes = await server.dispatchRequest({
    method: "POST",
    path: "/api/app-waitlist",
    body: { contact: "+447700900888", platform: "ios_and_android" }
  });
  assert.equal(waitlistRes.status, 200);
  const waitlistData = waitlistRes.json();
  assert.equal(waitlistData.registered, true);

  // 8. Verify Railway healthcheck & forwarded Host origin resolution
  const healthRes = await server.dispatchRequest({ method: "GET", path: "/health" });
  assert.equal(healthRes.status, 200);
  assert.deepEqual(healthRes.json(), { status: "ok", service: "linnet-score-web" });

  const proxiedDashRes = await server.dispatchRequest({
    method: "GET",
    path: "/dashboard",
    headers: { host: "linnet-demo.up.railway.app", "x-forwarded-proto": "https" }
  });
  assert.equal(proxiedDashRes.status, 200);
  assert.ok(
    proxiedDashRes.text().includes("https://linnet-demo.up.railway.app/practice/job_01j8x9k2m4p7q?preset=solo_piano")
  );

  // 9. Verify natural editorial polish, copy controls, scan overlay, and zero emojis or internal spec boilerplate
  const landingCheckRes = await server.dispatchRequest({ method: "GET", path: "/" });
  assert.equal(landingCheckRes.status, 200);
  const freshLandingHtml = landingCheckRes.text();
  assert.ok(freshLandingHtml.includes('id="playground-scan-overlay"'));
  assert.ok(freshLandingHtml.includes('data-tier-card="scale"'));
  assert.ok(freshLandingHtml.includes('command="--copy"'));
  assert.ok(freshLandingHtml.includes('<footer class="site-footer"'));

  const forbiddenTokens = [
    "🎹",
    "🎶",
    "🎷",
    "🎓",
    "📱",
    "🔑",
    "🐙",
    "🏢",
    "✦",
    "",
    "▶",
    "Deliverable S-",
    "Charter D-",
    "Risk R-",
    "Out of P0 Scope",
    "P0 Supported"
  ];

  for (const [routeLabel, htmlBody] of [
    ["/", freshLandingHtml],
    ["/auth", authRes.text()],
    ["/dashboard", dashHtml],
    ["/practice", practiceHtml]
  ]) {
    for (const token of forbiddenTokens) {
      assert.ok(
        !htmlBody.includes(token),
        `Route ${routeLabel} must not contain leftover boilerplate or emoji token "${token}"`
      );
    }
  }
});
