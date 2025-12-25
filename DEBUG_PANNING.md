# Debug Panning Issue

To find what's blocking panning:

1. Open browser DevTools (F12)
2. Click the "Select Element" tool (Ctrl+Shift+C or Cmd+Opt+C)
3. Hover over an empty area of the map where you're trying to pan
4. Check what element is highlighted - it will show you what's blocking

Look for:
- Any element with `pointer-events: auto` that covers the screen
- Check if `pathCreationMode` state is stuck as `true`
- Check if any modal/dialog backdrop is rendering when it shouldn't be

## Potential Issues:
1. Path creation overlay (line 803) - should only render when `pathCreationMode && selectedTraceId`
2. Context menu backdrop (line 2102) - should only render when `contextMenu` is set
3. Editing dialog backdrop (line 2824) - should only render when `editingTrace` is set

## Quick Fix:
If you find an invisible blocking element, we need to either:
- Make it conditional (only render when needed)
- Change `pointer-events: auto` to `pointer-events: none`
- Add proper z-index management
