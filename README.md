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

The app opens a clearly labeled, device-local demo with sample businesses and `.example` email addresses. Demo scouting and campaigns never search or send. Sign in for an empty, private workspace backed by Supabase. Demo data is not uploaded into an account.

## Implemented

- Responsive dashboard, day/night themes, native-compatible screens.
- Email/password signup and login, Google OAuth client flow.
- Audience/business category and location, service niche/sub-niche, USP, offer.
- Boolean query construction, saved profiles, named lists, searchable prospects and source links.
- Live search adapter for Google, Yahoo, Yandex, directories/LinkedIn/blog queries, and Google Maps using SerpAPI. Contact fields only come from available search data; missing contacts remain blank. Source pages are not scraped. Contact scores are a simple availability heuristic, not AI verification.
- AI writing through OpenAI: a first message and 3 follow-ups, editable subjects/bodies, personalization tokens, per-step delays, preview and explicit approval.
- Campaign start dates, launch, pause, restart, selected sending mailbox.
- Nylas hosted connection flow for Google, Microsoft, Yahoo via IMAP, and custom IMAP mailboxes. Multiple accounts per user; server-only grant storage.
- Dispatch endpoint with atomic queue claims, per-recipient scheduling, threaded follow-ups, stop-on-reply checks, suppression of unsubscribed leads, and no automatic retries after ambiguous delivery.
- Owner-based RLS, cross-owner foreign-key protection, read-only client access to mailbox metadata and dispatch records, service-only launch controls, private provider credentials, atomic daily provider quotas.

## Integration setup still required

The code and database are installed. External search, AI writing, mailbox authorization, and unattended delivery require your own provider accounts and credentials; they have not been tested against live providers in this environment.

1. **Supabase Auth:** enable email/password and configure production SMTP for confirmation messages. Enable Google and add a Google OAuth client ID/secret in Supabase Auth → Providers. Add the deployed web origin and `aisas://auth/callback` to redirect allowlists. Google’s authorized callback is the Supabase Auth callback shown in its dashboard.
2. **Server secrets:** configure `SERPAPI_KEY`, `OPENAI_API_KEY`, `NYLAS_API_KEY`, `NYLAS_CLIENT_ID`, `NYLAS_CLIENT_SECRET`, `CRON_SECRET`, `APP_ORIGIN`, and `NYLAS_REDIRECT_URI` in Supabase Edge Function secrets. Optional `OPENAI_MODEL` defaults to `gpt-4.1-mini`. `APP_ORIGIN` is your deployed web URL. `NYLAS_REDIRECT_URI` must be `https://beslhrcwojbxbqcvsnhy.supabase.co/functions/v1/aisas-api` and match your Nylas application's allowed redirect. Use the US Nylas region (or update the adapter for your region).
3. **Nylas connectors:** configure Google/Microsoft connectors and permitted IMAP providers in Nylas. Yahoo/custom accounts may require app passwords entered directly into Nylas hosted authentication. AISAS does not collect them.
4. **Scheduler:** once sender connections and a test campaign have been verified, invoke the Edge Function every minute using a scheduler with `Authorization: Bearer <CRON_SECRET>` and JSON `{"action":"dispatch"}`. Keep this secret only in the scheduler/vault. The endpoint processes up to 10 messages per invocation. Scheduling is not enabled automatically, and no email was sent during development.
5. **Native distribution:** use an Expo development build or EAS Build with your Apple/Google developer accounts and signing credentials. Bundle IDs are `com.clemxytech.aisas`. `eas.json` includes development, preview, and production profiles. Store binaries have not been signed, installed on devices, or submitted.

For a fresh Supabase project, apply the SQL files in `supabase/migrations/` in order, and deploy `supabase/functions/aisas-api`. The current project's function is deployed with gateway JWT verification disabled because OAuth callbacks and the scheduler do not carry Supabase user JWTs. The handler validates user tokens using `auth.getUser`; OAuth uses one-use states and dispatch uses a separate secret. Service RPCs are revoked from anon/authenticated roles.

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
