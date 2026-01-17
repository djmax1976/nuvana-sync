-- Migration v011: Backfill shift_id for fuel_grade_movements
-- Links existing fuel data to shifts based on matching store_id and business_date
--
-- This fixes fuel data that was parsed before the parser properly linked
-- fuel records to shifts.

-- Update fuel_grade_movements with NULL shift_id to link to matching shifts
UPDATE fuel_grade_movements
SET shift_id = (
  SELECT s.shift_id
  FROM shifts s
  WHERE s.store_id = fuel_grade_movements.store_id
    AND s.business_date = fuel_grade_movements.business_date
  ORDER BY s.created_at ASC
  LIMIT 1
)
WHERE shift_id IS NULL;

-- Also backfill fuel_product_movements if any exist without shift_id
UPDATE fuel_product_movements
SET shift_id = (
  SELECT s.shift_id
  FROM shifts s
  WHERE s.store_id = fuel_product_movements.store_id
    AND s.business_date = fuel_product_movements.business_date
  ORDER BY s.created_at ASC
  LIMIT 1
)
WHERE shift_id IS NULL;
