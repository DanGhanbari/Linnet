package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"github.com/linnet-score/gateway/internal/gateway"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8180"
	}

	srv := gateway.NewServer()

	// Seed a local Sandbox Organization and API Key for immediate development testing
	demoOrg := &gateway.Organization{
		ID:               "org_uk_demo_01",
		Name:             "London Conservatoire Digital Lab",
		PlanTier:         "sandbox",
		PricingMetric:    "per_page",
		MonthlyPageQuota: 50,
		MonthlyJobQuota:  50,
		RPMLimit:         60,
		AllowedOrigins:   []string{"http://localhost:3100", "https://linnet.dev"},
		CreatedAt:        time.Now().UTC(),
	}
	demoRawKey := "lnt_test_DemoUkSandboxKey9a8b7c6d5e4f3g2h"
	srv.SeedTenant(demoOrg, "key_demo_01", "Sandbox Quickstart Key", demoRawKey, "sandbox", nil)

	log.Printf("[Linnet Score API Gateway v1] Listening on :%s (Region: eu-west-2 London)", port)
	log.Printf("[Quickstart Demo Key] Authorization: Bearer %s", demoRawKey)

	httpServer := &http.Server{
		Addr:              ":" + port,
		Handler:           srv,
		ReadHeaderTimeout: 5 * time.Second,
	}
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("gateway server failed: %v", err)
	}
}

