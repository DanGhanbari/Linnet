import crypto from "node:crypto";

const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * Generates a cryptographically random Base62 string of the specified length.
 */
export function randomBase62(length = 32) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += BASE62_ALPHABET[bytes[i] % BASE62_ALPHABET.length];
  }
  return out;
}

/**
 * Computes the hex-encoded SHA-256 digest of a raw string.
 */
export function sha256Hex(input) {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Deliverable S-02: Generates a new Linnet Score API Key (`lnt_test_...` or `lnt_live_...`).
 * Never persist `rawKey` in PostgreSQL; store only `keyPrefix` and `keyHash`.
 */
export function generateApiKey({ environment = "sandbox", name = "Default Key", orgId, createdByUserId = null }) {
  if (environment !== "sandbox" && environment !== "live") {
    throw new Error(`Invalid environment "${environment}". Expected "sandbox" or "live".`);
  }
  if (!orgId) {
    throw new Error("orgId is required to scope API key to a tenant organization.");
  }

  const envTag = environment === "live" ? "live" : "test";
  const secretPart = randomBase62(32);
  const rawKey = `lnt_${envTag}_${secretPart}`;
  const keyPrefix = `lnt_${envTag}_${secretPart.slice(0, 4)}`;
  const keyHash = sha256Hex(rawKey);

  return {
    id: crypto.randomUUID(),
    orgId,
    createdByUserId,
    name,
    environment,
    rawKey,     // Shown ONCE in creation modal or 60s onboarding banner
    keyPrefix,  // Persisted for UI identification (e.g. "lnt_live_8f9a")
    keyHash,    // Persisted SHA-256 hash
    createdAt: new Date().toISOString(),
    expiresAt: null,
    revokedAt: null
  };
}

/**
 * Deliverable S-02: Rotates an existing API key with a configurable dual-validity grace period (default 24 hours).
 * Requires step-up verification (SMS OTP or WebAuthn Passkey) when rotating a `live` key.
 */
export function rotateApiKey({ existingKey, gracePeriodHours = 24, lastStepUpVerifiedAt = null, now = new Date() }) {
  if (existingKey.environment === "live") {
    assertRecentStepUpVerification(lastStepUpVerifiedAt, now);
  }

  const graceExpiresAt = new Date(now.getTime() + gracePeriodHours * 3600 * 1000).toISOString();
  const updatedOldKey = {
    ...existingKey,
    expiresAt: graceExpiresAt
  };

  const replacementKey = generateApiKey({
    environment: existingKey.environment,
    name: `${existingKey.name} (Rotated)`,
    orgId: existingKey.orgId,
    createdByUserId: existingKey.createdByUserId
  });

  return {
    deprecatedKey: updatedOldKey,
    replacementKey: {
      ...replacementKey,
      rotatedFromKeyId: existingKey.id
    }
  };
}

/**
 * Enforces that a sensitive production action was preceded by SMS OTP or Passkey step-up MFA within the last 5 minutes.
 */
export function assertRecentStepUpVerification(lastStepUpVerifiedAt, now = new Date()) {
  if (!lastStepUpVerifiedAt) {
    const err = new Error("STEP_UP_REQUIRED: Production mutation requires SMS OTP or Passkey verification.");
    err.code = "ERR_STEP_UP_REQUIRED";
    throw err;
  }
  const verifiedTime = new Date(lastStepUpVerifiedAt).getTime();
  const maxAgeMs = 5 * 60 * 1000; // 5 minutes
  if (now.getTime() - verifiedTime > maxAgeMs) {
    const err = new Error("STEP_UP_EXPIRED: Step-up verification is older than 5 minutes. Please verify via SMS OTP or Passkey.");
    err.code = "ERR_STEP_UP_EXPIRED";
    throw err;
  }
}

/**
 * Normalizes a UK or international phone number to strict E.164 format.
 * Defaults leading `07...` UK mobile numbers to `+447...`.
 */
export function normalizePhoneE164(rawPhone, defaultCountryCode = "+44") {
  const cleaned = String(rawPhone || "").replace(/[\s\-().]/g, "");
  if (!cleaned) {
    throw new Error("ERR_INVALID_PHONE: Phone number cannot be empty.");
  }

  let normalized = cleaned;
  if (normalized.startsWith("00")) {
    normalized = "+" + normalized.slice(2);
  } else if (normalized.startsWith("0") && defaultCountryCode === "+44") {
    normalized = "+44" + normalized.slice(1);
  } else if (!normalized.startsWith("+")) {
    normalized = defaultCountryCode + normalized;
  }

  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw new Error(`ERR_INVALID_PHONE: "${rawPhone}" is not a valid E.164 phone number.`);
  }
  return normalized;
}

/**
 * Hashes a 6-digit SMS OTP code with the target E.164 phone number and server pepper.
 */
export function hashSmsOtp(phoneE164, otpCode, pepper = "linnet-default-otp-pepper") {
  return sha256Hex(`${phoneE164}:${otpCode}:${pepper}`);
}

/**
 * In-memory / Redis-compatible SMS OTP Challenge Manager enforcing:
 * - Max 3 OTP sends per 10 minutes per E.164 phone AND per client IP
 * - 6-digit CSPRNG code
 * - 5-minute TTL
 * - Max 3 verification attempts before automatic lockout
 */
export class SmsOtpManager {
  constructor({ pepper = process.env.AUTH_OTP_PEPPER || "linnet-score-otp-pepper" } = {}) {
    this.pepper = pepper;
    this.challenges = new Map(); // phoneE164 -> challenge object
    this.sendHistoryByPhone = new Map(); // phoneE164 -> [timestamps]
    this.sendHistoryByIp = new Map(); // ip -> [timestamps]
  }

  issueChallenge({ rawPhone, ipAddress = "127.0.0.1", purpose = "signin", now = new Date() }) {
    const phoneNumber = normalizePhoneE164(rawPhone);
    const nowMs = now.getTime();
    const tenMinAgo = nowMs - 10 * 60 * 1000;

    const phoneSends = (this.sendHistoryByPhone.get(phoneNumber) || []).filter((t) => t > tenMinAgo);
    if (phoneSends.length >= 3) {
      const err = new Error("ERR_OTP_RATE_LIMIT_PHONE: Maximum 3 SMS OTP codes per 10 minutes exceeded for this phone number.");
      err.code = "ERR_OTP_RATE_LIMIT";
      throw err;
    }

    const ipSends = (this.sendHistoryByIp.get(ipAddress) || []).filter((t) => t > tenMinAgo);
    if (ipSends.length >= 3) {
      const err = new Error("ERR_OTP_RATE_LIMIT_IP: Maximum 3 SMS OTP codes per 10 minutes exceeded for this IP address.");
      err.code = "ERR_OTP_RATE_LIMIT";
      throw err;
    }

    phoneSends.push(nowMs);
    ipSends.push(nowMs);
    this.sendHistoryByPhone.set(phoneNumber, phoneSends);
    this.sendHistoryByIp.set(ipAddress, ipSends);

    const otpCode = crypto.randomInt(100000, 1000000).toString();
    const otpHash = hashSmsOtp(phoneNumber, otpCode, this.pepper);
    const challenge = {
      id: crypto.randomUUID(),
      phoneNumber,
      otpHash,
      purpose,
      attempts: 0,
      ipAddress,
      expiresAt: new Date(nowMs + 5 * 60 * 1000).toISOString(),
      consumedAt: null,
      createdAt: now.toISOString()
    };

    this.challenges.set(phoneNumber, challenge);

    return {
      challengeId: challenge.id,
      phoneNumber,
      expiresAt: challenge.expiresAt,
      // Returned to the SMS dispatch adapter (Twilio Verify eu1 / Vonage UK) — never stored in DB
      otpCodeForDispatch: otpCode
    };
  }

  verifyChallenge({ rawPhone, otpCode, now = new Date() }) {
    const phoneNumber = normalizePhoneE164(rawPhone);
    const challenge = this.challenges.get(phoneNumber);

    if (!challenge || challenge.consumedAt) {
      const err = new Error("ERR_OTP_NOT_FOUND: No active SMS OTP challenge found for this phone number.");
      err.code = "ERR_OTP_NOT_FOUND";
      throw err;
    }

    if (now.getTime() > new Date(challenge.expiresAt).getTime()) {
      this.challenges.delete(phoneNumber);
      const err = new Error("ERR_OTP_EXPIRED: SMS OTP code has expired (5-minute TTL).");
      err.code = "ERR_OTP_EXPIRED";
      throw err;
    }

    if (challenge.attempts >= 3) {
      this.challenges.delete(phoneNumber);
      const err = new Error("ERR_OTP_MAX_ATTEMPTS: Maximum 3 verification attempts exceeded. Request a new code.");
      err.code = "ERR_OTP_MAX_ATTEMPTS";
      throw err;
    }

    challenge.attempts += 1;
    const candidateHash = hashSmsOtp(phoneNumber, String(otpCode).trim(), this.pepper);
    const hashesMatch = crypto.timingSafeEqual(
      Buffer.from(challenge.otpHash, "hex"),
      Buffer.from(candidateHash, "hex")
    );

    if (!hashesMatch) {
      if (challenge.attempts >= 3) {
        this.challenges.delete(phoneNumber);
      }
      const err = new Error("ERR_OTP_INVALID: Invalid 6-digit verification code.");
      err.code = "ERR_OTP_INVALID";
      throw err;
    }

    challenge.consumedAt = now.toISOString();
    return {
      verified: true,
      phoneNumber,
      purpose: challenge.purpose,
      verifiedAt: challenge.consumedAt
    };
  }
}

/**
 * Charter Deliverable S-04 / S-07 / DX Metric:
 * Zero-Friction 60-Second Onboarding Hook.
 * Automatically provisions an Organization Workspace, 50-page Sandbox quota,
 * and an active `lnt_test_...` API key on signup so the first dashboard screen has a working `curl` snippet.
 */
export function provisionZeroFrictionSandbox({
  userId,
  organizationName,
  icpSegment = "learning_app",
  acquisitionChannel = "direct",
  utmCampaign = null,
  apiTermsAccepted = true
}) {
  if (!apiTermsAccepted) {
    const err = new Error("ERR_TERMS_REQUIRED: UK API Terms & Anti-Resale Policy (S-10) must be accepted.");
    err.code = "ERR_TERMS_REQUIRED";
    throw err;
  }

  const orgId = crypto.randomUUID();
  const slugBase = String(organizationName || "workspace")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const slug = `${slugBase || "org"}-${randomBase62(6).toLowerCase()}`;

  const organization = {
    id: orgId,
    name: organizationName || "Default Workspace",
    slug,
    icpSegment,
    acquisitionChannel,
    utmCampaign,
    apiTermsAcceptedAt: new Date().toISOString(),
    oemResellerAgreement: false,
    planTier: "sandbox",
    pricingMetric: "per_page",
    monthlyPageQuota: 50,
    monthlyJobQuota: 50,
    firstApiCallAt: null,
    createdAt: new Date().toISOString()
  };

  const membership = {
    id: crypto.randomUUID(),
    orgId,
    userId,
    role: "owner"
  };

  const sandboxKey = generateApiKey({
    environment: "sandbox",
    name: "Sandbox Quickstart Key",
    orgId,
    createdByUserId: userId
  });

  const quickstartCurl = [
    `curl -X POST https://api.linnet.dev/v1/omr/jobs \\`,
    `  -H "Authorization: Bearer ${sandboxKey.rawKey}" \\`,
    `  -F "file=@./sample-piano-score.pdf" \\`,
    `  -F "output_format=mxl"`
  ].join("\n");

  return {
    organization,
    membership,
    sandboxKeyRecord: {
      id: sandboxKey.id,
      orgId: sandboxKey.orgId,
      name: sandboxKey.name,
      keyPrefix: sandboxKey.keyPrefix,
      keyHash: sandboxKey.keyHash,
      environment: sandboxKey.environment,
      createdAt: sandboxKey.createdAt
    },
    oneTimeRawKeyFlash: sandboxKey.rawKey,
    quickstartCurl
  };
}

/**
 * Deliverable S-12 & Risk R-01: Official OMR Benchmark Baseline Registry.
 */
export const OMR_BENCHMARK_BASELINES = Object.freeze([
  {
    id: "bench_piano_chopin_op9_no2",
    title: "Chopin Nocturne Op. 9 No. 2 (Solo Piano)",
    scoreCategory: "solo_piano",
    supportTier: "p0_supported",
    minRecommendedDpi: 150,
    notePitchAccuracyPct: 99.2,
    rhythmDurationAccuracyPct: 98.8,
    medianLatencyMs: 1380,
    sampleMusicXmlPath: "/samples/chopin-nocturne-op9-no2.musicxml"
  },
  {
    id: "bench_choral_bach_bwv244",
    title: "J.S. Bach Chorale SATB (4-Part Vocal)",
    scoreCategory: "choral_satb",
    supportTier: "p0_supported",
    minRecommendedDpi: 150,
    notePitchAccuracyPct: 99.4,
    rhythmDurationAccuracyPct: 99.1,
    medianLatencyMs: 1290,
    sampleMusicXmlPath: "/samples/bach-chorale-satb.musicxml"
  },
  {
    id: "bench_leadsheet_autumn_jazz",
    title: "Standard Jazz Lead Sheet (Melody + Chords)",
    scoreCategory: "lead_sheet",
    supportTier: "p0_supported",
    minRecommendedDpi: 150,
    notePitchAccuracyPct: 99.6,
    rhythmDurationAccuracyPct: 99.3,
    medianLatencyMs: 940,
    sampleMusicXmlPath: "/samples/jazz-lead-sheet.musicxml"
  }
]);

