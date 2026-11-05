variable "project_id" {
  type        = string
  description = "Existing dedicated GCP test project. No project or billing account is created."
}
variable "region" {
  type    = string
  default = "asia-east1"
}
variable "name" {
  type    = string
  default = "asoball-blog-test"
}
variable "github_repository" {
  type        = string
  description = "Actual owner/repository, never a placeholder for apply."
  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "Use owner/repository."
  }
}
variable "cms_image" {
  type        = string
  description = "Immutable Artifact Registry image digest prepared after local UAT."
  validation {
    condition     = can(regex("@sha256:[a-f0-9]{64}$", var.cms_image))
    error_message = "Pin the CMS image by sha256 digest."
  }
}
variable "cms_url" {
  type        = string
  description = "Test CMS external URL, used for auth and same-origin validation."
}
variable "public_cms_login" {
  type    = bool
  default = false
}
variable "database_secret_version" {
  type    = string
  default = "1"
}
variable "payload_secret_version" {
  type    = string
  default = "1"
}
