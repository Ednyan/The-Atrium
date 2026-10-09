# The landing page's portal (components/PortalScene) draws the wireframe
# wormhole from digitalatrium_orb_animation.blend: this writes its geometry,
# modifiers applied, to public/portal/vessel.bin. Run it again after changing
# the model:
#
#   blender -b --factory-startup digitalatrium_orb_animation.blend -P scripts/export-vessel.py
#
# The file: 'ATV1', vertex count (u32), index count (u32), extent (f32), then
# positions as int16 scaled by the extent, padded to 4 bytes, then uint16
# triangles -- in the vessel's own space, Blender's Z up. Subdivision 0: drawn
# flat and unlit, more doesn't show, and it's a quarter of the size.

import bpy, struct, os

vessel = bpy.data.objects['wireframe_wormhole_shape']
subsurf = next(m for m in vessel.modifiers if m.type == 'SUBSURF')
subsurf.levels = 0
bpy.context.view_layer.update()
mesh = vessel.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
mesh.calc_loop_triangles()
verts = [v.co.copy() for v in mesh.vertices]
tris = [t.vertices[:] for t in mesh.loop_triangles]
extent = max(abs(c) for v in verts for c in v)
assert len(verts) < 65536, 'too many vertices for uint16 indices'

data = bytearray(b'ATV1') + struct.pack('<IIf', len(verts), len(tris) * 3, extent)
for v in verts:
    data += struct.pack('<hhh', *(round(c / extent * 32767) for c in v))
if len(verts) % 2:
    data += struct.pack('<h', 0)
for t in tris:
    data += struct.pack('<HHH', *t)

out = os.path.join(os.path.dirname(bpy.data.filepath), 'public', 'portal', 'vessel.bin')
open(out, 'wb').write(data)
print(f'wrote {out}: {len(verts)} vertices, {len(tris)} triangles, {len(data)} bytes')
