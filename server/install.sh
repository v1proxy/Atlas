#!/bin/bash
# install.sh: puts Atlas on an Ubuntu server (24.04) in server mode. Run from the Atlas folder:
#   sudo bash server/install.sh
# Needs Tailscale signed in (the first-boot script in server/cloud-init.yaml does that) and, beside the code,
# atlas.config.json with "mode": "cloud" (start from atlas.server.example.json) and rclone.conf.
# Running it again updates the code and keeps the index, devices and state.
set -euo pipefail
SRC=$(cd "$(dirname "$0")/.." && pwd)
APP=/opt/atlas/app

id atlas >/dev/null 2>&1 || useradd --system --home /opt/atlas --create-home --shell /usr/sbin/nologin atlas
mkdir -p "$APP"
if [ "$SRC" != "$APP" ]; then
  # code only: the index, devices, pairing codes and state already on the server stay as they are
  (cd "$SRC" && tar cf - --exclude=.git --exclude=tests --exclude=docs --exclude=index.db --exclude=devices.json \
     --exclude=pairs.json --exclude=local.key --exclude=state --exclude=cache .) | (cd "$APP" && tar xf -)
fi
command -v rclone >/dev/null || (curl -fsSL https://rclone.org/install.sh | bash)
python3 -m venv /opt/atlas/venv
/opt/atlas/venv/bin/pip install -q --upgrade pip
/opt/atlas/venv/bin/pip install -q -r "$APP/requirements-server.txt"
chown -R atlas:atlas /opt/atlas
chmod 700 /opt/atlas
for f in atlas.config.json rclone.conf; do [ -f "$APP/$f" ] && chmod 600 "$APP/$f"; done

install -m 644 "$APP/server/atlas.service" /etc/systemd/system/atlas.service
systemctl daemon-reload
systemctl enable atlas >/dev/null
systemctl restart atlas

# The only way in: HTTPS inside the tailnet. Nothing listens on the public address.
tailscale serve --bg 8765 >/dev/null
ufw status | grep -q "Status: active" || { ufw default deny incoming; ufw default allow outgoing; ufw allow in on tailscale0; ufw --force enable; }
systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true
echo "Atlas is running: https://$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')"
echo "Pair a phone:     sudo -u atlas /opt/atlas/venv/bin/python /opt/atlas/app/atlas_service.py --pair"
