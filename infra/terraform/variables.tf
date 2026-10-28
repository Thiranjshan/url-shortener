variable "region" {
  description = "AWS region tho deploy"
  type        = string
  default     = "ap-southeast-2"
}

variable "instance_type" {
  description = "EC2 instance type (x86, at least 4 GiB of memory, free plan eligible)"
  type        = string
}

variable "ssh_allowed_cidr" {
  description = "The only address allowed to SSH in, e.g. 203.0.113.10/32"
  type        = string

  validation {
    condition     = can(cidrsubnet(var.ssh_allowed_cidr, 0, 0))
    error_message = "Invalid CIDR block for SSH allowed IP"
  }
}

variable "public_key_path" {
  description = "Path to the SSh public key to install on the server"
  type        = string
  default     = "~/.ssh/url-shortener-aws.pub"
}

variable "root_volume_gb" {
  description = "Size of the server's disk in GB"
  type        = number
  default     = 20
}

variable "repo_url" {
  description = "Git repository the server clones to deploy the app"
  type        = string
  default     = "https://github.com/Thiranjshan/url-shortener.git"
}

variable "git_ref" {
  description = "Branch or tag of the repository to deploy"
  type        = string
  default     = "main"
}