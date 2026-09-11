# Actual Budget Importer

Actual Budget Importer prepares ActivoBank and WiZink PDF statements for review, categorization, and explicit publishing to Actual Budget. It supports direct PDF uploads and optional Paperless-ngx webhook ingestion.

## Run with Docker

Copy `.env.example` to `.env`, set the Actual Budget connection values, then run:

```sh
docker compose up --build
```

The web interface is available at `http://localhost:3000`. SQLite data is stored in the `actual-budget-importer-data` volume. Run only one application instance against a database.

## Configuration

Required: `ACTUAL_SERVER_URL`, `ACTUAL_PASSWORD`, `ACTUAL_BUDGET_ID`, and `ACTUAL_ACCOUNT_ID`.

`PAPERLESS_URL` and `PAPERLESS_API_TOKEN` are optional, but must be supplied together. `APP_DATA_DIRECTORY` and `APP_PORT` default to `./data` and `3000`.

PDF processing defaults to a 100 MiB maximum (`MAX_PDF_SIZE_BYTES=104857600`) and a five-minute extraction timeout (`EXTRACTION_TIMEOUT_MS=300000`). These limits apply to direct uploads and Paperless-ngx PDFs.

## Development

Requires Node.js 22+ and pnpm.

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
pnpm start:server
```

Use synthetic statements and mocked integrations in tests. Never commit credentials, real statements, or personal financial data.

## Endpoints

`GET /api/health` is a credential-free database health check. Direct uploads use `POST /api/statements/upload`; Paperless-ngx uses `POST /api/webhooks/paperless` with `{ "document_id": 123 }`.
