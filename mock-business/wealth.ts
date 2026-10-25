import type {Express} from 'express';
/** Fictitious products and own-account transfers only. All money is integer fen. */
export function registerWealthMock(app:Express){
 let investmentFen=100000,fundingFen=500000,transferWrites=0,purchaseWrites=0;
 const receipts=new Map<string,{kind:string;signature:string;data:Record<string,unknown>}>();const calls:unknown[]=[];
 const record=(operation:string)=>{calls.push({operation,at:new Date().toISOString()});if(calls.length>1000)calls.shift();};
 const valid=(customer:unknown,product:unknown,amount:unknown)=>customer==='demo'&&product==='demo-wealth-a'&&Number.isSafeInteger(amount)&&Number(amount)>=100000&&Number(amount)<=1000000;
 const plan=(amount:number)=>({mock:true,productId:'demo-wealth-a',productName:'演示理财A（模拟产品）',amountFen:amount,availableFen:investmentFen,fundingFen,shortfallFen:Math.max(0,amount-investmentFen),canPurchase:investmentFen>=amount,summary:investmentFen>=amount?`模拟理财账户余额${investmentFen/100}元，可购买${amount/100}元。`:`模拟理财账户余额${investmentFen/100}元，购买${amount/100}元资金不足，需先转入${(amount-investmentFen)/100}元；转账与购买分别确认。`});
 app.get('/api/wealth/plan',(q,s)=>{record('plan');const {customerId,productId,amountFen}=q.query;const amount=Number(amountFen);if(!valid(customerId,productId,amount)){s.status(400).json({error:'INVALID_WEALTH_REQUEST'});return;}s.json(plan(amount));});
 for(const kind of ['transfer','purchase'])app.post('/api/wealth/'+(kind==='transfer'?'transfers':'purchases'),(q,s)=>{
  record(kind);const b=q.body??{},amount=b.amountFen,requested=kind==='transfer'?b.purchaseAmountFen:amount,key=b.idempotencyKey;
  if(!valid(b.customerId,b.productId,requested)||!Number.isSafeInteger(amount)||amount<=0||typeof key!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(key)||kind==='transfer'&&(b.fromAccount!=='funding'||b.toAccount!=='investment')){s.status(400).json({error:'INVALID_WEALTH_REQUEST'});return;}
  const signature=JSON.stringify({customer:b.customerId,product:b.productId,amount,requested,from:b.fromAccount,to:b.toAccount}),old=receipts.get(key);
  if(old){if(old.kind!==kind||old.signature!==signature){s.status(409).json({error:'IDEMPOTENCY_CONFLICT'});return;}s.json(old.data);return;}
  if(receipts.size>=1000){s.status(409).json({error:'MOCK_RETENTION_LIMIT'});return;}
  if(kind==='transfer'){
   if(amount!==Math.max(0,requested-investmentFen)){s.status(409).json({error:'SHORTFALL_CHANGED',plan:plan(requested)});return;}
   if(fundingFen<amount){s.status(409).json({error:'INSUFFICIENT_FUNDING'});return;}fundingFen-=amount;investmentFen+=amount;transferWrites++;
  }else{if(investmentFen<amount){s.status(409).json({error:'INSUFFICIENT_FUNDS',plan:plan(amount)});return;}investmentFen-=amount;purchaseWrites++;}
  const data={mock:true,status:'completed',idempotencyKey:key,orderId:kind+'-'+receipts.size,kind,amountFen:amount,investmentFen,fundingFen};receipts.set(key,{kind,signature,data});s.status(201).json(data);
 });
 app.get('/api/wealth/receipts/:key',(q,s)=>{record('receipt');const value=receipts.get(q.params.key);if(!value){s.status(404).json({error:'RECEIPT_NOT_FOUND'});return;}s.json(value.data);});
 app.get('/__mock/wealth',(_q,s)=>s.json({mock:true,investmentFen,fundingFen,transferWrites,purchaseWrites,receipts:[...receipts.values()].map(r=>r.data),calls}));
}
