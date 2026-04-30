-- album_items.item_type CHECK constraint'ini genişlet.
-- SimpleImageModal'daki kit/story/fashion/unboxing varyasyonları artık
-- albüme eklenebiliyor; her birinin item_type'ı history table adına eşit
-- olduğu için aynı CHECK içinde whitelist'e koyuyoruz. Mevcut 7 tip korunur.

ALTER TABLE public.album_items
DROP CONSTRAINT IF EXISTS album_items_item_type_check;

ALTER TABLE public.album_items
ADD CONSTRAINT album_items_item_type_check
CHECK (item_type IN (
  'reference_results',
  'pose_change_generations',
  'color_change_generations',
  'back_side_generations',
  'refiner_generations',
  'chat_edit_results',
  'video_generations',
  'ecommerce_kits',
  'stories',
  'fashion_kits',
  'unboxing_stories'
));
