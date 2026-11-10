// server.js
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const SECRET = 'alam-secret-change-me-2026';
const db = new sqlite3.Database('alam.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT UNIQUE, password TEXT, balance REAL DEFAULT 0, isOwner INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS games(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, label TEXT, amount REAL, game_type TEXT, meta TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS requests(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, amount REAL, code TEXT, status TEXT DEFAULT 'pending', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS roulette_seats(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, spot INTEGER, user_id INTEGER, user_name TEXT, round INTEGER DEFAULT 1)`);
  db.run(`CREATE TABLE IF NOT EXISTS lottery_tickets(id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, owner_id INTEGER, owner_name TEXT, round INTEGER DEFAULT 1)`);
  db.run(`CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)`);
});

function auth(req,res,next){
  let t = req.headers.authorization;
  if(!t) return res.status(401).json({error:'سجل دخول'});
  try{ req.user = jwt.verify(t.replace('Bearer ',''), SECRET); next(); }
  catch{ return res.status(401).json({error:'توكن غلط'}); }
}
function adminOnly(req,res,next){
  if(!req.user.isOwner) return res.status(403).json({error:'للمالك فقط'});
  next();
}
function getSetting(key, def){
  return new Promise(resolve=>{
    db.get(`SELECT value FROM settings WHERE key=?`,[key],(e,r)=> resolve(r?JSON.parse(r.value):def));
  });
}
function setSetting(key,val){
  db.run(`INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)`,[key, JSON.stringify(val)]);
}

// ===== AUTH =====
app.post('/api/register', async (req,res)=>{
  const {name,email,pass}=req.body;
  if(!name||!email||!pass) return res.json({error:'اكمل الحقول'});
  const hash = await bcrypt.hash(pass,10);
  db.get(`SELECT COUNT(*) as c FROM users`,[],(e,row)=>{
    let isOwner = row.c===0?1:0;
    db.run(`INSERT INTO users(name,email,password,isOwner) VALUES(?,?,?,?)`,[name,email,hash,isOwner], function(err){
      if(err) return res.json({error:'الايميل مسجل'});
      let token = jwt.sign({id:this.lastID,email,isOwner},SECRET);
      res.json({token,name,email,isOwner,balance:0});
    });
  });
});
app.post('/api/login',(req,res)=>{
  const {email,pass}=req.body;
  db.get(`SELECT * FROM users WHERE email=?`,[email], async (e,u)=>{
    if(!u) return res.json({error:'ايميل او باسورد غلط'});
    let ok = await bcrypt.compare(pass,u.password);
    if(!ok) return res.json({error:'ايميل او باسورد غلط'});
    let token = jwt.sign({id:u.id,email:u.email,isOwner:u.isOwner},SECRET);
    res.json({token,name:u.name,email:u.email,isOwner:u.isOwner,balance:u.balance});
  });
});
app.get('/api/me',auth,(req,res)=>{
  db.get(`SELECT id,name,email,balance,isOwner FROM users WHERE id=?`,[req.user.id],(e,u)=>res.json(u));
});
app.get('/api/settings', async (req,res)=>{
  let s = {
    off: await getSetting('off',{}),
    prices: await getSetting('prices',{}),
    banner: await getSetting('banner',{text:'',on:false}),
    maint: await getSetting('maint',{on:false,text:''}),
    social: await getSetting('social',{tg:'',ig:'',fb:''})
  };
  res.json(s);
});

// ===== GAMES =====
app.post('/api/play-wheel',auth, async (req,res)=>{
  const {wheelId, wheelName, price, win} = req.body;
  let settings = await getSetting('prices',{});
  let realPrice = settings[wheelId+'_price'] ?? price;
  let realWin = settings[wheelId+'_win'] ?? win;
  let off = await getSetting('off',{});
  if(off[wheelId]) return res.json({error:'هاي العجلة مطفية'});
  db.get(`SELECT balance FROM users WHERE id=?`,[req.user.id],(e,u)=>{
    if(u.balance < realPrice) return res.json({error:'رصيدك ما يكفي'});
    let isWin = Math.random() < 0.30;
    let newBal = u.balance - realPrice + (isWin?realWin:0);
    db.run(`UPDATE users SET balance=? WHERE id=?`,[newBal,req.user.id]);
    db.run(`INSERT INTO games(user_id,label,amount,game_type,meta) VALUES(?,?,?,?,?)`,[req.user.id, isWin?'🏆 فوز '+wheelName:'😔 خسارة '+wheelName, isWin?realWin:-realPrice, 'wheel', wheelId]);
    res.json({win:isWin, amount:isWin?realWin:-realPrice, balance:newBal});
  });
});
app.get('/api/my-games',auth,(req,res)=>{
  db.all(`SELECT * FROM games WHERE user_id=? ORDER BY id DESC LIMIT 50`,[req.user.id],(e,rows)=>res.json(rows));
});

// ===== ROULETTE 100 =====
app.get('/api/roulette/:kind',auth,async (req,res)=>{
  let kind = req.params.kind;
  db.all(`SELECT * FROM roulette_seats WHERE kind=? ORDER BY spot ASC`,[kind],(e,rows)=>res.json(rows));
});
app.post('/api/roulette/:kind/join',auth, async (req,res)=>{
  let kind = req.params.kind;
  let prices = await getSetting('prices',{});
  let off = await getSetting('off',{});
  if(off['roulette_'+kind]) return res.json({error:'هذا الروليت مطفي'});
  let priceMap = {normal:1, medium:5, legend:10};
  let prizeMap = {normal:80, medium:400, legend:800};
  let price = prices['r_'+kind+'_price'] ?? priceMap[kind];
  let prize = prices['r_'+kind+'_win'] ?? prizeMap[kind];
  db.get(`SELECT * FROM users WHERE id=?`,[req.user.id],(e,u)=>{
    if(u.balance < price) return res.json({error:'رصيد ما يكفي'});
    db.all(`SELECT * FROM roulette_seats WHERE kind=?`,[kind],(e2,list)=>{
      if(list.find(x=>x.user_id===req.user.id)) return res.json({error:'انت مشترك اصلا'});
      if(list.length>=100) return res.json({error:'اكتمل العدد'});
      let spot = list.length+1;
      db.run(`UPDATE users SET balance=? WHERE id=?`,[u.balance-price, req.user.id]);
      db.run(`INSERT INTO roulette_seats(kind,spot,user_id,user_name) VALUES(?,?,?,?)`,[kind,spot,req.user.id,u.name]);
      db.run(`INSERT INTO games(user_id,label,amount,game_type,meta) VALUES(?,?,?,?,?)`,[req.user.id,'🎡 دخول روليت100 '+kind+' - مقعد '+spot,-price,'roulette',kind]);
      if(list.length+1>=100){
        // سحب فوري
        setTimeout(()=>{
          let winner = list[Math.floor(Math.random()*list.length)] || {user_id:req.user.id,user_name:u.name,spot};
          // نجيب كل المقاعد من جديد ونوزع
          db.all(`SELECT * FROM roulette_seats WHERE kind=?`,[kind],(e3,all)=>{
            if(!all.length) return;
            let w = all[Math.floor(Math.random()*all.length)];
            db.get(`SELECT balance FROM users WHERE id=?`,[w.user_id],(e4,wu)=>{
              if(wu) db.run(`UPDATE users SET balance=? WHERE id=?`,[wu.balance+prize,w.user_id]);
              db.run(`INSERT INTO games(user_id,label,amount,game_type,meta) VALUES(?,?,?,?,?)`,[w.user_id,'🏆 فوز روليت100 '+kind+' - مقعد '+w.spot,prize,'roulette',kind]);
            });
            db.run(`DELETE FROM roulette_seats WHERE kind=?`,[kind]);
          });
        },1000);
      }
      res.json({ok:true,spot,balance:u.balance-price});
    });
  });
});

// ===== LOTTERY =====
app.get('/api/lottery/my',auth,(req,res)=>{
  db.all(`SELECT * FROM lottery_tickets WHERE owner_id=?`,[req.user.id],(e,rows)=>res.json(rows));
});
app.post('/api/lottery/buy',auth,(req,res)=>{
  let qty = parseInt(req.body.qty)||1;
  db.get(`SELECT * FROM users WHERE id=?`,[req.user.id],(e,u)=>{
    if(u.balance < qty) return res.json({error:'رصيد ما يكفي'});
    db.run(`UPDATE users SET balance=? WHERE id=?`,[u.balance-qty, req.user.id]);
    for(let i=0;i<qty;i++){
      let code='TKT-'+Math.random().toString(36).substring(2,8).toUpperCase();
      db.run(`INSERT INTO lottery_tickets(code,owner_id,owner_name) VALUES(?,?,?)`,[code,req.user.id,u.name]);
    }
    db.run(`INSERT INTO games(user_id,label,amount,game_type) VALUES(?,?,?,?)`,[req.user.id,'🎟️ شراء '+qty+' تكت يانصيب',-qty,'lottery']);
    res.json({ok:true,balance:u.balance-qty});
  });
});
app.post('/api/lottery/draw',auth,adminOnly,(req,res)=>{
  db.all(`SELECT * FROM lottery_tickets`,[],(e,all)=>{
    if(all.length<5) return res.json({error:'لازم 5 تكيتات على الاقل'});
    let shuffled=[...all].sort(()=>Math.random()-0.5).slice(0,5);
    shuffled.forEach(w=>{
      db.get(`SELECT balance FROM users WHERE id=?`,[w.owner_id],(e2,uu)=>{
        if(uu) db.run(`UPDATE users SET balance=? WHERE id=?`,[uu.balance+50,w.owner_id]);
        db.run(`INSERT INTO games(user_id,label,amount,game_type) VALUES(?,?,?,?)`,[w.owner_id,'🏆 فوز يانصيب - تكت '+w.code,50,'lottery']);
      });
    });
    db.run(`DELETE FROM lottery_tickets`);
    res.json({ok:true,winners:shuffled});
  });
});

// ===== REQUESTS =====
app.post('/api/request',auth,(req,res)=>{
  const {type,amount,code}=req.body;
  db.run(`INSERT INTO requests(user_id,type,amount,code) VALUES(?,?,?,?)`,[req.user.id,type,amount,code],()=>res.json({ok:true}));
});

// ===== ADMIN =====
app.get('/api/admin/stats',auth,adminOnly,(req,res)=>{
  db.get(`SELECT COUNT(*) as users, COALESCE(SUM(balance),0) as totalBal FROM users`,[],(e,u)=>{
    db.get(`SELECT COALESCE(SUM(amount),0) as profit FROM games`,[],(e2,g)=>{
      db.get(`SELECT COALESCE(SUM(amount),0) as dep FROM requests WHERE type='deposit' AND status='approved'`,[],(e3,d)=>{
        db.get(`SELECT COALESCE(SUM(amount),0) as withd FROM requests WHERE type='withdraw' AND status='approved'`,[],(e4,w)=>{
          res.json({users:u.users,totalBal:u.totalBal,profit:g.profit,deposit:d.dep,withdraw:w.withd});
        });
      });
    });
  });
});
app.get('/api/admin/users',auth,adminOnly,(req,res)=>{
  let q=req.query.q||'';
  db.all(`SELECT id,name,email,balance,isOwner,created_at FROM users WHERE name LIKE ? OR email LIKE ? ORDER BY id DESC`,['%'+q+'%','%'+q+'%'],(e,rows)=>res.json(rows));
});
app.get('/api/admin/user/:id',auth,adminOnly,(req,res)=>{
  db.get(`SELECT id,name,email,balance,isOwner,created_at FROM users WHERE id=?`,[req.params.id],(e,u)=>{
    if(!u) return res.json({error:'ماكو'});
    db.all(`SELECT * FROM games WHERE user_id=? ORDER BY id DESC LIMIT 20`,[u.id],(e2,games)=>{
      db.all(`SELECT * FROM requests WHERE user_id=? ORDER BY id DESC LIMIT 20`,[u.id],(e3,reqs)=>{
        res.json({user:u,games,requests:reqs});
      });
    });
  });
});
app.post('/api/admin/add-balance',auth,adminOnly,(req,res)=>{
  db.run(`UPDATE users SET balance=balance+? WHERE id=?`,[req.body.amount,req.body.userId],()=>res.json({ok:true}));
});
app.post('/api/admin/ban',auth,adminOnly,(req,res)=>{
  db.run(`DELETE FROM users WHERE id=?`,[req.body.userId],()=>res.json({ok:true}));
});
app.get('/api/admin/requests',auth,adminOnly,(req,res)=>{
  db.all(`SELECT r.*,u.name,u.email FROM requests r JOIN users u ON u.id=r.user_id ORDER BY r.id DESC`,[],(e,rows)=>res.json(rows));
});
app.post('/api/admin/request-action',auth,adminOnly,(req,res)=>{
  const {id,action}=req.body;
  db.get(`SELECT * FROM requests WHERE id=?`,[id],(e,r)=>{
    if(!r) return res.json({error:'ماكو'});
    if(r.type==='deposit' && action==='approved'){
      db.run(`UPDATE users SET balance=balance+? WHERE id=?`,[r.amount,r.user_id]);
    }
    if(r.type==='withdraw' && action==='approved'){
      // السحب ينخصم وقت الطلب بالفرونت، هنا بس قبول
    }
    db.run(`UPDATE requests SET status=? WHERE id=?`,[action,id],()=>res.json({ok:true}));
  });
});
app.get('/api/admin/games',auth,adminOnly,(req,res)=>{
  let type=req.query.type||'';
  let sql=`SELECT g.*,u.name,u.email FROM games g JOIN users u ON u.id=g.user_id`;
  let params=[];
  if(type){ sql+=` WHERE g.game_type=?`; params=[type]; }
  sql+=` ORDER BY g.id DESC LIMIT 300`;
  db.all(sql,params,(e,rows)=>res.json(rows));
});
app.post('/api/admin/settings',auth,adminOnly,(req,res)=>{
  const {key,value}=req.body;
  setSetting(key,value);
  res.json({ok:true});
});
app.post('/api/admin/reset',auth,adminOnly,(req,res)=>{
  if(req.body.what==='roulette') db.run(`DELETE FROM roulette_seats`);
  if(req.body.what==='lottery') db.run(`DELETE FROM lottery_tickets`);
  if(req.body.what==='requests') db.run(`DELETE FROM requests`);
  res.json({ok:true});
});

app.get('*',(req,res)=>{ res.sendFile(path.join(__dirname,'public','index.html')); });
app.listen(3000,()=>console.log('Server on http://localhost:3000'));