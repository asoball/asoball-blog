output "atlas_allowlist_ipv4" { value = google_compute_address.egress.address }
output "cms_url" { value = google_cloud_run_v2_service.cms.uri }
output "media_bucket" { value = google_storage_bucket.private["media"].name }
output "snapshots_bucket" { value = google_storage_bucket.private["snapshots"].name }
output "github_wif_provider" { value = google_iam_workload_identity_pool_provider.github.name }
output "build_service_account" { value = google_service_account.build.email }
