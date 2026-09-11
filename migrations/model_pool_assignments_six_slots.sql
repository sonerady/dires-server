-- 11 Eyl 2026: havuzdan cinsiyet başına 6 model atanıyor (modelPool.js POOL_SLOTS = 6).
-- Eski kısıt slot 0..2 idi; 4. atamada insert patlıyor ve withPool() poolAvailable'sız dönüyordu
-- ("Modellere Gözat" butonu kayboluyordu). Bu migration 6 slot koduyla BİRLİKTE deploy edilmeli.
alter table model_pool_assignments drop constraint if exists model_pool_assignments_slot_check;
alter table model_pool_assignments add constraint model_pool_assignments_slot_check check (slot >= 0 and slot <= 5);
