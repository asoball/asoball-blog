locals {
  apis = toset(["run.googleapis.com", "compute.googleapis.com", "storage.googleapis.com", "artifactregistry.googleapis.com", "secretmanager.googleapis.com", "cloudbuild.googleapis.com", "iam.googleapis.com", "iamcredentials.googleapis.com", "sts.googleapis.com", "firebasehosting.googleapis.com"])
}
resource "google_project_service" "api" {
  for_each           = local.apis
  service            = each.value
  disable_on_destroy = false
}
resource "google_compute_network" "cms" {
  name                    = "${var.name}-vpc"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.api]
}
resource "google_compute_subnetwork" "cms" {
  name                     = "${var.name}-egress"
  ip_cidr_range            = "10.80.0.0/24"
  region                   = var.region
  network                  = google_compute_network.cms.id
  private_ip_google_access = true
}
resource "google_compute_address" "egress" {
  name   = "${var.name}-egress"
  region = var.region
  lifecycle { create_before_destroy = true }
}
resource "google_compute_router" "cms" {
  name    = "${var.name}-router"
  region  = var.region
  network = google_compute_network.cms.id
}
resource "google_compute_router_nat" "cms" {
  name                               = "${var.name}-nat"
  router                             = google_compute_router.cms.name
  region                             = var.region
  nat_ip_allocate_option             = "MANUAL_ONLY"
  nat_ips                            = [google_compute_address.egress.self_link]
  source_subnetwork_ip_ranges_to_nat = "LIST_OF_SUBNETWORKS"
  min_ports_per_vm                   = 64
  endpoint_types                     = ["ENDPOINT_TYPE_VM"]
  subnetwork {
    name                    = google_compute_subnetwork.cms.id
    source_ip_ranges_to_nat = ["ALL_IP_RANGES"]
  }
  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}
resource "google_storage_bucket" "private" {
  for_each                    = toset(["media", "snapshots", "candidates"])
  name                        = "${var.project_id}-${var.name}-${each.key}"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  versioning { enabled = true }
}
resource "google_artifact_registry_repository" "cms" {
  location      = var.region
  repository_id = "${var.name}-cms"
  format        = "DOCKER"
  depends_on    = [google_project_service.api]
}
resource "google_service_account" "cms" {
  account_id   = "${var.name}-cms"
  display_name = "Blog CMS runtime"
}
resource "google_service_account" "build" {
  account_id   = "${var.name}-build"
  display_name = "Blog test build/deploy identity"
}
resource "google_secret_manager_secret" "cms" {
  for_each  = toset(["database-uri", "payload-secret"])
  secret_id = "${var.name}-${each.key}"
  replication {
    auto {}
  }
  depends_on = [google_project_service.api]
}
# Secret values are intentionally not Terraform variables or managed versions.
resource "google_secret_manager_secret_iam_member" "cms" {
  for_each  = google_secret_manager_secret.cms
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cms.email}"
}
resource "google_storage_bucket_iam_member" "cms_media" {
  bucket = google_storage_bucket.private["media"].name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.cms.email}"
}
resource "google_storage_bucket_iam_member" "cms_snapshots" {
  bucket = google_storage_bucket.private["snapshots"].name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.cms.email}"
}
resource "google_storage_bucket_iam_member" "build_snapshots" {
  bucket = google_storage_bucket.private["snapshots"].name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.build.email}"
}
resource "google_storage_bucket_iam_member" "build_candidates" {
  bucket = google_storage_bucket.private["candidates"].name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.build.email}"
}
resource "google_project_iam_member" "build_hosting" {
  project = var.project_id
  role    = "roles/firebasehosting.admin"
  member  = "serviceAccount:${google_service_account.build.email}"
}
resource "google_artifact_registry_repository_iam_member" "build" {
  location   = var.region
  repository = google_artifact_registry_repository.cms.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.build.email}"
}
resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "${var.name}-github"
  depends_on                = [google_project_service.api]
}
resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
  }
  attribute_condition = "assertion.repository == '${var.github_repository}' && assertion.ref == 'refs/heads/main'"
  oidc { issuer_uri = "https://token.actions.githubusercontent.com" }
}
resource "google_service_account_iam_member" "github" {
  service_account_id = google_service_account.build.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}
resource "google_cloud_run_v2_service" "cms" {
  name                = "${var.name}-cms"
  location            = var.region
  deletion_protection = true
  ingress             = "INGRESS_TRAFFIC_ALL"
  template {
    service_account                  = google_service_account.cms.email
    max_instance_request_concurrency = 10
    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }
    vpc_access {
      egress = "ALL_TRAFFIC"
      network_interfaces {
        network    = google_compute_network.cms.id
        subnetwork = google_compute_subnetwork.cms.id
      }
    }
    containers {
      image = var.cms_image
      ports { container_port = 3000 }
      resources { limits = { cpu = "1", memory = "1Gi" } }
      env {
        name  = "CMS_URL"
        value = var.cms_url
      }
      env {
        name  = "MEDIA_STORAGE"
        value = "gcs"
      }
      env {
        name  = "GCS_BUCKET"
        value = google_storage_bucket.private["media"].name
      }
      env {
        name = "DATABASE_URI"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.cms["database-uri"].secret_id
            version = var.database_secret_version
          }
        }
      }
      env {
        name = "PAYLOAD_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.cms["payload-secret"].secret_id
            version = var.payload_secret_version
          }
        }
      }
      startup_probe {
        http_get { path = "/api/health" }
        initial_delay_seconds = 5
        period_seconds        = 5
        failure_threshold     = 24
      }
    }
  }
  depends_on = [google_project_service.api, google_secret_manager_secret_iam_member.cms]
}
resource "google_cloud_run_v2_service_iam_member" "public_login" {
  count    = var.public_cms_login ? 1 : 0
  location = var.region
  name     = google_cloud_run_v2_service.cms.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
