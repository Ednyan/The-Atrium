# The Lobby — A 2D Collaborative Creative Space

![The Lobby](https://img.shields.io/badge/status-active-success.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

A lightweight 2D online lobby inspired by Habbo Hotel and old MMO chat rooms. A quiet, ambient place where up to 100 users can appear as avatars, move around, leave short "traces" (messages or images), and feel a shared presence in real time.

## ✨ Features

- 🎮 **2D Isometric Lobby**: Interactive lobby scene rendered with Pixi.js
- 👤 **Real-time Avatars**: See other users moving in real-time
- 💬 **Trace System**: Leave persistent messages and images in the world
- 🔄 **Live Presence**: Powered by Supabase Realtime
- 🎨 **Beautiful UI**: Tailwind CSS with custom lobby theme
- 🔊 **Ambient Audio**: Optional background music (Tone.js)
- 🚀 **Serverless**: Free-tier compatible with Supabase
- 📱 **Responsive**: Works on desktop and mobile

## 🛠️ Tech Stack

| Purpose | Technology |
|---------|-----------|
| Frontend Framework | React + Vite + TypeScript |
| 2D Rendering | Pixi.js |
| Realtime & Database | Supabase (PostgreSQL + Realtime API) |
| File Storage | Supabase Storage |
| Auth | Supabase Anonymous Auth |
| Styling | Tailwind CSS |
| State Management | Zustand |
| Audio | Tone.js |
| Hosting | Cloudflare Pages / Vercel |

## 📋 Prerequisites

- Node.js 18+ and npm/pnpm/yarn
- A Supabase account (free tier works!)
- Git

## 🚀 Quick Start

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd Digital_Lobby
npm install
```

### 2. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to Project Settings > API
3. Copy your project URL and anon key
4. Create a `.env` file:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

### 3. Set Up Database

Run the SQL commands in `supabase/schema.sql` in your Supabase SQL Editor:

1. Go to Supabase Dashboard > SQL Editor
2. Copy the contents of `supabase/schema.sql`
3. Run the SQL commands

This will create:
- `traces` table for persistent messages/images
- Row Level Security (RLS) policies
- Realtime publication for live updates

### 4. Run Development Server

```bash
npm run dev
```

Visit `http://localhost:3000` 🎉

## 📁 Project Structure

```
Digital_Lobby/
├── src/
│   ├── components/          # React components
│   │   ├── LobbyScene.tsx   # Main Pixi.js lobby
│   │   ├── WelcomeScreen.tsx
│   │   └── TracePanel.tsx
│   ├── hooks/              # Custom React hooks
│   │   ├── usePresence.ts  # Supabase Realtime presence
│   │   └── useTraces.ts    # Trace loading/syncing
│   ├── store/              # Zustand state management
│   │   └── gameStore.ts
│   ├── lib/                # Utilities
│   │   └── supabase.ts     # Supabase client
│   ├── types/              # TypeScript types
│   │   └── database.ts
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── supabase/
│   └── schema.sql          # Database schema
├── public/                 # Static assets
├── index.html
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── README.md
```

## 🎮 How to Use

1. **Enter Your Name**: Type a display name on the welcome screen
2. **Move Around**: Click anywhere in the lobby to move your avatar
3. **Leave Traces**: Click "Leave Trace" to add a message at your current position
4. **See Others**: Watch other users move in real-time
5. **Explore Traces**: See messages left by other users around the lobby

## 🎨 Customization

### Change Colors

Edit `tailwind.config.js`:

```js
theme: {
  extend: {
    colors: {
      lobby: {
        dark: '#1a1a2e',
        accent: '#e94560',
        // Add your colors here
      }
    }
  }
}
```

### Lobby Size

Edit `src/components/LobbyScene.tsx`:

```ts
const LOBBY_WIDTH = 1200  // Change width
const LOBBY_HEIGHT = 800  // Change height
```

### Avatar Appearance

Edit the Pixi.js graphics in `LobbyScene.tsx`:

```ts
const playerAvatar = new Graphics()
playerAvatar.circle(0, 0, AVATAR_SIZE)
playerAvatar.fill(0xe94560)  // Change color
```

## 🚀 Deployment

### Cloudflare Pages

1. Push your code to GitHub
2. Go to Cloudflare Pages
3. Connect your repository
4. Build settings:
   - Build command: `npm run build`
   - Build output: `dist`
5. Add environment variables (Supabase URL and key)
6. Deploy!

### Vercel

```bash
npm install -g vercel
vercel
```

Follow the prompts and add your environment variables.

## 🔐 Environment Variables

| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anonymous key |

## 📝 Database Schema

### Traces Table

```sql
traces (
  id: uuid (primary key)
  created_at: timestamp
  user_id: text
  username: text
  type: text ('text' | 'image')
  content: text
  position_x: numeric
  position_y: numeric
  image_url: text (nullable)
)
```

## 🤝 Contributing

Contributions are welcome! Feel free to:

- Report bugs
- Suggest features
- Submit pull requests
- Improve documentation

## 📄 License

MIT License - feel free to use this project for anything!

## 🙏 Acknowledgments

- Inspired by Habbo Hotel and classic MMO chat rooms
- Built with love using modern web technologies
- Thanks to the Supabase and Pixi.js communities

## 💬 Support

Having issues? Check:

1. Supabase credentials are correct in `.env`
2. Database schema is properly set up
3. RLS policies are enabled
4. Node.js version is 18+

## 🎯 Roadmap

- [ ] Image upload support for traces
- [ ] Private rooms/lobbies
- [ ] Custom avatar customization
- [ ] Chat system
- [ ] Mini-games
- [ ] Sound effects
- [ ] Mobile touch controls
- [ ] Admin moderation tools

---

**Built with ❤️ for the creative web**
