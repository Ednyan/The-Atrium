-- Two more shapes: a diamond and a parallelogram, offered beside the
-- rectangle, triangle and circle (the quick bar's Shapes). The column's check
-- lists every kind a shape can be. Safe to run more than once.
ALTER TABLE traces DROP CONSTRAINT IF EXISTS traces_shape_type_check;
ALTER TABLE traces ADD CONSTRAINT traces_shape_type_check
  CHECK (shape_type IN ('rectangle', 'circle', 'triangle', 'diamond', 'parallelogram', 'path'));
