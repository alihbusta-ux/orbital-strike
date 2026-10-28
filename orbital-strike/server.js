const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  fs.readFile(path.join(__dirname, 'public', 'index.html'), (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });
const rooms = new Map();

const rnd = (a,b) => Math.floor(Math.random()*(b-a+1))+a;
const pick = a => a[Math.floor(Math.random()*a.length)];
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function fmt(a,b){
  if(b===0) return String(a);
  if(a===0){ if(b===1) return 'i'; if(b===-1) return '-i'; return b+'i'; }
  const ba=Math.abs(b), bs=ba===1?'':ba;
  return `${a} ${b>0?'+':'-'} ${bs}i`;
}
const QGENS = {
  ipow(){ const n=rnd(2,120), correct=['1','i','-1','-i'][n%4]; const opts=shuffle(['1','i','-1','-i']); return {sig:`ipow_${n}`,prompt:`i<sup>${n}</sup> = ?`,options:opts,correctIdx:opts.indexOf(correct)}; },
  add(){ const a=rnd(-9,9),b=rnd(-9,9),c=rnd(-9,9),d=rnd(-9,9); const correct=fmt(a+c,b+d); const w=[fmt(a+c,b-d),fmt(a-c,b+d),fmt(a*c,b*d)].filter(x=>x!==correct); const opts=shuffle([correct,...w]); return {sig:`add_${a}_${b}_${c}_${d}`,prompt:`(${fmt(a,b)}) + (${fmt(c,d)}) = ?`,options:opts,correctIdx:opts.indexOf(correct)}; },
  sub(){ const a=rnd(-9,9),b=rnd(-9,9),c=rnd(-9,9),d=rnd(-9,9); const correct=fmt(a-c,b-d); const w=[fmt(a-c,b+d),fmt(a+c,b-d),fmt(a-c+1,b-d)].filter(x=>x!==correct); const opts=shuffle([correct,...w]); return {sig:`sub_${a}_${b}_${c}_${d}`,prompt:`(${fmt(a,b)}) - (${fmt(c,d)}) = ?`,options:opts,correctIdx:opts.indexOf(correct)}; },
  mul(){ const a=rnd(-6,6),b=rnd(-6,6),c=rnd(-6,6),d=rnd(-6,6); const correct=fmt(a*c-b*d,a*d+b*c); const w=[fmt(a*c+b*d,a*d+b*c),fmt(a*c-b*d,a*d-b*c),fmt(a*c-b*d+1,a*d+b*c)].filter(x=>x!==correct); const opts=shuffle([correct,...w]); return {sig:`mul_${a}_${b}_${c}_${d}`,prompt:`(${fmt(a,b)})(${fmt(c,d)}) = ?`,options:opts,correctIdx:opts.indexOf(correct)}; },
  square(){ const a=rnd(-5,5),b=rnd(-5,5); const correct=fmt(a*a-b*b,2*a*b); const w=[fmt(a*a+b*b,2*a*b),fmt(a*a-b*b,a*b),fmt(a*a-b*b+1,2*a*b)].filter(x=>x!==correct); const opts=shuffle([correct,...w]); return {sig:`sq_${a}_${b}`,prompt:`(${fmt(a,b)})<sup>2</sup> = ?`,options:opts,correctIdx:opts.indexOf(correct)}; },
  div(){ const p=rnd(-5,5),q=rnd(-5,5),c=rnd(1,5),d=rnd(1,5); const a=p*c-q*d, b=p*d+q*c; const correct=fmt(p,q); const w=[fmt(p,-q),fmt(-p,q),fmt(p+1,q)].filter(x=>x!==correct); const opts=shuffle([correct,...w]); return {sig:`div_${a}_${b}_${c}_${d}`,prompt:`(${fmt(a,b)}) / (${fmt(c,d)}) = ?`,options:opts,correctIdx:opts.indexOf(correct)}; },
  findxy(){ const x=rnd(-5,5),y=rnd(-5,5),a=rnd(1,6),c=rnd(1,6),b=rnd(-10,10),d=rnd(-10,10); const e=a*x+b,f=c*y+d; const correct=`x=${x}, y=${y}`; const w=[`x=${y}, y=${x}`,`x=${x+1}, y=${y}`,`x=${x}, y=${y+1}`].filter(z=>z!==correct); const opts=shuffle([correct,...w]); return {sig:`findxy_${x}_${y}_${a}_${c}_${b}_${d}`,prompt:`(${a}x ${b>=0?'+':'-'} ${Math.abs(b)}) + (${c}y ${d>=0?'+':'-'} ${Math.abs(d)})i = ${e} ${f>=0?'+':'-'} ${Math.abs(f)}i<br><small>Find x and y</small>`,options:opts,correctIdx:opts.indexOf(correct)}; },
  sqrt(){ const k=rnd(2,12),n=k*k,correct=`${k}i`; const w=[`-${k}i`,String(k),`-${k}`].filter(z=>z!==correct); const opts=shuffle([correct,...w]); return {sig:`sqrt_${n}`,prompt:`&radic;(-${n}) = ?`,options:opts,correctIdx:opts.indexOf(correct)}; },
  voltage(){ const a=rnd(-8,8),b=rnd(-8,8),c=rnd(-8,8),d=rnd(-8,8); const correct=fmt(a*c-b*d,a*d+b*c); const w=[fmt(a*c+b*d,a*d+b*c),fmt(a*c-b*d+1,a*d+b*c),fmt(a*c-b*d,a*d+b*c+1)].filter(z=>z!==correct); const opts=shuffle([correct,...w]); return {sig:`volt_${a}_${b}_${c}_${d}`,prompt:`V = I&middot;R<br>I = ${fmt(a,b)} A, R = ${fmt(c,d)} &Omega;<br>Find V:`,options:opts,correctIdx:opts.indexOf(correct)}; }
};

function generateRound(players){
  const key = pick(Object.keys(QGENS)), gen = QGENS[key];
  const seen = new Set(), questions = {};
  for(const p of players){
    let q; for(let i=0;i<200;i++){ q=gen(); if(!seen.has(q.sig)) break; }
    seen.add(q.sig); questions[p.id] = q;
  }
  return { type:key, questions };
}

class Room {
  constructor(pin){
    this.pin = pin; this.players = new Map(); this.teacher = null;
    this.phase = 'lobby'; this.missiles = []; this.questionRound = null;
    this.nextPauseAt = 0; this.autoPauseEnabled = true; this.pauseCheckInterval = null;
  }
  broadcast(msg){ const s=JSON.stringify(msg); for(const p of this.players.values()) if(p.ws.readyState===1) p.ws.send(s); if(this.teacher&&this.teacher.readyState===1) this.teacher.send(s); }
  broadcastPlayers(msg){ const s=JSON.stringify(msg); for(const p of this.players.values()) if(p.ws.readyState===1) p.ws.send(s); }
  sendTo(id,msg){ const p=this.players.get(id); if(p&&p.ws.readyState===1) p.ws.send(JSON.stringify(msg)); }
  sendTeacher(msg){ if(this.teacher&&this.teacher.readyState===1) this.teacher.send(JSON.stringify(msg)); }
  playerListMsg(){ return {type:'playerList', players:[...this.players.values()].map(p=>({id:p.id,name:p.name,kills:p.kills,correct:p.correct,hp:p.hp,maxHp:p.maxHp,alive:p.alive,frozen:p.frozen}))}; }
  
  startGame(){
    if(this.players.size<1) { console.log("StartGame aborted: No players."); return; }
    
    let radius = 15000;
    if (this.players.size <= 5) radius = 4000;
    else if (this.players.size <= 10) radius = 7000;
    else if (this.players.size <= 20) radius = 11000;

    this.phase='playing'; const n=this.players.size; let i=0;
    for(const p of this.players.values()){
      const angle=(i/n)*Math.PI*2, hx=Math.cos(angle)*radius, hz=Math.sin(angle)*radius;
      const q=THREE_q_lookAt(hx,0,hz,0,0,0);
      
      p.hangar={x:hx,z:hz,qx:q.x,qy:q.y,qz:q.z,qw:q.w,hp:1500,maxHp:1500,alive:true};
      p.pos={x:hx,y:0,z:hz}; p.quat=q; p.hp=300; p.maxHp=300; p.alive=true; p.frozen=false;
      p.kills=0; p.correct=0; p.missileDamage=35; p.respawnAt=0; i++;
    }
    this.scheduleNextPause();
    this.broadcast({type:'gameStart', hangars:this.hangarData(), nextPauseAt: this.nextPauseAt});
    this.sendTeacher(this.playerListMsg()); 
  }
  hangarData(){ const out={}; for(const p of this.players.values()){ if(p.hangar) out[p.id]={x:p.hangar.x,z:p.hangar.z,qx:p.hangar.qx,qy:p.hangar.qy,qz:p.hangar.qz,qw:p.hangar.qw,hp:p.hangar.hp,maxHp:p.hangar.maxHp}; } return out; }
  
  scheduleNextPause(){ this.nextPauseAt=Date.now()+60000; }
  
  triggerQuestion(manual){
    if(this.players.size===0) return;
    if (manual) this.phase = 'playing'; // Force override if stuck
    
    const playersArr=[...this.players.values()], {type,questions}=generateRound(playersArr);
    this.questionRound={type,questions,startedAt:Date.now(),manual:!!manual}; this.phase='question';
    for(const p of playersArr){ p.frozen=true; const q=questions[p.id]; this.sendTo(p.id,{type:'question',qid:Date.now(),prompt:q.prompt,options:q.options}); }
    this.sendTeacher({type:'questionStarted',qtype:type,manual:!!manual,count:playersArr.length}); this.sendTeacher(this.playerListMsg());
  }
  endQuestionRound(){
    if(this.phase!=='question') return;
    for(const p of this.players.values()) p.frozen=false;
    this.phase='playing'; this.questionRound=null;
    this.scheduleNextPause();
    this.broadcast({type:'questionEnd', nextPauseAt: this.nextPauseAt}); 
    this.sendTeacher({type:'questionEnded'}); 
  }
  applyUpgrade(p){
    const choice=pick(['hangar','missile','ship']);
    if(choice==='hangar'&&p.hangar){ p.hangar.hp=p.hangar.maxHp; this.sendTo(p.id,{type:'upgrade',upgrade:'hangar',msg:'Base Hangar healed!'}); this.broadcastPlayers({type:'hangarHP',id:p.id,hp:p.hangar.hp,maxHp:p.hangar.maxHp}); }
    else if(choice==='missile'){ p.missileDamage=Math.min(100, p.missileDamage+15); this.sendTo(p.id,{type:'upgrade',upgrade:'missile',msg:`Missiles upgraded! (${p.missileDamage} dmg)`}); }
    else { p.hp=p.maxHp; this.sendTo(p.id,{type:'upgrade',upgrade:'ship',msg:'Ship shields restored!'}); this.sendTo(p.id,{type:'hp',hp:p.hp,maxHp:p.maxHp}); }
  }
}
function THREE_q_lookAt(px,py,pz,tx,ty,tz){
  const fx=tx-px,fy=ty-py,fz=tz-pz,fl=Math.hypot(fx,fy,fz),dx=fx/fl,dy=fy/fl,dz=fz/fl,yaw=Math.atan2(dx,dz),pitch=Math.asin(-dy);
  const cy=Math.cos(yaw/2),sy=Math.sin(yaw/2),cp=Math.cos(pitch/2),sp=Math.sin(pitch/2);
  return {x:sy*cp,y:cy*sp,z:-sy*sp,w:cy*cp};
}

wss.on('connection', ws => {
  ws.state={room:null,id:null,isTeacher:false};
  ws.on('message', raw => {
    let msg; try{msg=JSON.parse(raw);}catch(e){return;}
    const st=ws.state, room=st.room?rooms.get(st.room):null;

    if(msg.type==='createRoom'){
      let pin; do{pin=String(rnd(100000,999999));}while(rooms.has(pin));
      const r=new Room(pin); r.teacher=ws; rooms.set(pin,r); st.room=pin; st.isTeacher=true;
      ws.send(JSON.stringify({type:'roomCreated',pin}));
      r.pauseCheckInterval=setInterval(()=>{ if(r.phase==='playing'&&r.autoPauseEnabled&&Date.now()>=r.nextPauseAt) r.triggerQuestion(false); },1000);
      console.log(`Room created: ${pin}`);
      return;
    }
    if(msg.type==='join'){
      const r=rooms.get(String(msg.pin));
      if(!r||r.phase!=='lobby'){ ws.send(JSON.stringify({type:'joinError',error:'Invalid PIN or game already started'})); return; }
      const id=crypto.randomBytes(6).toString('hex');
      const player={id,name:String(msg.name||'Pilot').slice(0,20),ws,pos:{x:0,y:0,z:0},quat:{x:0,y:0,z:0,w:1},vel:{x:0,y:0,z:0},hp:300,maxHp:300,alive:true,frozen:false,kills:0,correct:0,missileDamage:35,hangar:null,lastShot:0,respawnAt:0};
      r.players.set(id,player); st.room=String(msg.pin); st.id=id;
      ws.send(JSON.stringify({type:'joined',id,pin:r.pin,name:player.name}));
      r.broadcastPlayers(r.playerListMsg()); r.sendTeacher(r.playerListMsg()); 
      console.log(`Player ${player.name} joined room ${r.pin}`);
      return;
    }
    
    if(!room) return;
    const me=st.id ? room.players.get(st.id) : null;

    if(msg.type==='state'&&me){ if(me.frozen||!me.alive) return; me.pos=msg.pos; me.quat=msg.quat; me.vel=msg.vel; return; }
    if(msg.type==='fire'&&me&&room.phase!=='lobby'&&room.phase!=='ended'){
      if(me.frozen||!me.alive) return; const now=Date.now(); if(now-me.lastShot<300) return; me.lastShot=now;
      const m={id:crypto.randomBytes(4).toString('hex'),owner:me.id,pos:msg.pos,dir:msg.dir,speed:1600,life:7,damage:me.missileDamage};
      room.missiles.push(m);
      const msgOut=JSON.stringify({type:'missileSpawn',id:m.id,owner:m.owner,pos:m.pos,dir:m.dir});
      for(const p of room.players.values()) if(p.id!==me.id&&p.ws.readyState===1) p.ws.send(msgOut);
      return;
    }
    if(msg.type==='answer'&&me&&room.questionRound){
      const q=room.questionRound.questions[me.id]; if(!q) return;
      if(msg.choice===q.correctIdx){
        me.frozen=false; me.correct++; room.applyUpgrade(me); room.sendTo(me.id,{type:'answerResult',correct:true}); room.sendTeacher(room.playerListMsg());
        let all=true; for(const p of room.players.values()) if(p.frozen){all=false;break;}
        if(all) room.endQuestionRound();
      } else room.sendTo(me.id,{type:'answerResult',correct:false});
      return;
    }
    if(st.isTeacher&&room){
      console.log("Teacher command received:", msg.type);
      if(msg.type==='startGame') room.startGame();
      if(msg.type==='endGame'){ room.phase='ended'; room.broadcast({type:'gameEnd',players:[...room.players.values()].map(p=>({name:p.name,kills:p.kills,correct:p.correct}))}); }
      if(msg.type==='forceQuestion') room.triggerQuestion(true);
      if(msg.type==='endQuestion') room.endQuestionRound();
      if(msg.type==='kick'){ const p=room.players.get(msg.id); if(p){p.ws.send(JSON.stringify({type:'kicked'}));p.ws.close();room.players.delete(msg.id);room.broadcastPlayers(room.playerListMsg());room.sendTeacher(room.playerListMsg());} }
      if(msg.type==='toggleAutoPause') room.autoPauseEnabled=!!msg.enabled;
    }
  });
  ws.on('close',()=>{
    const st=ws.state; if(!st.room) return; const room=rooms.get(st.room); if(!room) return;
    if(st.isTeacher){ room.broadcastPlayers({type:'roomClosed'}); if(room.pauseCheckInterval) clearInterval(room.pauseCheckInterval); rooms.delete(st.room); return; }
    if(st.id&&room.players.has(st.id)){ room.players.delete(st.id); room.broadcastPlayers({type:'playerLeft',id:st.id}); room.broadcastPlayers(room.playerListMsg()); room.sendTeacher(room.playerListMsg()); }
  });
});

let serverTick = 0;
setInterval(()=>{
  serverTick++;
  for(const room of rooms.values()){
    if(room.phase==='lobby'||room.phase==='ended') continue;
    
    const states=[]; 
    for(const p of room.players.values()) states.push({id:p.id,pos:p.pos,quat:p.quat,hp:p.hp,alive:p.alive});
    room.broadcastPlayers({type:'states',players:states});
    
    if (serverTick % 20 === 0) {
      room.broadcastPlayers(room.playerListMsg());
    }

    const dt=0.05;
    for(let i=room.missiles.length-1;i>=0;i--){
      const m=room.missiles[i]; m.life-=dt; let hit=false; const sub=4;
      for(let s=0;s<sub&&!hit;s++){
        m.pos.x+=m.dir.x*m.speed*dt/sub; m.pos.y+=m.dir.y*m.speed*dt/sub; m.pos.z+=m.dir.z*m.speed*dt/sub;
        
        for(const p of room.players.values()){
          if(p.id===m.owner||!p.alive||p.frozen) continue;
          const dx=p.pos.x-m.pos.x,dy=p.pos.y-m.pos.y,dz=p.pos.z-m.pos.z;
          if(dx*dx+dy*dy+dz*dz<3600){
            p.hp-=m.damage; if(p.hp<=0){ p.alive=false; p.respawnAt=Date.now()+3000; const sh=room.players.get(m.owner); if(sh) sh.kills++; room.broadcast({type:'explosion',x:p.pos.x,y:p.pos.y,z:p.pos.z,big:true}); } 
            else room.broadcast({type:'explosion',x:m.pos.x,y:m.pos.y,z:m.pos.z,big:false});
            room.sendTo(p.id,{type:'hp',hp:Math.max(0,p.hp),maxHp:p.maxHp}); hit=true; break;
          }
        }
        if(hit) break;

        for(const owner of room.players.values()){
          const h=owner.hangar; if(!h||!h.alive||owner.id===m.owner) continue;
          const dx=owner.hangar.x-m.pos.x,dz=owner.hangar.z-m.pos.z;
          if(dx*dx+dz*dz<490000&&Math.abs(m.pos.y)<300){
            h.hp-=m.damage; room.broadcast({type:'explosion',x:m.pos.x,y:m.pos.y,z:m.pos.z,big:false}); room.broadcastPlayers({type:'hangarHP',id:owner.id,hp:h.hp,maxHp:h.maxHp});
            if(h.hp<=0){ h.alive=false; h.hp=0; room.broadcast({type:'explosion',x:h.x,y:0,z:h.z,big:true}); room.broadcastPlayers({type:'hangarDestroyed',id:owner.id}); }
            hit=true; break;
          }
        }
      }
      if(hit||m.life<=0) room.missiles.splice(i,1);
    }
    
    const now=Date.now();
    for(const p of room.players.values()) if(!p.alive&&now>=p.respawnAt&&p.hangar&&p.hangar.alive){ p.alive=true; p.hp=p.maxHp; p.pos={x:p.hangar.x,y:0,z:p.hangar.z}; room.sendTo(p.id,{type:'respawn',pos:p.pos,quat:p.quat}); }
  }
}, 50);

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));