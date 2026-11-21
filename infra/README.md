# Deployment notes

No Azure resources are provisioned by this repository. Do not use the SQLite container as a production database. It is intentionally single-instance and local-only; migrate to managed PostgreSQL and update the database adapter, migrations, backup/restore, secrets, and multi-instance tests before public deployment.

## Azure Container Apps (first deployment target)

After the production database migration and security review:

1. Build and push the root `Dockerfile` to a private Azure Container Registry.
2. Create an Azure Container Apps environment and app with ingress enabled on port 3000.
3. Configure `APP_ORIGIN` to the final HTTPS app URL and supply `SESSION_SECRET` using Container Apps secret references. Add Anthropic/Stripe test credentials only when explicitly testing their integrations.
4. Configure min/max replicas to exactly one while this application still uses SQLite. A restart can lose filesystem data unless a durable supported volume is configured. Do not advertise durable subscriptions or learner progress on ephemeral storage.
5. Add managed PostgreSQL and a real migration/connection-pool adapter before increasing replicas or treating progress as production-durable. Configure health probe `/api/health`, TLS ingress, logging, backups, alerts, and restore tests.

No ARM/Bicep template is supplied because provisioning with the current SQLite adapter would imply an unsupported durability guarantee. This checklist is a deployment template, not an applied configuration.

## Kubernetes / AKS example

`k8s/` contains a single-replica Deployment, Service, PVC, and placeholder Secret. It is illustrative and not validated against a live cluster. Change `IMAGE_PLACEHOLDER`, configure actual secrets out of band, verify the storage class and backup policy, and retain one replica until migrated to PostgreSQL. Never put real credentials in manifests or source control.
