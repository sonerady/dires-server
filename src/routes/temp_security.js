// GÜVENLIK MIDDLEWARE - Tüm response'ları güvenli hale getir
const secureResponse = (data) => {
  if (!data) return [];

  if (Array.isArray(data)) {
    return data.map((item) => secureLocationItem(item));
  }

  if (typeof data === "object") {
    return secureLocationItem(data);
  }

  return data;
};

const secureLocationItem = (item) => {
  if (!item || typeof item !== "object") {
    return {
      id: Date.now() + Math.random(),
      title: "Unknown Location",
      generated_title: "Unknown Location",
      image_url:
        "https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=500&h=500&fit=crop",
      category: "discovery",
      location_type: "indoor",
      favorite_count: 0,
      is_public: true,
      status: "completed",
      created_at: new Date().toISOString(),
      user_id: "dummy-user-id",
      original_prompt: "Dummy prompt",
      enhanced_prompt: "Enhanced dummy prompt",
      replicate_id: `dummy-replicate-${Date.now()}`,
    };
  }

  return {
    ...item,
    id: item.id || Date.now() + Math.random(),
    title: item.title || item.generated_title || "Unknown Location",
    generated_title: item.generated_title || item.title || "Unknown Location",
    image_url:
      item.image_url ||
      "https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=500&h=500&fit=crop",
    category: item.category || "discovery",
    location_type: item.location_type || "indoor",
    favorite_count:
      typeof item.favorite_count === "number" && !isNaN(item.favorite_count)
        ? Math.max(0, item.favorite_count)
        : 0,
    is_public: item.is_public !== undefined ? item.is_public : true,
    status: item.status || "completed",
    created_at: item.created_at || new Date().toISOString(),
    user_id: item.user_id || "dummy-user-id",
    original_prompt: item.original_prompt || "Dummy prompt",
    enhanced_prompt: item.enhanced_prompt || "Enhanced dummy prompt",
    replicate_id: item.replicate_id || `dummy-replicate-${Date.now()}`,
  };
};
