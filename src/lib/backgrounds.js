const datas = [
  {
    category: "nature",
    subCategories: [
      {
        subCategory: "forest",
        prompt:
          "Eyeglasses placed on a moss-covered rock in a serene forest setting, with dappled sunlight filtering through the trees. The natural environment appeals to customers interested in eco-friendly and outdoor-oriented products.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Forest.jpg",
      },
      {
        subCategory: "mountain",
        prompt:
          "A stylish pair of eyeglasses displayed on a rocky mountain ledge with breathtaking views in the background. This adventurous setting is ideal for brands promoting durability and outdoor lifestyle.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Mountain.jpg",
      },
      {
        subCategory: "river",
        prompt:
          "Eyeglasses resting on a smooth rock beside a gentle river stream, surrounded by lush greenery. The tranquil setting is perfect for nature-inspired product images, emphasizing calmness and connection with the outdoors.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/River.jpg",
      },
      {
        subCategory: "beach",
        prompt:
          "Eyeglasses laid on soft sand with the ocean waves in the background. The scene evokes a sense of relaxation and summer style, ideal for beachwear or casual eyewear collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Beach.jpg",
      },
      {
        subCategory: "waterfall",
        prompt:
          "Eyeglasses positioned on a mossy stone with a waterfall cascading in the background. The powerful, natural setting highlights the product's durability and appeal for adventure seekers.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Waterfall.jpg",
      },
      {
        subCategory: "desert",
        prompt:
          "Eyeglasses displayed on the golden sand dunes of a vast desert landscape. The warm tones and expansive background evoke a sense of travel and exploration, ideal for adventurous eyewear collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Desert.jpg",
      },
      {
        subCategory: "cave",
        prompt:
          "Eyeglasses placed on a rocky surface inside a mysterious cave, with soft natural light illuminating the product. The unique, rugged setting appeals to customers looking for distinctive, adventurous products.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Cave.jpg",
      },
      {
        subCategory: "field",
        prompt:
          "A pair of eyeglasses resting in a sunlit field of tall grass, conveying a peaceful, rural atmosphere. This natural setting appeals to customers who value simplicity and connection to nature.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Field.jpg",
      },
      {
        subCategory: "snow",
        prompt:
          "Eyeglasses placed on fresh, white snow with a winter landscape in the background. The cold setting emphasizes durability and style, suitable for winter collections or outdoor-themed products.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Snow.jpg",
      },
      {
        subCategory: "autumn_forest",
        prompt:
          "Eyeglasses showcased on a fallen log amidst colorful autumn leaves in a forest. The warm tones and seasonal vibe make this setting perfect for fall eyewear collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Autumn_Forest.jpg",
      },
      {
        subCategory: "spring_blossoms",
        prompt:
          "Eyeglasses placed on a rustic table with spring blossoms in the background, creating a fresh, floral scene. Ideal for spring collections or products with a light, airy aesthetic.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Spring_Blossoms.jpg",
      },
      {
        subCategory: "lake",
        prompt:
          "Eyeglasses displayed on a wooden dock overlooking a peaceful lake. The calm, reflective water adds tranquility to the product presentation, appealing to outdoor and nature enthusiasts.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Lake.jpg",
      },
      {
        subCategory: "meadow",
        prompt:
          "A pair of eyeglasses laid on wildflowers in a sunny meadow. The vibrant colors and natural background highlight the product's connection to nature, perfect for eco-friendly brands.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Meadow.jpg",
      },
      {
        subCategory: "sunrise",
        prompt:
          "Eyeglasses positioned on a surface with a beautiful sunrise in the background, casting warm, golden light on the product. The serene setting symbolizes new beginnings, ideal for optimistic, fresh collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Sunrise.jpg",
      },
      {
        subCategory: "sunset",
        prompt:
          "Eyeglasses displayed on a stone with a colorful sunset behind. The warm, ambient light enhances the product's appeal, making it suitable for lifestyle-focused brand images.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Sunset.jpg",
      },
      {
        subCategory: "hill",
        prompt:
          "Eyeglasses on a grassy hilltop with a panoramic view of the countryside. The natural setting emphasizes freedom and adventure, ideal for outdoor-focused collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Hill.jpg",
      },
      {
        subCategory: "canyon",
        prompt:
          "Eyeglasses displayed on a rocky edge of a canyon, with breathtaking views and rugged textures. The adventurous setting suits brands targeting an active, outdoor-loving audience.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Canyon.jpg",
      },
      {
        subCategory: "volcano",
        prompt:
          "Eyeglasses placed on volcanic rocks with a dramatic mountain in the background. The intense, unique setting appeals to those seeking bold and unconventional product presentations.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Volcano.jpg",
      },
      {
        subCategory: "jungle",
        prompt:
          "Eyeglasses positioned on a log in a lush jungle setting, with vibrant green foliage surrounding the product. Ideal for brands promoting eco-friendly, adventurous eyewear.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Jungle.jpg",
      },
      {
        subCategory: "swamp",
        prompt:
          "Eyeglasses displayed on a mossy stone in a misty swamp, creating a mysterious, intriguing atmosphere. Suitable for edgy, unique eyewear collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Swamp.jpg",
      },
    ],
  },
  {
    category: "classics",
    subCategories: [
      {
        subCategory: "white",
        prompt:
          "A high-resolution, minimalist studio photograph of stylish eyeglasses displayed against a pure white background. The setting is bright and clean, emphasizing the product with soft lighting. Perfect for an e-commerce platform, showing every detail of the eyeglasses with no distractions.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/White.jpg",
      },
      {
        subCategory: "grey",
        prompt:
          "A sleek and sophisticated e-commerce product photo of eyeglasses on a smooth grey background. The subtle, neutral tones bring out the colors and textures of the glasses, providing a modern and professional look suitable for high-end product listings.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Grey.jpg",
      },
      {
        subCategory: "blue",
        prompt:
          "A vibrant yet subtle blue gradient background highlighting fashionable eyeglasses. The cool tone emphasizes the sleek design of the glasses, perfect for online listings that aim to convey a modern and stylish aesthetic.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Blue.jpg",
      },
      {
        subCategory: "living_room",
        prompt:
          "A cozy, modern living room with a well-lit coffee table where stylish eyeglasses are showcased. The background features neutral colors, a comfy sofa, and minimal decor, adding a touch of everyday elegance to the product for a lifestyle-themed product image.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Living_Room.jpg",
      },
      {
        subCategory: "wood",
        prompt:
          "High-quality image of eyeglasses set against a rustic, warm-toned wooden background. The rich texture of the wood contrasts with the sleek frame of the glasses, creating an organic, natural look ideal for eco-conscious or artisanal brands.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Wood.jpg",
      },
      {
        subCategory: "grass",
        prompt:
          "A pair of stylish eyeglasses displayed on a fresh green grass background, capturing a natural, outdoor vibe. This setting emphasizes eco-friendliness and relaxation, suitable for brands focusing on outdoor or nature-inspired products.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Grass.jpg",
      },
      {
        subCategory: "flowers",
        prompt:
          "A vibrant, high-resolution product shot of eyeglasses surrounded by a variety of colorful flowers, set against a neutral background. This aesthetic adds a touch of elegance and is perfect for spring collections or floral-themed promotions.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Flowers.jpg",
      },
      {
        subCategory: "cafe",
        prompt:
          "A cozy cafe table setting with eyeglasses placed next to a coffee cup and open book. The warm tones and natural light add a casual, inviting vibe, ideal for lifestyle product photos intended to connect with customers' everyday routines.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Cafe.jpg",
      },
      {
        subCategory: "marble",
        prompt:
          "Sophisticated eyeglasses displayed on a smooth white marble surface with subtle veining. The luxurious texture complements high-end frames, creating a premium product image perfect for an upscale e-commerce listing.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Marble.jpg",
      },
      {
        subCategory: "autumn",
        prompt:
          "Eyeglasses displayed on a rustic autumn-inspired background with dried leaves in warm, earthy tones. The setting evokes a cozy, seasonal vibe, perfect for fall collections or promotions focused on warmth and comfort.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Autumn.jpg",
      },
      {
        subCategory: "natural",
        prompt:
          "Eyeglasses displayed in a natural, organic setting with wooden accents and greenery in the background. The soft, natural light enhances the product's appeal, creating an eco-friendly, nature-inspired look.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Natural.jpg",
      },
      {
        subCategory: "beach",
        prompt:
          "A stylish pair of eyeglasses placed on a sandy beach background with gentle waves in the distance. This setting evokes a sense of relaxation and vacation, ideal for promoting summer collections or lifestyle imagery.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Beach.jpg",
      },
      {
        subCategory: "concrete",
        prompt:
          "Modern eyeglasses displayed on a sleek, urban concrete surface. The raw texture contrasts with the refined design of the glasses, creating a minimalist, industrial look that suits contemporary or edgy brands.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Concrete.jpg",
      },
      {
        subCategory: "stone_wall",
        prompt:
          "Eyeglasses showcased against a rustic stone wall backdrop. The texture and color of the stones provide an earthy, grounded look, ideal for brands that emphasize durability or an outdoorsy aesthetic.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Stone_Wall.jpg",
      },
      {
        subCategory: "brick_wall",
        prompt:
          "Eyeglasses displayed in front of a classic red brick wall, creating a vintage, urban feel. The setting enhances the appeal of the product by giving it a timeless, rugged background.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Brick_Wall.jpg",
      },
      {
        subCategory: "city_street",
        prompt:
          "A stylish pair of eyeglasses photographed against a busy city street background with blurred motion. The urban setting conveys a dynamic, trendy lifestyle, ideal for products targeting city dwellers and professionals.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/City_Street.jpg",
      },
      {
        subCategory: "park",
        prompt:
          "Eyeglasses placed on a park bench with a serene, green park landscape in the background. This outdoor setting suggests relaxation and nature, ideal for brands focusing on a laid-back or eco-friendly image.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Park.jpg",
      },
      {
        subCategory: "rustic",
        prompt:
          "Eyeglasses on a rustic wooden table, surrounded by vintage accessories. The setting has a warm, old-world charm, suitable for brands targeting a classic, artisanal aesthetic.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Rustic.jpg",
      },
      {
        subCategory: "desert",
        prompt:
          "A pair of eyeglasses photographed against a sandy desert background with subtle dunes in the distance. The setting conveys a sense of adventure and resilience, ideal for products aimed at travelers or outdoor enthusiasts.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Desert.jpg",
      },
      {
        subCategory: "mountain",
        prompt:
          "Eyeglasses placed on a rocky surface with majestic mountains in the background. The natural, rugged landscape conveys a sense of exploration and freedom, perfect for brands promoting outdoor adventure gear.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Mountain.jpg",
      },
    ],
  },
  {
    category: "plain_color",
    subCategories: [
      {
        subCategory: "beige",
        prompt:
          "Eyeglasses displayed on a smooth beige background, creating a warm, neutral aesthetic that focuses entirely on the product. The setting is ideal for a clean, minimalist product display on an e-commerce site.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Beige.jpg",
      },
      {
        subCategory: "pink",
        prompt:
          "Stylish eyeglasses placed on a pastel pink background, creating a soft, trendy look that highlights the product. The feminine touch is perfect for targeting a fashion-conscious audience.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Pink.jpg",
      },
      {
        subCategory: "yellow",
        prompt:
          "Eyeglasses photographed against a vibrant yellow background, creating an energetic, eye-catching display. Ideal for brands targeting young, vibrant audiences looking for bold style choices.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Yellow.jpg",
      },
      {
        subCategory: "green",
        prompt:
          "Eyeglasses showcased on a fresh green background, creating a natural and calming aesthetic. This setup is perfect for brands that emphasize eco-friendly or sustainable products.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Green.jpg",
      },
      {
        subCategory: "purple",
        prompt:
          "Elegant eyeglasses displayed on a rich purple background, creating a luxurious, refined look. The background color adds a sophisticated tone, suitable for high-end or premium eyewear collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Purple.jpg",
      },
      {
        subCategory: "white",
        prompt:
          "Eyeglasses displayed on a pure white background for a clean, high-contrast product shot. The simplicity keeps all attention on the product, ideal for professional e-commerce listings.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/White.jpg",
      },
      {
        subCategory: "dark_grey",
        prompt:
          "Eyeglasses presented on a dark grey background, giving a sleek, modern vibe. The contrast enhances the product's shape and details, perfect for showcasing stylish, urban eyewear.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Dark_Grey.jpg",
      },
      {
        subCategory: "grey",
        prompt:
          "Product-focused eyeglasses photo with a neutral grey background, adding a subtle sophistication. Ideal for an e-commerce setting that requires a classic and professional look.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Grey.jpg",
      },
      {
        subCategory: "light_grey",
        prompt:
          "A light grey background highlights the eyeglasses, creating a soft and elegant look. The neutral tone is perfect for focusing attention on the design and details of the frames.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Light_Grey.jpg",
      },
      {
        subCategory: "frosted_blue",
        prompt:
          "Eyeglasses displayed on a frosted blue background, giving a cool, refreshing aesthetic. The color brings a sense of calmness, ideal for targeting a professional or corporate audience.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Frosted_Blue.jpg",
      },
      {
        subCategory: "blue",
        prompt:
          "Stylish eyeglasses displayed on a deep blue background, creating a calm, reliable tone. Perfect for brands that want to convey trustworthiness and dependability through their product presentation.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Blue.jpg",
      },
      {
        subCategory: "baby_blue",
        prompt:
          "Eyeglasses placed on a soft baby blue background, providing a light, airy feel. The gentle color adds a subtle charm, ideal for brands targeting a youthful or casual audience.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Baby_Blue.jpg",
      },
      {
        subCategory: "black",
        prompt:
          "Eyeglasses showcased on a deep black background, providing high contrast and a dramatic, sophisticated look. Ideal for brands with a luxurious or minimalist aesthetic.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Black.jpg",
      },
      {
        subCategory: "brown",
        prompt:
          "Eyeglasses displayed on a rich brown background, adding a warm and earthy feel to the image. Perfect for brands focusing on natural or organic materials.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Brown.jpg",
      },
      {
        subCategory: "red",
        prompt:
          "Eyeglasses placed against a bold red background, creating a vibrant, attention-grabbing display. Suitable for fashion-forward brands targeting an energetic, youthful market.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Red.jpg",
      },
      {
        subCategory: "orange",
        prompt:
          "Eyeglasses displayed on a bright orange background, adding a lively, upbeat tone. Ideal for brands targeting a fun, casual audience.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Orange.jpg",
      },
      {
        subCategory: "turquoise",
        prompt:
          "A pair of eyeglasses displayed on a turquoise background, creating a refreshing, modern aesthetic. Ideal for brands that want to convey a unique and stylish vibe.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Turquoise.jpg",
      },
      {
        subCategory: "mint_green",
        prompt:
          "Eyeglasses placed on a mint green background, offering a fresh, calm aesthetic. This setup is ideal for brands that promote eco-friendliness or sustainable lifestyle products.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Mint_Green.jpg",
      },
      {
        subCategory: "lavender",
        prompt:
          "Elegant eyeglasses displayed on a lavender background, adding a gentle, calming tone to the image. Ideal for brands targeting a soft, feminine market.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Lavender.jpg",
      },
      {
        subCategory: "coral",
        prompt:
          "Eyeglasses presented on a coral background, creating a vibrant and trendy look. The color adds a playful touch, perfect for brands targeting a fashion-forward audience.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Coral.jpg",
      },
    ],
  },
  {
    category: "countertop",
    subCategories: [
      {
        subCategory: "light_wood",
        prompt:
          "A pair of eyeglasses displayed on a light wood countertop. The natural wood texture adds warmth and simplicity, making the product look approachable and stylish, suitable for eco-friendly brands.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Light_Wood.jpg",
      },
      {
        subCategory: "dark_wood",
        prompt:
          "Stylish eyeglasses placed on a dark wood countertop, offering a rich and luxurious feel. The deep tones complement the product for a high-end, refined presentation.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Dark_Wood.jpg",
      },
      {
        subCategory: "marble",
        prompt:
          "Eyeglasses displayed on a white marble countertop with subtle veining. The luxurious material enhances the premium appeal of the product, ideal for high-end brands.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Marble.jpg",
      },
      {
        subCategory: "wooden_corner",
        prompt:
          "Eyeglasses set on the corner of a wooden countertop, with natural light casting a soft shadow. The scene adds a homey, inviting feel, perfect for lifestyle-focused product photography.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Wooden_Corner.jpg",
      },
      {
        subCategory: "black_shale",
        prompt:
          "Modern eyeglasses displayed on a textured black shale countertop. The dark, sleek background adds sophistication and highlights the product for a striking visual appeal.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Black_Shale.jpg",
      },
      {
        subCategory: "minimalist",
        prompt:
          "Eyeglasses on a minimalist countertop with a neutral, clean look. The lack of clutter keeps the focus solely on the product, ideal for sleek, modern brands.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Minimalist.jpg",
      },
      {
        subCategory: "natural",
        prompt:
          "Eyeglasses displayed on a natural stone countertop, giving a rustic, earthy feel. This setup is perfect for eco-conscious brands that emphasize natural materials.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Natural.jpg",
      },
      {
        subCategory: "granite",
        prompt:
          "Eyeglasses showcased on a speckled granite countertop. The subtle texture adds depth without distracting from the product, perfect for premium eyewear listings.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Granite.jpg",
      },
      {
        subCategory: "concrete",
        prompt:
          "Stylish eyeglasses displayed on a smooth concrete countertop, creating a modern, industrial aesthetic. Suitable for brands that want a clean, urban look.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Concrete.jpg",
      },
      {
        subCategory: "glass",
        prompt:
          "Eyeglasses presented on a reflective glass countertop, adding elegance and sophistication. The reflection enhances the premium feel, ideal for luxury brands.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Glass.jpg",
      },
      {
        subCategory: "white_marble",
        prompt:
          "Eyeglasses on a polished white marble countertop with fine veining. The luxurious setting elevates the product's appeal, suitable for high-end e-commerce listings.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/White_Marble.jpg",
      },
      {
        subCategory: "grey_marble",
        prompt:
          "Eyeglasses displayed on a grey marble countertop, offering a refined, neutral background. The subtle elegance of the stone complements premium eyewear products.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Grey_Marble.jpg",
      },
      {
        subCategory: "quartz",
        prompt:
          "Eyeglasses on a glossy quartz countertop, adding a smooth and luxurious texture. The light-catching surface enhances the product's appeal for high-end collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Quartz.jpg",
      },
      {
        subCategory: "slate",
        prompt:
          "Eyeglasses displayed on a dark slate countertop, creating a rugged yet sophisticated look. The natural stone adds a touch of masculinity, ideal for unisex or men's eyewear.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Slate.jpg",
      },
      {
        subCategory: "limestone",
        prompt:
          "Eyeglasses on a light limestone countertop, with subtle natural patterns. The neutral background makes the product pop, suitable for an earthy, minimalist aesthetic.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Limestone.jpg",
      },
      {
        subCategory: "butcher_block",
        prompt:
          "Eyeglasses displayed on a rustic butcher block countertop with a warm, natural texture. Perfect for artisanal or vintage-inspired product photos.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Butcher_Block.jpg",
      },
      {
        subCategory: "stainless_steel",
        prompt:
          "Eyeglasses showcased on a brushed stainless steel countertop, giving a sleek and modern feel. Ideal for urban or high-tech brands targeting a professional audience.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Stainless_Steel.jpg",
      },
      {
        subCategory: "rustic_wood",
        prompt:
          "A pair of eyeglasses placed on a rustic wooden countertop with natural grain patterns. The setting provides a cozy, homey feel, ideal for lifestyle-themed product images.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Rustic_Wood.jpg",
      },
      {
        subCategory: "cement",
        prompt:
          "Eyeglasses displayed on a smooth cement countertop, creating a clean, industrial aesthetic. Perfect for brands that want a minimalist, contemporary look.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Cement.jpg",
      },
      {
        subCategory: "porcelain",
        prompt:
          "Eyeglasses on a glossy white porcelain countertop. The clean, smooth surface provides a modern look, suitable for high-end product photography in a minimalist style.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Porcelain.jpg",
      },
    ],
  },
  {
    category: "office",
    subCategories: [
      {
        subCategory: "desk",
        prompt:
          "A sleek pair of eyeglasses placed on a modern office desk with minimalistic decor. The desk is tidy with a notepad, pen, and a closed laptop in the background, conveying professionalism and focus. Ideal for showcasing eyewear in a work-oriented, productivity-inspired setting.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Desk.jpg",
      },
      {
        subCategory: "modern_workspace",
        prompt:
          "A high-resolution image of eyeglasses on a modern workspace setup, featuring clean lines, a sleek monitor, and a comfortable chair. The scene reflects a productive and stylish environment, perfect for targeting a professional audience.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Modern_Workspace.jpg",
      },
      {
        subCategory: "cubicle",
        prompt:
          "Eyeglasses positioned on a well-organized cubicle desk, surrounded by essential office supplies. The neutral tones and subtle lighting emphasize the practical, everyday functionality of the eyewear, making it relatable for a corporate setting.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Cubicle.jpg",
      },
      {
        subCategory: "conference_room",
        prompt:
          "A sophisticated pair of eyeglasses placed on a conference room table, with a glass wall and large windows in the background. The setting exudes professionalism, perfect for an e-commerce display targeting executives and business professionals.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Conference_Room.jpg",
      },
      {
        subCategory: "bookshelf",
        prompt:
          "Eyeglasses resting on an open book in front of a stylish bookshelf filled with neatly arranged books. The warm lighting and intellectual vibe make this scene ideal for promoting eyewear aimed at readers and knowledge-seekers.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Bookshelf.jpg",
      },
      {
        subCategory: "coffee_table",
        prompt:
          "Eyeglasses casually placed on a modern coffee table with a cup of coffee and a few magazines. The cozy and inviting atmosphere appeals to customers looking for casual yet stylish eyewear.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Coffee_Table.jpg",
      },
      {
        subCategory: "window_view",
        prompt:
          "Eyeglasses placed on a table near a large office window with a view of the city skyline. The natural light and urban backdrop enhance the sophisticated appeal of the eyewear, targeting professionals in a city environment.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Window_View.jpg",
      },
      {
        subCategory: "whiteboard",
        prompt:
          "Eyeglasses positioned on a table in front of a whiteboard with neatly drawn diagrams and notes. This setting emphasizes productivity and focus, ideal for eyewear targeting students and professionals alike.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Whiteboard.jpg",
      },
      {
        subCategory: "minimalist_desk",
        prompt:
          "A clean and minimalist desk setup with eyeglasses placed neatly alongside a pen and a notepad. The simplicity of the background highlights the product, making it perfect for e-commerce photography focused on modern design.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Minimalist_Desk.jpg",
      },
      {
        subCategory: "office_plant",
        prompt:
          "Eyeglasses displayed on a desk with a small potted plant nearby, adding a touch of greenery. The fresh and vibrant setting is ideal for brands promoting wellness and work-life balance.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Office_Plant.jpg",
      },
      {
        subCategory: "meeting_room",
        prompt:
          "Eyeglasses placed on a polished conference table in a modern meeting room with large windows and sleek furniture. This corporate setting conveys a sense of professionalism, ideal for an executive-targeted eyewear line.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Meeting_Room.jpg",
      },
      {
        subCategory: "glass_wall",
        prompt:
          "A stylish pair of eyeglasses set against a glass wall backdrop, reflecting an urban office interior. The sleek, transparent elements add a contemporary feel, perfect for showcasing modern eyewear.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Glass_Wall.jpg",
      },
      {
        subCategory: "abstract_art",
        prompt:
          "Eyeglasses displayed on a desk with abstract art hanging on the wall in the background. The creative setting appeals to artistic and design-focused customers, adding a touch of sophistication to the product.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Abstract_Art.jpg",
      },
      {
        subCategory: "wooden_desk",
        prompt:
          "Eyeglasses placed on a classic wooden desk with a vintage lamp and a leather-bound notebook. The rich textures create a warm, intellectual atmosphere, ideal for timeless, sophisticated eyewear.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Wooden_Desk.jpg",
      },
      {
        subCategory: "ergonomic_chair",
        prompt:
          "Eyeglasses positioned on a desk next to an ergonomic office chair, with a laptop and notebook nearby. The professional yet comfortable setup targets audiences interested in style and practicality.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Ergonomic_Chair.jpg",
      },
      {
        subCategory: "open_workspace",
        prompt:
          "A pair of eyeglasses on a shared workspace table in an open office layout, with minimal decor and natural light. The modern, collaborative setting appeals to young professionals and startup culture.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Open_Workspace.jpg",
      },
      {
        subCategory: "industrial_office",
        prompt:
          "Eyeglasses displayed on a rough wooden desk with industrial decor, exposed brick walls, and metal accents. This raw, edgy environment is perfect for brands targeting a trendy, urban audience.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Industrial_Office.jpg",
      },
      {
        subCategory: "reception_area",
        prompt:
          "Eyeglasses on a sleek reception counter with a logo wall in the background. The setting is welcoming and professional, ideal for brands targeting corporate clients or high-end buyers.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Reception_Area.jpg",
      },
      {
        subCategory: "wall_shelf",
        prompt:
          "Eyeglasses placed on a modern wall shelf with minimalist decor. The clean lines and open space give the image a contemporary feel, perfect for showcasing the eyewear's stylish design.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Wall_Shelf.jpg",
      },
      {
        subCategory: "laptop_station",
        prompt:
          "Eyeglasses positioned next to a laptop in a workspace setup. The scene is bright and organized, appealing to professionals looking for eyewear that complements their work environment.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Laptop_Station.jpg",
      },
    ],
  },
  {
    category: "urban",
    subCategories: [
      {
        subCategory: "street",
        prompt:
          "Eyeglasses displayed on a stylish urban street background with city lights and a vibrant atmosphere. Perfect for trendy, everyday eyewear collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Street.jpg",
      },
      {
        subCategory: "downtown",
        prompt:
          "Eyeglasses placed on a bench in a bustling downtown setting, with skyscrapers and city life in the background. Ideal for modern, urban-inspired collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Downtown.jpg",
      },
      {
        subCategory: "alley",
        prompt:
          "Eyeglasses showcased in a narrow city alley with graffiti and gritty textures, adding an edgy, streetwise vibe. Suitable for casual, youth-focused eyewear.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Alley.jpg",
      },
      {
        subCategory: "subway",
        prompt:
          "Eyeglasses positioned on a bench in a subway station, capturing the fast-paced, modern lifestyle of city dwellers. Ideal for brands targeting commuters and city life.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Subway.jpg",
      },
      {
        subCategory: "city_park",
        prompt:
          "Eyeglasses displayed on a bench in a city park with green trees and people in the background. A perfect blend of urban and nature, suitable for versatile, everyday eyewear.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/City_Park.jpg",
      },
      {
        subCategory: "skyscraper",
        prompt:
          "Eyeglasses shown against the backdrop of towering skyscrapers, symbolizing sophistication and urban elegance. Ideal for premium, high-end collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Skyscraper.jpg",
      },
      {
        subCategory: "bridge",
        prompt:
          "Eyeglasses placed on a city bridge with a river and skyline in the background, capturing a sense of connection and movement. Great for travel-themed or urban lifestyle products.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Bridge.jpg",
      },
      {
        subCategory: "graffiti_wall",
        prompt:
          "Eyeglasses displayed in front of a colorful graffiti wall, adding a pop of creativity and street style. Perfect for brands targeting a youthful, artistic audience.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Graffiti_Wall.jpg",
      },
      {
        subCategory: "apartment_building",
        prompt:
          "Eyeglasses on a ledge with modern apartment buildings in the background. This setting emphasizes city life, perfect for trendy, urban eyewear collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Apartment_Building.jpg",
      },
      {
        subCategory: "shopping_mall",
        prompt:
          "Eyeglasses displayed on a modern shopping mall counter, with sleek lighting and clean design. Ideal for a commercial, upscale presentation targeting shoppers.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Shopping_Mall.jpg",
      },
      {
        subCategory: "crosswalk",
        prompt:
          "Eyeglasses placed near a crosswalk in a busy city area, capturing the movement and vibrancy of urban life. Ideal for lifestyle-oriented, everyday eyewear.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Crosswalk.jpg",
      },
      {
        subCategory: "parking_lot",
        prompt:
          "Eyeglasses displayed on a concrete surface in a parking lot, with soft natural light. The setting is minimalist and urban, suitable for casual, streetwear-inspired products.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Parking_Lot.jpg",
      },
      {
        subCategory: "bus_stop",
        prompt:
          "Eyeglasses positioned on a bench at a city bus stop, emphasizing convenience and everyday style. Perfect for brands targeting commuters and practical users.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Bus_Stop.jpg",
      },
      {
        subCategory: "metro_station",
        prompt:
          "Eyeglasses showcased on a bench in a bustling metro station, capturing the fast-paced city lifestyle. Suitable for modern, active eyewear collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Metro_Station.jpg",
      },
      {
        subCategory: "train_station",
        prompt:
          "Eyeglasses displayed on a counter in a train station, conveying travel and movement. Ideal for brands that appeal to frequent travelers and commuters.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Train_Station.jpg",
      },
      {
        subCategory: "urban_garden",
        prompt:
          "Eyeglasses placed on a bench in an urban garden with plants and city buildings in the background. The mix of nature and city life appeals to eco-conscious urban customers.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Urban_Garden.jpg",
      },
      {
        subCategory: "highway",
        prompt:
          "Eyeglasses displayed on a concrete divider along a highway, capturing a sense of movement and journey. Perfect for adventurous, travel-inspired eyewear brands.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Highway.jpg",
      },
      {
        subCategory: "rooftop",
        prompt:
          "Eyeglasses positioned on a rooftop ledge with a cityscape view. This setting is chic and modern, ideal for brands targeting urban professionals.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Rooftop.jpg",
      },
      {
        subCategory: "stadium",
        prompt:
          "Eyeglasses displayed near the entrance of a stadium, reflecting a sporty and energetic vibe. Perfect for active, casual eyewear collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Stadium.jpg",
      },
      {
        subCategory: "town_square",
        prompt:
          "Eyeglasses positioned in a lively town square, with people and activity in the background. This vibrant setting is ideal for lifestyle-focused eyewear brands.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Town_Square.jpg",
      },
    ],
  },
  {
    category: "luxury",
    subCategories: [
      {
        subCategory: "crystal_chandelier",
        prompt:
          "A pair of eyeglasses elegantly positioned under a dazzling crystal chandelier, reflecting the opulent lighting. The luxurious surroundings with shimmering crystals highlight the premium quality and sophistication of the eyewear, perfect for high-end customers.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Crystal_Chandelier.jpg",
      },
      {
        subCategory: "marble_floor",
        prompt:
          "Eyeglasses displayed on a pristine marble floor with subtle natural light highlighting their frame. The setting radiates luxury and refinement, making the eyewear stand out in a premium environment suitable for high-class product images.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Marble_Floor.jpg",
      },
      {
        subCategory: "gold_accents",
        prompt:
          "A stylish pair of eyeglasses surrounded by gold accents and warm lighting, emphasizing the luxury and elegance of the frame. Ideal for an affluent audience, the setting brings a sense of exclusivity and sophistication.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Gold_Accents.jpg",
      },
      {
        subCategory: "velvet_sofa",
        prompt:
          "Eyeglasses casually resting on a plush velvet sofa in a luxurious living room setting. The soft textures and rich colors create a cozy yet premium atmosphere, perfect for a high-end brand looking to convey comfort and style.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Velvet_Sofa.jpg",
      },
      {
        subCategory: "private_jet",
        prompt:
          "Eyeglasses placed on a polished table inside a private jet, with the window view of clouds in the background. The setting exudes exclusivity and affluence, appealing to a luxury-seeking clientele.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Private_Jet.jpg",
      },
      {
        subCategory: "yacht",
        prompt:
          "Eyeglasses displayed on a wooden deck of a yacht with an ocean view in the background. This luxurious, tranquil setting highlights the product's sophistication, ideal for a premium audience.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Yacht.jpg",
      },
      {
        subCategory: "penthouse",
        prompt:
          "Eyeglasses set on a glass table in a high-rise penthouse with a cityscape view. The refined atmosphere and breathtaking view emphasize the product's luxury and exclusivity.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Penthouse.jpg",
      },
      {
        subCategory: "poolside",
        prompt:
          "Eyeglasses laid on a poolside table, with turquoise water and sunlit reflections. The luxurious outdoor setting conveys relaxation and elegance, perfect for summer or resort-themed collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Poolside.jpg",
      },
      {
        subCategory: "luxury_bedroom",
        prompt:
          "Eyeglasses resting on a bedside table in a lavish bedroom, featuring soft lighting and high-end decor. The warm, intimate atmosphere adds an element of comfort and luxury to the product.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Luxury_Bedroom.jpg",
      },
      {
        subCategory: "luxury_bathroom",
        prompt:
          "Eyeglasses displayed on a marble sink in a luxury bathroom with gold fixtures and soft lighting. This sophisticated setting highlights the product's elegance and attention to detail.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Luxury_Bathroom.jpg",
      },
      {
        subCategory: "expensive_car",
        prompt:
          "Eyeglasses positioned on the dashboard of an expensive car, with leather seats and a polished interior. The setting is sleek and modern, appealing to affluent customers with a taste for luxury.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Expensive_Car.jpg",
      },
      {
        subCategory: "wine_cellar",
        prompt:
          "Eyeglasses displayed on a wooden rack inside a wine cellar, with bottles and barrels in the background. The setting is rich and classic, ideal for conveying timeless style and luxury.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Wine_Cellar.jpg",
      },
      {
        subCategory: "library",
        prompt:
          "Eyeglasses resting on an open book in an elegant library, surrounded by shelves of leather-bound books. This intellectual and refined setting appeals to an audience with a taste for sophistication.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Library.jpg",
      },
      {
        subCategory: "luxury_lounge",
        prompt:
          "Eyeglasses placed on a coffee table in a luxurious lounge with plush seating and ambient lighting. The setting is inviting and stylish, suitable for high-end eyewear collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Luxury_Lounge.jpg",
      },
      {
        subCategory: "cinema_room",
        prompt:
          "Eyeglasses set on a sleek console in a private cinema room with ambient lighting and plush seating. The setting conveys exclusivity and style, ideal for a premium lifestyle brand.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Cinema_Room.jpg",
      },
      {
        subCategory: "jacuzzi",
        prompt:
          "Eyeglasses displayed poolside near a Jacuzzi, with gentle water reflections enhancing the luxurious setting. Perfect for a resort or luxury-themed product showcase.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Jacuzzi.jpg",
      },
      {
        subCategory: "fine_dining",
        prompt:
          "Eyeglasses placed on a fine dining table with an elegant place setting and soft candlelight. The setting is refined and luxurious, ideal for customers seeking sophistication and style.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Fine_Dining.jpg",
      },
      {
        subCategory: "penthouse_view",
        prompt:
          "Eyeglasses set on a marble table in front of a panoramic city view from a penthouse. The setting exudes luxury and exclusivity, perfect for high-end eyewear presentations.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Penthouse_View.jpg",
      },
      {
        subCategory: "spa_room",
        prompt:
          "Eyeglasses resting on a spa towel in a serene, luxurious spa room with soft lighting. The tranquil setting conveys relaxation and elegance, appealing to customers who appreciate self-care and luxury.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Spa_Room.jpg",
      },
      {
        subCategory: "art_gallery",
        prompt:
          "Eyeglasses displayed on a pedestal in an art gallery setting, surrounded by modern art pieces. The high-end, cultured atmosphere highlights the product's elegance and sophistication.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Art_Gallery.jpg",
      },
    ],
  },
  {
    category: "outdoors",
    subCategories: [
      {
        subCategory: "garden",
        prompt:
          "Eyeglasses placed on a table in a lush garden setting, surrounded by vibrant flowers and greenery. The natural light and outdoor ambiance emphasize freshness and style, ideal for summer or nature-themed collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Garden.jpg",
      },
      {
        subCategory: "backyard",
        prompt:
          "Eyeglasses resting on a wooden table in a cozy backyard with string lights and potted plants. This casual, inviting setting is perfect for showcasing everyday eyewear with a natural feel.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Backyard.jpg",
      },
      {
        subCategory: "campfire",
        prompt:
          "Eyeglasses positioned on a wooden log near a campfire, with warm flames and an outdoor atmosphere. The rugged, adventurous vibe appeals to outdoor enthusiasts.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Campfire.jpg",
      },
      {
        subCategory: "lake",
        prompt:
          "Eyeglasses displayed on a wooden dock overlooking a calm lake with mountains in the distance. The peaceful, scenic setting is perfect for outdoor and nature-focused collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Lake.jpg",
      },
      {
        subCategory: "mountain_trail",
        prompt:
          "Eyeglasses placed on a rock beside a mountain trail, with scenic vistas in the background. The adventurous setting appeals to a travel-loving audience.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Mountain_Trail.jpg",
      },
      {
        subCategory: "picnic_area",
        prompt:
          "Eyeglasses resting on a picnic blanket with a spread of food and a beautiful park background. The casual, friendly atmosphere is perfect for summer or weekend-themed product photos.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Picnic_Area.jpg",
      },
      {
        subCategory: "park_bench",
        prompt:
          "Eyeglasses placed on a park bench with trees and open space in the background, conveying a relaxed, casual vibe ideal for outdoor collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Park_Bench.jpg",
      },
      {
        subCategory: "countryside",
        prompt:
          "Eyeglasses displayed on a fence post in a rural countryside setting, with fields and hills stretching into the distance. The pastoral setting is perfect for rustic or nature-inspired eyewear.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Countryside.jpg",
      },
      {
        subCategory: "botanical_garden",
        prompt:
          "Eyeglasses positioned on a stone bench in a botanical garden surrounded by lush plants. The vibrant greenery emphasizes a connection to nature and elegance.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Botanical_Garden.jpg",
      },
      {
        subCategory: "orchard",
        prompt:
          "Eyeglasses resting on a wooden crate in an orchard, with fruit trees in the background. The fresh and natural setting appeals to customers looking for eco-friendly or nature-inspired products.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Orchard.jpg",
      },
      {
        subCategory: "beachfront",
        prompt:
          "Eyeglasses positioned on a beachside table with ocean waves and sand in the background. The relaxed, tropical vibe is ideal for vacation-themed collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Beachfront.jpg",
      },
      {
        subCategory: "hiking_path",
        prompt:
          "Eyeglasses displayed on a rock by a hiking path with forest trees and dappled sunlight. The setting suggests adventure and outdoor activities, ideal for activewear collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Hiking_Path.jpg",
      },
      {
        subCategory: "waterfront",
        prompt:
          "Eyeglasses resting on a pier at a waterfront location with scenic views. The peaceful setting is perfect for brands promoting an outdoor lifestyle.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Waterfront.jpg",
      },
      {
        subCategory: "outdoor_gym",
        prompt:
          "Eyeglasses positioned on a gym bench in an outdoor workout space, with natural surroundings. The energetic setting is ideal for active and sporty eyewear collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Outdoor_Gym.jpg",
      },
      {
        subCategory: "cabin",
        prompt:
          "Eyeglasses placed on a rustic wooden table inside a cozy cabin, with warm, natural lighting. The setting appeals to outdoor enthusiasts and those seeking relaxation.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Cabin.jpg",
      },
      {
        subCategory: "fishing_spot",
        prompt:
          "Eyeglasses displayed on a dock by a fishing spot, with serene water in the background. The calm, natural setting is perfect for outdoor and nature-themed eyewear.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Fishing_Spot.jpg",
      },
      {
        subCategory: "cliff",
        prompt:
          "Eyeglasses positioned on a rock at the edge of a cliff, with a breathtaking view of the valley below. The adventurous setting appeals to thrill-seekers and outdoor lovers.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Cliff.jpg",
      },
      {
        subCategory: "hot_springs",
        prompt:
          "Eyeglasses resting on a towel near a natural hot spring with steam rising in the background. The tranquil, unique setting adds a touch of luxury and relaxation.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Hot_Springs.jpg",
      },
      {
        subCategory: "vineyard",
        prompt:
          "Eyeglasses placed on a rustic barrel in a vineyard, with rows of grapevines stretching into the distance. The sophisticated, natural setting appeals to wine and luxury lifestyle audiences.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Vineyard.jpg",
      },
      {
        subCategory: "beach_umbrella",
        prompt:
          "Eyeglasses positioned under a beach umbrella on the sand, with the ocean and blue sky in the background. The tropical, vacation-like setting is ideal for resort and summer-themed collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Beach_Umbrella.jpg",
      },
    ],
  },
  {
    category: "historical",
    subCategories: [
      {
        subCategory: "castle",
        prompt:
          "Eyeglasses displayed on a stone ledge with an ancient castle in the background, evoking a sense of history and grandeur. Perfect for classic, timeless collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Castle.jpg",
      },
      {
        subCategory: "ruins",
        prompt:
          "Eyeglasses positioned on ancient stone ruins, with weathered textures and a mysterious atmosphere. Ideal for brands looking to convey depth and heritage.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Ruins.jpg",
      },
      {
        subCategory: "temple",
        prompt:
          "Eyeglasses placed on a stone bench near an ancient temple, surrounded by historical architecture. Perfect for showcasing products with a refined, classic aesthetic.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Temple.jpg",
      },
      {
        subCategory: "monastery",
        prompt:
          "Eyeglasses positioned on a wooden bench in a quiet monastery, with serene surroundings. The peaceful, timeless setting is ideal for spiritual or contemplative collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Monastery.jpg",
      },
      {
        subCategory: "historical_library",
        prompt:
          "Eyeglasses displayed on an antique desk in a historical library filled with old books. The intellectual setting appeals to scholarly or heritage-focused brands.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Historical_Library.jpg",
      },
      {
        subCategory: "museum",
        prompt:
          "Eyeglasses positioned on a marble pedestal in a museum setting, surrounded by art pieces. This cultured setting appeals to an audience appreciative of art and history.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Museum.jpg",
      },
      {
        subCategory: "old_city_street",
        prompt:
          "Eyeglasses displayed on a cobblestone street in an old town setting, with charming historical buildings in the background. Perfect for vintage or classic-inspired collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Old_City_Street.jpg",
      },
      {
        subCategory: "medieval_village",
        prompt:
          "Eyeglasses positioned on a wooden table in a medieval village setting, with rustic houses and cobblestone paths. This nostalgic, historical setting appeals to heritage-focused brands.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Medieval_Village.jpg",
      },
      {
        subCategory: "ancient_market",
        prompt:
          "Eyeglasses placed on a merchant's table in an ancient market, with pottery and textiles in the background. Perfect for culturally rich, traditional collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Ancient_Market.jpg",
      },
      {
        subCategory: "palace",
        prompt:
          "Eyeglasses displayed on a marble surface in a royal palace setting, surrounded by ornate decorations. Ideal for luxury or vintage collections targeting a refined audience.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Palace.jpg",
      },
      {
        subCategory: "coliseum",
        prompt:
          "Eyeglasses positioned on a stone ledge near the Coliseum, capturing historical grandeur. Suitable for bold, statement eyewear collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Coliseum.jpg",
      },
      {
        subCategory: "cathedral",
        prompt:
          "Eyeglasses displayed on a stone bench in a cathedral, with stained glass windows adding color and light. Perfect for heritage-inspired, elegant collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Cathedral.jpg",
      },
      {
        subCategory: "church",
        prompt:
          "Eyeglasses positioned near the entrance of a historical church, capturing a sense of timelessness. Ideal for classic and refined eyewear.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Church.jpg",
      },
      {
        subCategory: "statue",
        prompt:
          "Eyeglasses placed near a historic statue, with detailed carvings and a cultural ambiance. Great for brands that convey artistry and elegance.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Statue.jpg",
      },
      {
        subCategory: "arch",
        prompt:
          "Eyeglasses positioned under an ancient stone archway, creating a sense of history and passage. Suitable for vintage-inspired collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Arch.jpg",
      },
      {
        subCategory: "historical_bridge",
        prompt:
          "Eyeglasses displayed on a stone railing of a historical bridge, with scenic views in the background. Perfect for classic or vintage eyewear.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Historical_Bridge.jpg",
      },
      {
        subCategory: "old_mansion",
        prompt:
          "Eyeglasses positioned on a vintage desk in an old mansion with classic decor. Ideal for a high-end, timeless aesthetic.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Old_Mansion.jpg",
      },
      {
        subCategory: "town_hall",
        prompt:
          "Eyeglasses displayed on a bench in front of a historic town hall, conveying a sense of community and heritage. Great for classic collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Town_Hall.jpg",
      },
      {
        subCategory: "clock_tower",
        prompt:
          "Eyeglasses positioned on a stone ledge near a historical clock tower, emphasizing timelessness. Suitable for watches and classic eyewear.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Clock_Tower.jpg",
      },
      {
        subCategory: "historical_port",
        prompt:
          "Eyeglasses displayed on a wooden dock in a historical port with sailboats in the background. Perfect for nautical or vintage-themed collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Historical_Port.jpg",
      },
    ],
  },
  {
    category: "industrial",
    subCategories: [
      {
        subCategory: "warehouse",
        prompt:
          "A pair of eyeglasses displayed on a metal shelf in an industrial warehouse with high ceilings, exposed beams, and scattered pallets. The raw and rugged surroundings emphasize durability and modern style, ideal for an urban, edgy look.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Warehouse.jpg",
      },
      {
        subCategory: "factory",
        prompt:
          "Eyeglasses resting on a metal surface in an industrial factory setting, with machinery and pipes in the background. The environment conveys a sense of strength and precision, suitable for brands focused on functionality and style.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Factory.jpg",
      },
      {
        subCategory: "construction_site",
        prompt:
          "Eyeglasses placed on a steel beam at a construction site, with cranes and partially built structures in the background. The setting emphasizes resilience and modernity, perfect for rugged and durable eyewear.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Construction_Site.jpg",
      },
      {
        subCategory: "steel_beams",
        prompt:
          "Eyeglasses displayed against a backdrop of stacked steel beams, highlighting a bold and industrial aesthetic. The sleek design of the glasses contrasts with the raw materials, creating an eye-catching composition.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Steel_Beams.jpg",
      },
      {
        subCategory: "pipes",
        prompt:
          "Eyeglasses positioned on a network of pipes in an industrial setting, with a focus on metallic textures and shadows. This setting appeals to customers seeking a modern, industrial style.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Pipes.jpg",
      },
      {
        subCategory: "old_machinery",
        prompt:
          "Eyeglasses resting on a piece of vintage machinery with rusted bolts and levers. The nostalgic, gritty setting adds character to the product, ideal for brands with a retro or industrial theme.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Old_Machinery.jpg",
      },
      {
        subCategory: "concrete_floor",
        prompt:
          "Eyeglasses laid on a polished concrete floor, with minimalist industrial decor in the background. This clean, unfussy setting emphasizes modern, straightforward design.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Concrete_Floor.jpg",
      },
      {
        subCategory: "rusted_metal",
        prompt:
          "Eyeglasses placed on a rusted metal surface, with a textured, aged appearance. The industrial setting conveys rugged style, ideal for an urban or vintage-inspired collection.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Rusted_Metal.jpg",
      },
      {
        subCategory: "brick_wall",
        prompt:
          "Eyeglasses displayed against an exposed brick wall, with warm natural light enhancing the texture. This classic industrial background is perfect for a stylish, urban look.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Brick_Wall.jpg",
      },
      {
        subCategory: "garage",
        prompt:
          "Eyeglasses resting on a workbench in a garage with tools scattered around. The casual, practical setting appeals to an audience looking for functional, stylish eyewear.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Garage.jpg",
      },
      {
        subCategory: "power_plant",
        prompt:
          "Eyeglasses displayed in a power plant setting with turbines and machinery. The high-tech, industrial environment is ideal for brands focusing on innovation and strength.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Power_Plant.jpg",
      },
      {
        subCategory: "workshop",
        prompt:
          "Eyeglasses positioned on a wooden workbench in a workshop, surrounded by tools. The setting adds a crafted, handmade feel, ideal for artisanal or rugged eyewear.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Workshop.jpg",
      },
      {
        subCategory: "loading_dock",
        prompt:
          "Eyeglasses placed on a stack of crates at a loading dock, with shipping containers and industrial equipment in the background. This setting is perfect for a bold, practical aesthetic.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Loading_Dock.jpg",
      },
      {
        subCategory: "shipyard",
        prompt:
          "Eyeglasses displayed on a metal platform in a shipyard, with large cargo ships and cranes in the background. The rugged, maritime setting is ideal for durable, adventure-focused eyewear.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Shipyard.jpg",
      },
      {
        subCategory: "recycling_plant",
        prompt:
          "Eyeglasses resting on a metal bin in a recycling plant with conveyor belts and machinery. This eco-conscious, industrial setting appeals to environmentally minded consumers.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Recycling_Plant.jpg",
      },
      {
        subCategory: "smokestacks",
        prompt:
          "Eyeglasses positioned with smokestacks in the background, emphasizing an urban, industrial feel. The dramatic setting is ideal for bold, statement eyewear.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Smokestacks.jpg",
      },
      {
        subCategory: "industrial_bridge",
        prompt:
          "Eyeglasses displayed on a metal railing of an industrial bridge, with cables and steel structures in the background. The setting is modern and edgy, ideal for urban style.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Industrial_Bridge.jpg",
      },
      {
        subCategory: "shipping_containers",
        prompt:
          "Eyeglasses resting on a stack of colorful shipping containers, creating a vibrant industrial backdrop. This setting is perfect for a bold, modern look.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Shipping_Containers.jpg",
      },
      {
        subCategory: "abandoned_factory",
        prompt:
          "Eyeglasses placed on a dusty table in an abandoned factory with broken windows and weathered textures. The gritty, nostalgic setting adds character and edge to the product.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Abandoned_Factory.jpg",
      },
      {
        subCategory: "iron_gate",
        prompt:
          "Eyeglasses displayed on an old iron gate with intricate designs and rusted details. This industrial yet artistic setting is perfect for vintage-inspired or bold eyewear.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Iron_Gate.jpg",
      },
    ],
  },
  {
    category: "minimalist",
    subCategories: [
      {
        subCategory: "white_room",
        prompt:
          "Eyeglasses displayed on a simple white table in an all-white room with minimal decor. The clean, uncluttered setting emphasizes simplicity and elegance, perfect for modern, minimalist eyewear.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/White_Room.jpg",
      },
      {
        subCategory: "simple_sofa",
        prompt:
          "Eyeglasses resting on the arm of a simple, neutral-colored sofa in a minimalist living room. The understated background allows the product to stand out, ideal for contemporary brands.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Simple_Sofa.jpg",
      },
      {
        subCategory: "clean_desk",
        prompt:
          "Eyeglasses displayed on a tidy, minimalist desk with a laptop and a cup of coffee. The workspace setting conveys productivity and simplicity, perfect for a modern, professional audience.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Clean_Desk.jpg",
      },
      {
        subCategory: "open_space",
        prompt:
          "Eyeglasses positioned on a small table in a spacious, open room with minimal decor. The airy, open background emphasizes modernity and simplicity.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Open_Space.jpg",
      },
      {
        subCategory: "neutral_colors",
        prompt:
          "Eyeglasses displayed against a backdrop of soft, neutral colors such as beige and grey. The muted tones provide a calming, minimalist aesthetic ideal for timeless eyewear.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Neutral_Colors.jpg",
      },
      {
        subCategory: "low_table",
        prompt:
          "Eyeglasses placed on a low, minimalist table in a modern living room. The simple and functional setting appeals to an audience looking for contemporary design.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Low_Table.jpg",
      },
      {
        subCategory: "minimal_decor",
        prompt:
          "Eyeglasses displayed on a surface with minimal decorative items, focusing on sleek, modern design. The setting is clean and uncluttered, perfect for brands that value simplicity.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Minimal_Decor.jpg",
      },
      {
        subCategory: "no_clutter",
        prompt:
          "Eyeglasses positioned on a clean, empty surface in a minimalist setting, with no clutter or extra items. This pristine environment emphasizes the product's design.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/No_Clutter.jpg",
      },
      {
        subCategory: "green_plant",
        prompt:
          "Eyeglasses resting next to a single green plant in a white-walled room, adding a touch of nature to the minimalist setting. The balance of green and white is ideal for fresh, modern collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Green_Plant.jpg",
      },
      {
        subCategory: "open_windows",
        prompt:
          "Eyeglasses displayed on a table with open windows in the background, allowing natural light to flood the minimalist space. The airy environment conveys simplicity and clarity.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Open_Windows.jpg",
      },
      {
        subCategory: "empty_shelf",
        prompt:
          "Eyeglasses positioned on a single empty shelf against a white wall, highlighting the product's design in a minimalist, uncluttered space.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Empty_Shelf.jpg",
      },
      {
        subCategory: "floor_lamp",
        prompt:
          "Eyeglasses displayed on a low table beside a simple floor lamp in a modern living room. The setting is understated and stylish, perfect for minimalist brands.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Floor_Lamp.jpg",
      },
      {
        subCategory: "concrete_wall",
        prompt:
          "Eyeglasses resting on a surface against a smooth concrete wall, providing an industrial minimalist background. The clean lines and neutral tones appeal to a modern audience.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Concrete_Wall.jpg",
      },
      {
        subCategory: "glass_table",
        prompt:
          "Eyeglasses displayed on a sleek glass table with minimal decor around. The reflective surface adds elegance and sophistication to the minimalist setting.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Glass_Table.jpg",
      },
      {
        subCategory: "wooden_floor",
        prompt:
          "Eyeglasses placed on a light wooden floor in a spacious, minimalist room. The natural wood adds warmth to the otherwise clean, uncluttered setting.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Wooden_Floor.jpg",
      },
      {
        subCategory: "wall_art",
        prompt:
          "Eyeglasses positioned on a shelf below a single piece of abstract wall art in a minimalist room. The artistic yet simple setting appeals to modern, creative customers.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Wall_Art.jpg",
      },
      {
        subCategory: "low_seating",
        prompt:
          "Eyeglasses displayed on a low, minimalist seating area, with neutral colors and clean lines. The setting is calm and stylish, perfect for contemporary brands.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Low_Seating.jpg",
      },
      {
        subCategory: "floor_cushions",
        prompt:
          "Eyeglasses resting on a clean, white floor near minimalist floor cushions. The relaxed, modern setting is ideal for casual yet stylish eyewear.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Floor_Cushions.jpg",
      },
      {
        subCategory: "simple_bed",
        prompt:
          "Eyeglasses displayed on a bedside table next to a simple bed with neutral-colored linens. The cozy, minimalist setting is ideal for promoting relaxation and style.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Simple_Bed.jpg",
      },
      {
        subCategory: "monochrome",
        prompt:
          "Eyeglasses positioned on a monochrome background with shades of grey and black. The setting is bold yet simple, perfect for brands that value elegance and simplicity.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Monochrome.jpg",
      },
    ],
  },
  {
    category: "abstract",
    subCategories: [
      {
        subCategory: "geometric_patterns",
        prompt:
          "Eyeglasses displayed against a backdrop of black and white geometric patterns, adding a touch of modern art. The bold, abstract setting is ideal for stylish, avant-garde collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Geometric_Patterns.jpg",
      },
      {
        subCategory: "colorful_swirls",
        prompt:
          "Eyeglasses positioned in front of vibrant, colorful swirls, creating a dynamic, lively background. Perfect for youthful, playful collections that stand out.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Colorful_Swirls.jpg",
      },
      {
        subCategory: "digital_lines",
        prompt:
          "Eyeglasses displayed on a platform with digital line patterns in the background, conveying a futuristic, tech-inspired aesthetic. Great for high-tech or modern designs.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Digital_Lines.jpg",
      },
      {
        subCategory: "splash_paint",
        prompt:
          "Eyeglasses positioned on a surface with splashes of colorful paint in the background. The energetic, artistic setting is ideal for bold and creative eyewear collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Splash_Paint.jpg",
      },
      {
        subCategory: "gradient_colors",
        prompt:
          "Eyeglasses displayed against a gradient background, transitioning from one color to another. The smooth, contemporary design appeals to modern, trend-focused customers.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Gradient_Colors.jpg",
      },
      {
        subCategory: "shattered_glass",
        prompt:
          "Eyeglasses positioned in front of a shattered glass effect, adding a dramatic and edgy look. Perfect for daring, modern eyewear collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Shattered_Glass.jpg",
      },
      {
        subCategory: "pixel_art",
        prompt:
          "Eyeglasses displayed with a pixel art backdrop, creating a nostalgic, digital-inspired setting. This is perfect for tech-savvy, retro-themed eyewear.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Pixel_Art.jpg",
      },
      {
        subCategory: "neon_lights",
        prompt:
          "Eyeglasses illuminated by neon lights in vibrant colors, ideal for nightlife or club-inspired collections. The energetic setting captures attention.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Neon_Lights.jpg",
      },
      {
        subCategory: "art_deco",
        prompt:
          "Eyeglasses positioned on a surface with Art Deco patterns, adding a touch of luxury and nostalgia. Ideal for vintage-inspired, high-end collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Art_Deco.jpg",
      },
      {
        subCategory: "psychedelic",
        prompt:
          "Eyeglasses displayed against a psychedelic pattern with swirling colors and abstract shapes, appealing to creative, bold customers.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Psychedelic.jpg",
      },
      {
        subCategory: "3d_cubes",
        prompt:
          "Eyeglasses set against a backdrop of 3D cubes, adding depth and dimension. The unique, modern setting is perfect for tech-inspired or futuristic collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/3D_Cubes.jpg",
      },
      {
        subCategory: "dots_and_circles",
        prompt:
          "Eyeglasses displayed against a dotted and circular pattern in contrasting colors. The playful, abstract setting is ideal for fun, casual eyewear collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Dots_and_Circles.jpg",
      },
      {
        subCategory: "optical_illusion",
        prompt:
          "Eyeglasses positioned with an optical illusion background, creating a visually captivating effect. Perfect for unique, eye-catching designs.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Optical_Illusion.jpg",
      },
      {
        subCategory: "brush_strokes",
        prompt:
          "Eyeglasses displayed with abstract brush strokes in various colors, adding an artistic, creative touch. Ideal for artistic, trendy eyewear.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Brush_Strokes.jpg",
      },
      {
        subCategory: "modern_art",
        prompt:
          "Eyeglasses set against a modern art backdrop, featuring bold shapes and contrasting colors. Perfect for statement eyewear collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Modern_Art.jpg",
      },
      {
        subCategory: "cubism",
        prompt:
          "Eyeglasses displayed against a cubist-inspired background with geometric shapes, offering a unique, artistic setting. Ideal for avant-garde eyewear.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Cubism.jpg",
      },
      {
        subCategory: "abstract_nature",
        prompt:
          "Eyeglasses positioned with abstract representations of nature, like stylized leaves and flowers. This setting is perfect for organic-inspired collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Abstract_Nature.jpg",
      },
      {
        subCategory: "ink_splashes",
        prompt:
          "Eyeglasses displayed with an ink splash background in monochrome or muted colors, adding a touch of subtle art. Great for creative, stylish brands.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Ink_Splashes.jpg",
      },
      {
        subCategory: "oil_painting",
        prompt:
          "Eyeglasses set against an oil painting background with rich textures, adding a classical and artistic touch. Ideal for vintage or art-inspired collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Oil_Painting.jpg",
      },
      {
        subCategory: "glitch_art",
        prompt:
          "Eyeglasses positioned against a glitch art background with distorted, pixelated patterns, appealing to modern, tech-savvy customers.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Glitch_Art.jpg",
      },
    ],
  },
  {
    category: "seasonal",
    subCategories: [
      {
        subCategory: "spring_flowers",
        prompt:
          "Eyeglasses displayed against a vibrant field of blooming spring flowers, with soft sunlight illuminating the background. Ideal for fresh and cheerful collections, bringing a touch of nature's rebirth.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Spring_Flowers.jpg",
      },
      {
        subCategory: "summer_beach",
        prompt:
          "Eyeglasses positioned on a sandy beach with waves gently crashing in the background, evoking a carefree, sunny vibe perfect for summer-themed collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Summer_Beach.jpg",
      },
      {
        subCategory: "autumn_leaves",
        prompt:
          "Eyeglasses set among colorful autumn leaves with warm golden light filtering through trees, capturing the cozy and rustic essence of fall. Ideal for seasonal collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Autumn_Leaves.jpg",
      },
      {
        subCategory: "winter_snow",
        prompt:
          "Eyeglasses displayed on a surface with fresh snow around, surrounded by a tranquil winter landscape. Perfect for cozy, warm collections during the winter season.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Winter_Snow.jpg",
      },
      {
        subCategory: "rainy_day",
        prompt:
          "Eyeglasses positioned by a window with raindrops trickling down the glass, creating a calm, introspective atmosphere ideal for a moody, rainy day aesthetic.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Rainy_Day.jpg",
      },
      {
        subCategory: "sunny_meadow",
        prompt:
          "Eyeglasses set in a wide, sunlit meadow with green grass and scattered wildflowers, conveying a feeling of freedom and nature. Perfect for outdoorsy, relaxed collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Sunny_Meadow.jpg",
      },
      {
        subCategory: "foggy_forest",
        prompt:
          "Eyeglasses displayed in a misty forest setting with towering trees and soft light filtering through fog, ideal for a mysterious, atmospheric touch to the product.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Foggy_Forest.jpg",
      },
      {
        subCategory: "fall_harvest",
        prompt:
          "Eyeglasses placed on a rustic wooden surface surrounded by fall harvest items like pumpkins, apples, and dried corn. Great for seasonal marketing in autumn.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Fall_Harvest.jpg",
      },
      {
        subCategory: "winter_cabin",
        prompt:
          "Eyeglasses displayed by a cozy cabin window with a snow-covered landscape outside, evoking warmth and comfort for winter-themed collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Winter_Cabin.jpg",
      },
      {
        subCategory: "spring_garden",
        prompt:
          "Eyeglasses resting in a beautiful spring garden filled with blossoming flowers and lush greenery, perfect for spring collections focused on renewal and freshness.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Spring_Garden.jpg",
      },
      {
        subCategory: "snowy_mountain",
        prompt:
          "Eyeglasses displayed against a backdrop of majestic, snow-capped mountains under a clear blue sky. The cold, rugged setting is ideal for winter sports or outdoor collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Snowy_Mountain.jpg",
      },
      {
        subCategory: "autumn_woods",
        prompt:
          "Eyeglasses set in a dense, colorful autumn forest with fallen leaves scattered on the ground. The warm, earthy tones add a seasonal appeal.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Autumn_Woods.jpg",
      },
      {
        subCategory: "desert_summer",
        prompt:
          "Eyeglasses displayed on a rocky surface with a desert landscape and clear blue skies, evoking heat and summer vibes. Ideal for warm, adventurous collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Desert_Summer.jpg",
      },
      {
        subCategory: "tropical_rain",
        prompt:
          "Eyeglasses placed among lush tropical plants with droplets from a recent rain, creating a fresh, vibrant scene perfect for tropical-themed collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Tropical_Rain.jpg",
      },
      {
        subCategory: "blossoming_trees",
        prompt:
          "Eyeglasses positioned near blossoming trees with petals scattered around, capturing the beauty of spring renewal. Great for nature-inspired designs.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Blossoming_Trees.jpg",
      },
      {
        subCategory: "frosty_morning",
        prompt:
          "Eyeglasses displayed on a surface with frost details around, in a softly lit morning setting. The cold, fresh look is ideal for winter themes.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Frosty_Morning.jpg",
      },
      {
        subCategory: "dry_season",
        prompt:
          "Eyeglasses positioned in a dry, arid landscape with cracked earth, capturing the intense heat and rugged beauty of the dry season.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Dry_Season.jpg",
      },
      {
        subCategory: "tidal_wave",
        prompt:
          "Eyeglasses set on a surface with a crashing wave in the background, evoking the power and energy of the sea. Perfect for beach or water-themed collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Tidal_Wave.jpg",
      },
      {
        subCategory: "blizzard",
        prompt:
          "Eyeglasses displayed against a snowy, blizzard background with intense snow and wind, creating a dramatic winter scene for rugged, durable collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Blizzard.jpg",
      },
      {
        subCategory: "heatwave",
        prompt:
          "Eyeglasses positioned in a sunny outdoor setting with mirage effects and a warm, glowing horizon, capturing the intense heat of summer.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Heatwave.jpg",
      },
    ],
  },
  {
    category: "festival",
    subCategories: [
      {
        subCategory: "christmas",
        prompt:
          "Eyeglasses displayed in a festive Christmas setting with twinkling lights, pine branches, and ornaments. Ideal for holiday-themed collections with a cozy, joyful vibe.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Christmas.jpg",
      },
      {
        subCategory: "halloween",
        prompt:
          "Eyeglasses positioned in a spooky Halloween setting with carved pumpkins, eerie shadows, and fog. Perfect for a fun, playful autumn campaign.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Halloween.jpg",
      },
      {
        subCategory: "easter",
        prompt:
          "Eyeglasses set among colorful Easter eggs and spring flowers, capturing the lighthearted, cheerful essence of the holiday. Ideal for a spring-themed collection.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Easter.jpg",
      },
      {
        subCategory: "thanksgiving",
        prompt:
          "Eyeglasses displayed on a rustic table with autumn leaves, pumpkins, and warm lighting, creating a cozy Thanksgiving ambiance.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Thanksgiving.jpg",
      },
      {
        subCategory: "diwali",
        prompt:
          "Eyeglasses set against a vibrant background with Diwali candles, rangoli designs, and bright colors. Perfect for capturing the festive and cultural essence of Diwali.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Diwali.jpg",
      },
      {
        subCategory: "hanukkah",
        prompt:
          "Eyeglasses displayed near a menorah with lit candles, creating a warm and respectful setting for the Hanukkah holiday.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Hanukkah.jpg",
      },
      {
        subCategory: "valentine's_day",
        prompt:
          "Eyeglasses displayed with romantic elements like rose petals, hearts, and soft pink lighting, ideal for a Valentine's Day campaign.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Valentine's_Day.jpg",
      },
      {
        subCategory: "new_year's_eve",
        prompt:
          "Eyeglasses positioned in a celebratory New Year's Eve setting with champagne, confetti, and festive lights. Perfect for an elegant holiday collection.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/New_Year's_Eve.jpg",
      },
      {
        subCategory: "chinese_new_year",
        prompt:
          "Eyeglasses displayed against a red and gold backdrop with Chinese lanterns and festive decorations, capturing the vibrancy of the Chinese New Year.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Chinese_New_Year.jpg",
      },
      {
        subCategory: "carnival",
        prompt:
          "Eyeglasses in a colorful carnival setting with bright lights, masks, and confetti, evoking the lively atmosphere of carnival celebrations.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Carnival.jpg",
      },
      {
        subCategory: "mardi_gras",
        prompt:
          "Eyeglasses displayed with Mardi Gras beads, masks, and vibrant colors, capturing the festive and energetic spirit of Mardi Gras.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Mardi_Gras.jpg",
      },
      {
        subCategory: "octoberfest",
        prompt:
          "Eyeglasses set on a wooden table with beer mugs and pretzels, creating a lively Octoberfest atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Octoberfest.jpg",
      },
      {
        subCategory: "st._patrick's_day",
        prompt:
          "Eyeglasses displayed with green decorations, shamrocks, and a pint of beer, embodying the festive spirit of St. Patrick's Day.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/St._Patrick's_Day.jpg",
      },
      {
        subCategory: "independence_day",
        prompt:
          "Eyeglasses set against a patriotic backdrop with flags, fireworks, and red, white, and blue colors, perfect for celebrating Independence Day.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Independence_Day.jpg",
      },
      {
        subCategory: "ramadan",
        prompt:
          "Eyeglasses displayed with traditional lanterns, dates, and soft candlelight, creating a serene atmosphere for Ramadan.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Ramadan.jpg",
      },
      {
        subCategory: "holi",
        prompt:
          "Eyeglasses in a vibrant setting with Holi colors and splashes, capturing the joyful and playful spirit of the Holi festival.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Holi.jpg",
      },
      {
        subCategory: "wedding",
        prompt:
          "Eyeglasses positioned with wedding decor such as flowers, lace, and rings, creating an elegant setting for wedding-themed collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Wedding.jpg",
      },
      {
        subCategory: "birthday_party",
        prompt:
          "Eyeglasses displayed with balloons, confetti, and a cake, adding a celebratory and fun feel perfect for a birthday promotion.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Birthday_Party.jpg",
      },
      {
        subCategory: "concert",
        prompt:
          "Eyeglasses displayed with concert lights and music equipment, capturing the energy and excitement of a live music event.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Concert.jpg",
      },
      {
        subCategory: "night_market",
        prompt:
          "Eyeglasses positioned against a colorful, bustling night market backdrop with vibrant lights and food stalls, adding an urban, lively vibe.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Night_Market.jpg",
      },
    ],
  },
  {
    category: "fantasy",
    subCategories: [
      {
        subCategory: "dragon's_cave",
        prompt:
          "Eyeglasses displayed in a mystical cave setting with dim lighting, scattered jewels, and dragon scales, capturing a fantasy, adventurous feel.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Dragon's_Cave.jpg",
      },
      {
        subCategory: "magic_forest",
        prompt:
          "Eyeglasses set in an enchanted forest with glowing plants and floating lights, perfect for a whimsical, fantasy-themed collection.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Magic_Forest.jpg",
      },
      {
        subCategory: "enchanted_castle",
        prompt:
          "Eyeglasses displayed in a grand castle setting with tall stone walls and ornate details, evoking a regal, mystical feel.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Enchanted_Castle.jpg",
      },
      {
        subCategory: "mystic_river",
        prompt:
          "Eyeglasses positioned near a flowing, misty river under moonlight, creating a serene and magical ambiance.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Mystic_River.jpg",
      },
      {
        subCategory: "floating_islands",
        prompt:
          "Eyeglasses displayed on a floating island backdrop with clouds and greenery, creating a surreal, dreamy setting.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Floating_Islands.jpg",
      },
      {
        subCategory: "ancient_ruins",
        prompt:
          "Eyeglasses set against ancient stone ruins, adding a touch of mystery and history. Ideal for unique, heritage-inspired collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Ancient_Ruins.jpg",
      },
      {
        subCategory: "elven_village",
        prompt:
          "Eyeglasses displayed in a serene Elven village with wooden structures and forest surroundings, adding a mystical, ethereal touch.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Elven_Village.jpg",
      },
      {
        subCategory: "wizard_tower",
        prompt:
          "Eyeglasses positioned in a wizard's study with spellbooks, potions, and mystical artifacts. Perfect for a magical, fantasy-inspired design.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Wizard_Tower.jpg",
      },
      {
        subCategory: "crystal_cave",
        prompt:
          "Eyeglasses displayed among shimmering crystals in a cave, creating a sparkling, mystical ambiance.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Crystal_Cave.jpg",
      },
      {
        subCategory: "haunted_mansion",
        prompt:
          "Eyeglasses set in a dimly lit, eerie mansion with cobwebs and antique furniture, perfect for a spooky, gothic look.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Haunted_Mansion.jpg",
      },
      {
        subCategory: "fantasy_village",
        prompt:
          "Eyeglasses displayed in a quaint, whimsical village with cobblestone streets and enchanted shops, ideal for fantasy-inspired designs.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Fantasy_Village.jpg",
      },
      {
        subCategory: "underground_city",
        prompt:
          "Eyeglasses positioned in a dark, mysterious underground city with ancient architecture and soft, glowing lights.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Underground_City.jpg",
      },
      {
        subCategory: "cloud_kingdom",
        prompt:
          "Eyeglasses displayed against a dreamy cloudscape with floating palaces, perfect for light and airy fantasy themes.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Cloud_Kingdom.jpg",
      },
      {
        subCategory: "dark_swamp",
        prompt:
          "Eyeglasses displayed in a misty, mysterious swamp with twisted trees and soft shadows, ideal for a dark fantasy aesthetic.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Dark_Swamp.jpg",
      },
      {
        subCategory: "goblin_market",
        prompt:
          "Eyeglasses set in a vibrant, crowded fantasy market with unique items and mysterious characters, creating a bustling, magical scene.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Goblin_Market.jpg",
      },
      {
        subCategory: "crystal_lake",
        prompt:
          "Eyeglasses displayed beside a lake with sparkling, mystical waters, adding a calm, enchanting vibe to the product.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Crystal_Lake.jpg",
      },
      {
        subCategory: "fairy_garden",
        prompt:
          "Eyeglasses positioned in a lush garden filled with glowing fairy lights and delicate flowers, ideal for a whimsical, fantasy-themed collection.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Fairy_Garden.jpg",
      },
      {
        subCategory: "mystic_meadow",
        prompt:
          "Eyeglasses displayed in a serene meadow with soft mist and a magical glow, creating a peaceful, enchanted setting.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Mystic_Meadow.jpg",
      },
      {
        subCategory: "moonlit_forest",
        prompt:
          "Eyeglasses set in a dark forest under moonlight, creating a mysterious, magical atmosphere perfect for a nighttime aesthetic.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Moonlit_Forest.jpg",
      },
      {
        subCategory: "magical_library",
        prompt:
          "Eyeglasses displayed in an ancient, magical library filled with old books and mystical artifacts, ideal for intellectual, fantasy-inspired designs.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Magical_Library.jpg",
      },
    ],
  },
  {
    category: "sports",
    subCategories: [
      {
        subCategory: "basketball_court",
        prompt:
          "Eyeglasses placed on the edge of a basketball court, with the hardwood floor visible, and a basketball resting nearby. Ideal for an active and sporty vibe.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Basketball_Court.jpg",
      },
      {
        subCategory: "soccer_field",
        prompt:
          "Eyeglasses positioned on the grassy edge of a soccer field, with a net goalpost and soccer ball subtly in the background, giving an outdoor, energetic feel.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Soccer_Field.jpg",
      },
      {
        subCategory: "tennis_court",
        prompt:
          "Eyeglasses displayed on the baseline of a tennis court, with a racket and tennis ball close by, perfect for a sharp and active sportswear theme.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Tennis_Court.jpg",
      },
      {
        subCategory: "baseball_diamond",
        prompt:
          "Eyeglasses set on the dugout bench with a baseball mitt and bat beside it, capturing the rugged yet classic look of a baseball field.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Baseball_Diamond.jpg",
      },
      {
        subCategory: "golf_course",
        prompt:
          "Eyeglasses placed on a pristine golf course with a golf ball and tee in the foreground, surrounded by lush green grass. Perfect for a luxury sports aesthetic.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Golf_Course.jpg",
      },
      {
        subCategory: "swimming_pool",
        prompt:
          "Eyeglasses positioned on a poolside lounger with water ripples reflecting in the lenses, capturing a relaxed, summer vibe ideal for a sporty and fresh look.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Swimming_Pool.jpg",
      },
      {
        subCategory: "ice_rink",
        prompt:
          "Eyeglasses set on the side of an ice rink with a pair of skates nearby, providing a cool, wintry ambiance suitable for winter sports.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Ice_Rink.jpg",
      },
      {
        subCategory: "running_track",
        prompt:
          "Eyeglasses placed on the edge of a running track lane, with track lines clearly visible, perfect for an energetic and motivational vibe.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Running_Track.jpg",
      },
      {
        subCategory: "stadium_seats",
        prompt:
          "Eyeglasses resting on a seat in the stadium, with rows of colorful seats in the background, evoking the excitement of game day.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Stadium_Seats.jpg",
      },
      {
        subCategory: "ski_slope",
        prompt:
          "Eyeglasses positioned on a snowy surface with a ski slope and mountains in the background, giving a rugged and adventurous winter sports vibe.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Ski_Slope.jpg",
      },
      {
        subCategory: "martial_arts_dojo",
        prompt:
          "Eyeglasses set on a clean mat in a martial arts dojo with traditional wooden decor, capturing a disciplined and focused atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Martial_Arts_Dojo.jpg",
      },
      {
        subCategory: "boxing_ring",
        prompt:
          "Eyeglasses displayed on the corner of a boxing ring with boxing gloves nearby, creating a powerful, gritty sports aesthetic.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Boxing_Ring.jpg",
      },
      {
        subCategory: "gym",
        prompt:
          "Eyeglasses placed on a gym bench with weights and gym equipment in the background, embodying a fitness-focused and dynamic vibe.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Gym.jpg",
      },
      {
        subCategory: "rock_climbing_wall",
        prompt:
          "Eyeglasses set on a climbing hold with colorful climbing grips around, capturing an adventurous and challenging look.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Rock_Climbing_Wall.jpg",
      },
      {
        subCategory: "bicycle_path",
        prompt:
          "Eyeglasses displayed on the edge of a bike path with a bicycle wheel visible, conveying a sense of exploration and outdoor activity.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Bicycle_Path.jpg",
      },
      {
        subCategory: "bowling_alley",
        prompt:
          "Eyeglasses positioned on the lane of a bowling alley with a bowling ball and pins in the background, creating a fun, retro sports feel.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Bowling_Alley.jpg",
      },
      {
        subCategory: "dance_studio",
        prompt:
          "Eyeglasses set on a polished dance studio floor with ballet bars and mirrors, capturing the elegance and fluidity of a dance environment.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Dance_Studio.jpg",
      },
      {
        subCategory: "yoga_room",
        prompt:
          "Eyeglasses placed on a yoga mat with calm, minimalist decor, giving a tranquil, balanced vibe suitable for a wellness theme.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Yoga_Room.jpg",
      },
      {
        subCategory: "surfing_beach",
        prompt:
          "Eyeglasses set on the sand with a surfboard and ocean waves in the background, perfect for a carefree, beachy look.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Surfing_Beach.jpg",
      },
      {
        subCategory: "racetrack",
        prompt:
          "Eyeglasses placed on the edge of a racetrack with tire marks and a high-speed feel, evoking adrenaline and speed for an active sports theme.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Racetrack.jpg",
      },
    ],
  },
  {
    category: "food_&_beverage",
    subCategories: [
      {
        subCategory: "kitchen_counter",
        prompt:
          "Eyeglasses resting on a modern kitchen counter with subtle cooking utensils nearby, creating a homely and inviting vibe.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Kitchen_Counter.jpg",
      },
      {
        subCategory: "dining_table",
        prompt:
          "Eyeglasses displayed on a dining table with elegant dinnerware and a soft tablecloth, ideal for a warm, family-friendly setting.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Dining_Table.jpg",
      },
      {
        subCategory: "bar_counter",
        prompt:
          "Eyeglasses positioned on a stylish bar counter with cocktail glasses and ambient bar lighting, conveying an upscale, nightlife atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Bar_Counter.jpg",
      },
      {
        subCategory: "café_interior",
        prompt:
          "Eyeglasses placed on a café table with coffee cups and pastries around, evoking a cozy and inviting coffee shop ambiance.",
      },
      {
        subCategory: "coffee_shop",
        prompt:
          "Eyeglasses displayed beside a cup of steaming coffee and a laptop on a table, creating a relaxed and productive coffee shop setting.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Coffee_Shop.jpg",
      },
      {
        subCategory: "wine_cellar",
        prompt:
          "Eyeglasses positioned on a wine barrel or rack with bottles and glasses nearby, capturing a luxurious, vintage feel.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Wine_Cellar.jpg",
      },
      {
        subCategory: "restaurant_booth",
        prompt:
          "Eyeglasses set on a restaurant booth table with plates and cutlery, giving a comfortable, social dining ambiance.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Restaurant_Booth.jpg",
      },
      {
        subCategory: "food_truck",
        prompt:
          "Eyeglasses positioned on the counter of a food truck, with a dynamic and urban feel, perfect for trendy or casual collections.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Food_Truck.jpg",
      },
      {
        subCategory: "open_kitchen",
        prompt:
          "Eyeglasses displayed in an open kitchen setting with cooking ingredients and utensils, creating an energetic, lively kitchen vibe.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Open_Kitchen.jpg",
      },
      {
        subCategory: "picnic_table",
        prompt:
          "Eyeglasses positioned on a picnic table with a basket, fruits, and drinks around, evoking an outdoorsy, relaxed setting.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Picnic_Table.jpg",
      },
      {
        subCategory: "outdoor_grill",
        prompt:
          "Eyeglasses set beside a grill with food sizzling, capturing the warmth and friendliness of a summer cookout.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Outdoor_Grill.jpg",
      },
      {
        subCategory: "patio",
        prompt:
          "Eyeglasses placed on a patio table with lush greenery around, creating a refreshing, casual outdoor atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Patio.jpg",
      },
      {
        subCategory: "smoothie_bar",
        prompt:
          "Eyeglasses positioned on a smoothie bar counter with fresh fruits and blenders, ideal for a health-focused, vibrant look.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Smoothie_Bar.jpg",
      },
      {
        subCategory: "pizza_oven",
        prompt:
          "Eyeglasses set near a wood-fired pizza oven with the warm glow of fire, perfect for a cozy, rustic food setting.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Pizza_Oven.jpg",
      },
      {
        subCategory: "ice_cream_parlor",
        prompt:
          "Eyeglasses displayed on a countertop with colorful ice cream scoops, evoking a playful and nostalgic atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Ice_Cream_Parlor.jpg",
      },
      {
        subCategory: "farmer's_market",
        prompt:
          "Eyeglasses set on a table at a farmer's market with fresh produce around, capturing a natural, earthy, and vibrant look.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Farmer's_Market.jpg",
      },
      {
        subCategory: "fruit_stand",
        prompt:
          "Eyeglasses displayed on a fruit stand with colorful fruits, creating a fresh and healthy appearance.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Fruit_Stand.jpg",
      },
      {
        subCategory: "bakery",
        prompt:
          "Eyeglasses positioned near baked goods like bread and pastries in a bakery setting, ideal for a warm, homely vibe.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Bakery.jpg",
      },
      {
        subCategory: "brewery",
        prompt:
          "Eyeglasses set on a brewery counter with beer glasses and barrels nearby, creating a rustic, craft-inspired look.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Brewery.jpg",
      },
      {
        subCategory: "sushi_bar",
        prompt:
          "Eyeglasses displayed on a sushi bar counter with fresh sushi and chopsticks, capturing a minimalist, refined dining atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Sushi_Bar.jpg",
      },
    ],
  },
  {
    category: "sci-fi",
    subCategories: [
      {
        subCategory: "space_station",
        prompt:
          "Eyeglasses displayed on a console inside a high-tech space station with soft, futuristic lighting and digital screens around, creating a sleek, sci-fi vibe.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Space_Station.jpg",
      },
      {
        subCategory: "alien_planet",
        prompt:
          "Eyeglasses positioned on a rocky surface of an alien planet with otherworldly plants and a colorful sky, ideal for a bold, futuristic collection.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Alien_Planet.jpg",
      },
      {
        subCategory: "robot_factory",
        prompt:
          "Eyeglasses displayed on a metal workbench in a robot factory with robotic arms and mechanical parts around, conveying an industrial, futuristic aesthetic.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Robot_Factory.jpg",
      },
      {
        subCategory: "futuristic_city",
        prompt:
          "Eyeglasses set against a futuristic cityscape with towering skyscrapers and neon lights, ideal for a tech-inspired, urban look.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Futuristic_City.jpg",
      },
      {
        subCategory: "spaceship_cockpit",
        prompt:
          "Eyeglasses placed on the control panel of a spaceship cockpit with high-tech screens and a cosmic view, perfect for a sci-fi aesthetic.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Spaceship_Cockpit.jpg",
      },
      {
        subCategory: "neon_street",
        prompt:
          "Eyeglasses displayed on a neon-lit street with glowing signs and a cyberpunk ambiance, ideal for a modern, edgy look.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Neon_Street.jpg",
      },
      {
        subCategory: "hologram_lab",
        prompt:
          "Eyeglasses positioned on a futuristic lab table with holographic displays around, creating a sleek and high-tech atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Hologram_Lab.jpg",
      },
      {
        subCategory: "flying_car_garage",
        prompt:
          "Eyeglasses set on a workstation in a flying car garage with a futuristic, industrial backdrop, perfect for a sci-fi look.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Flying_Car_Garage.jpg",
      },
      {
        subCategory: "cyberpunk_alley",
        prompt:
          "Eyeglasses displayed in a dark, neon-lit alley with a cyberpunk feel, ideal for a bold, urban-inspired style.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Cyberpunk_Alley.jpg",
      },
      {
        subCategory: "high-tech_office",
        prompt:
          "Eyeglasses positioned on a sleek desk in a high-tech office with interactive screens, creating a futuristic, sophisticated vibe.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/High-Tech_Office.jpg",
      },
      {
        subCategory: "virtual_reality_room",
        prompt:
          "Eyeglasses displayed in a VR room with holographic screens and modern design, ideal for a forward-thinking, tech-inspired style.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Virtual_Reality_Room.jpg",
      },
      {
        subCategory: "underground_lab",
        prompt:
          "Eyeglasses positioned in a dimly lit underground lab with tech gadgets, evoking a sense of mystery and futuristic innovation.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Underground_Lab.jpg",
      },
      {
        subCategory: "energy_core",
        prompt:
          "Eyeglasses set near a futuristic energy core with glowing lights, ideal for a sci-fi, power-inspired theme.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Energy_Core.jpg",
      },
      {
        subCategory: "floating_platform",
        prompt:
          "Eyeglasses displayed on a futuristic floating platform with a view of a city skyline, perfect for a unique, high-tech aesthetic.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Floating_Platform.jpg",
      },
      {
        subCategory: "digital_network",
        prompt:
          "Eyeglasses positioned in a digital network space with code and virtual lines, creating a tech-savvy, modern look.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Digital_Network.jpg",
      },
      {
        subCategory: "alien_jungle",
        prompt:
          "Eyeglasses set in a lush alien jungle with bioluminescent plants and unique landscapes, ideal for a bold, out-of-this-world vibe.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Alien_Jungle.jpg",
      },
      {
        subCategory: "starship_hangar",
        prompt:
          "Eyeglasses displayed in a starship hangar with spacecrafts and advanced technology around, evoking a bold, sci-fi feel.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Starship_Hangar.jpg",
      },
      {
        subCategory: "bio_lab",
        prompt:
          "Eyeglasses positioned in a futuristic bio lab with scientific equipment and holographic displays, ideal for a scientific, high-tech look.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Bio_Lab.jpg",
      },
      {
        subCategory: "asteroid_field",
        prompt:
          "Eyeglasses set against an asteroid field backdrop, capturing the adventurous and limitless essence of space.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Asteroid_Field.jpg",
      },
      {
        subCategory: "spaceport",
        prompt:
          "Eyeglasses displayed in a futuristic spaceport with spacecrafts and passengers around, creating a modern, adventurous vibe.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Spaceport.jpg",
      },
    ],
  },
  {
    category: "retro",
    subCategories: [
      {
        subCategory: "80s_arcade",
        prompt:
          "Eyeglasses set on a bright, neon-lit arcade machine with retro 80s graphics and vibrant colors in the background. Perfect for capturing a nostalgic, playful vibe.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/80s_Arcade.jpg",
      },
      {
        subCategory: "vintage_living_room",
        prompt:
          "Eyeglasses positioned on a classic wooden coffee table in a vintage living room setting with a floral-patterned sofa, wood-paneled walls, and an old TV. Creates a warm, retro ambiance.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Vintage_Living_Room.jpg",
      },
      {
        subCategory: "classic_car_garage",
        prompt:
          "Eyeglasses placed on the polished hood of a classic car in a retro-style garage, with vintage tools and signs in the background. Ideal for an old-school, automotive-inspired aesthetic.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Classic_Car_Garage.jpg",
      },
      {
        subCategory: "old_cinema",
        prompt:
          "Eyeglasses displayed on the counter of an old cinema, with vintage popcorn machine, movie posters, and dim ambient lighting, creating a nostalgic movie-going experience.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Old_Cinema.jpg",
      },
      {
        subCategory: "diner",
        prompt:
          "Eyeglasses resting on a table in a retro 50s diner, with a checkered floor, red leather seats, and a jukebox in the background, evoking a fun, classic American feel.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Diner.jpg",
      },
      {
        subCategory: "record_store",
        prompt:
          "Eyeglasses displayed on a record bin filled with vinyl records, with a turntable and colorful album covers around. Perfect for a nostalgic, music-inspired look.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Record_Store.jpg",
      },
      {
        subCategory: "roller_rink",
        prompt:
          "Eyeglasses placed on a brightly lit roller rink floor with neon lights and skates nearby, capturing a fun and playful retro aesthetic.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Roller_Rink.jpg",
      },
      {
        subCategory: "old_tv_studio",
        prompt:
          "Eyeglasses positioned on a wooden desk in a vintage TV studio, with old cameras and a retro set, providing a classic broadcasting atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Old_TV_Studio.jpg",
      },
      {
        subCategory: "vintage_bar",
        prompt:
          "Eyeglasses displayed on the counter of a vintage bar with antique bottles and dim, warm lighting, creating a cozy and nostalgic pub vibe.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Vintage_Bar.jpg",
      },
      {
        subCategory: "retro_kitchen",
        prompt:
          "Eyeglasses positioned on a formica countertop in a retro kitchen with pastel-colored cabinets and old appliances, perfect for a mid-century domestic look.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Retro_Kitchen.jpg",
      },
      {
        subCategory: "70s_lounge",
        prompt:
          "Eyeglasses set on a low table in a 70s-style lounge with shag carpet, a lava lamp, and warm, earthy tones, capturing a relaxed, vintage vibe.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/70s_Lounge.jpg",
      },
      {
        subCategory: "disco_club",
        prompt:
          "Eyeglasses displayed on a mirrored surface with disco lights and a dance floor in the background, perfect for a vibrant, nightlife-inspired look.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Disco_Club.jpg",
      },
      {
        subCategory: "typewriter_desk",
        prompt:
          "Eyeglasses placed next to a vintage typewriter on a wooden desk, surrounded by aged books and paper, creating a classic, intellectual atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Typewriter_Desk.jpg",
      },
      {
        subCategory: "vinyl_records",
        prompt:
          "Eyeglasses resting on a stack of vinyl records with album covers visible, evoking a sense of nostalgia and appreciation for classic music.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Vinyl_Records.jpg",
      },
      {
        subCategory: "old_school_gym",
        prompt:
          "Eyeglasses displayed on a vintage gym bench with old-school workout equipment, leather medicine balls, and classic weights, giving a timeless athletic look.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Old_School_Gym.jpg",
      },
      {
        subCategory: "drive-in_theater",
        prompt:
          "Eyeglasses set on a car dashboard at a drive-in theater, with a movie playing on a big outdoor screen in the background, perfect for a classic cinema experience.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Drive-in_Theater.jpg",
      },
      {
        subCategory: "old_office",
        prompt:
          "Eyeglasses displayed on a wooden office desk with an old rotary phone and paper stacks, evoking a vintage corporate atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Old_Office.jpg",
      },
      {
        subCategory: "fashion_boutique",
        prompt:
          "Eyeglasses positioned on a vintage mannequin or display stand in a retro fashion boutique, surrounded by classic clothing and accessories.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Fashion_Boutique.jpg",
      },
      {
        subCategory: "tattoo_parlor",
        prompt:
          "Eyeglasses displayed on a workstation in a retro tattoo parlor, with vintage tattoo flash art and old-school tools around, capturing a rebellious, artistic vibe.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Tattoo_Parlor.jpg",
      },
      {
        subCategory: "vintage_camera_store",
        prompt:
          "Eyeglasses placed on the counter of a vintage camera store with old cameras and photography equipment, creating a nostalgic, creative atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Vintage_Camera_Store.jpg",
      },
    ],
  },
  {
    category: "beach",
    subCategories: [
      {
        subCategory: "tropical",
        prompt:
          "Eyeglasses positioned on a beach towel under palm trees with clear blue water in the background, capturing a relaxed, tropical vacation feel.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Tropical.jpg",
      },
      {
        subCategory: "sandy_shore",
        prompt:
          "Eyeglasses resting on the sandy beach with gentle waves in the background, evoking a calm, beach day atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Sandy_Shore.jpg",
      },
      {
        subCategory: "sunset",
        prompt:
          "Eyeglasses displayed on a wooden pier overlooking the ocean at sunset, with warm, golden tones filling the scene, perfect for a romantic beach vibe.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Sunset.jpg",
      },
      {
        subCategory: "palm_trees",
        prompt:
          "Eyeglasses positioned on a sun lounger with tall palm trees swaying in the background, creating a tranquil, vacation-inspired look.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Palm_Trees.jpg",
      },
      {
        subCategory: "clear_water",
        prompt:
          "Eyeglasses displayed near the edge of crystal-clear beach water with light reflections, evoking a fresh and clean beach aesthetic.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Clear_Water.jpg",
      },
      {
        subCategory: "beach_umbrella",
        prompt:
          "Eyeglasses resting on a beach blanket under a colorful beach umbrella, perfect for a playful, summer look.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Beach_Umbrella.jpg",
      },
      {
        subCategory: "beach_bar",
        prompt:
          "Eyeglasses displayed on a bamboo bar counter with tropical drinks and beach decor around, creating a fun, resort-style vibe.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Beach_Bar.jpg",
      },
      {
        subCategory: "coastal_cliffs",
        prompt:
          "Eyeglasses positioned on a rocky coastal cliff with a panoramic ocean view, capturing a dramatic, adventurous beach look.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Coastal_Cliffs.jpg",
      },
      {
        subCategory: "rocky_shore",
        prompt:
          "Eyeglasses set on a rugged, rocky beach surface with waves crashing, evoking a wild, untamed coastal feel.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Rocky_Shore.jpg",
      },
      {
        subCategory: "beach_hut",
        prompt:
          "Eyeglasses displayed on the steps of a beach hut with sandy floors and beach decor, ideal for a cozy, tropical ambiance.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Beach_Hut.jpg",
      },
      {
        subCategory: "volleyball_net",
        prompt:
          "Eyeglasses placed on the edge of a sandy beach volleyball court with a net in the background, perfect for a sporty, active vibe.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Volleyball_Net.jpg",
      },
      {
        subCategory: "island_view",
        prompt:
          "Eyeglasses set on a wooden deck with an island and blue ocean in the background, capturing a serene and luxurious getaway.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Island_View.jpg",
      },
      {
        subCategory: "coconut_trees",
        prompt:
          "Eyeglasses displayed near a group of coconut trees with a tropical beach setting, creating a laid-back, exotic atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Coconut_Trees.jpg",
      },
      {
        subCategory: "shell_covered",
        prompt:
          "Eyeglasses resting among beach shells on the sand, capturing a natural and rustic beach feel.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Shell_Covered.jpg",
      },
      {
        subCategory: "bonfire_area",
        prompt:
          "Eyeglasses displayed next to a beach bonfire with a warm glow and a cozy, social gathering vibe.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Bonfire_Area.jpg",
      },
      {
        subCategory: "seaside_rocks",
        prompt:
          "Eyeglasses positioned on a rock formation by the sea, creating a rugged, coastal aesthetic.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Seaside_Rocks.jpg",
      },
      {
        subCategory: "beach_path",
        prompt:
          "Eyeglasses displayed along a sandy beach path with footprints and coastal plants around, evoking a sense of adventure.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Beach_Path.jpg",
      },
      {
        subCategory: "boardwalk",
        prompt:
          "Eyeglasses positioned on a wooden boardwalk by the beach with ocean views, creating a relaxed, casual summer vibe.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Boardwalk.jpg",
      },
      {
        subCategory: "dock",
        prompt:
          "Eyeglasses placed on the edge of a wooden dock over the water, perfect for a peaceful, lakeside or beach setting.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Dock.jpg",
      },
      {
        subCategory: "lighthouse",
        prompt:
          "Eyeglasses displayed near a lighthouse with an ocean view, evoking a sense of maritime adventure and coastal charm.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Lighthouse.jpg",
      },
    ],
  },
  {
    category: "winter",
    subCategories: [
      {
        subCategory: "snowy_trees",
        prompt:
          "Eyeglasses positioned on a snowy log with snow-covered trees in the background, creating a calm, winter wonderland feel.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Snowy_Trees.jpg",
      },
      {
        subCategory: "ice_rink",
        prompt:
          "Eyeglasses set on the edge of an outdoor ice rink with skates in the background, capturing a playful, winter sports vibe.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Ice_Rink.jpg",
      },
      {
        subCategory: "cabin",
        prompt:
          "Eyeglasses displayed on a wooden table inside a cozy winter cabin with a fireplace, evoking warmth and comfort in a snowy setting.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Cabin.jpg",
      },
      {
        subCategory: "frozen_lake",
        prompt:
          "Eyeglasses placed on the edge of a frozen lake with icy reflections, creating a serene, wintery outdoor aesthetic.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Frozen_Lake.jpg",
      },
      {
        subCategory: "ski_slopes",
        prompt:
          "Eyeglasses displayed near a pair of skis on a snowy slope, with mountains in the background, capturing an adventurous, alpine feel.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Ski_Slopes.jpg",
      },
      {
        subCategory: "snowfall",
        prompt:
          "Eyeglasses positioned on a bench lightly dusted with snow during snowfall, creating a soft, wintery atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Snowfall.jpg",
      },
      {
        subCategory: "winter_street",
        prompt:
          "Eyeglasses set on a street bench in a snow-covered town square, capturing a quiet, picturesque winter scene.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Winter_Street.jpg",
      },
      {
        subCategory: "frosted_windows",
        prompt:
          "Eyeglasses displayed on a windowsill with frost-covered glass, creating a cozy, indoor winter aesthetic.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Frosted_Windows.jpg",
      },
      {
        subCategory: "icicles",
        prompt:
          "Eyeglasses positioned near icicles hanging from a roof, with a snowy background, capturing the chill of winter.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Icicles.jpg",
      },
      {
        subCategory: "mountain_snow",
        prompt:
          "Eyeglasses set on a rock with a snow-covered mountain view, creating a scenic, adventurous winter vibe.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Mountain_Snow.jpg",
      },
      {
        subCategory: "frozen_waterfall",
        prompt:
          "Eyeglasses positioned on a ledge near a frozen waterfall, capturing the majestic beauty of winter landscapes.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Frozen_Waterfall.jpg",
      },
      {
        subCategory: "snow_covered_bench",
        prompt:
          "Eyeglasses displayed on a bench covered in snow with a snowy park background, creating a peaceful winter setting.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Snow_Covered_Bench.jpg",
      },
      {
        subCategory: "hot_cocoa_stand",
        prompt:
          "Eyeglasses positioned on the counter of a hot cocoa stand, with warm steam and a cozy, festive winter feel.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Hot_Cocoa_Stand.jpg",
      },
      {
        subCategory: "snow_globe",
        prompt:
          "Eyeglasses set beside a snow globe with a holiday scene inside, creating a nostalgic, winter holiday vibe.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Snow_Globe.jpg",
      },
      {
        subCategory: "snowman",
        prompt:
          "Eyeglasses displayed near a cheerful snowman with snow-covered surroundings, evoking playful winter joy.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Snowman.jpg",
      },
      {
        subCategory: "pine_trees",
        prompt:
          "Eyeglasses positioned among pine trees dusted with snow, capturing the fresh, natural beauty of winter forests.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Pine_Trees.jpg",
      },
      {
        subCategory: "snowy_village",
        prompt:
          "Eyeglasses displayed on a table in a snowy village with holiday lights, creating a festive, warm atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Snowy_Village.jpg",
      },
      {
        subCategory: "ski_lift",
        prompt:
          "Eyeglasses set on a snowy bench near a ski lift, with a mountainous winter landscape in the background.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Ski_Lift.jpg",
      },
      {
        subCategory: "fireplace",
        prompt:
          "Eyeglasses positioned on a rustic table by a crackling fireplace, creating a cozy, warm indoor setting perfect for winter.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Fireplace.jpg",
      },
      {
        subCategory: "snowy_roof",
        prompt:
          "Eyeglasses displayed on a rooftop lightly covered in snow with a wintery townscape in the background, ideal for a seasonal vibe.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Snowy_Roof.jpg",
      },
    ],
  },
  {
    category: "travel",
    subCategories: [
      {
        subCategory: "airport",
        prompt:
          "Eyeglasses displayed on a sleek counter in a modern airport terminal, surrounded by large glass windows, travel signs, and a sense of excitement and anticipation in the air.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Airport.jpg",
      },
      {
        subCategory: "train_station",
        prompt:
          "Eyeglasses positioned on a bench in a bustling train station, with old-fashioned clocks, ticket booths, and people waiting for their trains. Perfect for capturing a sense of journey and movement.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Train_Station.jpg",
      },
      {
        subCategory: "bus_terminal",
        prompt:
          "Eyeglasses displayed on a waiting bench in a lively bus terminal, surrounded by colorful signage and people on the move, creating a vibrant travel-inspired atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Bus_Terminal.jpg",
      },
      {
        subCategory: "cruise_ship",
        prompt:
          "Eyeglasses positioned on a deck of a cruise ship, overlooking the open sea with a faint view of distant islands. The scene conveys relaxation and adventure.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Cruise_Ship.jpg",
      },
      {
        subCategory: "boarding_gate",
        prompt:
          "Eyeglasses set on a side table near a boarding gate, with rows of seats, large windows showing the runway, and the anticipation of travel in the air.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Boarding_Gate.jpg",
      },
      {
        subCategory: "runway",
        prompt:
          "Eyeglasses displayed on a metal ledge overlooking the runway, with airplanes in the background and a sense of travel and exploration.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Runway.jpg",
      },
      {
        subCategory: "passport_control",
        prompt:
          "Eyeglasses set on a counter at a passport control booth, with travel documents nearby, evoking an atmosphere of international travel and formal procedures.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Passport_Control.jpg",
      },
      {
        subCategory: "luggage_claim",
        prompt:
          "Eyeglasses positioned on a luggage carousel with travel bags around, creating a scene of arrival and anticipation.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Luggage_Claim.jpg",
      },
      {
        subCategory: "travel_cafe",
        prompt:
          "Eyeglasses placed on a table in a cozy travel-themed cafe, with maps and souvenirs in the background, creating a relaxed and globally inspired ambiance.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Travel_Cafe.jpg",
      },
      {
        subCategory: "souvenir_shop",
        prompt:
          "Eyeglasses displayed on a shelf in a souvenir shop filled with trinkets, postcards, and memorabilia from various destinations, capturing the charm of travel keepsakes.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Souvenir_Shop.jpg",
      },
      {
        subCategory: "city_map",
        prompt:
          "Eyeglasses set atop an open city map with street markers and destinations, evoking a sense of adventure and discovery.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/City_Map.jpg",
      },
      {
        subCategory: "currency_exchange",
        prompt:
          "Eyeglasses positioned near a currency exchange booth, with foreign bills and coins in the background, capturing the excitement of international travel.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Currency_Exchange.jpg",
      },
      {
        subCategory: "ticket_counter",
        prompt:
          "Eyeglasses placed on the counter of a ticket booth, surrounded by brochures and a sense of bustling travel energy.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Ticket_Counter.jpg",
      },
      {
        subCategory: "mountain_trail",
        prompt:
          "Eyeglasses displayed on a rock along a mountain trail with scenic views of peaks and valleys, perfect for a sense of adventure and natural beauty.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Mountain_Trail.jpg",
      },
      {
        subCategory: "roadside_motel",
        prompt:
          "Eyeglasses set on a rustic bedside table in a roadside motel room, evoking a sense of a classic road trip and exploration.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Roadside_Motel.jpg",
      },
      {
        subCategory: "tourist_spot",
        prompt:
          "Eyeglasses displayed on a bench overlooking a popular tourist landmark, surrounded by sightseeing guides and a vibrant atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Tourist_Spot.jpg",
      },
      {
        subCategory: "car_rental",
        prompt:
          "Eyeglasses positioned on the counter at a car rental desk, with car keys and brochures around, perfect for a road trip vibe.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Car_Rental.jpg",
      },
      {
        subCategory: "hiking_trail",
        prompt:
          "Eyeglasses set on a tree stump along a hiking trail with lush greenery, evoking a peaceful, nature-focused aesthetic.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Hiking_Trail.jpg",
      },
      {
        subCategory: "campground",
        prompt:
          "Eyeglasses positioned on a picnic table at a campground, with tents and a campfire in the background, creating an adventurous outdoor feel.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Campground.jpg",
      },
      {
        subCategory: "scenic_view",
        prompt:
          "Eyeglasses displayed on a wooden railing overlooking a breathtaking scenic view, with mountains, forests, or ocean in the distance, capturing a sense of awe and exploration.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Scenic_View.jpg",
      },
    ],
  },
  {
    category: "gardens",
    subCategories: [
      {
        subCategory: "japanese_garden",
        prompt:
          "Eyeglasses displayed on a wooden bench in a serene Japanese garden with koi ponds, bonsai trees, and stone lanterns, evoking tranquility and natural beauty.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Japanese_Garden.jpg",
      },
      {
        subCategory: "english_garden",
        prompt:
          "Eyeglasses positioned on a stone ledge surrounded by colorful roses, hedges, and classical statues in a lush English garden.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/English_Garden.jpg",
      },
      {
        subCategory: "desert_garden",
        prompt:
          "Eyeglasses displayed on a sandy rock among cacti and succulents in a desert garden, capturing a warm and arid aesthetic.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Desert_Garden.jpg",
      },
      {
        subCategory: "tropical_garden",
        prompt:
          "Eyeglasses set on a wooden bench under vibrant tropical foliage, surrounded by exotic plants and flowers, creating a lush, green atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Tropical_Garden.jpg",
      },
      {
        subCategory: "botanical_garden",
        prompt:
          "Eyeglasses placed on a bench in a large botanical garden with diverse plants and flowers around, perfect for a fresh, natural look.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Botanical_Garden.jpg",
      },
      {
        subCategory: "rose_garden",
        prompt:
          "Eyeglasses displayed on a stone pedestal in a blooming rose garden, surrounded by vibrant and fragrant roses.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Rose_Garden.jpg",
      },
      {
        subCategory: "vegetable_patch",
        prompt:
          "Eyeglasses positioned on a wooden fence near a vegetable patch with rows of fresh produce, evoking a rustic, organic aesthetic.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Vegetable_Patch.jpg",
      },
      {
        subCategory: "greenhouse",
        prompt:
          "Eyeglasses displayed on a potting bench inside a greenhouse with potted plants and sunlight streaming through the glass.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Greenhouse.jpg",
      },
      {
        subCategory: "gazebo",
        prompt:
          "Eyeglasses set on a wooden table inside a garden gazebo, with views of blooming flowers and greenery around.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Gazebo.jpg",
      },
      {
        subCategory: "ornamental_trees",
        prompt:
          "Eyeglasses placed on a stone ledge near beautifully pruned ornamental trees, creating a sense of elegance and order.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Ornamental_Trees.jpg",
      },
      {
        subCategory: "butterfly_garden",
        prompt:
          "Eyeglasses displayed among vibrant flowers in a butterfly garden with butterflies gently flying around, creating a peaceful and delicate scene.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Butterfly_Garden.jpg",
      },
      {
        subCategory: "rock_garden",
        prompt:
          "Eyeglasses set among stones and gravel in a rock garden, with succulents and small plants, giving a minimalist and serene atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Rock_Garden.jpg",
      },
      {
        subCategory: "water_garden",
        prompt:
          "Eyeglasses displayed near a water lily pond with ripples in the water and a peaceful, natural ambiance.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Water_Garden.jpg",
      },
      {
        subCategory: "koi_pond",
        prompt:
          "Eyeglasses positioned on a wooden ledge near a koi pond, with colorful koi fish swimming below, adding a tranquil, Japanese-inspired touch.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Koi_Pond.jpg",
      },
      {
        subCategory: "herb_garden",
        prompt:
          "Eyeglasses set on a stone path surrounded by fresh herbs like rosemary, basil, and thyme, creating a fragrant, natural vibe.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Herb_Garden.jpg",
      },
      {
        subCategory: "sunken_garden",
        prompt:
          "Eyeglasses displayed on a stone wall in a sunken garden, surrounded by flowers and a sense of historical elegance.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Sunken_Garden.jpg",
      },
      {
        subCategory: "flower_path",
        prompt:
          "Eyeglasses set along a pathway lined with colorful, blooming flowers, evoking the beauty of spring.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Flower_Path.jpg",
      },
      {
        subCategory: "wild_garden",
        prompt:
          "Eyeglasses displayed on a rustic bench in a wildflower garden, with tall grass and natural, untamed beauty around.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Wild_Garden.jpg",
      },
      {
        subCategory: "fountain",
        prompt:
          "Eyeglasses positioned on the edge of a garden fountain, with water gently flowing and a serene, classical feel.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Fountain.jpg",
      },
      {
        subCategory: "topiary",
        prompt:
          "Eyeglasses displayed on a pedestal near topiary sculptures, evoking elegance and artistic horticulture.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Topiary.jpg",
      },
    ],
  },
  {
    category: "forests",
    subCategories: [
      {
        subCategory: "pine_forest",
        prompt:
          "Eyeglasses positioned on a tree stump in a dense pine forest with towering trees, creating a fresh, earthy feel.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Pine_Forest.jpg",
      },
      {
        subCategory: "rainforest",
        prompt:
          "Eyeglasses set on a mossy rock in a rainforest, with vibrant greenery and a sense of natural wonder.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Rainforest.jpg",
      },
      {
        subCategory: "autumn_forest",
        prompt:
          "Eyeglasses displayed on a pile of fallen autumn leaves, surrounded by vibrant red, orange, and yellow foliage.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Autumn_Forest.jpg",
      },
      {
        subCategory: "tropical_forest",
        prompt:
          "Eyeglasses positioned on a leafy plant in a tropical forest, surrounded by lush greenery and exotic plants.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Tropical_Forest.jpg",
      },
      {
        subCategory: "mystic_woods",
        prompt:
          "Eyeglasses set on a stone in misty woods, with a mystical ambiance and fog drifting between the trees.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Mystic_Woods.jpg",
      },
      {
        subCategory: "dense_jungle",
        prompt:
          "Eyeglasses displayed among dense jungle foliage with tangled vines and tropical plants, evoking adventure.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Dense_Jungle.jpg",
      },
      {
        subCategory: "birch_grove",
        prompt:
          "Eyeglasses positioned on the roots of a birch tree, surrounded by slender white trunks in a serene grove.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Birch_Grove.jpg",
      },
      {
        subCategory: "foggy_forest",
        prompt:
          "Eyeglasses set on a wooden bench in a foggy forest, with mist enveloping the background and adding mystery.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Foggy_Forest.jpg",
      },
      {
        subCategory: "mountain_forest",
        prompt:
          "Eyeglasses displayed on a rock with towering pine trees and mountainous landscape in the background.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Mountain_Forest.jpg",
      },
      {
        subCategory: "cypress_swamp",
        prompt:
          "Eyeglasses positioned on a root in a cypress swamp, with reflections in the still water creating a moody atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Cypress_Swamp.jpg",
      },
      {
        subCategory: "bamboo_forest",
        prompt:
          "Eyeglasses set on a stone amidst tall bamboo stalks, evoking a peaceful and exotic ambiance.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Bamboo_Forest.jpg",
      },
      {
        subCategory: "maple_woods",
        prompt:
          "Eyeglasses displayed on a maple tree branch, surrounded by vibrant autumn-colored leaves, capturing the beauty of fall.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Maple_Woods.jpg",
      },
      {
        subCategory: "willow_grove",
        prompt:
          "Eyeglasses positioned under a weeping willow, with branches cascading down, creating a tranquil, shaded scene.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Willow_Grove.jpg",
      },
      {
        subCategory: "snowy_forest",
        prompt:
          "Eyeglasses displayed on a snow-covered log in a winter forest, surrounded by snow-laden trees, evoking a serene winter scene.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Snowy_Forest.jpg",
      },
      {
        subCategory: "sunlit_path",
        prompt:
          "Eyeglasses set along a forest path dappled with sunlight filtering through the trees, creating a peaceful, warm atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Sunlit_Path.jpg",
      },
      {
        subCategory: "fallen_leaves",
        prompt:
          "Eyeglasses displayed on a bed of fallen leaves, capturing the rich colors and textures of autumn.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Fallen_Leaves.jpg",
      },
      {
        subCategory: "dark_forest",
        prompt:
          "Eyeglasses positioned on a rock in a dark forest with towering trees and minimal light, adding an air of mystery.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Dark_Forest.jpg",
      },
      {
        subCategory: "mossy_floor",
        prompt:
          "Eyeglasses set on a moss-covered forest floor with soft textures and a vibrant green color, emphasizing natural beauty.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Mossy_Floor.jpg",
      },
      {
        subCategory: "stream",
        prompt:
          "Eyeglasses displayed near a gentle forest stream with clear water flowing over rocks, adding a serene, refreshing vibe.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Stream.jpg",
      },
      {
        subCategory: "forest_clearing",
        prompt:
          "Eyeglasses positioned on a rock in a forest clearing, with open sky above and sunlight streaming in, creating a tranquil space.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Forest_Clearing.jpg",
      },
    ],
  },
  {
    category: "mountains",
    subCategories: [
      {
        subCategory: "rocky_mountain",
        prompt:
          "Eyeglasses positioned on a rock ledge in the foreground of a vast Rocky Mountain landscape, with rugged peaks and distant valleys, capturing the sense of wilderness and grandeur.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Rocky_Mountain.jpg",
      },
      {
        subCategory: "snow_capped",
        prompt:
          "Eyeglasses displayed on a wooden railing overlooking snow-capped mountain peaks, evoking a cool, serene, and majestic atmosphere perfect for a winter adventure.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Snow_Capped.jpg",
      },
      {
        subCategory: "alpine_lake",
        prompt:
          "Eyeglasses positioned by the edge of a crystal-clear alpine lake, with mirror-like reflections of surrounding mountains, creating a peaceful and awe-inspiring scene.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Alpine_Lake.jpg",
      },
      {
        subCategory: "mountain_path",
        prompt:
          "Eyeglasses set on a stone along a winding mountain path, with tall pine trees and a view of majestic peaks in the background, suggesting exploration and adventure.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Mountain_Path.jpg",
      },
      {
        subCategory: "glacier",
        prompt:
          "Eyeglasses displayed on an icy surface near a glacier, with shimmering blue ice formations in the background, evoking a cold and powerful natural setting.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Glacier.jpg",
      },
      {
        subCategory: "mountain_village",
        prompt:
          "Eyeglasses positioned on a rustic wooden table in a cozy mountain village, with charming cabins and snowy peaks visible in the background, perfect for a cozy, quaint vibe.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Mountain_Village.jpg",
      },
      {
        subCategory: "cliff_edge",
        prompt:
          "Eyeglasses displayed on a rocky ledge near a dramatic cliff edge, overlooking a vast, panoramic mountain view that conveys a thrilling sense of altitude.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Cliff_Edge.jpg",
      },
      {
        subCategory: "hiker's_path",
        prompt:
          "Eyeglasses set on a mossy rock along a narrow hiker's path winding through dense forest and up towards the peaks, evoking a spirit of exploration.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Hiker's_Path.jpg",
      },
      {
        subCategory: "valley",
        prompt:
          "Eyeglasses positioned in a green valley surrounded by towering mountains, with wildflowers and gentle streams, creating a peaceful, idyllic scene.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Valley.jpg",
      },
      {
        subCategory: "pine_trees",
        prompt:
          "Eyeglasses displayed on a tree stump surrounded by tall pine trees, with a mountain in the background, capturing the essence of forested mountain terrain.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Pine_Trees.jpg",
      },
      {
        subCategory: "mountain_cabin",
        prompt:
          "Eyeglasses set on the porch of a rustic mountain cabin with views of dense forests and snow-tipped peaks, evoking warmth and seclusion.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Mountain_Cabin.jpg",
      },
      {
        subCategory: "peak_view",
        prompt:
          "Eyeglasses positioned on a rocky outcrop with a dramatic peak view, conveying a sense of achievement and adventure at the summit.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Peak_View.jpg",
      },
      {
        subCategory: "sunset_view",
        prompt:
          "Eyeglasses displayed on a rock as the sun sets over the mountains, casting warm golden hues across the peaks and creating a serene, picturesque setting.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Sunset_View.jpg",
      },
      {
        subCategory: "mountain_river",
        prompt:
          "Eyeglasses placed beside a rushing mountain river, surrounded by rocks and pine trees, evoking freshness and the sound of flowing water.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Mountain_River.jpg",
      },
      {
        subCategory: "highland",
        prompt:
          "Eyeglasses set on a grassy knoll in the highlands, with rolling hills and distant mountains under a bright sky, capturing an open, airy feel.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Highland.jpg",
      },
      {
        subCategory: "foggy_mountain",
        prompt:
          "Eyeglasses displayed on a rock shrouded in mountain fog, with mist enveloping the forest and peaks, creating a mysterious, ethereal ambiance.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Foggy_Mountain.jpg",
      },
      {
        subCategory: "rock_formation",
        prompt:
          "Eyeglasses positioned on a rugged rock formation against a backdrop of towering cliffs, showcasing the raw beauty of mountainous terrain.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Rock_Formation.jpg",
      },
      {
        subCategory: "hiking_trail",
        prompt:
          "Eyeglasses set on a moss-covered rock along a mountain hiking trail, with dense forest and distant peaks in the background.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Hiking_Trail.jpg",
      },
      {
        subCategory: "summit",
        prompt:
          "Eyeglasses displayed on the summit of a mountain, with a breathtaking panoramic view of the valleys below, evoking a sense of accomplishment.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Summit.jpg",
      },
      {
        subCategory: "rocky_outcrop",
        prompt:
          "Eyeglasses positioned on a rocky outcrop overlooking a valley, capturing the ruggedness and natural beauty of mountainous landscapes.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Rocky_Outcrop.jpg",
      },
    ],
  },
  {
    category: "desert",
    subCategories: [
      {
        subCategory: "sand_dunes",
        prompt:
          "Eyeglasses positioned on a smooth sand dune with endless desert dunes stretching out under a bright blue sky, capturing the vastness and beauty of the desert.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Sand_Dunes.jpg",
      },
      {
        subCategory: "oasis",
        prompt:
          "Eyeglasses displayed by a tranquil desert oasis, with palm trees and clear water, evoking a refreshing contrast to the surrounding arid landscape.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Oasis.jpg",
      },
      {
        subCategory: "cactus_field",
        prompt:
          "Eyeglasses set on a rock amidst tall, iconic desert cacti, conveying the rugged beauty of a southwestern desert.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Cactus_Field.jpg",
      },
      {
        subCategory: "desert_road",
        prompt:
          "Eyeglasses positioned on the side of a long, straight desert road that stretches into the horizon, evoking adventure and exploration.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Desert_Road.jpg",
      },
      {
        subCategory: "rocky_desert",
        prompt:
          "Eyeglasses displayed on a large desert rock surrounded by rugged terrain, capturing the raw beauty of rocky desert landscapes.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Rocky_Desert.jpg",
      },
      {
        subCategory: "sunset",
        prompt:
          "Eyeglasses set against a desert sunset, with vibrant oranges and purples illuminating the sky, creating a warm, dramatic scene.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Sunset.jpg",
      },
      {
        subCategory: "dry_riverbed",
        prompt:
          "Eyeglasses placed on the cracked earth of a dry riverbed, with parched soil and sparse vegetation, capturing the intense arid atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Dry_Riverbed.jpg",
      },
      {
        subCategory: "salt_flats",
        prompt:
          "Eyeglasses positioned on the white, crystalline surface of a salt flat, with expansive, reflective salt crust creating a surreal atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Salt_Flats.jpg",
      },
      {
        subCategory: "ancient_ruins",
        prompt:
          "Eyeglasses displayed on a stone ledge in the midst of ancient desert ruins, evoking a sense of history and timelessness.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Ancient_Ruins.jpg",
      },
      {
        subCategory: "desert_mountain",
        prompt:
          "Eyeglasses set on a rock with a desert mountain range in the background, creating a stark, dramatic scene.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Desert_Mountain.jpg",
      },
      {
        subCategory: "camels",
        prompt:
          "Eyeglasses positioned near a camel resting in the desert, evoking the essence of a Middle Eastern or North African landscape.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Camels.jpg",
      },
      {
        subCategory: "desert_village",
        prompt:
          "Eyeglasses displayed on a stone wall in a small desert village, with mud-brick homes and a peaceful, sun-drenched atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Desert_Village.jpg",
      },
      {
        subCategory: "palm_oasis",
        prompt:
          "Eyeglasses set on a ledge by a peaceful oasis surrounded by lush palm trees, capturing a tranquil, refreshing vibe.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Palm_Oasis.jpg",
      },
      {
        subCategory: "dusty_path",
        prompt:
          "Eyeglasses displayed on the ground along a dusty desert path, with shrubs and sparse desert vegetation.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Dusty_Path.jpg",
      },
      {
        subCategory: "desert_camp",
        prompt:
          "Eyeglasses positioned on a tent's entrance at a desert campsite, with fire pits and a serene nighttime desert atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Desert_Camp.jpg",
      },
      {
        subCategory: "sandstorm",
        prompt:
          "Eyeglasses displayed on a rock amidst a faint sandstorm, with swirling sand in the background, evoking the power of the desert.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Sandstorm.jpg",
      },
      {
        subCategory: "desert_canyon",
        prompt:
          "Eyeglasses positioned on the edge of a rugged canyon in the desert, with steep cliffs and a breathtaking view.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Desert_Canyon.jpg",
      },
      {
        subCategory: "red_rock",
        prompt:
          "Eyeglasses set on a red rock formation with dramatic cliffs in the background, capturing the iconic beauty of southwestern deserts.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Red_Rock.jpg",
      },
      {
        subCategory: "shrubs",
        prompt:
          "Eyeglasses displayed among hardy desert shrubs, evoking the sparse, resilient vegetation of the arid landscape.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Shrubs.jpg",
      },
      {
        subCategory: "wildflowers",
        prompt:
          "Eyeglasses positioned in a patch of colorful wildflowers blooming in the desert, capturing a rare and beautiful desert scene.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Wildflowers.jpg",
      },
    ],
  },
  {
    category: "water",
    subCategories: [
      {
        subCategory: "river",
        prompt:
          "Eyeglasses positioned on a stone by a flowing river, with clear water rushing past and a lush green background.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/River.jpg",
      },
      {
        subCategory: "lake",
        prompt:
          "Eyeglasses displayed on a wooden pier by a peaceful lake, with calm water reflecting the sky and distant mountains.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Lake.jpg",
      },
      {
        subCategory: "ocean",
        prompt:
          "Eyeglasses positioned on a rock near the ocean, with waves crashing and the vast sea stretching out into the horizon.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Ocean.jpg",
      },
      {
        subCategory: "pond",
        prompt:
          "Eyeglasses set on a stone at the edge of a quiet pond, surrounded by water lilies and reeds, evoking a peaceful natural scene.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Pond.jpg",
      },
      {
        subCategory: "stream",
        prompt:
          "Eyeglasses displayed on a small rock in a forest stream, with clear water gently flowing over stones and greenery surrounding.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Stream.jpg",
      },
      {
        subCategory: "waterfall",
        prompt:
          "Eyeglasses positioned on a rock by a waterfall, with mist and cascading water creating a refreshing, dynamic backdrop.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Waterfall.jpg",
      },
      {
        subCategory: "swamp",
        prompt:
          "Eyeglasses set on a tree root in a swamp, with murky water and dense, mysterious vegetation evoking an eerie atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Swamp.jpg",
      },
      {
        subCategory: "coral_reef",
        prompt:
          "Eyeglasses placed on a rock with colorful coral formations and tropical fish in the background, capturing the vibrant underwater world.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Coral_Reef.jpg",
      },
      {
        subCategory: "tide_pool",
        prompt:
          "Eyeglasses positioned on a rock by a tide pool filled with small sea creatures and colorful shells, capturing the essence of a coastal ecosystem.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Tide_Pool.jpg",
      },
      {
        subCategory: "cliffside_water",
        prompt:
          "Eyeglasses displayed on a cliff overlooking turbulent ocean waves crashing against the rocks below, conveying drama and intensity.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Cliffside_Water.jpg",
      },
      {
        subCategory: "hot_spring",
        prompt:
          "Eyeglasses set on the edge of a natural hot spring with steam rising, evoking warmth and a sense of relaxation.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Hot_Spring.jpg",
      },
      {
        subCategory: "cold_spring",
        prompt:
          "Eyeglasses positioned by a cold spring in the forest, with crystal-clear water and cool, refreshing vibes.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Cold_Spring.jpg",
      },
      {
        subCategory: "water_cave",
        prompt:
          "Eyeglasses displayed at the entrance of a water-filled cave, with stalactites and a mystical, dimly lit ambiance.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Water_Cave.jpg",
      },
      {
        subCategory: "dock",
        prompt:
          "Eyeglasses set on a wooden dock extending over a lake or river, evoking a serene, peaceful scene by the water.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Dock.jpg",
      },
      {
        subCategory: "lighthouse",
        prompt:
          "Eyeglasses positioned on a rock near a towering lighthouse overlooking the sea, with waves crashing below.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Lighthouse.jpg",
      },
      {
        subCategory: "foggy_waters",
        prompt:
          "Eyeglasses displayed by the shore of foggy waters, with a mystical mist rolling over the lake or river.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Foggy_Waters.jpg",
      },
      {
        subCategory: "sandy_shore",
        prompt:
          "Eyeglasses positioned on a sandy shore with gentle waves lapping in the background, capturing the calm and beauty of the coast.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Sandy_Shore.jpg",
      },
      {
        subCategory: "clear_waters",
        prompt:
          "Eyeglasses displayed on a rock with clear, turquoise waters in the background, evoking a sense of purity and relaxation.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Clear_Waters.jpg",
      },
      {
        subCategory: "mangrove",
        prompt:
          "Eyeglasses set on a root within a dense mangrove, with twisted roots and calm water, creating a unique, natural environment.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Mangrove.jpg",
      },
      {
        subCategory: "estuary",
        prompt:
          "Eyeglasses positioned at the edge of an estuary, where river meets sea, capturing the diversity and beauty of coastal waters.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Estuary.jpg",
      },
    ],
  },
  {
    category: "religious",
    subCategories: [
      {
        subCategory: "church",
        prompt:
          "Eyeglasses positioned on a wooden pew in an old church, with stained glass windows casting colorful reflections, capturing a solemn and historic ambiance.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Church.jpg",
      },
      {
        subCategory: "mosque",
        prompt:
          "Eyeglasses displayed on a carved wooden shelf in a peaceful mosque interior, with intricate geometric patterns and warm, ambient lighting.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Mosque.jpg",
      },
      {
        subCategory: "temple",
        prompt:
          "Eyeglasses set on a stone ledge within a quiet temple, surrounded by flickering candles and statues, evoking a sense of spirituality.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Temple.jpg",
      },
      {
        subCategory: "synagogue",
        prompt:
          "Eyeglasses placed on a prayer book inside a synagogue, with ornate chandeliers and arched windows in the background, creating a sacred setting.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Synagogue.jpg",
      },
      {
        subCategory: "shrine",
        prompt:
          "Eyeglasses positioned on a small offering table at a shrine, surrounded by flowers and incense smoke, capturing a sense of reverence.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Shrine.jpg",
      },
      {
        subCategory: "cathedral",
        prompt:
          "Eyeglasses displayed on a stone altar in a grand cathedral, with towering pillars and dimly lit candles adding a majestic and solemn feel.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Cathedral.jpg",
      },
      {
        subCategory: "monastery",
        prompt:
          "Eyeglasses placed on a rustic wooden table in a monastery, with simple furnishings and soft sunlight filtering in, evoking tranquility.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Monastery.jpg",
      },
      {
        subCategory: "pagoda",
        prompt:
          "Eyeglasses positioned at the base of a pagoda with layered roofs and intricate carvings, surrounded by lush gardens, conveying a serene atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Pagoda.jpg",
      },
      {
        subCategory: "altar",
        prompt:
          "Eyeglasses displayed on a stone altar adorned with offerings, candles, and flowers, set in a quiet, sacred space.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Altar.jpg",
      },
      {
        subCategory: "chapel",
        prompt:
          "Eyeglasses set on a wooden bench inside a small chapel, with a single stained glass window casting soft colors across the room.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Chapel.jpg",
      },
      {
        subCategory: "prayer_room",
        prompt:
          "Eyeglasses placed on a low prayer mat in a quiet prayer room, surrounded by warm lighting and peaceful decor.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Prayer_Room.jpg",
      },
      {
        subCategory: "basilica",
        prompt:
          "Eyeglasses displayed on a marble bench inside a grand basilica, with high ceilings and elaborate artwork creating an impressive, reverent setting.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Basilica.jpg",
      },
      {
        subCategory: "stupa",
        prompt:
          "Eyeglasses set on a stone near an ancient stupa, with prayer flags fluttering in the wind, evoking a serene and spiritual scene.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Stupa.jpg",
      },
      {
        subCategory: "meditation_hall",
        prompt:
          "Eyeglasses placed on a wooden floor in a minimalist meditation hall, with soft cushions and tranquil decor enhancing the calm atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Meditation_Hall.jpg",
      },
      {
        subCategory: "grotto",
        prompt:
          "Eyeglasses positioned on a stone shelf in a dimly lit grotto, with a soft glow from nearby candles creating a mystical ambiance.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Grotto.jpg",
      },
      {
        subCategory: "ancient_temple",
        prompt:
          "Eyeglasses displayed on a stone step in an ancient temple, surrounded by weathered carvings and ivy-covered walls, evoking timelessness.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Ancient_Temple.jpg",
      },
      {
        subCategory: "church_pew",
        prompt:
          "Eyeglasses placed on a worn church pew, with intricate woodwork and sunlight streaming through high windows, capturing a sense of history and reverence.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Church_Pew.jpg",
      },
      {
        subCategory: "candles",
        prompt:
          "Eyeglasses displayed on a small table surrounded by lit candles, casting a warm and inviting glow, creating a peaceful ambiance.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Candles.jpg",
      },
      {
        subCategory: "prayer_flags",
        prompt:
          "Eyeglasses positioned near a line of colorful prayer flags, fluttering in the wind against a backdrop of mountains, evoking a sense of spirituality.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Prayer_Flags.jpg",
      },
      {
        subCategory: "religious_statue",
        prompt:
          "Eyeglasses placed at the base of a serene religious statue, surrounded by offerings, creating a peaceful and respectful setting.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Religious_Statue.jpg",
      },
    ],
  },
  {
    category: "markets",
    subCategories: [
      {
        subCategory: "fruit_stand",
        prompt:
          "Eyeglasses displayed on a crate at a bustling fruit stand, surrounded by fresh produce like apples, oranges, and bananas, capturing the lively market atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Fruit_Stand.jpg",
      },
      {
        subCategory: "fish_market",
        prompt:
          "Eyeglasses positioned on an ice-covered counter at a fish market, with fresh seafood and the vibrant market scene in the background.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Fish_Market.jpg",
      },
      {
        subCategory: "spice_market",
        prompt:
          "Eyeglasses set on a spice rack in a busy spice market, surrounded by vibrant colors of turmeric, paprika, and other spices, evoking rich aromas.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Spice_Market.jpg",
      },
      {
        subCategory: "flower_stall",
        prompt:
          "Eyeglasses displayed on a small table next to a colorful arrangement of fresh flowers at a flower stall, creating a vibrant and fragrant setting.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Flower_Stall.jpg",
      },
      {
        subCategory: "street_vendor",
        prompt:
          "Eyeglasses placed on a makeshift table in a lively street market, with various goods and bustling crowds creating a dynamic backdrop.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Street_Vendor.jpg",
      },
      {
        subCategory: "souvenir_shop",
        prompt:
          "Eyeglasses positioned on a shelf in a souvenir shop, surrounded by postcards, small trinkets, and local crafts, perfect for tourists and travelers.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Souvenir_Shop.jpg",
      },
      {
        subCategory: "antique_market",
        prompt:
          "Eyeglasses displayed on a vintage table at an antique market, surrounded by old clocks, candlesticks, and other unique finds, capturing nostalgia.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Antique_Market.jpg",
      },
      {
        subCategory: "night_market",
        prompt:
          "Eyeglasses set on a small stand at a night market, with neon lights and bustling crowds in the background, creating a vibrant, energetic atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Night_Market.jpg",
      },
      {
        subCategory: "flea_market",
        prompt:
          "Eyeglasses placed on a table filled with assorted vintage items at a flea market, surrounded by various eclectic objects, evoking curiosity.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Flea_Market.jpg",
      },
      {
        subCategory: "bazaar",
        prompt:
          "Eyeglasses displayed in a busy bazaar setting, with vibrant textiles, pottery, and other market items surrounding, capturing the cultural richness.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Bazaar.jpg",
      },
      {
        subCategory: "farmers_market",
        prompt:
          "Eyeglasses positioned on a wooden crate at a farmers market, surrounded by fresh vegetables, homemade jams, and baked goods.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Farmers_Market.jpg",
      },
      {
        subCategory: "handicraft_store",
        prompt:
          "Eyeglasses set on a small table in a handicraft store, surrounded by locally made jewelry, fabrics, and pottery, capturing artisanal craftsmanship.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Handicraft_Store.jpg",
      },
      {
        subCategory: "artisan_market",
        prompt:
          "Eyeglasses displayed on a stall in an artisan market, with handmade crafts, woven baskets, and other artisanal goods creating a warm atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Artisan_Market.jpg",
      },
      {
        subCategory: "food_truck",
        prompt:
          "Eyeglasses positioned on a counter near a vibrant food truck, with the smell of street food and a lively crowd in the background.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Food_Truck.jpg",
      },
      {
        subCategory: "butcher_shop",
        prompt:
          "Eyeglasses displayed on a clean butcher block in a traditional butcher shop, surrounded by cured meats and cutting tools, capturing a rustic feel.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Butcher_Shop.jpg",
      },
      {
        subCategory: "open_market",
        prompt:
          "Eyeglasses set on a rustic table in an open market, surrounded by fruits, vegetables, and handmade items, with a busy market atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Open_Market.jpg",
      },
      {
        subCategory: "textile_stall",
        prompt:
          "Eyeglasses displayed on a table among vibrant fabrics and scarves in a textile stall, showcasing a colorful, textured background.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Textile_Stall.jpg",
      },
      {
        subCategory: "gemstones",
        prompt:
          "Eyeglasses positioned near a display of gemstones in a market stall, with sparkling crystals and minerals capturing attention.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Gemstones.jpg",
      },
      {
        subCategory: "local_products",
        prompt:
          "Eyeglasses displayed on a counter surrounded by locally made products, like honey jars, baskets, and crafts, emphasizing regional flavor.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Local_Products.jpg",
      },
      {
        subCategory: "food_stall",
        prompt:
          "Eyeglasses set on a small food stall table, surrounded by freshly cooked local dishes and snacks, capturing the essence of street food.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Food_Stall.jpg",
      },
    ],
  },
  {
    category: "rural",
    subCategories: [
      {
        subCategory: "barn",
        prompt:
          "Eyeglasses positioned on a rustic wooden beam inside a barn, with hay bales and farming tools in the background, capturing a rural, earthy vibe.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Barn.jpg",
      },
      {
        subCategory: "farmhouse",
        prompt:
          "Eyeglasses displayed on a windowsill in a cozy farmhouse, with rustic decor and fields visible through the window, evoking warmth and simplicity.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Farmhouse.jpg",
      },
      {
        subCategory: "country_road",
        prompt:
          "Eyeglasses set on a wooden fence along a winding country road, with open fields and trees, capturing the peacefulness of rural life.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Country_Road.jpg",
      },
      {
        subCategory: "field",
        prompt:
          "Eyeglasses placed on a stone in an open field, with tall grass and wildflowers surrounding, creating a natural and serene atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Field.jpg",
      },
      {
        subCategory: "cows",
        prompt:
          "Eyeglasses positioned on a fence post near a herd of cows grazing in a pasture, with a scenic countryside view in the background.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Cows.jpg",
      },
      {
        subCategory: "sheep",
        prompt:
          "Eyeglasses set on a fence in a field with sheep grazing nearby, capturing a quaint and peaceful rural setting.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Sheep.jpg",
      },
      {
        subCategory: "wheat_field",
        prompt:
          "Eyeglasses displayed on a post in a golden wheat field, with the sun casting a warm glow, emphasizing the beauty of the countryside.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Wheat_Field.jpg",
      },
      {
        subCategory: "tractor",
        prompt:
          "Eyeglasses positioned on the seat of a vintage tractor, with farmland in the background, capturing the essence of rural work.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Tractor.jpg",
      },
      {
        subCategory: "farm_store",
        prompt:
          "Eyeglasses displayed on a wooden counter in a small farm store, surrounded by fresh produce and homemade goods, evoking local charm.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Farm_Store.jpg",
      },
      {
        subCategory: "windmill",
        prompt:
          "Eyeglasses set on a fence near an old windmill, with open fields stretching into the horizon, capturing the timeless rural landscape.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Windmill.jpg",
      },
      {
        subCategory: "pasture",
        prompt:
          "Eyeglasses positioned on a wooden gate overlooking a green pasture, with animals grazing and a tranquil atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Pasture.jpg",
      },
      {
        subCategory: "orchard",
        prompt:
          "Eyeglasses displayed on a crate in an orchard, surrounded by apple or orange trees, with fruits hanging in abundance.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Orchard.jpg",
      },
      {
        subCategory: "vineyard",
        prompt:
          "Eyeglasses set on a wooden barrel in a vineyard, with rows of grapevines and a scenic view of rolling hills.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Vineyard.jpg",
      },
      {
        subCategory: "horses",
        prompt:
          "Eyeglasses placed on a fence post near grazing horses in a rural pasture, capturing a serene and natural setting.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Horses.jpg",
      },
      {
        subCategory: "farmer's_house",
        prompt:
          "Eyeglasses displayed on the porch of a farmer's house, with rustic furniture and farmland visible in the background.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Farmer's_House.jpg",
      },
      {
        subCategory: "silos",
        prompt:
          "Eyeglasses positioned on a metal silo ladder with expansive fields in the background, creating a classic rural aesthetic.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Silos.jpg",
      },
      {
        subCategory: "riverbank",
        prompt:
          "Eyeglasses set on a rock by a calm riverbank, with trees and clear water creating a peaceful, scenic atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Riverbank.jpg",
      },
      {
        subCategory: "country_lane",
        prompt:
          "Eyeglasses displayed on a fence along a quiet country lane, lined with trees and wildflowers, evoking a sense of calm and simplicity.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Country_Lane.jpg",
      },
      {
        subCategory: "rural_church",
        prompt:
          "Eyeglasses placed on a wooden bench outside a small rural church, with a grassy yard and simple, charming architecture.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Rural_Church.jpg",
      },
      {
        subCategory: "field_of_flowers",
        prompt:
          "Eyeglasses positioned on a wooden crate in a field filled with wildflowers, with vibrant colors and a serene, open landscape.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Field_of_Flowers.jpg",
      },
    ],
  },
  {
    category: "library",
    subCategories: [
      {
        subCategory: "bookshelf",
        prompt:
          "Eyeglasses neatly positioned on a bookshelf, surrounded by rows of hardcovers and vintage books, with a soft, warm library light illuminating the glasses.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Bookshelf.jpg",
      },
      {
        subCategory: "reading_room",
        prompt:
          "Eyeglasses placed on a wooden table in a cozy reading room, with dim, warm lighting and comfortable chairs, capturing a quiet and reflective ambiance.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Reading_Room.jpg",
      },
      {
        subCategory: "vintage_books",
        prompt:
          "Eyeglasses resting on a stack of vintage books with worn covers and delicate gold lettering, evoking a nostalgic, scholarly feel.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Vintage_Books.jpg",
      },
      {
        subCategory: "desk_lamp",
        prompt:
          "Eyeglasses positioned under the glow of an antique desk lamp, casting a warm circle of light on a wooden desk with scattered papers and a quill pen.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Desk_Lamp.jpg",
      },
      {
        subCategory: "study_table",
        prompt:
          "Eyeglasses placed on a large study table, surrounded by open books, notepads, and a classic wooden chair, evoking an academic setting.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Study_Table.jpg",
      },
      {
        subCategory: "quiet_area",
        prompt:
          "Eyeglasses displayed on a wooden table in a quiet library corner, with plush seating and soft lighting enhancing the serene, focused atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Quiet_Area.jpg",
      },
      {
        subCategory: "book_stacks",
        prompt:
          "Eyeglasses positioned on a stack of books, with shelves of books towering in the background, capturing a scholarly, bookish environment.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Book_Stacks.jpg",
      },
      {
        subCategory: "wooden_shelf",
        prompt:
          "Eyeglasses set on a sturdy wooden shelf surrounded by neatly arranged books, showcasing a classic library style with a polished, timeless feel.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Wooden_Shelf.jpg",
      },
      {
        subCategory: "modern_library",
        prompt:
          "Eyeglasses displayed on a sleek glass table in a modern library setting, with minimalist shelves, clean lines, and bright lighting.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Modern_Library.jpg",
      },
      {
        subCategory: "library_ladder",
        prompt:
          "Eyeglasses placed on a nearby table, with a rolling library ladder and tall bookshelves in the background, capturing a classic library aesthetic.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Library_Ladder.jpg",
      },
      {
        subCategory: "window_seat",
        prompt:
          "Eyeglasses resting on the edge of a cushioned window seat, overlooking a quiet garden, with warm sunlight filtering in, perfect for a relaxing read.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Window_Seat.jpg",
      },
      {
        subCategory: "study_nook",
        prompt:
          "Eyeglasses placed on a small table in a cozy study nook, surrounded by bookshelves and a plush armchair, creating an inviting space for reading.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Study_Nook.jpg",
      },
      {
        subCategory: "rare_books",
        prompt:
          "Eyeglasses displayed near a collection of rare books with leather covers and ornate bindings, evoking an atmosphere of history and preservation.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Rare_Books.jpg",
      },
      {
        subCategory: "magazine_rack",
        prompt:
          "Eyeglasses set on a table next to a rack filled with magazines and journals, capturing the modern side of a public library or reading area.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Magazine_Rack.jpg",
      },
      {
        subCategory: "public_library",
        prompt:
          "Eyeglasses positioned on a communal reading table in a public library, surrounded by a diverse selection of books and busy with readers.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Public_Library.jpg",
      },
      {
        subCategory: "university_library",
        prompt:
          "Eyeglasses placed on a large study desk within a university library, with students and academic materials in the background.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/University_Library.jpg",
      },
      {
        subCategory: "children's_section",
        prompt:
          "Eyeglasses positioned on a low table in the children’s section of a library, surrounded by colorful books and small chairs, evoking a playful setting.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Children's_Section.jpg",
      },
      {
        subCategory: "book_club_area",
        prompt:
          "Eyeglasses placed on a round table surrounded by comfy chairs, with scattered books and notes, capturing the friendly atmosphere of a book club meeting.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Book_Club_Area.jpg",
      },
      {
        subCategory: "computer_area",
        prompt:
          "Eyeglasses resting on a computer desk in a library’s digital section, with desktops and study cubicles arranged neatly in the background.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Computer_Area.jpg",
      },
      {
        subCategory: "reference_section",
        prompt:
          "Eyeglasses positioned on a wooden table in the reference section, surrounded by dictionaries and encyclopedias, with a focused, studious ambiance.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Reference_Section.jpg",
      },
    ],
  },
  {
    category: "workshop",
    subCategories: [
      {
        subCategory: "woodshop",
        prompt:
          "Eyeglasses set on a workbench in a woodshop, surrounded by sawdust, hand tools, and unfinished wood pieces, capturing the essence of craftsmanship.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Woodshop.jpg",
      },
      {
        subCategory: "metal_shop",
        prompt:
          "Eyeglasses displayed on a metal table in a metal shop, with various industrial tools and metal scraps scattered around, evoking a rugged environment.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Metal_Shop.jpg",
      },
      {
        subCategory: "craft_area",
        prompt:
          "Eyeglasses placed on a cluttered craft table, surrounded by colorful materials, brushes, and small tools, capturing a creative workspace.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Craft_Area.jpg",
      },
      {
        subCategory: "work_bench",
        prompt:
          "Eyeglasses positioned on a well-worn workbench with visible markings and tools arranged around, reflecting a hands-on, hardworking atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Work_Bench.jpg",
      },
      {
        subCategory: "power_tools",
        prompt:
          "Eyeglasses set beside a few power tools on a sturdy work table, with a rough industrial feel and tools scattered around.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Power_Tools.jpg",
      },
      {
        subCategory: "painting_station",
        prompt:
          "Eyeglasses displayed on a table covered with paintbrushes, palettes, and colorful splatters, creating an artist’s painting workspace.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Painting_Station.jpg",
      },
      {
        subCategory: "ceramic_kiln",
        prompt:
          "Eyeglasses placed on a shelf near a ceramic kiln, with finished pottery pieces and clay materials capturing the essence of a ceramics studio.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Ceramic_Kiln.jpg",
      },
      {
        subCategory: "anvil",
        prompt:
          "Eyeglasses resting on a sturdy surface next to an anvil and blacksmith tools, evoking a traditional, rugged workshop feel.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Anvil.jpg",
      },
      {
        subCategory: "forge",
        prompt:
          "Eyeglasses displayed near a forge, with glowing coals and metalworking tools creating a warm, intense, and industrious atmosphere.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Forge.jpg",
      },
      {
        subCategory: "carpenter's_table",
        prompt:
          "Eyeglasses positioned on a carpenter's table surrounded by wood shavings, rulers, and chisels, capturing the precision of woodworking.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Carpenter's_Table.jpg",
      },
      {
        subCategory: "tool_wall",
        prompt:
          "Eyeglasses hanging on a pegboard with various tools organized neatly, evoking a highly functional and well-kept workshop.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Tool_Wall.jpg",
      },
      {
        subCategory: "work_gloves",
        prompt:
          "Eyeglasses placed next to a pair of worn work gloves on a sturdy workbench, capturing the essence of hands-on labor and expertise.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Work_Gloves.jpg",
      },
      {
        subCategory: "blueprint_table",
        prompt:
          "Eyeglasses positioned on a large table with blueprints, rulers, and drafting tools, evoking the workspace of an engineer or architect.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Blueprint_Table.jpg",
      },
      {
        subCategory: "welding_station",
        prompt:
          "Eyeglasses set on a welding station, with metal sheets and sparks in the background, capturing the intensity of metalwork.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Welding_Station.jpg",
      },
      {
        subCategory: "work_apron",
        prompt:
          "Eyeglasses placed on a workbench next to a worn leather apron, conveying the dedicated environment of a seasoned craftsman.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Work_Apron.jpg",
      },
      {
        subCategory: "materials_bin",
        prompt:
          "Eyeglasses positioned on a shelf beside bins filled with raw materials like wood pieces, metal rods, and screws, emphasizing a practical workspace.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Materials_Bin.jpg",
      },
      {
        subCategory: "saw_station",
        prompt:
          "Eyeglasses set on a saw station, surrounded by sawdust and various types of saws, capturing the environment of a dedicated woodworker.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Saw_Station.jpg",
      },
      {
        subCategory: "mechanic_bench",
        prompt:
          "Eyeglasses displayed on a mechanic's bench with automotive tools, nuts, and bolts scattered around, capturing the industrious ambiance of repair work.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Mechanic_Bench.jpg",
      },
      {
        subCategory: "metal_grinder",
        prompt:
          "Eyeglasses positioned next to a metal grinder in a workshop, with metal shavings and sparks in the background, evoking a gritty, hands-on environment.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Metal_Grinder.jpg",
      },
      {
        subCategory: "scrap_bin",
        prompt:
          "Eyeglasses placed on the edge of a scrap bin filled with leftover metal and wood pieces, representing the rugged, resourceful nature of workshop work.",
        image:
          "https://egpfenrpripkjpemjxtg.supabase.co/storage/v1/object/public/ai_background_images/Scrap_Bin.jpg",
      },
    ],
  },
];


module.exports = datas;
