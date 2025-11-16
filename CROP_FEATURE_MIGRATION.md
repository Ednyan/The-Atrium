# Image Cropping Feature - Database Migration

## ⚠️ Important: Run this SQL in your Supabase Dashboard

To enable the image cropping feature, you need to add crop fields to your existing `traces` table.

### SQL to Run:

```sql
-- Add crop fields to existing traces table
ALTER TABLE public.traces 
ADD COLUMN IF NOT EXISTS crop_x numeric DEFAULT 0 NOT NULL CHECK (crop_x >= 0 AND crop_x <= 1),
ADD COLUMN IF NOT EXISTS crop_y numeric DEFAULT 0 NOT NULL CHECK (crop_y >= 0 AND crop_y <= 1),
ADD COLUMN IF NOT EXISTS crop_width numeric DEFAULT 1 NOT NULL CHECK (crop_width >= 0 AND crop_width <= 1),
ADD COLUMN IF NOT EXISTS crop_height numeric DEFAULT 1 NOT NULL CHECK (crop_height >= 0 AND crop_height <= 1);
```

### Steps:

1. Go to your Supabase Dashboard
2. Navigate to the SQL Editor
3. Copy and paste the SQL above
4. Click "Run" or press Ctrl+Enter
5. You should see "Success. No rows returned"

### What This Does:

- Adds 4 new columns to store image crop information
- `crop_x`: Horizontal crop offset (0 = left edge, 1 = right edge)
- `crop_y`: Vertical crop offset (0 = top edge, 1 = bottom edge)
- `crop_width`: Width of the cropped area (0.5 = 50% of image)
- `crop_height`: Height of the cropped area (0.5 = 50% of image)

All values are percentages between 0 and 1 for maximum flexibility.

### Features Now Available:

✅ Crop button appears when selecting image traces
✅ Manual crop controls in the Customize menu
✅ Reset crop button to restore original image
✅ Crop values sync across all users in real-time
