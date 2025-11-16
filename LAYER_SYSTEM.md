# 🎨 Layer System & Improved Lighting

## Overview
The Digital Lobby now features a comprehensive layer management system similar to Photoshop, along with improved lighting rendering that reduces color banding.

## 🆕 Layer System Features

### What are Layers?
Layers allow you to organize traces into groups with z-index ordering:
- **Higher z-index** = rendered on top
- **Lower z-index** = rendered below
- **Lights illuminate** traces on the same or lower z-index layers

### Layer Panel UI

Access the layer panel by clicking the **🎨 Layers** button (bottom-right, above "Leave Trace" button).

#### Features:
1. **Create Groups**: Click "+ Group" to create a new layer group
2. **Organize Traces**: Drag traces into groups using the "Move to..." dropdown
3. **Reorder Layers**: Use ▲/▼ buttons to change layer z-index order
4. **Delete Groups**: Click 🗑️ to delete a group (deletes all traces inside)
5. **Player Position**: Move your player avatar in the layer order (cannot be deleted or grouped)
6. **Expand/Collapse**: Click group names to show/hide traces inside

### Layer Organization

```
┌─────────────────────────────────┐
│  👤 Player (You)          ▲ ▼  │ ← Moveable, not deletable
├─────────────────────────────────┤
│  📁 Foreground (5)   ▲ ▼ 🗑️   │ ← Group with 5 traces
│    📝 Sign text               │
│    🖼️ Overlay image           │
├─────────────────────────────────┤
│  📁 Lights (3)       ▲ ▼ 🗑️   │
│    💡🖼️ Lamp                   │
│    💡📝 Neon sign               │
├─────────────────────────────────┤
│  📁 Background (2)   ▲ ▼ 🗑️   │
│    🖼️ Floor texture            │
├─────────────────────────────────┤
│  Ungrouped Traces              │
│    📝 Random note    [Move...] │
└─────────────────────────────────┘
```

### Light & Layer Interaction

**Key Rule**: Lights only illuminate traces on the **same or lower** z-index layers.

Example:
```
Z-Index: 100  │  📁 UI Layer
              │    🖼️ Menu (not lit by lamp below)
              │
Z-Index: 50   │  💡 📁 Foreground
              │    🖼️ Lamp (emits light)
              │    ↓ Light illuminates ↓
Z-Index: 0    │  📁 Background
              │    🖼️ Floor (receives light from lamp)
              │    🖼️ Wall (receives light from lamp)
```

This creates realistic lighting where foreground lights illuminate backgrounds, but UI elements stay unaffected.

## 💡 Improved Lighting

### What Changed

**Before**: Color banding with 20-step gradients
**After**: Smooth gradients with 40 steps + dithering

### Technical Improvements

1. **More Steps**: 40 gradient circles instead of 20
2. **Exponential Falloff**: `Math.pow(1 - ratio, 1.5)` for smoother transitions
3. **Dithering**: Random noise (`±0.01`) breaks up color bands
4. **Better Alpha**: Improved alpha blending formula

### Visual Comparison

```
Old (banding):        New (smooth):
████████              ████████
 ████████              ███████
  ███████               ██████
   ██████                █████
    █████                 ████
     ████ ← visible        ███
      ███   bands           ██
       ██                    █
```

## 🗄️ Database Schema

### New Tables

**`layers`** table:
```sql
id          uuid          Primary key
name        text          Layer/group name
z_index     integer       Rendering order
is_group    boolean       Whether it's a group
parent_id   uuid          For nested groups (future)
user_id     text          Creator
created_at  timestamp     Creation time
```

### Updated Tables

**`traces`** table additions:
```sql
layer_id    uuid          Which layer/group trace belongs to
z_index     integer       Trace rendering order
```

## 🔧 Usage Guide

### Creating a Multi-Layer Scene

1. **Create Background Layer**
   - Click "+ Group" in Layers panel
   - Name it "Background"
   - Add floor/wall images to this group

2. **Create Lighting Layer**
   - Create another group named "Lights"
   - Move it above Background (higher z-index)
   - Add traces with lighting enabled
   - Position lights using offset controls

3. **Create Foreground Layer**
   - Create group named "Foreground"
   - Move it to top (highest z-index)
   - Add decorative elements that shouldn't be lit

4. **Position Player**
   - Use player ▲/▼ buttons to place yourself between layers
   - Typically between Lights and Foreground

### Best Practices

- **Background first**: Lowest z-index for floors/walls
- **Lights middle**: Medium z-index to illuminate backgrounds
- **Foreground last**: Highest z-index for UI/decorations
- **Player flexible**: Move between layers as needed
- **Group naming**: Use descriptive names (Lights, Background, UI, etc.)

## 🎮 Workflow Example

### Creating a Lit Room

1. Open Layers panel (🎨 Layers button)
2. Create "Background" group (z-index: 0)
3. Add room images to Background
4. Create "Lights" group (z-index: 50)
5. Add lamp image with lighting:
   - Enable light emission
   - Color: #ffcc66 (warm)
   - Intensity: 1.2
   - Radius: 400
   - Offset: Position at lamp bulb
6. Light will illuminate Background (z-index 0 < 50)

### Adding UI That Stays Unlit

1. Create "UI" group (z-index: 100)
2. Add text/images for interface elements
3. UI layer is above Lights (100 > 50)
4. UI won't receive lighting effects

## 🔄 Migration

Run in Supabase SQL Editor:

```sql
-- From: supabase/migrations/add_layer_system.sql
\i supabase/migrations/add_layer_system.sql
```

Or copy the contents and paste into SQL Editor.

## 📊 Performance

- Layer rendering: Minimal overhead (simple z-index sorting)
- Lighting: ~2x gradient steps but still performant
- Dithering: Negligible performance impact
- Scales well with reasonable trace counts (< 1000)

## 🎨 Creative Tips

### Dramatic Lighting
- Single bright light (white, intensity 2.0)
- Large radius (600-800px)
- Dark background traces
- Player in lit area for contrast

### Ambient Atmosphere
- Multiple colored lights
- Low intensity (0.3-0.6)
- Large overlapping radii
- Warm/cool color mixing (#ff8844 + #4488ff)

### Focused Spotlight
- Small radius (100-200px)
- High intensity (1.5-2.0)
- Precise offset positioning
- Sharp light/dark boundaries

## 🐛 Troubleshooting

**Q: Light doesn't illuminate my trace**
A: Check z-index values. Light must be on same or higher layer than target.

**Q: Can't see layer groups**
A: Make sure to run the migration SQL to create layers table.

**Q: Traces disappear when moving to group**
A: This is a bug - traces should maintain position. Check console for errors.

**Q: Player position doesn't save**
A: Player position in layer panel is UI-only, not persisted to database.

## 🔮 Future Enhancements

- [ ] Nested layer groups (folders within folders)
- [ ] Layer visibility toggle (hide/show layers)
- [ ] Layer opacity control
- [ ] Blend modes (multiply, add, screen, etc.)
- [ ] Copy/paste traces between layers
- [ ] Batch operations (move multiple traces at once)
- [ ] Layer locking (prevent edits)
- [ ] Layer colors/tags for organization
