(function(){
'use strict';
const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

/* ---------- site and model constants (all numbers illustrative) ---------- */
const NL=(new URLSearchParams(location.search).get('lines')==='1'?1:2);          // production lines on the site
const SC=1.5,K=SC-1;             // spacing between stations, relative to the first layout
const LZ=18;                     // distance between lines
const MIN_PER_SEC=2.5,RUN_MIN=90,START_H=8;
const NEED={A:10,B:16};          // steam seconds each batch really needs
const S0=14;                     // conservative default setpoint
const KG_MIN=333;                // 20 t/h per line
const OVER_PER_S=0.009;          // share of good potato lost per second of excess steam
const BELT=3.2*SC,SPAWN_DT=0.085/SC,OP_SPEED=6*SC,LANE=0.27;
const FM_TIMES=[6,17,29,41,52,64,75,86],FM_KINDS=['plastic','stone','wood'];
const STORY_BATCH_AT=NL>1?5:15;

/* ---------- belt path, in line-local coordinates ---------- */
const PTS=[[-9.5,-3.2],[6.5,-3.2],[6.5,3.2],[-8.2,3.2]].map(p=>[p[0]*SC,p[1]*SC]);
const SEG=[];let TOTAL=0;
for(let i=0;i<PTS.length-1;i++){const a=PTS[i],b=PTS[i+1],l=Math.hypot(b[0]-a[0],b[1]-a[1]);SEG.push({a,b,l,s0:TOTAL,n:[-(b[1]-a[1])/l,(b[0]-a[0])/l]});TOTAL+=l;}
function posAt(s){s=clamp(s,0,TOTAL);let gi=SEG.length-1;for(let i=0;i<SEG.length;i++){if(s<=SEG[i].s0+SEG[i].l){gi=i;break;}}
  const g=SEG[gi],k=(s-g.s0)/g.l;let nx=g.n[0],nz=g.n[1];const B=0.5*SC,into=s-g.s0,left=g.s0+g.l-s;
  if(gi>0&&into<B){const p=SEG[gi-1].n,w=0.5+into/B*0.5;nx=p[0]*(1-w)+nx*w;nz=p[1]*(1-w)+nz*w;}
  else if(gi<SEG.length-1&&left<B){const q=SEG[gi+1].n,w=0.5-left/B*0.5;nx=nx*(1-w)+q[0]*w;nz=nz*(1-w)+q[1]*w;}
  return [g.a[0]+(g.b[0]-g.a[0])*k,g.a[1]+(g.b[1]-g.a[1])*k,nx,nz];}
const AT={spawn:0.3*SC,peel:6*SC,cam:11.5*SC,gate:12.7*SC,cut:SEG[2].s0+3.5*SC,sort:SEG[2].s0+9*SC,end:TOTAL-0.1};
const HOPS=[AT.peel+1.35,9.2*SC+1.1,SEG[1].s0+0.05,SEG[2].s0+0.05];
const X0=-11.9*SC,X1=9.1*SC,Z0=-6.7*SC,Z1=(NL-1)*LZ+6.7*SC,CXS=(X0+X1)/2,CZS=(Z0+Z1)/2,WH=6.2;

/* ---------- seeded random ---------- */
let seed=1;function rnd(){seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;}

/* ---------- state ---------- */
const state={mode:0,running:false,started:false,complete:false,t:0,real:0,interv:0,spawn:0,pickAt:0,samples:[],alertQ:[],batchPressed:false};
const LINES=[];for(let i=0;i<NL;i++)LINES.push({i,z0:i*LZ,items:[],fms:[],ps:[],auto:[]});
const results=[null,null,null];
const story={active:false,wait:0,finale:false};
const dark={on:false,k:0,target:0,flick:0};
let speed=1;

/* ---------- three.js scene ---------- */
const stage=$('stage'),glc=$('gl');
let renderer;
try{renderer=new THREE.WebGLRenderer({canvas:glc,antialias:true,alpha:true});}
catch(e){const d=document.createElement('div');d.className='nogl';d.textContent='This demo needs WebGL, which this browser has switched off.';stage.appendChild(d);return;}
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
renderer.outputEncoding=THREE.sRGBEncoding;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const scene=new THREE.Scene();
const cam=new THREE.OrthographicCamera(-1,1,1,-1,0.1,400);
const LOOK=new THREE.Vector3(CXS,1.3,CZS);let yaw=Math.PI/4,el=33*Math.PI/180,zoom=1,HH=9;
function placeCam(){const d=110;cam.position.set(LOOK.x+Math.sin(yaw)*Math.cos(el)*d,LOOK.y+Math.sin(el)*d,LOOK.z+Math.cos(yaw)*Math.cos(el)*d);cam.lookAt(LOOK);}
let W=1,H=1;
const FITH=NL>1?16.6:13.2,FITW=NL>1?26:19.4;
function resize(){W=stage.clientWidth||1;H=stage.clientHeight||1;renderer.setSize(W,H,false);const asp=W/H;HH=Math.max(FITH,FITW/asp);cam.top=HH;cam.bottom=-HH;cam.left=-HH*asp;cam.right=HH*asp;cam.zoom=zoom;cam.updateProjectionMatrix();}
placeCam();

const BASE_H=0.5,BASE_S=0.82,BASE_F=0.2;
const hemi=new THREE.HemisphereLight(0xe3ecfa,0x9a8a70,BASE_H);scene.add(hemi);
// low, warm sun from behind the back wall: it reaches the line through the window and over the top of the wall
const sun=new THREE.DirectionalLight(0xffdcb2,BASE_S);sun.target.position.set(CXS,0,CZS);sun.position.set(CXS+0.6*70,0.5*70,CZS-0.62*70);
sun.castShadow=true;const SM=NL>1?4096:2048;sun.shadow.mapSize.set(SM,SM);const sc=sun.shadow.camera,SB=NL>1?34:24;sc.left=-SB;sc.right=SB;sc.top=SB;sc.bottom=-SB;sc.near=1;sc.far=160;sun.shadow.bias=-0.0006;sun.shadow.normalBias=0.02;sun.shadow.radius=3.5;
scene.add(sun,sun.target);
const fill=new THREE.DirectionalLight(0xcfe0ff,BASE_F);fill.position.set(8,14,20);scene.add(fill);

const M=(c,o)=>new THREE.MeshStandardMaterial(Object.assign({color:c,roughness:0.82,metalness:0.02},o||{}));
const mat={slab:M(0xb3ac9c),wall:M(0xd8d1c3),win:new THREE.MeshStandardMaterial({color:0xfff0d2,emissive:0xffd08a,emissiveIntensity:0.75,transparent:true,opacity:0.5,roughness:0.2}),
  white:M(0xf1f3ee),body:M(0xd3dcdb,{roughness:0.5,metalness:0.12}),grey:M(0xb3c0bc),steel:M(0xa7b9b8,{roughness:0.42,metalness:0.3}),dark:M(0x2e3d3a),
  water:M(0x8fc6d6,{roughness:0.3}),glass:M(0xbfe3df,{roughness:0.2,emissive:0x355f5a,emissiveIntensity:0.5}),motor:M(0x6f9098,{roughness:0.6}),
  patch:M(0x6b4525),peeled:M(0xf3d873),safety:M(0xd6b44a),wood:M(0xb99a6b),red:M(0xc4553f),led:M(0xffffff,{emissive:0xffffff,emissiveIntensity:0.9}),
  mint:M(0xb4f4da,{emissive:0x5fe0b0,emissiveIntensity:0.55}),screen:M(0x10312e,{roughness:0.4}),
  coat:M(0xffffff),skin:M(0xe2b48c),net:M(0x8fc0e6),glove:M(0x5f9fd8),boot:M(0xf4f4f0),paper:M(0xffffff),
  amber:M(0xf3bd58,{emissive:0xf3bd58,emissiveIntensity:0.7}),alarm:M(0xf2705a,{emissive:0xf2705a,emissiveIntensity:0.8}),crate:M(0x8fa7a2),
  plastic:M(0x2f7fe0,{roughness:0.35}),stone:M(0x7d7f82),chip:M(0x8a6238)};
const COL={rawA:new THREE.Color(0xa9763f),rawB:new THREE.Color(0x6b4525),peeled:new THREE.Color(0xf3d873),patch:new THREE.Color(0x6b4525),mint:new THREE.Color(0xb4f4da),amber:new THREE.Color(0xf3bd58),alarm:new THREE.Color(0xf2705a)};
function rbox(w,h,d,r){r=Math.min(r===undefined?0.08:r,w/2-0.01,h/2-0.01,d/2-0.01);const iw=w-2*r,ih=h-2*r,c=Math.max(0.005,Math.min(r*0.6,iw/2,ih/2));const x=-iw/2,y=-ih/2,s=new THREE.Shape();
  s.moveTo(x+c,y);s.lineTo(x+iw-c,y);s.absarc(x+iw-c,y+c,c,-Math.PI/2,0,false);s.lineTo(x+iw,y+ih-c);s.absarc(x+iw-c,y+ih-c,c,0,Math.PI/2,false);
  s.lineTo(x+c,y+ih);s.absarc(x+c,y+ih-c,c,Math.PI/2,Math.PI,false);s.lineTo(x,y+c);s.absarc(x+c,y+c,c,Math.PI,Math.PI*1.5,false);
  const g=new THREE.ExtrudeGeometry(s,{depth:d-2*r,bevelEnabled:true,bevelThickness:r,bevelSize:r,bevelSegments:2,curveSegments:4});g.center();return g;}
// CUR is the group new parts are added to, so a whole station can be built at its old coordinates and moved as one
let CUR=scene;
function add(geo,m,x,y,z,parent){const o=new THREE.Mesh(geo,m);o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;(parent||CUR).add(o);return o;}
const box=(w,h,d,m,x,y,z,r,p)=>add(rbox(w,h,d,r),m,x,y,z,p);
const cyl=(rt,rb,h,m,x,y,z,seg,p)=>add(new THREE.CylinderGeometry(rt,rb,h,seg||24),m,x,y,z,p);
const flat=(w,d,m,x,z,y)=>{const o=add(new THREE.BoxGeometry(w,0.014,d),m,x,y||0.008,z);o.castShadow=false;return o;};
function grp(parent,dx,dz,fn){const g=new THREE.Group();g.position.set(dx,0,dz);parent.add(g);const prev=CUR;CUR=g;fn(g);CUR=prev;return g;}
const station=(parent,cx,cz,fn)=>grp(parent,cx*K,cz*K,fn);
function openBin(x,z,w,h,d,m){box(w,0.08,d,m,x,0.04,z,0.02);for(const s of[-1,1]){box(0.08,h,d,m,x+s*(w/2-0.04),h/2,z,0.03);box(w,h,0.08,m,x,h/2,z+s*(d/2-0.04),0.03);}}

// soft contact shadows where things meet the floor
const blobCv=document.createElement('canvas');blobCv.width=blobCv.height=64;(function(){const g=blobCv.getContext('2d'),gr=g.createRadialGradient(32,32,3,32,32,32);gr.addColorStop(0,'rgba(20,14,6,1)');gr.addColorStop(0.5,'rgba(20,14,6,0.6)');gr.addColorStop(1,'rgba(20,14,6,0)');g.fillStyle=gr;g.fillRect(0,0,64,64);})();
const blobTex=new THREE.CanvasTexture(blobCv);
function blob(x,z,w,d,a){const m=new THREE.Mesh(new THREE.PlaneGeometry(w,d),new THREE.MeshBasicMaterial({map:blobTex,transparent:true,opacity:a===undefined?0.3:a,depthWrite:false}));m.rotation.x=-Math.PI/2;m.position.set(x,0.004,z);CUR.add(m);return m;}

// ----- site shell: slab, walls that cut away, window, door -----
box(X1-X0,0.6,Z1-Z0,mat.slab,CXS,-0.3,CZS,0.12);
const wallBack=new THREE.Group(),wallLeft=new THREE.Group();scene.add(wallBack,wallLeft);
const WZ=Z0+0.27,WXL=X0+0.27;
box(X1-X0,WH,0.36,mat.wall,CXS,WH/2,WZ,0.1,wallBack).castShadow=false;
box(0.36,WH,Z1-Z0,mat.wall,WXL,WH/2,CZS,0.1,wallLeft);
// window: the visible wall casts no shadow; invisible blocks around the opening do, so sunlight really falls through it
const WX=-0.5,WW=8,WY0=1.8,WY1=5.0;
box(WW,WY1-WY0,0.1,mat.win,WX,(WY0+WY1)/2,WZ+0.2,0.03,wallBack).castShadow=false;
for(let i=0;i<6;i++)box(0.09,WY1-WY0,0.12,mat.dark,WX-WW/2+i*WW/5,(WY0+WY1)/2,WZ+0.22,0.02,wallBack);
box(WW,0.09,0.12,mat.dark,WX,(WY0+WY1)/2,WZ+0.22,0.02,wallBack);
const caster=new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:false});
function cast(x0,x1,y0,y1){const o=new THREE.Mesh(new THREE.BoxGeometry(x1-x0,y1-y0,0.3),caster);o.position.set((x0+x1)/2,(y0+y1)/2,WZ-0.04);o.castShadow=true;scene.add(o);}
cast(X0,X1,WY1,WH);cast(X0,X1,-0.6,WY0);cast(X0,WX-WW/2,WY0,WY1);cast(WX+WW/2,X1,WY0,WY1);
const shadowPlane=new THREE.Mesh(new THREE.PlaneGeometry(260,260),new THREE.ShadowMaterial({opacity:0.3}));shadowPlane.rotation.x=-Math.PI/2;shadowPlane.position.set(CXS,-0.62,CZS);shadowPlane.receiveShadow=true;scene.add(shadowPlane);
// wall dressing: cable tray, electrical cabinet, extinguisher, pallet
box(13,0.12,0.34,mat.steel,7,5.5,WZ+0.32,0.03,wallBack);
box(1.5,2.3,0.5,mat.grey,9.6,1.15,WZ+0.42,0.06,wallBack);box(0.04,2.0,0.02,mat.dark,9.6,1.15,WZ+0.68,0.01,wallBack);box(0.08,0.3,0.05,mat.dark,9.45,1.2,WZ+0.7,0.02,wallBack);
for(let i=0;i<3;i++)cyl(0.05,0.05,0.04,i===1?mat.amber:mat.led,9.9+i*0.16,2.0,WZ+0.69,10,wallBack).rotation.x=Math.PI/2;
cyl(0.05,0.05,3.1,mat.steel,9.6,3.9,WZ+0.37,8,wallBack);blob(9.6,WZ+0.6,2.7,1.7);
box(1.5,0.16,1.2,mat.wood,11.6,0.08,-8.2,0.03);box(1.2,0.6,0.9,mat.crate,11.6,0.46,-8.2,0.05);box(1.2,0.6,0.9,mat.crate,11.6,1.07,-8.2,0.05);blob(11.6,-8.2,2.7,2.3);
const DOOR_Z=NL>1?LZ/2+3.2:2.4;
cyl(0.13,0.13,0.5,mat.red,WXL+0.27,1.25,DOOR_Z+2,14,wallLeft);cyl(0.05,0.05,0.14,mat.dark,WXL+0.27,1.57,DOOR_Z+2,8,wallLeft);
box(0.03,2.3,1.2,mat.dark,WXL+0.19,1.15,DOOR_Z,0.01,wallLeft).castShadow=false;box(0.1,0.12,1.4,mat.grey,WXL+0.22,2.36,DOOR_Z,0.03,wallLeft);
const doorG=new THREE.Group();doorG.position.set(WXL+0.25,0,DOOR_Z-0.58);wallLeft.add(doorG);box(0.07,2.2,1.14,mat.grey,0,1.12,0.58,0.03,doorG);box(0.06,0.06,0.2,mat.dark,0.06,1.1,0.98,0.02,doorG);
const doorGlow=add(new THREE.BoxGeometry(0.05,0.05,1.1),new THREE.MeshStandardMaterial({color:0xffe9b8,emissive:0xffd98a,emissiveIntensity:0.9}),WXL+0.23,0.03,DOOR_Z,wallLeft);doorGlow.castShadow=false;
// side windows in the left wall, between the door and the back corner, with sunlight pooling on the floor below them
const SWZ0=Z0+1.6,SWZ1=DOOR_Z-1.6,SWN=Math.max(1,Math.round((SWZ1-SWZ0)/8)),SWG=1.4,SWL=(SWZ1-SWZ0-(SWN-1)*SWG)/SWN,SWP=Math.max(3,Math.round(SWL/1.6)),SWT=0.72;
const poolCv=document.createElement('canvas');poolCv.width=64;poolCv.height=128;(function(){const g=poolCv.getContext('2d');g.fillStyle=g.shadowColor='#fff';g.shadowBlur=7;
  const m=8,pw=(64-2*m)/2,ph=(128-2*m)/SWP;for(let c=0;c<2;c++)for(let r=0;r<SWP;r++)g.fillRect(m+c*pw+2,m+r*ph+2,pw-4,ph-4);})();
const poolTex=new THREE.CanvasTexture(poolCv),pools=[];
for(let i=0;i<SWN;i++){const zc=SWZ0+SWL/2+i*(SWL+SWG),wx=WXL+0.2,hh=WY1-WY0,yc=(WY0+WY1)/2;
  box(0.1,hh,SWL,mat.win,wx,yc,zc,0.03,wallLeft).castShadow=false;
  for(let k=0;k<=SWP;k++)box(0.12,hh,0.09,mat.dark,wx+0.02,yc,zc-SWL/2+k*SWL/SWP,0.02,wallLeft);
  for(const y of[WY0,yc,WY1])box(0.12,0.09,SWL,mat.dark,wx+0.02,y,zc,0.02,wallLeft);
  box(0.3,0.08,SWL+0.2,mat.grey,wx+0.12,WY0-0.06,zc,0.02,wallLeft);
  const x0=wx+WY0/SWT,x1=wx+WY1/SWT,g=new THREE.PlaneGeometry(x1-x0,SWL),pa=g.attributes.position;
  for(let v=0;v<pa.count;v++)pa.setY(v,pa.getY(v)-pa.getX(v)*0.32);
  const pm=new THREE.Mesh(g,new THREE.MeshBasicMaterial({map:poolTex,color:0xffd9a6,transparent:true,opacity:0.42,blending:THREE.AdditiveBlending,depthWrite:false}));
  pm.rotation.x=-Math.PI/2;pm.position.set((x0+x1)/2,0.012,zc);wallLeft.add(pm);pools.push(pm);}
// a soft, shadowless warm light from the same side, so machines facing the windows pick up a little of it
const sideSun=new THREE.DirectionalLight(0xffe2bd,0.16);sideSun.position.set(CXS-60,26,CZS+10);sideSun.target=sun.target;scene.add(sideSun);

// ----- shared parts -----
const beltCv=document.createElement('canvas');beltCv.width=64;beltCv.height=8;const bc=beltCv.getContext('2d');bc.fillStyle='#3b4b48';bc.fillRect(0,0,64,8);bc.fillStyle='#4d625d';bc.fillRect(0,0,5,8);bc.fillRect(32,0,5,8);
const belts=[];
function beltRun(x1,z1,x2,z2,rotZ){const alongX=Math.abs(x2-x1)>Math.abs(z2-z1);const len=(alongX?Math.abs(x2-x1):Math.abs(z2-z1))+1.3;const cx=(x1+x2)/2,cz=(z1+z2)/2;
  box(alongX?len:1.32,0.3,alongX?1.32:len,mat.body,cx,0.84,cz,0.07);
  const tex=new THREE.CanvasTexture(beltCv);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.repeat.set((len-0.1)/0.8,1);tex.encoding=THREE.sRGBEncoding;
  const top=new THREE.Mesh(new THREE.PlaneGeometry(len-0.1,1.14),new THREE.MeshStandardMaterial({map:tex,roughness:0.9}));top.rotation.set(-Math.PI/2,0,rotZ);top.position.set(cx,1.0,cz);top.receiveShadow=true;CUR.add(top);belts.push(tex);
  for(const sg of[-0.62,0.62])box(alongX?len-0.2:0.05,0.16,alongX?0.05:len-0.2,mat.steel,alongX?cx:cx+sg,1.08,alongX?cz+sg:cz,0.02);
  const n=Math.max(2,Math.round(len/3.2));for(let i=0;i<n;i++){const k=(i+0.5)/n-0.5;const lx=alongX?cx+k*len:cx,lz=alongX?cz:cz+k*len;
    for(const sgn of[-0.5,0.5])box(0.12,0.72,0.12,mat.grey,alongX?lx:lx+sgn,0.36,alongX?lz+sgn:lz,0.03);}
  blob(cx,cz,alongX?len+2.6:2.8,alongX?2.8:len+2.6,0.36);}
function motor(x,z,ax){const c=cyl(0.2,0.2,0.5,mat.motor,x,0.62,z,16);if(ax==='x')c.rotation.z=Math.PI/2;else c.rotation.x=Math.PI/2;box(0.3,0.3,0.3,mat.dark,x+(ax==='x'?0.35:0),0.62,z+(ax==='x'?0:0.35),0.05);}
function floorLine(pts,parent){for(let i=0;i<pts.length-1;i++){const a=pts[i],b=pts[i+1];const ax=Math.abs(b[0]-a[0])>Math.abs(b[1]-a[1]);const l=Math.hypot(b[0]-a[0],b[1]-a[1])+0.09;
  box(ax?l:0.09,0.05,ax?0.09:l,mat.mint,(a[0]+b[0])/2,0.035,(a[1]+b[1])/2,0.02,parent).castShadow=false;}}
function polyAt(pts,k){let tot=0;const ls=[];for(let i=0;i<pts.length-1;i++){const l=Math.hypot(pts[i+1][0]-pts[i][0],pts[i+1][1]-pts[i][1]);ls.push(l);tot+=l;}let d=k*tot;for(let i=0;i<ls.length;i++){if(d<=ls[i]){const u=d/ls[i];return[pts[i][0]+(pts[i+1][0]-pts[i][0])*u,pts[i][1]+(pts[i+1][1]-pts[i][1])*u];}d-=ls[i];}return pts[pts.length-1];}
function dashboard(){box(0.1,1.3,0.1,mat.grey,0,0.65,0,0.03);const d=box(1.4,0.86,0.08,mat.screen,0,1.66,0.02,0.04);d.rotation.x=-0.2;
  for(let i=0;i<4;i++){const b=box(0.18,0.16+0.12*((i*7)%4),0.02,mat.mint,-0.44+i*0.3,1.56+0.06*((i*7)%4),0.1,0.01);b.rotation.x=-0.2;}}
// where the Qualify dashboard stands: inside the line when there is one, at a shared desk in the side aisle when there are more
const DESK=NL>1?{x:-16.3,z:LZ/2-1,rot:Math.PI/2,stand:[-15.2,LZ/2-1],face:-Math.PI/2,reg:'aisle'}:{x:4.3*SC,z:-1.0*SC,rot:0,stand:[4.3*SC,-0.3],face:Math.PI,reg:0};
const deskG=grp(scene,DESK.x,DESK.z,()=>{dashboard();if(NL>1){box(1.6,0.08,0.7,mat.white,0,0.95,0.45,0.03);blob(0,0.3,2.4,2);}});deskG.rotation.y=DESK.rot;
const dashLight=new THREE.PointLight(0xb4f4da,0,3.4,2);dashLight.position.set(DESK.x+(NL>1?0.6:0),1.7,DESK.z+(NL>1?0:0.6));scene.add(dashLight);
const potGeo=new THREE.SphereGeometry(0.19,12,9);(function(){const p=potGeo.attributes.position;for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),k=1+0.09*Math.sin(x*17+1)*Math.cos(z*13)+0.06*Math.sin(y*19+2);p.setXYZ(i,x*k,y*k,z*k);}potGeo.computeVertexNormals();})();

// ----- one production line -----
function buildLine(L){
  const G=new THREE.Group();G.position.z=L.z0;scene.add(G);L.G=G;CUR=G;
  const P=PTS;
  beltRun(P[0][0],P[0][1],P[1][0],P[1][1],0);beltRun(P[1][0],P[1][1],P[2][0],P[2][1],-Math.PI/2);beltRun(P[2][0],P[2][1],P[3][0],P[3][1],Math.PI);
  motor(P[1][0]-1.2,P[1][1]+0.9,'z');motor(P[2][0]+0.9,P[2][1]-1.0,'x');motor(P[3][0]+0.8,P[3][1]+0.9,'z');
  const yz=1.95*SC,yx0=-9*SC,yx1=5.6*SC;flat(yx1-yx0,0.09,mat.safety,(yx0+yx1)/2,-yz);flat(yx1-yx0,0.09,mat.safety,(yx0+yx1)/2,yz);flat(0.09,2*yz+0.09,mat.safety,yx1,0);flat(0.09,2*yz+0.09,mat.safety,yx0,0);
  // intake hopper
  station(G,-9.3,-3.2,()=>{const hop=cyl(1.15,0.5,1.2,mat.body,-9.3,2.35,-3.2,4);hop.rotation.y=Math.PI/4;const rim=cyl(1.2,1.2,0.1,mat.steel,-9.3,2.98,-3.2,4);rim.rotation.y=Math.PI/4;
    for(const dx of[-0.66,0.66])for(const dz of[-0.66,0.66])box(0.1,2.0,0.1,mat.grey,-9.3+dx,1.0,-3.2+dz,0.03);blob(-9.3,-3.2,3.2,3.2);});
  // grading
  station(G,-7.4,-3.2,()=>{for(const dz of[-0.74,0.74])box(1.7,0.46,0.14,mat.grey,-7.4,1.3,-3.2+dz,0.05);for(let i=0;i<5;i++){const r=cyl(0.06,0.06,1.42,mat.steel,-8.05+i*0.33,1.66,-3.2,10);r.rotation.x=Math.PI/2;}});
  // steam peeler: pressure vessel with bands, hatch, steam supply, valve, gauge, operator panel, peel bin
  station(G,-3.5,-3.2,()=>{const vessel=cyl(1.0,1.0,2.5,mat.steel,-3.5,1.72,-3.2,32);vessel.rotation.z=Math.PI/2;
    for(const dx of[-1.27,1.27]){const c=cyl(1.06,1.06,0.12,mat.dark,-3.5+dx,1.72,-3.2,32);c.rotation.z=Math.PI/2;}
    for(const dx of[-0.6,0.6]){const b=add(new THREE.TorusGeometry(1.01,0.045,8,36),mat.grey,-3.5+dx,1.72,-3.2);b.rotation.y=Math.PI/2;}
    const hatch=cyl(0.34,0.34,0.1,mat.grey,-3.5,1.9,-2.22,20);hatch.rotation.x=Math.PI/2+0.18;const hh2=cyl(0.05,0.05,0.4,mat.dark,-3.5,1.92,-2.14,8);hh2.rotation.z=Math.PI/2;
    box(2.3,0.7,1.95,mat.body,-3.5,0.35,-3.2,0.08);
    cyl(0.16,0.16,1.2,mat.steel,-3.0,3.1,-3.4,14);cyl(0.24,0.24,0.1,mat.dark,-3.0,3.72,-3.4,14);
    const sp=cyl(0.1,0.1,1.5,mat.steel,-4.1,3.2,-4.15,12);sp.rotation.x=Math.PI/2;cyl(0.1,0.1,0.55,mat.steel,-4.1,2.95,-3.4,12);add(new THREE.SphereGeometry(0.13,12,10),mat.steel,-4.1,3.2,-3.4);
    const fl=cyl(0.17,0.17,0.07,mat.dark,-4.1,3.2,-4.9,14);fl.rotation.x=Math.PI/2;
    const wheel=add(new THREE.TorusGeometry(0.2,0.04,8,20),mat.red,-4.1,3.42,-4.5);wheel.rotation.x=Math.PI/2;cyl(0.03,0.03,0.22,mat.dark,-4.1,3.32,-4.5,8);
    const gauge=cyl(0.13,0.13,0.06,mat.white,-4.1,3.42,-3.9,16);gauge.rotation.x=Math.PI/2;cyl(0.02,0.02,0.2,mat.dark,-4.1,3.3,-3.9,6);
    box(0.1,1.3,0.1,mat.grey,-2.2,0.65,-2.35,0.03);const hmi=box(0.5,0.36,0.08,mat.screen,-2.2,1.42,-2.33,0.03);hmi.rotation.x=-0.25;const hs=box(0.4,0.26,0.02,mat.glass,-2.2,1.43,-2.28,0.01);hs.rotation.x=-0.25;
    box(0.9,0.75,0.8,mat.crate,-4.9,0.38,-1.6,0.06);box(0.74,0.1,0.64,mat.patch,-4.9,0.74,-1.6,0.03);blob(-3.5,-3.2,4.4,3.8);blob(-4.9,-1.6,1.8,1.7);});
  // washing: tub, spray bar with jets, drain
  L.jets=[];
  station(G,-0.3,-3.2,()=>{box(2.0,1.1,1.75,mat.body,-0.3,1.3,-3.2,0.1);box(1.7,0.08,1.45,mat.water,-0.3,1.86,-3.2,0.03);
    const spray=cyl(0.07,0.07,1.6,mat.steel,-0.3,2.3,-3.2,10);spray.rotation.x=Math.PI/2;for(const dz of[-0.8,0.8])box(0.08,0.55,0.08,mat.steel,-0.3,2.08,-3.2+dz,0.02);
    for(let i=0;i<4;i++){const j=new THREE.Mesh(new THREE.ConeGeometry(0.16,0.4,10,1,true),new THREE.MeshBasicMaterial({color:0xcfeaf2,transparent:true,opacity:0.5,depthWrite:false,side:THREE.DoubleSide}));j.position.set(-0.3,2.08,-3.74+i*0.36);CUR.add(j);L.jets.push(j);}
    cyl(0.07,0.07,0.75,mat.steel,-0.3,0.4,-2.28,8);flat(0.7,0.5,mat.dark,-0.3,-2.3,0.012);blob(-0.3,-3.2,3.6,3.4);});
  // Polysense: Qualify camera with light bars and cable, compute unit
  L.lensMat=mat.mint.clone();L.coneMat=new THREE.MeshBasicMaterial({color:0xb4f4da,transparent:true,opacity:0.2,side:THREE.DoubleSide,depthWrite:false});
  L.ps.push(station(G,2.0,-3.2,()=>{for(const dz of[-0.9,0.9])box(0.14,3.1,0.14,mat.white,2.0,1.55,-3.2+dz,0.04);
    box(0.18,0.18,2.1,mat.white,2.0,3.1,-3.2,0.05);box(0.56,0.4,0.56,mat.dark,2.0,2.8,-3.2,0.08);cyl(0.16,0.2,0.2,L.lensMat,2.0,2.52,-3.2,18);
    for(const dx of[-0.55,0.55]){box(0.1,0.08,1.3,mat.led,2.0+dx,2.3,-3.2,0.02).castShadow=false;box(0.06,0.6,0.06,mat.white,2.0+dx,2.72,-3.2,0.02);}box(1.2,0.06,0.06,mat.white,2.0,3.0,-3.2,0.02);
    L.cone=new THREE.Mesh(new THREE.ConeGeometry(0.72,1.4,28,1,true),L.coneMat);L.cone.position.set(2.0,1.76,-3.2);CUR.add(L.cone);
    L.scan=new THREE.Mesh(new THREE.BoxGeometry(0.06,0.02,1.12),new THREE.MeshBasicMaterial({color:0xb4f4da,transparent:true,opacity:0.9}));L.scan.position.set(2.0,1.03,-3.2);CUR.add(L.scan);
    box(0.05,2.7,0.05,mat.dark,2.0,1.45,-2.22,0.02);box(0.05,0.05,0.5,mat.dark,2.0,2.9,-2.5,0.02);
    box(0.55,1.05,0.42,mat.white,2.9,0.52,-2.3,0.06);box(0.36,0.08,0.02,mat.mint,2.9,0.82,-2.08,0.01);for(let i=0;i<3;i++)box(0.36,0.03,0.02,mat.grey,2.9,0.4+i*0.09,-2.08,0.01);blob(2.9,-2.3,1.3,1.1);}));
  L.camLight=new THREE.PointLight(0xe9fff6,0,5.5,2);L.camLight.position.set(2.0*SC,2.25,-3.2*SC);G.add(L.camLight);
  // reject gate straight after the camera: Qualify's signal fires it, foreign material drops into the bin
  L.ps.push(station(G,3.2,-3.2,()=>{box(0.5,0.62,0.4,mat.white,3.2,1.32,-4.12,0.05);box(0.3,0.06,0.02,mat.mint,3.2,1.5,-3.91,0.01);
    L.pusher=box(0.5,0.26,0.08,mat.steel,3.2,1.22,-3.84,0.02);cyl(0.04,0.04,0.3,mat.dark,3.2,1.22,-3.98,8).rotation.x=Math.PI/2;
    const ch=box(0.7,0.06,0.5,mat.steel,3.2,0.95,-2.42,0.02);ch.rotation.x=0.45;
    openBin(3.2,-1.75,0.95,0.6,0.8,mat.crate);box(0.99,0.07,0.84,mat.alarm,3.2,0.62,-1.75,0.02).castShadow=false;box(0.79,0.09,0.64,mat.crate,3.2,0.62,-1.75,0.01);blob(3.2,-1.75,1.9,1.7);}));
  // data lines on the floor
  const camX=2.0*SC,dz1=-1.0*SC;
  L.lineA=NL>1?[[camX,-3.2*SC+1.0],[camX,dz1],[-15.8,dz1],[-15.8,DESK.z-L.z0]]:[[camX,-3.2*SC+1.0],[camX,dz1],[DESK.x,dz1]];
  L.lineB=[[camX,dz1],[-1.4-3.5*K,dz1],[-1.4-3.5*K,-2.2-3.2*K]];
  L.ps.push(grp(G,0,0,g=>floorLine(L.lineA,g)));L.auto.push(grp(G,0,0,g=>floorLine(L.lineB,g)));
  L.pulses=[];for(let i=0;i<8;i++){const m=new THREE.Mesh(new THREE.SphereGeometry(0.13,12,10),mat.mint);m.visible=false;G.add(m);L.pulses.push({m,k:1,pts:null});}
  // cutter with guard rail
  station(G,3.0,3.2,()=>{box(1.9,1.5,1.75,mat.body,3.0,1.5,3.2,0.1);const blade=cyl(0.6,0.6,0.14,mat.dark,3.0,1.55,4.1,28);blade.rotation.x=Math.PI/2;const hub=cyl(0.16,0.16,0.2,mat.steel,3.0,1.55,4.14,16);hub.rotation.x=Math.PI/2;
    box(0.9,0.3,0.9,mat.grey,3.0,2.4,3.2,0.06);for(const dx of[-1.1,0,1.1])box(0.07,0.95,0.07,mat.safety,3.0+dx,0.48,4.85,0.02);for(const y of[0.55,0.92])box(2.27,0.06,0.06,mat.safety,3.0,y,4.85,0.02);
    flat(0.7,0.5,mat.dark,3.0,2.3,0.012);blob(3,3.2,3.6,3.4);});
  // optical sorter (the plant's own) + reject bin
  station(G,-2.5,3.2,()=>{box(2.1,1.3,1.75,mat.body,-2.5,1.45,3.2,0.1);box(1.5,0.14,0.5,mat.dark,-2.5,2.16,3.2,0.04);for(let i=0;i<5;i++)cyl(0.04,0.04,0.03,mat.led,-3.1+i*0.3,2.1,3.47,8).rotation.x=Math.PI/2;
    const chute=box(0.8,0.08,1.0,mat.steel,-2.5,1.15,4.45,0.03);chute.rotation.x=0.5;openBin(-2.5,5.3,1.3,0.85,1.1,mat.crate);
    L.rejFill=add(new THREE.BoxGeometry(1.1,0.7,0.9),mat.patch,-2.5,0.1,5.3);L.rejFill.castShadow=false;blob(-2.5,3.2,3.8,3.4);blob(-2.5,5.3,2.3,2.1);});
  // output crate at the end of the belt
  grp(G,P[3][0]-1.0+9.2,3.2*K,()=>{openBin(-9.2,3.2,1.3,0.9,1.4,mat.crate);add(new THREE.BoxGeometry(1.1,0.5,1.2),mat.peeled,-9.2,0.4,3.2).castShadow=false;blob(-9.2,3.2,2.5,2.6);});
  // QC bench
  station(G,-7.4,0.1,()=>{box(0.9,0.1,1.9,mat.white,-7.4,0.92,0.1,0.04);for(const dx of[-0.36,0.36])for(const dz of[-0.85,0.85])box(0.08,0.9,0.08,mat.grey,-7.4+dx,0.45,0.1+dz,0.02);
    box(0.5,0.06,0.7,mat.steel,-7.4,1.0,0.1,0.02);cyl(0.05,0.05,0.6,mat.dark,-7.65,1.3,-0.6,10);box(0.3,0.08,0.3,mat.dark,-7.55,1.62,-0.6,0.03);box(0.3,0.2,0.3,mat.grey,-7.5,1.07,0.75,0.04);blob(-7.4,0.1,2,3.1);});
  L.puffs=[];for(let i=0;i<5;i++){const m=new THREE.Mesh(new THREE.SphereGeometry(0.22,12,10),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0,depthWrite:false}));G.add(m);L.puffs.push({m,life:0});}L.puffAcc=0;
  CUR=scene;
  // points the operator walks to, in world coordinates
  const w=(cx,cz,x,z)=>[x+cx*K,z+cz*K+L.z0];
  L.pt={BENCH:w(-7.4,0.1,-6.3,0.1),SAMPLE:w(-0.3,-3.2,0.9,-1.85),HMI:w(-3.5,-3.2,-2.2,-1.55),PICK_BACK:w(-0.3,-3.2,1.4,-1.9),PICK_FRONT:[7.4,3.5+L.z0],ENT:[-15.6,L.z0],
    STROLL:[[-7.5,2.1+L.z0],[6.9,2.1+L.z0],[7.5,0.9+L.z0],[-7.5,-0.6+L.z0]]};
}
LINES.forEach(buildLine);

/* ---------- potatoes: instanced so the belts can carry a full bed of product ---------- */
const MAXI=460*NL;
const patchGeo=new THREE.SphereGeometry(0.085,8,6),stripGeo=rbox(0.44,0.075,0.075,0.02);
function inst(geo,n,m){const im=new THREE.InstancedMesh(geo,m,n);im.castShadow=true;im.receiveShadow=true;im.frustumCulled=false;im.count=0;scene.add(im);return im;}
const potIM=inst(potGeo,MAXI,M(0xffffff)),stripIM=inst(stripGeo,MAXI*3,M(0xffffff)),patchIM=inst(patchGeo,MAXI,mat.patch);
potIM.setColorAt(0,COL.peeled);stripIM.setColorAt(0,COL.peeled);
const dummy=new THREE.Object3D();
// markers that ride along with whatever the camera flags: amber for peel left on, red for foreign material
function markerPool(n,m){const a=[];for(let i=0;i<n;i++){const g=new THREE.Group();for(let j=0;j<4;j++){const b=new THREE.Mesh(new THREE.BoxGeometry(j%2?0.05:0.6,0.05,j%2?0.6:0.05),m);b.position.set(j===1?0.3:j===3?-0.3:0,0,j===0?0.3:j===2?-0.3:0);g.add(b);}
  const pin=new THREE.Mesh(new THREE.ConeGeometry(0.11,0.24,10),m);pin.rotation.x=Math.PI;pin.position.y=0.5;g.add(pin);g.visible=false;scene.add(g);a.push({g,it:null,t:0});}return a;}
const markers=markerPool(18*NL,mat.amber),fmMarkers=markerPool(6,mat.alarm);
function flag(pool,it,dur){const m=pool.find(m=>!m.it);if(!m)return;m.it=it;m.t=dur;m.t0=dur;m.g.visible=true;}
function clearMarkers(){for(const m of markers.concat(fmMarkers)){m.it=null;m.g.visible=false;}}
function place(it,L){
  if(it.s>AT.end){const ex=it.s-AT.end;it.x=PTS[3][0]+0.1-ex*1.05;it.z=L.z0+PTS[3][1]-it.lane*LANE;it.y=1.2-ex*ex*0.8;return;}
  const p=posAt(it.s);it.x=p[0]+p[2]*it.lane*LANE;it.z=L.z0+p[1]+p[3]*it.lane*LANE;let y=1.2;
  const u=(it.s-AT.spawn)/0.9;if(u<1)y+=(1-u)*(1-u)*1.25;else if(u<1.5)y+=Math.sin((u-1)*2*Math.PI)*0.07;
  for(const h of HOPS){const k=(it.s-h)/0.5;if(k>0&&k<1){y+=Math.sin(k*Math.PI)*0.11;break;}}
  it.y=y;}
function spawn(L,s,batch){const it={s,batch,lane:Math.floor(rnd()*3)-1+(rnd()-0.5)*0.35,peeled:false,seen:false,cut:false,under:false,delta:0,need:NEED[batch],sc:1,rej:null,dead:false,
  big:batch==='B'?1.14:1,rot:rnd()*6.28,tilt:(rnd()-0.5)*0.8,sx:1.15+rnd()*0.35,sy:0.8+rnd()*0.15,sz:0.9+rnd()*0.2,spin:(rnd()-0.5)*1.8,x:0,y:0,z:0};L.items.push(it);place(it,L);return it;}
function peel(it,S){it.peeled=true;it.delta=S-it.need;it.under=rnd()<clamp(-it.delta*0.1,0,0.25);it.sc=1-clamp(it.delta,0,6)*0.05;}
function populate(L){L.items.length=0;for(let s=AT.end-0.2;s>AT.spawn;s-=BELT*SPAWN_DT){const it=spawn(L,s,'A');if(s>AT.peel)peel(it,S0);if(s>AT.cam)it.seen=true;if(s>AT.cut)it.cut=true;}}
// foreign material: a few stray objects among the potatoes
const fmGeo={plastic:new THREE.BoxGeometry(0.34,0.05,0.22),stone:new THREE.DodecahedronGeometry(0.15,0),wood:new THREE.BoxGeometry(0.42,0.08,0.11)},fmMat={plastic:mat.plastic,stone:mat.stone,wood:mat.chip};
function spawnFM(L,kind){const m=new THREE.Mesh(fmGeo[kind],fmMat[kind]);m.castShadow=true;m.rotation.set(rnd()*0.6,rnd()*6.28,rnd()*0.4);scene.add(m);
  const f={s:AT.spawn,lane:(rnd()-0.5)*1.6,kind,mesh:m,seen:false,cutSeen:false,out:null,dead:false,x:0,y:0,z:0};L.fms.push(f);place(f,L);m.position.set(f.x,f.y,f.z);}
function dropFM(L,i){const f=L.fms[i];f.dead=true;scene.remove(f.mesh);L.fms.splice(i,1);}
function syncItems(){let np=0,ns=0,na=0;
  for(const L of LINES)for(const it of L.items){const k=it.big*it.sc;
    if(!it.cut){if(np>=MAXI)continue;dummy.position.set(it.x,it.y,it.z);dummy.rotation.set(it.tilt,it.rot,0);dummy.scale.set(it.sx*k,it.sy*k,it.sz*k);dummy.updateMatrix();potIM.setMatrixAt(np,dummy.matrix);
      potIM.setColorAt(np,it.peeled?COL.peeled:it.batch==='A'?COL.rawA:COL.rawB);np++;
      if(it.peeled&&it.under&&na<MAXI-2){for(let j=0;j<2;j++){const a=it.rot+j*2.6;dummy.position.set(it.x+Math.cos(a)*0.12*k,it.y+0.07,it.z+Math.sin(a)*0.1*k);dummy.rotation.set(0,0,0);dummy.scale.setScalar(1);dummy.updateMatrix();patchIM.setMatrixAt(na++,dummy.matrix);}}}
    else{if(ns>=MAXI*3-3)continue;const c=Math.cos(it.rot),s=Math.sin(it.rot);for(let j=0;j<3;j++){dummy.position.set(it.x+(j-1)*0.09*s,it.y-0.11+(j===1?0.06:0),it.z+(j-1)*0.09*c);dummy.rotation.set(0,it.rot+(j-1)*0.25,0);dummy.scale.setScalar(k);dummy.updateMatrix();
      stripIM.setMatrixAt(ns,dummy.matrix);stripIM.setColorAt(ns,it.under&&j===0?COL.patch:COL.peeled);ns++;}}}
  potIM.count=np;stripIM.count=ns;patchIM.count=na;potIM.instanceMatrix.needsUpdate=stripIM.instanceMatrix.needsUpdate=patchIM.instanceMatrix.needsUpdate=true;
  if(potIM.instanceColor)potIM.instanceColor.needsUpdate=true;if(stripIM.instanceColor)stripIM.instanceColor.needsUpdate=true;
  for(const L of LINES)for(const f of L.fms)f.mesh.position.set(f.x,f.y-0.08,f.z);
  for(const m of markers.concat(fmMarkers)){if(!m.it)continue;if(m.it.dead||m.t<=0){m.it=null;m.g.visible=false;continue;}const pop=1+Math.max(0,m.t-(m.t0-0.25))*5;m.g.position.set(m.it.x,m.it.y,m.it.z);m.g.scale.setScalar(pop);}}

/* ---------- labels ---------- */
const labelLayer=$('labels'),labels=[];
function label(html,p,cls,hp){const el=document.createElement('div');el.className='lbl '+(cls||'')+(hp?' hov':'');el.innerHTML=html;labelLayer.appendChild(el);
  const o={el,p:new THREE.Vector3(p[0],p[1],p[2]),on:true,hp:hp?new THREE.Vector3(hp[0],hp[1],hp[2]):null,shown:false,force:false,pin:0};labels.push(o);return o;}
// always on: peeler setpoint, Qualify camera, off-spec counter. Everything else appears when the pointer is near it.
const tag=L=>NL>1?'Line '+(L.i+1)+' · ':'';
for(const L of LINES){const w=(cx,cz,x,y,z)=>[x+cx*K,y,z+cz*K+L.z0];const lb={};L.lb=lb;
  lb.batch=label('',w(-9.3,-3.2,-9.3,3.35,-3.2),'',w(-9.3,-3.2,-9.3,2.3,-3.2));
  lb.grade=label('Grading',w(-7.4,-3.2,-7.4,2.0,-3.2),'',w(-7.4,-3.2,-7.4,1.3,-3.2));
  lb.peeler=label('<span></span><small></small><canvas width="192" height="48"></canvas>',w(-3.5,-3.2,-3.5,4.1,-3.2));
  lb.plT=lb.peeler.el.querySelector('span');lb.plS=lb.peeler.el.querySelector('small');lb.spark=lb.peeler.el.querySelector('canvas');
  lb.wash=label('Washing',w(-0.3,-3.2,-0.3,2.8,-3.2),'',w(-0.3,-3.2,-0.3,1.5,-3.2));
  lb.cam=label(tag(L)+'Qualify camera<small>every potato, inline</small>',w(2,-3.2,2.0,4.5,-3.2),'ps');lb.camS=lb.cam.el.querySelector('small');
  lb.gate=label('Reject gate<small></small>',w(3.2,-3.2,3.2,2.0,-1.75),'ps',w(3.2,-3.2,3.2,0.8,-2.2));lb.gateS=lb.gate.el.querySelector('small');
  lb.auto=label('AutoControl<small>to the peeler, OPC-UA / MQTT</small>',[-1,0.5,-1.0*SC+L.z0],'ps',[0.5,0.1,-1.0*SC+L.z0]);
  lb.cut=label('Cutter',w(3,3.2,3.0,2.9,3.2),'',w(3,3.2,3.0,1.5,3.2));
  lb.sort=label('Optical sorter<small>the plant\'s own</small>',w(-2.5,3.2,-2.5,2.6,3.2),'',w(-2.5,3.2,-2.5,1.5,3.2));
  lb.rej=label('',w(-2.5,3.2,-2.5,1.3,5.3),'bad');
  lb.bench=label('QC bench',w(-7.4,0.1,-7.4,1.9,0.1),'',w(-7.4,0.1,-7.4,1.0,0.1));}
const Lg={dash:label(NL>1?'Qualify dashboard<small>both lines</small>':'Qualify dashboard',[DESK.x,2.5,DESK.z],'ps',[DESK.x,1.6,DESK.z]),say:label('',[0,0,0],'say',[0,1.3,0])};
const v3=new THREE.Vector3();let mx=-999,my=-999,lblTick=0;
function updateLabels(now){
  // where the operator is on screen, so labels can step back instead of covering them
  const ppu=H/(2*HH)*zoom;let ox=-9999,oy=0;if(!op.gone){v3.set(op.x,1.3,op.z).project(cam);ox=(v3.x*0.5+0.5)*W;oy=(-v3.y*0.5+0.5)*H;}
  const measure=(lblTick++%20)===0;
  for(const o of labels){if(!o.on){if(!o.el.hidden)o.el.hidden=true;continue;}if(o.el.hidden)o.el.hidden=false;v3.copy(o.p).project(cam);
  const sx=(v3.x*0.5+0.5)*W,sy=(-v3.y*0.5+0.5)*H;o.el.style.transform='translate(-50%,-100%) translate('+sx.toFixed(1)+'px,'+sy.toFixed(1)+'px)';
  if(o!==Lg.say){if(measure||!o.w){o.w=o.el.offsetWidth;o.h=o.el.offsetHeight;}
    const dim=Math.abs(ox-sx)<o.w/2+0.7*ppu&&oy+1.5*ppu>sy-o.h&&oy-1.6*ppu<sy;if(dim!==o.dim){o.dim=dim;o.el.classList.toggle('dim',dim);}}
  if(o.hp){v3.copy(o.hp).project(cam);const hx=(v3.x*0.5+0.5)*W,hy=(-v3.y*0.5+0.5)*H;
    const show=o.force||now<o.pin||Math.hypot(mx-hx,my-hy)<56*Math.sqrt(zoom)||Math.hypot(mx-sx,my-(sy-14))<44;if(show!==o.shown){o.shown=show;o.el.classList.toggle('show',show);}}}}

/* ---------- operator ---------- */
const DOOR_IN=[WXL+1.1,DOOR_Z],DOOR_OUT=[WXL+0.45,DOOR_Z];
const opG=new THREE.Group();opG.scale.setScalar(1.2);scene.add(opG);
function limb(x,y,len,r,m){const g=new THREE.Group();g.position.set(x,y,0);opG.add(g);add(new THREE.CapsuleGeometry(r,len,4,10),m,0,-len/2,0,g);return g;}
const legL=limb(-0.14,0.66,0.42,0.11,mat.dark),legR=limb(0.14,0.66,0.42,0.11,mat.dark);
box(0.22,0.16,0.36,mat.boot,0,-0.56,0.05,0.05,legL);box(0.22,0.16,0.36,mat.boot,0,-0.56,0.05,0.05,legR);
add(new THREE.CapsuleGeometry(0.3,0.46,6,16),mat.coat,0,1.08,0,opG);box(0.04,0.5,0.02,mat.grey,0,1.1,0.3,0.01,opG);
const armL=limb(-0.39,1.42,0.36,0.085,mat.coat),armR=limb(0.39,1.42,0.36,0.085,mat.coat);
add(new THREE.SphereGeometry(0.1,12,10),mat.glove,0,-0.46,0,armL);add(new THREE.SphereGeometry(0.1,12,10),mat.glove,0,-0.46,0,armR);
const headG=new THREE.Group();headG.position.set(0,1.88,0);opG.add(headG);
add(new THREE.SphereGeometry(0.27,18,14),mat.skin,0,0,0,headG);add(new THREE.SphereGeometry(0.295,18,10,0,Math.PI*2,0,Math.PI*0.52),mat.net,0,0.02,0,headG);
for(const ex of[-0.1,0.1])add(new THREE.SphereGeometry(0.035,8,6),mat.dark,ex,0,0.25,headG);
const tray=box(0.56,0.08,0.36,mat.steel,0,1.12,0.5,0.03,opG);const trayP=[];for(let i=0;i<3;i++){const t=add(potGeo,mat.peeled,-0.15+i*0.15,1.22,0.5,opG);t.scale.setScalar(0.62);trayP.push(t);}
const handP=add(potGeo,mat.peeled,0,-0.56,0.1,armR);handP.scale.set(0.95,0.7,0.8);
const tablet=new THREE.Group();tablet.position.set(0.04,-0.5,0.1);tablet.rotation.x=1.2;armL.add(tablet);box(0.3,0.4,0.035,mat.dark,0,0,0,0.012,tablet);box(0.25,0.34,0.01,mat.mint,0,0,0.022,0.004,tablet);
const clip=new THREE.Group();clip.position.set(0.04,-0.5,0.1);clip.rotation.x=1.2;armL.add(clip);box(0.3,0.42,0.03,mat.wood,0,0,0,0.012,clip);box(0.25,0.33,0.01,mat.paper,0,-0.02,0.02,0.004,clip);box(0.12,0.05,0.03,mat.steel,0,0.19,0.02,0.01,clip);
const opBlob=blob(0,0,1.15,1.15,0.34);
const op={x:0,z:0,rot:0,trot:0,v:0,reg:0,queue:[],cur:null,busy:false,walk:0,si:0,carry:false,hold:false,sampleDelta:0,act:null,gone:false,aL:0,aR:0};
function say(t){Lg.say.el.textContent=t;Lg.say.on=!!t;}
function angDiff(a,b){let d=(b-a)%(Math.PI*2);if(d>Math.PI)d-=Math.PI*2;if(d<-Math.PI)d+=Math.PI*2;return d;}
function opDo(steps,busy){op.queue=steps.slice();op.cur=null;op.busy=busy!==false;op.act=null;op.hold=false;}
// Routes: each line's inside is one region, the side aisle is another. Moving between regions goes through the line's open end.
function Plan(){this.reg=op.reg;this.steps=[];}
Plan.prototype.go=function(pt,reg,x){x=x||{};const via=[];if(this.reg!==reg){if(this.reg!=='aisle')via.push({to:LINES[this.reg].pt.ENT,reg:'aisle'});if(reg!=='aisle')via.push({to:LINES[reg].pt.ENT,reg:'aisle'});}
  via.push({to:pt,reg});if(x.speed)for(const v of via)v.speed=x.speed;if(x.say!==undefined)via[0].say=x.say;const last=via[via.length-1];if(x.face!==undefined)last.face=x.face;if(x.fn)last.fn=x.fn;
  for(const v of via)this.steps.push(v);this.reg=reg;return this;};
Plan.prototype.wait=function(t,x){this.steps.push(Object.assign({wait:t},x||{}));return this;};
const plan=()=>new Plan();
function opLeave(){say('');opDo(plan().go(DOOR_IN,'aisle',{speed:0.4}).steps.concat([{to:DOOR_OUT,speed:0.4,fn(){op.gone=true;opG.visible=false;if(dark.on)dark.target=1;}}]));}
function opReturn(){if(op.gone){op.gone=false;opG.visible=true;op.x=DOOR_OUT[0];op.z=DOOR_OUT[1];op.reg='aisle';op.rot=op.trot=Math.PI/2;opDo([{to:DOOR_IN,reg:'aisle'}]);}else opDo([]);}
// now and then the operator lifts a potato off the belt, looks at it and puts it back
function opPick(){const L=LINES[op.reg],back=state.mode===0;
  opDo(plan().go(back?L.pt.PICK_BACK:L.pt.PICK_FRONT,L.i,{face:back?Math.PI:0,say:''}).wait(0.35,{act:'reach',fn(){op.hold=true;}}).wait(1.1,{act:'inspect',say:'Checking one by hand'})
    .wait(0.3,{act:'reach',fn(){op.hold=false;state.pickAt=state.real+10+rnd()*6;}}).steps,false);state.pickAt=state.real+99;}
function opIdle(){
  if(state.mode===0){const nx=state.samples.find(s=>!s.done),L=LINES[nx?nx.li:(op.reg==='aisle'?0:op.reg)],b=L.pt.BENCH;
    if(Math.hypot(b[0]-op.x,b[1]-op.z)>0.05)return plan().go(b,L.i,{face:-Math.PI/2,say:''}).steps;op.trot=-Math.PI/2;say(state.started?'Waiting for the next sample':'');return null;}
  if(state.mode===1){if(Math.hypot(DESK.stand[0]-op.x,DESK.stand[1]-op.z)>0.05)return plan().go(DESK.stand,DESK.reg,{face:DESK.face,say:''}).steps;op.trot=DESK.face;say(NL>1?'Watching both lines':'Watching the dashboard');return null;}
  op.si=(op.si+1)%(4*NL);const L=LINES[Math.floor(op.si/4)];return plan().go(L.pt.STROLL[op.si%4],L.i,{say:'Free for other work'}).steps;}
function opUpdate(dt){
  if(op.gone)return;
  op.rot+=clamp(angDiff(op.rot,op.trot),-dt*11,dt*11);
  if(!op.cur){op.cur=op.queue.shift()||null;
    if(!op.cur){op.busy=false;op.act=null;const st=opIdle();if(!st)return;op.queue=st;op.cur=op.queue.shift();}
    const c=op.cur;if(c.say!==undefined)say(c.say);if(c.wait!==undefined)c.left=c.wait;op.act=c.act||null;
    if(c.to){const hd=Math.atan2(c.to[0]-op.x,c.to[1]-op.z);c.hold=Math.abs(angDiff(op.rot,hd))>1.3?0.14:0;op.trot=hd;}}
  const c=op.cur;let done=false;
  if(c.to){if(c.hold>0){c.hold-=dt;}else{const dx=c.to[0]-op.x,dz=c.to[1]-op.z,d=Math.hypot(dx,dz);
      op.v=Math.min(OP_SPEED*(c.speed||1),Math.sqrt(2*45*d)+0.5,op.v+45*dt);const st=op.v*dt;
      if(d<=st||d<0.02){op.x=c.to[0];op.z=c.to[1];done=true;}else{op.x+=dx/d*st;op.z+=dz/d*st;op.trot=Math.atan2(dx,dz);op.walk+=st*1.6;}}}
  else if(c.wait!==undefined){c.left-=dt;done=c.left<=0;}else done=true;
  if(done){if(c.face!==undefined)op.trot=c.face;if(c.to)op.v=0;if(c.reg!==undefined)op.reg=c.reg;op.cur=null;op.act=null;if(c.fn)c.fn();}
}
function opRender(now,dt){const walking=state.running&&op.cur&&op.cur.to&&op.v>0.3;const amp=walking?Math.min(1,op.v/4):0,sw=Math.sin(op.walk)*0.75*amp;const w=Math.sin(now/110);
  opG.position.set(op.x,Math.abs(Math.sin(op.walk))*0.06*amp,op.z);opG.rotation.y=op.rot;opBlob.position.set(op.x,0.005,op.z);opBlob.visible=opG.visible;
  legL.rotation.x=sw;legR.rotation.x=-sw;let aL=-sw*0.8,aR=sw*0.8,hx=0;
  const hasTablet=state.mode===1&&!op.carry,hasClip=state.mode===2&&!op.carry;
  if(op.carry){aL=aR=-1.2;}else{if(hasTablet||hasClip)aL=-0.95;
    if(op.act==='press')aR=-1.45+w*0.12;else if(op.act==='grade'){aL=-0.85+w*0.2;aR=-0.85-w*0.2;hx=0.3;}
    else if(op.act==='reach'){aR=-1.0;hx=0.35;}else if(op.act==='inspect'){aR=-2.05+w*0.06;hx=-0.12;}
    else if(hasClip&&!walking){aR=-0.9+w*0.1;hx=0.25;}else if(hasTablet&&!walking)hx=0.2;}
  const k=Math.min(1,(dt||0.016)*14);op.aL+=(aL-op.aL)*k;op.aR+=(aR-op.aR)*k;armL.rotation.x=op.aL;armR.rotation.x=op.aR;headG.rotation.x+=(hx-headG.rotation.x)*k;
  tablet.visible=hasTablet;clip.visible=hasClip;handP.visible=op.hold;
  tray.visible=op.carry;for(const t of trayP)t.visible=op.carry;Lg.say.p.set(op.x,2.95,op.z);Lg.say.hp.set(op.x,1.3,op.z);Lg.say.force=op.busy||!!op.act;}

/* ---------- events, runs ---------- */
const fmtT=t=>{const m=Math.floor(t)+START_H*60;return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');};
function ev(text,L){const e=$('event');e.hidden=false;e.textContent=fmtT(state.t)+'  '+(L&&NL>1?'Line '+(L.i+1)+': ':'')+text;}
function resetLine(L){for(let i=L.fms.length-1;i>=0;i--)dropFM(L,i);
  Object.assign(L,{S:S0,spawnBatch:'A',peelBatch:'A',batchDue:null,over:0,off:0,driftAt:null,detectAt:null,correctAt:null,cam:{delta:S0-NEED.A,need:NEED.A,neg:0},hist:[],flash:0,fmFlash:0,
    cool:0.8,ctrl:0,settled:false,trimAnnounced:false,alerting:false,fmi:0,fmReached:0,fmEjected:0,gateT:0});populate(L);for(const p of L.pulses){p.k=1;p.m.visible=false;}}
function resetRun(mode){seed=7;Object.assign(state,{mode,started:false,complete:false,t:0,real:0,interv:0,spawn:0,alertQ:[],batchPressed:false});
  state.samples=NL>1?[{t:0,li:0},{t:30,li:1},{t:60,li:0}]:[{t:0,li:0},{t:60,li:0}];
  clearMarkers();LINES.forEach(resetLine);results[mode]=null;
  op.queue=[];op.cur=null;op.busy=false;op.carry=false;op.hold=false;op.act=null;op.v=0;op.si=0;
  if(mode===0){const b=LINES[0].pt.BENCH;op.x=b[0];op.z=b[1];op.reg=0;op.rot=op.trot=-Math.PI/2;}
  else if(mode===1){op.x=DESK.stand[0];op.z=DESK.stand[1];op.reg=DESK.reg;op.rot=op.trot=DESK.face;}
  else{const s=LINES[0].pt.STROLL[0];op.x=s[0];op.z=s[1];op.reg=0;}
  say('');state.pickAt=7+rnd()*3;
  for(const L of LINES){for(const g of L.ps)g.visible=mode>=1;for(const g of L.auto)g.visible=mode===2;L.lb.cam.on=L.lb.gate.on=mode>=1;L.lb.auto.on=mode===2;}
  deskG.visible=Lg.dash.on=mode>=1;
  $('event').hidden=true;story.finale=false;
  for(let i=0;i<3;i++)$('mode-'+i).setAttribute('aria-checked',String(i===mode));
  if(dark.on){if(op.gone)opG.visible=false;else opLeave();}}
function driftStat(key){let worst=-1,pending=null;for(const L of LINES){if(L.driftAt===null)continue;if(L[key]===null)pending=pending===null?L.driftAt:Math.min(pending,L.driftAt);else worst=Math.max(worst,L[key]-L.driftAt);}
  return{any:worst>=0||pending!==null,pending,worst};}
function snapshot(){const sum=k=>LINES.reduce((a,L)=>a+L[k],0);return{over:sum('over'),off:sum('off'),fm:sum('fmReached'),interv:state.interv,det:driftStat('detectAt'),cor:driftStat('correctAt'),t:state.t};}
function pressBatch(){if(state.batchPressed||state.complete)return;state.batchPressed=true;state.started=true;state.running=true;for(const L of LINES)L.batchDue=state.t+(NL>1&&L.i===0?10:0);}
function adjust(L,to,who){L.S=clamp(Math.round(to*2)/2,8,20);if(who)ev(who+' sets steam time to '+L.S.toFixed(1)+' s',L);}

function manualSample(li){const L=LINES[li];state.interv++;ev('Operator takes the hourly sample',L);
  opDo(plan().go(L.pt.SAMPLE,li,{face:Math.PI,say:'Taking the hourly sample'}).wait(0.4,{act:'press',fn(){op.carry=true;op.sampleDelta=L.S-NEED[L.peelBatch];}}).go(L.pt.BENCH,li,{face:-Math.PI/2})
    .wait(1.2,{act:'grade',say:'Grading the sample',fn(){op.carry=false;
      if(op.sampleDelta<0){if(L.driftAt!==null&&L.detectAt===null)L.detectAt=state.t;ev('Sample result: peel left on',L);
        opDo(plan().go(L.pt.HMI,li,{face:Math.PI,say:'Peel left on. Off to the peeler'}).wait(0.5,{act:'press',say:'Raising steam time',fn(){state.interv++;adjust(L,NEED[L.peelBatch]+3,'Operator');}}).steps);}
      else{ev('Sample result: in spec',L);opDo([{wait:1.4,say:'Sample is in spec'}]);}}}).steps);}
function answerAlert(L){const atDesk=Math.hypot(DESK.stand[0]-op.x,DESK.stand[1]-op.z)<0.3;opDo(plan().wait(atDesk?0.8:0.3,{say:atDesk?'Alert on the dashboard':'Alert on the tablet'}).go(L.pt.HMI,L.i,{face:Math.PI,say:'Off to the peeler'}).wait(0.5,{act:'press',say:'Changing steam time',fn(){state.interv++;adjust(L,L.cam.need+1,'Operator');L.cool=state.real+3;L.alerting=false;}}).steps);}

/* ---------- simulation step ---------- */
function stepLine(L,dt,dtMin){
  if(L.flash>0)L.flash-=dt;if(L.fmFlash>0)L.fmFlash-=dt;if(L.gateT>0)L.gateT-=dt;
  if(L.batchDue!==null&&L.spawnBatch==='A'&&state.t>=L.batchDue){L.spawnBatch='B';L.lb.batch.pin=performance.now()+4500;ev('A thicker-skinned batch arrives at intake',L);}
  if(L.fmi<FM_TIMES.length&&state.t>=FM_TIMES[L.fmi]+L.i*4){spawnFM(L,FM_KINDS[(L.fmi+L.i)%3]);L.fmi++;}
  const sorterX=-2.5*SC,sorterZ=L.z0+3.2*SC,gateX=3.2*SC,gateZ=L.z0-3.2*SC;
  for(let i=L.items.length-1;i>=0;i--){const it=L.items[i];
    if(it.rej){it.rej.t+=dt/0.55;const k=it.rej.t;it.x=sorterX+it.lane*0.2;it.y=1.5+Math.sin(Math.min(k,1)*Math.PI)*0.5-k*0.9;it.z=sorterZ+0.4+k*1.6;if(k>=1){it.dead=true;L.items.splice(i,1);}continue;}
    it.s+=BELT*dt;
    if(!it.peeled&&it.s>=AT.peel){peel(it,L.S);if(L.peelBatch!==it.batch){L.peelBatch=it.batch;if(it.delta<0&&L.driftAt===null)L.driftAt=state.t;}}
    if(!it.seen&&it.s>=AT.cam){it.seen=true;if(state.mode>=1){const c=L.cam;c.delta+=(it.delta-c.delta)*0.08;c.need+=(it.need-c.need)*0.14;c.neg=it.delta<-0.05?c.neg+1:0;if(it.under){flag(markers,it,1.7);L.flash=0.45;}}}
    if(!it.cut&&it.s>=AT.cut)it.cut=true;
    if(it.s>=AT.sort&&it.under){it.rej={t:0};continue;}
    if(it.s>=AT.end+0.95){it.dead=true;L.items.splice(i,1);continue;}
    it.rot+=it.spin*dt;if(it.y>1.24)it.tilt+=it.spin*dt*3;
    place(it,L);}
  // foreign material
  for(let i=L.fms.length-1;i>=0;i--){const f=L.fms[i];
    if(f.out){f.out.t+=dt/0.5;const k=f.out.t;if(f.out.gate){f.x=gateX;f.y=1.3+Math.sin(Math.min(k,1)*Math.PI)*0.45-k*0.75;f.z=gateZ+0.3+k*1.15;}else{f.x=sorterX;f.y=1.5+Math.sin(Math.min(k,1)*Math.PI)*0.5-k*0.9;f.z=sorterZ+0.4+k*1.6;}
      f.mesh.rotation.x+=dt*9;if(k>=1)dropFM(L,i);continue;}
    f.s+=BELT*dt;
    if(state.mode>=1){if(!f.seen&&f.s>=AT.cam){f.seen=true;flag(fmMarkers,f,0.9);L.fmFlash=0.7;}
      if(f.s>=AT.gate){f.out={t:0,gate:true};L.fmEjected++;L.gateT=0.28;ev('Qualify spots a piece of '+(f.kind==='wood'?'wood':f.kind)+', the gate ejects it',L);continue;}}
    else{if(!f.cutSeen&&f.s>=AT.cut){f.cutSeen=true;L.fmReached++;ev('A piece of '+(f.kind==='wood'?'wood':f.kind)+' goes into the cutter unseen',L);}
      if(f.s>=AT.sort){f.out={t:0,gate:false};continue;}}
    place(f,L);}
  const d=L.S-NEED[L.peelBatch];
  L.over+=Math.max(0,d)*OVER_PER_S*KG_MIN*dtMin;
  L.off+=clamp(-d*0.1,0,0.25)*KG_MIN*dtMin;
  if(L.driftAt!==null&&L.correctAt===null&&d>=0)L.correctAt=state.t;
  if(state.mode>=1&&state.real%0.5<dt){const p=L.pulses.find(p=>p.k>=1);if(p){p.k=0;p.pts=L.lineA;p.m.visible=true;}}
  if(state.mode===1){
    if(L.driftAt!==null&&L.detectAt===null&&L.cam.neg>=9){L.detectAt=state.t;if(L.alerting)ev('Qualify alert: peel left on',L);}
    if(!L.alerting&&state.real>L.cool){const kind=L.cam.neg>=9?'under':L.cam.delta>1.9?'over':null;
      if(kind){L.alerting=true;ev(kind==='under'?'Qualify alert: peel left on':'Qualify alert: over-peeling',L);state.alertQ.push(L);}}
  }else if(state.mode===2){
    if(L.driftAt!==null&&L.detectAt===null&&L.cam.neg>=9){L.detectAt=state.t;ev('AutoControl: peel left on, raising steam time',L);L.settled=false;}
    L.ctrl+=dt;if(L.ctrl>=0.3){L.ctrl-=0.3;const e=L.cam.need+0.5-L.S;
      if(Math.abs(e)>0.05){if(!L.trimAnnounced){L.trimAnnounced=true;ev('AutoControl trims steam time to what this batch needs',L);}L.S=clamp(L.S+clamp(e,-0.25,1.5),8,20);L.settled=false;const p=L.pulses.find(p=>p.k>=1);if(p){p.k=0;p.pts=L.lineB;p.m.visible=true;}}
      else if(!L.settled){L.settled=true;ev('AutoControl holds steam time at '+L.S.toFixed(1)+' s',L);}}
  }
  L.puffAcc+=dt*L.S/5;if(L.puffAcc>=1){L.puffAcc=0;const p=L.puffs.find(p=>p.life<=0);if(p){p.life=1;p.m.position.set(-3.0-3.5*K+(rnd()-0.5)*0.2,3.8,-3.4-3.2*K);}}
  const h=L.hist;if(!h.length||state.t-h[h.length-1].t>=0.4)h.push({t:state.t,S:L.S,N:NEED[L.peelBatch]});
}
function step(dt){
  state.real+=dt;const dtMin=dt*MIN_PER_SEC;state.t+=dtMin;
  state.spawn+=dt;while(state.spawn>=SPAWN_DT){state.spawn-=SPAWN_DT;for(const L of LINES)spawn(L,AT.spawn,L.spawnBatch);}
  for(const L of LINES)stepLine(L,dt,dtMin);
  for(const m of markers)if(m.it)m.t-=dt;for(const m of fmMarkers)if(m.it)m.t-=dt;
  if(!op.busy&&!op.gone){
    if(state.mode===0){const s=state.samples.find(s=>!s.done&&state.t>=s.t);if(s){s.done=true;manualSample(s.li);}}
    else if(state.mode===1&&state.alertQ.length)answerAlert(state.alertQ.shift());
    if(!op.busy&&!dark.on&&!op.act&&op.reg!=='aisle'&&(state.mode!==0||!op.cur)&&state.real>state.pickAt&&!(state.mode===0&&state.samples.some(s=>!s.done&&s.t-state.t<12)))opPick();}
  opUpdate(dt);
  if(story.active&&!state.batchPressed&&state.t>=STORY_BATCH_AT)pressBatch();
  if(state.t>=RUN_MIN&&dark.on){const keep=LINES.map(L=>L.S);resetRun(2);LINES.forEach((L,i)=>{L.S=keep[i];L.cam.delta=keep[i]-NEED.A;});state.started=true;state.running=true;return;}
  if(state.t>=RUN_MIN){state.t=RUN_MIN;state.running=false;state.complete=true;ev('End of the 08:00 to 09:30 window');if(story.active)story.wait=2.6;}
  results[state.mode]=snapshot();
}

/* ---------- UI ---------- */
const app=$('app'),tab=$('tab');let panelOpen=false;
function setPanel(o){panelOpen=o;app.classList.toggle('closed',!o);tab.setAttribute('aria-expanded',String(o));tab.textContent=o?'Hide scoreboard':'Open scoreboard';}
tab.addEventListener('click',()=>setPanel(!panelOpen));tab.addEventListener('pointerdown',e=>e.stopPropagation());
const kg=v=>(Math.round(v/10)*10).toLocaleString('en-US')+' kg';
function setCell(id,text,cls){const el=$(id);if(el.textContent!==text)el.textContent=text;const c=cls||'';if(el.className!==c)el.className=c;}
// per-line readouts in the panel
const reads=$('q-reads');for(const L of LINES){const d=document.createElement('div');d.className='reads';
  d.innerHTML='<div class="read"><span>'+tag(L)+'potatoes with peel left on</span><b>0%</b></div><div class="read"><span>'+tag(L)+'steam time beyond what\'s needed</span><b>0.0 s</b></div>';reads.appendChild(d);const b=d.querySelectorAll('b');L.rdU=b[0];L.rdO=b[1];}
if(NL>1){document.querySelector('.top h1').textContent='Two fry lines, with and without Polysense';$('sb-tag').textContent='08:00 to 09:30 · '+NL+' lines';$('lg-extra').hidden=false;}
function captionText(){
  const m=state.mode,name=['Manual','Qualify','Qualify + AutoControl'][m],two=NL>1;
  const drifted=LINES.filter(L=>L.driftAt!==null),drift=drifted.length>0,det=drift&&drifted.every(L=>L.detectAt!==null),cor=drift&&drifted.every(L=>L.correctAt!==null);
  if(dark.on){
    if(!op.gone)return'<b>Lights out.</b> The operator leaves the floor.';
    if(!drift&&!state.batchPressed)return'<b>Dark factory.</b> The only lights still on are Polysense\'s. The '+(two?'lines keep':'line keeps')+' running.';
    if(!cor)return'<b>Dark factory.</b> A thicker-skinned batch arrives. The setpoint moves on its own.';
    return'<b>Dark factory.</b> Back in spec. Nobody was here to see it.';}
  if(story.finale)return'<b>Same '+(two?'lines':'line')+', same potatoes.</b> Three outcomes, side by side on the scoreboard.';
  if(!state.started)return'<b>'+name+'.</b> Press play for the story, or pick a mode. New batch arrives sends thicker-skinned potatoes down the line.';
  if(state.complete)return'<b>'+name+'.</b> End of the window. Pick another mode to compare.';
  const coming='<b>'+name+'.</b> A thicker-skinned batch is on its way to the peeler.';
  if(m===0){
    if(!drift&&!state.batchPressed)return two?'<b>Manual.</b> One operator samples each line once an hour. Both run a long, safe steam time, so every potato comes out a little too small.':'<b>Manual.</b> The peeler runs a long, safe steam time. The hourly sample says in spec, yet every potato comes out a little too small.';
    if(!drift)return coming;
    if(!det)return two?'<b>Manual.</b> Peel is staying on and the sorters are throwing product out. Each line waits for its next hourly sample.':'<b>Manual.</b> Peel is staying on, and the sorter is throwing product out. Nobody will know why until the 09:00 sample.';
    if(!cor)return'<b>Manual.</b> The sample caught it. The operator walks to the peeler.';
    return two?'<b>Manual.</b> Both lines are back in spec long after the batch changed, with a generous safety margin again.':'<b>Manual.</b> Back in spec most of an hour late, with a generous safety margin again.';}
  if(m===1){
    if(!drift&&!state.batchPressed)return two?'<b>Qualify.</b> A camera on each line measures every potato after washing. One dashboard flags over-peeling straight away, and the operator trims each peeler.':'<b>Qualify.</b> A camera measures every potato after washing. It flags over-peeling straight away, and the operator trims the steam time.';
    if(!drift)return coming;
    if(!det)return'<b>Qualify.</b> The new batch has left the peeler and is about to pass the camera.';
    if(!cor)return two?'<b>Qualify.</b> The alerts fire within minutes. One person still has to walk to each peeler and change the setting.':'<b>Qualify.</b> The alert fires within minutes. A person still has to walk over and change the setting.';
    return two?'<b>Qualify.</b> Fixed in minutes instead of most of an hour. The operator is still the control loop, now for two lines.':'<b>Qualify.</b> Fixed in minutes instead of most of an hour. The operator is still the control loop.';}
  if(!drift&&!state.batchPressed)return two?'<b>Qualify + AutoControl.</b> Each camera reading sets its own peeler. Steam time glides down to what each batch needs.':'<b>Qualify + AutoControl.</b> The camera reading sets the peeler directly. Steam time glides down to what this batch needs.';
  if(!drift)return coming;
  if(!cor)return two?'<b>Qualify + AutoControl.</b> The setpoints move on their own, with nobody touching either peeler.':'<b>Qualify + AutoControl.</b> The setpoint moves on its own, with nobody touching the peeler.';
  return two?'<b>Qualify + AutoControl.</b> In spec again on both lines. The operator never opened it.':'<b>Qualify + AutoControl.</b> In spec again. The operator never opened it.';}
let lastCap='',runKey='';
const ICON={play:'<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 2.3v11.4l9-5.7z"/></svg>',pause:'<svg viewBox="0 0 16 16" fill="currentColor"><path d="M3.5 2.5h3.2v11H3.5zM9.3 2.5h3.2v11H9.3z"/></svg>',
  rerun:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.75"/><path d="M13.3 2.2v3.2h-3.2"/></svg>'};
function driftCell(id,st,r,live,on,none){if(!st.any){setCell(id,'–','none');return;}
  if(st.pending!==null)setCell(id,live?Math.round(r.t-st.pending)+' min…':none,'wait');else setCell(id,Math.max(1,Math.round(st.worst))+' min',on);}
function updateUI(){
  $('clock').textContent=fmtT(state.t);$('bar').style.width=(state.t/RUN_MIN*100).toFixed(1)+'%';
  for(let m=0;m<3;m++){const r=results[m],on=m===state.mode?'col-on':'';$('h'+m).className=on;
    if(!r){for(const k of['over','off','fm','int','det','cor'])setCell(k+'-'+m,'–','none');continue;}
    setCell('over-'+m,kg(r.over),on);setCell('off-'+m,kg(r.off),on);setCell('fm-'+m,String(r.fm),r.fm>0?'wait':on);setCell('int-'+m,String(r.interv),on);
    const live=m===state.mode&&!state.complete;driftCell('det-'+m,r.det,r,live,on,'not noticed');driftCell('cor-'+m,r.cor,r,live,on,'not fixed');}
  $('score').classList.toggle('finale',story.finale);
  const q=state.mode>=1;$('q-blind').hidden=q;reads.hidden=!q;$('q-title').textContent=q?'What Qualify sees':'What the plant sees';
  if(!q)$('q-next').textContent=state.t<60?'09:00':'10:00';
  for(const L of LINES){const lb=L.lb;
    if(q){const u=Math.round(clamp(-L.cam.delta*0.1,0,0.25)*100),o=Math.max(0,L.cam.delta);L.rdU.textContent=u+'%';L.rdU.className=u>2?'hot':'';L.rdO.textContent='+'+o.toFixed(1)+' s';L.rdO.className=o>1.9?'hot':'';}
    const B=L.spawnBatch==='B';lb.batch.el.innerHTML=tag(L)+(B?'Batch B<small>thick skin</small>':'Batch A<small>thin skin</small>');lb.batch.el.classList.toggle('warn',B);
    lb.plT.textContent=tag(L)+'Peeler · steam '+L.S.toFixed(1)+' s';lb.plS.textContent='good potato lost: '+kg(L.over);lb.peeler.el.classList.toggle('ps',state.mode===2);
    const fmHit=L.fmFlash>0&&q,hit=L.flash>0&&q;lb.cam.el.classList.toggle('alarm',fmHit);lb.cam.el.classList.toggle('hit',hit&&!fmHit);
    const cs=fmHit?'foreign material: ejected':hit?'peel left on: flagged':'every potato, inline';if(lb.camS.textContent!==cs)lb.camS.textContent=cs;
    const gs='fired by Qualify · '+L.fmEjected+' ejected';if(lb.gateS.textContent!==gs)lb.gateS.textContent=gs;lb.gate.pin=L.gateT>0?performance.now()+2500:lb.gate.pin;
    lb.rej.el.textContent='Off-spec: '+kg(L.off);lb.rej.on=L.off>5;
    L.rejFill.scale.y=clamp(L.off/4000,0.02,1);L.rejFill.position.y=0.1+0.35*L.rejFill.scale.y;}
  const rk=state.complete?'rerun':state.running?'pause':state.started?'play':'none';if(rk!==runKey){runKey=rk;const b=$('btn-run');b.hidden=rk==='none';if(rk!=='none'){b.innerHTML=ICON[rk];const t=rk==='rerun'?'Run this mode again':rk==='pause'?'Pause':'Resume';b.setAttribute('aria-label',t);b.title=t;}}
  $('btn-batch').disabled=state.batchPressed||state.complete||story.active;if(op.gone&&Lg.say.on)say('');
  $('lg-set').style.borderTopColor=state.mode===2?'var(--mint)':'var(--fg)';
  const cp=captionText();if(cp!==lastCap){lastCap=cp;$('caption').innerHTML=cp;}
}
const css=getComputedStyle(document.documentElement);const col=n=>css.getPropertyValue(n).trim();
function trace(cx,hs,X,Y,lineCol,needCol,lw,alpha){if(!hs.length)return;cx.globalAlpha=alpha||1;
  cx.setLineDash([4,4]);cx.strokeStyle=needCol;cx.lineWidth=lw*0.75;cx.beginPath();hs.forEach((p,i)=>i?cx.lineTo(X(p.t),Y(p.N)):cx.moveTo(X(p.t),Y(p.N)));cx.stroke();cx.setLineDash([]);
  cx.strokeStyle=lineCol;cx.lineWidth=lw;cx.lineJoin='round';cx.beginPath();hs.forEach((p,i)=>i?cx.lineTo(X(p.t),Y(p.S)):cx.moveTo(X(p.t),Y(p.S)));cx.stroke();
  const e=hs[hs.length-1];cx.fillStyle=lineCol;cx.beginPath();cx.arc(X(e.t),Y(e.S),lw*1.75,0,7);cx.fill();cx.globalAlpha=1;}
const chart=$('chart'),cx=chart.getContext('2d');
function drawChart(){const dpr=Math.min(window.devicePixelRatio||1,2),w=chart.clientWidth,h=chart.clientHeight;if(!w)return;if(chart.width!==Math.round(w*dpr)){chart.width=Math.round(w*dpr);chart.height=Math.round(h*dpr);}
  cx.setTransform(dpr,0,0,dpr,0,0);cx.clearRect(0,0,w,h);const l=34,r=10,t=8,b=20,pw=w-l-r,ph=h-t-b,Y0=8,Y1=20;
  const X=v=>l+v/RUN_MIN*pw,Y=v=>t+(1-(v-Y0)/(Y1-Y0))*ph;cx.font='10px '+col('--font-body');cx.lineWidth=1;
  cx.strokeStyle=col('--panel-line');cx.fillStyle=col('--muted');cx.textAlign='right';cx.textBaseline='middle';
  for(const v of[8,12,16,20]){cx.beginPath();cx.moveTo(l,Y(v));cx.lineTo(w-r,Y(v));cx.stroke();cx.fillText(v+' s',l-6,Y(v));}
  cx.textBaseline='top';for(const v of[0,30,60,90]){cx.textAlign=v===0?'left':v===90?'right':'center';cx.fillText(fmtT(v),X(v),h-b+6);}
  const c=state.mode===2?col('--mint'):col('--fg');for(let i=LINES.length-1;i>=0;i--)trace(cx,LINES[i].hist,X,Y,i?col('--amber'):c,col('--muted'),i?1.6:2,1);}
function drawSpark(L){const sp=L.lb.spark,h=panelOpen||!state.started;if(sp.hidden!==h)sp.hidden=h;if(h)return;const sx=sp.getContext('2d');sx.setTransform(2,0,0,2,0,0);sx.clearRect(0,0,96,24);
  trace(sx,L.hist,v=>3+v/RUN_MIN*90,v=>2+(1-(v-8)/12)*20,state.mode===2?col('--mint'):col('--fg'),col('--muted'),1.6,1);}

/* ---------- controls ---------- */
function start(){if(state.complete)resetRun(state.mode);state.started=true;state.running=true;}
for(let i=0;i<3;i++)$('mode-'+i).addEventListener('click',()=>{story.active=false;story.wait=0;if(!state.complete)results[state.mode]=null;resetRun(i);start();});
$('btn-run').addEventListener('click',()=>{if(state.running){state.running=false;}else start();});
$('btn-batch').addEventListener('click',pressBatch);
$('btn-reset').addEventListener('click',()=>{setDark(false,true);story.active=false;story.wait=0;results[0]=results[1]=results[2]=null;resetRun(0);state.running=false;});
$('btn-story').addEventListener('click',()=>{results[0]=results[1]=results[2]=null;story.active=true;story.wait=0;setPanel(false);resetRun(0);start();});
let actx=null;
function clickSound(){try{actx=actx||new(window.AudioContext||window.webkitAudioContext)();if(actx.state==='suspended')actx.resume();const t=actx.currentTime;
  for(const[dt,g0,f]of[[0,0.5,1900],[0.055,0.28,1300]]){const len=Math.floor(actx.sampleRate*0.03),buf=actx.createBuffer(1,len,actx.sampleRate),d=buf.getChannelData(0);
    for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,3);const n=actx.createBufferSource();n.buffer=buf;const bp=actx.createBiquadFilter();bp.type='bandpass';bp.frequency.value=f;bp.Q.value=1.2;
    const g=actx.createGain();g.gain.value=g0;n.connect(bp);bp.connect(g);g.connect(actx.destination);n.start(t+dt);}
  const o=actx.createOscillator(),og=actx.createGain();o.frequency.setValueAtTime(170,t);o.frequency.exponentialRampToValueAtTime(70,t+0.08);og.gain.setValueAtTime(0.3,t);og.gain.exponentialRampToValueAtTime(0.001,t+0.1);
  o.connect(og);og.connect(actx.destination);o.start(t);o.stop(t+0.11);}catch(e){}}
const ropeBtn=$('rope'),ropeG=$('rope-g'),ropeL=$('rope-l'),ropeH=$('rope-h');
const rope={y:0,vy:0,a:0,va:0,drag:null,auto:0,maxY:0};
function setDark(on,quiet){if(dark.on===on)return;dark.on=on;document.body.classList.toggle('dark',on);ropeBtn.setAttribute('aria-pressed',String(on));if(!quiet)clickSound();dark.flick=0.28;
  for(let i=0;i<3;i++)$('mode-'+i).disabled=on;$('btn-story').disabled=on;
  if(on){story.active=false;story.wait=0;story.finale=false;dark.target=0.55;
    if(state.mode!==2){if(!state.complete)results[state.mode]=null;resetRun(2);start();}else{start();if(!op.gone)opLeave();}}
  else{dark.target=0;opReturn();}}
ropeBtn.addEventListener('pointerdown',e=>{e.stopPropagation();try{ropeBtn.setPointerCapture(e.pointerId);}catch(_){}rope.drag={x:e.clientX,y:e.clientY};rope.maxY=0;rope.auto=0;});
ropeBtn.addEventListener('pointermove',e=>{if(!rope.drag)return;const dy=clamp(e.clientY-rope.drag.y,0,90);rope.y=dy;rope.vy=0;rope.a=clamp((e.clientX-rope.drag.x)*0.35,-28,28);rope.va=0;rope.maxY=Math.max(rope.maxY,dy);});
ropeBtn.addEventListener('pointerup',()=>{if(!rope.drag)return;rope.drag=null;if(rope.maxY>=36){rope.va+=40;setDark(!dark.on);}else if(rope.maxY<6)rope.auto=0.16;});
ropeBtn.addEventListener('pointercancel',()=>{rope.drag=null;});
ropeBtn.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(rope.auto<=0&&!rope.drag)rope.auto=0.16;}});
function ropeTick(dt){
  if(rope.auto>0){rope.auto-=dt;rope.y+=(58-rope.y)*Math.min(1,dt*24);rope.vy=0;if(rope.auto<=0){rope.va+=40;setDark(!dark.on);}}
  else if(!rope.drag){const n=Math.max(1,Math.ceil(dt/0.008)),h=dt/n;for(let i=0;i<n;i++){rope.vy+=(-260*rope.y-11*rope.vy)*h;rope.y+=rope.vy*h;rope.va+=(-60*rope.a-3.2*rope.va)*h;rope.a+=rope.va*h;}}
  ropeL.setAttribute('y2',(96+rope.y).toFixed(1));ropeH.setAttribute('transform','translate(0,'+rope.y.toFixed(1)+')');ropeG.setAttribute('transform','rotate('+rope.a.toFixed(2)+' 28 0)');}
function darkTick(dt,now){dark.k+=clamp(dark.target-dark.k,-dt*2.4,dt*2.4);if(dark.flick>0)dark.flick-=dt;
  const e=clamp(dark.k+(dark.flick>0?Math.sin(now/16)*0.25*(dark.flick/0.28):0),0,1);
  hemi.intensity=BASE_H*(1-e)+0.055*e;sideSun.intensity=0.16*(1-e);for(const pm of pools)pm.material.opacity=0.42*(1-e);sun.intensity=BASE_S*(1-e)+0.02*e;fill.intensity=BASE_F*(1-e);mat.win.emissiveIntensity=0.75*(1-e)+0.02;dashLight.intensity=0.8*e;
  mat.mint.emissiveIntensity=0.55+0.6*e;mat.glass.emissiveIntensity=0.5*(1-e)+0.03;shadowPlane.material.opacity=0.3*(1-e);
  for(const L of LINES){L.camLight.intensity=2.6*e;L.lensMat.emissiveIntensity=0.55+0.6*e;}
  const near=!op.gone&&Math.hypot(op.x-DOOR_IN[0],op.z-DOOR_Z)<1.7;doorG.rotation.y+=((near?1.25:0)-doorG.rotation.y)*Math.min(1,dt*7);}
let drag=null;
function setZoom(z){zoom=clamp(z,0.6,6);cam.zoom=zoom;cam.updateProjectionMatrix();stage.style.setProperty('--tb',(2.6/Math.sqrt(zoom)).toFixed(2)+'px');}
function panBy(r,f){LOOK.x=clamp(LOOK.x+Math.cos(yaw)*r-Math.sin(yaw)*f,X0-2,X1+2);LOOK.z=clamp(LOOK.z-Math.sin(yaw)*r-Math.cos(yaw)*f,Z0-2,Z1+2);placeCam();}
function zoomAt(cx,cy,f){const r=stage.getBoundingClientRect(),nx=((cx-r.left)/W)*2-1,ny=1-((cy-r.top)/H)*2,z0=zoom;setZoom(zoom*f);const k=1/z0-1/zoom;panBy(nx*HH*(W/H)*k,ny*HH*k/Math.sin(el));}
function zoomCentre(f){const r=stage.getBoundingClientRect();zoomAt(r.left+W/2,r.top+H/2,f);}
function resetView(){yaw=Math.PI/4;el=33*Math.PI/180;LOOK.set(CXS,1.3,CZS);setZoom(1);placeCam();}
stage.addEventListener('pointerdown',e=>{const r=stage.getBoundingClientRect();mx=e.clientX-r.left;my=e.clientY-r.top;drag={x:e.clientX,y:e.clientY,pan:e.shiftKey||e.button===1||e.button===2};});
stage.addEventListener('contextmenu',e=>e.preventDefault());
stage.addEventListener('pointermove',e=>{const r=stage.getBoundingClientRect();mx=e.clientX-r.left;my=e.clientY-r.top;});
stage.addEventListener('pointerleave',()=>{mx=my=-999;});
window.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.x=e.clientX;drag.y=e.clientY;
  if(drag.pan){const u=2*HH/H/zoom;panBy(-dx*u,dy*u/Math.sin(el));}else{yaw-=dx*0.006;el=clamp(el+dy*0.004,0.22,1.3);placeCam();}});
window.addEventListener('pointerup',()=>{drag=null;});window.addEventListener('pointercancel',()=>{drag=null;});
stage.addEventListener('wheel',e=>{e.preventDefault();zoomAt(e.clientX,e.clientY,Math.exp(-e.deltaY*(e.ctrlKey?0.01:0.0015)));},{passive:false});
$('zoom').addEventListener('pointerdown',e=>e.stopPropagation());
$('z-in').addEventListener('click',()=>zoomCentre(1.25));$('z-out').addEventListener('click',()=>zoomCentre(0.8));$('z-home').addEventListener('click',resetView);
window.addEventListener('keydown',e=>{if(e.metaKey||e.ctrlKey||e.altKey)return;const t=e.target;if(t&&t.closest&&t.closest('input,textarea,select,summary'))return;
  const k=e.key;if(k==='+'||k==='=')zoomCentre(1.25);else if(k==='-'||k==='_')zoomCentre(0.8);else if(k==='0')resetView();
  else if(k==='ArrowLeft'){yaw+=0.15;placeCam();}else if(k==='ArrowRight'){yaw-=0.15;placeCam();}
  else if(k==='ArrowUp'){el=clamp(el+0.08,0.22,1.3);placeCam();}else if(k==='ArrowDown'){el=clamp(el-0.08,0.22,1.3);placeCam();}else return;e.preventDefault();});
(function(){const c=document.createElement('canvas');c.width=c.height=160;const g=c.getContext('2d'),im=g.createImageData(160,160);for(let i=0;i<im.data.length;i+=4){const v=Math.random()*255|0;im.data[i]=im.data[i+1]=im.data[i+2]=v;im.data[i+3]=255;}g.putImageData(im,0,0);try{$('grain').style.backgroundImage='url('+c.toDataURL()+')';}catch(e){}})();

/* ---------- main loop ---------- */
resetRun(0);resize();
if(window.ResizeObserver)new ResizeObserver(resize).observe(stage);else window.addEventListener('resize',resize);
let last=performance.now();
function frame(now){const raw=Math.min(0.1,(now-last)/1000);last=now;const live=state.running;
  if(state.running){let left=raw*speed;while(left>1e-6&&state.running){const d=Math.min(0.04,left);step(d);left-=d;}}
  else if(story.active&&story.wait>0){story.wait-=raw*speed;if(story.wait<=0){if(state.mode<2){resetRun(state.mode+1);start();}else{story.active=false;story.finale=true;setPanel(true);}}}
  if(live){const dx=BELT*raw*speed/0.8;for(const t of belts)t.offset.x-=dx;}
  for(const L of LINES){
    for(const p of L.pulses){if(p.k<1){p.k+=raw*(live?(p.pts===L.lineB?1.6:NL>1?0.9:1.6):0);const q=polyAt(p.pts,Math.min(p.k,1));p.m.position.set(q[0],0.16,q[1]);if(p.k>=1)p.m.visible=false;}}
    for(const p of L.puffs){if(p.life>0){if(live){p.life-=raw*0.9;p.m.position.y+=raw*0.9;p.m.scale.setScalar(1+(1-p.life)*1.6);}p.m.material.opacity=Math.max(0,p.life)*0.5;}}
    for(let i=0;i<L.jets.length;i++)L.jets[i].material.opacity=live?0.35+0.2*Math.sin(now/90+i*1.7):0.4;
    const fa=clamp(L.fmFlash/0.7,0,1),f=Math.max(clamp(L.flash/0.45,0,1),fa);L.coneMat.color.copy(COL.mint).lerp(fa>0?COL.alarm:COL.amber,f);L.coneMat.opacity=0.17+0.05*Math.sin(now/180)+f*0.4;
    L.lensMat.color.copy(L.coneMat.color);L.lensMat.emissive.copy(L.coneMat.color);L.scan.position.x=2.0+Math.sin(now/130)*0.5;L.scan.material.color.copy(L.coneMat.color);
    L.pusher.position.z=-3.84+(L.gateT>0?Math.sin((1-L.gateT/0.28)*Math.PI)*0.75:0);}
  ropeTick(raw);darkTick(raw,now);wallBack.visible=Math.cos(yaw)>-0.25;wallLeft.visible=Math.sin(yaw)>-0.25;
  syncItems();opRender(now,raw);updateUI();drawChart();for(const L of LINES)drawSpark(L);renderer.render(scene,cam);updateLabels(now);requestAnimationFrame(frame);}
requestAnimationFrame(frame);
window.__fryline={state,results,story,LINES,dark,op,setDark,setSpeed(n){speed=n;},view(y,e,z){yaw=y;el=e;setZoom(z||1);placeCam();}};
})();
