-- Atomic kredi düşürme fonksiyonu - race condition'ı önler
CREATE OR REPLACE FUNCTION deduct_user_credit(
  user_id UUID,
  credit_amount INTEGER
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  current_balance INTEGER;
  new_balance INTEGER;
  result JSON;
BEGIN
  -- 🔒 Row-level lock ile kullanıcı kaydını kilitle
  SELECT credit_balance INTO current_balance
  FROM users 
  WHERE id = user_id
  FOR UPDATE; -- Bu satır diğer transaction'ları bekletir
  
  -- Kullanıcı bulunamadı kontrolü
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'User not found',
      'current_balance', 0,
      'new_balance', 0
    );
  END IF;
  
  -- Yetersiz kredi kontrolü
  IF current_balance < credit_amount THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Insufficient credit',
      'current_balance', current_balance,
      'new_balance', current_balance
    );
  END IF;
  
  -- Krediyi düş
  new_balance := current_balance - credit_amount;
  
  UPDATE users 
  SET credit_balance = new_balance
  WHERE id = user_id;
  
  -- Başarılı sonuç döndür
  RETURN json_build_object(
    'success', true,
    'error', null,
    'current_balance', current_balance,
    'new_balance', new_balance,
    'deducted_amount', credit_amount
  );
  
EXCEPTION
  WHEN OTHERS THEN
    -- Hata durumunda rollback otomatik olur
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM,
      'current_balance', current_balance,
      'new_balance', current_balance
    );
END;
$$;

-- Fonksiyon kullanım izni ver
GRANT EXECUTE ON FUNCTION deduct_user_credit(UUID, INTEGER) TO anon;
GRANT EXECUTE ON FUNCTION deduct_user_credit(UUID, INTEGER) TO authenticated;
