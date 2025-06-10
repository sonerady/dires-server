-- Info Modals Tablosu
CREATE TABLE IF NOT EXISTS info_modals (
    id SERIAL PRIMARY KEY,
    content JSONB NOT NULL, -- Çoklu dil desteği için JSON (title da content içinde)
    priority INTEGER DEFAULT 1, -- Düşük sayı = yüksek öncelik
    target_audience VARCHAR(50) DEFAULT 'all', -- 'all', 'anonymous', 'registered', 'specific_users'
    target_user_ids JSONB DEFAULT NULL, -- Belirli kullanıcılar için array ["user1", "user2"]
    is_active BOOLEAN DEFAULT true,
    start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    end_date TIMESTAMP DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User Modal Interactions Tablosu (Modal dismiss takibi)
CREATE TABLE IF NOT EXISTS user_modal_interactions (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    modal_id INTEGER REFERENCES info_modals(id) ON DELETE CASCADE,
    interaction_type VARCHAR(50) DEFAULT 'dismissed', -- 'dismissed', 'clicked'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, modal_id) -- Aynı kullanıcı aynı modal'ı sadece bir kez dismiss edebilir
);

-- İndeksler
CREATE INDEX IF NOT EXISTS idx_info_modals_active ON info_modals(is_active);
CREATE INDEX IF NOT EXISTS idx_info_modals_priority ON info_modals(priority);
CREATE INDEX IF NOT EXISTS idx_info_modals_target_audience ON info_modals(target_audience);
CREATE INDEX IF NOT EXISTS idx_user_modal_interactions_user_id ON user_modal_interactions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_modal_interactions_modal_id ON user_modal_interactions(modal_id);

-- Sample data ile test
INSERT INTO info_modals (content, priority, target_audience, target_user_ids) VALUES 
(
    '{
        "tr": {
            "title": "Yeni Özellikler Tanıtımı",
            "text": "Yeni AI özelliklerimizi keşfedin! Daha hızlı ve kaliteli sonuçlar için algoritmalarımızı geliştirdik.",
            "images": [
                "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=500&h=300&fit=crop",
                "https://images.unsplash.com/photo-1620121692029-d088224ddc74?w=500&h=300&fit=crop"
            ]
        },
        "en": {
            "title": "New Features Introduction",
            "text": "Discover our new AI features! We improved our algorithms for faster and higher quality results.",
            "images": [
                "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=500&h=300&fit=crop",
                "https://images.unsplash.com/photo-1620121692029-d088224ddc74?w=500&h=300&fit=crop"
            ]
        }
    }',
    1,
    'all',
    NULL
),
(
    '{
        "tr": {
            "title": "Özel Kullanıcı Mesajı",
            "text": "Merhaba! Size özel bir mesajımız var. Beta tester olduğunuz için teşekkürler!",
            "images": ["https://images.unsplash.com/photo-1556761175-b413da4baf72?w=500&h=300&fit=crop"]
        },
        "en": {
            "title": "Special User Message",
            "text": "Hello! We have a special message for you. Thank you for being a beta tester!",
            "images": ["https://images.unsplash.com/photo-1556761175-b413da4baf72?w=500&h=300&fit=crop"]
        }
    }',
    1,
    'specific_users',
    '["b74bf3f3-188e-44c8-95aa-b4985b36bbba", "another-user-id"]'
); 