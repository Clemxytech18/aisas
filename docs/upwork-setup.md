# Upwork Scouting setup and operation

AISAS connects each signed-in user's Upwork account to the official remote MCP server at `https://mcp.upwork.com/mcp`. Running `codex mcp add Upwork --url https://mcp.upwork.com/mcp` connects a Codex installation; it does not connect your AISAS customers. The application implements its own per-user OAuth flow.

## Start using it

1. Open **Upwork Scouting → Connect Upwork** and authorize the account on Upwork's site.
2. Return to AISAS. Select **Load my job feed**, or enter a query and select **Search jobs**. On a native app, return to the app and select **Refresh connection & history** after browser authorization.
3. Open **View job details**, or select **Scout this job** directly. Research progress is saved after each step; **Resume research** continues an interrupted run.
4. Review the result, source excerpts and search trail. Results distinguish email/phone contacts, website/social-only matches and **Nothing found**. Unavailable providers are reported as interrupted research rather than a false negative.
5. When an email is found, **Apply by email** opens an editable composer. Choose a connected AISAS mailbox and optionally an audience profile, draft with AI or write manually, review the text, confirm off-platform contact is permitted and select **Send email application**. The profile's sender name and optional signatory are appended.
6. **Applications** records provider acceptance, rejection or an uncertain send. This is direct email history; it is not a record of Upwork proposals. **Apply on Upwork** opens the original job for on-platform applications.

## Required services

- Each user needs their own Upwork account with MCP job-search/read access. AISAS discovers the actual tool catalog after authorization. It never guesses tool names, silently substitutes scraped feeds, submits proposals or invokes write tools.
- The existing AISAS `SERPAPI_KEY` and `OPENAI_API_KEY` are reused for public-source research and drafting.
- Direct email uses the user's connected AISAS email account and the existing server-side `NYLAS_API_KEY`. Users supply their own custom-domain mail credentials through the existing mailbox connection flow.
- No Upwork password or personal access token is entered in AISAS.

## Required OAuth application registration

AISAS requires a real, approved and enabled **Upwork OAuth application client ID**. A public JSON metadata document, the MCP endpoint URL, an AISAS user ID, or an Upwork account ID is not a substitute. The previous URL-based fallback produced **Client not found or disabled** and has been removed.

Upwork's discovery metadata advertises PKCE and client metadata support, but the attempted AISAS metadata URL was rejected by its authorization endpoint. Publishing a metadata document did not establish an approved AISAS client. AISAS now blocks authorization until an opaque registered client ID is configured and displays the setup requirement in the app.

### Register AISAS and configure its credentials

1. Sign in to [Upwork API keys](https://www.upwork.com/developer/keys). Create/request an OAuth application for **AISAS By ClemxyTech**. If one already exists, confirm that its client is approved and enabled. Upwork controls application approval and account/API access.
2. Use `https://aisas.clemxytech.com` as the application/website URL. Describe the application as a user-authorized integration that reads the user's accessible Upwork job feed, job searches and job details through the official MCP server.
3. Register this exact OAuth 2 callback URL (no trailing slash):

   `https://beslhrcwojbxbqcvsnhy.supabase.co/functions/v1/upwork/oauth/callback`

4. Request the job search/details read permissions required by the MCP server. This application uses authorization-code OAuth with S256 PKCE. Upwork must permit that flow and the registered callback.
5. Wait for Upwork approval/activation, then copy the application's actual OAuth **client ID** and, if issued/required, its **client secret**. Do not use your Upwork account ID, the MCP URL or a metadata-document URL as the client ID.
6. Open [Supabase Vault](https://supabase.com/dashboard/project/beslhrcwojbxbqcvsnhy/settings/vault) and create/update these exact secret names:

   | Vault secret name | Value |
   | --- | --- |
   | `aisas_UPWORK_CLIENT_ID` | Approved, enabled Upwork OAuth application client ID |
   | `aisas_UPWORK_CLIENT_SECRET` | The application's client secret, when required by Upwork |

   Do not put the client secret in GitHub, Expo public variables, browser code or chat. These are shared AISAS application credentials; each customer still authorizes their own Upwork account separately.
7. In AISAS, select **Refresh connection & history**, then **Connect Upwork**. No website redeploy is required after saving the credentials. Restart authorization to obtain a fresh state/PKCE pair; do not reuse a failed provider URL.
8. If Upwork still reports **Client not found or disabled**, verify that the actual client ID was copied correctly, the application is approved/enabled, and the OAuth product/environment matches Upwork's advertised authorization endpoint. If **redirect mismatch** appears, compare the registered callback character for character. Upwork support must resolve a provider-disabled or unapproved application.

A user must complete authorization to verify the account's available tools. If authorization succeeds but no read-only jobs tool is exposed, verify MCP/API job access with Upwork. If search/list tools exist without a personalized feed, AISAS labels their results **Latest jobs**. It does not fabricate a feed or silently scrape a signed-in account.

Provider discovery references:

- <https://mcp.upwork.com/.well-known/oauth-protected-resource>
- <https://mcp.upwork.com/.well-known/oauth-authorization-server>

## Research coverage and contact rules

The whole job post informs the search: explicit business/professional names, domains, product brands, project requirements, distinctive wording and linked resources. AI plans searches from literal source-backed clues, searches Google and Bing through SerpAPI, reads public websites/contact/about pages, examines indexed directories/social profiles and matching reposts, and performs a second clue-expansion pass. Each run is bounded to 20 searches, 30 public pages and 40 research steps. Private pages, robots exclusions, DNS/IP restrictions, search quotas and authentication walls are respected; no tool can search every page of the internet or guarantee a contact.

Contacts require literal source evidence and a supported client/company identity. Generic titles, skills, city names, guessed email permutations and ambiguous identities do not qualify. LinkedIn and other social pages may be returned from indexed public evidence; AISAS does not bypass their login walls. AI instructions embedded in job posts/pages/tool descriptions are treated as untrusted data.

Upwork restricts sharing/using contact details before a contract starts, subject to its applicable exceptions. Finding an email does not create permission to contact that client. The composer requires the sender to confirm that off-platform contact is permitted. Read [Upwork's rules](https://www.upwork.com/legal) and use the on-platform application link when needed.

## Security and delivery

- Job records, research and applications are user-owned under RLS and never enter AISAS's shared prospect pool.
- Upwork access/refresh tokens are encrypted in Supabase Vault, accessed only by server-role RPCs, and never returned to a browser/mobile client. OAuth state is hashed, single-use and expires in ten minutes; PKCE verifiers are server-only.
- Token refresh uses a per-account lease and compares the previous access token before storing a rotation, preventing stale refreshes from restoring a disconnected/replaced connection.
- Disconnect revokes provider tokens and erases local token/state records while retaining private research/history. Account deletion cascades to all Upwork records and erases encrypted Vault payloads.
- An application is durably reserved before provider submission. Concurrent/repeated clicks cannot send a second application for that job. Known rejections allow up to three reviewed attempts; uncertain/accepted sends never automatically retry. Stale in-flight sends become uncertain after five minutes when history refreshes.
- `sent` means accepted by the sending provider, not confirmed inbox delivery, a read, or an Upwork proposal. Ambiguous outcomes stay visible and require checking the sending mailbox.
- Server quotas per user/day: 20 connection attempts, 200 feed/search/detail reads, 40 scouts, 100 AI drafts and 50 direct application attempts. Search-provider and sending-account limits also apply. These one-off applications are separate from campaign daily quotas.

## Validation

`npm test` covers OAuth parameters, real-shaped MCP responses, JSON/SSE transport, read-only tool selection, schema validation, grounded identity/contact evidence, deep multi-step research and explicit application review. `tests/upwork-rls.sql` exercises two-user isolation, private token/config access, Vault cleanup, OAuth expiry/replay, refresh/scout leases, mailbox ownership, email evidence checks, application idempotency and quota enforcement inside a rolled-back fixture transaction. Browser checks mock every external service and never send real email.
