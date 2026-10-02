const express = require('express');
const {createStyleProfileRouter} = require('./styleProfileRouterFactory');
const {supabaseAdmin:db} = require('../supabaseClient');
const {refundIdentity} = require('../middleware/refundIdentity');
const {rateLimit} = require('express-rate-limit');
const router=express.Router();
router.use(rateLimit({windowMs:60000,limit:60,standardHeaders:true,legacyHeaders:false}));
// The food library has no fashion categories. Public discovery contains only food rows.
router.get('/categories',(_req,res)=>res.json({success:true,categories:[]}));
router.use((req,res,next)=>{
 if(req.method==='GET' && req.path==='/global')return next();
 // This surface intentionally does not expose the fashion router's admin operations.
 if(req.path.startsWith('/admin') || req.path.includes('approach') || req.path.includes('white-studio'))return res.sendStatus(404);
 const owner=req.path.match(/^\/user\/([0-9a-f-]+)$/i)?.[1];
 if(owner){req.query.userId=owner;req.body={...req.body,userId:owner};}
 return refundIdentity(db)(req,res,next);
});
router.use(createStyleProfileRouter({
 table:'food_style_profiles',storagePrefix:'food_style_profile_',subjectLabel:'restaurant food photography style references',
 analysisPrompt:`You are a professional restaurant food photographer. Analyze the shared PHOTOGRAPHIC STYLE of these reference photos, for reuse with a completely different dish.
Describe only: soft/hard key light direction and size, fill and shadow density, accurate white balance and restrained grade, table surface and backdrop family, framing/negative space, camera angle and depth of field. Use concrete photography language in 150-250 words.
Never describe or prescribe the reference food, ingredients, recipe, garnish, portion, tableware, branding, people or text. Never add food or fake steam. Exclude alcohol, wine glasses, stemware, drink bottles and bar imagery from style descriptions. The actual user's dish, ingredients, plating, portions and original tableware remain unchanged. Food texture and natural colors remain honest. Selected menu purpose, angle and any explicit lighting/scene overrides take priority. No fashion/model posing instructions. Output plain text only.`
}));
module.exports=router;
