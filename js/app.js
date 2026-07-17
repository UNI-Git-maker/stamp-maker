const PRESETS = ["おはよう","おやすみ","ありがとう","おつかれさま","よろしくね","ごめんね","OK!","がんばって"];
const $ = id => document.getElementById(id);
const stage = $('stage'), ctx = stage.getContext('2d');

// 論理座標系は幅1024固定。スタンプ比率(370:320)時の論理高さ
const STAMP_H = Math.round(1024 * 320 / 370); // 886
const MARGIN = Math.round(10 * 1024 / 370);   // LINE推奨余白10px相当
const FEATHER = 48; // 透過フェザー帯幅(白フチ/ハロー残り対策のため広めに)

// かざり: 種類ごとの描画サイズとヒット判定半径
const DECO_TYPES = {
  paw:   { size:70, hitR:110, draw:(c,x,y,s)=>drawPaw(c,x,y,s) },
  spark: { size:60, hitR:90,  draw:(c,x,y,s)=>drawSpark(c,x,y,s) }
};
const DEFAULT_TEXT_POS = { x:190, y:120 };
const defaultDecos = () => [ {type:'paw',x:140,y:780}, {type:'spark',x:410,y:80} ];

const state = {
  img:null, imgProcessed:null,
  text:'おはよう', vertical:true, split:true,
  splitAt:3, splitAuto:true, // splitAt文字目(1始まり)から色2。splitAuto中は文字数に追従
  colorA:'#FF7BAC', colorB:'#FFC400',
  size:160, ...DEFAULT_TEXT_POS,
  decos: defaultDecos(),
  transparent:false, tolerance:23, bgPaint:true, bgColor:'#FFFFFF',
  imgScale:0.92, imgX:98, imgY:50,
  guide:false
};

// ---- presets UI ----
const pWrap = $('presets');
PRESETS.forEach(t=>{
  const b=document.createElement('button');
  b.className='chip'; b.textContent=t;
  b.onclick=()=>{ state.text=t; $('text').value=t; syncChips(); syncSplitUI(); render(); };
  pWrap.appendChild(b);
});
function syncChips(){
  [...pWrap.children].forEach(c=>c.classList.toggle('on', c.textContent===state.text));
}

// 色2の開始位置スライダーを文字数に合わせる
function syncSplitUI(){
  const n=Math.max(1, chars().length);
  if(state.splitAuto) state.splitAt=Math.min(n, Math.ceil(n/2)+1);
  state.splitAt=Math.min(state.splitAt, n);
  const r=$('splitAt');
  r.max=n; r.value=state.splitAt;
  $('splitAtVal').textContent=state.splitAt;
  $('splitAtCtrl').hidden=!state.split;
}

// ---- inputs ----
$('uploadBtn').addEventListener('click', ()=>$('file').click());
$('text').addEventListener('input', e=>{ state.text=e.target.value; syncChips(); syncSplitUI(); render(); });
$('vertical').addEventListener('change', e=>{ state.vertical=e.target.checked; render(); });
$('split').addEventListener('change', e=>{ state.split=e.target.checked; syncSplitUI(); render(); });
$('splitAt').addEventListener('input', e=>{
  state.splitAt=+e.target.value; state.splitAuto=false;
  $('splitAtVal').textContent=state.splitAt; render();
});
$('colorA').addEventListener('input', e=>{ state.colorA=e.target.value; render(); });
$('colorB').addEventListener('input', e=>{ state.colorB=e.target.value; render(); });
$('size').addEventListener('input', e=>{ state.size=+e.target.value; render(); });
$('transparent').addEventListener('change', e=>{
  state.transparent=e.target.checked;
  $('thresholdCtrl').hidden=!state.transparent;
  processImage(); render();
});
$('bgPaint').addEventListener('change', e=>{
  state.bgPaint=e.target.checked;
  $('bgColorCtrl').hidden=!state.bgPaint;
  render();
});
$('bgColor').addEventListener('input', e=>{ state.bgColor=e.target.value; render(); });

// しきい値はドラッグ中に連打されるためフレーム単位に間引く
let thrPending=false;
$('threshold').addEventListener('input', e=>{
  // スライダーは透過の強さ0-100。背景色との許容距離へ変換(0→最弱、100→最強、26→23。従来の白しきい値232相当)
  state.tolerance=Math.round(+e.target.value*0.9);
  if(thrPending) return;
  thrPending=true;
  requestAnimationFrame(()=>{ thrPending=false; processImage(); render(); });
});

$('imgScale').addEventListener('input', e=>{ state.imgScale=+e.target.value/100; render(); });
$('imgX').addEventListener('input', e=>{ state.imgX=+e.target.value; render(); });
$('imgY').addEventListener('input', e=>{ state.imgY=+e.target.value; render(); });
$('guide').addEventListener('change', e=>{ state.guide=e.target.checked; render(); });
$('stampRatio').addEventListener('change', e=>{
  stage.height = e.target.checked ? STAMP_H : 1024;
  clampAll(); render();
});
$('resetPos').addEventListener('click', ()=>{
  Object.assign(state, DEFAULT_TEXT_POS);
  state.decos = defaultDecos();
  clampAll(); render();
});

// ---- かざり(複数配置) ----
function addDeco(type){
  const n=state.decos.filter(d=>d.type===type).length;
  // 追加のたびに少しずらして重なりを避ける
  const x=clamp(300 + n*90, 60, 964);
  const y=clamp((type==='paw'? stage.height-180 : 140) + (n%3)*70, 60, stage.height-60);
  state.decos.push({type, x, y});
  render();
}
$('addPaw').addEventListener('click', ()=>addDeco('paw'));
$('addSpark').addEventListener('click', ()=>addDeco('spark'));
$('clearDecos').addEventListener('click', ()=>{ state.decos=[]; render(); });

$('file').addEventListener('change', e=>{
  const f=e.target.files[0];
  e.target.value=''; // 同じファイルの再選択でも change を発火させる
  if(!f) return;
  const url=URL.createObjectURL(f);
  const img=new Image();
  img.onload=()=>{
    URL.revokeObjectURL(url);
    state.img=prepareSource(img);
    processImage(); render();
  };
  img.onerror=()=>{
    URL.revokeObjectURL(url);
    alert('画像を読み込めませんでした。JPEG / PNG などの画像ファイルを選んでください。');
  };
  img.src=url;
});

// 巨大画像は透過処理・描画が重いので事前に縮小しておく
function prepareSource(img){
  const MAX=2048;
  const m=Math.max(img.width,img.height);
  if(m<=MAX) return img;
  const s=MAX/m;
  const c=document.createElement('canvas');
  c.width=Math.round(img.width*s); c.height=Math.round(img.height*s);
  const cx=c.getContext('2d');
  cx.imageSmoothingQuality='high';
  cx.drawImage(img,0,0,c.width,c.height);
  return c;
}

// ---- background removal (edge flood fill + feathering) ----
// 画像/canvasの外周2pxの枠を4画素おきにサンプリングし、最頻色(背景色)を{r,g,b}で返す
function detectBgColor(src){
  const w=src.width, h=src.height;
  const c=document.createElement('canvas'); c.width=w; c.height=h;
  const cx=c.getContext('2d'); cx.drawImage(src,0,0);
  const p=cx.getImageData(0,0,w,h).data;
  const buckets=new Map(); // 32階調バケットkey → {n,r,g,b} 実RGBの合計
  const sample=(x,y)=>{
    const i=(y*w+x)*4;
    const r=p[i], g=p[i+1], b=p[i+2];
    const key=(r>>5)<<10 | (g>>5)<<5 | (b>>5);
    let e=buckets.get(key);
    if(!e){ e={n:0,r:0,g:0,b:0}; buckets.set(key,e); }
    e.n++; e.r+=r; e.g+=g; e.b+=b;
  };
  for(let x=0;x<w;x+=4){ for(let t=0;t<2;t++){ sample(x, t); sample(x, h-1-t); } }
  for(let y=0;y<h;y+=4){ for(let t=0;t<2;t++){ sample(t, y); sample(w-1-t, y); } }
  let best=null;
  buckets.forEach(e=>{ if(!best||e.n>best.n) best=e; });
  if(!best) return {r:255,g:255,b:255}; // サンプル無し(極小画像)は白扱い
  return { r:Math.round(best.r/best.n), g:Math.round(best.g/best.n), b:Math.round(best.b/best.n) };
}
// 背景色bgを透過した加工済みcanvasを返す純関数(stateに依存しない)。bg省略時は自動判定
function makeTransparent(src, tolerance, bg){
  if(!bg) bg=detectBgColor(src);
  const w=src.width, h=src.height;
  const c=document.createElement('canvas'); c.width=w; c.height=h;
  const cx=c.getContext('2d'); cx.drawImage(src,0,0);
  const d=cx.getImageData(0,0,w,h), p=d.data;
  const barrier=tolerance+FEATHER; // 背景色との距離がこれ以上なら被写体とみなしfloodを止める
  const seen=new Uint8Array(w*h); const stack=[];
  // push時に境界とseenを確認しseenを立てる(同一画素の多重pushを防ぎスタック肥大を抑制)
  const push=idx=>{ if(idx<0||idx>=w*h||seen[idx]) return; seen[idx]=1; stack.push(idx); };
  for(let x=0;x<w;x++){ push(x); push((h-1)*w+x); }
  for(let y=0;y<h;y++){ push(y*w); push(y*w+w-1); }
  while(stack.length){
    const idx=stack.pop();
    const i=idx*4;
    // 背景色とのチェビシェフ距離
    const dist=Math.max(Math.abs(p[i]-bg.r), Math.abs(p[i+1]-bg.g), Math.abs(p[i+2]-bg.b));
    if(dist>=barrier) continue; // 障壁(背景から遠い=被写体)
    p[i+3] = dist<=tolerance ? 0 : Math.round(p[i+3]*(dist-tolerance)/FEATHER); // 近い順に完全透過→フェザー
    const x=idx%w;
    push(idx-w); push(idx+w);
    if(x>0) push(idx-1);
    if(x<w-1) push(idx+1);
  }
  cx.putImageData(d,0,0);
  return c; // canvasのままdrawImageのソースに使う(非同期レース回避)
}
function processImage(){
  if(!state.img){ state.imgProcessed=null; return; }
  if(!state.transparent){ state.imgProcessed=state.img; return; }
  const bg=detectBgColor(state.img);
  state.imgProcessed=makeTransparent(state.img, state.tolerance, bg);
  updateBgSwatch(bg);
}
// 自動判定した背景色を判定色スウォッチに反映(thresholdCtrl内なので透過ON時のみ見える)
function updateBgSwatch(bg){
  $('bgDetected').style.background=`rgb(${bg.r},${bg.g},${bg.b})`;
}

// ---- drawing ----
const FONT = "'M PLUS Rounded 1c','Hiragino Maru Gothic ProN','Yu Gothic UI',sans-serif";
function chars(){ return [...state.text]; }
function step(){ return state.size*1.02; }

function drawScene(cctx, W, H, bg, imgOverride){
  cctx.clearRect(0,0,W,H);
  if(bg==='color'){ cctx.fillStyle=state.bgColor; cctx.fillRect(0,0,W,H); }
  else if(bg==='checker'){ drawChecker(cctx,W,H); }
  cctx.imageSmoothingEnabled=true;
  cctx.imageSmoothingQuality='high';
  const k=W/1024;
  const img=imgOverride||state.imgProcessed||state.img;
  if(img){
    const s=Math.min(W/img.width, H/img.height)*state.imgScale;
    const iw=img.width*s, ih=img.height*s;
    cctx.drawImage(img, (W-iw)*state.imgX/100, (H-ih)*state.imgY/100, iw, ih);
  } else {
    cctx.fillStyle='#b9aecb';
    cctx.font=`900 ${44*k}px ${FONT}`;
    cctx.textAlign='center'; cctx.textBaseline='middle';
    cctx.fillText('画像を選んでね', W/2, H/2);
  }
  state.decos.forEach(d=>{
    const t=DECO_TYPES[d.type];
    t.draw(cctx, d.x*k, d.y*k, t.size*k);
  });
  drawText(cctx, k);
}

function drawChecker(cctx,W,H){
  const cell=32*(W/1024);
  cctx.fillStyle='#fff'; cctx.fillRect(0,0,W,H);
  cctx.fillStyle='#e9e4f0';
  for(let y=0;y*cell<H;y++){
    for(let x=(y%2);x*cell<W;x+=2){
      cctx.fillRect(x*cell,y*cell,cell,cell);
    }
  }
}

// 3パス描画: 全文字の白縁→全文字の黒縁→全文字の塗り(縁が隣の文字を欠かないように)
function drawText(cctx,k){
  const cs=chars(); if(!cs.length) return;
  cctx.font=`900 ${state.size*k}px ${FONT}`;
  cctx.textAlign='center'; cctx.textBaseline='middle';
  cctx.lineJoin='round'; cctx.lineCap='round';
  const passes=[
    {stroke:'#fff',    width:0.40},
    {stroke:'#221E29', width:0.16},
    {fill:true}
  ];
  for(const pass of passes){
    cs.forEach((ch,i)=>{
      const cx = state.vertical? state.x*k : (state.x + i*step())*k;
      const cy = state.vertical? (state.y + i*step())*k : state.y*k;
      const wob = (i%2? -1:1)*0.035;
      cctx.save(); cctx.translate(cx,cy); cctx.rotate(wob);
      if(pass.fill){
        cctx.fillStyle = !state.split? state.colorA : (i < state.splitAt-1 ? state.colorA : state.colorB);
        cctx.fillText(ch,0,0);
      } else {
        cctx.strokeStyle=pass.stroke;
        cctx.lineWidth=state.size*pass.width*k;
        cctx.strokeText(ch,0,0);
      }
      cctx.restore();
    });
  }
}

function drawPaw(cctx,x,y,s){
  const TAU=Math.PI*2;
  cctx.save(); cctx.translate(x,y); cctx.rotate(-0.18);
  cctx.fillStyle='#FF9BBE';
  cctx.beginPath(); cctx.ellipse(0,s*0.18,s*0.46,s*0.38,0,0,TAU); cctx.fill();
  [[-0.42,-0.32,.2],[-0.14,-0.5,.21],[0.16,-0.5,.21],[0.44,-0.32,.2]].forEach(t=>{
    cctx.beginPath(); cctx.arc(t[0]*s,t[1]*s,t[2]*s,0,TAU); cctx.fill();
  });
  cctx.restore();
}
// ✨の形の4方向スター(白フチ付きで背景を問わず見える)
function starPath(cctx,x,y,r){
  cctx.beginPath();
  cctx.moveTo(x,y-r);
  cctx.quadraticCurveTo(x,y, x+r,y);
  cctx.quadraticCurveTo(x,y, x,y+r);
  cctx.quadraticCurveTo(x,y, x-r,y);
  cctx.quadraticCurveTo(x,y, x,y-r);
  cctx.closePath();
}
function drawSpark(cctx,x,y,s){
  const stars=[
    {dx:0,        dy:0,        r:s,      color:'#FFC400'},
    {dx: s*0.95,  dy:-s*0.75,  r:s*0.45, color:'#FF7BAC'},
    {dx:-s*0.55,  dy: s*0.85,  r:s*0.32, color:'#FFC400'}
  ];
  cctx.save();
  cctx.lineJoin='round';
  stars.forEach(st=>{
    starPath(cctx, x+st.dx, y+st.dy, st.r);
    cctx.strokeStyle='#fff'; cctx.lineWidth=s*0.16; cctx.stroke();
    cctx.fillStyle=st.color; cctx.fill();
  });
  cctx.restore();
}

// 余白ガイド(ステージのみ、書き出しには含めない)
function drawGuide(){
  const H=stage.height;
  ctx.save();
  ctx.setLineDash([12,10]);
  if(H>STAMP_H){ // 正方形モード: スタンプ370×320で切り出される範囲を示す
    ctx.strokeStyle='rgba(43,75,201,.55)'; ctx.lineWidth=4;
    ctx.strokeRect(2,2,1020,STAMP_H-4);
  }
  const inner=Math.min(H,STAMP_H);
  ctx.strokeStyle='rgba(255,123,172,.65)'; ctx.lineWidth=3;
  ctx.strokeRect(MARGIN,MARGIN,1024-MARGIN*2,inner-MARGIN*2);
  ctx.restore();
}

function render(){
  drawScene(ctx, stage.width, stage.height, state.bgPaint?'color':'checker');
  if(state.guide) drawGuide();
}

// ---- drag (文字・かざりを個別に移動、かざりはダブルタップで削除) ----
let drag=null;
let lastTap={t:0,x:0,y:0};
let downInfo={t:0,x:0,y:0}; // pointerdown時刻・位置。pointerupでタップ確定を判定するのに使う
const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));

function pos(e){
  const r=stage.getBoundingClientRect();
  const k=stage.width/r.width;
  return { x:(e.clientX-r.left)*k, y:(e.clientY-r.top)*k };
}
// 上に描かれているもの(配列の後ろ)を優先して判定
function hitDeco(p){
  for(let i=state.decos.length-1;i>=0;i--){
    const d=state.decos[i];
    if(Math.hypot(p.x-d.x,p.y-d.y)<=DECO_TYPES[d.type].hitR) return i;
  }
  return -1;
}
function clampAll(){
  state.x=clamp(state.x,40,984);
  state.y=clamp(state.y,40,stage.height-40);
  state.decos.forEach(d=>{
    d.x=clamp(d.x,40,984);
    d.y=clamp(d.y,40,stage.height-40);
  });
}
stage.addEventListener('pointerdown', e=>{
  const p=pos(e);
  const now=performance.now();
  const idx=hitDeco(p);
  downInfo={t:now,x:p.x,y:p.y};
  // ダブルタップ(前回タップから350ms以内・近距離)でかざりを削除。lastTapはpointerupで記録する
  if(now-lastTap.t<350 && Math.hypot(p.x-lastTap.x,p.y-lastTap.y)<60){
    lastTap={t:0,x:0,y:0};
    if(idx>=0){ state.decos.splice(idx,1); render(); return; }
  }
  if(idx>=0){
    const d=state.decos[idx];
    drag={ deco:d, dx:p.x-d.x, dy:p.y-d.y };
  } else {
    // かざり以外はどこを掴んでも文字を動かせる(従来互換)
    drag={ dx:p.x-state.x, dy:p.y-state.y };
  }
  try{ stage.setPointerCapture(e.pointerId); }catch(_){}
});
stage.addEventListener('pointermove', e=>{
  if(!drag) return;
  const p=pos(e);
  const nx=clamp(Math.round(p.x-drag.dx),40,984);
  const ny=clamp(Math.round(p.y-drag.dy),40,stage.height-40);
  if(drag.deco){ drag.deco.x=nx; drag.deco.y=ny; }
  else { state.x=nx; state.y=ny; }
  render();
});
stage.addEventListener('pointerup', e=>{
  const p=pos(e);
  // 短時間・小移動ならタップ確定としてlastTapを記録。ドラッグならリセット(誤削除防止)
  if(performance.now()-downInfo.t<350 && Math.hypot(p.x-downInfo.x,p.y-downInfo.y)<12){
    lastTap={t:performance.now(),x:p.x,y:p.y};
  } else {
    lastTap={t:0,x:0,y:0};
  }
  drag=null;
});
stage.addEventListener('pointercancel', ()=>{ drag=null; downInfo={t:0,x:0,y:0}; });

// ---- export ----
function safeName(){
  return state.text.replace(/[\\/:*?"<>|\s]/g,'').slice(0,10) || 'stamp';
}
async function ensureFont(){
  try{ await document.fonts.load(`900 100px "M PLUS Rounded 1c"`); }catch(_){}
}
function download(canvas,name){
  canvas.toBlob(b=>{
    if(!b){ alert('画像の書き出しに失敗しました。'); return; }
    const a=document.createElement('a');
    a.href=URL.createObjectURL(b); a.download=name; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  },'image/png');
}
// 2倍で描いてから縮小(輪郭を滑らかに)
// forceTransparent: 透過OFFでも書き出し時だけ背景を自動判定して透過して描く(LINE用)
async function exportPNG(w,h,bg,name,forceTransparent=false){
  await ensureFont();
  const imgOverride = (forceTransparent && !state.transparent && state.img)
    ? makeTransparent(state.img, state.tolerance) : null;
  const big=document.createElement('canvas'); big.width=w*2; big.height=h*2;
  drawScene(big.getContext('2d'), w*2, h*2, bg, imgOverride);
  const c=document.createElement('canvas'); c.width=w; c.height=h;
  const cctx=c.getContext('2d');
  cctx.imageSmoothingQuality='high';
  cctx.drawImage(big,0,0,w,h);
  download(c,name);
}
// LINE用は元背景を常に自動除去し、仕上がり背景は「色を塗る」設定に従う(OFFなら透過PNG)
const saveBg=()=>state.bgPaint?'color':'none';
$('dlStamp').addEventListener('click', ()=>exportPNG(370,320,saveBg(),`${safeName()}-370x320.png`,true));
$('dlMain').addEventListener('click', ()=>exportPNG(240,240,saveBg(),`${safeName()}-main240.png`,true));
$('dlTab').addEventListener('click', ()=>exportPNG(96,74,saveBg(),`${safeName()}-tab96x74.png`,true));
$('dlFull').addEventListener('click', ()=>exportPNG(1024,1024, saveBg(), `${safeName()}-1024.png`));

// リロード時のブラウザによるフォーム値復元とstateの不一致を防ぐため、stateを正としてUIへ反映する
function syncUIFromState(){
  $('vertical').checked=state.vertical;
  $('split').checked=state.split;
  $('transparent').checked=state.transparent;
  $('guide').checked=state.guide;
  $('stampRatio').checked=false; // stateはスタンプ比率を持たない=正方形が既定
  stage.height=$('stampRatio').checked?STAMP_H:1024;
  $('colorA').value=state.colorA;
  $('colorB').value=state.colorB;
  $('bgColor').value=state.bgColor;
  $('size').value=state.size;
  $('imgScale').value=Math.round(state.imgScale*100);
  $('imgX').value=state.imgX;
  $('imgY').value=state.imgY;
  $('threshold').value=Math.round(state.tolerance/0.9); // 許容距離→強さ0-100の逆変換
  $('text').value=state.text;
  $('bgPaint').checked=state.bgPaint;
  $('thresholdCtrl').hidden=!state.transparent;
  $('bgColorCtrl').hidden=!state.bgPaint;
}

document.fonts.ready.then(render);
syncUIFromState(); syncChips(); syncSplitUI(); render();
