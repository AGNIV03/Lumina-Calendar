# Google setup (one-time, ~10 minutes)

Lumina talks directly to Google's Calendar and Tasks APIs from your PC. For that it
needs an **OAuth Client ID** that belongs to *you* — nothing is shared with anyone else.

## 1. Create a Google Cloud project
1. Open <https://console.cloud.google.com/projectcreate> (sign in with any Google account).
2. Name it anything, e.g. **Lumina Calendar** → **Create**.
3. Make sure the new project is selected in the top bar.

## 2. Enable the two APIs
1. Open <https://console.cloud.google.com/apis/library/calendar-json.googleapis.com> → **Enable**.
2. Open <https://console.cloud.google.com/apis/library/tasks.googleapis.com> → **Enable**.

## 3. Configure the consent screen
1. Open <https://console.cloud.google.com/auth/branding>.
2. If prompted to configure, choose **External**, set:
   - App name: `Lumina Calendar`
   - User support email / developer email: your email
3. Save through the steps (scopes can be left empty — the app requests them at sign-in).

## 4. Let your accounts in (pick ONE of these)
- **Option A — Publish (recommended):** In *Google Auth Platform → Audience*, click
  **Publish app**. Any Google account can then sign in. You'll see an
  *"unverified app"* warning during sign-in — that's expected for a personal app:
  click **Advanced → Go to Lumina Calendar (unsafe)**. Refresh tokens never expire.
- **Option B — Testing mode:** Add each Google account you want to use under
  **Audience → Test users**. Caveat: Google expires sign-ins after **7 days** in
  testing mode, so you'd have to re-login weekly. Prefer Option A.

## 5. Create the OAuth client
1. Open <https://console.cloud.google.com/apis/credentials>.
2. **Create credentials → OAuth client ID**.
3. Application type: **Desktop app** → **Create**.
4. Copy the **Client ID** (`…apps.googleusercontent.com`) and **Client secret** (`GOCSPX-…`).

## 6. Connect Lumina
1. Start Lumina → the setup screen opens (or ⚙ Settings).
2. Paste the Client ID and Client secret → **Save credentials**.
3. Click **Add Google account** → your browser opens → pick the account → approve.
4. Repeat *Add Google account* for every additional Google account you want.

Your credentials and tokens are stored only on this PC, in
`%APPDATA%\lumina-calendar` (tokens encrypted with Windows DPAPI).
