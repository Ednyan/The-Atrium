# Theme System

The background now supports **procedurally generated ground elements** and **floating particles**!

## How to Add Theme Assets

1. **Ground Elements** - Place PNG files in `/public/themes/ground/`
   - Examples: `stone_1.png`, `grass_1.png`, `flower_1.png`
   - These will be scattered across the world at fixed positions
   - Recommended size: 16x16 to 64x64 pixels

2. **Particles** - Place PNG files in `/public/themes/particles/`
   - Examples: `dust_1.png`, `sparkle_1.png`  
   - These will float and drift across the screen
   - Recommended size: 8x8 to 32x32 pixels

## Current Features

✨ **Floating Particles**
- 50 particles drifting across the viewport
- Gentle pulsing opacity
- Additive blend mode for ethereal glow

🌿 **Procedural Ground Elements**
- Seeded random placement (same position for all users)
- Random scale, rotation, and opacity
- Auto-culling for performance
- Density: ~0.5 elements per 1000x1000 pixels

## Creating Assets

For best results, create PNG images with:
- **Transparent backgrounds**
- **Soft edges** for blending
- **Simple shapes** (stones, grass tufts, flowers, sparkles)
- **Muted colors** to complement the dark theme

The system will automatically:
- Load all compatible files from the folders
- Apply random transformations
- Optimize rendering based on camera position

Just drop your PNG files in the folders and refresh! 🎨
