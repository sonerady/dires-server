-- STEP 1: Önce eski policy'leri sil
DROP POLICY IF EXISTS "Public locations are viewable by everyone" ON custom_locations;
DROP POLICY IF EXISTS "Users can view their own locations" ON custom_locations;
DROP POLICY IF EXISTS "Users can create their own locations" ON custom_locations;
DROP POLICY IF EXISTS "Users can update their own locations" ON custom_locations;
DROP POLICY IF EXISTS "Users can delete their own locations" ON custom_locations;
DROP POLICY IF EXISTS "Anonymous users can create locations" ON custom_locations;
DROP POLICY IF EXISTS "Anonymous users can view locations" ON custom_locations;
DROP POLICY IF EXISTS "Anonymous users can view their locations" ON custom_locations;
