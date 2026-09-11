# CRM provider configuration

`MondayCrmService` never accepts or stores a token value in configuration or
CRM records. At runtime its `SecretResolver` reads the token from the external
secret store. The deployment should grant access to these named secrets:

- `MONDAY_API_TOKEN` (required provider API token)
- `CRM_WEBHOOK_PATH_SECRET` (required high-entropy URL path secret)
- `CRM_SIGNING_SECRET` (optional Monday integration signing secret)

The names are references only; secret values must be provisioned in AWS Secrets
Manager (or the deployment's equivalent) and must not be committed, logged, or
placed in client bundles.
