async function enhancePromptWithGemini(
  originalPrompt,
  imageUrl,
  settings = {},
  locationImage,
  poseImage,
  hairStyleImage,
  isMultipleProducts = false,
  hasControlNet = false,
  isColorChange = false, // Renk değiştirme mi?
  targetColor = null, // Hedef renk
  isPoseChange = false, // Poz değiştirme mi?
  customDetail = null, // Özel detay
  isEditMode = false, // EditScreen modu mu?
  editPrompt = null // EditScreen'den gelen prompt
) {
  try {
    console.log(
      "🤖 Gemini 2.0 Flash ile prompt iyileştirme başlatılıyor (tek resim için)"
    );
    console.log("🏞️ [GEMINI] Location image parametresi:", locationImage);
    console.log("🤸 [GEMINI] Pose image parametresi:", poseImage);
    console.log("💇 [GEMINI] Hair style image parametresi:", hairStyleImage);
    console.log("🛍️ [GEMINI] Multiple products mode:", isMultipleProducts);
    console.log("🎨 [GEMINI] ControlNet direktifi her zaman aktif");
    console.log("🎨 [GEMINI] Color change mode:", isColorChange);
    console.log("🎨 [GEMINI] Target color:", targetColor);
    console.log("✏️ [GEMINI] Edit mode:", isEditMode);
    console.log("✏️ [GEMINI] Edit prompt:", editPrompt);

    // Gemini 2.0 Flash modeli - En yeni API yapısı
    const model = genAI.getGenerativeModel({
      model: "gemini-flash-latest",
    });

    // Settings'in var olup olmadığını kontrol et
    const hasValidSettings =
      settings &&
      Object.entries(settings).some(
        ([key, value]) => value !== null && value !== undefined && value !== ""
      );

    console.log("🎛️ [BACKEND GEMINI] Settings kontrolü:", hasValidSettings);

    // Cinsiyet belirleme - varsayılan olarak kadın
    const gender = settings?.gender || "female";
    const age = settings?.age || "";
    const parsedAgeInt = parseInt(age, 10);

    // Gender mapping'ini düzelt - hem man/woman hem de male/female değerlerini handle et
    let modelGenderText;
    let baseModelText;
    const genderLower = gender.toLowerCase();

    // Yaş grupları tanımlaması
    // 0-1   : baby (infant)
    // 2-3   : toddler
    // 4-12  : child
    // 13-16 : teenage
    // 17+   : adult

    if (!isNaN(parsedAgeInt) && parsedAgeInt <= 3) {
      // Baby/Toddler
      let ageGroupWord;
      if (parsedAgeInt <= 1) {
        ageGroupWord = "baby"; // 0-1 yaş için baby
      } else {
        ageGroupWord = "toddler"; // 2-3 yaş için toddler
      }
      const genderWord =
        genderLower === "male" || genderLower === "man" ? "boy" : "girl";

      if (parsedAgeInt <= 1) {
        // Baby için daha spesifik tanım
        modelGenderText = `${parsedAgeInt}-year-old ${ageGroupWord} ${genderWord} (infant)`;
        baseModelText = `${ageGroupWord} ${genderWord} (infant)`;
      } else {
        modelGenderText = `${parsedAgeInt} year old ${ageGroupWord} ${genderWord}`;
        baseModelText = `${ageGroupWord} ${genderWord}`;
      }
    } else if (!isNaN(parsedAgeInt) && parsedAgeInt <= 12) {
      // Child
      const ageGroupWord = "child";
      const genderWord =
        genderLower === "male" || genderLower === "man" ? "boy" : "girl";
      modelGenderText = `${parsedAgeInt} year old ${ageGroupWord} ${genderWord}`;
      baseModelText = `${ageGroupWord} ${genderWord}`;
    } else if (!isNaN(parsedAgeInt) && parsedAgeInt <= 16) {
      // Teenage
      const ageGroupWord = "teenage";
      const genderWord =
        genderLower === "male" || genderLower === "man" ? "boy" : "girl";
      modelGenderText = `${parsedAgeInt} year old ${ageGroupWord} ${genderWord}`;
      baseModelText = `${ageGroupWord} ${genderWord}`;
    } else {
      // Yetişkin mantığı
      if (genderLower === "male" || genderLower === "man") {
        modelGenderText = "male model";
      } else if (genderLower === "female" || genderLower === "woman") {
        modelGenderText = "female model";
      } else {
        modelGenderText = "female model"; // varsayılan
      }
      baseModelText = modelGenderText; // age'siz sürüm

      // Eğer yaş bilgisini yetişkinlerde kullanmak istersen
      if (age) {
        modelGenderText =
          genderLower === "male" || genderLower === "man"
            ? `${age} male model`
            : `${age} female model`;
      }
    }

    console.log("👤 [GEMINI] Gelen gender ayarı:", gender);
    console.log("👶 [GEMINI] Gelen age ayarı:", age);
    console.log("👤 [GEMINI] Base model türü:", baseModelText);
    console.log("👤 [GEMINI] Age'li model türü:", modelGenderText);

    // Age specification - use client's age info naturally but limited
    let ageSection = "";
    if (age) {
      console.log("👶 [GEMINI] Yaş bilgisi tespit edildi:", age);

      ageSection = `
      AGE SPECIFICATION:
      The user provided age information is "${age}". IMPORTANT: Mention this age information EXACTLY 2 times in your entire prompt — once when first introducing the model, and once more naturally later in the description. Do not mention the age a third time.`;
    }

    // Eğer yaş 0-12 arası ise bebek/çocuk stili prompt yönlendirmesi ver
    let childPromptSection = "";
    const parsedAge = parseInt(age, 10);
    if (!isNaN(parsedAge) && parsedAge <= 16) {
      if (parsedAge <= 1) {
        // Baby-specific instructions (0-1 yaş)
        childPromptSection = `
      
  🍼 BABY MODEL REQUIREMENTS (Age: ${parsedAge}):
  CRITICAL: The model is a BABY (infant). This is MANDATORY - the model MUST clearly appear as a baby, not a child or adult.
  
  BABY PHYSICAL CHARACTERISTICS (MANDATORY):
  - Round, chubby baby cheeks
  - Large head proportional to baby body
  - Small baby hands and feet  
  - Soft baby skin texture
  - Infant body proportions (large head, short limbs, rounded belly)
  - Baby-appropriate facial features (button nose, wide eyes, soft expressions)
  - NO mature or adult-like features whatsoever
  
  BABY DESCRIPTION FORMAT (MANDATORY):
  Start the description like this: "A ${parsedAge}-year-old baby ${
          genderLower === "male" || genderLower === "man" ? "boy" : "girl"
        } (infant) is wearing..."
  Then add: "Make sure he/she is clearly a baby: chubby cheeks, small body proportions, baby hands and feet."
  
  BABY POSE REQUIREMENTS:
  - Sitting, lying, or being gently supported poses only
  - Natural baby movements (reaching, playing, looking around)
  - NO standing poses unless developmentally appropriate
  - NO complex or posed gestures
  - Relaxed, natural baby positioning
  
  This is an INFANT/BABY model. The result MUST show a clear baby, not a child or adult.`;
      } else if (parsedAge <= 3) {
        // Toddler-specific instructions (2-3 yaş)
        childPromptSection = `
      
  👶 TODDLER MODEL REQUIREMENTS (Age: ${parsedAge}):
  The model is a TODDLER. Use toddler-appropriate physical descriptions and poses.
  
  TODDLER CHARACTERISTICS:
  - Toddler proportions (chubby cheeks, shorter limbs)
  - Round facial features appropriate for age ${parsedAge}
  - Natural toddler expressions (curious, playful, gentle)
  - Age-appropriate body proportions
  
  DESCRIPTION FORMAT:
  Include phrases like "toddler proportions", "chubby cheeks", "gentle expression", "round facial features".
  
  This is a TODDLER model, not an adult.`;
      } else {
        // Child/teenage instructions (4-16 yaş)
        childPromptSection = `
      
  ⚠️ AGE-SPECIFIC STYLE RULES FOR CHILD MODELS:
  The model described is a child aged ${parsedAge}. Please follow these mandatory restrictions and stylistic adjustments:
  - Use age-appropriate physical descriptions, such as "child proportions", "gentle expression", "soft hair", or "youthful facial features".
  - Avoid all adult modeling language (e.g., "confident pose", "elegant posture", "sharp cheekbones", "stylish demeanor").
  - The model must appear natural, playful, and age-authentic — do NOT exaggerate facial structure or maturity.
  - The model's pose should be passive, playful, or relaxed. DO NOT use assertive, posed, or seductive body language.
  - Do NOT reference any makeup, mature accessories, or adult modeling presence.
  - Ensure lighting and presentation is soft, clean, and suited for editorial children's fashion catalogs.
  - Overall expression and body language must align with innocence, comfort, and simplicity.
  
  This is a child model. Avoid inappropriate styling, body-focused language, or any pose/expression that could be misinterpreted.`;
      }
    }

    // Body shape measurements handling
    let bodyShapeMeasurementsSection = "";
    if (settings?.type === "custom_measurements" && settings?.measurements) {
      const { bust, waist, hips, height, weight } = settings.measurements;
      console.log(
        "📏 [BACKEND GEMINI] Custom body measurements alındı:",
        settings.measurements
      );

      bodyShapeMeasurementsSection = `
      
      CUSTOM BODY MEASUREMENTS PROVIDED:
      The user has provided custom body measurements for the ${baseModelText}:
      - Bust: ${bust} cm
      - Waist: ${waist} cm  
      - Hips: ${hips} cm
      ${height ? `- Height: ${height} cm` : ""}
      ${weight ? `- Weight: ${weight} kg` : ""}
      
      IMPORTANT: Use these exact measurements to ensure the ${baseModelText} has realistic body proportions that match the provided measurements. The garment should fit naturally on a body with these specific measurements. Consider how the garment would drape and fit on someone with these proportions. The model's body should reflect these measurements in a natural and proportional way.`;

      console.log("📏 [BACKEND GEMINI] Body measurements section oluşturuldu");
    }

    let settingsPromptSection = "";

    if (hasValidSettings) {
      const settingsText = Object.entries(settings)
        .filter(
          ([key, value]) =>
            value !== null &&
            value !== undefined &&
            value !== "" &&
            key !== "measurements" &&
            key !== "type" // Body measurements'ları hariç tut
        )
        .map(([key, value]) => `${key}: ${value}`)
        .join(", ");

      console.log("🎛️ [BACKEND GEMINI] Settings için prompt oluşturuluyor...");
      console.log("📝 [BACKEND GEMINI] Settings text:", settingsText);

      settingsPromptSection = `
      User selected settings: ${settingsText}
      
      SETTINGS DETAIL FOR BETTER PROMPT CREATION:
      ${Object.entries(settings)
        .filter(
          ([key, value]) =>
            value !== null &&
            value !== undefined &&
            value !== "" &&
            key !== "measurements" &&
            key !== "type" // Body measurements'ları hariç tut
        )
        .map(
          ([key, value]) =>
            `- ${key.charAt(0).toUpperCase() + key.slice(1)}: ${value}`
        )
        .join("\n    ")}
      
      IMPORTANT: Please incorporate ALL user settings above into your description when appropriate.`;
    }

    // Pose ve perspective için akıllı öneri sistemi
    let posePromptSection = "";
    let perspectivePromptSection = "";

    // Pose handling - enhanced with detailed descriptions
    if (!settings?.pose && !poseImage) {
      const garmentText = isMultipleProducts
        ? "multiple garments/products ensemble"
        : "garment/product";
      posePromptSection = `
      
      INTELLIGENT POSE SELECTION: Since no specific pose was selected by the user, please analyze the ${garmentText} in the reference image and intelligently select the MOST APPROPRIATE pose for the ${baseModelText} that will:
      - Best showcase ${
        isMultipleProducts
          ? "all products in the ensemble and their coordination"
          : "the garment's design, cut, and construction details"
      }
      - Highlight ${
        isMultipleProducts
          ? "how the products work together and each product's unique selling points"
          : "the product's unique features and selling points"
      }
      - Demonstrate how ${
        isMultipleProducts
          ? "the fabrics of different products drape and interact naturally"
          : "the fabric drapes and moves naturally"
      }
      - Show ${
        isMultipleProducts
          ? "how all products fit together and create an appealing silhouette"
          : "the garment's fit and silhouette most effectively"
      }
      - Match the style and aesthetic of ${
        isMultipleProducts
          ? "the coordinated ensemble (formal, casual, sporty, elegant, etc.)"
          : "the garment (formal, casual, sporty, elegant, etc.)"
      }
      - Allow clear visibility of important design elements ${
        isMultipleProducts
          ? "across all products"
          : "like necklines, sleeves, hems, and patterns"
      }
      - Create an appealing and natural presentation that would be suitable for commercial photography
      ${
        isMultipleProducts
          ? "- Ensure each product in the ensemble is visible and well-positioned\n    - Demonstrate the styling versatility of combining these products"
          : ""
      }`;

      console.log(
        `🤸 [GEMINI] Akıllı poz seçimi aktif - ${
          isMultipleProducts ? "çoklu ürün ensembline" : "kıyafete"
        } uygun poz önerilecek`
      );
    } else if (poseImage) {
      posePromptSection = `
      
      POSE REFERENCE: A pose reference image has been provided to show the desired body position and posture for the ${baseModelText}. Please analyze this pose image carefully and incorporate the exact body positioning, hand placement, stance, facial expression, and overall posture into your enhanced prompt. The ${baseModelText} should adopt this specific pose naturally and convincingly${
        isMultipleProducts
          ? ", ensuring all products in the ensemble remain clearly visible and well-positioned"
          : ""
      }.`;

      console.log("🤸 [GEMINI] Pose prompt section eklendi");
    } else if (settings?.pose) {
      // Check if we have a detailed pose description (from our new Gemini pose system)
      let detailedPoseDescription = null;

      // Try to get detailed pose description from Gemini
      try {
        console.log(
          "🤸 [GEMINI] Pose için detaylı açıklama oluşturuluyor:",
          settings.pose
        );
        detailedPoseDescription = await generatePoseDescriptionWithGemini(
          settings.pose,
          poseImage,
          settings.gender || "female",
          "clothing"
        );
        console.log(
          "🤸 [GEMINI] Detaylı pose açıklaması alındı:",
          detailedPoseDescription
        );
      } catch (poseDescError) {
        console.error("🤸 [GEMINI] Pose açıklaması hatası:", poseDescError);
      }

      if (detailedPoseDescription) {
        posePromptSection = `
      
      DETAILED POSE INSTRUCTION: The user has selected the pose "${
        settings.pose
      }". Use this detailed pose instruction for the ${baseModelText}:
      
      "${detailedPoseDescription}"
      
      Ensure the ${baseModelText} follows this pose instruction precisely while maintaining natural movement and ensuring the pose complements ${
          isMultipleProducts
            ? "all products in the ensemble being showcased"
            : "the garment being showcased"
        }. The pose should enhance the presentation of the clothing and create an appealing commercial photography composition.`;

        console.log("🤸 [GEMINI] Detaylı pose açıklaması kullanılıyor");
      } else {
        // Fallback to simple pose mention
        posePromptSection = `
      
      SPECIFIC POSE REQUIREMENT: The user has selected a specific pose: "${
        settings.pose
      }". Please ensure the ${baseModelText} adopts this pose while maintaining natural movement and ensuring the pose complements ${
          isMultipleProducts
            ? "all products in the ensemble being showcased"
            : "the garment being showcased"
        }.`;

        console.log(
          "🤸 [GEMINI] Basit pose açıklaması kullanılıyor (fallback)"
        );
      }

      console.log(
        "🤸 [GEMINI] Kullanıcı tarafından seçilen poz:",
        settings.pose
      );
    }

    // Eğer perspective seçilmemişse, Gemini'ye kıyafete uygun perspektif önerisi yap
    if (!settings?.perspective) {
      const garmentText = isMultipleProducts
        ? "multiple products ensemble"
        : "garment/product";
      perspectivePromptSection = `
      
      INTELLIGENT CAMERA PERSPECTIVE SELECTION: Since no specific camera perspective was selected by the user, please analyze the ${garmentText} and intelligently choose the MOST APPROPRIATE camera angle and perspective that will:
      - Best capture ${
        isMultipleProducts
          ? "all products' most important design features and their coordination"
          : "the garment's most important design features"
      }
      - Show ${
        isMultipleProducts
          ? "the construction quality and craftsmanship details of each product"
          : "the product's construction quality and craftsmanship details"
      }
      - Highlight ${
        isMultipleProducts
          ? "how all products fit together and the overall ensemble silhouette"
          : "the fit and silhouette most effectively"
      }
      - Create the most appealing and commercial-quality presentation ${
        isMultipleProducts ? "for the multi-product styling" : ""
      }
      - Match ${
        isMultipleProducts
          ? "the ensemble's style and intended market positioning"
          : "the garment's style and intended market positioning"
      }
      ${
        isMultipleProducts
          ? "- Ensure all products are visible and well-framed within the composition"
          : ""
      }`;

      console.log(
        `📸 [GEMINI] Akıllı perspektif seçimi aktif - ${
          isMultipleProducts ? "çoklu ürün ensembline" : "kıyafete"
        } uygun kamera açısı önerilecek`
      );
    } else {
      perspectivePromptSection = `
      
      SPECIFIC CAMERA PERSPECTIVE: The user has selected a specific camera perspective: "${
        settings.perspective
      }". Please ensure the photography follows this perspective while maintaining professional composition and optimal ${
        isMultipleProducts ? "multi-product ensemble" : "garment"
      } presentation.`;

      console.log(
        "📸 [GEMINI] Kullanıcı tarafından seçilen perspektif:",
        settings.perspective
      );
    }

    // Location bilgisi için ek prompt section
    let locationPromptSection = "";
    if (locationImage) {
      locationPromptSection = `
      
      LOCATION REFERENCE: A location reference image has been provided to help you understand the desired environment/background setting. Please analyze this location image carefully and incorporate its environmental characteristics, lighting style, architecture, mood, and atmosphere into your enhanced prompt. This location should influence the background, lighting conditions, and overall scene composition in your description.`;

      console.log("🏞️ [GEMINI] Location prompt section eklendi");
    }

    // Hair style bilgisi için ek prompt section
    let hairStylePromptSection = "";
    if (hairStyleImage) {
      hairStylePromptSection = `
      
      HAIR STYLE REFERENCE: A hair style reference image has been provided to show the desired hairstyle for the ${baseModelText}. Please analyze this hair style image carefully and incorporate the exact hair length, texture, cut, styling, and overall hair appearance into your enhanced prompt. The ${baseModelText} should have this specific hairstyle that complements ${
        isMultipleProducts ? "the multi-product ensemble" : "the garment"
      } and overall aesthetic.`;

      console.log("💇 [GEMINI] Hair style prompt section eklendi");
    }

    // Text-based hair style requirement if user selected hairStyle string
    let hairStyleTextSection = "";
    if (settings?.hairStyle) {
      hairStyleTextSection = `
      
      SPECIFIC HAIR STYLE REQUIREMENT: The user has selected a specific hair style: "${settings.hairStyle}". Please ensure the ${baseModelText} is styled with this exact hair style, matching its length, texture and overall look naturally.`;
      console.log(
        "💇 [GEMINI] Hair style text section eklendi:",
        settings.hairStyle
      );
    }

    // Dinamik yüz tanımı - çeşitlilik için
    const faceDescriptorsAdult = [
      "soft angular jawline with friendly eyes",
      "gentle oval face and subtle dimples",
      "defined cheekbones with warm smile",
      "rounded face with expressive eyebrows",
      "heart-shaped face and bright eyes",
      "slightly sharp chin and relaxed expression",
      "broad forehead with calm gaze",
    ];
    const faceDescriptorsChild = [
      "round cheeks and bright curious eyes",
      "button nose and playful grin",
      "soft chubby cheeks with gentle smile",
      "big innocent eyes and tiny nose",
      "freckled cheeks and joyful expression",
    ];

    let faceDescriptor;
    if (!isNaN(parsedAgeInt) && parsedAgeInt <= 12) {
      faceDescriptor =
        faceDescriptorsChild[
          Math.floor(Math.random() * faceDescriptorsChild.length)
        ];
    } else {
      faceDescriptor =
        faceDescriptorsAdult[
          Math.floor(Math.random() * faceDescriptorsAdult.length)
        ];
    }

    const faceDescriptionSection = `
      
      FACE DESCRIPTION GUIDELINE: Below is *one example* of a possible face description → "${faceDescriptor}". This is **only an example**; do NOT reuse it verbatim. Instead, create your own natural-sounding, age-appropriate face description for the ${baseModelText} so that each generation features a unique and photogenic look.`;

    // Gemini'ye gönderilecek metin - Edit mode vs Color change vs Normal replace
    const criticalDirectives = `
      BRAND SAFETY: If the input image contains any brand names or logos (e.g., Nike, Adid<as, Prada, Gucci, Louis Vuitton, Chanel, Balenciaga, Versace, Dior, Hermès), DO NOT mention any brand names in your output. Refer to them generically (e.g., "brand label", "logo") without naming the brand.
      LENGTH CONSTRAINT: Your entire output MUST be no longer than 512 tokens. Keep it concise and within 512 tokens maximum.`;

    // Flux Max için genel garment transform talimatları (genel, ürün-özel olmayan)
    const fluxMaxGarmentTransformationDirectives = `
      FLUX MAX CONTEXT - GARMENT TRANSFORMATION (MANDATORY):
      - ABSOLUTELY AND IMMEDIATELY REMOVE ALL HANGERS, CLIPS, TAGS, AND FLAT-LAY ARTIFACTS from the input garment. CRITICAL: DO NOT RENDER ANY MANNEQUIN REMAINS OR UNINTENDED BACKGROUND ELEMENTS.
      - Transform the flat-lay garment into a hyper-realistic, three-dimensional worn garment on the existing model; avoid any 2D, sticker-like, or paper-like overlay.
      - Ensure realistic fabric physics: natural drape, weight, tension, compression, and subtle folds along shoulders, chest/bust, torso, and sleeves; maintain a clean commercial presentation with minimal distracting wrinkles.
      - Preserve ALL original garment details: exact colors, prints/patterns, material texture, stitching, construction elements (collar, placket, buttons/zippers, cuffs, hems), trims, and finishes. Do NOT redesign.
      - Integrate prints/patterns correctly over the 3D form: patterns must curve, stretch, and wrap naturally across body contours; no flat, uniform, or unnaturally straight pattern lines.
      - For structured details (e.g., knots, pleats, darts, seams), render functional tension, deep creases, and realistic shadows consistent with real fabric behavior.
      - Maintain photorealistic integration with the model and scene: correct scale, perspective, lighting, cast shadows, and occlusions; match camera angle and scene lighting.
      - Focus solely on transforming the garment onto the existing model and seamlessly integrating it into the outfit. Do not introduce new background elements unless a location reference is explicitly provided.`;

    // Gemini'ye gönderilecek metin - Edit mode vs Color change vs Normal replace
    let promptForGemini;

    if (isEditMode && editPrompt && editPrompt.trim()) {
      // EDIT MODE - EditScreen'den gelen özel prompt
      promptForGemini = `
        MANDATORY INSTRUCTION: You MUST generate a prompt that STARTS with the word "Replace". The first word of your output must be "Replace". Do not include any introduction, explanation, or commentary.
  
        ${criticalDirectives}
  
        SILENT RULES (DO NOT OUTPUT THESE, JUST APPLY THEM): All rules, headings, examples, and meta-instructions you see in this message must be applied silently. Do not quote, restate, or paraphrase any rule text in your final output. Your final output MUST ONLY be the concise descriptive prompt for the image model, with no rule headings or capitalized instruction sentences.
  
        ${fluxMaxGarmentTransformationDirectives}
  
        USER'S EDIT REQUEST: "${editPrompt.trim()}"
  
        IMPORTANT: The user can send you input in different languages, but you must always generate your prompt in English.
  
        CRITICAL REQUIREMENTS FOR EDIT MODE:
        1. The prompt MUST begin with "Replace, change..."
        2. Understand the user's edit request regardless of what language they write in
        3. Always generate your response in English
        4. Apply the user's specific edit request accurately
        5. Maintain photorealistic quality with natural lighting
        6. Keep the general style and quality of the original image
        7. Ensure the modification is realistic and technically feasible
        8. If the edit involves clothing changes, maintain proper fit and styling
        9. If the edit involves pose changes, ensure natural body positioning
        10. If the edit involves color changes, preserve garment details and textures
  
        GEMINI TASK:
        1. Understand what modification the user wants
        2. Create a professional English prompt that applies this modification
        3. Ensure the modification is technically possible and realistic
        4. Maintain the overall quality and style of the original image
        5. Describe the change in detail while preserving other elements
  
        LANGUAGE REQUIREMENT: Always generate your prompt in English and START with "Replace, change...".
  
        ${originalPrompt ? `Additional context: ${originalPrompt}.` : ""}
        `;
    } else if (isColorChange && targetColor && targetColor !== "original") {
      // COLOR CHANGE MODE - Sadece renk değiştirme
      promptForGemini = `
        MANDATORY INSTRUCTION: You MUST generate a prompt that STARTS with the word "Replace". The first word of your output must be "change". Do not include any introduction, explanation, or commentary.
  
        ${criticalDirectives}
  
        Create a simple English prompt that STARTS with "change" for changing ONLY the color of the product/garment from the reference image to ${targetColor}.
  
        CRITICAL REQUIREMENTS FOR COLOR CHANGE:
        1. The prompt MUST begin with "Replace the product/garment..."
        2. ONLY change the color to ${targetColor}
        3. Keep EVERYTHING else exactly the same: design, shape, patterns, details, style, fit, texture
        4. Do not modify the garment design, cut, or any other aspect except the color
        5. The final image should be photorealistic, showing the same garment but in ${targetColor} color
        6. Use natural studio lighting with a clean background
        7. Preserve ALL original garment details except color: patterns (but in new color), textures, hardware, stitching, logos, graphics, and construction elements
        8. The garment must appear identical to the reference image, just in ${targetColor} color instead of the original color
  
        LANGUAGE REQUIREMENT: The final prompt MUST be entirely in English and START with "change".
  
        ${
          originalPrompt
            ? `Additional color change requirements: ${originalPrompt}.`
            : ""
        }
        `;
    } else if (isPoseChange) {
      // POSE CHANGE MODE - Sadece poz değiştirme
      promptForGemini = `
        MANDATORY INSTRUCTION: You MUST generate a prompt that STARTS with the word "Replace". The first word of your output must be "change". Do not include any introduction, explanation, or commentary.
  
        ${criticalDirectives}
  
        Create a simple English prompt that STARTS with "change" for changing ONLY the pose/position of the model in the reference image.
  
        CRITICAL REQUIREMENTS FOR POSE CHANGE:
        1. The prompt MUST begin with "Replace the model's pose..."
        2. Keep the EXACT same person, face, clothing, background, and all other elements
        3. ONLY change the pose/position/body positioning of the model
        4. Do not modify or change anything else about the model or scene
        5. The result should be photorealistic with natural lighting and proper body proportions
        6. Preserve ALL original elements except the pose: same person, same outfit, same background, same lighting style
        7. The model must appear identical to the reference image, just in a different pose/position
  
        ${
          customDetail && customDetail.trim()
            ? `USER SPECIFIC POSE: The user wants the pose to be: ${customDetail.trim()}.`
            : `AUTOMATIC POSE SELECTION: You MUST choose ONE specific pose for the model.`
        }
  
        GEMINI TASK - ANALYZE AND CREATE POSE:
        1. ANALYZE the model in the input image (their current pose, body position, clothing style)
        2. IDENTIFY the clothing details (pockets, sleeves, length, style, accessories)
        3. SELECT one specific professional modeling pose that would look elegant and natural for this person
        4. CHOOSE from these categories:
           - ELEGANT POSES: graceful hand positions, confident stances, sophisticated postures
           - FASHION POSES: runway-style poses, magazine-worthy positions, stylish attitudes  
           - PORTRAIT POSES: flattering face angles, expressive hand gestures, artistic positioning
           - DYNAMIC POSES: movement-inspired stances, walking poses, turning positions
  
        ⚠️ CRITICAL CLOTHING COMPATIBILITY RULES:
        - If the garment has NO POCKETS: DO NOT put hands in pockets
        - If the garment has SHORT SLEEVES: DO NOT fold or adjust long sleeves
        - If the garment is SLEEVELESS: DO NOT place hands on sleeves or adjust arm coverage
        - If the garment is a DRESS/SKIRT: Keep leg positioning appropriate for the garment length
        - If the garment has specific NECKLINE: DO NOT change how it sits on the body
        - If the garment has FIXED ACCESSORIES (belts, scarves): Keep them in original position
        - NEVER turn the model completely around (avoid full back views)
        - NEVER change the garment's silhouette, fit, or draping
  
        GEMINI INSTRUCTIONS:
        - First ANALYZE the clothing details and limitations
        - Then DECIDE on ONE specific pose that RESPECTS the clothing constraints
        - DESCRIBE that pose in detail in your prompt with clothing-appropriate positioning
        - Include specific details: hand positioning (compatible with garment), weight distribution, facial direction, body angles
        - Make the pose description sound professional and beautiful
        - Ensure the pose suits the model's style and clothing EXACTLY as shown
  
        LANGUAGE REQUIREMENT: The final prompt MUST be entirely in English and START with "Replace". Do NOT include any rule names, headings, or capitalized instruction phrases (e.g., "FLUX MAX CONTEXT", "CRITICAL REQUIREMENTS", "MANDATORY", "LANGUAGE REQUIREMENT").
  
        ${originalPrompt ? `Additional considerations: ${originalPrompt}.` : ""}
        
        REQUIRED FORMAT: "Replace the model's pose to [SPECIFIC POSE NAME] - [DETAILED DESCRIPTION of the exact pose with clothing-appropriate hand placement, body positioning, weight distribution, and facial direction, ensuring the garment maintains its original appearance, fit, and features while creating photorealistic and elegant results]..."
        
        FINAL REMINDER: The garment must look IDENTICAL to the reference image - same fit, same features, same details. Only the model's body position changes.
        `;
    } else {
      // NORMAL MODE - Standart garment replace
      promptForGemini = `
        MANDATORY INSTRUCTION: You MUST generate a prompt that STARTS with the word "Replace". The first word of your output must be "Replace". Do not include any introduction, explanation, or commentary.
  
        ${criticalDirectives}
  
        Create a simple English prompt that STARTS with "Replace" for replacing the garment from the reference image onto a ${modelGenderText}.
  
        CRITICAL REQUIREMENTS:
        1. The prompt MUST begin with "Replace the flat-lay garment..."
        2. Keep the original garment exactly the same without changing any design, shape, colors, patterns, or details
        3. Do not modify or redesign the garment in any way
        4. The final image should be photorealistic, showing the same garment perfectly fitted on the ${baseModelText}
        5. Use natural studio lighting with a clean background
        6. Preserve ALL original garment details: colors, patterns, textures, hardware, stitching, logos, graphics, and construction elements
        7. The garment must appear identical to the reference image, just worn by the model instead of being flat
  
        PRODUCT DETAIL COVERAGE (MANDATORY): Describe the garment's construction details comprehensively but concisely: exact number of buttons or fasteners, button style/material, zipper presence and position, pocket count and style (e.g., welt, patch, flap), waistband or belt loops, seam placements, darts, pleats, hems and cuff types, stitching type/visibility, closures, trims and hardware, labels/patches (generic terms), fabric texture and weave, pattern alignment, lining presence, and any distinctive construction features. Keep this within the 512-token limit; prioritize the most visually verifiable details.
  
        ${fluxMaxGarmentTransformationDirectives}
  
        LANGUAGE REQUIREMENT: The final prompt MUST be entirely in English and START with "Replace".
  
        ${
          originalPrompt
            ? `USER CONTEXT: The user has provided these specific requirements: ${originalPrompt}. Please integrate these requirements naturally into your garment replacement prompt while maintaining the professional structure and flow.`
            : ""
        }
        
        ${ageSection}
        ${childPromptSection}
        ${bodyShapeMeasurementsSection}
        ${settingsPromptSection}
        ${locationPromptSection}
        ${posePromptSection}
        ${perspectivePromptSection}
        ${hairStylePromptSection}
        ${hairStyleTextSection}
        ${faceDescriptionSection}
        
        Generate a concise prompt focused on garment replacement while maintaining all original details. REMEMBER: Your response must START with "Replace". Apply all rules silently and do not include any rule text or headings in the output.
        
        EXAMPLE FORMAT: "Replace the flat-lay garment from the input image directly onto a standing [model description] while keeping the original garment exactly the same..."
        `;
    }

    // Eğer originalPrompt'ta "Model's pose" ibaresi yoksa ek cümle ekleyelim:
    if (!originalPrompt || !originalPrompt.includes("Model's pose")) {
      // Eğer poz seçilmemişse akıllı poz seçimi, seçilmişse belirtilen poz
      if (!settings?.pose && !poseImage) {
        promptForGemini += `Since no specific pose was provided, intelligently select the most suitable pose and camera angle for the ${baseModelText} that showcases the garment's design features, fit, and construction quality. Choose poses appropriate for the garment category with body language that complements the style and allows clear visibility of craftsmanship details. Select camera perspectives that create appealing commercial presentations highlighting the garment's key selling points.`;
      }
    }

    console.log("Gemini'ye gönderilen istek:", promptForGemini);

    // Resim verilerini içerecek parts dizisini hazırla
    const parts = [{ text: promptForGemini }];

    // Referans görseli Gemini'ye gönder
    try {
      console.log(`Referans görsel Gemini'ye gönderiliyor: ${imageUrl}`);

      const imageResponse = await axios.get(imageUrl, {
        responseType: "arraybuffer",
        timeout: 30000, // 30 saniye timeout
      });
      const imageBuffer = imageResponse.data;

      // Base64'e çevir
      const base64Image = Buffer.from(imageBuffer).toString("base64");

      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: base64Image,
        },
      });

      console.log("Referans görsel başarıyla Gemini'ye yüklendi");
    } catch (imageError) {
      console.error(`Görsel yüklenirken hata: ${imageError.message}`);
    }

    // Location image'ını da Gemini'ye gönder
    if (locationImage) {
      try {
        // URL'den query parametrelerini temizle
        const cleanLocationImageUrl = locationImage.split("?")[0];
        console.log(
          `🏞️ Location görsel base64'e çeviriliyor: ${cleanLocationImageUrl}`
        );

        const locationImageResponse = await axios.get(cleanLocationImageUrl, {
          responseType: "arraybuffer",
          timeout: 30000, // 30 saniye timeout
        });
        const locationImageBuffer = locationImageResponse.data;

        // Base64'e çevir
        const base64LocationImage =
          Buffer.from(locationImageBuffer).toString("base64");

        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: base64LocationImage,
          },
        });

        console.log("🏞️ Location görsel başarıyla Gemini'ye eklendi");
      } catch (locationImageError) {
        console.error(
          `🏞️ Location görseli eklenirken hata: ${locationImageError.message}`
        );
      }
    }

    // Pose image'ını da Gemini'ye gönder
    if (poseImage) {
      try {
        // URL'den query parametrelerini temizle
        const cleanPoseImageUrl = poseImage.split("?")[0];
        console.log(
          `🤸 Pose görsel base64'e çeviriliyor: ${cleanPoseImageUrl}`
        );

        const poseImageResponse = await axios.get(cleanPoseImageUrl, {
          responseType: "arraybuffer",
          timeout: 30000, // 30 saniye timeout
        });
        const poseImageBuffer = poseImageResponse.data;

        // Base64'e çevir
        const base64PoseImage = Buffer.from(poseImageBuffer).toString("base64");

        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: base64PoseImage,
          },
        });

        console.log("🤸 Pose görsel başarıyla Gemini'ye eklendi");
      } catch (poseImageError) {
        console.error(
          `🤸 Pose görseli eklenirken hata: ${poseImageError.message}`
        );
      }
    }

    // Hair style image'ını da Gemini'ye gönder
    if (hairStyleImage) {
      try {
        // URL'den query parametrelerini temizle
        const cleanHairStyleImageUrl = hairStyleImage.split("?")[0];
        console.log(
          `💇 Hair style görsel base64'e çeviriliyor: ${cleanHairStyleImageUrl}`
        );

        const hairStyleImageResponse = await axios.get(cleanHairStyleImageUrl, {
          responseType: "arraybuffer",
          timeout: 30000, // 30 saniye timeout
        });
        const hairStyleImageBuffer = hairStyleImageResponse.data;

        // Base64'e çevir
        const base64HairStyleImage =
          Buffer.from(hairStyleImageBuffer).toString("base64");

        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: base64HairStyleImage,
          },
        });

        console.log("💇 Hair style görsel başarıyla Gemini'ye eklendi");
      } catch (hairStyleImageError) {
        console.error(
          `💇 Hair style görseli eklenirken hata: ${hairStyleImageError.message}`
        );
      }
    }

    // Gemini'den cevap al (retry mekanizması ile) - Yeni API
    let enhancedPrompt;
    const maxRetries = 10;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🤖 [GEMINI] API çağrısı attempt ${attempt}/${maxRetries}`);

        const result = await model.generateContent({
          contents: [
            {
              role: "user",
              parts: parts,
            },
          ],
        });

        const geminiGeneratedPrompt = result.response.text().trim();

        // ControlNet direktifini dinamik olarak ekle
        // let controlNetDirective = "";
        // if (!hasControlNet) {
        //   controlNetDirective = `CONTROLNET GUIDANCE: The input image contains two sections separated by a black line. The LEFT side shows the original garment with background removed for color and texture reference. The RIGHT side shows a black and white ControlNet edge detection image that must be used strictly for understanding the garment's structural design, seam placement, silhouette accuracy, and construction details. Use the right side image only for garment structure guidance - it should not influence the model's appearance, pose, facial features, background, or scene composition. The ControlNet data serves exclusively to ensure accurate garment construction and fit.

        // `;
        // } else {
        //   controlNetDirective = `BACKGROUND REMOVED IMAGE GUIDANCE: The input image shows the original garment with background removed (white background) for clear color and texture reference. Focus on analyzing the garment's design, construction details, fabric characteristics, and styling elements. Use this clean product image to understand the garment's true colors, textures, patterns, and structural features without any background distractions.

        // `;
        // }

        enhancedPrompt = geminiGeneratedPrompt;
        console.log(
          "🤖 [BACKEND GEMINI] Gemini'nin ürettiği prompt:",
          geminiGeneratedPrompt
        );
        console.log(
          "✨ [BACKEND GEMINI] Final enhanced prompt:",
          enhancedPrompt
        );
        break; // Başarılı olursa loop'tan çık
      } catch (geminiError) {
        console.error(
          `Gemini API attempt ${attempt} failed:`,
          geminiError.message
        );

        if (attempt === maxRetries) {
          console.error(
            "Gemini API all attempts failed, using original prompt"
          );
          // Hata durumunda da uygun direktifi ekle
          // let controlNetDirective = "";
          // if (hasControlNet) {
          //   controlNetDirective = `CONTROLNET GUIDANCE: The input image contains two sections separated by a black line. The LEFT side shows the original garment with background removed for color and texture reference. The RIGHT side shows a black and white ControlNet edge detection image that must be used strictly for understanding the garment's structural design, seam placement, silhouette accuracy, and construction details. Use the right side image only for garment structure guidance - it should not influence the model's appearance, pose, facial features, background, or scene composition. The ControlNet data serves exclusively to ensure accurate garment construction and fit.

          // `;
          // } else {
          //   controlNetDirective = `BACKGROUND REMOVED IMAGE GUIDANCE: The input image shows the original garment with background removed (white background) for clear color and texture reference. Focus on analyzing the garment's design, construction details, fabric characteristics, and styling elements. Use this clean product image to understand the garment's true colors, textures, patterns, and structural features without any background distractions.

          // `;
          // }
          enhancedPrompt = originalPrompt;
          break;
        }

        // Exponential backoff: 1s, 2s, 4s
        const waitTime = Math.pow(2, attempt - 1) * 1000;
        console.log(`Waiting ${waitTime}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }

    // Eğer Gemini sonuç üretemediyse (enhancedPrompt orijinal prompt ile aynıysa) direkt fallback prompt kullan
    if (enhancedPrompt === originalPrompt) {
      console.log(
        "🔄 [FALLBACK] Gemini başarısız, detaylı fallback prompt kullanılıyor"
      );

      // Settings'ten bilgileri çıkar
      const location = settings?.location;
      const weather = settings?.weather;
      const age = settings?.age;
      const gender = settings?.gender;
      const productColor = settings?.productColor;
      const mood = settings?.mood;
      const perspective = settings?.perspective;
      const accessories = settings?.accessories;
      const skinTone = settings?.skinTone;
      const hairStyle = settings?.hairStyle;
      const hairColor = settings?.hairColor;
      const bodyShape = settings?.bodyShape;
      const pose = settings?.pose;
      const ethnicity = settings?.ethnicity;

      // Model tanımı
      let modelDescription = "";

      // Yaş ve cinsiyet - aynı koşullar kullanılıyor
      const genderLower = gender ? gender.toLowerCase() : "female";
      let parsedAgeInt = null;

      // Yaş sayısını çıkar
      if (age) {
        if (age.includes("years old")) {
          const ageMatch = age.match(/(\d+)\s*years old/);
          if (ageMatch) {
            parsedAgeInt = parseInt(ageMatch[1]);
          }
        } else if (age.includes("baby") || age.includes("bebek")) {
          parsedAgeInt = 1;
        } else if (age.includes("child") || age.includes("çocuk")) {
          parsedAgeInt = 5;
        } else if (age.includes("young") || age.includes("genç")) {
          parsedAgeInt = 22;
        } else if (age.includes("adult") || age.includes("yetişkin")) {
          parsedAgeInt = 45;
        }
      }

      // Aynı yaş koşulları kullanılıyor
      if (!isNaN(parsedAgeInt) && parsedAgeInt <= 3) {
        // Baby/Toddler
        let ageGroupWord;
        if (parsedAgeInt <= 1) {
          ageGroupWord = "baby";
        } else {
          ageGroupWord = "toddler";
        }
        const genderWord =
          genderLower === "male" || genderLower === "man" ? "boy" : "girl";

        if (parsedAgeInt <= 1) {
          modelDescription = `${parsedAgeInt}-year-old ${ageGroupWord} ${genderWord} (infant)`;
        } else {
          modelDescription = `${parsedAgeInt} year old ${ageGroupWord} ${genderWord}`;
        }
      } else if (!isNaN(parsedAgeInt) && parsedAgeInt <= 12) {
        // Child
        const genderWord =
          genderLower === "male" || genderLower === "man" ? "boy" : "girl";
        modelDescription = `${parsedAgeInt} year old child ${genderWord}`;
      } else if (!isNaN(parsedAgeInt) && parsedAgeInt <= 16) {
        // Teenage
        const genderWord =
          genderLower === "male" || genderLower === "man" ? "boy" : "girl";
        modelDescription = `${parsedAgeInt} year old teenage ${genderWord}`;
      } else {
        // Yetişkin mantığı
        if (genderLower === "male" || genderLower === "man") {
          modelDescription = "male model";
        } else {
          modelDescription = "female model";
        }

        // Eğer yaş bilgisini yetişkinlerde kullanmak istersen
        if (age && !age.includes("years old")) {
          modelDescription =
            genderLower === "male" || genderLower === "man"
              ? `${age} male model`
              : `${age} female model`;
        }
      }

      // Etnik köken
      if (ethnicity) {
        modelDescription += ` ${ethnicity}`;
      }

      // Ten rengi
      if (skinTone) {
        modelDescription += ` with ${skinTone} skin`;
      }

      // Saç detayları
      if (hairColor && hairStyle) {
        modelDescription += `, ${hairColor} ${hairStyle}`;
      } else if (hairColor) {
        modelDescription += `, ${hairColor} hair`;
      } else if (hairStyle) {
        modelDescription += `, ${hairStyle}`;
      }

      // Vücut tipi
      if (bodyShape) {
        modelDescription += `, ${bodyShape} body shape`;
      }

      // Poz ve ifade
      let poseDescription = "";
      if (pose) poseDescription += `, ${pose}`;
      if (mood) poseDescription += ` with ${mood} expression`;

      // Aksesuarlar
      let accessoriesDescription = "";
      if (accessories) {
        accessoriesDescription += `, wearing ${accessories}`;
      }

      // Ortam
      let environmentDescription = "";
      if (location) environmentDescription += ` in ${location}`;
      if (weather) environmentDescription += ` during ${weather} weather`;

      // Kamera açısı
      let cameraDescription = "";
      if (perspective) {
        cameraDescription += `, ${perspective} camera angle`;
      }

      // Ürün rengi
      let clothingDescription = "";
      if (productColor && productColor !== "original") {
        clothingDescription += `, wearing ${productColor} colored clothing`;
      }

      // Ana prompt oluştur
      let fallbackPrompt = `Replace the flat-lay garment from the input image directly onto a ${modelDescription} model${poseDescription}${accessoriesDescription}${environmentDescription}${cameraDescription}${clothingDescription}. `;

      // Kıyafet detayları ve kalite gereksinimleri
      fallbackPrompt += `Preserve the original garment exactly as is, without altering any design, shape, colors, patterns, or details. The photorealistic output must show the identical garment perfectly fitted on the dynamic model. `;

      // Kıyafet özellikleri (genel)
      fallbackPrompt += `The garment features high-quality fabric with proper texture, stitching, and construction details. `;

      // Temizlik gereksinimleri
      fallbackPrompt += `ABSOLUTELY AND IMMEDIATELY REMOVE ALL HANGERS, CLIPS, TAGS, AND FLAT-LAY ARTIFACTS. Transform the flat-lay garment into a hyper-realistic, three-dimensional worn garment on the existing model; avoid any 2D, sticker-like, or paper-like overlay. `;

      // Fizik gereksinimleri
      fallbackPrompt += `Ensure realistic fabric physics: natural drape, weight, tension, compression, and subtle folds along shoulders, chest, torso, and sleeves; maintain a clean commercial presentation with minimal distracting wrinkles. `;

      // Detay koruma
      fallbackPrompt += `Preserve ALL original garment details: exact colors, prints/patterns, material texture, stitching, construction elements, trims, and finishes. Do NOT redesign. `;

      // Pattern entegrasyonu
      fallbackPrompt += `Integrate prints/patterns correctly over the 3D form: patterns must curve, stretch, and wrap naturally across body contours; no flat, uniform, or unnaturally straight pattern lines. `;

      // Final kalite
      fallbackPrompt += `Maintain photorealistic integration with the model and scene: correct scale, perspective, lighting, cast shadows, and occlusions; match camera angle and scene lighting. High quality, sharp detail, professional fashion photography aesthetic.`;

      console.log(
        "🔄 [FALLBACK] Generated detailed fallback prompt:",
        fallbackPrompt
      );

      enhancedPrompt = fallbackPrompt;
    }

    return enhancedPrompt;
  } catch (error) {
    console.error("🤖 Gemini 2.0 Flash prompt iyileştirme hatası:", error);
    // Hata durumunda da uygun direktifi ekle
    // let controlNetDirective = "";
    // if (hasControlNet) {
    //   controlNetDirective = `CONTROLNET GUIDANCE: The input image contains two sections separated by a black line. The LEFT side shows the original garment with background removed for color and texture reference. The RIGHT side shows a black and white ControlNet edge detection image that must be used strictly for understanding the garment's structural design, seam placement, silhouette accuracy, and construction details. Use the right side image only for garment structure guidance - it should not influence the model's appearance, pose, facial features, background, or scene composition. The ControlNet data serves exclusively to ensure accurate garment construction and fit.

    // `;
    // } else {
    //   controlNetDirective = `BACKGROUND REMOVED IMAGE GUIDANCE: The input image shows the original garment with background removed (white background) for clear color and texture reference. Focus on analyzing the garment's design, construction details, fabric characteristics, and styling elements. Use this clean product image to understand the garment's true colors, textures, patterns, and structural features without any background distractions.

    // `;
    // }

    // Fallback prompt - detaylı kıyafet odaklı format
    console.log(
      "🔄 [FALLBACK] Enhanced prompt oluşturulamadı, detaylı fallback prompt kullanılıyor"
    );

    // Settings'ten bilgileri çıkar
    const location = settings?.location;
    const weather = settings?.weather;
    const age = settings?.age;
    const gender = settings?.gender;
    const productColor = settings?.productColor;
    const mood = settings?.mood;
    const perspective = settings?.perspective;
    const accessories = settings?.accessories;
    const skinTone = settings?.skinTone;
    const hairStyle = settings?.hairStyle;
    const hairColor = settings?.hairColor;
    const bodyShape = settings?.bodyShape;
    const pose = settings?.pose;
    const ethnicity = settings?.ethnicity;

    // Model tanımı
    let modelDescription = "";

    // Yaş ve cinsiyet - aynı koşullar kullanılıyor
    const genderLower = gender ? gender.toLowerCase() : "female";
    let parsedAgeInt = null;

    // Yaş sayısını çıkar
    if (age) {
      if (age.includes("years old")) {
        const ageMatch = age.match(/(\d+)\s*years old/);
        if (ageMatch) {
          parsedAgeInt = parseInt(ageMatch[1]);
        }
      } else if (age.includes("baby") || age.includes("bebek")) {
        parsedAgeInt = 1;
      } else if (age.includes("child") || age.includes("çocuk")) {
        parsedAgeInt = 5;
      } else if (age.includes("young") || age.includes("genç")) {
        parsedAgeInt = 22;
      } else if (age.includes("adult") || age.includes("yetişkin")) {
        parsedAgeInt = 45;
      }
    }

    // Aynı yaş koşulları kullanılıyor
    if (!isNaN(parsedAgeInt) && parsedAgeInt <= 3) {
      // Baby/Toddler
      let ageGroupWord;
      if (parsedAgeInt <= 1) {
        ageGroupWord = "baby";
      } else {
        ageGroupWord = "toddler";
      }
      const genderWord =
        genderLower === "male" || genderLower === "man" ? "boy" : "girl";

      if (parsedAgeInt <= 1) {
        modelDescription = `${parsedAgeInt}-year-old ${ageGroupWord} ${genderWord} (infant)`;
      } else {
        modelDescription = `${parsedAgeInt} year old ${ageGroupWord} ${genderWord}`;
      }
    } else if (!isNaN(parsedAgeInt) && parsedAgeInt <= 12) {
      // Child
      const genderWord =
        genderLower === "male" || genderLower === "man" ? "boy" : "girl";
      modelDescription = `${parsedAgeInt} year old child ${genderWord}`;
    } else if (!isNaN(parsedAgeInt) && parsedAgeInt <= 16) {
      // Teenage
      const genderWord =
        genderLower === "male" || genderLower === "man" ? "boy" : "girl";
      modelDescription = `${parsedAgeInt} year old teenage ${genderWord}`;
    } else {
      // Yetişkin mantığı
      if (genderLower === "male" || genderLower === "man") {
        modelDescription = "male model";
      } else {
        modelDescription = "female model";
      }

      // Eğer yaş bilgisini yetişkinlerde kullanmak istersen
      if (age && !age.includes("years old")) {
        modelDescription =
          genderLower === "male" || genderLower === "man"
            ? `${age} male model`
            : `${age} female model`;
      }
    }

    // Etnik köken
    if (ethnicity) {
      modelDescription += ` ${ethnicity}`;
    }

    // Ten rengi
    if (skinTone) {
      modelDescription += ` with ${skinTone} skin`;
    }

    // Saç detayları
    if (hairColor && hairStyle) {
      modelDescription += `, ${hairColor} ${hairStyle}`;
    } else if (hairColor) {
      modelDescription += `, ${hairColor} hair`;
    } else if (hairStyle) {
      modelDescription += `, ${hairStyle}`;
    }

    // Vücut tipi
    if (bodyShape) {
      modelDescription += `, ${bodyShape} body shape`;
    }

    // Poz ve ifade
    let poseDescription = "";
    if (pose) poseDescription += `, ${pose}`;
    if (mood) poseDescription += ` with ${mood} expression`;

    // Aksesuarlar
    let accessoriesDescription = "";
    if (accessories) {
      accessoriesDescription += `, wearing ${accessories}`;
    }

    // Ortam
    let environmentDescription = "";
    if (location) environmentDescription += ` in ${location}`;
    if (weather) environmentDescription += ` during ${weather} weather`;

    // Kamera açısı
    let cameraDescription = "";
    if (perspective) {
      cameraDescription += `, ${perspective} camera angle`;
    }

    // Ürün rengi
    let clothingDescription = "";
    if (productColor && productColor !== "original") {
      clothingDescription += `, wearing ${productColor} colored clothing`;
    }

    // Ana prompt oluştur
    let fallbackPrompt = `Replace the flat-lay garment from the input image directly onto a ${modelDescription} model${poseDescription}${accessoriesDescription}${environmentDescription}${cameraDescription}${clothingDescription}. `;

    // Kıyafet detayları ve kalite gereksinimleri
    fallbackPrompt += `Preserve the original garment exactly as is, without altering any design, shape, colors, patterns, or details. The photorealistic output must show the identical garment perfectly fitted on the dynamic model. `;

    // Kıyafet özellikleri (genel)
    fallbackPrompt += `The garment features high-quality fabric with proper texture, stitching, and construction details. `;

    // Temizlik gereksinimleri
    fallbackPrompt += `ABSOLUTELY AND IMMEDIATELY REMOVE ALL HANGERS, CLIPS, TAGS, AND FLAT-LAY ARTIFACTS. Transform the flat-lay garment into a hyper-realistic, three-dimensional worn garment on the existing model; avoid any 2D, sticker-like, or paper-like overlay. `;

    // Fizik gereksinimleri
    fallbackPrompt += `Ensure realistic fabric physics: natural drape, weight, tension, compression, and subtle folds along shoulders, chest, torso, and sleeves; maintain a clean commercial presentation with minimal distracting wrinkles. `;

    // Detay koruma
    fallbackPrompt += `Preserve ALL original garment details: exact colors, prints/patterns, material texture, stitching, construction elements, trims, and finishes. Do NOT redesign. `;

    // Pattern entegrasyonu
    fallbackPrompt += `Integrate prints/patterns correctly over the 3D form: patterns must curve, stretch, and wrap naturally across body contours; no flat, uniform, or unnaturally straight pattern lines. `;

    // Final kalite
    fallbackPrompt += `Maintain photorealistic integration with the model and scene: correct scale, perspective, lighting, cast shadows, and occlusions; match camera angle and scene lighting. High quality, sharp detail, professional fashion photography aesthetic.`;

    console.log(
      "🔄 [FALLBACK] Generated detailed fallback prompt:",
      fallbackPrompt
    );
    return fallbackPrompt;
  }
}
