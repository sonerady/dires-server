// Food-specific art direction. Identity and honest portions override styling preferences.
// NOTE: tests/foodPhotography.test.js pins exactly 5 controls — enrich options, do not add controls.
const T=(en,tr)=>({en,tr});
const o=(id,en,tr,instruction,hint)=>(hint?{id,label:T(en,tr),instruction,hint}:{id,label:T(en,tr),instruction});
module.exports={
 id:'food-photography',group:'studio',
 title:T('Food Photography','Yemek Fotoğrafçılığı'),
 subtitle:T('Turn your dish into a professional menu, restaurant or social photo.','Yemeğini menü, restoran veya sosyal medya için profesyonel çekime dönüştür.'),
 upload:{mode:'angles',max:4,title:T('Upload your dish','Yemeğinin fotoğrafını yükle'),hint:T('One dish, up to 4 angles. Keep the whole plate visible.','Aynı yemeğin en fazla 4 açısını ekle. Tabağın tamamı görünsün.')},
 refs:[{id:'style',title:T('Style reference','Stil referansı'),hint:T('Borrow the lighting and mood, never the food.','Yalnız ışık ve atmosfer örnek alınır; referanstaki yemek kopyalanmaz.'),required:false,max:3,role:'STYLE ONLY: lighting, palette and surface mood. Never copy its food, ingredients, portions, plating, branding or text. Explicit selected options take priority over this reference.'}],
 controls:[
  {id:'purpose',type:'choice',section:'setup',title:T('Where will you use it?','Nerede kullanacaksın?'),hint:T('Sets the framing and amount of styling.','Kadrajı ve sahnedeki dekor miktarını belirler.'),default:'menu',display:'cards',options:[
   o('menu','Menu & delivery','Menü ve sipariş','Honest menu/delivery photo, single actual dish, centered full plate with safe margins and clear ingredient visibility; deep enough focus across the meal; no external props, text, badges or extra food. Do not claim platform certification.',T('Honest full plate for menus and delivery apps','Menü ve sipariş uygulamaları için dürüst, tam tabak')),
   o('restaurant','Restaurant campaign','Restoran kampanyası','Premium restaurant campaign with restrained setting, plate remains hero, rich but realistic textures, tasteful background depth.',T('Premium mood for campaigns and posters','Kampanya ve afişler için premium atmosfer')),
   o('social','Social media','Sosyal medya','A contemporary food editorial with generous breathing room and clean graphic composition; retain visible meal and portion, no text baked in.',T('Airy editorial look for your feed','Akışın için ferah, editoryal görünüm')),
   o('story','Story / Reels','Hikâye / Reels','Vertical story or reels cover: the dish sits inside the central safe zone, the top 15% and bottom 20% of the frame stay calm for app overlays; retain visible meal and portion, no text baked in.',T('Safe-zone framing for Stories and Reels','Hikâye ve Reels için güvenli alanlı kadraj')),
   o('website','Website banner','Web sitesi bannerı','Website hero/banner photo: the dish placed off-centre with calm, clean negative space on one side for a headline added later; the plate stays fully visible and is the hero; no text baked in.',T('Wide frame with room for your headline','Başlık yazına yer bırakan geniş kadraj')),
   o('print','Printed menu','Basılı menü','Printed menu / flyer photo: very clean, evenly lit, high detail and true colour on a simple uncluttered background that reproduces well in print; whole plate visible, no props, no text.',T('Clean, detailed shot that prints well','Baskıda iyi duran temiz ve detaylı çekim')),
  ]},
  {id:'angle',type:'choice',section:'look',title:T('Camera angle','Çekim açısı'),hint:T('Overhead for bowls; eye level for layered dishes.','Kaseler için üstten; katmanlı yemekler için göz hizası.'),default:'auto',display:'grid',options:[
   o('auto','Best for this dish','Yemeğe en uygun','Choose based on actual dish geometry: overhead for pizza, soup or grain bowls; low eye level for burgers and layered cake; around 45 degrees for plated mains or pasta. Do not reveal invented hidden details.'),
   o('source','Keep original angle','Mevcut açıyı koru','Keep the source camera angle and visible food geometry.'),
   o('top','Overhead · 90°','Üstten · 90°','True overhead 90 degree flat lay; preserve arrangement and amounts without multiplying ingredients.'),
   o('three_quarter','Three-quarter · 45°','Çapraz · 45°','Natural 45 degree three-quarter food photograph with realistic plate perspective.'),
   o('eye','Eye level','Göz hizası','Low near eye-level angle revealing actual existing layers, not taller or larger portions. Never invent fillings.'),
   o('close','Close-up detail','Yakın detay','A tight, appetising close-up on the most attractive part of the actual dish that shows real texture; for MENU/DELIVERY or printed menus keep the whole plate visible instead. Never invent hidden details.'),
  ]},
  {id:'lighting',type:'choice',section:'look',title:T('Light','Işık'),hint:T('Shape texture while keeping food colors true.','Yemeğin gerçek rengini koruyarak dokuyu belirginleştirir.'),default:'window',display:'grid',options:[
   o('reference','From selected style','Seçilen stilden','Use the selected food style references for light and white balance only. If absent, use soft neutral window light.'),
   o('window','Soft window light','Yumuşak gün ışığı','Large diffused window side light around 45 degrees with white bounce fill, soft dimensional shadows, neutral white balance, no yellow cast or clipped highlights.'),
   o('bright','Bright & airy','Aydınlık ve ferah','High-key soft daylight with generous white bounce fill, light clean shadows and neutral white balance; food colours stay true, no washed-out highlights.'),
   o('studio','Clean studio','Temiz stüdyo','Large controlled studio softbox from the side with gentle fill and accurate white balance; crisp readable food texture, balanced highlights.'),
   o('moody','Dramatic side light','Dramatik yan ışık','Directional side-back light and restrained negative fill for depth. Keep every ingredient readable, never crush shadows or darken the meal.'),
   o('backlight','Glossy backlight','Parlatan arka ışık','Soft side-back light that makes sauces, glazes and natural moisture glisten realistically, with front fill so the dish stays readable; steam only if physically visible in the source.'),
  ]},
  {id:'scene',type:'choice',section:'scene',title:T('Table & setting','Masa ve ortam'),default:'neutral',display:'grid',options:[
   o('reference','From selected style','Seçilen stilden','Use the selected food style reference surface and backdrop family, never its food, tableware or incidental props. If absent, use a clean neutral table.'),
   o('neutral','Clean neutral','Sade nötr','Clean matte ivory neutral tabletop and unobtrusive background.'),
   o('wood','Warm restaurant','Sıcak restoran','Rich walnut restaurant table with an elegantly defocused restaurant background, no people.'),
   o('rustic','Rustic wood','Rustik ahşap','Weathered rustic wooden table with natural grain, homely and warm without an orange colour cast.'),
   o('marble','White marble','Beyaz mermer','White marble tabletop with soft grey veining, bright and clean.'),
   o('stone','Light stone','Açık taş','Pale travertine tabletop, airy elegant cafe atmosphere.'),
   o('dark','Dark stone','Koyu taş','Charcoal stone table with controlled tonal contrast, food remains bright and appetizing.'),
   o('linen','Linen tablecloth','Keten örtü','Natural linen tablecloth in a soft neutral tone with gentle folds, relaxed and homely.'),
   o('terrace','Outdoor terrace','Açık hava terası','Outdoor terrace table in soft natural daylight with softly blurred greenery behind, no people.'),
   o('color','Color studio','Renkli stüdyo','Minimal matte studio surface in a single tasteful complementary color derived from the dish, with no color cast on food.'),
  ]},
  {id:'styling',type:'choice',section:'scene',title:T('Styling','Sahne düzeni'),hint:T('The food and plate remain unchanged.','Yemek ve tabak aynı kalır.'),default:'minimal',options:[
   o('minimal','Only the dish','Yalnız yemek','Only the supplied dish and its original plate/bowl/glass. No added props or ingredients.'),
   o('napkin','Napkin only','Yalnız peçete','Only a softly folded linen napkin partly under or beside the plate; no cutlery and no extra food. MENU/DELIVERY purpose overrides this: omit external props.'),
   o('table','Linen & cutlery','Peçete ve çatal','A restrained napkin and suitable cutlery outside the plate, with no extra food. MENU/DELIVERY purpose overrides this: omit external props.'),
   o('set_table','Set table','Kurulu masa','A restrained set table outside the dish: folded napkin, suitable cutlery and one empty side plate, with no extra food or drinks. MENU/DELIVERY purpose overrides this: omit external props.'),
  ]},
 ],
 presets:[
  {id:'delivery_app',label:T('Delivery app photo','Sipariş uygulaması'),hint:T('Full plate, clean table, no props','Tam tabak, sade masa, dekor yok'),values:{purpose:'menu',angle:'auto',lighting:'window',scene:'neutral',styling:'minimal'}},
  {id:'instagram',label:T('Instagram post','Instagram gönderisi'),hint:T('Overhead, bright light, napkin and cutlery','Üstten, aydınlık ışık, peçete ve çatal'),values:{purpose:'social',angle:'top',lighting:'bright',scene:'stone',styling:'table'}},
  {id:'campaign',label:T('Restaurant campaign','Restoran kampanyası'),hint:T('Dramatic side light on dark stone','Koyu taş üzerinde dramatik yan ışık'),values:{purpose:'restaurant',angle:'three_quarter',lighting:'moody',scene:'dark',styling:'set_table'}},
  {id:'website',label:T('Website banner','Web sitesi bannerı'),hint:T('Wide frame with room for your headline','Başlık yazına yer bırakan geniş kadraj'),values:{purpose:'website',angle:'three_quarter',lighting:'window',scene:'wood',styling:'napkin'}},
 ],
 ratio:'4:5',
 direction:'Transform the supplied real prepared meal into professional restaurant food photography. First visually identify the actual food, ingredient arrangement, edible texture, original tableware and portions. Improve photographic craft, never the recipe. Match chosen purpose, angle, light and scene. MENU/DELIVERY priority: no props even when table styling is selected; keep whole plate visible. Reflections, moisture and highlights must be physically plausible. Keep the full meal in focus with any shallow depth confined to background; no wide-angle distortion, fake gloss, excessive saturation or generative garnish. Remove the incidental original kitchen background. Keep original plate or container. No hands or people. Never add alcohol, wine glasses, stemware, drink bottles or bar imagery, even if present in a style reference. Style reference never supplies ingredients. Do not add steam unless physically visible in source; never steam for a cold dish. Photograph food, not fashion.',
 fidelity:'FOOD FIDELITY — HIGHEST PRIORITY: preserve the SAME dish, exact ingredient types, visible arrangement, portion size, number of servings, cooking/doneness, colors and original plate/bowl/glass. Never add, remove or replace food; never enlarge patties, add cheese layers, herbs, sauces or sides; never copy food from a style reference. Keep natural edible texture, no plastic sheen. No invented diet, allergen, health or nutrition claims. Extra uploaded angles show the SAME dish and are not extra portions.',
 // 30 Eyl 2026 varyasyon noktaları (studioTools planVariants): kamera açısı her zaman seçimde kalır (auto = yemeğin
 // geometrisi kuralı); menü/basılı menü tabağı ortada, tam ve dekorsuz tutar → orada yalnız ışık yönü ve arka plan değişir.
 vary:{
  locks:{
   purpose:{menu:['props','placement','framing'],print:['props','placement','framing'],social:['tight'],story:['offcentre','low'],website:['centred','low','tight']},
   angle:{close:['camera','framing'],'*':['camera']},
   lighting:{reference:['light','falloff'],bright:['falloff'],moody:['light'],backlight:['light']},
   scene:{reference:['background','falloff']},
   styling:{minimal:['props']},
  },
  refLocks:{style:['light']},
  moves:[
   {axis:'light',text:'the soft window light comes from the right of the frame, shadows falling gently to the left of the plate'},
   {axis:'framing',text:'close — the plate fills about 80% of the frame width with its whole rim still visible',tags:['tight']},
   {axis:'depth',text:'the background behind the table falls into a soft blur while the whole dish stays sharp'},
   {axis:'placement',text:'the plate on the right third of the frame with calm open table on the left',tags:['offcentre']},
   {axis:'props',text:'the napkin and any cutlery grouped on the right side of the plate, parallel to the frame edge'},
   {axis:'light',text:'the soft window light comes from the left of the frame, shadows falling gently to the right of the plate'},
   {axis:'background',text:'the table edge and a softly blurred wall visible across the top of the frame',when:(v)=>['eye','three_quarter','close'].includes(v.angle)},
   {axis:'falloff',text:'the table and background gently darkening toward the corners of the frame, the plate the brightest area'},
   {axis:'framing',text:'loose — open table all around the plate, the whole dish about 55% of the frame width',tags:['wide']},
   {axis:'placement',text:'the plate on the left third of the frame with calm open table on the right',tags:['offcentre']},
  ],
 },
};
