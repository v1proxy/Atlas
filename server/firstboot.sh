#!/bin/sh
# Atlas server first boot: Tailscale, rclone, a firewall that lets nothing in from the internet (only the tailnet),
# then the Tailscale sign-in link on the console, so the owner can approve this server into the tailnet.
curl -fsSL https://tailscale.com/install.sh | sh
curl -fsSL https://rclone.org/install.sh | bash
ufw default deny incoming
ufw default allow outgoing
ufw allow in on tailscale0
ufw --force enable
setsid nohup tailscale up --hostname=atlas > /var/log/atlas-ts-up.log 2>&1 < /dev/null &
u=""
for i in $(seq 120); do
  u=$(grep -o 'https://login.tailscale.com/[^ ]*' /var/log/atlas-ts-up.log | head -1)
  [ -n "$u" ] && break
  sleep 2
done
printf '\nTAILSCALE SIGN-IN: %s\n\n' "$u" >> /etc/issue
printf '\n\n  TAILSCALE SIGN-IN: %s\n\n' "$u" > /dev/tty1
