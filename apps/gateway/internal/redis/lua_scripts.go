package redis

// AuthAndQuotaLuaScript executes atomically in Redis in <2ms (Deliverable S-02 & S-03, Decision D-05):
// KEYS[1] = "key:" .. sha256_hash
// KEYS[2] = "rl:" .. org_id .. ":" .. minute_window
// KEYS[3] = "usage:pages:" .. org_id .. ":" .. yyyy_mm
// KEYS[4] = "usage:jobs:" .. org_id .. ":" .. yyyy_mm
// ARGV[1] = current_unix_seconds
// ARGV[2] = pages_requested
const AuthAndQuotaLuaScript = `
local keyData = redis.call("HMGET", KEYS[1], "org_id", "key_id", "env", "revoked", "expires_at", "rpm_limit", "page_quota", "job_quota", "pricing_metric")
local orgId = keyData[1]
if not orgId or orgId == false then
    return {"ERR_INVALID_KEY"}
end

local revoked = keyData[4]
if revoked == "1" then
    return {"ERR_KEY_REVOKED"}
end

local expiresAt = tonumber(keyData[5] or "0")
local nowSec = tonumber(ARGV[1])
if expiresAt > 0 and nowSec > expiresAt then
    return {"ERR_KEY_EXPIRED"}
end

local rpmLimit = tonumber(keyData[6] or "60")
local currentRpm = redis.call("INCR", KEYS[2])
if currentRpm == 1 then
    redis.call("EXPIRE", KEYS[2], 60)
end
if currentRpm > rpmLimit then
    return {"ERR_RATE_LIMIT_EXCEEDED", tostring(rpmLimit)}
end

local pageQuota = tonumber(keyData[7] or "50")
local jobQuota = tonumber(keyData[8] or "50")
local pricingMetric = keyData[9] or "per_page"
local pagesReq = tonumber(ARGV[2] or "1")

local usedPages = tonumber(redis.call("GET", KEYS[3]) or "0")
local usedJobs = tonumber(redis.call("GET", KEYS[4]) or "0")

if pricingMetric == "per_page" and (usedPages + pagesReq) > pageQuota then
    return {"ERR_QUOTA_EXCEEDED", "per_page", tostring(usedPages), tostring(pageQuota)}
end

if pricingMetric == "per_job" and (usedJobs + 1) > jobQuota then
    return {"ERR_QUOTA_EXCEEDED", "per_job", tostring(usedJobs), tostring(jobQuota)}
end

return {"OK", orgId, keyData[2], keyData[3], tostring(usedPages), tostring(pageQuota), tostring(rpmLimit - currentRpm)}
`

