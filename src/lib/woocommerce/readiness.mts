import type { Environment } from "../config";

// Offline checks only. Never return input values, credentials, or a launch-ready claim.
export function wooReadiness(env: Environment) {
  const secretValid = (value: string | undefined) => !!value && value.length >= 32 && value.length <= 256 && value.trim() === value;
  const checks = [
    { name: "supported_application_environment", passed: ["local", "staging"].includes(env.APP_ENV ?? "") },
    { name: "nonproduction_database", passed: env.SUPABASE_ENVIRONMENT === "nonproduction" },
    { name: "expected_database", passed: env.NEXT_PUBLIC_SUPABASE_URL === "https://nwgdzzpcbqmfqujycpqk.supabase.co" },
    { name: "expected_store", passed: env.WOO_STORE_ORIGIN === "https://cu.onetoolz.com" },
    { name: "store_verification_attested", passed: env.WOO_STORE_VERIFIED === "true" },
    { name: "production_data_access_approved", passed: env.WOO_PRODUCTION_STORE_ACCESS_APPROVED === "true" },
    { name: "webhook_secret_format", passed: secretValid(env.WOO_WEBHOOK_SECRET) },
    { name: "worker_secret_format", passed: secretValid(env.WOO_WORKER_SECRET) },
    { name: "separate_worker_secret", passed: !!env.WOO_WORKER_SECRET && env.WOO_WORKER_SECRET !== env.WOO_WEBHOOK_SECRET },
    { name: "database_key_format", passed: (env.WOO_INGESTION_SUPABASE_SECRET_KEY ?? "").startsWith("sb_secret_") },
    { name: "woo_read_key_format", passed: /^ck_[a-f0-9]{40}$/.test(env.WOO_READ_CONSUMER_KEY ?? "") },
    { name: "woo_read_secret_format", passed: /^cs_[a-f0-9]{40}$/.test(env.WOO_READ_CONSUMER_SECRET ?? "") },
  ];
  return {
    storeEnvironment: "production", configurationChecksPassed: checks.every(check => check.passed),
    launchReadiness: "NOT_VERIFIED", checks,
    requestedSwitches: { ingestion: env.WOO_INGESTION_ENABLED === "true", worker: env.WOO_WORKER_ENABLED === "true", discovery: env.WOO_DISCOVERY_ENABLED === "true" },
    externalChecksRequired: ["database_migrations_and_concurrency", "read_only_key_permissions", "checkout_and_gateway_verification",
      "production_data_handling_approval", "receiver_deployment", "scheduler_and_monitoring", "live_acceptance"],
  };
}