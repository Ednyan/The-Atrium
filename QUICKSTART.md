# Quick Start Guide

## 🚀 Get Running in 5 Minutes

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Set Up Supabase

1. Go to https://supabase.com and create a free account
2. Create a new project (choose any region, note the password)
3. Wait for the project to finish setting up (~2 minutes)

### Step 3: Get Your Credentials

1. In Supabase Dashboard, go to **Project Settings** (gear icon) → **API**
2. Copy these two values:
   - **Project URL** (looks like: `https://xxxxx.supabase.co`)
   - **anon public** key (long string starting with `eyJ...`)

### Step 4: Configure Environment

Create a `.env` file in the project root:

```bash
# On Windows PowerShell:
Copy-Item .env.example .env

# On Mac/Linux:
cp .env.example .env
```

Edit `.env` and paste your credentials:
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...your-key-here
```

### Step 5: Set Up Database

1. In Supabase Dashboard, click **SQL Editor** (in the left sidebar)
2. Click **New query**
3. Copy ALL the SQL from `supabase/schema.sql`
4. Paste it into the SQL editor
5. Click **Run** (or press Ctrl+Enter)
6. You should see "Success. No rows returned"

### Step 6: Run the App!

```bash
npm run dev
```

Open http://localhost:3000 in your browser 🎉

### Step 7: Test Multiplayer

1. Open http://localhost:3000 in a second browser or incognito window
2. Enter a different username
3. Watch the avatars move in real-time!

---

## ⚡ Even Faster: Demo Mode

Want to try it without Supabase? The app works in "demo mode" without a database - you just won't have persistence or multiplayer.

Just run:
```bash
npm install
npm run dev
```

No `.env` file needed! But you won't be able to:
- See other users
- Save traces to database
- Have persistence across sessions

---

## 🐛 Troubleshooting

### "Cannot find module 'react'"
Run `npm install` again

### Can't see other users?
- Check your `.env` file has the correct Supabase credentials
- Verify you ran the SQL schema setup
- Open in two different browsers (not just tabs)

### Traces not saving?
- Verify the database schema was set up correctly
- Check the browser console for errors
- Make sure your Supabase URL ends with `.supabase.co`

### Port 3000 already in use?
Edit `vite.config.ts` and change the port:
```ts
server: {
  port: 3001, // or any other port
}
```

---

## 📚 Next Steps

- Read the full [README.md](README.md)
- Check out [SETUP.md](SETUP.md) for detailed setup
- Customize colors in `tailwind.config.js`
- Deploy to Cloudflare Pages or Vercel

---

**Happy building! 🎮✨**
