output "public_ip" {
  description = "The server's public address"
  value       = aws_instance.server.public_ip
}

output "app_url" {
  description = "Where the app will be reachable"
  value       = "http://${aws_instance.server.public_ip}/"
}

output "ssh_login" {
  description = "Login target for ssh"
  value       = "ubuntu@${aws_instance.server.public_ip}"
}