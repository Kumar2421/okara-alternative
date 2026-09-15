# Google Cloud Console setup

Everything Google-related in this app — Gmail send/reply tracking, GA4 +
Search Console (Traffic tab), and automatic Google Cloud API key creation —
runs through **one OAuth client**. Google Cloud API-key-only features
(Places, Custom Search, Knowledge Graph) don't need OAuth at all, just a
plain API key.

This doc is the real setup path, matching exactly what's implemented in
`lib/domain/shared/gmailOAuth.ts`, `googleAnalyticsOAuth.ts`,
`googleCloudOAuth.ts`, and their routes under `app/api/auth/`.

## 1. Create or pick a GCP project

[console.cloud.google.com](https://console.cloud.google.com) → project
picker (top left) → **New Project**, or reuse an existing one. Note the
**project ID** (not the display name) — you'll need it later if you use
the in-app "create API key automatically" flow.

## 2. Enable the APIs you actually plan to use

Console → **APIs & Services → Library**, search and **Enable** each one you
need:

| API | Powers | Auth method |
|---|---|---|
| [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com) | Leads → send outreach + reply tracking | OAuth |
| [Google Analytics Data API](https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com) | Traffic tab — GA4 sessions/users/pageviews | OAuth |
| [Google Analytics Admin API](https://console.cloud.google.com/apis/library/analyticsadmin.googleapis.com) | Traffic tab — finds your GA4 property automatically | OAuth |
| [Google Search Console API](https://console.cloud.google.com/apis/library/searchconsole.googleapis.com) | Traffic tab — clicks/queries/rankings | OAuth |
| [API Keys API](https://console.cloud.google.com/apis/library/apikeys.googleapis.com) | Settings → "create key automatically" | OAuth (cloud-platform) |
| [Places API (New)](https://console.cloud.google.com/apis/library/places.googleapis.com) | Leads → Local Business mode | Plain API key |
| [Custom Search JSON API](https://console.cloud.google.com/apis/library/customsearch.googleapis.com) | Leads → extra search source | Plain API key + a [Programmable Search Engine](https://programmablesearchengine.google.com/controlpanel/all) ID |
| [Knowledge Graph Search API](https://console.cloud.google.com/apis/library/kgsearch.googleapis.com) | Competitor Analysis enrichment | Plain API key |

Only enable what you're actually going to connect in Settings — an
unenabled API just means that one feature shows a real "not connected"
state instead of failing silently.

## 3. Configure the OAuth consent screen

Console → **APIs & Services → OAuth consent screen** (only needed once per
project).

- **User type**: External (unless this is a Google Workspace org and you
  pick Internal).
- **Scopes**: you don't need to pre-add scopes here — this app requests
  them per-flow at connect time (`gmail.send`, `gmail.readonly`,
  `analytics.readonly`, `webmasters.readonly`, `cloud-platform`,
  `userinfo.email`). Google may still ask you to justify sensitive/
  restricted scopes if you try to publish for real users — for local/
  personal use, **Testing** publishing status is enough and skips that
  review entirely.
- **Test users**: while in Testing status, only the Google accounts you
  list here can complete the consent screen. **Add your own Google
  account** here or every connect attempt will fail at Google's
  "access blocked" page before it ever reaches this app.

## 4. Create the OAuth Client ID

Console → **APIs & Services → Credentials → + Create Credentials →
OAuth client ID → Application type: Web application**.

**Authorized JavaScript origins** (not required for this app's flow, but
harmless to add):
```
http://localhost:3000
```

**Authorized redirect URIs** — add all three; every OAuth feature shares
this one client:
```
http://localhost:3000/api/auth/gmail/callback
http://localhost:3000/api/auth/google-analytics/callback
http://localhost:3000/api/auth/google-cloud/callback
```

If you'll run this somewhere other than `localhost:3000` (a real domain,
a different port), add that origin/those callback URLs too — same client,
more rows, no separate client needed. Real domain example:
```
https://yourdomain.com/api/auth/gmail/callback
https://yourdomain.com/api/auth/google-analytics/callback
https://yourdomain.com/api/auth/google-cloud/callback
```

Click **Create**. Copy the **Client ID** and **Client Secret** shown —
you won't see the secret again without regenerating it.

## 5. Paste the credentials into the app

Settings → **API Credentials → Gmail card** → paste Client ID + Client
Secret → **Save to .env.local**.

This writes `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` into `.env.local` —
the name is historical (Gmail was the first OAuth feature built), but
these two values back every Google OAuth flow in this app, not just
Gmail.

**Restart the dev server** (`Ctrl+C`, then `npm run dev`). Node only reads
`.env.local` at process startup — saving alone doesn't activate it, and
the Gmail card tells you this explicitly if you try to connect too early.

## 6. Connect each feature

Reload Settings → API Credentials. The Gmail, Google Analytics/Search
Console, and Google Cloud cards should now show a real **Connect** button
instead of the "set up your OAuth client" form. Click each you want —
every flow re-requests consent (`prompt=consent`) so it always gets a
real refresh token, and if Google doesn't return one, the callback tells
you to revoke the app's access under your [Google Account → Security →
Third-party access](https://myaccount.google.com/connections) and
reconnect.

## Google Cloud API key — two ways

- **Paste one you already have**: create it yourself in Console → APIs &
  Services → Credentials, restrict it to Places/Custom Search/Knowledge
  Graph, paste the key string into the Google Cloud card.
- **Create one from the app**: connect the "Or create one automatically"
  OAuth flow (needs API Keys API enabled + your account has the **API
  Keys Admin** IAM role on the project), enter your project ID, click
  **Create key**. The app creates a key restricted to exactly Places +
  Custom Search + Knowledge Graph and saves it — no copy-paste.

## Common errors

| Error | Real cause |
|---|---|
| `redirect_uri_mismatch` | The callback URL Google received doesn't exactly match one in step 4 — check the port and path character-for-character. |
| "access blocked: this app is currently being tested" | Your Google account isn't in the Test users list (step 3). |
| "GMAIL_CLIENT_ID not set" | `.env.local` wasn't saved, or the server wasn't restarted after saving it. |
| "No refresh token returned" | You'd already granted this app access before and Google skipped re-issuing one — revoke access at [myaccount.google.com/connections](https://myaccount.google.com/connections) and reconnect. |
| 403 on a Google API call after connecting | The specific API for that feature isn't enabled on the project (step 2), or (for the automatic key creation) your account lacks the API Keys Admin role. |
