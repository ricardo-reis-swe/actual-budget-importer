# Actual Budget Importer product specification

## Project purpose

Build an app that takes statements from Paperless-ngx or direct
PDF uploads and prepares their transactions for review before
sending them to Actual Budget.

Users can assign categories and create reusable categorization
rules. Saved rules automatically populate categories and
inclusion choices in future statements.

Transactions are sent to Actual Budget only when the user
explicitly selects Publish.

The project is intended for a public repository so other
people can use it.

## Paperless-ngx statement arrival

1. Paperless-ngx processes an incoming statement and applies
   the designated tag.
2. A webhook notifies the app that the statement is available.
3. The app retrieves the statement and prepares its transactions
   for review, applying saved categorization rules.
4. The app displays the number of statements pending review.
   The user can open a statement to review its transactions.

## Direct PDF upload

- Allow the app to operate without a Paperless-ngx connection.
- Let the user upload a PDF and select one of the available bank
  parsers before processing it.
- Process the uploaded PDF in memory and never save a copy.
- Save the original filename for display.
- Use a hash of the PDF contents to identify duplicate uploads
  without retaining the file.
- Uploading the same PDF again must open the existing statement
  without erasing review changes.
- Send uploaded statements through the same extraction, review,
  rule, and publishing workflow as Paperless-ngx statements.

## Opening duplicate direct uploads

- Calculate the PDF content hash before creating or changing
  a statement.
- If the hash belongs to an existing statement, open that
  statement without running extraction or changing its parser.
- Preserve all existing status, transactions, and review data.
- If the parser selected in the upload form differs from the
  existing parser, explain that no parser change was made.
- Require the separate confirmed parser-change action to
  re-extract an existing statement with another parser.

## Retrying direct uploads

- Keep the filename, content hash, status, and error after a
  directly uploaded PDF fails, but never keep the PDF.
- Ask the user to select the same PDF again to retry extraction.
- Verify that its content hash matches the failed statement
  before retrying it.
- Treat a different PDF as a new upload.
- If the app stops during direct-upload extraction, mark that
  statement as failed and require the PDF to be selected again.

## Transaction review and categorization

- Users can review transactions and correct their details
  before publishing.
- Users can assign or change a transaction's category.
- Let users show only uncategorized transactions while reviewing a
  statement.
- Show categories as one group and category path, such as
  **Home**/Bills, in transaction review and rule interfaces.
- Users can create, rename, and remove Actual Budget categories
  from their existing category group cards.
- Require confirmation before removing a category from Actual
  Budget.
- Users can explicitly create reusable rules such as:
  "If the description contains X, assign category Y."
- A rule can assign a category, mark matching transactions as
  included or excluded, or do both.
- Assigning a category does not automatically create a rule.
- Saved rules populate categories in new statements.
  Users can change those categories during review.
- In transaction review, indicate on each transaction's rule button when
  its current description and statement parser are covered by a saved rule.
  Keep this indicator independent from later manual category and inclusion
  changes.

## Publishing to Actual Budget

- Publish sends the selected statement's reviewed transactions
  and assigned categories to an Actual Budget account selected by
  the user in the publication confirmation.
- Require the user to select an active destination account for the
  statement's first publishing attempt; do not preselect an account.
- Permanently associate the selected account with the statement when
  publishing begins and show it on failed and published statements.
- Retry a failed or interrupted publication only to its previously
  selected account. Do not allow the account to be changed because
  some transactions may already have reached that account.
- A statement is marked as published only after its transactions
  have been successfully sent.
- If publishing fails, show the failure and preserve the user's
  review work.
- Repeated clicks or retries must not create duplicate
  transactions in Actual Budget.

## Initial statement support

- Initially support ActivoBank and WiZink PDF statements.
- Use the owner's existing extraction script and bank presets
  as the starting point for statement parsing.
- Changes to extraction behavior require the owner's approval.

## Bank identification

- For Paperless-ngx statements, select the parser using the
  document's correspondent.
- Map the ActivoBank correspondent to the ActivoBank parser and
  the WiZink correspondent to the WiZink parser.
- Make correspondent-to-parser mappings configurable for each
  installation.
- If the correspondent has no configured parser, let the user
  manually select one of the available parsers.
- For direct uploads, require parser selection for each new
  statement and never preselect a parser based on earlier
  uploads.
- Provide parser settings in the application header. Let users
  choose which installed parsers appear in parser dropdowns and
  configure automatic Paperless correspondent-to-parser rules.
- On the first application visit, open parser settings automatically
  and ask the user to save their parser selection before continuing.
- Group installed parsers by country in parser settings. Let users
  select or clear every parser for a country and override that choice
  for each individual parser.
- Use country selection only as a bulk editing convenience. Persist
  the resulting visibility choice for each individual parser.
- Keep the grouped country and individual parser controls available
  from parser settings after initial setup is complete.
- Hiding a parser affects selection lists only. Keep it usable by
  existing statements and saved correspondent rules.

## Manual parser selection

- Store the manually selected parser on the current statement
  so the app can display which parser was used.
- Never reuse that selection for another statement or use it
  to change correspondent-to-parser mappings.
- Require parser selection for every new direct upload.
- Future statements from an unmapped correspondent require
  another manual selection.

## Changing a statement parser

- Let the user change the parser for any unpublished statement.
- Warn that changing the parser permanently deletes all
  extracted transactions, edits, categories, exclusions, and
  other review changes for that statement.
- Require explicit confirmation before deleting those changes.
- For Paperless-ngx statements, retrieve the original PDF again
  and re-extract it with the selected parser.
- For direct uploads, require the user to select the PDF again
  and verify its content hash before deleting existing data.
- Keep the statement's identity, source metadata, and content
  hash when its parser changes.
- Keep published statements read-only and do not allow their
  parser to change.

## Awaiting parser selection

- When a Paperless-ngx correspondent has no configured parser,
  mark the statement as awaiting parser selection.
- Show these statements on the dashboard as needing attention.
- Start extraction after the user selects a parser for that
  statement.
- Preserve this status across app restarts without repeatedly
  attempting extraction.

## Paperless-ngx data access

- The webhook identifies the Paperless-ngx document.
- Retrieve the document metadata and original PDF through the
  Paperless-ngx API.
- Read the correspondent from the document metadata.
- Do not modify the document or its metadata in Paperless-ngx.

## Paperless-ngx statement metadata

- Store the Paperless-ngx document ID, title, correspondent ID
  and name, document date, and original filename.
- Show this metadata on the statement details page.
- Use the correspondent ID for parser mappings and retain the
  correspondent name for display.
- Show a Synchronize with Paperless-ngx button on every
  statement associated with a Paperless-ngx document.
- Synchronization retrieves and updates the saved metadata but
  does not re-extract the PDF, change the parser, or alter
  transactions and review changes.
- Preserve the existing metadata and show a sanitized error if
  synchronization fails.
- Do not modify the document or its metadata in Paperless-ngx.

## Manual statement retrieval

- When Paperless-ngx is configured, let the user enter a
  Paperless-ngx document ID to retrieve a statement manually.
- Send manually requested documents through the same duplicate-
  safe retrieval and extraction workflow as webhook deliveries.

## Paperless-ngx retrieval retries

- Do not automatically retry a failed Paperless-ngx retrieval.
- Mark the statement as extraction failed and preserve its
  Paperless-ngx document ID.
- Show the sanitized failure and let the user manually retry.
- On manual retry, retrieve the document and its metadata again
  from Paperless-ngx.
- Prevent concurrent retries for the same document.

## Statement files

- Treat Paperless-ngx as the original-file source for retrieved
  documents.
- The user remains responsible for retaining directly uploaded
  originals.
- Retrieve or receive the PDF and extract it in memory.
- Do not save a copy of the PDF in the app.
- Save only the extracted output needed for review and
  publishing.

## Extracted data retention

- Keep extracted transaction data for pending and published
  statements.
- Do not automatically delete extracted transaction data.

## Deleting statements

- Let the user permanently delete any statement when it is not
  processing or publishing.
- Require explicit confirmation before deletion.
- Delete all data the app stores for the statement, including
  publication records and duplicate-identification data.
- Do not delete or modify anything in Paperless-ngx or Actual
  Budget.
- If the document arrives again, process it as a new statement
  and rely on Actual Budget's import and reconciliation behavior
  to handle duplicates.

## Duplicate statement delivery

- Use the Paperless-ngx document ID to identify a retrieved
  statement.
- Use a hash of the PDF contents to identify a directly uploaded
  statement.
- Receiving the same document again must not create duplicate
  statements or erase review changes.
- Allow extraction to be retried when an earlier extraction
  failed.

## Duplicate statements across sources

- Calculate and store a content hash for PDFs retrieved from
  Paperless-ngx as well as direct uploads, without retaining
  the PDF.
- If a direct upload matches an existing Paperless-ngx
  statement, open the existing statement.
- If a Paperless-ngx document matches an existing direct-upload
  statement, associate its document ID and metadata with the
  existing statement.
- Preserve the existing parser, status, transactions, and
  review changes when associating the second source.
- Use either source identifier to find the same statement
  afterward.

## Extracted transaction data

- Each extracted transaction must contain a date, description,
  and signed amount.
- Use `DD-MM-YYYY` for transaction dates in the app.
- Negative amounts represent money leaving the account.
- Positive amounts represent money entering the account.
- Convert dates to the format required by Actual Budget when
  publishing.

## Actual Budget categories

- Retrieve available categories and category groups from the
  configured Actual Budget file.
- Let users create a category group.
- Let users select an existing category or create a category
  under an existing category group.
- Create a category group in Actual Budget only after the user
  explicitly confirms the action.
- Create a category in Actual Budget only after the user
  explicitly confirms the action.
- Store and use the category ID returned by Actual Budget.
- Never send an unknown category name or ID with a transaction.

## Integration setup

- Paperless-ngx is optional. When configured, the app connects
  to one Paperless-ngx instance.
- The connection to one Actual Budget budget file is required. Users
  select the destination account separately for each statement when
  publishing it.
- When Paperless-ngx is configured, retrieve its correspondents
  and let the user map ActivoBank and WiZink to the appropriate
  correspondents.
- Save correspondent mappings locally.
- Do not provide other integration settings in the app
  interface.

## Integration outages

- Keep saved statements and review work accessible when
  Paperless-ngx or Actual Budget is unavailable.
- Show which integration is unavailable with a sanitized error.
- Allow direct uploads and local review to continue.
- Disable publishing and category creation while Actual Budget
  is unavailable.
- Allow the user to retry failed integration operations.

## Categorization rule matching

- Match description text without regard to uppercase or
  lowercase letters.
- A rule matches when its text appears anywhere in the
  transaction description.
- When multiple rules match, use the first matching rule.
- Let the user control the order of rules.

## Categorization rule validation

- Require rule matching text to contain at least one
  non-whitespace character.
- Require a rule to assign a valid Actual Budget category, set
  whether matching transactions are included, or both.
- If a saved rule's category has been deleted, flag the rule
  for attention and skip it during automatic categorization.
- Continue checking subsequent rules in their saved order.

## Applying rule changes

- Creating a rule while reviewing a transaction assigns its
  category to that transaction.
- Show an option to apply the new rule to all matching
  transactions in the current statement.
- Apply it to the current statement only when the user selects
  that option.
- Do not overwrite categories the user already assigned to
  other transactions.
- Applying rules may change inclusion when a matching rule has
  an explicit include or exclude action.
- Let the user apply the saved rules to the current unpublished
  statement without creating a new rule.
- Apply saved rules automatically to new statements from
  Paperless-ngx and direct PDF uploads.
- Reopening a duplicate statement must preserve its existing
  categories and review changes without reapplying rules.

## Statement list and status

- Show the number of statements waiting for review.
- List pending and published statements separately.
- Show statements whose extraction or publishing failed and
  allow the user to open them.
- Display the newest statements first.

## Publish validation

- Require every transaction to have a valid date, description,
  and amount before publishing.
- A category is optional. Transactions without one are
  published as uncategorized.
- Clearly identify missing or invalid required values in the
  review.
- Keep Publish unavailable until all required values are valid.

## Excluding transactions

- Let the user exclude an extracted transaction from
  publishing.
- Make exclusion reversible while the statement is pending.
- Do not require excluded transactions to pass validation.
- Clearly show which transactions will be excluded before
  publishing.

## Statements with no included transactions

- If extraction returns no transactions, show an extraction
  failure explaining that no transactions were found.
- Allow the user to retry extraction.
- If the user excludes every transaction, preserve those
  exclusions but keep Publish unavailable.
- Explain that publishing requires at least one included
  transaction.

## Published statements

- Let users edit the reviewed date, description, amount, and category of
  transactions after a statement is successfully published.
- Keep transaction inclusion and exclusion choices read-only after the first
  successful publication.
- Let the user publish those changes again to the statement's permanently
  associated Actual Budget account.
- Update the existing Actual Budget transactions when changes are published;
  do not create duplicate transactions.
- Keep the statement published and preserve the edited review data if
  publishing later changes fails, then let the user retry.
- Continue showing its extracted transactions, categories, exclusions, and
  publication status.

## Managing categorization rules

- Provide a page where users can view all saved rules.
- Let users create, edit, delete, and reorder rules.
- Show each rule's description text, category action, inclusion
  action, and position in the matching order.
- Apply rules to statements from every bank by default.
- Let the user optionally scope a rule to one parser.
- Apply a parser-scoped rule only when the statement used that
  parser.
- Changes to rules do not alter published statements.

## Categories and rules ownership

- Treat Actual Budget as the source of categories.
- Store Actual Budget category IDs in transactions and
  categorization rules.
- Store and run categorization rules only in this app.
- Do not create, edit, or delete Actual Budget rules.

## Category precedence when publishing

- The category confirmed during review in this app is the final
  category for the published transaction.
- Ensure that Actual Budget rules do not replace the reviewed
  category during publishing.
- Preserve an intentionally uncategorized transaction as
  uncategorized.
- Mark the statement as published only after the resulting
  categories in Actual Budget match the reviewed transactions.

## Saving before publishing

- Keep Publish unavailable while review changes are saving
  or have failed to save.
- Build the publication confirmation from saved review data.
- If review data changes after the confirmation is shown,
  require a new confirmation before publishing.
- Save the confirmed transaction values and exclusions as
  the publication snapshot before sending any transactions.
- Use that snapshot throughout the publishing attempt.

## Interrupted publishing

- After an app restart, mark statements left in publishing
  as publish failed and preserve their review data.
- Explain that some transactions may already have reached
  Actual Budget.
- Require the user to explicitly retry publishing.
- Use the existing duplicate-safe publishing procedure to
  reconcile any transactions already sent.

## Review interface

- Open the app on a dashboard that prioritizes pending and
  failed statements, with published statements in a separate
  view.
- Identify statements using their source name, parser, status,
  transaction count, and date range. Also show Paperless-ngx
  metadata for statements retrieved from Paperless-ngx.
- Show statement transactions in an editable table with date,
  description, amount, category, and exclusion controls.
- Save pending review changes automatically and show whether
  they are saving, saved, or failed to save.
- Before publishing, show a confirmation containing the included
  and excluded transaction counts, separate inflow and outflow
  totals, and the selected Actual Budget destination account.
- Offer active on-budget and off-budget accounts for a statement's
  first publication. Do not offer closed accounts.
- If a statement already has a destination account because publishing
  previously failed or was interrupted, show that account as locked
  in the confirmation.
- Disable editing and repeated Publish actions while publishing
  is in progress.
- On a published statement, label the action **Publish changes** and keep its
  previously selected destination account locked.

## Category synchronization

- Retrieve categories from Actual Budget when the app starts,
  when the user requests a refresh, and before publishing.
- Cache category IDs and names for display, but keep Actual
  Budget as the source of truth.
- Reflect category renames while retaining assignments through
  their unchanged IDs.
- Show hidden categories already used by transactions or rules,
  but do not offer them for new assignments.
- If a category was deleted, mark affected transactions and
  rules as needing attention without silently changing them.
- Require the user to select a valid category or explicitly
  leave the transaction uncategorized before publishing.
- Refresh the category list after creating a category.

## User access

- Design the app for a single user on a trusted internal
  network.
- Do not include authentication, user registration, multiple
  users, roles, or shared access.
- Document that the app must not be exposed directly to the
  public internet.

## Interface language

- Use English for the initial interface and documentation.
- Keep user-facing interface text organized separately from
  components so additional languages can be added later.
- Do not include multiple interface languages in the initial
  release.
