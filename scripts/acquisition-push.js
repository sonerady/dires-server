#!/usr/bin/env node
// Never sends campaigns to a segment. CLI defaults to a read-only dry run.
require('dotenv').config();
const fs=require('node:fs');const {randomUUID}=require('node:crypto');
const {getAcquisitionPush,buildPush,localizedCampaign}=require('../src/services/acquisitionPush');
async function main(){
 const [command='dry-run',subscriptionId,language='tr']=process.argv.slice(2);
 const svc=getAcquisitionPush();
 if(command==='dry-run'){console.log(await svc.run());return;}
 if(!['inspect','test'].includes(command)||!/^[0-9a-f-]{36}$/i.test(subscriptionId||''))throw new Error('Usage: acquisition-push.js dry-run | inspect SUBSCRIPTION_ID | test SUBSCRIPTION_ID [language]');
 const appId=process.env.ONESIGNAL_APP_ID;
 const identity=await svc.provider(`/apps/${appId}/subscriptions/${subscriptionId}/user/identity`);
 const user=await svc.provider(`/apps/${appId}/users/by/onesignal_id/${identity.identity.onesignal_id}`);
 const sub=user.subscriptions.find(s=>s.id===subscriptionId);
 console.log({subscriptionId,enabled:sub?.enabled,model:sub?.device_model,platform:sub?.type,version:sub?.app_version});
 if(command==='inspect')return;
 if(process.env.ACQUISITION_PUSH_TEST_SUBSCRIPTION_ID!==subscriptionId)throw new Error('Set ACQUISITION_PUSH_TEST_SUBSCRIPTION_ID to the verified owner device first');
 if(!sub?.enabled||!['iOSPush','AndroidPush'].includes(sub.type))throw new Error('Test device is not subscribed');
 // Explicit diagnostic; not an acquisition campaign or audience enrollment.
 const campaign={...localizedCampaign(language,new Date().getUTCDay()),body:language==='tr'?'Test bildirimi: Diress bildirim bağlantın çalışıyor.':'Test notification: your Diress notification connection is working.'};
 const key=randomUUID();
 fs.writeFileSync('/tmp/diress-last-push-test.json',JSON.stringify({idempotencyKey:key,subscriptionId,at:new Date().toISOString()}),{mode:0o600});
 const result=await svc.provider('/notifications',{method:'POST',body:JSON.stringify(buildPush(appId,subscriptionId,campaign,key,true))});
 console.log({notificationId:result.id,recipients:result.recipients});
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
