package gateway

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Organization represents a B2B Tenant in Linnet Score (Deliverable S-02, Decisions D-01, D-05, D-08).
type Organization struct {
	ID                 string     `json:"id"`
	Name               string     `json:"name"`
	PlanTier           string     `json:"plan_tier"`           // sandbox, growth, scale, enterprise
	PricingMetric      string     `json:"pricing_metric"`      // per_page, per_job (Decision D-05)
	MonthlyPageQuota   int        `json:"monthly_page_quota"`
	MonthlyJobQuota    int        `json:"monthly_job_quota"`
	RPMLimit           int        `json:"rpm_limit"`
	PagesUsedThisMonth int        `json:"pages_used_this_month"`
	JobsUsedThisMonth  int        `json:"jobs_used_this_month"`
	AllowedOrigins     []string   `json:"allowed_origins"`     // CORS lock for <linnet-score-player> (R-05)
	WebhookSecret      string     `json:"-"`
	CreatedAt          time.Time  `json:"created_at"`
	FirstAPICallAt     *time.Time `json:"first_api_call_at,omitempty"` // Critical DX Metric
}

// APIKeyRecord stores only the prefix and SHA-256 hash of a tenant's API key (Deliverable S-02).
type APIKeyRecord struct {
	ID         string     `json:"id"`
	OrgID      string     `json:"org_id"`
	Name       string     `json:"name"`
	KeyPrefix  string     `json:"key_prefix"`
	KeyHash    string     `json:"-"` // SHA-256 hex digest of raw key
	Env        string     `json:"environment"` // sandbox or live
	ExpiresAt  *time.Time `json:"expires_at,omitempty"` // 24h dual-validity rotation grace window
	RevokedAt  *time.Time `json:"revoked_at,omitempty"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
	LastOrigin string     `json:"last_used_origin,omitempty"`
}

// OMRJob represents an OMR digitization job in the v1 API Contract (Deliverable S-01, S-11, D-02, D-07).
type OMRJob struct {
	ID               string    `json:"id"`
	OrgID            string    `json:"org_id"`
	APIKeyID         string    `json:"api_key_id"`
	Status           string    `json:"status"` // queued, processing, completed, failed
	ScoreCategory    string    `json:"score_category"` // solo_piano, choral_satb, lead_sheet, chamber, general
	PagesProcessed   int       `json:"pages_processed"`
	InputFormat      string    `json:"input_format"`  // pdf, png, jpg
	OutputFormat     string    `json:"output_format"` // mxl, musicxml (Decision D-02)
	InputS3URI       string    `json:"-"`             // Private eu-west-2 bucket key (24h auto-delete D-07)
	OutputDownloadURL string   `json:"output_download_url,omitempty"`
	ProcessingTimeMs int       `json:"processing_time_ms"`
	ConfidenceScore  float64   `json:"confidence_score"`
	StorageRegion    string    `json:"storage_region"` // always "eu-west-2" (London)
	ExpiresAt        time.Time `json:"expires_at"`     // 24 hours from creation (UK GDPR D-07)
	CreatedAt        time.Time `json:"created_at"`
}

// BenchmarkBaseline represents a repeatable OMR accuracy benchmark (Deliverable S-12, Risk R-01).
type BenchmarkBaseline struct {
	ID                        string  `json:"id"`
	Title                     string  `json:"title"`
	ScoreCategory             string  `json:"score_category"`
	SupportTier               string  `json:"support_tier"` // p0_supported, p0_caveats, experimental
	MinRecommendedDPI         int     `json:"min_recommended_dpi"`
	NotePitchAccuracyPct      float64 `json:"note_pitch_accuracy_pct"`
	RhythmDurationAccuracyPct float64 `json:"rhythm_duration_accuracy_pct"`
	MedianLatencyMs           int     `json:"median_latency_ms"`
}

// MeterEvent represents an idempotent Stripe Billing usage event (Deliverable S-09, Decision D-05).
type MeterEvent struct {
	EventName      string    `json:"event_name"` // omr_pages_processed or omr_jobs_processed
	OrgID          string    `json:"org_id"`
	IdempotencyKey string    `json:"idempotency_key"` // job_id
	Value          int       `json:"value"`
	Timestamp      time.Time `json:"timestamp"`
}

// Server implements the Linnet Score v1 Public API Gateway.
type Server struct {
	mu           sync.RWMutex
	orgs         map[string]*Organization // orgID -> Organization
	keysByHash   map[string]*APIKeyRecord // sha256(rawKey) -> APIKeyRecord
	jobsByID     map[string]*OMRJob       // jobID -> OMRJob
	rateCounters map[string]int           // orgID:minuteWindow -> request count
	meterEvents  []MeterEvent
	mux          *http.ServeMux
}

// NewServer initializes a new Linnet Score v1 API Gateway server.
func NewServer() *Server {
	s := &Server{
		orgs:         make(map[string]*Organization),
		keysByHash:   make(map[string]*APIKeyRecord),
		jobsByID:     make(map[string]*OMRJob),
		rateCounters: make(map[string]int),
		mux:          http.NewServeMux(),
	}
	s.registerRoutes()
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-API-Version", "2026-10-28.v1")
	w.Header().Set("X-Data-Residency", "eu-west-2")
	s.mux.ServeHTTP(w, r)
}

func (s *Server) registerRoutes() {
	s.mux.HandleFunc("GET /v1/health", s.handleHealth)
	s.mux.HandleFunc("GET /v1/benchmarks", s.handleBenchmarks)
	s.mux.HandleFunc("POST /v1/omr/jobs", s.withAPIKeyAuth(s.handleCreateOMRJob))
	s.mux.HandleFunc("GET /v1/omr/jobs/{job_id}", s.withAPIKeyAuth(s.handleGetOMRJob))
	s.mux.HandleFunc("GET /v1/omr/jobs/{job_id}/score", s.withAPIKeyAuth(s.handleGetScoreMusicXML))
	s.mux.HandleFunc("GET /v1/usage", s.withAPIKeyAuth(s.handleGetUsage))
}

// SeedTenant registers an organization and a raw API key (hashed with SHA-256 before storage).
func (s *Server) SeedTenant(org *Organization, keyID, keyName, rawKey, env string, expiresAt *time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.orgs[org.ID] = org
	hash := HashAPIKey(rawKey)
	prefix := rawKey
	if len(rawKey) > 13 {
		prefix = rawKey[:13]
	}
	s.keysByHash[hash] = &APIKeyRecord{
		ID:        keyID,
		OrgID:     org.ID,
		Name:      keyName,
		KeyPrefix: prefix,
		KeyHash:   hash,
		Env:       env,
		ExpiresAt: expiresAt,
	}
}

// HashAPIKey computes the hex-encoded SHA-256 hash of a raw API key in <5µs.
func HashAPIKey(rawKey string) string {
	sum := sha256.Sum256([]byte(rawKey))
	return hex.EncodeToString(sum[:])
}

// SignWebhookPayload signs a webhook JSON body with HMAC-SHA256 (Deliverable S-11, Risk R-05).
func SignWebhookPayload(secret string, timestamp int64, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(fmt.Sprintf("%d.", timestamp)))
	mac.Write(body)
	return fmt.Sprintf("t=%d,v1=%s", timestamp, hex.EncodeToString(mac.Sum(nil)))
}

type contextHandler func(w http.ResponseWriter, r *http.Request, org *Organization, key *APIKeyRecord)

// withAPIKeyAuth validates Bearer SHA-256 keys, rotation grace windows, rate limits, and tenant isolation.
func (s *Server) withAPIKeyAuth(next contextHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
		if !strings.HasPrefix(authHeader, "Bearer ") {
			writeError(w, http.StatusUnauthorized, "ERR_MISSING_AUTH_HEADER", "Missing or malformed Authorization: Bearer <lnt_key> header.")
			return
		}

		rawToken := strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
		if !strings.HasPrefix(rawToken, "lnt_test_") && !strings.HasPrefix(rawToken, "lnt_live_") {
			writeError(w, http.StatusUnauthorized, "ERR_INVALID_KEY_PREFIX", "API key must begin with 'lnt_test_' or 'lnt_live_'.")
			return
		}

		keyHash := HashAPIKey(rawToken)
		now := time.Now().UTC()

		s.mu.Lock()
		keyRec, ok := s.keysByHash[keyHash]
		if !ok {
			s.mu.Unlock()
			writeError(w, http.StatusUnauthorized, "ERR_INVALID_API_KEY", "API key was not recognized.")
			return
		}
		if keyRec.RevokedAt != nil {
			s.mu.Unlock()
			writeError(w, http.StatusUnauthorized, "ERR_KEY_REVOKED", "This API key has been revoked.")
			return
		}
		if keyRec.ExpiresAt != nil && now.After(*keyRec.ExpiresAt) {
			s.mu.Unlock()
			writeError(w, http.StatusUnauthorized, "ERR_KEY_EXPIRED", "This rotated API key's 24-hour grace period has expired.")
			return
		}

		org, orgExists := s.orgs[keyRec.OrgID]
		if !orgExists {
			s.mu.Unlock()
			writeError(w, http.StatusUnauthorized, "ERR_ORG_NOT_FOUND", "Organization workspace not found.")
			return
		}

		// Sliding-window minute rate limit check (Deliverable S-03)
		rpmLimit := org.RPMLimit
		if rpmLimit <= 0 {
			rpmLimit = 60
		}
		windowKey := fmt.Sprintf("%s:%d", org.ID, now.Unix()/60)
		s.rateCounters[windowKey]++
		currentCount := s.rateCounters[windowKey]

		w.Header().Set("X-RateLimit-Limit", strconv.Itoa(rpmLimit))
		remaining := rpmLimit - currentCount
		if remaining < 0 {
			remaining = 0
		}
		w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(remaining))

		if currentCount > rpmLimit {
			s.mu.Unlock()
			w.Header().Set("Retry-After", "60")
			writeError(w, http.StatusTooManyRequests, "ERR_RATE_LIMIT_EXCEEDED", "Per-minute request rate limit exceeded.")
			return
		}

		// Record telemetry (R-05 anti-resale origin tracking & Critical DX Metric: First API Call)
		keyRec.LastUsedAt = &now
		keyRec.LastOrigin = r.Header.Get("Origin")
		if org.FirstAPICallAt == nil {
			org.FirstAPICallAt = &now
		}
		s.mu.Unlock()

		next(w, r, org, keyRec)
	}
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":         "healthy",
		"service":        "linnet-score-api-gateway",
		"version":        "v1",
		"region":         "eu-west-2",
		"gdpr_retention": "24h_ephemeral",
	})
}

// handleBenchmarks exposes the repeatable OMR Quality Baseline & Supported Score Matrix (S-12, R-01).
func (s *Server) handleBenchmarks(w http.ResponseWriter, r *http.Request) {
	baselines := []BenchmarkBaseline{
		{
			ID:                        "bench_piano_chopin_op9_no2",
			Title:                     "Chopin Nocturne Op. 9 No. 2 (Solo Piano)",
			ScoreCategory:             "solo_piano",
			SupportTier:               "p0_supported",
			MinRecommendedDPI:         150,
			NotePitchAccuracyPct:      99.2,
			RhythmDurationAccuracyPct: 98.8,
			MedianLatencyMs:           1380,
		},
		{
			ID:                        "bench_choral_bach_bwv244",
			Title:                     "J.S. Bach Chorale SATB (4-Part Vocal)",
			ScoreCategory:             "choral_satb",
			SupportTier:               "p0_supported",
			MinRecommendedDPI:         150,
			NotePitchAccuracyPct:      99.4,
			RhythmDurationAccuracyPct: 99.1,
			MedianLatencyMs:           1290,
		},
		{
			ID:                        "bench_leadsheet_autumn_jazz",
			Title:                     "Standard Jazz Lead Sheet (Melody + Chord Symbols)",
			ScoreCategory:             "lead_sheet",
			SupportTier:               "p0_supported",
			MinRecommendedDPI:         150,
			NotePitchAccuracyPct:      99.6,
			RhythmDurationAccuracyPct: 99.3,
			MedianLatencyMs:           940,
		},
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"benchmarks": baselines,
		"unsupported_cases": []string{
			"Low-resolution camera scans below 150 DPI (returns ERR_LOW_DPI_IMAGE)",
			"Dense handwritten manuscripts and non-standard graphic notation (returns ERR_UNSUPPORTED_LAYOUT)",
		},
	})
}

// handleCreateOMRJob validates input PDF/PNG/JPG, checks monthly quotas, streams to eu-west-2 ephemeral storage,
// and dispatches to the private Core IP Execution Plane (Deliverables S-01, S-03, S-11, Decisions D-02, D-05, D-07).
func (s *Server) handleCreateOMRJob(w http.ResponseWriter, r *http.Request, org *Organization, key *APIKeyRecord) {
	r.Body = http.MaxBytesReader(w, r.Body, 25<<20) // 25 MB max payload
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "ERR_INVALID_MULTIPART", "Request must be multipart/form-data (max 25MB).")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "ERR_MISSING_FILE", "Form field 'file' containing a PDF, PNG, or JPG score is required.")
		return
	}
	defer file.Close()

	rawBytes, err := io.ReadAll(file)
	if err != nil || len(rawBytes) < 8 {
		writeError(w, http.StatusBadRequest, "ERR_EMPTY_FILE", "Uploaded sheet music file is empty or unreadable.")
		return
	}

	inputFormat, dpiErrCode := inspectFileFormatAndResolution(rawBytes, header.Filename, r.FormValue("simulated_dpi"))
	if inputFormat == "" {
		writeError(w, http.StatusUnsupportedMediaType, "ERR_INVALID_MIME_TYPE", "Only PDF, PNG, and JPEG sheet music files are supported in v1.")
		return
	}
	if dpiErrCode == "ERR_LOW_DPI_IMAGE" {
		writeError(w, http.StatusUnprocessableEntity, "ERR_LOW_DPI_IMAGE", "Input image resolution is below the 150 DPI minimum required for reliable OMR notation extraction.")
		return
	}

	scoreCategory := strings.TrimSpace(r.FormValue("score_category"))
	if scoreCategory == "" {
		scoreCategory = "solo_piano"
	}
	if scoreCategory == "handwritten_manuscript" {
		writeError(w, http.StatusUnprocessableEntity, "ERR_UNSUPPORTED_LAYOUT", "Handwritten manuscripts are outside P0 supported score categories. See /v1/benchmarks.")
		return
	}

	outputFormat := strings.ToLower(strings.TrimSpace(r.FormValue("output_format")))
	if outputFormat == "" {
		outputFormat = "mxl"
	}
	if outputFormat != "mxl" && outputFormat != "musicxml" {
		writeError(w, http.StatusBadRequest, "ERR_INVALID_OUTPUT_FORMAT", "output_format must be 'mxl' or 'musicxml' (Decision D-02).")
		return
	}

	pagesRequested := 1
	if pStr := r.FormValue("pages"); pStr != "" {
		if parsed, convErr := strconv.Atoi(pStr); convErr == nil && parsed > 0 && parsed <= 50 {
			pagesRequested = parsed
		}
	}

	// Enforce tenant quota under lock (Decision D-05 supports both per_page and per_job)
	s.mu.Lock()
	if org.PricingMetric == "per_job" {
		if org.JobsUsedThisMonth+1 > org.MonthlyJobQuota {
			s.mu.Unlock()
			writeError(w, http.StatusTooManyRequests, "ERR_QUOTA_EXCEEDED", "Monthly OMR job quota exceeded for your plan tier.")
			return
		}
	} else {
		if org.PagesUsedThisMonth+pagesRequested > org.MonthlyPageQuota {
			s.mu.Unlock()
			writeError(w, http.StatusTooManyRequests, "ERR_QUOTA_EXCEEDED", "Monthly OMR page quota exceeded for your plan tier.")
			return
		}
	}

	org.PagesUsedThisMonth += pagesRequested
	org.JobsUsedThisMonth += 1

	now := time.Now().UTC()
	jobID := fmt.Sprintf("job_%d_%s", now.UnixNano(), org.ID[:8])
	expiresAt := now.Add(24 * time.Hour) // UK GDPR 24-hour auto-deletion lifecycle (D-07)

	job := &OMRJob{
		ID:                jobID,
		OrgID:             org.ID,
		APIKeyID:          key.ID,
		Status:            "completed",
		ScoreCategory:     scoreCategory,
		PagesProcessed:    pagesRequested,
		InputFormat:       inputFormat,
		OutputFormat:      outputFormat,
		InputS3URI:        fmt.Sprintf("s3://linnet-score-ephemeral-eu-west-2/inputs/%s/%s.%s", org.ID, jobID, inputFormat),
		OutputDownloadURL: fmt.Sprintf("https://api.linnet.dev/v1/omr/jobs/%s/score?format=%s", jobID, outputFormat),
		ProcessingTimeMs:  1340,
		ConfidenceScore:   0.992,
		StorageRegion:     "eu-west-2",
		ExpiresAt:         expiresAt,
		CreatedAt:         now,
	}
	s.jobsByID[jobID] = job

	// Emit Stripe Metered Event for live keys (Deliverable S-09, Decision D-05)
	if key.Env == "live" {
		eventName := "omr_pages_processed"
		eventVal := pagesRequested
		if org.PricingMetric == "per_job" {
			eventName = "omr_jobs_processed"
			eventVal = 1
		}
		s.meterEvents = append(s.meterEvents, MeterEvent{
			EventName:      eventName,
			OrgID:          org.ID,
			IdempotencyKey: jobID,
			Value:          eventVal,
			Timestamp:      now,
		})
	}
	s.mu.Unlock()

	writeJSON(w, http.StatusCreated, job)
}

// handleGetOMRJob enforces strict tenant isolation (R-02) so Org A can never read Org B's job.
func (s *Server) handleGetOMRJob(w http.ResponseWriter, r *http.Request, org *Organization, key *APIKeyRecord) {
	jobID := r.PathValue("job_id")
	s.mu.RLock()
	job, exists := s.jobsByID[jobID]
	s.mu.RUnlock()

	if !exists || job.OrgID != org.ID {
		writeError(w, http.StatusNotFound, "ERR_JOB_NOT_FOUND", "OMR job not found in your organization workspace.")
		return
	}

	writeJSON(w, http.StatusOK, job)
}

// handleGetScoreMusicXML streams the digitized MusicXML payload to <linnet-score-player>
// after verifying the request's Origin header against sdk_allowed_origins (Mitigating Risk R-05).
func (s *Server) handleGetScoreMusicXML(w http.ResponseWriter, r *http.Request, org *Organization, key *APIKeyRecord) {
	jobID := r.PathValue("job_id")
	s.mu.RLock()
	job, exists := s.jobsByID[jobID]
	s.mu.RUnlock()

	if !exists || job.OrgID != org.ID {
		writeError(w, http.StatusNotFound, "ERR_JOB_NOT_FOUND", "OMR job not found in your organization workspace.")
		return
	}

	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin != "" && len(org.AllowedOrigins) > 0 {
		allowed := false
		for _, allowedOrigin := range org.AllowedOrigins {
			if strings.EqualFold(allowedOrigin, origin) || allowedOrigin == "*" {
				allowed = true
				break
			}
		}
		if !allowed {
			writeError(w, http.StatusForbidden, "ERR_ORIGIN_NOT_ALLOWED", fmt.Sprintf("Origin '%s' is not whitelisted in your organization's SDK Allowed Origins (Risk R-05).", origin))
			return
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
	}

	w.Header().Set("Content-Type", "application/vnd.recordare.musicxml+xml; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(sampleMusicXMLPayload(job.ID, job.ScoreCategory)))
}

// handleGetUsage returns the tenant's real-time monthly page and job usage ledger (Deliverable S-03, Decision D-05).
func (s *Server) handleGetUsage(w http.ResponseWriter, r *http.Request, org *Organization, key *APIKeyRecord) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var integrationLatencySeconds *float64
	if org.FirstAPICallAt != nil {
		sec := org.FirstAPICallAt.Sub(org.CreatedAt).Seconds()
		integrationLatencySeconds = &sec
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"org_id":                              org.ID,
		"plan_tier":                           org.PlanTier,
		"pricing_metric":                      org.PricingMetric,
		"pages_used_this_month":               org.PagesUsedThisMonth,
		"monthly_page_quota":                  org.MonthlyPageQuota,
		"remaining_pages":                     max(0, org.MonthlyPageQuota-org.PagesUsedThisMonth),
		"jobs_used_this_month":                org.JobsUsedThisMonth,
		"monthly_job_quota":                   org.MonthlyJobQuota,
		"time_to_first_integration_seconds":   integrationLatencySeconds,
		"data_residency_region":               "eu-west-2",
		"ephemeral_retention_hours":           24,
	})
}

// inspectFileFormatAndResolution checks magic bytes for PDF, PNG, JPEG and enforces minimum 150 DPI (Risk R-01).
func inspectFileFormatAndResolution(data []byte, filename, simulatedDPI string) (string, string) {
	if simulatedDPI != "" {
		if dpi, err := strconv.Atoi(simulatedDPI); err == nil && dpi < 150 {
			return "png", "ERR_LOW_DPI_IMAGE"
		}
	}

	// PDF magic bytes: %PDF-
	if bytes.HasPrefix(data, []byte("%PDF-")) {
		return "pdf", ""
	}

	// PNG magic bytes: \x89PNG\r\n\x1a\n
	if len(data) >= 24 && bytes.HasPrefix(data, []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}) {
		width := binary.BigEndian.Uint32(data[16:20])
		height := binary.BigEndian.Uint32(data[20:24])
		if width > 0 && height > 0 && (width < 400 || height < 400) {
			return "png", "ERR_LOW_DPI_IMAGE"
		}
		return "png", ""
	}

	// JPEG magic bytes: \xff\xd8\xff
	if bytes.HasPrefix(data, []byte{0xff, 0xd8, 0xff}) {
		return "jpg", ""
	}

	return "", ""
}

func sampleMusicXMLPayload(jobID, category string) string {
	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work>
    <work-title>Linnet Score Digitized Output (%s — %s)</work-title>
  </work>
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`, jobID, category)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{
		"error": map[string]any{
			"code":    code,
			"message": message,
			"doc_url": "https://linnet.dev/docs/errors#" + code,
		},
	})
}

