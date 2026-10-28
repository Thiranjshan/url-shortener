# The default network that every AWS account starts with
data "aws_vpc" "default" {
  default = true
}

# The newest official Ubuntu 24.04 image from Canonical
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# public SSH key
resource "aws_key_pair" "this" {
  key_name   = "url-shortener-aws"
  public_key = file(pathexpand(var.public_key_path))
}

# The firewall: SSH from one address, web traffic from anywhere
resource "aws_security_group" "web" {
  name        = "url-shortener-sg"
  description = "SSH from one address, HTTP from anywhere"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "SSH from my address only"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.ssh_allowed_cidr]
  }

  ingress {
    description = "HTTP from anywhere"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "All outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# The server itself
resource "aws_instance" "server" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  key_name                    = aws_key_pair.this.key_name
  vpc_security_group_ids      = [aws_security_group.web.id]
  associate_public_ip_address = true

  # Runs once on first boot; the replace() guards against Windows line endings
  user_data = replace(
    templatefile("${path.module}/user_data.sh.tftpl", {
      repo_url = var.repo_url
      git_ref  = var.git_ref
    }),
    "\r\n",
    "\n"
  )
  user_data_replace_on_change = true

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required" # IMDSv2 only
  }

  root_block_device {
    volume_size = var.root_volume_gb
    volume_type = "gp3"
  }

  tags = {
    Name = "url-shortener"
  }
}