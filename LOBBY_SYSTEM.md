# Lobby System Implementation

## Overview
A complete multi-lobby system that allows users to create and join separate server instances with access control.

## Features Implemented

### 1. Database Schema (`add_lobby_system.sql`)
- **lobbies table**: Store lobby/server instances
  - name, owner, password (optional), max_players, is_public
  - Default lobby created for backward compatibility
- **lobby_access_lists table**: Whitelist and blacklist management
  - Per-lobby access control with list_type ('whitelist'|'blacklist')
- **Database functions**:
  - `can_user_join_lobby()`: Validates access (password, blacklist, whitelist)
  - `get_user_lobby_count()`: Enforces 3-lobby limit per user
- **Schema updates**:
  - `profiles.active_lobby_id`: Track which lobby user is in
  - `traces.lobby_id`: Associate traces with specific lobbies

### 2. TypeScript Types (`database.ts`)
```typescript
interface Lobby {
  id: string
  name: string
  ownerUserId: string
  passwordHash?: string | null
  maxPlayers: number
  isPublic: boolean
  createdAt: string
  updatedAt: string
}

interface LobbyAccessList {
  id: string
  lobbyId: string
  userId: string
  listType: 'whitelist' | 'blacklist'
  addedAt: string
  addedBy?: string | null
}
```

### 3. Lobby Browser (`LobbyBrowser.tsx`)
- **View lobbies**:
  - Public lobbies (visible to all)
  - User's own lobbies (up to 3)
  - Player count display
- **Create lobby**:
  - Custom name (3-50 characters)
  - Optional password protection
  - Public/private visibility toggle
  - 3-lobby limit enforcement
- **Join lobby**:
  - Password prompt for protected lobbies
  - Access validation via database function
  - Updates user's active_lobby_id

### 4. Lobby Management (`LobbyManagement.tsx`)
Owner-only controls:
- **Settings tab**:
  - Change lobby name
  - Set/remove password
  - Toggle public/private
- **Whitelist tab**:
  - Search and add users
  - View current whitelist
  - Remove users from whitelist
- **Blacklist tab**:
  - Search and add users
  - View current blacklist
  - Remove users from blacklist

### 5. Lobby Isolation
**Updated hooks**:
- `usePresence(lobbyId)`: Lobby-specific presence channel
  - Channel name: `lobby-{lobbyId}-presence`
  - Only see players in same lobby
- `useTraces(lobbyId)`: Lobby-scoped trace loading
  - Filter by `lobby_id` in queries
  - Realtime subscriptions filtered by lobby
  - Channel name: `lobby-{lobbyId}-traces`

**Updated components**:
- `LobbyScene`: Accepts `lobbyId` prop, passes to hooks
- `TracePanel`: Includes `lobby_id` when creating traces
- `App.tsx`: Orchestrates lobby selection and joining

### 6. User Flow
1. **Login** → AuthScreen
2. **Welcome** → WelcomeScreen
3. **Lobby Selection** → LobbyBrowser
   - Join existing lobby
   - Create new lobby (if < 3 owned)
4. **In Lobby** → LobbyScene
   - See only players/traces in this lobby
   - "Leave Lobby" button in HUD
5. **Lobby Management** (owners only)
   - Right-click menu option (future)
   - Or dedicated management UI

## Access Control Logic

### Joining a Lobby
1. **Owner check**: Owner can always join
2. **Blacklist check**: Blacklisted users cannot join
3. **Whitelist check**: If private lobby, user must be whitelisted
4. **Password check**: If password set, must provide correct password

### Creating Traces
- Traces automatically tagged with `lobby_id`
- Only visible to users in that lobby
- Isolated from other lobbies

## Database Migration Steps

1. Run `add_lobby_system.sql` on your Supabase instance
2. Run `add_enable_interaction.sql` (embed interaction feature)
3. Existing data migrated to default lobby `00000000-0000-0000-0000-000000000000`

## Configuration

### Limits
- Max lobbies per user: **3** (enforced in `get_user_lobby_count`)
- Max players per lobby: **50** (default, configurable per lobby)
- Lobby name length: **3-50 characters**

### Default Lobby
- ID: `00000000-0000-0000-0000-000000000000`
- Name: "Main Lobby"
- Public: Yes
- All existing traces/users migrated here

## Future Enhancements
- Lobby owner transfer
- Temporary bans (expiring blacklist entries)
- Invite links with tokens
- Lobby categories/tags
- Player kick/ban from lobby management UI
- Lobby statistics (total traces, peak players, etc.)
- Lobby search/filtering
- Recent lobbies list
