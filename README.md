# AISAS By ClemxyTech

AI Scouting Automation System. A shared TypeScript + Expo/React Native application for web, Android, and iOS, backed by Supabase Auth, Postgres, and an authenticated Edge Function.

## Start

```sh
npm ci
npm start         # Expo Go / native development
npm run web       # Web development with Metro
npm run build     # Production web export in dist/
npm run dev       # Serve the exported web build locally
npm run typecheck
npm test
```

The public Supabase URL and publishable key for `aisas` are included; `.env.example` documents overrides. Publishable keys are safe in clients. Database passwords, service-role keys, and integration keys must never enter this app bundle or source control.

Web visitors arrive on the branded landing page with feature showcases, an interactive sample preview, FAQs, day/night switching, and email signup. `/?signup=1` opens signup directly, `/?signin=1` opens sign-in, and `/?view=workspace` opens the app. Returning authenticated visitors and native apps go straight to the workspace. Auth and mailbox callbacks retain workspace routing.

Visitors can open a clearly labeled, device-local demo with sample businesses and `.example` email addresses. Demo scouting and campaigns never search or send. Sign in for an empty, private workspace backed by Supabase. Demo data is not uploaded into an account.

## Deploy the web app to Vercel

Import [Clemxytech18/aisas](https://github.com/Clemxytech18/aisas) into Vercel, using production branch `main` and the repository root as the Root Directory. Choose **Other** as the Framework Preset. The committed `vercel.json` supplies installation (`npm ci`), the production build (`npm run build`), output directory (`dist`), and single-page routing so opening `/app` or an authentication callback does not return a hosting 404. The build also adds the landing page metadata and favicon. This follows [Expo's Vercel deployment guide](https://docs.expo.dev/guides/publishing-websites/#vercel).

The two optional Vercel environment variables are `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, documented in `.env.example`. The current project's public defaults are included in the app. AI, search, email-verification, and mailbox credentials stay server-side in the existing Supabase backend; the Vercel deployment serves the frontend.

After the Vercel deployment succeeds, add `aisas.clemxytech.com` under the Vercel project's Domains settings. Replace the existing `aisas` CNAME target (`custom-domains.chatgpt.site.`) in Namecheap Hosting DNS with the **exact target shown by Vercel**. Edit the existing record rather than adding a second CNAME for the same hostname. Keep the current DNS target until the Vercel deployment is ready.

For production, set the Supabase Auth **Site URL** to `https://aisas.clemxytech.com` and add `https://aisas.clemxytech.com/` to **Redirect URLs**. The backend `APP_ORIGIN` must use `https://aisas.clemxytech.com`; it was updated for this custom domain. Nylas continues to call the existing Supabase Edge Function URL, which then returns users to the custom domain. A `vercel.app` preview can display the UI and demo, but confirmation links and mailbox returns use the configured production domain.

The owner-only access policy on the existing Sites publication does not carry over to Vercel. Set Vercel's deployment access for the intended audience before sharing its URL. AISAS account authentication and database row permissions remain enforced by Supabase.

## Implemented

- Responsive dashboard, day/night themes, native-compatible screens.
- Responsive marketing landing page with signup calls to action, demo entry, feature walkthrough, mailbox support, FAQs, and search/social metadata in the web export.
- Email/password signup and login. Google account signup/sign-in is deferred to a later release. Gmail mailbox authorization remains available for campaign delivery.
- Audience/business category and location, service niche/sub-niche, USP, offer.
- Boolean query construction, saved profiles, named lists, searchable prospects and source links.
- Live search adapter for Google, Yahoo, Yandex, directories/LinkedIn/blog queries, and Google Maps using SerpAPI. Contact fields only come from available search data; missing contacts remain blank. Source pages are not scraped. Contact scores are a simple availability heuristic, not AI verification.
- AI writing through OpenAI: a first message and 3 follow-ups, editable subjects/bodies, personalization tokens, per-step delays, preview and explicit approval.
- Campaign start dates, launch, pause, restart, selected sending mailbox.
- Nylas hosted connection flow for Gmail, Outlook, Yahoo, and custom-domain mailboxes. Custom-domain owners enter their own IMAP/SMTP settings in the secure hosted form; SMTP configuration is required before connection completes. Multiple accounts per user; server-only grant storage.
- Dispatch endpoint with atomic queue claims, per-recipient scheduling, threaded follow-ups, stop-on-reply checks, suppression of unsubscribed leads, and no automatic retries after ambiguous delivery.
- Owner-based RLS, cross-owner foreign-key protection, read-only client access to mailbox metadata and dispatch records, service-only launch controls, private provider credentials, atomic daily provider quotas.

## Shared Search pool

The **Search** workspace section has Companies and People modes. Company filters include company name, location, industry, company size, annual revenue and funding ranges in USD, technologies, founding-year range, domain, and keyword. People filters include name, employer, location, job title, department, seniority, industry, employer size/domain, keyword, and email/phone availability. Results are paginated in groups of 25; company cards can open a People search for decision makers at that company. Industry/seniority/department labels are categorized from available business context or job titles, rather than asserted as independent enrichment.

Every new server scouting insert with a public HTTP(S) source contributes descriptive prospect fields to `prospect_pool`. The database trigger deduplicates records across scouts and accounts. Only signed-in users can read/search it. Clients cannot insert, edit, or delete shared entries. Existing private leads are **not** backfilled: historical records do not identify which fields came from scouting versus manual edits. Demo records remain device-local and never populate the live pool.

Users can select results and save to an existing audience list or create a new one. `aisas_save_pool_prospects` runs with the caller's RLS permissions, checks ownership, and atomically copies selected rows with duplicate protection. Separate people at one company can be saved without published email addresses. Copies start as new, unverified private leads; contributor identities, source list IDs/names, campaigns, suppression status, and verification history are not part of the shared schema.

The new `scout-search` Edge Function handles authenticated Company/People scouting and consumes the existing scouting quota. It validates ES256 user tokens with `auth.getUser`, reads only the requested owner's profile, and uses the existing server-side SerpAPI configuration. Companies use web/directory/Maps queries; People queries target public professional profiles. Names, job titles, public contact information, and source snippets are taken from results. Emails are never generated from guessed name/domain patterns. `aisas_save_scout_results` is service-only and atomically persists a list, its leads, and pool contributions. The campaign dispatcher is unchanged.

Financial data, employee counts, technologies, and founding years are often absent from the current search provider results. These fields remain unavailable rather than being inferred; applying one of their filters excludes unknown records. Rich firmographic filtering requires source-backed data in those fields, such as a future enrichment-provider integration. The interface does not imply those fields are populated for every company.

Deploy `supabase/migrations/20261110210508_shared_prospect_pool.sql` before the frontend and deploy `supabase/functions/scout-search` with its bundled relative TypeScript dependencies. `tests/prospect-pool.test.ts` covers filter validation, missing-data behavior, copying, and public profile extraction; `tests/prospect-pool-rls.sql` exercises trusted ingestion/deduplication, shared reads, private copies, denied pool writes, owner isolation, and anonymous denial using rollback-only fixtures.

## On-demand email verification

Every prospect email has a **Verify** button on desktop, web, and mobile. A click checks that specific address through ZeroBounce in real time and saves the result and timestamp to the user's lead. **Verified** means the provider returned `valid`; **Invalid** means the provider returned `invalid` or the address has an obviously invalid format/reserved demo domain. Catch-all, risky, and inconclusive inboxes show **Unknown** with an explanation. Provider timeouts, missing configuration, and insufficient credits show a retry/setup error instead of falsely marking the address invalid. Verification does not send a campaign email.

Configure `aisas_ZEROBOUNCE_API_KEY` in Supabase Vault (or `ZEROBOUNCE_API_KEY` as a server-only environment variable). The existing OpenAI/SerpAPI/Nylas keys do not provide inbox verification. ZeroBounce requires an active credit balance. The verification function reads its own credential when checking an address. See the [ZeroBounce real-time validation API](https://www.zerobounce.net/docs/email-validation-api-quickstart/v2-validate-emails).

Verification uses the separate `verify-email` Edge Function; it cannot start campaigns or send email. It validates every caller with Supabase Auth before reading lead/configuration data, and uses the service-only `aisas_email_verification_key` RPC to read only the ZeroBounce credential. Gateway JWT verification is disabled because this project uses ES256 signing keys; application authentication is mandatory. Results belong to the authenticated lead owner. Clients cannot write verification fields directly; changing an email clears its previous result, and a concurrent email change prevents an in-flight result from being saved against the new address. Each user has a server-enforced limit of 200 verification attempts per UTC day. Reverify makes a fresh check. Demo mode only identifies reserved/invalid sample addresses and never claims a real inbox is verified.

`tests/email-verification.test.ts` covers positive/negative/inconclusive results, missing keys, provider failures, address mismatch, credential handling, and stale display protection. `tests/email-verification-rls.sql` checks field permissions, row isolation, and invalidation using rollback-only fixtures.

## Configuration and credentials

Platform integration credentials are provisioned in **Supabase Vault** under the names `aisas_ZEROBOUNCE_API_KEY`, `aisas_OPENAI_API_KEY`, `aisas_SERPAPI_KEY`, `aisas_NYLAS_API_KEY`, `aisas_NYLAS_CLIENT_ID`, `aisas_NYLAS_CLIENT_SECRET`, `aisas_CRON_SECRET`, `aisas_APP_ORIGIN`, and `aisas_NYLAS_REDIRECT_URI`. No secret values are committed to Git. Rotate these through the project's Vault dashboard. The Edge Function reads an explicit allowlist using the service-only `aisas_runtime_config` RPC and caches it for 60 seconds. Neither anonymous nor signed-in application users can call this RPC. Edge Function environment variables take precedence and remain supported for local development and alternate deployments.

For the Nylas v3 API-key flow, `NYLAS_CLIENT_SECRET` uses the same value as `NYLAS_API_KEY`. Never put integration secrets in variables prefixed with `EXPO_PUBLIC_`; those are bundled into web/native clients.

1. **Account authentication:** AISAS signup/sign-in uses email and password only. Google signup/sign-in is not part of this release. Supabase manages confirmation/reset emails; its transactional-email configuration is separate from users' campaign mailboxes. No user needs to provide SMTP settings to create an AISAS account.
2. **Personal campaign mailboxes:** each signed-in user connects their own Gmail, Outlook, Yahoo, or custom-domain mailbox under Email accounts. For a custom domain, the user enters the mailbox address/credentials, IMAP host/port, and SMTP host/port in Nylas's secure hosted flow. SMTP configuration is required (`options=smtp_required`). These are per-user settings, not platform-wide environment variables. AISAS stores only the owner-scoped mailbox metadata and a private provider grant reference.
3. **Nylas dashboard:** register `https://beslhrcwojbxbqcvsnhy.supabase.co/functions/v1/aisas-api` under Hosted authentication → Callback URIs. Configure the Google/Microsoft connectors needed for mailbox access and enable Yahoo/generic IMAP as appropriate. These mailbox permissions are separate from AISAS account login. The adapter uses the US Nylas API region.
4. **Scheduler:** invoke the Edge Function every minute with `Authorization: Bearer <CRON_SECRET>` and JSON `{"action":"dispatch"}` after sender connections and a test campaign have been verified. The scheduler is not activated simply by saving credentials. It processes up to 10 messages per invocation; no emails are sent during deployment checks.
5. **Native distribution:** use an Expo development build or EAS Build with your Apple/Google developer accounts and signing credentials. Bundle IDs are `com.clemxytech.aisas`. `eas.json` includes development, preview, and production profiles. Store binaries have not been signed, installed on devices, or submitted.

Fresh deployments can use server environment variables with the unprefixed configuration names above. Add the deployed web URL as `APP_ORIGIN` and the function URL as `NYLAS_REDIRECT_URI`. Optional `OPENAI_MODEL` defaults to `gpt-4.1-mini`. Provider credentials must have active accounts, quota, and appropriate permissions.

For a fresh Supabase project, apply the SQL files in `supabase/migrations/` in order, and deploy `supabase/functions/aisas-api`, `supabase/functions/verify-email`, and `supabase/functions/scout-search`. The current project's function is deployed with gateway JWT verification disabled because OAuth callbacks and the scheduler do not carry Supabase user JWTs. The handler validates user tokens using `auth.getUser`; OAuth uses one-use states and dispatch uses a separate secret. Service RPCs are revoked from anon/authenticated roles.

## Operational details

- A paused campaign stops new dispatch attempts. A request already handed to the mail provider can finish. Pause before editing; client database grants reject edits while running/scheduled.
- `processing` recipients left by an interrupted worker and `uncertain` deliveries require administrator reconciliation with provider logs. Do not reset blindly: that could duplicate an email.
- Follow-ups stop after an inbound thread message is detected. Bounce/unsubscribe webhooks and a dedicated suppression-management UI are future extensions; an administrator can mark a lead `unsubscribed` immediately.
- Completed recipients become `sent`; campaign completion is currently administrative rather than automatically inferred. Sent statistics/reporting and billing are not part of this first version.
- Native Nylas account linking finishes on the web workspace; refresh/reopen the mobile app to see new connections.
- The initial limits are 20 scouts, 100 AI sequence generations, and 20 mailbox connection attempts per user per UTC day. Failed attempts also count. Limits are enforced transactionally in private SQL.
- Before broad production use, validate provider OAuth scopes, reply/bounce behavior and a real test sequence with a mailbox you control. The current web Site is private to its owner; native distribution needs a public application hosting/auth configuration.

## Verification

`tests/domain.test.ts` checks Boolean quoting, personalization fallbacks, and sequence/delay validation. `tests/rls.sql` uses rollback-only fixtures to verify read/insert isolation, cross-owner parent protection, and denial of service-only RPCs and privileged column writes. No fixture accounts remain after it runs.

Web and Android/iOS JavaScript exports are build checks; they do not establish device-level behavior. The managed preview relay was unavailable during initial development, so interactive browser QA remains unverified.

Mailbox setup follows the [Nylas IMAP/SMTP hosted authentication guide](https://developer.nylas.com/docs/v3/auth/imap/). Encrypted backend configuration follows [Supabase Vault](https://supabase.com/docs/guides/database/vault).
