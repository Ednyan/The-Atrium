# 🎨 Theme Customization Guide

## Overview
Lobby owners can customize the visual appearance of their lobby including grid, background, particles, and ground elements.

## Accessing Theme Customization

### For Lobby Owners
1. **Right-click** anywhere on the map/background
2. Select **"🎨 Customize theme"** from the context menu
3. The customization panel will open

**Note:** The "Customize theme" option only appears for lobby owners.

## Customization Options

### 1. Grid Settings
- **Grid Color**: Choose the color of the grid lines
  - Click the color picker or enter a hex code (e.g., `#3b82f6`)
  - Default: Blue (`#3b82f6`)
  
- **Grid Opacity**: Control how visible the grid is
  - Range: 0% (invisible) to 100% (fully opaque)
  - Default: 20%

### 2. Background
- **Background Color**: Set the color behind everything
  - Click the color picker or enter a hex code (e.g., `#0a0a0f`)
  - Default: Dark blue-black (`#0a0a0f`)

### 3. Floating Particles
- **Enable/Disable**: Toggle the dust-like particles that float in the air
  - Default: Enabled
  
- **Particle Color**: Choose the color of floating particles
  - Only visible when particles are enabled
  - Default: White (`#ffffff`)
  - Tip: Try subtle colors that match your theme

### 4. Ground Elements
- **Enable/Disable**: Toggle ground decorations (rocks, plants, etc.)
  - Default: Enabled
  
- **Ground Element URLs**: Add custom images to appear on the ground
  - Enter direct image URLs or paths
  - Multiple URLs can be added
  - Each URL represents a different ground element type
  - Elements are randomly placed and scaled

#### Ground Element URL Examples:
```
https://example.com/rock.png
https://example.com/grass.png
/themes/ground/stone.png
/themes/ground/flower.png
```

#### Tips for Ground Elements:
- Use transparent PNG images for best results
- Smaller file sizes load faster
- Images should ideally have transparent backgrounds
- The system will randomly scale and place them
- You can use both external URLs and local paths

## Saving Changes
1. Click **"Save Theme"** at the bottom of the panel
2. Changes apply immediately to all users in the lobby
3. Settings are saved to the database and persist across sessions

## Database Setup

### Migration Required
Run the following migration to enable theme customization:

```sql
-- File: supabase/migrations/add_theme_settings.sql
```

This adds a `theme_settings` JSONB column to the `lobbies` table.

### Running the Migration
1. Go to your Supabase Dashboard
2. Navigate to SQL Editor
3. Create a new query
4. Copy the contents of `supabase/migrations/add_theme_settings.sql`
5. Run the query

## Technical Details

### Theme Settings Structure
The theme settings are stored as JSON in the database:

```typescript
{
  gridColor?: string           // Hex color (e.g., "#3b82f6")
  gridOpacity?: number         // 0.0 to 1.0
  backgroundColor?: string     // Hex color (e.g., "#0a0a0f")
  particlesEnabled?: boolean   // true/false
  particleColor?: string       // Hex color (e.g., "#ffffff")
  groundParticlesEnabled?: boolean  // true/false
  groundParticleUrls?: string[]     // Array of image URLs
}
```

### Default Values
- Grid Color: `#3b82f6` (blue)
- Grid Opacity: `0.2` (20%)
- Background Color: `#0a0a0f` (dark)
- Particles Enabled: `true`
- Particle Color: `#ffffff` (white)
- Ground Enabled: `true`
- Ground URLs: `[]` (empty, uses default assets)

## Examples

### Dark Theme
- Background: `#000000` (pure black)
- Grid Color: `#1a1a1a` (dark gray)
- Grid Opacity: `0.1` (very subtle)
- Particle Color: `#666666` (gray)

### Vibrant Theme
- Background: `#1a0033` (deep purple)
- Grid Color: `#ff00ff` (magenta)
- Grid Opacity: `0.3`
- Particle Color: `#00ffff` (cyan)

### Minimal Theme
- Background: `#ffffff` (white)
- Grid Color: `#cccccc` (light gray)
- Grid Opacity: `0.15`
- Particles Enabled: `false`
- Ground Enabled: `false`

### Nature Theme
- Background: `#1a2f1a` (dark green)
- Grid Color: `#2d5016` (forest green)
- Grid Opacity: `0.2`
- Particle Color: `#90ee90` (light green)
- Ground URLs: Add grass and flower images

## Performance Notes
- Theme changes apply instantly without reloading
- Particle count is fixed at 100 (can be adjusted in code)
- Ground elements are generated dynamically based on camera position
- Too many ground element URLs may impact loading time

## Troubleshooting

### Theme not saving
- Ensure you're the lobby owner
- Check browser console for errors
- Verify the migration was run successfully

### Custom ground images not appearing
- Check that URLs are accessible (try opening in browser)
- Ensure images are in supported formats (PNG, JPG, WebP)
- Check browser console for loading errors
- For local paths, ensure files exist in `/public/themes/ground/`

### Particles not visible
- Check that particles are enabled
- Try a different particle color (might blend with background)
- Zoom in closer (particles fade at distance)

## Future Enhancements
Potential additions to the theme system:
- Particle count control
- Particle speed control
- Ground element density control
- Custom player colors per lobby
- Theme presets (save/load themes)
- Import/export theme configurations
