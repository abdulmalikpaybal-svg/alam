require('dotenv').config();
const express=require('express'), mongoose=require('mongoose'), bcrypt=require('bcryptjs'), jwt=require('jsonwebtoken'), cors=require('cors');
const app=express(); app.use(cors()); app.use(express.json({limit:'15mb'}));
mongoose.connect(process.env.MONGO_URL).then(()=>console.log('✅ Mongo متصل'));
const SECRET=process.env.JWT_SECRET||'alam_secret';

const User=mongoose.model('User', new mongoose.Schema({name:String,email:{type:String,unique:true,lowercase:true},pass:String,myCode:{type:String,unique:true},invitedBy:String,balance:{type:Number,default:0},isOwner:{type:Boolean,default:false},role:{type:String,default:'user'},canReply:{type:Boolean,default:false},deviceId:String,isActive:{type:Boolean,default:true},profileImg:String,profileName:String,profileGender:String,profileGov:String,profilePhone:String,tele:String,wa:String,agentFullName:String,agentNick:String,agentGov:String,isVerifiedAgent:{type:Boolean,default:true},invites:[String],inviteEarnings:{type:Number,default:0},transferSent:{type:Number,default:0},createdAt:{type:Date,default:Date.now}}));
const Deposit=mongoose.model('Deposit', new mongoose.Schema({orderNo:String,email:String,name:String,amt:Number,tx:String,method:String,type:String,status:{type:String,default:'بانتظار ⏳'},time:{type:Number,default:Date.now},date:String}));
const Game=mongoose.model('Game', new mongoose.Schema({type:String,players:[{name:String,email:String,code:String,img:String,paid:Number}],status:{type:String,default:'open'},winnerIdx:Number,currentRot:Number,createdAt:{type:Number,default:Date.now}}));
const DailyCode=mongoose.model('DailyCode', new mongoose.Schema({code:String,email:String,name:String,paid:Number,date:String}));
const Transfer=mongoose.model('Transfer', new mongoose.Schema({from:String,fromEmail:String,to:String,toEmail:String,amt:Number,date:String,fromAgent:Boolean}));
const SupportMsg=mongoose.model('SupportMsg', new mongoose.Schema({fromEmail:String,fromName:String,forEmail:String,text:String,time:String,isStaff:Boolean,staffName:String,createdAt:{type:Number,default:Date.now}}));
const Ad=mongoose.model('Ad', new mongoose.Schema({title:String,img:String,link:String}));
const Setting=mongoose.model('Setting', new mongoose.Schema({key:String,value:String}));
const GamePrice=mongoose.model('GamePrice', new mongoose.Schema({gameId:String,price:Number,prize:Number}));

function genInvite(){while(true){let d=[];while(d.length<6){let x=Math.floor(Math.random()*10);if(!d.includes(x))d.push(x)}let c=d.join('');if(c[0]!=='0')return c}}
async function getDeviceLimit(){let s=await Setting.findOne({key:'device_limit'});return s?parseInt(s.value):3}
async function getPrice(id,defP,defPr){let p=await GamePrice.findOne({gameId:id});return{price:p?p.price:defP,prize:p?p.prize:defPr}}
function auth(req,res,next){let h=req.headers.authorization;if(!h)return res.status(401).json({error:'no_token'});try{req.userId=jwt.verify(h.replace('Bearer ',''),SECRET).id;next()}catch{return res.status(401).json({error:'bad_token'})}}
async function isOwnerReq(req){let u=await User.findById(req.userId);return u&&u.isOwner&&u.myCode==='1'}
function isBadName(n){let t=n.trim().toLowerCase();return t.includes('عالم الراحة')||t.includes('عالم الراحه')}
function isValidEmail(e){e=e.toLowerCase();return e.endsWith('@gmail.com')||e.endsWith('@yahoo.com')||e.endsWith('@hotmail.com')||e.endsWith('@icloud.com')}

// REGISTER - كود دعوة اجباري + حد اجهزة
app.post('/api/register',async(req,res)=>{
  try{
    let {name,email,pass,inviteCode,deviceId}=req.body; email=email.toLowerCase().trim(); name=name.trim();
    if(!name||!email||!pass) return res.json({error:'empty'});
    if(isBadName(name)) return res.json({error:'bad_name',msg:'هذا الاسم ماينقبل'});
    if(!isValidEmail(email)) return res.json({error:'bريدك غلط',msg:'اكتب بريد صحيح'});
    if(pass.length<6) return res.json({error:'short'});
    let count=await User.countDocuments();
    if(count===0){let hash=await bcrypt.hash(pass,10);let u=new User({name,email,pass:hash,myCode:'1',invitedBy:'مالك',balance:0,isOwner:true,role:'owner',canReply:true,deviceId,profileName:name});await u.save();let token=jwt.sign({id:u._id},SECRET);return res.json({ok:true,token,user:u})}
    if(!inviteCode||!inviteCode.trim()) return res.json({error:'invite_empty',msg:'اكتب كود الدعوة الخاص بصديقك'});
    let owner=await User.findOne({myCode:inviteCode.trim()}); if(!owner) return res.json({error:'invite_wrong',msg:'رمز الدعوة غلط'});
    if(await User.findOne({email})) return res.json({error:'bريدك غلط',msg:'هذا البريد مسجل'});
    let limit=await getDeviceLimit(); let devCount=await User.countDocuments({deviceId});
    if(devCount>=limit) return res.json({error:'device_limit',msg:`هذا الجهاز مسوي ${devCount} حسابات - الحد ${limit}`});
    let hash=await bcrypt.hash(pass,10); let myCode=genInvite(); while(await User.findOne({myCode})) myCode=genInvite();
    let u=new User({name,email,pass:hash,myCode,invitedBy:inviteCode,balance:0.02,deviceId,profileName:name}); await u.save();
    owner.invites.push(email); owner.balance=parseFloat((owner.balance+0.02).toFixed(2)); owner.inviteEarnings=parseFloat(((owner.inviteEarnings||0)+0.02).toFixed(2)); await owner.save();
    let token=jwt.sign({id:u._id},SECRET); res.json({ok:true,token,user:u});
  }catch(e){res.json({error:e.message})}
});
app.post('/api/login',async(req,res)=>{
  let {email,pass}=req.body; email=email.toLowerCase().trim();
  if(!isValidEmail(email)) return res.json({error:'bريدك غلط'});
  let u=await User.findOne({email}); if(!u) return res.json({error:'bريدك غلط'});
  if(!await bcrypt.compare(pass,u.pass)) return res.json({error:'كلمة السر غير صحيحه'});
  let token=jwt.sign({id:u._id},SECRET); res.json({ok:true,token,user:u});
});
app.get('/api/me',auth,async(req,res)=>{res.json(await User.findById(req.userId).select('-pass'))});

// ADMIN - اجهزة + مستخدمين + احصائيات
app.get('/api/admin/device-info',auth,async(req,res)=>{if(!await isOwnerReq(req))return res.json({error:'no_perm'});let users=await User.find().select('name myCode deviceId email');let groups={};users.forEach(u=>{let d=u.deviceId||'قديم';if(!groups[d])groups[d]=[];groups[d].push(u)});res.json({limit:await getDeviceLimit(),groups,total:users.length})});
app.post('/api/admin/device-limit',auth,async(req,res)=>{if(!await isOwnerReq(req))return res.json({error:'no_perm'});await Setting.updateOne({key:'device_limit'},{key:'device_limit',value:String(req.body.limit)},{upsert:true});res.json({ok:true})});
app.get('/api/admin/users',auth,async(req,res)=>{if(!await isOwnerReq(req))return res.json({error:'no_perm'});let q=req.query.q||'';let f={};if(q)f={$or:[{name:{$regex:q,$options:'i'}},{email:{$regex:q,$options:'i'}},{myCode:q}]};res.json(await User.find(f).select('-pass').sort({createdAt:-1}).limit(200))});
app.post('/api/admin/user/edit',auth,async(req,res)=>{if(!await isOwnerReq(req))return res.json({error:'no_perm'});let {email,name,myCode,pass,phone,tele,gov,gender,nick,verified,role,isActive}=req.body;let u=await User.findOne({email});if(!u)return res.json({error:'not_found'});if(name){u.name=name;u.agentFullName=name;u.profileName=name}if(myCode)u.myCode=myCode;if(pass)u.pass=await bcrypt.hash(pass,10);if(phone!==undefined){u.profilePhone=phone;u.wa=phone}if(tele!==undefined)u.tele=tele;if(gov!==undefined){u.agentGov=gov;u.profileGov=gov}if(gender!==undefined)u.profileGender=gender;if(nick!==undefined)u.agentNick=nick;if(verified!==undefined)u.isVerifiedAgent=verified;if(role)u.role=role;if(isActive!==undefined)u.isActive=isActive;await u.save();res.json({ok:true})});
app.post('/api/admin/user/money',auth,async(req,res)=>{if(!await isOwnerReq(req))return res.json({error:'no_perm'});let u=await User.findOne({email:req.body.email});u.balance=parseFloat((u.balance+(req.body.op==='add'?req.body.amt:-req.body.amt)).toFixed(2));if(u.balance<0)u.balance=0;await u.save();res.json({ok:true})});
app.post('/api/admin/user/delete',auth,async(req,res)=>{if(!await isOwnerReq(req))return res.json({error:'no_perm'});await User.deleteOne({email:req.body.email});res.json({ok:true})});
app.post('/api/admin/create-99',auth,async(req,res)=>{if(!await isOwnerReq(req))return res.json({error:'no_perm'});let names=['احمد','علي','حسين','مصطفى','عمر','يوسف','فاطمة','زينب'];let govs=['بغداد','البصرة','نينوى','الأنبار','صلاح الدين'];let c=0;for(let i=1;i<=99;i++){let em='test'+i+'@gmail.com';if(await User.findOne({email:em}))continue;let hash=await bcrypt.hash('123456',10);let myCode=genInvite();while(await User.findOne({myCode}))myCode=genInvite();await new User({name:names[i%names.length]+' تيست '+i,email:em,pass:hash,myCode,invitedBy:'1',balance:parseFloat((Math.random()*80+10).toFixed(2)),role:'user',profileName:names[i%names.length],profileGender:i%2?'ذكر':'انثى',profileGov:govs[i%govs.length],profilePhone:'0770'+(1000000+i),deviceId:'test-device-'+(i%5),isActive:true}).save();c++}res.json({ok:true,created:c})});

// DEPOSIT
app.post('/api/deposit',auth,async(req,res)=>{let u=await User.findById(req.userId);let {amt,tx,method,type}=req.body;if(amt<10)return res.json({error:'min_10'});if(type==='سحب'&&u.balance<amt)return res.json({error:'no_balance'});let orderNo='#'+(1001+await Deposit.countDocuments());await new Deposit({orderNo,email:u.email,name:u.name,amt,tx,method,type,date:new Date().toLocaleString('ar-IQ')}).save();res.json({ok:true,orderNo})});
app.get('/api/my-deposits',auth,async(req,res)=>{let u=await User.findById(req.userId);res.json(await Deposit.find({email:u.email}).sort({time:-1}))});
app.get('/api/admin/deposits',auth,async(req,res)=>{if(!await isOwnerReq(req))return res.json({error:'no_perm'});res.json(await Deposit.find().sort({time:-1}))});
app.post('/api/admin/deposit/:id/:action',auth,async(req,res)=>{if(!await isOwnerReq(req))return res.json({error:'no_perm'});let d=await Deposit.findById(req.params.id);let u=await User.findOne({email:d.email});if(req.params.action==='approve'){if(d.type==='ايداع')u.balance=parseFloat((u.balance+d.amt).toFixed(2));else u.balance=parseFloat((u.balance-d.amt).toFixed(2));await u.save();d.status='تم ✅'}else d.status='مرفوض ❌';await d.save();res.json({ok:true})});

// GAMES
const CFG={r1:{price:1,prize:4,slots:5},r2:{price:2,prize:8,slots:5},r3:{price:5,prize:20,slots:5},r4:{price:10,prize:40,slots:5},r5:{price:20,prize:80,slots:5},r100_1:{price:1,prize:80,max:100},r100_2:{price:5,prize:400,max:100},r100_3:{price:10,prize:800,max:100},vip50:{price:1,prize:40,max:50,multi:true},vip100:{price:1,prize:90,max:100,multi:true}};
app.get('/api/game/:typeId',async(req,res)=>{let g=await Game.findOne({type:req.params.typeId,status:{$in:['open','countdown']}}).sort({createdAt:-1});if(!g)g={type:req.params.typeId,players:[],status:'open'};let cfg=CFG[req.params.typeId];let pr=await getPrice(req.params.typeId,cfg.price,cfg.prize);res.json({...g.toObject?.()||g,...pr})});
app.post('/api/game/join',auth,async(req,res)=>{let u=await User.findById(req.userId);let {typeId}=req.body;let cfg=CFG[typeId];let pr=await getPrice(typeId,cfg.price,cfg.prize);let max=cfg.slots||cfg.max;if(u.balance<pr.price)return res.json({error:'no_balance'});let g=await Game.findOne({type:typeId,status:'open'});if(!g)g=new Game({type:typeId,players:[]});if(!cfg.multi&&g.players.find(p=>p.email===u.email))return res.json({error:'already'});if(g.players.length>=max)g=new Game({type:typeId,players:[]});u.balance=parseFloat((u.balance-pr.price).toFixed(2));await u.save();g.players.push({name:u.name,email:u.email,code:u.myCode,img:u.profileImg||'',paid:pr.price});if(g.players.length>=max){g.status='countdown';g.winnerIdx=Math.floor(Math.random()*g.players.length);let seg=360/max;g.currentRot=360*5+(360-(g.winnerIdx*seg+seg/2));await g.save();setTimeout(async()=>{let gg=await Game.findById(g._id);if(!gg)return;let win=gg.players[gg.winnerIdx];let wu=await User.findOne({email:win.email});if(wu){wu.balance=parseFloat((wu.balance+pr.prize).toFixed(2));await wu.save()}await Game.findByIdAndDelete(g._id)},4000)}await g.save();res.json({ok:true,game:g,balance:u.balance})});
app.post('/api/admin/game/refund',auth,async(req,res)=>{if(!await isOwnerReq(req))return res.json({error:'no_perm'});let games=await Game.find({type:req.body.typeId});for(let g of games)for(let p of g.players){let u=await User.findOne({email:p.email});if(u){u.balance=parseFloat((u.balance+p.paid).toFixed(2));await u.save()}}await Game.deleteMany({type:req.body.typeId});res.json({ok:true})});
app.post('/api/admin/game/price',auth,async(req,res)=>{if(!await isOwnerReq(req))return res.json({error:'no_perm'});await GamePrice.updateOne({gameId:req.body.gameId},{gameId:req.body.gameId,price:req.body.price,prize:req.body.prize},{upsert:true});res.json({ok:true})});

// DAILY ALAM
function genALAM(){let ch='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',s='';for(let i=0;i<5;i++)s+=ch[Math.floor(Math.random()*ch.length)];return 'ALAM-'+s}
app.post('/api/daily/buy',auth,async(req,res)=>{let u=await User.findById(req.userId);let count=Math.min(9999,Math.max(1,req.body.count||1));if(u.balance<count)return res.json({error:'no_balance'});u.balance=parseFloat((u.balance-count).toFixed(2));await u.save();let codes=[];for(let i=0;i<count;i++){let c=genALAM();while(await DailyCode.findOne({code:c}))c=genALAM();codes.push({code:c,email:u.email,name:u.name,paid:1,date:new Date().toLocaleString('ar-IQ')})}await DailyCode.insertMany(codes);res.json({ok:true,codes,balance:u.balance})});
app.post('/api/daily/draw',auth,async(req,res)=>{if(!await isOwnerReq(req))return res.json({error:'no_perm'});let codes=await DailyCode.find();if(codes.length<5)return res.json({error:'need_5'});let pool=[...codes],wins=[];for(let i=0;i<5;i++)wins.push(pool.splice(Math.floor(Math.random()*pool.length),1)[0]);for(let w of wins){let u=await User.findOne({email:w.email});if(u){u.balance=parseFloat((u.balance+50).toFixed(2));await u.save()}}await DailyCode.deleteMany({});res.json({ok:true,winners:wins})});
app.get('/api/daily/my',auth,async(req,res)=>{let u=await User.findById(req.userId);res.json(await DailyCode.find({email:u.email}))});

// TRANSFER + SUPPORT + AGENTS + ADS + SETTINGS
app.post('/api/transfer',auth,async(req,res)=>{let me=await User.findById(req.userId);let to=await User.findOne({myCode:req.body.code});if(!to)return res.json({error:'no_user'});if(me.balance<req.body.amt||req.body.amt<1)return res.json({error:'no_balance'});me.balance=parseFloat((me.balance-req.body.amt).toFixed(2));me.transferSent++;to.balance=parseFloat((to.balance+req.body.amt).toFixed(2));await me.save();await to.save();await new Transfer({from:me.name,fromEmail:me.email,to:to.name,toEmail:to.email,amt:req.body.amt,date:new Date().toLocaleString('ar-IQ'),fromAgent:me.role==='agent'||me.isOwner}).save();res.json({ok:true,balance:me.balance})});
app.post('/api/support/send',auth,async(req,res)=>{let u=await User.findById(req.userId);let isStaff=u.isOwner||u.role==='support'||u.canReply;let target=(isStaff&&req.body.forEmail)?req.body.forEmail:u.email;await new SupportMsg({fromEmail:u.email,fromName:u.name,forEmail:target,text:req.body.text,time:new Date().toLocaleString('ar-IQ'),isStaff:isStaff&&!!req.body.forEmail,staffName:isStaff?u.name:null}).save();res.json({ok:true})});
app.get('/api/support/list',auth,async(req,res)=>{let u=await User.findById(req.userId);let isStaff=u.isOwner||u.role==='support'||u.canReply;if(isStaff)res.json(await SupportMsg.find().sort({createdAt:1}));else res.json(await SupportMsg.find({forEmail:u.email}).sort({createdAt:1}))});
app.get('/api/agents',async(req,res)=>{res.json(await User.find({role:'agent'}).select('-pass'))});
app.get('/api/ads',async(req,res)=>{res.json(await Ad.find())});
app.post('/api/admin/ad',auth,async(req,res)=>{if(!await isOwnerReq(req))return res.json({error:'no_perm'});await new Ad(req.body).save();res.json({ok:true})});
app.get('/api/settings',async(req,res)=>{let a=await Setting.find();let o={};a.forEach(s=>o[s.key]=s.value);res.json(o)});
app.post('/api/admin/settings',auth,async(req,res)=>{if(!await isOwnerReq(req))return res.json({error:'no_perm'});for(let k in req.body)await Setting.updateOne({key:k},{key:k,value:String(req.body[k])},{upsert:true});res.json({ok:true})});
app.listen(process.env.PORT||3000,()=>console.log('🚀 شغال على '+(process.env.PORT||3000)));