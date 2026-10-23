# Deployment preparation — not yet published

The app is prepared for one shop on one Node 24+ process with local persistent SQLite storage. The supplied Compose setup binds the app to **127.0.0.1:3000**; its public TLS proxy is opt-in. No deployment has been performed.

## Choose and configure the host

Use a maintained Linux host with Docker/Compose, durable disk, a domain you control, and a backup destination separate from the host. All phones must reach this one service. Do not use ephemeral filesystem-only/serverless deployments, horizontally scaled replicas, or a network-shared SQLite directory.

Provide `SETUP_TOKEN` as a long random private deployment secret. Provide `BACKUP_PASSPHRASE` separately for automation if scheduled backups will run inside the container; the interactive UI can use a per-backup passphrase instead. `APP_DOMAIN` should be the owned domain before enabling Caddy. Do not commit actual values or put them in shell history. `.env.example` documents names only. The Node app reads process environment; Compose reads its `.env` interpolation file.

## Build and initialize privately

```sh
docker compose build
docker compose up -d app
```

Initialize the owner through an SSH tunnel/private connection using the private setup token, or create it with `scripts/admin.mjs` before starting the service. Production cookies require HTTPS; do not weaken their Secure setting for a public HTTP service. The app remains local to the host until the public proxy is explicitly enabled. The SQLite data is stored in the `shop_data` volume and survives container replacement; **do not use `down -v` on real data**.

The image runs as a non-root user and has a health check; Compose drops Linux capabilities. `TRUST_PROXY=1` is valid for the included single Caddy hop. Leave it at 0 when serving directly and adjust deliberately for a different trusted proxy chain.

In proxy-restricted build environments, Dockerfile supports optional BuildKit secrets named `https_proxy`, `http_proxy` and `ca`. Mount the existing trusted proxy configuration/CA through those secrets; they are used only during installation and are not baked into the image. Preserve TLS and package integrity checks. If the existing proxy hostname cannot resolve inside BuildKit, supply its verified address with `--add-host` for that build; keep the trusted proxy and CA intact. Ordinary hosts do not need those build secrets.

## Public activation — later, with authorization

After DNS, real-device acceptance, backups and owner setup are complete:

```sh
docker compose --profile public up -d
```

Caddy listens on 80/443 and obtains the domain certificate. This is the step that exposes the service; it has not been run. Confirm firewall rules, TLS renewal, persistent storage, health checks and disk monitoring on the chosen host.

## Acceptance before real books

- Have the father and one staff member create, sign, share and find an estimate on their actual phones.
- Verify a direct customer-to-supplier payment on both accounts; test a partial payment and GST/non-GST split.
- Print/open the signed packet received through WhatsApp and confirm that the customer accepts the digital-signature workflow.
- Check a return, credit/refund and wrong-payment reversal with the shop's accountant.
- Have the accountant confirm opening balances, GST rates and the separate statutory invoice process. The supplied app produces estimates, not GST tax invoices or GST returns.
- Authenticate an encrypted backup and restore it into a separate instance; verify balances and signatures.
- Configure daily off-server encrypted backups, retention and a recovery owner.
- Confirm staff disabling revokes access and keep recovery credentials privately.

Automated tests cover the software workflows; they cannot establish customer acceptance, legal tax treatment or that future hosting/backups are operating correctly.

To verify a built image locally without publishing any ports, tag it `sunil-enterprises:local` and run `npm run test:container`. The test uses an isolated container network and disposable volume, verifies a non-root runtime and persistence across container replacement, then removes its test resources.
