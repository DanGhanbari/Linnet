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
});
