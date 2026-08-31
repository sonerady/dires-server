-- Banner Studio: LLM ile üretilen HTML kampanya/satış banner sonuçları
CREATE TABLE IF NOT EXISTS banner_studio_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  image_url TEXT NOT NULL,
  banner_type TEXT NOT NULL DEFAULT 'sale',
  ratio TEXT NOT NULL DEFAULT '4:5',
  options JSONB NOT NULL DEFAULT '{}'::jsonb,
  html TEXT NOT NULL,
  video_url TEXT,
  -- Results kartlarındaki önizleme JPG'i (puppeteer ekran görüntüsü)
  preview_url TEXT,
  credits_used INTEGER NOT NULL DEFAULT 0,
  processing_time_seconds INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_banner_studio_results_user_created
  ON banner_studio_results (user_id, created_at DESC);
