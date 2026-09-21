const express=require('express');
const {supabaseAdmin:db}=require('../supabaseClient');
const {catalogCard}=require('../utils/productStudioCatalog');
const router=express.Router();
router.get('/',async(req,res)=>{try{
 const result=await db.from('product_studio_catalog').select('id,builtin_id,position,published,enabled').order('position').order('id');if(result.error)throw result.error;
 res.set('Cache-Control','no-store').json({success:true,version:1,configured:result.data.length>0,items:result.data.map(r=>catalogCard(r,req.query.language)).filter(Boolean)});
}catch(e){console.warn('[product-studio] catalog',e.message);res.status(503).json({success:false});}});
module.exports=router;
