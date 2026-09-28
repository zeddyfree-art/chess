# Setting up Google Drive sync (for the site owner)

Drive sync lets every user connect their own Google Drive, so the same repertoires and
training progress are available on all their devices, with a dated backup every day.
Each user's data stays in **their own** Drive (a folder called `Repertoire app`); the
site owner never sees it.

To make this work, the site needs a (free) Google OAuth **client ID**. You create it
once; it takes about 10 minutes. A client ID is not a secret — it is meant to be public.

## 1. Create a Google Cloud project

1. Open <https://console.cloud.google.com/> and sign in with your Google account.
2. Top left, click the project picker → **New project**. Name it e.g. `Repertoire app` → **Create**,
   and make sure the new project is selected.

## 2. Enable the Google Drive API

Open <https://console.cloud.google.com/apis/library/drive.googleapis.com> and click **Enable**.

## 3. Configure the consent screen (Google Auth Platform)

1. Open <https://console.cloud.google.com/auth/overview> → **Get started**.
2. App information: app name `Repertoire`, your e-mail as support e-mail → **Next**.
3. Audience: **External** → **Next**. Contact information: your e-mail → **Next**. Agree → **Create**.
4. Left menu **Data access** → **Add or remove scopes** → filter on `drive.file` → tick
   `.../auth/drive.file` ("See, edit, create and delete only the specific Google Drive files you use with this app")
   → **Update** → **Save**.

`drive.file` is a *non-sensitive* scope: Google does not require an app review for it.

## 4. Create the client ID

1. Left menu **Clients** → **Create client**.
2. Application type: **Web application**. Name: `Repertoire web`.
3. **Authorized JavaScript origins** → **Add URI**: `https://<your-github-user>.github.io`
   (for this repository: `https://zeddyfree-art.github.io`). Add `http://localhost:5173` too if you
   develop locally. No redirect URIs are needed.
4. **Create**, and copy the **Client ID** (it ends in `.apps.googleusercontent.com`).

## 5. Decide who may sign in

Left menu **Audience**:

- While the app is in **Testing**, only the Google accounts listed under **Test users** can connect
  (add yourself and your family members).
- Click **Publish app** to let anyone use it. Because the app only uses `drive.file`, no verification is required.

## 6. Give the client ID to the site

Either of these:

- **GitHub repository variable** (no code change): repository **Settings → Secrets and variables → Actions →
  Variables → New repository variable**, name `GOOGLE_CLIENT_ID`, value = the client ID. Then re-run the
  *Build & deploy* workflow (Actions tab → Build & deploy → Run workflow).
- Or put it in `DEFAULT_CLIENT_ID` in `src/lib/drive.ts` and push.

To try it before publishing, paste the client ID under **Settings → Sync & automatic backup** in the app;
that only affects the browser you paste it in.

## How it behaves

- Each device connects once via **Settings → Connect Google Drive** (or "Load my data from Google Drive"
  when starting on a new device).
- Changes are uploaded a few seconds after you make them; other devices pick them up when you switch back to
  the app (and every 5 minutes).
- Google gives browser apps one-hour sessions. After a longer break the cloud icon turns amber; click it
  (or **Reconnect**) and sync continues. Local changes are never lost in the meantime.
- If two devices changed the same repertoire while offline, the most recent edit wins, but training progress
  is merged card by card. Deletions are remembered, so a pruned branch stays pruned everywhere.
