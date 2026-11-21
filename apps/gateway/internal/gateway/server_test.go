package gateway_test

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/linnet-score/gateway/internal/gateway"
)

func createMultipartScoreRequest(t *testing.T, url, token, filename string, fileContent []byte, extraFields map[string]string) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)

	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		t.Fatalf("failed to create form file: %v", err)
	}
	if _, err := part.Write(fileContent); err != nil {
		t.Fatalf("failed to write file content: %v", err)
	}

	for k, v := range extraFields {
		_ = writer.WriteField(k, v)
	}
	_ = writer.Close()

	req := httptest.NewRequest(http.MethodPost, url, &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	return req
}

func TestPhase1CommercialAPICoreExitGate(t *testing.T) {
	srv := gateway.NewServer()

	now := time.Now().UTC().Add(-15 * time.Second)
	orgA := &gateway.Organization{
		ID:               "org_london_edtech_a",
		Name:             "London EdTech Ltd",
		PlanTier:         "sandbox",
		PricingMetric:    "per_page",
		MonthlyPageQuota: 3,
		MonthlyJobQuota:  3,
		RPMLimit:         10,
		AllowedOrigins:   []string{"https://app.londonedtech.co.uk"},
		CreatedAt:        now,
	}
	orgB := &gateway.Organization{
		ID:               "org_oxford_publisher_b",
		Name:             "Oxford Sheet Music Press",
		PlanTier:         "growth",
		PricingMetric:    "per_page",
		MonthlyPageQuota: 1000,
		MonthlyJobQuota:  1000,
		RPMLimit:         60,
		AllowedOrigins:   []string{"https://scores.oxfordpress.co.uk"},
		CreatedAt:        now,
	}

	rawKeyA := "lnt_test_OrgASandboxKey1234567890abcdefgh"
	rawKeyB := "lnt_live_OrgBLiveKey1234567890abcdefghijk"
	srv.SeedTenant(orgA, "key_a", "Org A Sandbox", rawKeyA, "sandbox", nil)
	srv.SeedTenant(orgB, "key_b", "Org B Live", rawKeyB, "live", nil)

	// 1. Reject unauthenticated call (Risk R-02)
	unauthReq := httptest.NewRequest(http.MethodGet, "/v1/usage", nil)
	unauthRec := httptest.NewRecorder()
	srv.ServeHTTP(unauthRec, unauthReq)
	if unauthRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for unauthenticated request, got %d", unauthRec.Code)
	}

	// 2. Reject low-DPI image scan with structured ERR_LOW_DPI_IMAGE (Deliverable S-11, Risk R-01)
	pdfBytes := []byte("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n")
	lowDpiReq := createMultipartScoreRequest(t, "/v1/omr/jobs", rawKeyA, "blurry.png", pdfBytes, map[string]string{
		"simulated_dpi": "96",
	})
	lowDpiRec := httptest.NewRecorder()
	srv.ServeHTTP(lowDpiRec, lowDpiReq)
	if lowDpiRec.Code != http.StatusUnprocessableEntity || !strings.Contains(lowDpiRec.Body.String(), "ERR_LOW_DPI_IMAGE") {
		t.Fatalf("expected 422 ERR_LOW_DPI_IMAGE, got %d: %s", lowDpiRec.Code, lowDpiRec.Body.String())
	}

	// 3. Submit valid PDF score for OMR digitization (Deliverable S-01, D-02, D-07)
	jobReq := createMultipartScoreRequest(t, "/v1/omr/jobs", rawKeyA, "chopin-op9.pdf", pdfBytes, map[string]string{
		"score_category": "solo_piano",
		"output_format":  "mxl",
		"pages":          "2",
	})
	jobRec := httptest.NewRecorder()
	srv.ServeHTTP(jobRec, jobReq)
	if jobRec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", jobRec.Code, jobRec.Body.String())
	}

	var createdJob gateway.OMRJob
	if err := json.Unmarshal(jobRec.Body.Bytes(), &createdJob); err != nil {
		t.Fatalf("failed to decode job response: %v", err)
	}
	if createdJob.StorageRegion != "eu-west-2" || createdJob.OutputFormat != "mxl" || createdJob.PagesProcessed != 2 {
		t.Fatalf("unexpected job metadata: %+v", createdJob)
	}

	// 4. Verify Tenant Isolation (Deliverable S-02, Risk R-02): Org B cannot fetch Org A's job
	crossTenantReq := httptest.NewRequest(http.MethodGet, "/v1/omr/jobs/"+createdJob.ID, nil)
	crossTenantReq.Header.Set("Authorization", "Bearer "+rawKeyB)
	crossTenantRec := httptest.NewRecorder()
	srv.ServeHTTP(crossTenantRec, crossTenantReq)
	if crossTenantRec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 Not Found on cross-tenant job access, got %d", crossTenantRec.Code)
	}

	// 5. Verify CORS Allowed Origins Lock on /score endpoint (Mitigating Risk R-05)
	unauthOriginReq := httptest.NewRequest(http.MethodGet, "/v1/omr/jobs/"+createdJob.ID+"/score", nil)
	unauthOriginReq.Header.Set("Authorization", "Bearer "+rawKeyA)
	unauthOriginReq.Header.Set("Origin", "https://pirate-reseller.example.com")
	unauthOriginRec := httptest.NewRecorder()
	srv.ServeHTTP(unauthOriginRec, unauthOriginReq)
	if unauthOriginRec.Code != http.StatusForbidden || !strings.Contains(unauthOriginRec.Body.String(), "ERR_ORIGIN_NOT_ALLOWED") {
		t.Fatalf("expected 403 ERR_ORIGIN_NOT_ALLOWED for unauthorized Origin, got %d", unauthOriginRec.Code)
	}

	validOriginReq := httptest.NewRequest(http.MethodGet, "/v1/omr/jobs/"+createdJob.ID+"/score", nil)
	validOriginReq.Header.Set("Authorization", "Bearer "+rawKeyA)
	validOriginReq.Header.Set("Origin", "https://app.londonedtech.co.uk")
	validOriginRec := httptest.NewRecorder()
	srv.ServeHTTP(validOriginRec, validOriginReq)
	if validOriginRec.Code != http.StatusOK || !strings.Contains(validOriginRec.Body.String(), "<score-partwise") {
		t.Fatalf("expected 200 MusicXML payload for whitelisted origin, got %d", validOriginRec.Code)
	}

	// 6. Verify Quota Enforcement (Deliverable S-03): Org A has 3 pages quota, used 2, requesting 2 more -> 429 ERR_QUOTA_EXCEEDED
	overQuotaReq := createMultipartScoreRequest(t, "/v1/omr/jobs", rawKeyA, "sonata.pdf", pdfBytes, map[string]string{
		"pages": "2",
	})
	overQuotaRec := httptest.NewRecorder()
	srv.ServeHTTP(overQuotaRec, overQuotaReq)
	if overQuotaRec.Code != http.StatusTooManyRequests || !strings.Contains(overQuotaRec.Body.String(), "ERR_QUOTA_EXCEEDED") {
		t.Fatalf("expected 429 ERR_QUOTA_EXCEEDED, got %d: %s", overQuotaRec.Code, overQuotaRec.Body.String())
	}

	// 7. Verify Charter Critical DX Metric (Time to First Successful Integration) in /v1/usage
	usageReq := httptest.NewRequest(http.MethodGet, "/v1/usage", nil)
	usageReq.Header.Set("Authorization", "Bearer "+rawKeyA)
	usageRec := httptest.NewRecorder()
	srv.ServeHTTP(usageRec, usageReq)
	if usageRec.Code != http.StatusOK || !strings.Contains(usageRec.Body.String(), "time_to_first_integration_seconds") {
		t.Fatalf("expected 200 usage response with DX integration metric, got %d: %s", usageRec.Code, usageRec.Body.String())
	}
}

