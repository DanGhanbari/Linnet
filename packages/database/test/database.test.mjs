import test from "node:test";
import assert from "node:assert/strict";
import {
  generateApiKey,
  rotateApiKey,
  normalizePhoneE164,
  SmsOtpManager,
  provisionZeroFrictionSandbox,
  OMR_BENCHMARK_BASELINES
} from "../src/index.mjs";

test("S-02: generateApiKey creates lnt_test_ and lnt_live_ keys with SHA-256 hash and prefix", () => {
  const orgId = "8b62c1e3-3f1d-4d62-9f35-79b22d8d9101";
  const sandboxKey = generateApiKey({ environment: "sandbox", name: "Dev Key", orgId });

  assert.match(sandboxKey.rawKey, /^lnt_test_[0-9A-Za-z]{32}$/);
  assert.equal(sandboxKey.keyPrefix, sandboxKey.rawKey.slice(0, 13));
  assert.equal(sandboxKey.keyHash.length, 64);
  assert.notEqual(sandboxKey.keyHash, sandboxKey.rawKey);

  const liveKey = generateApiKey({ environment: "live", name: "Prod Key", orgId });
  assert.match(liveKey.rawKey, /^lnt_live_[0-9A-Za-z]{32}$/);
});

test("S-02: rotateApiKey enforces step-up MFA for live keys and sets 24h dual-validity grace window", () => {
  const orgId = "8b62c1e3-3f1d-4d62-9f35-79b22d8d9101";
  const liveKey = generateApiKey({ environment: "live", name: "Prod Backend", orgId });
  const now = new Date("2026-10-28T18:00:00Z");

  // Without step-up verification -> throws ERR_STEP_UP_REQUIRED
  assert.throws(
    () => rotateApiKey({ existingKey: liveKey, lastStepUpVerifiedAt: null, now }),
    (err) => err.code === "ERR_STEP_UP_REQUIRED"
  );

  // With fresh SMS OTP / Passkey step-up verification (<5 mins ago) -> succeeds
  const recentStepUp = new Date("2026-10-28T17:58:00Z").toISOString();
  const rotated = rotateApiKey({
    existingKey: liveKey,
    gracePeriodHours: 24,
    lastStepUpVerifiedAt: recentStepUp,
    now
  });

  assert.equal(rotated.deprecatedKey.expiresAt, "2026-10-29T18:00:00.000Z");
  assert.equal(rotated.replacementKey.rotatedFromKeyId, liveKey.id);
  assert.match(rotated.replacementKey.rawKey, /^lnt_live_/);
});

test("SMS OTP: normalizePhoneE164 normalizes UK 07... and international E.164 numbers", () => {
  assert.equal(normalizePhoneE164("07700 900077"), "+447700900077");
  assert.equal(normalizePhoneE164("+44 7700 900077"), "+447700900077");
  assert.equal(normalizePhoneE164("00447700900077"), "+447700900077");
  assert.throws(() => normalizePhoneE164("invalid-phone"), /ERR_INVALID_PHONE/);
});

test("SMS OTP: enforces 3 sends per 10 mins rate limit, 5-min TTL, and max 3 verification attempts", () => {
  const otpManager = new SmsOtpManager({ pepper: "test-pepper" });
  const t0 = new Date("2026-10-28T18:00:00Z");

  const c1 = otpManager.issueChallenge({ rawPhone: "07700900077", ipAddress: "81.2.69.142", now: t0 });
  assert.equal(c1.phoneNumber, "+447700900077");
  assert.match(c1.otpCodeForDispatch, /^\d{6}$/);

  // 2 wrong attempts followed by 1 correct attempt succeeds
  assert.throws(
    () => otpManager.verifyChallenge({ rawPhone: "07700900077", otpCode: "000000", now: t0 }),
    (err) => err.code === "ERR_OTP_INVALID"
  );
  assert.throws(
    () => otpManager.verifyChallenge({ rawPhone: "07700900077", otpCode: "111111", now: t0 }),
    (err) => err.code === "ERR_OTP_INVALID"
  );

  const verified = otpManager.verifyChallenge({
    rawPhone: "+447700900077",
    otpCode: c1.otpCodeForDispatch,
    now: t0
  });
  assert.equal(verified.verified, true);

  // Issue 2 more within 10 minutes (total 3 allowed)
  otpManager.issueChallenge({ rawPhone: "07700900077", ipAddress: "81.2.69.142", now: t0 });
  otpManager.issueChallenge({ rawPhone: "07700900077", ipAddress: "81.2.69.142", now: t0 });

  // 4th send within 10 minutes is blocked by rate limiter
  assert.throws(
    () => otpManager.issueChallenge({ rawPhone: "07700900077", ipAddress: "81.2.69.142", now: t0 }),
    (err) => err.code === "ERR_OTP_RATE_LIMIT"
  );
});

test("DX Metric & S-10: provisionZeroFrictionSandbox requires UK API Terms and creates ready-to-run cURL", () => {
  assert.throws(
    () => provisionZeroFrictionSandbox({ userId: "u1", organizationName: "London Music Lab", apiTermsAccepted: false }),
    (err) => err.code === "ERR_TERMS_REQUIRED"
  );

  const result = provisionZeroFrictionSandbox({
    userId: "39e14794-6a97-44a4-a6bd-71c80f88922a",
    organizationName: "Royal Conservatoire EdTech",
    icpSegment: "edtech",
    acquisitionChannel: "outbound",
    utmCampaign: "uk_q4_validation",
    apiTermsAccepted: true
  });

  assert.equal(result.organization.planTier, "sandbox");
  assert.equal(result.organization.monthlyPageQuota, 50);
  assert.equal(result.organization.icpSegment, "edtech");
  assert.equal(result.organization.acquisitionChannel, "outbound");
  assert.match(result.oneTimeRawKeyFlash, /^lnt_test_/);
  assert.ok(result.quickstartCurl.includes(result.oneTimeRawKeyFlash));
  assert.equal(OMR_BENCHMARK_BASELINES.length, 3);
});

