# AmazFlow access model

Authorization is enforced by the backend and tenant boundary, not merely by hidden buttons in the interface.

| Capability | Frontline user | Client operations admin | AmazFlow super admin |
|---|---:|---:|---:|
| Run assigned published workflows | Yes | Yes | Yes |
| View own runs | Yes | Yes | Yes |
| View all runs in client tenant | No | Yes | Yes |
| Decide client approvals | No | Yes | Yes |
| Assign users to client workflows | No | Yes | Yes |
| Edit or publish workflow definitions | No | No | Yes |
| Configure connectors and execution policy | No | No | Yes |
| Create/manage client tenants | No | No | Yes |
| Cross-client audit and administration | No | No | Yes |

AWS Cognito groups are `FRONTLINE`, `CLIENT_ADMIN`, and `SUPER_ADMIN`. Each client user carries a `custom:tenant_id` claim. The API rejects cross-tenant access even when a client knows another object's identifier.
