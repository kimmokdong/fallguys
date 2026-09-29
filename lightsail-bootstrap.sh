#!/bin/sh
# Ubuntu Lightsail 인스턴스의 첫 시작 때 실행합니다. (24.04에서 확인, amd64·arm64 공용)
# Lightsail Launch script가 앞에 /bin/sh 코드를 붙이므로 POSIX 문법과 LF 줄바꿈을 유지합니다.
set -eu
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl unattended-upgrades
# 보안 업데이트는 매일 자동으로 설치합니다.
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
# 1GB 메모리 서버에서 이미지 빌드(npm ci)가 메모리 부족으로 멈추지 않도록 1GB 스왑을 둡니다.
if [ -z "$(swapon --show --noheadings)" ]; then
  fallocate -l 1G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=1024
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
ARCH=$(dpkg --print-architecture)
CODENAME=$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $CODENAME
Components: stable
Architectures: $ARCH
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
install -d -m 0755 /opt/camp-jelly
touch /opt/camp-jelly/bootstrap-ready
