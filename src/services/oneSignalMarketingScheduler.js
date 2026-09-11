// Legacy non-Pro broadcasts have been replaced with explicit new-install
// enrollment and a database history check immediately before each send.
const cron=require('node-cron');
const {getAcquisitionPush}=require('./acquisitionPush');
function startOneSignalMarketingScheduler(){
  if(process.env.ACQUISITION_PUSH_WORKER_ENABLED!=='true')return null;
  let running=false;
  return cron.schedule('* * * * *',async()=>{
    if(running)return;
    running=true;
    try{const result=await getAcquisitionPush().run({dryRun:false}); if(result.sent||result.failed)console.log('[Acquisition push]',result);}
    catch(error){console.error('[Acquisition push]',error.message);}
    finally{running=false;}
  },{timezone:'UTC'});
}
// An ad-hoc invocation never broadcasts. Activation needs both server and DB gates.
const runOnce=()=>getAcquisitionPush().run({dryRun:true});
module.exports={startOneSignalMarketingScheduler,runOnce};
