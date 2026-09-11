// Old unauthenticated test/broadcast endpoints must never send to a segment.
const router=require('express').Router();
router.use((_req,res)=>res.status(410).json({error:'Retired. Use the scoped acquisition push CLI.'}));
module.exports=router;
