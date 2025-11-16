# 🚀 Supabase Setup Guide - Get Real-time Multiplayer Working!

## Why You Need This

Right now, your app is running in **mock mode** because Supabase isn't configured. This means:
- ❌ Traces disappear when you refresh the page
- ❌ Multiple browser tabs don't see each other
- ❌ No real-time multiplayer
- ❌ Data isn't persisted to a database

After setup:
- ✅ Traces persist across sessions
- ✅ Multiple users see each other in real-time
- ✅ All data saved to cloud database
- ✅ Real-time synchronization

---

## Step 1: Create a Supabase Account (FREE)

1. Go to [https://supabase.com](https://supabase.com)
2. Click **"Start your project"**
3. Sign up with GitHub, Google, or email (100% free tier available)

---

## Step 2: Create a New Project

1. Once logged in, click **"New Project"**
2. Fill in the details:
   - **Project Name:** `digital-lobby` (or any name you like)
   - **Database Password:** Create a strong password (save it somewhere!)
   - **Region:** Choose closest to you (e.g., `us-east-1`, `eu-west-1`)
   - **Pricing Plan:** Select **"Free"** (includes everything you need!)

3. Click **"Create new project"**
4. ⏳ Wait 2-3 minutes for the project to be provisioned

---

## Step 3: Run the Database Schema

Once your project is ready:

1. In your Supabase dashboard, click **"SQL Editor"** in the left sidebar (📝 icon)
2. Click **"New query"**
3. Copy the **ENTIRE contents** of `supabase/schema.sql` from your project
4. Paste it into the SQL editor
5. Click **"Run"** (or press `Ctrl+Enter`)
6. ✅ You should see "Success. No rows returned"

This creates:
- `traces` table with all fields (position, scale, rotation, content, etc.)
- Indexes for fast queries
- Row Level Security policies
- Storage bucket for media files
- Real-time subscriptions

---

## Step 4: Get Your API Credentials

1. In Supabase dashboard, click **"Settings"** (⚙️ icon in bottom left)
2. Click **"API"** in the settings menu
3. You'll see two important values:

### Project URL
```
https://xxxxxxxxxxxxx.supabase.co
```
Copy this entire URL

### Anon/Public Key
Under "Project API keys", find **"anon" "public"**:
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFz...
```
Copy this long key (it's safe to use in frontend code)

---

## Step 5: Create Your `.env` File

1. In your project root (`Digital_Lobby`), create a new file named `.env` (no extension)
2. Add your credentials:

```bash
# Supabase Configuration
VITE_SUPABASE_URL=https://xxxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFz...
```

**Replace** the values with your actual credentials from Step 4.

### Important Notes:
- ⚠️ **DO NOT** add spaces around the `=` sign
- ⚠️ **DO NOT** add quotes around the values
- ⚠️ The file must be named exactly `.env` (starts with a dot)
- ✅ This file is already in `.gitignore` so your keys won't be committed

---

## Step 6: Enable Realtime for Traces Table

For multiplayer to work in real-time:

1. In Supabase dashboard, go to **"Database"** → **"Replication"**
2. Find the **`traces`** table in the list
3. Toggle the **"Enable"** switch next to it
4. ✅ Realtime is now active!

---

## Step 7: Restart Your Dev Server

1. Stop your current dev server (press `Ctrl+C` in the terminal)
2. Start it again:
   ```bash
   npm run dev
   ```

3. Look for this in the console output:
   ```
   Supabase client initialized successfully
   ```

If you see:
```
Supabase credentials not found. Using mock mode.
```
Then your `.env` file isn't being read correctly. Check:
- File is named exactly `.env` (not `.env.txt`)
- File is in the project root (same folder as `package.json`)
- No spaces around `=` in the file
- Dev server was restarted after creating the file

---

## Step 8: Test It Out! 🎉

### Test 1: Persistence
1. Open the app
2. Create a trace (click "Leave Trace" button)
3. Refresh the page (F5)
4. ✅ The trace should still be there!

### Test 2: Multiplayer
1. Open the app in one browser tab
2. Open the app in another browser tab (or different browser)
3. Enter different usernames in each tab
4. ✅ You should see both players' avatars!
5. Move in one tab - the other should see you move in real-time
6. Create a trace in one tab - it should appear in the other tab

### Test 3: Database Check
1. Go to Supabase dashboard
2. Click **"Table Editor"**
3. Click the **`traces`** table
4. ✅ You should see your traces listed with all their data!

---

## Troubleshooting

### "Supabase credentials not found"
- ✅ Check `.env` file exists in project root
- ✅ Restart dev server after creating `.env`
- ✅ No quotes or spaces in `.env` file
- ✅ File starts with a dot: `.env` not `env`

### "Failed to fetch" or connection errors
- ✅ Check Project URL is correct (including `https://`)
- ✅ Check anon key is complete (very long string)
- ✅ Check your internet connection
- ✅ Verify Supabase project is active (not paused)

### Traces save but don't appear for other users
- ✅ Enable Realtime replication for `traces` table
- ✅ Check Row Level Security policies are applied
- ✅ Verify both tabs are connected (check browser console)

### "Permission denied" errors
- ✅ Rerun the `schema.sql` file to ensure RLS policies are set
- ✅ Check the SQL Editor for any errors during schema creation

### Media uploads failing
- ✅ Check Storage bucket `traces` exists
- ✅ Verify storage policies are applied (in `schema.sql`)
- ✅ For local testing, you can use URLs instead of file uploads

---

## Free Tier Limits

Supabase Free tier includes:
- ✅ **500 MB database** - Plenty for thousands of traces!
- ✅ **1 GB file storage** - Good for many images/videos
- ✅ **2 GB bandwidth/month** - Fine for development
- ✅ **Unlimited API requests**
- ✅ **Up to 500,000 realtime messages/month**
- ✅ Project pauses after 1 week of inactivity (wakes up instantly when accessed)

Perfect for testing and small-scale deployment!

---

## Next Steps After Setup

Once Supabase is working:

1. **Invite friends** - Share your URL and see multiplayer in action!
2. **Test transforms** - Move/scale/rotate traces and see them persist
3. **Upload media** - Try image, video, and audio traces
4. **Check the database** - Browse your data in Supabase Table Editor
5. **Deploy to production** - Use Vercel/Netlify with the same `.env` vars

---

## Security Notes

✅ **Safe to commit:**
- `.env.example` (template with no real keys)
- All source code

❌ **NEVER commit:**
- `.env` (contains your actual keys)
- Database password
- Service role key (if you get one later)

The **anon key** is safe to use in frontend code - it's designed for public access with Row Level Security protecting your data.

---

## Example `.env` File

```bash
# Supabase Configuration
# Get these from: Supabase Dashboard → Settings → API

VITE_SUPABASE_URL=https://abcdefghijklmnop.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiY2RlZmdoaWprbG1ub3AiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTYzOTU5MTk5MCwiZXhwIjoxOTU1MTY3OTkwfQ.abc123xyz789-example-key-do-not-use-this-one
```

**Important:** Replace with YOUR actual values!

---

## Need Help?

If you run into issues:

1. Check the browser console (F12) for error messages
2. Check the Supabase dashboard logs: **Logs** → **Edge Functions**
3. Verify the schema was created: **Table Editor** → should see `traces` table
4. Test the connection in browser console:
   ```javascript
   console.log(import.meta.env.VITE_SUPABASE_URL)
   // Should log your URL, not undefined
   ```

---

## Summary Checklist

- [ ] Created Supabase account
- [ ] Created new project
- [ ] Ran `schema.sql` in SQL Editor
- [ ] Copied Project URL from Settings → API
- [ ] Copied anon key from Settings → API
- [ ] Created `.env` file in project root
- [ ] Added credentials to `.env`
- [ ] Enabled Realtime for `traces` table
- [ ] Restarted dev server
- [ ] Tested persistence (refresh page)
- [ ] Tested multiplayer (two tabs)
- [ ] Verified data in Table Editor

---

🎉 **Once complete, you'll have a fully functional real-time multiplayer lobby with persistent traces!**
