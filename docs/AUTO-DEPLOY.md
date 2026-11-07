# Auto-deploy: push to GitHub, your app updates itself

Once this is set up, every push to `main` builds SideQuest, runs the tests and, if they pass, sends the code to your Apps Script project and updates your web app at the same link. No more copy-pasting.

It takes about 10 minutes, once.

## 1. Allow scripts to be updated from outside the editor

Open [script.google.com/home/usersettings](https://script.google.com/home/usersettings) and turn **Google Apps Script API** on.

## 2. Log in with clasp on your laptop

clasp is Google's command-line tool for Apps Script.

1. Install **Node.js** (the LTS version) from [nodejs.org](https://nodejs.org).
2. Open a terminal (Windows: *PowerShell*; Mac: *Terminal*) and run:
   ```bash
   npx @google/clasp@2.4.2 login
   ```
   A browser window opens. Sign in with the **same Google account as your SideQuest Sheet** and click *Allow*.
3. That creates a file called `.clasprc.json` in your home folder:
   - Windows: `C:\Users\<you>\.clasprc.json`
   - Mac: `/Users/<you>/.clasprc.json`

   Open it in a text editor and copy **everything** in it.

> ⚠️ `.clasprc.json` lets anyone who has it change your scripts. Only paste it into GitHub's encrypted *Secrets*. Never commit it or share it.

## 3. Find your two IDs

- **Script ID:** in the Apps Script editor, *Project Settings (gear) → IDs → Script ID*.
- **Deployment ID:** *Deploy → Manage deployments*, select your web app and copy its *Deployment ID*.

## 4. Add three secrets to GitHub

In your repository: *Settings → Secrets and variables → Actions → New repository secret*.

| Name | Value |
|---|---|
| `CLASPRC_JSON` | The whole contents of `.clasprc.json` |
| `SCRIPT_ID` | Your Script ID |
| `DEPLOYMENT_ID` | Your Deployment ID |

## 5. Try it

Go to *Actions → Test and deploy → Run workflow*. When it's green, reload your SideQuest bookmark.

## Good to know

- **clasp replaces every file in the Apps Script project** with what's in `dist/`. Files that only exist in the editor (for example an old `History.gs` you already imported) are removed. Your data is safe because it lives in the Sheet, not in the code.
- **Forks and pull requests don't deploy.** GitHub doesn't give secrets to them, so the deploy step is skipped.
- **If the login expires** (rare), run `npx @google/clasp@2.4.2 login` again and update the `CLASPRC_JSON` secret.
- **Deploying from your laptop instead:** put `{"scriptId":"YOUR_SCRIPT_ID","rootDir":"dist"}` in a `.clasp.json` file at the repo root (it's git-ignored), then run `npm run push`.
