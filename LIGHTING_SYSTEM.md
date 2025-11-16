# 💡 Dynamic Lighting System

## Overview
The Digital Lobby now features a dynamic lighting system that allows traces to emit light, creating a top-down game aesthetic similar to Factorio, Undertale, or other atmospheric games.

## Features

### Customizable Light Sources
Each trace can be configured to emit light with the following properties:

- **Enable/Disable**: Toggle light emission on/off
- **Light Color**: Choose any hex color (#ffffff, #ff0000, etc.)
- **Intensity**: Control brightness from 0x to 2x
- **Radius**: Set the light spread from 50px to 1000px
- **Position Offset**: Fine-tune light position relative to trace center (±200px on X and Y)

### How It Works

1. **Lighting Layer**: A dedicated Pixi.js Graphics layer renders lights above the grid but below entities
2. **Radial Gradient**: Lights use 20-step gradient circles for smooth falloff
3. **Real-time Updates**: Light properties sync across all clients via Supabase
4. **Performance**: Only visible lights within render distance are drawn

### Using the Lighting System

1. **Right-click** a trace and select **Customize**
2. Scroll to the **💡 Lighting** section
3. Check **Enable Light Emission**
4. Adjust:
   - **Light Color**: Use color picker or enter hex value
   - **Intensity**: Slider from 0 to 2.0x
   - **Radius**: Slider from 50px to 1000px
   - **Position Offset**: Adjust X/Y sliders to move light source

### Light Position Offset

The offset feature is particularly useful for:
- **Transparent images**: Place light source at the actual light bulb/lamp in the image
- **Artistic effects**: Create shadows or directional lighting
- **Complex traces**: Position multiple conceptual light sources

### Database Schema

```sql
illuminate boolean DEFAULT false
light_color text DEFAULT '#ffffff'
light_intensity numeric DEFAULT 1.0 (0-2)
light_radius numeric DEFAULT 200 (0-1000)
light_offset_x numeric DEFAULT 0
light_offset_y numeric DEFAULT 0
```

### Performance Notes

- Lights use alpha blending for smooth gradients
- 20 concentric circles per light source
- Lighting layer redraws every frame but only for visible traces
- Minimal performance impact with reasonable trace counts

### Tips

- **Warm ambient**: Use large radius (500-800px) with low intensity (0.3-0.5) and warm colors (#ffcc99)
- **Bright spots**: Small radius (100-150px) with high intensity (1.5-2.0) and bright whites
- **Colored atmosphere**: Medium radius (300-400px) with custom colors (#00ff88, #ff00ff, etc.)
- **Realistic scenes**: Position offset to match light sources in images (lamps, candles, screens)

## Migration

Run the migration to add lighting fields to existing databases:

```sql
-- In Supabase SQL Editor
\i supabase/migrations/add_lighting.sql
```

Or apply manually from `supabase/schema.sql` (the lighting fields are already included).
