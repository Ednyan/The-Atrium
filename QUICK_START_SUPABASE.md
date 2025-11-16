# ⚡ Quick Start - Get Multiplayer Working in 10 Minutes

## The Problem
- ❌ Empty lobby on refresh
- ❌ Can't see other players
- ❌ Traces disappear

## The Solution
Set up Supabase (free!) to enable:
- ✅ Real-time multiplayer
- ✅ Persistent traces
- ✅ Cloud database

---

## 🚀 Express Setup (10 Minutes)

### 1. Create Supabase Account
👉 [https://supabase.com](https://supabase.com) → Sign up (FREE)

### 2. Create Project
- Click "New Project"
- Name: `digital-lobby`
- Set a password (save it!)
- Choose region (closest to you)
- Plan: **Free**
- Wait 2 minutes ⏳

### 3. Run Database Schema
- Dashboard → SQL Editor → New query
- Copy **ALL** of `supabase/schema.sql`
- Paste and click "Run"
- ✅ Should see "Success"

### 4. Get Credentials
- Dashboard → Settings ⚙️ → API
- Copy **Project URL**: `https://xxxxx.supabase.co`
- Copy **anon public** key: `eyJhbG...`

### 5. Create `.env` File
In your project root (`Digital_Lobby`), create `.env`:

```bash
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbG...
```

**Important:**
- No quotes
- No spaces around `=`
- Use YOUR actual values

### 6. Enable Realtime
- Dashboard → Database → Replication
- Find `traces` table
- Toggle "Enable" ✅

### 7. Restart Server
```bash
# Stop current server (Ctrl+C)
npm run dev
```

### 8. Test It! 🎉

**Test Persistence:**
1. Create a trace
2. Refresh page (F5)
3. ✅ Trace still there!

**Test Multiplayer:**
1. Open 2 browser tabs
2. Different usernames
3. ✅ See both players!

---

## ✅ Success Checklist

- [ ] Supabase account created
- [ ] New project created (waited for setup)
- [ ] Ran `schema.sql` successfully
- [ ] Got Project URL
- [ ] Got anon key
- [ ] Created `.env` file
- [ ] Added credentials (no quotes!)
- [ ] Enabled Realtime for `traces`
- [ ] Restarted dev server
- [ ] Tested refresh (traces persist)
- [ ] Tested 2 tabs (multiplayer works)

---

## 🆘 Troubleshooting

### Still see "Using mock mode"?
```bash
# Check .env file exists
ls -la .env  # Should see .env file

# Check contents (no quotes!)
cat .env

# Restart server
npm run dev
```

### "Failed to fetch"?
- ✅ Check URL is correct (includes `https://`)
- ✅ Check key is complete (very long string)
- ✅ Project is active in Supabase dashboard

### Traces save but don't sync?
- ✅ Enable Realtime in Database → Replication
- ✅ Check browser console for errors

---

## 📚 Detailed Guides

- **Full setup**: `SUPABASE_SETUP_GUIDE.md`
- **Why it's empty**: `WHY_EMPTY_EXPLANATION.md`
- **Saving system**: `TRACE_SAVING_SYSTEM.md`

---

## 🎮 After Setup Works

Your app will have:
- ✅ Real-time multiplayer (see other players move)
- ✅ Persistent traces (survive page refresh)
- ✅ Cloud database (access from anywhere)
- ✅ Media uploads (images, videos, audio)
- ✅ Transform saves (position, scale, rotation)
- ✅ Automatic sync (all tabs updated instantly)

---

**🚀 Ready? Let's go!** Start at step 1 above or read `SUPABASE_SETUP_GUIDE.md` for details.
