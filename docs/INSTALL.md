# Install SideQuest (about 10 minutes, no coding)

You need a Google account (the one your wages emails and class calendar are in) and a computer.
You'll copy 3 files into Google, press a few buttons, and get a link to your own SideQuest.

> **Your data stays yours.** SideQuest runs inside your own Google account and saves everything in a Google Sheet in your own Drive. Nobody else, including whoever made SideQuest, can see it.

---

## Step 1. Download the 3 files

Click each link. It downloads straight away:

- [Code.gs](https://github.com/mbinarif12/sidequest/releases/latest/download/Code.gs)
- [Index.html](https://github.com/mbinarif12/sidequest/releases/latest/download/Index.html)
- [appsscript.json](https://github.com/mbinarif12/sidequest/releases/latest/download/appsscript.json)

**You should see:** 3 files in your Downloads folder. You'll open each one in a text editor later (Notepad on Windows, TextEdit on Mac).

---

## Step 2. Make your SideQuest Sheet

1. Go to **[sheets.new](https://sheets.new)**. A blank Google Sheet opens.
2. Click **Untitled spreadsheet** (top left) and rename it **SideQuest**.

**You should see:** an empty Sheet called SideQuest.

---

## Step 3. Open the script editor

In the Sheet's menu: **Extensions → Apps Script**.

**You should see:** a new tab with "Untitled project" at the top and a file called **Code.gs** on the left, containing `function myFunction() {}`.

Click **Untitled project** and rename it **SideQuest**.

---

## Step 4. Paste the code (3 files)

### 4a. Code.gs
1. Open the **Code.gs** you downloaded in Notepad or TextEdit.
2. Select everything (**Ctrl+A**, Mac: **Cmd+A**) and copy it (**Ctrl+C** / **Cmd+C**).
3. In Apps Script, click **Code.gs** on the left, select everything in it and delete it, then paste (**Ctrl+V** / **Cmd+V**).

### 4b. Index
1. In Apps Script, click the **+** next to *Files* → **HTML**.
2. Name it exactly **Index** (capital I; Google adds `.html` itself) and press Enter.
3. Delete what's inside, then copy and paste everything from the downloaded **Index.html**.

> Index.html has a large block of random-looking letters in the middle. That's normal: it's the app, packed so Google can't change it on the way to your browser.

### 4c. appsscript.json
1. Click the **⚙️ gear (Project Settings)** on the far left.
2. Tick **Show "appsscript.json" manifest file in editor**.
3. Go back to the **< > (Editor)** icon. A file called **appsscript.json** is now on the left. Click it.
4. Delete what's inside, then copy and paste everything from the downloaded **appsscript.json**.

Press **💾 Save** (or **Ctrl+S** / **Cmd+S**).

**You should see:** three files on the left (**Code.gs**, **Index.html**, **appsscript.json**) and no red error message after saving.

---

## Step 5. Run Set up

1. Click **Code.gs** on the left.
2. In the toolbar at the top, there's a dropdown showing a function name. Choose **setup**.
3. Press **▶ Run**.

Google now asks for permission (only the first time):

1. **Authorization required** → click **Review permissions**.
2. Choose your Google account.
3. You'll see **"Google hasn't verified this app"**. That's expected: it's your own copy of the code, not an app from a store. Click **Advanced**, then **Go to SideQuest (unsafe)**.
4. Read the list (Gmail, Calendar, Drive, Sheets) and click **Allow**.

**You should see:** at the bottom, *Execution started*, then *Execution completed*. Back in your Sheet, new tabs appear: Students, Lessons, Statements, Payslips, Processed, Settings, Todos.

> **Why it needs these permissions:** Gmail to read the wages emails and payslips, Calendar to see your classes, Drive to save payslip PDFs, Sheets to store everything. It only ever acts inside your own account.

---

## Step 6. Get your SideQuest link

1. In Apps Script, top right: **Deploy → New deployment**.
2. Next to *Select type*, click the **⚙️ gear → Web app**.
3. Fill in:
   - **Description:** SideQuest
   - **Execute as:** Me
   - **Who has access:** **Only myself** (important: this keeps it private)
4. Click **Deploy**. If asked to authorize again, repeat the steps from Step 5.
5. Copy the **Web app URL** (it ends in `/exec`).

**You should see:** a link like `https://script.google.com/macros/s/…/exec`. Open it in a new tab and **bookmark it**. That's your SideQuest.

---

## Step 7. First time in SideQuest

1. **Profile:** your name, your rates (and the date they start), and the email address your wages emails come from (for GoMappEd, the admin's address).
2. **Students:** add each student with their name, subject, course code (if you know it) and package size.
3. **Your calendar:** SideQuest finds classes in your Google Calendar whose title contains the student's name or course code, e.g. *"Sadhbh – Maths"*. Press **Sync calendar**.
4. **Payslips:** press **Find old payslip PDFs** to bring in past payslips from your email.

From then on, SideQuest checks your email every Monday and Tuesday morning and logs classes from your calendar once they've ended.

---

## Updating to a new version

Your data lives in the Sheet, so updating never touches it.

1. Download the 3 files again (Step 1).
2. In Apps Script, replace the contents of **Code.gs**, **Index.html** and **appsscript.json** with the new ones (Step 4), then **Save**.
3. **Deploy → Manage deployments** → select your web app → **✏️ Edit** → *Version*: **New version** → **Deploy**.

Your bookmark keeps working. If the new version mentions new tabs or settings, run **setup** once more (Step 5).

---

## If something goes wrong

| What you see | What to do |
|---|---|
| **"Script function not found: setup"** | Code.gs wasn't saved, or the paste was incomplete. Paste it again, press Save, and pick *setup* from the dropdown again. |
| **"Exception: … Drive is not defined"** | appsscript.json wasn't replaced (Step 4c). Paste it in, save, run setup again. |
| **A blank page or "SideQuest hit an error"** | Index.html wasn't pasted in full, or was named something other than *Index*. Paste it again, save, then **Deploy → Manage deployments → Edit → New version → Deploy**. |
| **"You need access" / "Sorry, unable to open the file"** | You're signed into a different Google account in that browser. Open the link in the account you installed with. |
| **"The Students tab is missing"** | Run **setup** again (Step 5). |
| **No classes appear** | Check the class events' titles contain the student's name (as written in Students) or their course code, then press **Sync calendar**. |
| **Wages emails aren't picked up** | Check the sender's address in **Profile** matches the one on the emails exactly, then press **Check email**. |

Still stuck? Ask whoever shared SideQuest with you, and include a screenshot of the message you see.

---

*For developers: automatic deploys from GitHub are described in [AUTO-DEPLOY.md](AUTO-DEPLOY.md); build and test commands are in the [README](../README.md#development).*
