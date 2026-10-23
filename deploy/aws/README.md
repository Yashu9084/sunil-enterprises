# AWS deployment using an Elastic IP

Status: prepared infrastructure, not a deployed service. No domain purchase is required.

Use a securely configured AWS SDK credential profile or credential binding in the execution environment. Never put AWS keys, setup tokens, or backup passphrases in chat or Git. Default region: Mumbai (`ap-south-1`). The deploying identity needs CloudFormation, EC2/VPC, IAM role creation/passing, S3, SSM parameter reads, and Secrets Manager permissions.

```sh
python3 -m venv /tmp/sunil-aws-venv
/tmp/sunil-aws-venv/bin/pip install -r deploy/aws/requirements.txt
/tmp/sunil-aws-venv/bin/python deploy/aws/deploy.py --region ap-south-1
```

Run from a reviewed, committed checkout: the release contains Git-tracked files. This command creates a new stack, not an update. It incurs ongoing AWS charges for EC2 (default t3.small), encrypted EBS, public IPv4, Secrets Manager, S3 storage/requests and network traffic. This is a single-server deployment with downtime during host failures or updates.

The stack creates a dedicated VPC, exposes only ports 80/443, uses Systems Manager for administration (no SSH), and assigns an Elastic IP. Caddy requests a trusted IP certificate from Let's Encrypt using the `shortlived` ACME profile and automatically renews it. Issuance and external HTTPS must be verified on the actual AWS host before treating deployment as successful; an HTTP-only or self-signed endpoint is not sufficient for this app. Public ACME access cannot be verified from the current execution network.

CloudFormation completion does not mean the app is ready. Use AWS Systems Manager Session Manager on the output instance. Inspect `/var/log/cloud-init-output.log`, then run `cd /opt/sunil-enterprises && docker compose -f compose.yaml -f compose.aws.yaml --profile public ps`. Check the output HTTPS URL from an external browser, its trusted certificate, `/api/status`, login protection, and installation on the shop phone.

Retrieve the first-owner setup token privately from the output Secrets Manager ARN in your AWS console. Complete owner setup over verified HTTPS. Keep the backup passphrase from its separate secret in a secure recovery location. Neither value is printed by the deploy command. Do not share the setup token publicly.

SQLite, signed evidence and Caddy state use a dedicated encrypted EBS volume retained on stack deletion/replacement. Daily encrypted database backups run around 02:30 India time and upload to a private versioned S3 bucket. After owner setup, run `/usr/local/sbin/sunil-backup`; check `systemctl status sunil-backup.timer` and test restoration with the recovery guide before entering live accounts. The initial empty-shop backup does not replace a backup after owner setup.

Before any update, make and verify a backup. Do not rerun this create-only script as an update mechanism, format the retained volume, or run Compose with `down -v`. For recovery follow `docs/OPERATIONS.md`; retain the S3 bucket, EBS volume and backup passphrase. Retained resources continue to incur charges after stack deletion. Monitor disk usage, backup failures and HTTPS renewal. Local and S3 backup retention requires an operator policy; no automatic deletion is configured.
