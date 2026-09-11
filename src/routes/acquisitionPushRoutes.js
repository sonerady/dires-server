const router=require('express').Router();
const {rateLimit}=require('express-rate-limit');
const {getAcquisitionPush}=require('../services/acquisitionPush');
router.post('/sync',rateLimit({windowMs:60*1000,limit:30,standardHeaders:'draft-7',legacyHeaders:false}),async(req,res)=>{
  try{
    const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
    const result=await getAcquisitionPush().sync(req.body?.userId,token,req.body||{});
    return res.status(result.status).json({ok:result.status===200,eligible:result.eligible});
  }catch(error){
    console.warn('[Acquisition push] Sync failed:',error.message);
    return res.status(503).json({ok:false});
  }
});
module.exports=router;
