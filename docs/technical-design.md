# Actual Budget Importer technical design

## Direct upload request and response

- Provide `POST /api/statements/upload` using multipart form
  data containing one PDF and a parser ID.
- Validate the parser ID and PDF size before creating a
  statement.
- Calculate the content hash and check for an existing
  statement before starting extraction.
- For a new statement, save its filename, hash, parser, and
  queued status durably, then return HTTP 202 with its statement
  ID and status.
- Continue extraction outside the request while keeping the PDF
  only in memory.
- For a duplicate, return HTTP 200 with the existing statement
  ID and status without changing it.
- Reject an invalid request with a clear client-error response.

## PDF processing limits

- Default to a maximum PDF size of 100 MiB and an extraction
  timeout of 5 minutes.
- Make both limits configurable through environment variables.
- Enforce the size limit for direct uploads and PDFs
  retrieved from Paperless-ngx.
- Stop extraction when its timeout is reached.
- Show a clear error when a size limit or timeout prevents
  processing.
- Document the limits and their default values.

## Paperless-ngx webhook endpoint

- Enable this endpoint only when Paperless-ngx is configured.
- Provide `POST /api/webhooks/paperless`.
- Accept a JSON or URL-encoded form body containing the
  Paperless-ngx document ID.
- Do not accept the PDF or document metadata in the webhook;
  retrieve them through the Paperless-ngx API.
- Return an accepted response only after the document ID has
  been stored durably for processing.
- Treat delivery of an already known document ID as successful
  without creating another statement.
- Reject malformed requests with a clear client-error response.
- Do not require separate webhook authentication because the
  app is restricted to the trusted internal network.

## Paperless-ngx webhook request and response

- Require `document_id` as either a positive integer or its
  digit-only string representation in a JSON object or
  URL-encoded form body, so Paperless-ngx key-value webhook
  bodies are accepted without custom headers.
- Return HTTP 202 after the document ID has been stored
  durably.
- Include the app's statement ID and current status in the
  response.
- For a known Paperless-ngx document ID, return HTTP 202 with
  the existing statement ID and status.
- Return HTTP 400 for an invalid body and HTTP 415 for an
  unsupported content type.

## Published transaction identity

- Give every extracted transaction a stable import identifier
  that does not change when its reviewed values are edited.
- Use Actual Budget's transaction import and reconciliation
  behavior with that identifier.
- Store the Actual Budget transaction ID after publishing.
- On a retry, reconcile transactions already sent and publish
  only those still missing.
- Never create another Actual Budget transaction for the same
  extracted transaction.
- For a published transaction, use its stored Actual Budget transaction ID to
  publish later reviewed date, description, amount, or category changes. This
  allows a date to move outside its original lookup range without losing the
  transaction's identity.

## Mapping transactions to Actual Budget

- Send the reviewed transaction description as the Actual
  Budget payee name.
- Preserve the original extracted description as the imported
  payee text.
- Send the reviewed date, signed amount, and optional category.
- Mark published statement transactions as cleared.
- Leave notes empty.

## Actual Budget category management

- Provide `POST /api/category-groups` with a confirmed group name.
- Create category groups as standard expense groups through the
  official `@actual-app/api` package.
- Return the Actual Budget category group ID and refresh the local
  category cache before using the group.
- Provide `POST /api/categories` with a confirmed category name and
  an existing Actual Budget category group ID.
- Provide `PATCH /api/categories/:categoryId` with a non-empty category
  name to rename an existing category.
- Provide `DELETE /api/categories/:categoryId` with explicit confirmation
  to remove a category.
- Apply category creation, renaming, and removal through the official
  `@actual-app/api` package and refresh the local category cache after
  each change.

## Actual Budget publishing procedure

- Integrate through the official `@actual-app/api` package.
- Provide `GET /api/actual/accounts` to return the accounts in the
  configured budget file for publication selection.
- Require `POST /api/statements/:statementId/publish` to contain a
  confirmed Actual Budget account ID.
- Validate that a newly selected account exists and is not closed.
- Atomically save the selected account ID and its name on the statement
  when claiming its first publication attempt.
- Pass the statement's saved account ID to transaction import and lookup
  operations. Reject a different account on later attempts.
- Import included transactions using their stable import
  identifiers and Actual Budget's reconciliation behavior.
- Do not reimport a transaction that the user later deleted
  from Actual Budget.
- After import reconciliation, locate each transaction by its
  import identifier and explicitly apply all reviewed values,
  including clearing its category when it was intentionally
  left uncategorized.
- On repeat publication, update transactions through their stored Actual
  Budget transaction IDs and do not run them through import again.
- Verify every included transaction and synchronize the Actual
  Budget file before marking the statement as published.
- If any step fails, keep the statement unpublished and allow a
  duplicate-safe retry.
- If publishing changes to an already published statement fails, keep the
  statement published, preserve the changed review values, and allow another
  repeat-publication attempt.

## Amount precision

- Keep the importer currency-agnostic. Do not store or send currency
  metadata, and do not perform currency conversion.
- Store amounts as signed integers in Actual Budget's amount representation
  and never as floating-point values.
- Treat an amount that cannot be parsed unambiguously into that integer
  representation as an extraction error requiring review or retry.

## Statement processing lifecycle

- Persist an incoming document ID before acknowledging its
  webhook.
- Process retrieval and extraction outside the webhook request.
- Track each statement as queued, processing, awaiting parser
  selection, ready for review, extraction failed, publishing,
  republishing, publish failed, or published.
- Do not process the same Paperless-ngx document concurrently.
- After an app restart, automatically resume queued or
  interrupted Paperless-ngx retrieval and extraction only.
- Handle interrupted publishing through the Interrupted
  publishing procedure, regardless of statement source.
- Restore a statement interrupted while republishing to published status with
  a retryable sanitized error; its original successful publication remains
  valid.
- Mark direct uploads interrupted during extraction as
  extraction failed because their PDF contents are no longer
  available in memory.
- Keep this processing state in SQLite without requiring a
  separate queue service.

## Parser structure

- Give every bank parser a stable internal ID and a
  human-readable name.
- Give every bank parser an ISO 3166-1 alpha-2 country code and an
  English country name for grouping in parser settings.
- Use one shared parser interface that receives PDF data and
  returns extracted transaction rows.
- Keep bank-specific extraction logic isolated from the rest of
  the application.
- Preserve the statement's transaction order and give every
  extracted row a stable position within that statement.
- Parsers must not access the database, application credentials,
  Paperless-ngx, or Actual Budget directly.
- Adding a bank should require a new parser without changing the
  general statement workflow.
- Persist per-parser dropdown visibility in SQLite. Keep the original
  ActivoBank and WiZink parsers visible when no preference has been saved,
  and default newly added parsers to hidden until the user selects them.
- Persist parser-setup completion in application settings.
- Provide an atomic parser-selection API operation that saves the
  enabled parser IDs and marks initial parser setup complete.
- Expose installed parser visibility and known Paperless
  correspondent mappings through parser-settings API endpoints.
- Build parser selectors on the shared grouped-select component used by
  categories. Group and label options by country only when the selector
  contains parsers from more than one country.

## Technology choices

- Use Node.js as the application runtime.
- Write application code in TypeScript.
- Use Fastify for the application server and HTTP API.
- Use SQLite for application data.
- Use React to build the web interface.
- Use Vite to develop and build the React interface.

## Application structure

- Build and deploy the project as one application.
- Fastify receives webhooks, runs extraction, stores data, and
  communicates with Actual Budget and, when configured,
  Paperless-ngx.
- Fastify serves the built React interface in production.
- The browser communicates with Fastify and never receives the
  Paperless-ngx or Actual Budget credentials.

## Data layer

- Use `better-sqlite3` as the SQLite driver.
- Use Kysely for typed database queries and schema migrations.
- Enable SQLite write-ahead logging.
- Run pending database migrations when the application starts.
- Store the database in a configurable persistent data
  directory outside the application source.
- Run only one application instance against a database file.
- Store category and inclusion effects independently on each
  saved rule. Preserve existing category-only rules when the
  schema is migrated.
- Include the first matching saved rule with each transaction returned for
  statement review. Determine it from the reviewed description when present,
  otherwise the extracted description, together with the statement parser.
  Calculate this match from the current ordered rules rather than persisting
  rule provenance on the transaction.
- Store the destination Actual Budget account ID and the account name at
  selection time on each statement. Keep both nullable for historical
  statements whose destination was not recorded.

## Application configuration

- Configure the app through environment variables.
- Configuration includes:
  - Optional Paperless-ngx URL and API token.
  - Actual Budget server URL, password, and budget ID.
  - Actual Budget encryption password when required.
  - Persistent data directory and application port.
- Require both the Paperless-ngx URL and API token when enabling
  the integration; allow both to be omitted for upload-only use.
- Stop startup with a clear error when required configuration
  is missing or invalid.
- Commit an example configuration containing placeholders only.
- Never expose secrets in logs or API responses.
- Accept `ACTUAL_ACCOUNT_ID` only as an optional upgrade aid for
  associating existing published, publishing, or publish-failed statements
  with the previously configured fixed account. Do not use it as a default
  for new publications.

## Deployment

- Provide a production Docker image and an example Docker
  Compose configuration.
- Run the server and built web interface in one container.
- Run the container as a non-root user.
- Store the SQLite database in a mounted persistent volume.
- Expose only the application HTTP port.
- Do not bundle Paperless-ngx or Actual Budget; connect to
  separately deployed instances.
- Provide a health-check endpoint that reveals no credentials
  or financial data.

## Health check

- Provide `GET /api/health` without authentication.
- Return HTTP 200 when the server is running and the SQLite
  database can be accessed.
- Return HTTP 503 when the database health check fails.
- Do not contact Paperless-ngx or Actual Budget as part of the
  health check.
- Return only a generic health status without configuration,
  credentials, document data, or diagnostic details.

## Logging and privacy

- Use structured application logs with configurable log levels.
- Never log PDF contents, transaction descriptions, amounts,
  categories, credentials, or integration request and response
  bodies.
- Log only the identifiers, processing stage, status, and
  sanitized error details needed for diagnosis.
- Show actionable failures in the interface without exposing
  credentials or internal stack traces.
- Give failures a diagnostic identifier that can be matched to
  the corresponding sanitized log entry.

## Testing

- Use synthetic statements and mocked integrations in tests.
- Cover extraction, exact integer amounts, categorization rules,
  review validation, and exclusions.
- Verify duplicate deliveries preserve review changes.
- Verify publishing failures and retries do not create
  duplicate transactions.
- Verify restart recovery for each statement source and
  interrupted publishing.
- Never require real credentials or personal financial data
  to run the test suite.
