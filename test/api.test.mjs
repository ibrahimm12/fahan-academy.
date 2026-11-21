import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';

const port = 34000 + Math.floor(Math.random() * 20000);
const origin = `http://localhost:${port}`;
const temp = await mkdtemp(join(tmpdir(), 'fahan-api-test-'));
const app = spawn(process.execPath, ['--experimental-sqlite','server/index.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env, PORT:String(port), APP_ORIGIN:origin, DATABASE_PATH:join(temp,'test.sqlite'),
    SESSION_SECRET:'test-session-secret-with-sufficient-length', ADMIN_BOOTSTRAP_KEY:'test-bootstrap-key',
    STRIPE_WEBHOOK_SECRET:'whsec_test_only', STRIPE_PRICE_ID:'price_course_test', STRIPE_SECRET_KEY:'', ANTHROPIC_API_KEY:'', ANTHROPIC_MODEL:''
  },
  stdio:['ignore','pipe','pipe']
});
let serverOutput='';
app.stdout.on('data',x=>serverOutput+=x.toString());
app.stderr.on('data',x=>serverOutput+=x.toString());
after(async()=>{app.kill();await once(app,'exit').catch(()=>{});await rm(temp,{recursive:true,force:true});});

async function waitReady() {
  const deadline=Date.now()+15000;
  while(Date.now()<deadline) {
    if(app.exitCode!==null) throw new Error(`API process stopped: ${serverOutput}`);
    try {const response=await fetch(`${origin}/api/health`);if(response.ok)return;} catch {}
    await new Promise(resolve=>setTimeout(resolve,150));
  }
  throw new Error(`API did not start: ${serverOutput}`);
}
async function request(path,{method='GET',cookie='',body,headers={}}={}) {
  const response=await fetch(`${origin}/api${path}`,{
    method,headers:{...(method==='GET'?{}:{Origin:origin}),...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
}

test('auth, isolation, content, quizzes, admin, billing, and tutor error paths',async()=>{
  await waitReady();
  const catalog=await request('/catalog');
  assert.equal(catalog.status,200);
  assert.equal(catalog.data.domains.length,7);
  assert.equal(catalog.data.domains.reduce((sum,d)=>sum+d.lessons.length,0),14);
  assert.equal(catalog.data.domains.reduce((sum,d)=>sum+d.weight,0),100);
  assert.equal(catalog.data.domains.flatMap(d=>d.lessons).filter(l=>l.preview).length,1);
  const health=await request('/health');assert.equal(health.data.ok,true);

  const a=await request('/auth/register',{method:'POST',body:{name:'A Learner',email:'a@example.test',password:'long-password-1'}});
  assert.equal(a.status,201);const cookieA=a.cookie;assert.ok(cookieA);
  const duplicate=await request('/auth/register',{method:'POST',body:{name:'Other User',email:'a@example.test',password:'long-password-1'}});
  assert.equal(duplicate.status,409);
  assert.equal((await request('/lessons/d1-l2',{cookie:cookieA})).status,402);
  const lesson=await request('/lessons/d1-l1',{cookie:cookieA});assert.equal(lesson.status,200);assert.ok(lesson.data.lesson.body.join(' ').length>500);
  const saved=await request('/progress',{method:'POST',cookie:cookieA,body:{lessonId:'d1-l1'}});assert.equal(saved.status,200);
  assert.equal((await request('/progress',{cookie:cookieA})).data.lessons.length,1);
  const quiz=await request('/quiz/1');assert.equal(quiz.status,200);assert.equal(quiz.data.questions.length,3);
  assert.ok(!('answer' in quiz.data.questions[0]));
  const answerBody={domainId:1,answers:[{questionId:'q1',choice:1},{questionId:'q2',choice:0},{questionId:'q3',choice:2}]};
  const scored=await request('/quiz/submit',{method:'POST',cookie:cookieA,body:answerBody});
  assert.equal(scored.status,200);assert.equal(scored.data.score,2);assert.equal(scored.data.total,3);assert.ok(scored.data.detail[1].explanation);
  assert.match(scored.data.note,/not an official scaled score/);
  assert.equal((await request('/quiz/submit',{method:'POST',cookie:cookieA,body:{...answerBody,answers:answerBody.answers.slice(0,2)}})).status,400);
  assert.equal((await request('/billing')).data.configured,false);
  assert.equal((await request('/billing/checkout',{method:'POST',cookie:cookieA,body:{}})).status,503);
  assert.equal((await request('/tutor',{method:'POST',cookie:cookieA,body:{message:'Explain task decomposition'}})).data.code,'TUTOR_UNCONFIGURED');

  const b=await request('/auth/register',{method:'POST',body:{name:'Second Learner',email:'b@example.test',password:'another-long-password'}});
  const cookieB=b.cookie;assert.ok(cookieB);
  assert.equal((await request('/progress',{cookie:cookieB})).data.lessons.length,0);
  assert.equal((await request('/lessons/d1-l2',{cookie:cookieB})).status,402);
  const invalid=await request('/auth/login',{method:'POST',body:{email:'a@example.test',password:'wrong-password'}});
  assert.equal(invalid.status,401);
  const login=await request('/auth/login',{method:'POST',body:{email:'a@example.test',password:'long-password-1'}});
  assert.equal(login.status,200);assert.equal((await request('/session',{cookie:login.cookie})).data.user.email,'a@example.test');

  const bootstrap=await request('/admin/bootstrap',{method:'POST',cookie:login.cookie,body:{key:'test-bootstrap-key'}});
  assert.equal(bootstrap.status,200);assert.equal(bootstrap.data.user.role,'admin');
  assert.equal((await request('/admin/bootstrap',{method:'POST',cookie:login.cookie,body:{key:'test-bootstrap-key'}})).status,409);
  const allQuestions=await Promise.all(Array.from({length:7},(_,i)=>request(`/quiz/${i+1}`,{cookie:login.cookie})));
  assert.equal(allQuestions.reduce((sum,response)=>sum+response.data.questions.length,0),21);
  assert.ok(allQuestions.every(response=>response.data.questions.length===3));
  const adminList=await request('/admin/lessons',{cookie:login.cookie});assert.equal(adminList.status,200);assert.equal(adminList.data.lessons.length,14);
  const edited=await request('/admin/lessons/d1-l2',{method:'PUT',cookie:login.cookie,body:{title:'A maintained lesson title',body:['This edited teaching paragraph is intentionally substantive and clear for a learner.','A second paragraph explains the useful principle and how to practice it in an ordinary workplace context.'],exercise:'Write down one way to apply this idea to an actual work task.'}});
  assert.equal(edited.status,200);assert.equal(edited.data.lesson.title,'A maintained lesson title');
  assert.equal((await request('/admin/lessons',{cookie:cookieB})).status,403);

  const event={id:'evt_test_subscription_1',livemode:false,type:'customer.subscription.updated',data:{object:{id:'sub_test',customer:'cus_test',status:'active',items:{data:[{price:{id:'price_course_test'}}]},metadata:{userId:(await request('/session',{cookie:cookieB})).data.user.id}}}};
  async function deliver(value) {
    const bytes=JSON.stringify(value);const time=Math.floor(Date.now()/1000);
    const digest=createHmac('sha256','whsec_test_only').update(`${time}.${bytes}`).digest('hex');
    return fetch(`${origin}/api/billing/webhook`,{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':`t=${time},v1=${digest}`},body:bytes});
  }
  const liveEvent=await deliver({...event,id:'evt_live_rejected',livemode:true});
  assert.equal(liveEvent.status,400);
  assert.equal((await request('/lessons/d1-l2',{cookie:cookieB})).status,402);
  const unrelatedEvent=await deliver({...event,id:'evt_other_product',data:{object:{...event.data.object,items:{data:[{price:{id:'price_other'}}]}}}});
  assert.equal(unrelatedEvent.status,200);
  assert.equal((await unrelatedEvent.json()).ignored,true);
  assert.equal((await request('/lessons/d1-l2',{cookie:cookieB})).status,402);
  const raw=JSON.stringify(event);
  const timestamp=Math.floor(Date.now()/1000);
  const signature=createHmac('sha256','whsec_test_only').update(`${timestamp}.${raw}`).digest('hex');
  // Webhook signatures cover the exact request bytes.
  const rawResponse=await fetch(`${origin}/api/billing/webhook`,{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':`t=${timestamp},v1=${signature}`},body:raw});
  const rawData=await rawResponse.json();
  assert.equal(rawResponse.status,200,JSON.stringify(rawData));
  assert.equal((await request('/billing',{cookie:cookieB})).data.state,'active');
  assert.equal((await request('/lessons/d1-l2',{cookie:cookieB})).status,200);
  const duplicateEvent=await fetch(`${origin}/api/billing/webhook`,{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':`t=${timestamp},v1=${signature}`},body:raw});
  assert.equal((await duplicateEvent.json()).duplicate,true);
  const invalidSignature=await fetch(`${origin}/api/billing/webhook`,{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':'t=1,v1=bad'},body:raw});
  assert.equal(invalidSignature.status,400);
  const canceled=await deliver({...event,id:'evt_canceled',type:'customer.subscription.deleted'});
  assert.equal(canceled.status,200);
  assert.equal((await request('/lessons/d1-l2',{cookie:cookieB})).status,402);
});
