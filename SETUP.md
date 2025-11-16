# The Lobby - Setup Checklist

## ✅ Initial Setup

- [ ] Clone the repository
- [ ] Run `npm install`
- [ ] Create Supabase account at https://supabase.com

## ✅ Supabase Configuration

- [ ] Create a new Supabase project
- [ ] Copy `.env.example` to `.env`
- [ ] Add Supabase URL to `.env`
- [ ] Add Supabase Anon Key to `.env`
- [ ] Run SQL schema from `supabase/schema.sql` in Supabase SQL Editor
- [ ] Verify tables were created in Table Editor
- [ ] Enable Realtime for `traces` table

## ✅ Development

- [ ] Run `npm run dev`
- [ ] Open http://localhost:3000
- [ ] Test entering a username
- [ ] Test moving around the lobby
- [ ] Test leaving a trace
- [ ] Open in another browser/tab to test multiplayer

## ✅ Deployment (Choose One)

### Cloudflare Pages
- [ ] Push code to GitHub
- [ ] Connect repository in Cloudflare Pages
- [ ] Set build command: `npm run build`
- [ ] Set output directory: `dist`
- [ ] Add environment variables
- [ ] Deploy

### Vercel
- [ ] Install Vercel CLI: `npm i -g vercel`
- [ ] Run `vercel`
- [ ] Add environment variables
- [ ] Deploy

## ✅ Post-Deployment

- [ ] Test deployed site
- [ ] Verify Supabase connection works
- [ ] Test multiplayer from different devices
- [ ] Share with friends!

## 🎨 Customization (Optional)

- [ ] Change lobby colors in `tailwind.config.js`
- [ ] Adjust lobby size in `LobbyScene.tsx`
- [ ] Add custom avatar graphics
- [ ] Add background music
- [ ] Create custom trace types

## 🐛 Troubleshooting

### Can't see other users?
- Check Supabase Realtime is enabled
- Verify you're using different browsers/devices
- Check browser console for errors

### Traces not saving?
- Verify database schema was created
- Check RLS policies are set
- Verify Supabase credentials in `.env`

### Build errors?
- Run `npm install` again
- Check Node.js version (18+)
- Clear `node_modules` and reinstall

## 📚 Next Steps

- Read the full README.md
- Explore the code in `src/`
- Join the community
- Build something awesome!
