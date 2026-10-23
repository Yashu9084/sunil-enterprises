#!/bin/bash
set -euo pipefail
umask 077
cd /opt/sunil-enterprises
systemctl enable --now docker
# Compose is copied from Docker's official image; Docker verifies image digests.
mkdir -p /usr/local/lib/docker/cli-plugins
docker create --name sunil-compose-installer docker/compose-bin:2.39.4 >/dev/null
docker cp sunil-compose-installer:/docker-compose /usr/local/lib/docker/cli-plugins/docker-compose
docker rm sunil-compose-installer >/dev/null
chmod 755 /usr/local/lib/docker/cli-plugins/docker-compose
# Match only the dedicated EBS volume's NVMe serial. Never format an arbitrary disk.
volume_serial="${DATA_VOLUME_ID//-/}"
device=''
for attempt in $(seq 1 120); do
  while read -r disk serial; do
    if [[ "$serial" == "$volume_serial" ]]; then device="/dev/$disk"; break; fi
  done < <(lsblk -d -n -o NAME,SERIAL)
  [[ -n "$device" ]] && break
  sleep 5
done
[[ -b "$device" ]] || { echo 'Dedicated EBS volume was not attached.' >&2; exit 1; }
if ! blkid "$device" >/dev/null; then
  # An empty volume alone may be initialized; an existing filesystem is preserved.
  [[ -z "$(wipefs --noheadings --output TYPE "$device")" ]] || exit 1
  mkfs.ext4 "$device"
fi
mkdir -p /var/lib/sunil
uuid="$(blkid -s UUID -o value "$device")"
if ! findmnt /var/lib/sunil >/dev/null; then mount "$device" /var/lib/sunil; fi
if ! grep -q "UUID=$uuid " /etc/fstab; then echo "UUID=$uuid /var/lib/sunil ext4 defaults,nofail 0 2" >> /etc/fstab; fi
mkdir -p /var/lib/sunil/{data,caddy-data,caddy-config}
chown 1000:1000 /var/lib/sunil/data
chmod 700 /var/lib/sunil/data
setup_token="$(aws secretsmanager get-secret-value --secret-id "$SETUP_SECRET" --query SecretString --output text)"
backup_passphrase="$(aws secretsmanager get-secret-value --secret-id "$BACKUP_SECRET" --query SecretString --output text)"
printf 'SETUP_TOKEN=%s\nBACKUP_PASSPHRASE=%s\nAPP_DOMAIN=%s\n' "$setup_token" "$backup_passphrase" "$APP_DOMAIN" > .env
chmod 600 .env
unset setup_token backup_passphrase
cat > compose.aws.yaml <<'YAML'
volumes:
  shop_data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /var/lib/sunil/data
  caddy_data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /var/lib/sunil/caddy-data
  caddy_config:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /var/lib/sunil/caddy-config
YAML
# Public IP certificates require an explicit ACME issuer and short-lived profile.
cat > Caddyfile <<'CADDY'
https://{$APP_DOMAIN} {
  tls {
    issuer acme {
      dir https://acme-v02.api.letsencrypt.org/directory
      profile shortlived
    }
  }
  encode zstd gzip
  reverse_proxy app:3000
}
CADDY
docker compose -f compose.yaml -f compose.aws.yaml build
docker compose -f compose.yaml -f compose.aws.yaml --profile public up -d
for attempt in $(seq 1 120); do
  if curl --fail --silent http://127.0.0.1:3000/api/status >/dev/null; then break; fi
  sleep 5
done
curl --fail --silent http://127.0.0.1:3000/api/status >/dev/null
# Keep encrypted off-instance copies in a private, versioned S3 bucket.
cat > /usr/local/sbin/sunil-backup <<SCRIPT
#!/bin/bash
set -euo pipefail
umask 077
cd /opt/sunil-enterprises
mkdir -p /var/lib/sunil/data/backups
chown 1000:1000 /var/lib/sunil/data/backups
name="shop-\$(date -u +%Y%m%dT%H%M%SZ).skbackup"
docker compose -f compose.yaml -f compose.aws.yaml exec -T app node scripts/backup.mjs create "/app/data/backups/\$name"
aws s3 cp "/var/lib/sunil/data/backups/\$name" "s3://$DEPLOY_BUCKET/backups/\$name" --region "$AWS_DEFAULT_REGION" --sse AES256 --only-show-errors
SCRIPT
chmod 700 /usr/local/sbin/sunil-backup
cat > /etc/systemd/system/sunil-backup.service <<'UNIT'
[Unit]
Description=Encrypted Sunil ledger backup to private S3
Requires=docker.service
After=docker.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/sunil-backup
UNIT
cat > /etc/systemd/system/sunil-backup.timer <<'UNIT'
[Unit]
Description=Daily encrypted Sunil ledger backup
[Timer]
OnCalendar=*-*-* 21:00:00 UTC
Persistent=true
RandomizedDelaySec=300
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now sunil-backup.timer
/usr/local/sbin/sunil-backup
