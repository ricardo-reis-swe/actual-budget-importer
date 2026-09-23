<p align="center">
  <img src="public/actual-budget-importer-icon.svg" width="128" alt="Actual Budget Importer icon">
</p>

# Actual Budget Importer

Actual Budget Importer turns ActivoBank, WiZink, and POSB eSavings PDF statements into
reviewable transactions before you publish them to Actual Budget. Statements
can be uploaded directly or received from Paperless-ngx. Categories are loaded
from Actual Budget, and new category groups and categories can be created from
the importer.

> [!IMPORTANT]
> This app is designed for one user on a trusted internal network. Do not
> expose it directly to the public internet

## Screenshots

<table>
  <tr>
    <td><a href="docs/screenshots/home.png"><img src="docs/screenshots/home.png" width="320" alt="Actual Budget Importer dashboard"></a><br><strong>Dashboard</strong></td>
    <td><a href="docs/screenshots/statement.png"><img src="docs/screenshots/statement.png" width="320" alt="Statement transaction review"></a><br><strong>Statement review</strong></td>
    <td><a href="docs/screenshots/rules.png"><img src="docs/screenshots/rules.png" width="320" alt="Categorization rule management"></a><br><strong>Categorization rules</strong></td>
    <td><a href="docs/screenshots/group.png"><img src="docs/screenshots/group.png" width="320" alt="Actual Budget categories and category creation"></a><br><strong>Categories</strong></td>
  </tr>
</table>

## Quick start

## `docker-compose.yaml`

```yaml
name: actual-budget-importer

services:
  actual-budget-importer:
    image: ghcr.io/ricardo-reis-swe/actual-budget-importer:latest
    container_name: actual-budget-importer
    init: true
    restart: unless-stopped
    environment:
      ACTUAL_SERVER_URL: https://actual.example.test # Required Actual Budget server URL.
      ACTUAL_PASSWORD: change-me # Required Actual Budget server password.
      ACTUAL_BUDGET_ID: replace-with-budget-sync-id # Required budget sync ID.
      ACTUAL_ENCRYPTION_PASSWORD: "" # (Optional) Budget encryption password.

      APP_PORT: "3000" # (Optional) Application HTTP port.
      MAX_PDF_SIZE_BYTES: "104857600" # (Optional) Maximum PDF size; defaults to 100 MiB.
      EXTRACTION_TIMEOUT_MS: "300000" # (Optional) Extraction timeout; defaults to five minutes.

      PAPERLESS_URL: "" # (Optional) Paperless-ngx URL; set with PAPERLESS_API_TOKEN.
      PAPERLESS_API_TOKEN: "" # (Optional) Paperless-ngx token; set with PAPERLESS_URL.
    ports:
      - "3000:3000"
    volumes:
      - ./data:/data
      # The container runs as a non-root user; ensure ./data is writable by it.
```

### Development container image

Every update to the `main` branch publishes an unreleased container image
tagged `develop`:

```yaml
image: ghcr.io/ricardo-reis-swe/actual-budget-importer:develop
```

This image contains the latest changes but may be unstable. Use it for testing
rather than production, and back up the mounted data directory before
upgrading. The `latest` tag remains the recommended choice for stable
installations.

Paperless-ngx is optional. To enable it, set both `PAPERLESS_URL` and
`PAPERLESS_API_TOKEN`. PDF processing defaults to a 100 MiB limit and a
five-minute timeout; both can be changed in the Compose file.

Choose the destination Actual Budget account when publishing each statement.
Existing installations may keep `ACTUAL_ACCOUNT_ID` for one upgraded startup
to associate historical published or failed statements with the formerly
configured account, then remove it.


## Paperless-ngx webhook setup

After configuring the Paperless-ngx connection, create a Paperless-ngx
workflow whose trigger identifies the statements you want to import, then add
a **Webhook** action with these settings:

| Setting | Value |
| --- | --- |
| Webhook URL | `http://<actual-budget-importer-host>:3000/api/webhooks/paperless` |
| Use parameters for webhook body | Yes |
| Send webhook payload as JSON | No |
| Webhook parameter | `document_id` = `{{ doc_id }}` |
| Include document | No |

Replace `<actual-budget-importer-host>` with the IP address or hostname of the
machine running Actual Budget Importer. The webhook sends only the Paperless
document ID; the importer retrieves the document and its metadata from
Paperless-ngx. Do not use port `5173` for a deployed container: that port is
used only by the Vite development interface.

### Data storage

Actual Budget Importer stores its application data in SQLite. In the example
Compose configuration, `./data` is mounted at `/data` in the container so the
database survives container replacements. The container runs as a non-root
user, so ensure this host directory is writable by the container user. Back up
this directory regularly, and do not run more than one importer instance
against the same data directory.

## Development

Local development requires Node.js 22+ and pnpm:

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm start:server
```

The API runs on port 3000 and the Vite interface on port 5173.

## Contributing

### Developing a bank parser

Bank parsers live in `src/parsers` and implement the `BankParser` interface in
`src/parsers/bank-parser.ts`. Give each parser a stable, lowercase ID: it is
stored with statements and used by saved rules and Paperless-ngx mappings.

A parser receives PDF bytes in memory and returns transactions in the
statement's original order. Every row must include a zero-based `position`, a
`DD-MM-YYYY` date, a description, and a signed integer `amountCents` value.
Negative amounts are outflows and positive amounts are inflows. Parsers must
not attach currency metadata or convert currencies. They must not access the
database, credentials, Paperless-ngx, or Actual Budget.

To add a parser:

1. Add a parser module under `src/parsers` that implements `BankParser`.
2. Register it in the `parsers` array in `src/start-server.ts`.
   Newly added parsers are hidden until the user enables them in Parser settings.
3. Add regression tests and synthetic statement-layout fixtures under `test/`.
   Do not commit real statements or other financial data.
4. Run `pnpm run typecheck` and `pnpm test` before opening a pull request.

### Data storage

Actual Budget Importer stores its application data in SQLite. In the example
Compose configuration, `./data` is mounted at `/data` in the container so the
database survives container replacements. Back up this directory regularly,
and do not run more than one importer instance against the same data
directory.

## License

Licensed under the [GNU General Public License, version 3 or later](LICENSE).
