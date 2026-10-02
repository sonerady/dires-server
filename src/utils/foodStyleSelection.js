// Resolve server-owned profile data, never client-supplied style prompts.
async function resolveFoodStyle(db,id,userId) {
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id||''))throw new Error('food_style_id');
 const {data:p,error}=await db.from('food_style_profiles').select('id,user_id,status,image_urls,style_prompt').eq('id',id).maybeSingle();
 if(error)throw error;
 if(!p || p.status!=='ready' || !['global',userId].includes(p.user_id))throw new Error('food_style_unavailable');
 const images=(p.image_urls||[]).filter(url=>typeof url==='string'&&/^https:\/\//.test(url)).slice(0,3);
 if(!images.length)throw new Error('food_style_images');
 return {id:p.id,images,prompt:String(p.style_prompt||'').slice(0,5000)};
}
module.exports={resolveFoodStyle};
