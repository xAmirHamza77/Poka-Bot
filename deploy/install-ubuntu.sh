#!/usr/bin/env bash
set -euo pipefail
if [ "${EUID}" -ne 0 ]; then echo 'Run as root.' >&2; exit 1; fi
poka_host="${1:?Usage: install-ubuntu.sh HOST [HTTPS_PORT]}"
poka_port="${2:-8443}"
[[ "$poka_host" =~ ^[a-zA-Z0-9.-]+$ ]] && [[ "$poka_port" =~ ^[0-9]+$ ]] || { echo 'Invalid host or port.' >&2; exit 1; }
[ -d /opt/poka/server/app ] && [ -d /opt/poka/ui ] || { echo 'Upload server, ui and deploy folders to /opt/poka first.' >&2; exit 1; }
# Existing installations must be updated explicitly, preserving credentials and backups.
[ ! -e /etc/poka/server.env ] || { echo 'Already installed. Follow the upgrade instructions.' >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y python3-venv curl ca-certificates
id poka >/dev/null 2>&1 || useradd --system --home /var/lib/poka --shell /usr/sbin/nologin poka
install -d -m 755 /opt/poka/bin
install -d -m 700 -o poka -g poka /var/lib/poka /var/lib/poka/data /var/lib/poka/workspace /var/lib/poka/backups /var/lib/poka/caddy
install -d -m 700 /etc/poka
python3 -m venv /opt/poka/venv
/opt/poka/venv/bin/pip install -r /opt/poka/server/requirements.txt
poka_arch="$(dpkg --print-architecture)"
case "$poka_arch" in amd64|arm64) ;; *) echo 'Unsupported architecture.' >&2; exit 1;; esac
poka_temp="$(mktemp -d)"
trap 'rm -rf "$poka_temp"' EXIT
cd "$poka_temp"
curl -fsSLO "https://github.com/caddyserver/caddy/releases/download/v2.11.4/caddy_2.11.4_linux_${poka_arch}.tar.gz"
curl -fsSLO https://github.com/caddyserver/caddy/releases/download/v2.11.4/caddy_2.11.4_checksums.txt
awk -v artifact="caddy_2.11.4_linux_${poka_arch}.tar.gz" '$2==artifact' caddy_2.11.4_checksums.txt | sha512sum --check --status
tar -xzf "caddy_2.11.4_linux_${poka_arch}.tar.gz" -C /opt/poka/bin caddy
sed "s/YOUR_HOST/${poka_host}/; s/:8443/:${poka_port}/" /opt/poka/deploy/server.env.example > /etc/poka/server.env
printf 'POKA_HOST=%s\nPOKA_HTTPS_PORT=%s\n' "$poka_host" "$poka_port" > /etc/poka/web.env
chmod 600 /etc/poka/*.env
cp /opt/poka/deploy/poka*.service /opt/poka/deploy/poka-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now poka.service poka-web.service poka-backup.timer
echo "Poka is starting at https://${poka_host}:${poka_port}/app/"
echo 'Owner token: /var/lib/poka/data/.auth-token (retrieve privately).'
