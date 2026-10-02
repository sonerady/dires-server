const express=require('express');
const {supabaseAdmin:db}=require('../supabaseClient');
const {catalogCard,SEED}=require('../utils/productStudioCatalog');
const router=express.Router();
router.get('/',async(req,res)=>{try{
 const result=await db.from('product_studio_catalog').select('id,builtin_id,position,published,enabled').order('position').order('id');if(result.error)throw result.error;
 // New built-in is available until an administrator explicitly imports/hides/reorders it.
 const rows=[...result.data];
 if(!rows.some(r=>r.builtin_id==='food-photography')){const food=SEED.find(r=>r.builtin_id==='food-photography');if(food)rows.splice(2,0,{...food,id:food.builtin_id,enabled:true,published:food.draft});}
 res.set('Cache-Control','no-store').json({success:true,version:1,configured:result.data.length>0,items:rows.map(r=>catalogCard(r,req.query.language)).filter(Boolean)});
}catch(e){console.warn('[product-studio] catalog',e.message);res.status(503).json({success:false});}});
module.exports=router;
