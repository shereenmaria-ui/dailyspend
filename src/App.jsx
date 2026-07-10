import { useState, useMemo, useRef, useCallback, useEffect } from "react";

// ─────────────────────────────────────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_CATS = {
  Food:          { color:"#6EE7B7", bg:"rgba(110,231,183,0.12)", icon:"🍜", locked:true },
  Transport:     { color:"#93C5FD", bg:"rgba(147,197,253,0.12)", icon:"🚌", locked:true },
  Utilities:     { color:"#FCA5A5", bg:"rgba(252,165,165,0.12)", icon:"⚡",  locked:true },
  Entertainment: { color:"#C4B5FD", bg:"rgba(196,181,253,0.12)", icon:"🎬", locked:true },
  Shopping:      { color:"#FCD34D", bg:"rgba(252,211,77,0.12)",  icon:"🛍️", locked:true },
};
const COLOR_PALETTE = [
  {color:"#F472B6",bg:"rgba(244,114,182,0.12)"}, {color:"#FB923C",bg:"rgba(251,146,60,0.12)"},
  {color:"#A78BFA",bg:"rgba(167,139,250,0.12)"}, {color:"#34D399",bg:"rgba(52,211,153,0.12)"},
  {color:"#60A5FA",bg:"rgba(96,165,250,0.12)"},  {color:"#FBBF24",bg:"rgba(251,191,36,0.12)"},
  {color:"#F87171",bg:"rgba(248,113,113,0.12)"}, {color:"#2DD4BF",bg:"rgba(45,212,191,0.12)"},
];
const EMOJI_OPTS = ["🏠","💊","🎓","✈️","🐾","💄","🎮","📱","🍕","☕","🏋️","🎵","🎁","🔧","📚","🌿","🏥","💼","🚗","🎯"];
const CURRENCIES = [
  {code:"USD",sym:"$"}, {code:"AED",sym:"AED"}, {code:"EUR",sym:"€"},  {code:"GBP",sym:"£"},
  {code:"SAR",sym:"﷼"},{code:"INR",sym:"₹"},  {code:"JPY",sym:"¥"},  {code:"CAD",sym:"CA$"},
  {code:"AUD",sym:"A$"},{code:"CHF",sym:"Fr"},  {code:"SGD",sym:"S$"}, {code:"QAR",sym:"ر.ق"},
  {code:"KWD",sym:"د.ك"},{code:"BHD",sym:"BD"}, {code:"OMR",sym:"ر.ع"},
];
const getSym   = code => CURRENCIES.find(c=>c.code===code)?.sym || code;
const MONTHS   = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const SMONTHS  = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const todayStr = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };

// ─────────────────────────────────────────────────────────────────────────────
//  LOCALSTORAGE
// ─────────────────────────────────────────────────────────────────────────────
const LS = {
  get: (k, fb) => { try { const v=localStorage.getItem(k); return v?JSON.parse(v):fb; } catch { return fb; } },
  set: (k, v)  => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del: (k)     => { try { localStorage.removeItem(k); } catch {} },
};

// ─────────────────────────────────────────────────────────────────────────────
//  API KEY MANAGEMENT
//  - Key stored in localStorage under "ds_apikey"
//  - Injected into every AI call via getKey()
//  - If running inside Claude.ai artifact env, key header is injected
//    automatically and we skip the key gate entirely (CLAUDE_ENV=true)
// ─────────────────────────────────────────────────────────────────────────────
const CLAUDE_ENV = typeof window !== "undefined" && !!window.__anthropic_artifact_env__;

const getKey = () => LS.get("ds_apikey", null);
const saveKey = (k) => LS.set("ds_apikey", k.trim());
const clearKey = () => LS.del("ds_apikey");

// ─────────────────────────────────────────────────────────────────────────────
//  AI HELPERS  — all use getKey(); CLAUDE_ENV skips auth header
// ─────────────────────────────────────────────────────────────────────────────
async function callAI(messages, maxTokens = 1500) {
  const headers = { "Content-Type": "application/json" };
  if (!CLAUDE_ENV) {
    const k = getKey();
    if (!k) throw new Error("NO_KEY");
    headers["x-api-key"] = k;
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  }
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers,
    body: JSON.stringify({ model:"claude-sonnet-5", max_tokens:maxTokens, messages }),
  });
  if (r.status === 401) throw new Error("INVALID_KEY");
  if (!r.ok) {
    const body = await r.json().catch(()=>null);
    throw new Error(body?.error?.message ? `API error (${r.status}): ${body.error.message}` : `API_${r.status}`);
  }
  const d = await r.json();
  return (d.content?.find(b=>b.type==="text")?.text||"")
    .replace(/```json\s*/g,"").replace(/```\s*/g,"").trim();
}

const AI = {
  nlp: async (text, currency, cats) =>
    JSON.parse(await callAI([{ role:"user", content:
      `Extract expense from natural language. Return ONLY valid JSON, no markdown.
Today:${todayStr()}. Default currency:${currency}. Categories:${cats.join(",")}.
{"name":"≤40 chars","amount":number,"currency":"ISO","category":"one of categories","date":"YYYY-MM-DD","interpreted":"one sentence"}
User:"${text}"` }])),

  parseText: async (text, cats) =>
    JSON.parse(await callAI([{ role:"user", content:
      `Extract ALL expense transactions. Return ONLY a valid JSON array, no markdown.
Categories:${cats.join(",")}. Each:{"name":"≤40","amount":positive number,"currency":"ISO or USD","category":"one of categories","date":"YYYY-MM-DD or ${todayStr()}"}
Skip credits/refunds. Return [] if none.
Text:\n${text}` }])),

  parseImg: async (b64, mime, cats) =>
    JSON.parse(await callAI([{ role:"user", content:[
      { type:"image", source:{ type:"base64", media_type:mime, data:b64 } },
      { type:"text", text:`Extract ALL expenses. Return ONLY a valid JSON array, no markdown.
Categories:${cats.join(",")}. Each:{"name":"≤40","amount":positive,"currency":"ISO","category":"one of categories","date":"YYYY-MM-DD or ${todayStr()}"}. Return [].` },
    ]}])),

  forecast: async (expenses, budgets, currency, cats) => {
    const sym=getSym(currency), summary={};
    expenses.forEach(e=>{const mk=e.date.slice(0,7);if(!summary[mk])summary[mk]={};summary[mk][e.category]=(summary[mk][e.category]||0)+e.amount;});
    return JSON.parse(await callAI([{ role:"user", content:
      `Analyse spending. Generate predictive cash flow forecast. Return ONLY valid JSON, no markdown.
History(${sym}):${JSON.stringify(summary)}
Budget:${budgets.monthly?sym+budgets.monthly+"/mo":"none"}|${budgets.yearly?sym+budgets.yearly+"/yr":"none"}
Today:${todayStr()} Currency:${currency} Categories:${cats.join(",")}
{"nextMonthForecast":{"total":number,"byCategory":{${cats.map(c=>`"${c}":number`).join(",")}},"confidence":"high|medium|low"},"next3MonthsForecast":[{"month":"YYYY-MM","total":number,"trend":"up|down|stable"}],"insights":["≤120","≤120","≤120"],"scheduledPayments":[{"name":"str","estimatedAmount":number,"likelyDate":"YYYY-MM-DD","category":"str"}],"seasonalWarning":"str or null","budgetHealth":"on_track|at_risk|over_budget|no_budget"}` }], 1500));
  },

  testKey: async () => {
    await callAI([{ role:"user", content:"Reply with the single word OK." }], 10);
  },
};

const toB64 = f => new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=rej;r.readAsDataURL(f);});

// ─────────────────────────────────────────────────────────────────────────────
//  ICONS
// ─────────────────────────────────────────────────────────────────────────────
const mkI=(d,w=17,h=17)=>()=><svg aria-hidden="true" width={w} height={h} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{__html:d}}/>;
const IcoTrash = mkI('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>');
const IcoX     = mkI('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',14,14);
const IcoChk   = mkI('<polyline points="20 6 9 17 4 12"/>',13,13);
const IcoUp    = mkI('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',16,16);
const IcoChL   = mkI('<polyline points="15 18 9 12 15 6"/>',15,15);
const IcoChR   = mkI('<polyline points="9 18 15 12 9 6"/>',15,15);
const IcoSend  = mkI('<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>');
const IcoBot   = mkI('<rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/>');
const IcoPlus  = mkI('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>');
const IcoTag   = mkI('<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>');
const IcoKey   = mkI('<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>');
const IcoEye   = mkI('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>');
const IcoEyeOff= mkI('<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>');
const IcoSettings=mkI('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>');
const IcoTrUp  = ()=><svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FCA5A5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/></svg>;
const IcoTrDn  = ()=><svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6EE7B7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/></svg>;
const IcoMic   = ({on})=><svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill={on?"#FCA5A5":"none"} stroke={on?"#FCA5A5":"currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>;
const IcoChevD = ({open})=><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{transform:open?"rotate(180deg)":"none",transition:"transform 0.2s"}}><polyline points="6 9 12 15 18 9"/></svg>;

// ─────────────────────────────────────────────────────────────────────────────
//  FOCUS TRAP
// ─────────────────────────────────────────────────────────────────────────────
function useFocusTrap(ref) {
  useEffect(()=>{
    const el=ref.current; if(!el) return;
    const nodes=[...el.querySelectorAll('button,input,select,textarea,[tabindex]:not([tabindex="-1"])')];
    const first=nodes[0], last=nodes[nodes.length-1];
    const trap=e=>{if(e.key!=="Tab")return;if(e.shiftKey){if(document.activeElement===first){e.preventDefault();last?.focus();}}else{if(document.activeElement===last){e.preventDefault();first?.focus();}}};
    el.addEventListener("keydown",trap); first?.focus();
    return()=>el.removeEventListener("keydown",trap);
  },[]);
}

// ─────────────────────────────────────────────────────────────────────────────
//  API KEY SETTINGS PANEL  (in-app modal to add/update/remove key)
// ─────────────────────────────────────────────────────────────────────────────
function ApiKeySettings({ onClose }) {
  const [key, setKey]       = useState(getKey()||"");
  const [show, setShow]     = useState(false);
  const [status, setStatus] = useState("idle");
  const [errMsg, setErrMsg] = useState("");
  const modalRef = useRef(null);
  useFocusTrap(modalRef);

  const masked = (k) => k ? k.slice(0,12)+"…"+k.slice(-4) : "";

  const update = async () => {
    const k = key.trim();
    if (!k) { setErrMsg("Key cannot be empty."); setStatus("error"); return; }
    if (!k.startsWith("sk-ant-")) { setErrMsg("Doesn't look like an Anthropic key (should start with sk-ant-)"); setStatus("error"); return; }
    setStatus("testing"); setErrMsg("");
    saveKey(k);
    try {
      await AI.testKey();
      setStatus("ok");
      setTimeout(onClose, 800);
    } catch(e) {
      clearKey();
      setErrMsg(e.message==="INVALID_KEY"?"Key rejected by Anthropic — check it's correct.":e.message||"Connection error. Try again.");
      setStatus("error");
    }
  };

  const remove = () => { clearKey(); onClose(); };

  return (
    <div role="dialog" aria-modal="true" aria-label="API Key Settings"
      style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div ref={modalRef} style={{background:"#111827",border:"1px solid rgba(255,255,255,0.1)",borderRadius:20,width:"100%",maxWidth:420,overflow:"hidden",boxShadow:"0 24px 64px rgba(0,0,0,0.7)"}}>
        <div style={{padding:"18px 20px",borderBottom:"1px solid rgba(255,255,255,0.07)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:9}}>
            <IcoKey/>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:"#F8FAFC"}}>API Key Settings</div>
              <div style={{fontSize:11,color:"#64748B",marginTop:1}}>Update or remove your Anthropic key</div>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{background:"rgba(255,255,255,0.06)",border:"none",borderRadius:8,padding:8,cursor:"pointer",color:"#94A3B8",display:"flex",minWidth:36,minHeight:36,alignItems:"center",justifyContent:"center"}}><IcoX/></button>
        </div>

        <div style={{padding:20}}>
          {/* Current key status */}
          {getKey() ? (
            <div style={{padding:"10px 13px",background:"rgba(110,231,183,0.06)",border:"1px solid rgba(110,231,183,0.15)",borderRadius:10,marginBottom:16,display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:14}}>✅</span>
              <div>
                <div style={{fontSize:11,fontWeight:600,color:"#6EE7B7"}}>Active key</div>
                <div style={{fontSize:11,color:"#475569",fontFamily:"'SF Mono',Monaco,monospace",marginTop:1}}>{masked(getKey())}</div>
              </div>
            </div>
          ) : (
            <div style={{padding:"10px 13px",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,marginBottom:16,display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:14}}>➖</span>
              <div>
                <div style={{fontSize:11,fontWeight:600,color:"#94A3B8"}}>No key set</div>
                <div style={{fontSize:11,color:"#475569",marginTop:1}}>AI features are disabled until you add one.</div>
              </div>
            </div>
          )}

          <label htmlFor="key-update-inp" style={{fontSize:10,fontWeight:700,color:"#6EE7B7",display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.5px"}}>Replace with a new key</label>
          <div style={{position:"relative",marginBottom:12}}>
            <input id="key-update-inp" type={show?"text":"password"} value={key} onChange={e=>setKey(e.target.value)} onKeyDown={e=>e.key==="Enter"&&update()}
              placeholder="sk-ant-api03-…" autoComplete="off" spellCheck={false}
              style={{width:"100%",background:"rgba(255,255,255,0.06)",border:`1px solid ${status==="error"?"rgba(252,165,165,0.4)":status==="ok"?"rgba(110,231,183,0.4)":"rgba(255,255,255,0.1)"}`,borderRadius:9,padding:"10px 42px 10px 13px",color:"#F1F5F9",fontSize:12,outline:"none",fontFamily:"'SF Mono',Monaco,monospace",minHeight:44}}/>
            <button onClick={()=>setShow(s=>!s)} aria-label={show?"Hide":"Show"} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#475569",cursor:"pointer",display:"flex",padding:4}}>{show?<IcoEyeOff/>:<IcoEye/>}</button>
          </div>

          {status==="error" && <div role="alert" style={{fontSize:12,color:"#FCA5A5",padding:"7px 11px",background:"rgba(252,165,165,0.08)",borderRadius:8,marginBottom:12}}>⚠️ {errMsg}</div>}
          {status==="ok"    && <div role="status" style={{fontSize:12,color:"#6EE7B7",padding:"7px 11px",background:"rgba(110,231,183,0.08)",borderRadius:8,marginBottom:12}}>✅ Key updated!</div>}

          <div style={{display:"flex",gap:8}}>
            <button onClick={update} disabled={status==="testing"||status==="ok"}
              style={{flex:2,padding:"11px",borderRadius:10,border:"none",fontWeight:700,fontSize:13,cursor:status==="testing"||status==="ok"?"not-allowed":"pointer",minHeight:44,
                background:status==="testing"||status==="ok"?"rgba(255,255,255,0.06)":"linear-gradient(135deg,#34D399,#059669)",
                color:status==="testing"||status==="ok"?"#475569":"#fff"}}>
              {status==="testing"?"Verifying…":"Save New Key"}
            </button>
            <button onClick={remove} style={{flex:1,padding:"11px",borderRadius:10,border:"1px solid rgba(252,165,165,0.3)",background:"rgba(252,165,165,0.08)",color:"#FCA5A5",fontWeight:600,fontSize:12,cursor:"pointer",minHeight:44}}>
              🗑 Remove
            </button>
          </div>

          <div style={{marginTop:14,fontSize:11,color:"#334155",textAlign:"center"}}>
            Get or manage keys at <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer" style={{color:"#6EE7B7",textDecoration:"none"}}>console.anthropic.com</a>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  COLLAPSIBLE SECTION
// ─────────────────────────────────────────────────────────────────────────────
function Section({ title, icon, badge, defaultOpen=true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{marginTop:12}}>
      <button onClick={()=>setOpen(o=>!o)} aria-expanded={open}
        style={{width:"100%",display:"flex",alignItems:"center",gap:8,padding:"10px 14px",background:"rgba(255,255,255,0.035)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:open?"12px 12px 0 0":12,cursor:"pointer",textAlign:"left"}}>
        {icon&&<span aria-hidden="true" style={{fontSize:14}}>{icon}</span>}
        <span style={{fontSize:11,fontWeight:700,color:"#94A3B8",textTransform:"uppercase",letterSpacing:"0.8px",flex:1}}>{title}</span>
        {badge&&<span style={{fontSize:10,fontWeight:600,color:"#475569",background:"rgba(255,255,255,0.06)",padding:"2px 8px",borderRadius:10}}>{badge}</span>}
        <IcoChevD open={open}/>
      </button>
      {open&&<div style={{border:"1px solid rgba(255,255,255,0.07)",borderTop:"none",borderRadius:"0 0 12px 12px",padding:16,background:"rgba(255,255,255,0.02)"}}>{children}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  CATEGORY MANAGER MODAL
// ─────────────────────────────────────────────────────────────────────────────
function CategoryManager({ cats, setCats, onClose }) {
  const [newName,setNewName]=useState(""); const [newIcon,setNewIcon]=useState("🏠"); const [newColor,setNewColor]=useState(COLOR_PALETTE[0]); const [err,setErr]=useState("");
  const modalRef=useRef(null); useFocusTrap(modalRef);
  const add=()=>{const n=newName.trim();if(!n){setErr("Please enter a name.");return;}if(cats[n]){setErr("Already exists.");return;}if(Object.keys(cats).length>=20){setErr("Max 20 categories.");return;}setCats(p=>({...p,[n]:{color:newColor.color,bg:newColor.bg,icon:newIcon,locked:false}}));setNewName("");setErr("");};
  const del=name=>{if(cats[name]?.locked)return;setCats(p=>{const c={...p};delete c[name];return c;});};
  return (
    <div role="dialog" aria-modal="true" aria-label="Manage categories" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div ref={modalRef} style={{background:"#111827",border:"1px solid rgba(255,255,255,0.1)",borderRadius:20,width:"100%",maxWidth:460,maxHeight:"88vh",overflow:"hidden",display:"flex",flexDirection:"column",boxShadow:"0 24px 64px rgba(0,0,0,0.7)"}}>
        <div style={{padding:"18px 20px",borderBottom:"1px solid rgba(255,255,255,0.07)",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:9}}><IcoTag/><div><div style={{fontSize:14,fontWeight:700,color:"#F8FAFC"}}>Manage Categories</div><div style={{fontSize:11,color:"#64748B",marginTop:1}}>Add custom or remove unused categories</div></div></div>
          <button onClick={onClose} aria-label="Close" style={{background:"rgba(255,255,255,0.06)",border:"none",borderRadius:8,padding:8,cursor:"pointer",color:"#94A3B8",display:"flex",minWidth:36,minHeight:36,alignItems:"center",justifyContent:"center"}}><IcoX/></button>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:18}}>
          <div style={{marginBottom:18}}>
            <div style={{fontSize:10,fontWeight:700,color:"#64748B",textTransform:"uppercase",letterSpacing:"0.8px",marginBottom:10}}>Current Categories</div>
            <div style={{display:"flex",flexDirection:"column",gap:7}}>
              {Object.entries(cats).map(([name,cfg])=>(
                <div key={name} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 13px",background:"rgba(255,255,255,0.04)",borderRadius:10,border:`1px solid ${cfg.bg}`}}>
                  <div style={{width:32,height:32,borderRadius:8,background:cfg.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{cfg.icon}</div>
                  <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600,color:"#F1F5F9"}}>{name}</div>{cfg.locked&&<div style={{fontSize:10,color:"#475569"}}>Built-in — cannot delete</div>}</div>
                  <div style={{width:10,height:10,borderRadius:"50%",background:cfg.color,flexShrink:0}}/>
                  {cfg.locked?<span style={{fontSize:12,color:"#374151",padding:"4px 8px"}}>🔒</span>:<button onClick={()=>del(name)} aria-label={`Delete ${name}`} style={{background:"rgba(248,113,113,0.1)",border:"1px solid rgba(248,113,113,0.2)",borderRadius:7,color:"#F87171",cursor:"pointer",padding:"5px 10px",fontSize:11,fontWeight:600,minHeight:32}}>🗑 Delete</button>}
                </div>
              ))}
            </div>
          </div>
          <div style={{background:"rgba(110,231,183,0.04)",border:"1px solid rgba(110,231,183,0.12)",borderRadius:14,padding:16}}>
            <div style={{fontSize:10,fontWeight:700,color:"#6EE7B7",textTransform:"uppercase",letterSpacing:"0.8px",marginBottom:14}}>Add New Category</div>
            <label htmlFor="cat-name-inp" style={{fontSize:11,color:"#94A3B8",fontWeight:600,display:"block",marginBottom:5}}>Name</label>
            <input id="cat-name-inp" value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()} placeholder="e.g. Healthcare, Travel…"
              style={{width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:9,padding:"9px 12px",color:"#F1F5F9",fontSize:13,outline:"none",boxSizing:"border-box",minHeight:44,marginBottom:12}}/>
            <div style={{fontSize:11,color:"#94A3B8",fontWeight:600,marginBottom:8}}>Icon</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:14}}>{EMOJI_OPTS.map(em=>(<button key={em} onClick={()=>setNewIcon(em)} aria-label={em} aria-pressed={newIcon===em} style={{width:36,height:36,borderRadius:8,fontSize:18,cursor:"pointer",border:newIcon===em?"2px solid #6EE7B7":"1px solid rgba(255,255,255,0.1)",background:newIcon===em?"rgba(110,231,183,0.15)":"rgba(255,255,255,0.04)"}}>{em}</button>))}</div>
            <div style={{fontSize:11,color:"#94A3B8",fontWeight:600,marginBottom:8}}>Colour</div>
            <div style={{display:"flex",gap:7,flexWrap:"wrap",marginBottom:14}}>{COLOR_PALETTE.map((p,i)=>(<button key={i} onClick={()=>setNewColor(p)} aria-label={`Colour ${p.color}`} aria-pressed={newColor===p} style={{width:28,height:28,borderRadius:"50%",background:p.color,cursor:"pointer",border:newColor===p?"3px solid #fff":"2px solid transparent"}}/>))}</div>
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 13px",background:"rgba(255,255,255,0.04)",borderRadius:10,border:`1px solid ${newColor.bg}`,marginBottom:12}}><div style={{width:32,height:32,borderRadius:8,background:newColor.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>{newIcon}</div><div style={{fontSize:13,fontWeight:600,color:newColor.color}}>{newName||"Preview"}</div><div style={{width:10,height:10,borderRadius:"50%",background:newColor.color,marginLeft:"auto"}}/></div>
            {err&&<div role="alert" style={{fontSize:12,color:"#FCA5A5",marginBottom:10,padding:"7px 11px",background:"rgba(252,165,165,0.08)",borderRadius:8}}>⚠️ {err}</div>}
            <button onClick={add} style={{width:"100%",padding:"11px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#34D399,#059669)",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",minHeight:44,display:"flex",alignItems:"center",justifyContent:"center",gap:7}}><IcoPlus/> Add Category</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  SMART IMPORT MODAL
// ─────────────────────────────────────────────────────────────────────────────
const ITABS=[{id:"sms",lbl:"SMS",ic:"💬",ph:"Paste bank SMS or push notifications.\n\nE.g.:\nADCB: Card charged AED 120.50 at CARREFOUR 28 Jun\nENBD: Purchase AED 45.00 at UBER 29 Jun"},{id:"wallet",lbl:"Wallet",ic:"🍎",ph:"Paste Apple Wallet transaction details.\n\nE.g.:\nApple Pay · Starbucks · AED 22.75 · Jun 29"},{id:"image",lbl:"Photo",ic:"📸",ph:null},{id:"file",lbl:"File",ic:"📄",ph:"Paste CSV or bank statement text, or upload a file above."}];

function ImportModal({ onClose, onImport, nextId, cats }) {
  const [tab,setTab]=useState("sms"); const [txt,setTxt]=useState(""); const [st,setSt]=useState("idle"); const [parsed,setParsed]=useState([]); const [sel,setSel]=useState({}); const [err,setErr]=useState(""); const [imgPrev,setIP]=useState(null); const [imgB64,setIB]=useState(null); const [imgMime,setIM]=useState(null); const [fname,setFn]=useState(""); const [fcont,setFc]=useState("");
  const fRef=useRef(), iRef=useRef(), modalRef=useRef(null); const catNames=Object.keys(cats); useFocusTrap(modalRef);
  const onImg=async e=>{const f=e.target.files[0];if(!f)return;setIB(await toB64(f));setIM(f.type||"image/jpeg");setIP(URL.createObjectURL(f));setSt("idle");setErr("");};
  const onFile=async e=>{const f=e.target.files[0];if(!f)return;setFn(f.name);setFc(await f.text());setSt("idle");setErr("");};
  const canParse=useMemo(()=>{if(tab==="image")return!!imgB64;if(tab==="file")return!!(fcont.trim()||txt.trim());return txt.trim().length>0;},[tab,imgB64,fcont,txt]);
  const parse=async()=>{setSt("parsing");setErr("");try{let res=[];if(tab==="image")res=await AI.parseImg(imgB64,imgMime,catNames);else res=await AI.parseText(tab==="file"?(fcont.trim()||txt.trim()):txt.trim(),catNames);if(!Array.isArray(res)||res.length===0){setSt("error");setErr("No transactions found. Try clearer text or image.");return;}const s={};res.forEach((_,i)=>(s[i]=true));setParsed(res);setSel(s);setSt("preview");}catch(e){setSt("error");setErr(e.message==="NO_KEY"?"No API key set. Go to ⚙️ Settings to add one.":e.message==="INVALID_KEY"?"Your API key is invalid. Go to Settings to update it.":e.message||"Parsing failed.");}};
  const toggleAll=v=>{const s={};parsed.forEach((_,i)=>(s[i]=v));setSel(s);};
  const cnt=Object.values(sel).filter(Boolean).length;
  const doImport=()=>{const items=parsed.filter((_,i)=>sel[i]).map((t,i)=>({id:nextId+i,name:String(t.name||"Unknown").slice(0,40),amount:parseFloat(parseFloat(t.amount||0).toFixed(2)),currency:CURRENCIES.find(c=>c.code===t.currency)?t.currency:"USD",category:catNames.includes(t.category)?t.category:catNames[0],date:t.date||todayStr()}));onImport(items);onClose();};
  const ta={width:"100%",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:11,padding:"12px 14px",color:"#F1F5F9",fontSize:13,resize:"vertical",fontFamily:"inherit",lineHeight:1.7,minHeight:150,outline:"none"};
  return (
    <div role="dialog" aria-modal="true" aria-label="Smart Import" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div ref={modalRef} style={{background:"#111827",border:"1px solid rgba(255,255,255,0.1)",borderRadius:20,width:"100%",maxWidth:530,maxHeight:"90vh",overflow:"hidden",display:"flex",flexDirection:"column",boxShadow:"0 24px 64px rgba(0,0,0,0.7)"}}>
        <div style={{padding:"18px 22px 0",borderBottom:"1px solid rgba(255,255,255,0.07)",flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}><div><h2 style={{fontSize:14,fontWeight:700,color:"#F8FAFC",margin:0}}>✨ Smart Import</h2><div style={{fontSize:11,color:"#64748B",marginTop:1}}>AI reads and categorises transactions</div></div><button onClick={onClose} aria-label="Close" style={{background:"rgba(255,255,255,0.06)",border:"none",borderRadius:8,padding:8,cursor:"pointer",color:"#94A3B8",display:"flex",minWidth:36,minHeight:36,alignItems:"center",justifyContent:"center"}}><IcoX/></button></div>
          <div role="tablist" style={{display:"flex",gap:2,overflowX:"auto",paddingBottom:1}}>{ITABS.map(t=>(<button key={t.id} role="tab" aria-selected={tab===t.id} onClick={()=>{setTab(t.id);setSt("idle");setErr("");setTxt("");}} style={{padding:"5px 11px",borderRadius:"7px 7px 0 0",border:"none",fontSize:11,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",minHeight:36,background:tab===t.id?"rgba(110,231,183,0.15)":"transparent",color:tab===t.id?"#6EE7B7":"#64748B",borderBottom:tab===t.id?"2px solid #6EE7B7":"2px solid transparent"}}>{t.ic} {t.lbl}</button>))}</div>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:20}}>
          {st!=="preview"&&(<>
            {tab==="image"&&(<div><div onClick={()=>iRef.current.click()} style={{border:"2px dashed rgba(110,231,183,0.3)",borderRadius:13,padding:imgPrev?"10px":"28px 20px",textAlign:"center",cursor:"pointer",background:"rgba(110,231,183,0.03)",transition:"border-color 0.2s"}} onMouseOver={e=>e.currentTarget.style.borderColor="rgba(110,231,183,0.55)"} onMouseOut={e=>e.currentTarget.style.borderColor="rgba(110,231,183,0.3)"}>{imgPrev?<img src={imgPrev} alt="Selected" style={{maxWidth:"100%",maxHeight:220,borderRadius:9,objectFit:"contain"}}/>:<><div style={{fontSize:30,marginBottom:8}}>📸</div><div style={{fontSize:13,fontWeight:600,color:"#F1F5F9",marginBottom:4}}>Upload receipt or screenshot</div><div style={{fontSize:11,color:"#64748B"}}>Receipt · Bank SMS screenshot · Apple Wallet</div></>}<input ref={iRef} type="file" accept="image/*" style={{display:"none"}} onChange={onImg} aria-label="Upload image"/></div>{imgPrev&&<button onClick={()=>iRef.current.click()} style={{marginTop:8,width:"100%",padding:8,borderRadius:9,border:"1px solid rgba(255,255,255,0.1)",background:"transparent",color:"#94A3B8",fontSize:12,fontWeight:600,cursor:"pointer",minHeight:36}}>🔄 Change image</button>}</div>)}
            {tab==="file"&&(<div><div onClick={()=>fRef.current.click()} style={{border:"2px dashed rgba(110,231,183,0.3)",borderRadius:13,padding:18,textAlign:"center",cursor:"pointer",background:"rgba(110,231,183,0.03)",marginBottom:10}} onMouseOver={e=>e.currentTarget.style.borderColor="rgba(110,231,183,0.55)"} onMouseOut={e=>e.currentTarget.style.borderColor="rgba(110,231,183,0.3)"}><div style={{fontSize:22,marginBottom:5}}>📂</div><div style={{fontSize:12,fontWeight:600,color:"#F1F5F9",marginBottom:3}}>{fname||"Upload bank statement"}</div><div style={{fontSize:11,color:"#64748B"}}>CSV · TXT · OFX</div><input ref={fRef} type="file" accept=".csv,.txt,.ofx,.tsv" style={{display:"none"}} onChange={onFile} aria-label="Upload file"/></div>{fcont&&<div role="status" style={{marginBottom:10,padding:"6px 11px",background:"rgba(110,231,183,0.07)",borderRadius:8,fontSize:11,color:"#6EE7B7"}}>✓ {fname} · {fcont.split("\n").length} lines</div>}<textarea value={txt} onChange={e=>setTxt(e.target.value)} placeholder={ITABS.find(t=>t.id==="file").ph} style={ta}/></div>)}
            {(tab==="sms"||tab==="wallet")&&<textarea value={txt} onChange={e=>setTxt(e.target.value)} placeholder={ITABS.find(t=>t.id===tab).ph} style={ta}/>}
            {err&&<div role="alert" style={{marginTop:10,padding:"8px 12px",background:"rgba(252,165,165,0.1)",border:"1px solid rgba(252,165,165,0.2)",borderRadius:9,fontSize:12,color:"#FCA5A5"}}>⚠️ {err}</div>}
            <button onClick={parse} disabled={!canParse||st==="parsing"} style={{width:"100%",marginTop:12,padding:13,borderRadius:11,border:"none",minHeight:48,fontWeight:700,fontSize:13,cursor:(!canParse||st==="parsing")?"not-allowed":"pointer",background:(!canParse||st==="parsing")?"rgba(255,255,255,0.06)":"linear-gradient(135deg,#34D399,#059669)",color:(!canParse||st==="parsing")?"#475569":"#fff"}}>
              {st==="parsing"?"🤖 AI is reading…":"✨ Extract Transactions with AI"}
            </button>
          </>)}
          {st==="preview"&&(<div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}><div style={{fontSize:12,color:"#94A3B8"}} aria-live="polite">Found <span style={{color:"#6EE7B7",fontWeight:700}}>{parsed.length}</span> · <span style={{color:"#F1F5F9",fontWeight:600}}>{cnt} selected</span></div><div style={{display:"flex",gap:6}}><button onClick={()=>toggleAll(true)} style={{fontSize:11,fontWeight:600,color:"#6EE7B7",background:"rgba(110,231,183,0.1)",border:"none",borderRadius:6,padding:"4px 9px",cursor:"pointer",minHeight:30}}>All</button><button onClick={()=>toggleAll(false)} style={{fontSize:11,fontWeight:600,color:"#94A3B8",background:"rgba(255,255,255,0.06)",border:"none",borderRadius:6,padding:"4px 9px",cursor:"pointer",minHeight:30}}>None</button></div></div>
            <div style={{display:"flex",flexDirection:"column",gap:7}}>{parsed.map((t,i)=>{const c=cats[catNames.includes(t.category)?t.category:catNames[0]],isSel=!!sel[i];return(<div key={i} onClick={()=>setSel(s=>({...s,[i]:!s[i]}))} role="checkbox" aria-checked={isSel} tabIndex={0} onKeyDown={e=>(e.key===" "||e.key==="Enter")&&setSel(s=>({...s,[i]:!s[i]}))} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 13px",borderRadius:11,border:`1px solid ${isSel?c?.color+"44":"rgba(255,255,255,0.06)"}`,background:isSel?c?.bg:"rgba(255,255,255,0.02)",cursor:"pointer",minHeight:52}}><div style={{width:19,height:19,borderRadius:5,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",border:`2px solid ${isSel?c?.color:"rgba(255,255,255,0.2)"}`,background:isSel?c?.color:"transparent"}}>{isSel&&<span style={{color:"#0B0F1A"}}><IcoChk/></span>}</div><span style={{fontSize:16,flexShrink:0}}>{c?.icon||"📦"}</span><div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:"#F1F5F9",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.name}</div><div style={{fontSize:10,color:"#64748B",marginTop:1}}>{t.category} · {t.date}</div></div><div style={{fontSize:12,fontWeight:700,color:c?.color,flexShrink:0}}>{getSym(t.currency||"USD")}{parseFloat(t.amount||0).toFixed(2)}</div></div>);})}</div>
            <div style={{display:"flex",gap:9,marginTop:14}}><button onClick={()=>setSt("idle")} style={{flex:1,padding:11,borderRadius:10,border:"1px solid rgba(255,255,255,0.1)",background:"transparent",color:"#94A3B8",fontWeight:600,fontSize:12,cursor:"pointer",minHeight:44}}>← Back</button><button onClick={doImport} disabled={cnt===0} style={{flex:2,padding:11,borderRadius:10,border:"none",fontWeight:700,fontSize:12,minHeight:44,cursor:cnt===0?"not-allowed":"pointer",background:cnt===0?"rgba(255,255,255,0.06)":"linear-gradient(135deg,#34D399,#059669)",color:cnt===0?"#475569":"#fff"}}>Import {cnt} Transaction{cnt!==1?"s":""}</button></div>
          </div>)}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  NLP LOGGER
// ─────────────────────────────────────────────────────────────────────────────
function NLPLogger({ onAdd, currency, nextId, cats }) {
  const [txt,setTxt]=useState(""); const [busy,setBusy]=useState(false); const [parsed,setParsed]=useState(null);
  const [msgs,setMsgs]=useState([{r:"bot",t:"Hi! Tell me about an expense.\n\n• \"Coffee at Starbucks 12 AED this morning\"\n• \"Paid 350 for electricity yesterday\"\n• \"Lunch with team, spent 85\""}]);
  const [mic,setMic]=useState(false); const [micErr,setMicErr]=useState("");
  const recogRef=useRef(null), endRef=useRef(null), inpRef=useRef(null);
  const catNames=Object.keys(cats);
  const scroll=()=>setTimeout(()=>endRef.current?.scrollIntoView({behavior:"smooth"}),60);
  const send=async()=>{const t=txt.trim();if(!t||busy)return;setTxt("");setMicErr("");setMsgs(m=>[...m,{r:"user",t}]);setBusy(true);scroll();
    try{const p=await AI.nlp(t,currency,catNames);setParsed(p);setMsgs(m=>[...m,{r:"bot",t:`I understood: ${p.interpreted}`}]);}
    catch(e){setMsgs(m=>[...m,{r:"bot",t:e.message==="NO_KEY"?"⚠️ No API key set. Tap the ⚙️ Settings icon to add one.":e.message==="INVALID_KEY"?"⚠️ API key is invalid. Tap the ⚙️ Settings icon to update it.":"Sorry, couldn't parse that. Try including an amount and a description."}]);}
    setBusy(false);scroll();};
  const confirm=()=>{if(!parsed)return;const cat=catNames.includes(parsed.category)?parsed.category:catNames[0];onAdd({id:nextId,name:parsed.name,amount:parsed.amount||0,currency:parsed.currency||currency,category:cat,date:parsed.date||todayStr()});setMsgs(m=>[...m,{r:"bot",t:`✅ Added "${parsed.name}" — ${getSym(parsed.currency||currency)}${(parsed.amount||0).toFixed(2)} · ${cat}. Anything else?`}]);setParsed(null);scroll();setTimeout(()=>inpRef.current?.focus(),100);};
  const initRecog=()=>{if(recogRef.current)return recogRef.current;const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR)return null;const r=new SR();r.lang="en-US";r.interimResults=true;r.continuous=false;r.onstart=()=>setMic(true);r.onend=()=>setMic(false);r.onerror=e=>{setMic(false);if(e.error==="not-allowed"||e.error==="permission-denied")setMicErr("Mic blocked — tap the 🔒 in your browser address bar and allow microphone.");else if(e.error!=="aborted"&&e.error!=="no-speech")setMicErr(`Voice error: ${e.error}`);};r.onresult=e=>{const t=Array.from(e.results).map(x=>x[0].transcript).join("");setTxt(t);if(e.results[e.results.length-1].isFinal)setMic(false);};recogRef.current=r;return r;};
  const startMic=()=>{setMicErr("");const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){setMicErr("Voice not supported. Try Chrome or Edge.");return;}const r=initRecog();if(!r)return;try{r.start();}catch{try{r.abort();}catch{}setTimeout(()=>{try{r.start();}catch{}},200);}};
  const stopMic=()=>{try{recogRef.current?.stop();}catch{}setMic(false);};
  const cfg=parsed?cats[catNames.includes(parsed.category)?parsed.category:catNames[0]]:null;
  return (
    <div style={{display:"flex",flexDirection:"column",height:400}}>
      <div role="log" aria-live="polite" style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column",gap:10,paddingBottom:8}}>
        {msgs.map((m,i)=>(<div key={i} style={{display:"flex",justifyContent:m.r==="user"?"flex-end":"flex-start",gap:8,alignItems:"flex-start"}}>{m.r==="bot"&&<div aria-hidden="true" style={{width:26,height:26,borderRadius:"50%",background:"rgba(110,231,183,0.15)",border:"1px solid rgba(110,231,183,0.25)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:2}}><IcoBot/></div>}<div style={{maxWidth:"82%",padding:"9px 13px",borderRadius:m.r==="user"?"14px 4px 14px 14px":"4px 14px 14px 14px",background:m.r==="user"?"rgba(110,231,183,0.12)":"rgba(255,255,255,0.05)",border:m.r==="user"?"1px solid rgba(110,231,183,0.2)":"1px solid rgba(255,255,255,0.07)",fontSize:13,color:m.r==="user"?"#6EE7B7":"#E2E8F0",lineHeight:1.65,whiteSpace:"pre-line"}}>{m.t}</div></div>))}
        {busy&&<div style={{display:"flex",gap:8,alignItems:"center"}}><div aria-hidden="true" style={{width:26,height:26,borderRadius:"50%",background:"rgba(110,231,183,0.15)",border:"1px solid rgba(110,231,183,0.25)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><IcoBot/></div><div role="status" style={{padding:"9px 14px",borderRadius:"4px 14px 14px 14px",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.07)"}}><span style={{display:"flex",gap:4}}>{[0,1,2].map(i=><span key={i} style={{width:6,height:6,borderRadius:"50%",background:"#6EE7B7",display:"inline-block",animation:`bop 1s ${i*0.2}s infinite`}}/>)}</span></div></div>}
        {parsed&&cfg&&(<div role="region" style={{padding:14,borderRadius:14,background:cfg.bg,border:`1px solid ${cfg.color}44`}}><div style={{fontSize:11,fontWeight:700,color:cfg.color,marginBottom:10,textTransform:"uppercase",letterSpacing:"0.6px"}}>{cfg.icon} Confirm expense?</div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>{[["Name",parsed.name],["Amount",`${getSym(parsed.currency||currency)}${(parsed.amount||0).toFixed(2)}`],["Category",catNames.includes(parsed.category)?parsed.category:catNames[0]],["Date",parsed.date]].map(([k,v])=>(<div key={k}><div style={{fontSize:10,color:"#64748B",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:2}}>{k}</div><div style={{fontSize:13,color:"#F1F5F9",fontWeight:600}}>{v}</div></div>))}</div><div style={{display:"flex",gap:8}}><button onClick={()=>setParsed(null)} style={{flex:1,padding:"8px",borderRadius:9,border:"1px solid rgba(255,255,255,0.1)",background:"transparent",color:"#94A3B8",fontWeight:600,fontSize:13,cursor:"pointer",minHeight:44}}>✏️ Edit</button><button onClick={confirm} style={{flex:2,padding:"8px",borderRadius:9,border:"none",background:`linear-gradient(135deg,${cfg.color},${cfg.color}bb)`,color:"#0B0F1A",fontWeight:700,fontSize:13,cursor:"pointer",minHeight:44}}>✅ Add Expense</button></div></div>)}
        <div ref={endRef}/>
      </div>
      {mic&&<div role="status" aria-live="assertive" style={{display:"flex",alignItems:"center",gap:10,padding:"7px 12px",background:"rgba(252,165,165,0.08)",border:"1px solid rgba(252,165,165,0.2)",borderRadius:9,marginBottom:8}}><div aria-hidden="true" style={{position:"relative",width:9,height:9,flexShrink:0}}><div style={{position:"absolute",inset:0,borderRadius:"50%",background:"#FCA5A5"}}/><div style={{position:"absolute",inset:0,borderRadius:"50%",background:"#FCA5A5",animation:"ring 1.2s ease-out infinite"}}/></div><span style={{fontSize:12,color:"#FCA5A5",fontWeight:600}}>Listening…</span><span style={{fontSize:11,color:"#475569",marginLeft:"auto"}}>tap mic to stop</span></div>}
      {micErr&&<div role="alert" style={{fontSize:11,color:"#FCA5A5",padding:"5px 10px",background:"rgba(252,165,165,0.07)",borderRadius:7,marginBottom:7}}>⚠️ {micErr}</div>}
      <div style={{display:"flex",gap:7,paddingTop:9,borderTop:"1px solid rgba(255,255,255,0.06)"}}>
        <button onClick={mic?stopMic:startMic} disabled={busy} aria-label={mic?"Stop voice":"Start voice"} aria-pressed={mic} style={{width:44,height:44,borderRadius:9,border:"none",flexShrink:0,cursor:busy?"not-allowed":"pointer",background:mic?"rgba(252,165,165,0.14)":"rgba(255,255,255,0.06)",color:mic?"#FCA5A5":"#64748B",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.2s",outline:mic?"1px solid rgba(252,165,165,0.35)":"none"}}><IcoMic on={mic}/></button>
        <input ref={inpRef} value={txt} onChange={e=>setTxt(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder={mic?"Listening…":"Type or speak your expense…"} disabled={busy} aria-label="Expense description" style={{flex:1,background:"rgba(255,255,255,0.05)",borderRadius:9,padding:"9px 12px",color:"#F1F5F9",fontSize:13,outline:"none",minHeight:44,border:`1px solid ${mic?"rgba(252,165,165,0.35)":"rgba(255,255,255,0.09)"}`,transition:"border-color 0.2s"}}/>
        <button onClick={send} disabled={!txt.trim()||busy} aria-label="Send" style={{padding:"9px 14px",borderRadius:9,border:"none",fontWeight:700,fontSize:13,flexShrink:0,minHeight:44,cursor:(!txt.trim()||busy)?"not-allowed":"pointer",display:"flex",alignItems:"center",gap:5,background:(!txt.trim()||busy)?"rgba(255,255,255,0.06)":"linear-gradient(135deg,#34D399,#059669)",color:(!txt.trim()||busy)?"#475569":"#fff"}}><IcoSend/> Send</button>
      </div>
      <style>{`@keyframes bop{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}} @keyframes ring{0%{transform:scale(1);opacity:0.8}100%{transform:scale(1.8);opacity:0}}`}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  BUDGET PANEL
// ─────────────────────────────────────────────────────────────────────────────
function BudgetPanel({ budgets, setBudgets, currency, monthSpend, expenses }) {
  const [edit,setEdit]=useState(false); const [mv,setMv]=useState(budgets.monthly||""); const [yv,setYv]=useState(budgets.yearly||"");
  const sym=getSym(currency); const yr=new Date().getFullYear();
  const yearSpend=useMemo(()=>expenses.filter(e=>e.date.startsWith(String(yr))).reduce((s,e)=>s+e.amount,0),[expenses,yr]);
  const save=()=>{setBudgets({monthly:mv?parseFloat(mv):null,yearly:yv?parseFloat(yv):null});setEdit(false);};
  const Bar=({val,max,label})=>{const pct=Math.min((val/max)*100,100),c=pct>90?"#FCA5A5":pct>70?"#FCD34D":"#6EE7B7";return(<div style={{marginBottom:10}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:11,color:"#94A3B8"}}>{label}</span><span style={{fontSize:11,fontWeight:700,color:c}}>{sym}{val.toFixed(0)}/{sym}{max}</span></div><div role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} style={{height:6,background:"rgba(255,255,255,0.07)",borderRadius:4,overflow:"hidden"}}><div style={{height:"100%",width:`${pct}%`,background:c,borderRadius:4,transition:"width 0.5s ease"}}/></div><div style={{fontSize:10,color:"#475569",marginTop:3}}>{pct>=100?"⚠️ Over budget":`${sym}${(max-val).toFixed(0)} remaining`}</div></div>);};
  if(edit)return(<div style={{display:"flex",flexDirection:"column",gap:9}}>{[["Monthly",mv,setMv],["Yearly",yv,setYv]].map(([l,v,s])=>(<div key={l}><label style={{fontSize:10,color:"#64748B",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.6px",display:"block",marginBottom:4}}>{l} budget (optional)</label><input type="number" min="0" placeholder="e.g. 3000" value={v} onChange={e=>s(e.target.value)} style={{width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:8,padding:"8px 11px",color:"#F1F5F9",fontSize:13,outline:"none",minHeight:44}}/></div>))}<div style={{display:"flex",gap:7}}><button onClick={()=>setEdit(false)} style={{flex:1,padding:"10px",borderRadius:8,border:"1px solid rgba(255,255,255,0.1)",background:"transparent",color:"#94A3B8",fontWeight:600,fontSize:12,cursor:"pointer",minHeight:44}}>Cancel</button><button onClick={save} style={{flex:2,padding:"10px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#34D399,#059669)",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer",minHeight:44}}>Save</button></div></div>);
  if(!budgets.monthly&&!budgets.yearly)return(<div style={{textAlign:"center",padding:"6px 0"}}><div style={{fontSize:12,color:"#475569",marginBottom:8}}>No budget set — optional</div><button onClick={()=>setEdit(true)} style={{fontSize:12,fontWeight:700,color:"#6EE7B7",background:"rgba(110,231,183,0.1)",border:"1px solid rgba(110,231,183,0.25)",borderRadius:8,padding:"8px 14px",cursor:"pointer",minHeight:40}}>+ Set Budget</button></div>);
  return(<div>{budgets.monthly&&<Bar val={monthSpend} max={budgets.monthly} label="Monthly"/>}{budgets.yearly&&<Bar val={yearSpend} max={budgets.yearly} label="Yearly"/>}<button onClick={()=>setEdit(true)} style={{fontSize:11,fontWeight:600,color:"#64748B",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:7,padding:"5px 11px",cursor:"pointer",minHeight:34}}>✏️ Edit</button></div>);
}

// ─────────────────────────────────────────────────────────────────────────────
//  FORECAST PANEL
// ─────────────────────────────────────────────────────────────────────────────
function ForecastPanel({ expenses, budgets, currency, cats }) {
  const [st,setSt]=useState("idle"); const [fc,setFc]=useState(null); const [err,setErr]=useState("");
  const sym=getSym(currency); const catNames=Object.keys(cats);
  const run=async()=>{if(expenses.length<2){setErr("Add more expenses for a meaningful forecast.");setSt("error");return;}setSt("loading");setErr("");try{setFc(await AI.forecast(expenses,budgets,currency,catNames));setSt("done");}catch(e){setErr(e.message==="NO_KEY"?"No API key set. Go to ⚙️ Settings (top right) to add one.":e.message==="INVALID_KEY"?"Your API key is invalid. Go to ⚙️ Settings to update it.":e.message||"Forecast failed.");setSt("error");}};
  if(st==="idle"||st==="error")return(<div style={{textAlign:"center",padding:"8px 0"}}><div style={{fontSize:28,marginBottom:10}}>🔮</div><p style={{fontSize:12,color:"#94A3B8",marginBottom:5,lineHeight:1.6,margin:"0 0 12px"}}>AI analyses your patterns to predict upcoming spending, detect recurring payments, and flag seasonal trends.</p>{err&&<div role="alert" style={{fontSize:12,color:"#FCA5A5",marginBottom:12,padding:"7px 12px",background:"rgba(252,165,165,0.08)",borderRadius:8}}>⚠️ {err}</div>}<button onClick={run} style={{padding:"10px 22px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#818CF8,#6366F1)",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",minHeight:44}}>🔮 Generate Forecast</button></div>);
  if(st==="loading")return<div role="status" style={{textAlign:"center",padding:"28px 0"}}><div style={{fontSize:26,marginBottom:10}}>⏳</div><div style={{fontSize:13,color:"#6EE7B7"}}>Analysing patterns…</div></div>;
  if(st==="done"&&fc){
    const hc={on_track:"#6EE7B7",at_risk:"#FCD34D",over_budget:"#FCA5A5",no_budget:"#94A3B8"}[fc.budgetHealth]||"#94A3B8";
    const hl={on_track:"✅ On Track",at_risk:"⚠️ At Risk",over_budget:"🚨 Over Budget",no_budget:"📊 No Budget"}[fc.budgetHealth]||"";
    const nxt=fc.nextMonthForecast||{},nm=SMONTHS[(new Date().getMonth()+1)%12];
    return(<div style={{display:"flex",flexDirection:"column",gap:14}}>
      {fc.budgetHealth&&fc.budgetHealth!=="no_budget"&&<div style={{display:"inline-flex",alignSelf:"flex-start",alignItems:"center",gap:5,padding:"4px 12px",borderRadius:20,background:`${hc}18`,border:`1px solid ${hc}44`,fontSize:11,fontWeight:700,color:hc}}>{hl}</div>}
      <div style={{background:"rgba(129,140,248,0.08)",border:"1px solid rgba(129,140,248,0.2)",borderRadius:12,padding:"13px 15px"}}>
        <div style={{fontSize:10,fontWeight:600,color:"#818CF8",textTransform:"uppercase",letterSpacing:"0.7px",marginBottom:8}}>{nm} Forecast · {nxt.confidence||""} confidence</div>
        <div style={{fontSize:24,fontWeight:700,color:"#F8FAFC",marginBottom:10}}>{sym}{(nxt.total||0).toFixed(0)}</div>
        {Object.entries(nxt.byCategory||{}).filter(([,v])=>v>0).sort(([,a],[,b])=>b-a).map(([cat,val])=>{const c=cats[cat];const pct=nxt.total>0?(val/nxt.total)*100:0;return(<div key={cat} style={{display:"flex",alignItems:"center",gap:7,marginBottom:5}}><span style={{fontSize:12}}>{c?.icon}</span><span style={{fontSize:10,color:"#94A3B8",width:86}}>{cat}</span><div role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} style={{flex:1,height:4,background:"rgba(255,255,255,0.06)",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${pct}%`,background:c?.color,borderRadius:3}}/></div><span style={{fontSize:11,fontWeight:600,color:c?.color,minWidth:48,textAlign:"right"}}>{sym}{val.toFixed(0)}</span></div>);})}
      </div>
      {fc.next3MonthsForecast?.length>0&&<div><div style={{fontSize:10,fontWeight:600,color:"#64748B",textTransform:"uppercase",letterSpacing:"0.7px",marginBottom:8}}>3-Month Outlook</div><div style={{display:"flex",gap:8}}>{fc.next3MonthsForecast.map((m,i)=>(<div key={i} style={{flex:1,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:9,padding:"11px 8px",textAlign:"center"}}><div style={{fontSize:10,color:"#64748B",marginBottom:3}}>{SMONTHS[parseInt(m.month?.split("-")[1]||1)-1]}</div><div style={{fontSize:14,fontWeight:700,color:"#F1F5F9"}}>{sym}{(m.total||0).toFixed(0)}</div><div style={{display:"flex",justifyContent:"center",marginTop:4}}>{m.trend==="up"?<IcoTrUp/>:<IcoTrDn/>}</div></div>))}</div></div>}
      {fc.scheduledPayments?.length>0&&<div><div style={{fontSize:10,fontWeight:600,color:"#64748B",textTransform:"uppercase",letterSpacing:"0.7px",marginBottom:8}}>Detected Recurring</div>{fc.scheduledPayments.map((p,i)=>{const c=cats[catNames.includes(p.category)?p.category:catNames[0]];return(<div key={i} style={{display:"flex",alignItems:"center",gap:9,padding:"8px 11px",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:8,marginBottom:6}}><span style={{fontSize:15}}>{c?.icon}</span><div style={{flex:1}}><div style={{fontSize:12,fontWeight:600,color:"#F1F5F9"}}>{p.name}</div><div style={{fontSize:10,color:"#475569"}}>Due ~{p.likelyDate}</div></div><div style={{fontSize:12,fontWeight:700,color:c?.color}}>{sym}{(p.estimatedAmount||0).toFixed(0)}</div></div>);})}</div>}
      {fc.seasonalWarning&&<div role="note" style={{padding:"9px 12px",background:"rgba(252,211,77,0.08)",border:"1px solid rgba(252,211,77,0.2)",borderRadius:9,fontSize:12,color:"#FCD34D"}}>🌦️ {fc.seasonalWarning}</div>}
      {fc.insights?.length>0&&<div><div style={{fontSize:10,fontWeight:600,color:"#64748B",textTransform:"uppercase",letterSpacing:"0.7px",marginBottom:8}}>AI Insights</div>{fc.insights.map((ins,i)=>(<div key={i} style={{display:"flex",gap:8,padding:"8px 11px",background:"rgba(129,140,248,0.06)",border:"1px solid rgba(129,140,248,0.14)",borderRadius:8,marginBottom:6}}><span style={{fontSize:13,flexShrink:0}}>💡</span><span style={{fontSize:12,color:"#C7D2FE",lineHeight:1.6}}>{ins}</span></div>))}</div>}
      <button onClick={run} style={{fontSize:11,fontWeight:600,color:"#818CF8",background:"rgba(129,140,248,0.08)",border:"1px solid rgba(129,140,248,0.2)",borderRadius:7,padding:"6px 12px",cursor:"pointer",alignSelf:"flex-start",minHeight:34}}>🔄 Refresh</button>
    </div>);}
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  DONUT
// ─────────────────────────────────────────────────────────────────────────────
function Donut({ data, currency }) {
  const sym=getSym(currency), total=data.reduce((s,d)=>s+d.value,0);
  if(total===0)return<div style={{color:"#475569",fontSize:12,padding:"14px 0",textAlign:"center"}}>No spending data yet.</div>;
  const sz=155,cx=77.5,cy=77.5,r=56,ri=33,g=3;let cum=-Math.PI/2;
  const slices=data.filter(d=>d.value>0).map(d=>{const fr=d.value/total,ang=fr*2*Math.PI,sa=cum;cum+=ang;const ea=cum,la=ang>Math.PI?1:0;const pt=(rr,a)=>[cx+rr*Math.cos(a),cy+rr*Math.sin(a)];const [x1,y1]=pt(r,sa+g/r/2),[x2,y2]=pt(r,ea-g/r/2);const [xi1,yi1]=pt(ri,sa+g/ri/2),[xi2,yi2]=pt(ri,ea-g/ri/2);return{...d,fr,path:`M ${x1} ${y1} A ${r} ${r} 0 ${la} 1 ${x2} ${y2} L ${xi2} ${yi2} A ${ri} ${ri} 0 ${la} 0 ${xi1} ${yi1} Z`};});
  return(<div style={{display:"flex",alignItems:"center",gap:20,flexWrap:"wrap"}}><svg width={sz} height={sz} role="img" aria-label="Spending breakdown" style={{flexShrink:0}}><title>Spending by category</title>{slices.map(s=><path key={s.label} d={s.path} fill={s.color}/>)}<text x={cx} y={cy-8} textAnchor="middle" fill="#94A3B8" fontSize="10" fontFamily="Inter,sans-serif">Total</text><text x={cx} y={cy+9} textAnchor="middle" fill="#F8FAFC" fontSize="14" fontWeight="700" fontFamily="Inter,sans-serif">{sym}{total.toFixed(0)}</text></svg><div style={{display:"flex",flexDirection:"column",gap:7}}>{slices.map(s=>(<div key={s.label} style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:7,height:7,borderRadius:"50%",background:s.color,flexShrink:0}}/><span style={{fontSize:11,color:"#94A3B8",minWidth:86}}>{s.label}</span><span style={{fontSize:11,color:"#F1F5F9",fontWeight:600}}>{sym}{s.value.toFixed(2)}</span><span style={{fontSize:10,color:"#475569",width:28,textAlign:"right"}}>{(s.fr*100).toFixed(0)}%</span></div>))}</div></div>);
}

// ─────────────────────────────────────────────────────────────────────────────
//  BAR CHART  (Day / Week / Month / Year)
// ─────────────────────────────────────────────────────────────────────────────
function BarChart({ expenses, viewYear, viewMonth, currency }) {
  const [view,setView]=useState("weekly"); const [hov,setHov]=useState(null); const sym=getSym(currency);
  const data=useMemo(()=>{
    if(view==="yearly")return Array.from({length:12}).map((_,i)=>{const px=`${viewYear}-${String(i+1).padStart(2,"0")}`;return{label:SMONTHS[i],total:expenses.filter(e=>e.date.startsWith(px)).reduce((s,e)=>s+e.amount,0),key:px};});
    if(view==="monthly")return Array.from({length:12}).map((_,i)=>{const d=new Date(viewYear,viewMonth-(11-i),1),px=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;return{label:SMONTHS[d.getMonth()],total:expenses.filter(e=>e.date.startsWith(px)).reduce((s,e)=>s+e.amount,0),key:px};});
    const lastDay=new Date(viewYear,viewMonth+1,0).getDate(),anchor=new Date(viewYear,viewMonth,1),end=new Date(viewYear,viewMonth,lastDay);
    if(view==="daily")return Array.from({length:lastDay}).map((_,i)=>{const d=new Date(viewYear,viewMonth,i+1),key=d.toISOString().split("T")[0];return{label:String(i+1),total:expenses.filter(e=>e.date===key).reduce((s,e)=>s+e.amount,0),key};});
    const gm=d=>{const dt=new Date(d),dy=dt.getDay();dt.setDate(dt.getDate()+(dy===0?-6:1-dy));dt.setHours(0,0,0,0);return dt;};const wks=[];let m=gm(anchor);
    while(m<=end){const su=new Date(m);su.setDate(m.getDate()+6);const ms=m.toISOString().split("T")[0],ss=su.toISOString().split("T")[0];wks.push({label:m.toLocaleDateString("en",{month:"short",day:"numeric"}),total:expenses.filter(e=>e.date>=ms&&e.date<=ss).reduce((s,e)=>s+e.amount,0),key:ms});m=new Date(m);m.setDate(m.getDate()+7);}return wks;
  },[view,expenses,viewYear,viewMonth]);
  const mx=Math.max(...data.map(d=>d.total),1),ti=data.reduce((b,d,i)=>d.total>data[b].total?i:b,0);
  const ch=90,bw=view==="daily"?11:view==="yearly"?20:24,gw=view==="daily"?3:6,sw=data.length*(bw+gw)-gw+2;
  const sub=view==="yearly"?`Full year ${viewYear}`:view==="monthly"?"Rolling 12 months":view==="weekly"?`${SMONTHS[viewMonth]} ${viewYear} by week`:`${SMONTHS[viewMonth]} ${viewYear} by day`;
  return(
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
        <div><div style={{fontSize:10,fontWeight:600,color:"#64748B",textTransform:"uppercase",letterSpacing:"0.8px"}}>Spending Over Time</div><div style={{fontSize:10,color:"#374151",marginTop:1}}>{sub}</div></div>
        <div role="group" aria-label="Chart period" style={{display:"flex",background:"rgba(255,255,255,0.05)",borderRadius:7,padding:2,gap:1}}>
          {[["daily","Day"],["weekly","Wk"],["monthly","Mo"],["yearly","Yr"]].map(([v,l])=>(<button key={v} onClick={()=>setView(v)} aria-pressed={view===v} style={{padding:"3px 8px",borderRadius:5,border:"none",fontSize:10,fontWeight:600,cursor:"pointer",minHeight:26,background:view===v?"rgba(110,231,183,0.18)":"transparent",color:view===v?"#6EE7B7":"#64748B"}}>{l}</button>))}
        </div>
      </div>
      {expenses.length===0?<div style={{textAlign:"center",color:"#475569",fontSize:12,padding:"20px 0"}}>No data yet.</div>:(
        <div style={{overflowX:"auto"}}><div style={{position:"relative",minWidth:sw+24}}>
          {hov!==null&&data[hov]&&<div role="tooltip" style={{position:"absolute",top:0,left:Math.min(hov*(bw+gw)+bw/2-28,Math.max(0,sw-60)),background:"#1E2940",border:"1px solid rgba(110,231,183,0.25)",borderRadius:7,padding:"3px 8px",fontSize:10,fontWeight:600,color:"#6EE7B7",pointerEvents:"none",whiteSpace:"nowrap",zIndex:10}}>{data[hov].label} · {sym}{data[hov].total.toFixed(2)}</div>}
          <svg role="img" aria-label="Bar chart" width={sw} height={ch+20} style={{display:"block",marginTop:hov!==null?20:4,overflow:"visible"}}>
            {data.map((d,i)=>{const bh=Math.max((d.total/mx)*ch,d.total>0?3:0),x=i*(bw+gw),y=ch-bh,top=i===ti&&d.total>0;return(<g key={d.key} onMouseEnter={()=>setHov(i)} onMouseLeave={()=>setHov(null)} tabIndex={0} role="graphics-symbol" aria-label={`${d.label}: ${sym}${d.total.toFixed(2)}`} style={{cursor:"pointer"}}><rect x={x} y={0} width={bw} height={ch} rx={3} fill="rgba(255,255,255,0.04)"/>{d.total>0&&<rect x={x} y={y} width={bw} height={bh} rx={3} opacity={hov===i?1:0.8} fill={top?"#34D399":hov===i?"#93C5FD":"#6EE7B7"} style={{transition:"opacity 0.15s"}}/>}<text x={x+bw/2} y={ch+13} textAnchor="middle" fontSize={7} fill={top?"#6EE7B7":"#475569"} fontWeight={top?700:400} fontFamily="Inter,sans-serif">{d.label}</text>{top&&d.total>0&&<circle cx={x+bw/2} cy={y-4} r={2} fill="#34D399"/>}</g>);})}
          </svg>
        </div></div>
      )}
      {data.some(d=>d.total>0)&&<div style={{marginTop:6,fontSize:10,color:"#475569"}}>Peak: <span style={{color:"#6EE7B7",fontWeight:600}}>{data[ti]?.label}</span> — <span style={{color:"#F1F5F9",fontWeight:600}}>{sym}{data[ti]?.total.toFixed(2)}</span></div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  MONTH GROUP
// ─────────────────────────────────────────────────────────────────────────────
function MonthGroup({ mk, items, onDel, currency, delId, cats }) {
  const [open,setOpen]=useState(true); const [bulk,setBulk]=useState(false); const [ids,setIds]=useState(new Set());
  const sym=getSym(currency); const [yr,mo]=mk.split("-").map(Number); const total=items.reduce((s,e)=>s+e.amount,0);
  const toggle=id=>setIds(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n;});
  const doBulk=()=>{ids.forEach(id=>onDel(id));setIds(new Set());setBulk(false);};
  return(
    <div style={{marginBottom:8}}>
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 13px",minHeight:48,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:open?"11px 11px 0 0":11,cursor:"pointer",userSelect:"none"}} onClick={()=>setOpen(o=>!o)} onKeyDown={e=>(e.key===" "||e.key==="Enter")&&setOpen(o=>!o)} role="button" tabIndex={0} aria-expanded={open}>
        <IcoChevD open={open}/><span style={{fontSize:12,fontWeight:700,color:"#F1F5F9",flex:1}}>{MONTHS[mo-1]} {yr}</span>
        <span style={{fontSize:11,color:"#94A3B8"}}>{items.length} txn{items.length!==1?"s":""}</span>
        <span style={{fontSize:12,fontWeight:700,color:"#6EE7B7"}}>{sym}{total.toFixed(2)}</span>
        <button onClick={e=>{e.stopPropagation();setBulk(b=>!b);setIds(new Set());}} aria-label={bulk?"Cancel":"Select"} style={{fontSize:10,fontWeight:600,marginLeft:4,minHeight:28,padding:"3px 9px",borderRadius:5,border:"none",cursor:"pointer",color:bulk?"#FCA5A5":"#64748B",background:bulk?"rgba(252,165,165,0.1)":"rgba(255,255,255,0.06)"}}>{bulk?"Cancel":"Select"}</button>
      </div>
      {open&&bulk&&<div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 13px",background:"rgba(252,165,165,0.05)",border:"1px solid rgba(252,165,165,0.12)",borderTop:"none"}}><button onClick={()=>setIds(new Set(items.map(e=>e.id)))} style={{fontSize:10,fontWeight:600,color:"#94A3B8",background:"rgba(255,255,255,0.06)",border:"none",borderRadius:5,padding:"3px 8px",cursor:"pointer",minHeight:26}}>All</button><button onClick={()=>setIds(new Set())} style={{fontSize:10,fontWeight:600,color:"#94A3B8",background:"rgba(255,255,255,0.06)",border:"none",borderRadius:5,padding:"3px 8px",cursor:"pointer",minHeight:26}}>None</button><span style={{fontSize:11,color:"#94A3B8",flex:1}} aria-live="polite">{ids.size} selected</span>{ids.size>0&&<button onClick={doBulk} aria-label={`Delete ${ids.size} selected`} style={{fontSize:10,fontWeight:700,color:"#0B0F1A",background:"#F87171",border:"none",borderRadius:6,padding:"4px 12px",cursor:"pointer",minHeight:28}}>Delete {ids.size}</button>}</div>}
      {open&&<div style={{border:"1px solid rgba(255,255,255,0.07)",borderTop:"none",borderRadius:"0 0 11px 11px",overflow:"hidden"}}>
        {items.map((e,idx)=>{const c=cats[e.category]||{color:"#94A3B8",bg:"rgba(148,163,184,0.12)",icon:"📦"};const isDel=delId===e.id,isSel=ids.has(e.id),eSym=getSym(e.currency||currency);
        return(<div key={e.id} onClick={()=>bulk&&toggle(e.id)} onKeyDown={bulk?(ev=>(ev.key===" "||ev.key==="Enter")&&toggle(e.id)):undefined} role={bulk?"checkbox":undefined} aria-checked={bulk?isSel:undefined} tabIndex={bulk?0:-1}
          style={{display:"flex",alignItems:"center",gap:10,padding:"11px 13px",minHeight:50,background:isSel?"rgba(248,113,113,0.07)":idx%2===0?"rgba(255,255,255,0.015)":"transparent",borderTop:"1px solid rgba(255,255,255,0.04)",transition:"opacity 0.25s,transform 0.25s",opacity:isDel?0:1,transform:isDel?"translateX(12px)":"none",cursor:bulk?"pointer":"default"}}>
          {bulk&&<div style={{width:17,height:17,borderRadius:5,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",border:`2px solid ${isSel?"#F87171":"rgba(255,255,255,0.2)"}`,background:isSel?"#F87171":"transparent"}}>{isSel&&<span style={{color:"#fff",fontSize:9}}>✓</span>}</div>}
          <div aria-hidden="true" style={{width:32,height:32,borderRadius:8,background:c.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0}}>{c.icon}</div>
          <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:"#F1F5F9",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.name}</div><div style={{fontSize:10,color:"#475569",marginTop:1}}>{e.category} · {e.date}{e.currency&&e.currency!==currency?` · ${e.currency}`:""}</div></div>
          <div style={{fontSize:13,fontWeight:700,color:c.color,flexShrink:0}}>{eSym}{e.amount.toFixed(2)}</div>
          {!bulk&&<button className="tb" onClick={()=>onDel(e.id)} aria-label={`Delete ${e.name}`} title="Delete"><IcoTrash/></button>}
        </div>);})}
      </div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN APP
// ─────────────────────────────────────────────────────────────────────────────
const TABS = ["Dashboard","AI Logger","Forecast"];

export default function App() {
  const now = new Date();

  const [expenses, setExpenses]     = useState(()=>LS.get("ds_expenses",[]));
  const [activeTab, setActiveTab]   = useState(()=>LS.get("ds_tab","Dashboard"));
  const [budgets, setBudgets]       = useState(()=>LS.get("ds_budgets",{monthly:null,yearly:null}));
  const [currency, setCurrency]     = useState(()=>LS.get("ds_currency","USD"));
  const [cats, setCats]             = useState(()=>LS.get("ds_cats",DEFAULT_CATS));
  const [viewYear, setViewYear]     = useState(now.getFullYear());
  const [viewMonth, setViewMonth]   = useState(now.getMonth());
  const [eName, setEName]           = useState("");
  const [eAmt, setEAmt]             = useState("");
  const [eCur, setECur]             = useState(()=>LS.get("ds_currency","USD"));
  const [eCat, setECat]             = useState(()=>Object.keys(LS.get("ds_cats",DEFAULT_CATS))[0]||"Food");
  const [eDate, setEDate]           = useState(todayStr());
  const [toast, setToast]           = useState(null);
  const [delId, setDelId]           = useState(null);
  const [showImp, setShowImp]       = useState(false);
  const [showCatMgr, setShowCatMgr] = useState(false);
  const [showKeySt, setShowKeySt]   = useState(false);
  const nameRef = useRef(null);

  useEffect(()=>{LS.set("ds_expenses",expenses);},[expenses]);
  useEffect(()=>{LS.set("ds_tab",activeTab);},[activeTab]);
  useEffect(()=>{LS.set("ds_budgets",budgets);},[budgets]);
  useEffect(()=>{LS.set("ds_currency",currency);setECur(currency);},[currency]);
  useEffect(()=>{LS.set("ds_cats",cats);const keys=Object.keys(cats);if(!keys.includes(eCat))setECat(keys[0]||"");},[cats]);

  const catNames   = useMemo(()=>Object.keys(cats),[cats]);
  const nextId     = useMemo(()=>expenses.length?Math.max(...expenses.map(e=>e.id))+1:1,[expenses]);
  const vPfx       = `${viewYear}-${String(viewMonth+1).padStart(2,"0")}`;
  const mExp       = useMemo(()=>expenses.filter(e=>e.date.startsWith(vPfx)),[expenses,vPfx]);
  const totals     = useMemo(()=>{const m={};catNames.forEach(c=>(m[c]=0));mExp.forEach(e=>{if(m[e.category]!==undefined)m[e.category]+=e.amount;});return m;},[mExp,catNames]);
  const gTotal     = Object.values(totals).reduce((a,b)=>a+b,0);
  const maxCat     = Math.max(...Object.values(totals),0);
  const topCat     = useMemo(()=>catNames.reduce((b,c)=>(totals[c]||0)>(totals[b]||0)?c:b,catNames[0]||""),[totals,catNames]);
  const topPct     = gTotal>0?((totals[topCat]/gTotal)*100).toFixed(0):0;
  const donut      = catNames.map(c=>({label:c,value:totals[c]||0,color:cats[c]?.color}));
  const sym        = getSym(currency);
  const hist       = useMemo(()=>{const g={};[...expenses].sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id).forEach(e=>{const k=e.date.slice(0,7);if(!g[k])g[k]=[];g[k].push(e);});return Object.entries(g).sort(([a],[b])=>b.localeCompare(a));},[expenses]);
  const goMo = d=>{let m=viewMonth+d,y=viewYear;if(m<0){m=11;y--;}if(m>11){m=0;y++;}setViewMonth(m);setViewYear(y);};

  const toast2 = (msg,type="ok")=>{setToast({msg,type});setTimeout(()=>setToast(null),2800);};
  const handleAdd = ()=>{
    if(!eName.trim()){toast2("Please enter an expense name","err");nameRef.current?.focus();return;}
    const a=parseFloat(eAmt);
    if(!eAmt||isNaN(a)||a<=0){toast2("Please enter a valid amount","err");return;}
    setExpenses(p=>[...p,{id:nextId,name:eName.trim(),amount:parseFloat(a.toFixed(2)),currency:eCur,category:eCat||catNames[0],date:eDate||todayStr()}]);
    setEName("");setEAmt(""); toast2("Expense added ✓");
    setTimeout(()=>nameRef.current?.focus(),50);
  };
  const handleAddDirect = useCallback(item=>{setExpenses(p=>[...p,item]);toast2(`Added "${item.name}" ✓`);},[]);
  const handleDel = useCallback(id=>{setDelId(id);setTimeout(()=>{setExpenses(p=>p.filter(e=>e.id!==id));setDelId(null);toast2("Removed");},280);},[]);
  const handleImp = items=>{setExpenses(p=>[...p,...items]);toast2(`${items.length} transaction${items.length!==1?"s":""} imported ✓`);};

  const inp={width:"100%",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,padding:"11px 14px",color:"#F1F5F9",fontSize:14,outline:"none",boxSizing:"border-box",minHeight:46};
  const slc={width:"100%",background:"#0F1929",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,padding:"11px 14px",color:"#F1F5F9",fontSize:14,cursor:"pointer",outline:"none",boxSizing:"border-box",minHeight:46};

  return (
    <div style={{minHeight:"100vh",background:"#070C18",fontFamily:"'Inter',-apple-system,sans-serif",paddingBottom:80,color:"#F1F5F9",overflowX:"hidden"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        *{box-sizing:border-box;}
        input::placeholder,textarea::placeholder{color:#334155;}
        input:focus,select:focus,textarea:focus{outline:2px solid rgba(110,231,183,0.5)!important;outline-offset:1px;}
        .tb{background:transparent;border:none;border-radius:7px;color:#F87171;cursor:pointer;padding:6px;display:flex;align-items:center;justify-content:center;transition:background 0.15s;flex-shrink:0;min-width:36px;min-height:36px;}
        .tb:hover{background:rgba(248,113,113,0.14);}
        button:focus-visible{outline:2px solid rgba(110,231,183,0.6)!important;outline-offset:2px;}
        input[type="date"]::-webkit-calendar-picker-indicator{filter:invert(0.4);cursor:pointer;}
        @keyframes fadeUp{from{opacity:0;transform:translateX(-50%) translateY(8px);}to{opacity:1;transform:translateX(-50%) translateY(0);}}
        .chip-row{display:flex;gap:7px;overflow-x:auto;padding-bottom:3px;-webkit-overflow-scrolling:touch;scrollbar-width:none;}
        .chip-row::-webkit-scrollbar{display:none;}
        .cat-chip{flex-shrink:0;display:flex;align-items:center;gap:4px;padding:6px 12px;border-radius:16px;border:1.5px solid;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.15s;min-height:34px;white-space:nowrap;background:transparent;}
        .dash-grid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:16px;align-items:start;}
        .form-2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;}
        @media(max-width:700px){.dash-grid{grid-template-columns:minmax(0,1fr)!important;}.form-2{grid-template-columns:minmax(0,1fr)!important;}.hide-sm{display:none!important;}}
        @media(max-width:480px){.hide-xs{display:none!important;}}
        @media(max-width:420px){.tab-txt{display:none;}}
      `}</style>

      {/* ════ HEADER ════ */}
      <header style={{background:"#0B1120",borderBottom:"1px solid rgba(255,255,255,0.06)",position:"sticky",top:0,zIndex:50}}>
        <div style={{maxWidth:960,margin:"0 auto",padding:"0 16px",height:52,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
          <span style={{fontSize:15,fontWeight:800,letterSpacing:"-0.5px",flexShrink:0}}>💸 DailySpend</span>

          <nav aria-label="Month navigation" style={{display:"flex",alignItems:"center",gap:2,background:"rgba(255,255,255,0.05)",borderRadius:8,padding:"2px 4px"}}>
            <button onClick={()=>goMo(-1)} aria-label="Previous month" style={{background:"transparent",border:"none",cursor:"pointer",color:"#94A3B8",display:"flex",padding:5,borderRadius:6,minWidth:30,minHeight:30,alignItems:"center",justifyContent:"center"}}><IcoChL/></button>
            <span style={{fontSize:12,fontWeight:700,color:"#F1F5F9",minWidth:96,textAlign:"center"}} aria-live="polite">{SMONTHS[viewMonth]} {viewYear}</span>
            <button onClick={()=>goMo(+1)} aria-label="Next month" style={{background:"transparent",border:"none",cursor:"pointer",color:"#94A3B8",display:"flex",padding:5,borderRadius:6,minWidth:30,minHeight:30,alignItems:"center",justifyContent:"center"}}><IcoChR/></button>
          </nav>

          <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
            <label htmlFor="cur-hdr" className="hide-sm" style={{fontSize:10,color:"#64748B",fontWeight:600}}>Currency</label>
            <select id="cur-hdr" value={currency} onChange={e=>setCurrency(e.target.value)} aria-label="Currency"
              style={{background:"transparent",border:"1px solid rgba(255,255,255,0.1)",borderRadius:7,padding:"4px 8px",color:"#94A3B8",fontSize:11,cursor:"pointer",outline:"none",fontWeight:600,minHeight:30}}>
              {CURRENCIES.map(c=><option key={c.code} value={c.code} style={{background:"#111827"}}>{c.code} {c.sym}</option>)}
            </select>
            <button onClick={()=>setShowCatMgr(true)} aria-label="Manage categories" className="hide-xs" style={{background:"rgba(196,181,253,0.1)",border:"1px solid rgba(196,181,253,0.2)",borderRadius:8,padding:"5px 10px",color:"#C4B5FD",fontSize:11,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:4,minHeight:30}}>
              <IcoTag/><span className="hide-sm">Categories</span>
            </button>
            <button onClick={()=>setShowImp(true)} aria-label="Smart import" className="hide-xs" style={{background:"rgba(110,231,183,0.1)",border:"1px solid rgba(110,231,183,0.2)",borderRadius:8,padding:"5px 10px",color:"#6EE7B7",fontSize:11,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:4,minHeight:30}}>
              <IcoUp/><span className="hide-sm">Import</span>
            </button>
            {/* Settings / API key button — hidden in Claude env */}
            {!CLAUDE_ENV && (
              <button onClick={()=>setShowKeySt(true)} aria-label="API Key Settings" title="API Key Settings"
                style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,padding:"5px 9px",color:"#64748B",fontSize:11,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:4,minHeight:30}}>
                <IcoSettings/>
              </button>
            )}
          </div>
        </div>

        {/* Tab bar */}
        <div style={{maxWidth:960,margin:"0 auto",padding:"0 12px",borderTop:"1px solid rgba(255,255,255,0.05)",display:"flex",gap:2}}>
          {TABS.map(t=>(
            <button key={t} onClick={()=>setActiveTab(t)} aria-current={activeTab===t?"page":undefined}
              style={{padding:"9px 16px",border:"none",fontSize:12,fontWeight:600,cursor:"pointer",background:"transparent",minHeight:40,display:"flex",alignItems:"center",gap:5,transition:"color 0.15s",color:activeTab===t?"#6EE7B7":"#475569",borderBottom:activeTab===t?"2px solid #6EE7B7":"2px solid transparent"}}>
              <span aria-hidden="true">{t==="Dashboard"?"📊":t==="AI Logger"?"🗣️":"🔮"}</span>
              <span className="tab-txt">{t}</span>
            </button>
          ))}
        </div>
      </header>

      {/* Insight banner */}
      {gTotal>0&&activeTab==="Dashboard"&&topCat&&(
        <div role="status" style={{background:`linear-gradient(135deg,${cats[topCat]?.bg||"rgba(110,231,183,0.08)"},rgba(255,255,255,0.02))`,borderBottom:`1px solid ${cats[topCat]?.color||"#6EE7B7"}22`,padding:"9px 20px",display:"flex",alignItems:"center",gap:9,fontSize:12,color:"#94A3B8"}}>
          <span aria-hidden="true" style={{fontSize:14}}>{cats[topCat]?.icon}</span>
          <span><span style={{color:cats[topCat]?.color,fontWeight:700}}>{topCat}</span> leads in {MONTHS[viewMonth]} — <span style={{color:"#F1F5F9",fontWeight:600}}>{sym}{(totals[topCat]||0).toFixed(2)}</span> ({topPct}%)</span>
        </div>
      )}

      <main style={{maxWidth:960,margin:"0 auto",padding:"16px 14px 0"}}>

        {/* ════ DASHBOARD ════ */}
        {activeTab==="Dashboard"&&(
          <div className="dash-grid">
            {/* LEFT: action first */}
            <div>
              {/* Dominant Add Expense card */}
              <div style={{background:"linear-gradient(135deg,rgba(52,211,153,0.09),rgba(5,150,105,0.04))",border:"1.5px solid rgba(52,211,153,0.28)",borderRadius:18,padding:"20px 18px",marginBottom:14}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
                  <h2 style={{fontSize:15,fontWeight:800,color:"#F8FAFC",margin:0,letterSpacing:"-0.3px"}}>Add Expense</h2>
                  <div style={{display:"flex",gap:6}}>
                    <button onClick={()=>setShowCatMgr(true)} aria-label="Manage categories" style={{fontSize:11,fontWeight:700,color:"#C4B5FD",background:"rgba(196,181,253,0.12)",border:"1px solid rgba(196,181,253,0.25)",borderRadius:8,padding:"5px 9px",cursor:"pointer",minHeight:30,display:"flex",alignItems:"center",gap:4}}><IcoTag/><span className="hide-sm">Categories</span></button>
                    <button onClick={()=>setActiveTab("AI Logger")} aria-label="AI Logger" style={{fontSize:11,fontWeight:700,color:"#818CF8",background:"rgba(129,140,248,0.12)",border:"1px solid rgba(129,140,248,0.25)",borderRadius:8,padding:"5px 9px",cursor:"pointer",minHeight:30}}>🗣️ <span className="hide-sm">AI Logger</span></button>
                  </div>
                </div>
                <label htmlFor="exp-name" style={{fontSize:10,color:"#6EE7B7",fontWeight:700,display:"block",marginBottom:6,letterSpacing:"0.3px"}}>WHAT DID YOU SPEND ON?</label>
                <input ref={nameRef} id="exp-name" value={eName} onChange={e=>setEName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAdd()} placeholder="e.g. Groceries, Uber, Netflix…" aria-required="true"
                  style={{...inp,fontSize:15,fontWeight:600,marginBottom:12,background:"rgba(255,255,255,0.07)",border:"1.5px solid rgba(52,211,153,0.3)"}}/>
                <div className="form-2" style={{marginBottom:12}}>
                  <div><label htmlFor="exp-amt" style={{fontSize:10,color:"#64748B",fontWeight:600,display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:"0.6px"}}>Amount</label><input id="exp-amt" type="number" min="0" step="0.01" value={eAmt} onChange={e=>setEAmt(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAdd()} placeholder={`0.00 ${sym}`} aria-required="true" style={inp}/></div>
                  <div><label htmlFor="exp-cur" style={{fontSize:10,color:"#64748B",fontWeight:600,display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:"0.6px"}}>Currency</label><select id="exp-cur" value={eCur} onChange={e=>setECur(e.target.value)} style={slc}>{CURRENCIES.map(c=><option key={c.code} value={c.code} style={{background:"#111827"}}>{c.code} {c.sym}</option>)}</select></div>
                </div>
                <label style={{fontSize:10,color:"#64748B",fontWeight:600,display:"block",marginBottom:7,textTransform:"uppercase",letterSpacing:"0.6px"}}>Category</label>
                <div className="chip-row" style={{marginBottom:12}}>
                  {catNames.map(c=>{const cfg=cats[c];const active=eCat===c;return(<button key={c} onClick={()=>setECat(c)} aria-pressed={active} className="cat-chip" style={{borderColor:cfg?.color,color:active?"#0B0F1A":cfg?.color,background:active?cfg?.color:"transparent"}}><span>{cfg?.icon}</span><span>{c}</span></button>);})}
                </div>
                <div style={{marginBottom:16}}><label htmlFor="exp-date" style={{fontSize:10,color:"#64748B",fontWeight:600,display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:"0.6px"}}>Date</label><input id="exp-date" type="date" value={eDate} onChange={e=>setEDate(e.target.value)} style={inp}/></div>
                <button onClick={handleAdd} aria-label="Add expense" style={{width:"100%",padding:"15px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#34D399,#059669)",color:"#fff",fontWeight:800,fontSize:15,cursor:"pointer",minHeight:52,boxShadow:"0 4px 20px rgba(52,211,153,0.3)",transition:"transform 0.1s,box-shadow 0.1s"}}
                  onMouseOver={e=>{e.currentTarget.style.transform="translateY(-1px)";e.currentTarget.style.boxShadow="0 6px 24px rgba(52,211,153,0.4)";}}
                  onMouseOut={e=>{e.currentTarget.style.transform="none";e.currentTarget.style.boxShadow="0 4px 20px rgba(52,211,153,0.3)";}}>
                  + Add Expense
                </button>
              </div>

              {hist.length>0&&(<Section title="Recent Transactions" icon="📋" defaultOpen={true} badge={`${expenses.length} total`}>
                {hist.slice(0,3).map(([mk,items])=>(<MonthGroup key={mk} mk={mk} items={items.slice(0,6)} onDel={handleDel} currency={currency} delId={delId} cats={cats}/>))}
              </Section>)}

              {hist.length>3&&(<Section title="Full History" icon="📂" defaultOpen={false} badge={`${hist.length} months`}>
                {hist.map(([mk,items])=>(<MonthGroup key={mk} mk={mk} items={items} onDel={handleDel} currency={currency} delId={delId} cats={cats}/>))}
              </Section>)}

              {hist.length===0&&(<div style={{textAlign:"center",padding:"40px 20px",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:14,marginTop:14}}>
                <div style={{fontSize:36,marginBottom:12}}>💳</div>
                <div style={{fontSize:14,fontWeight:700,color:"#F1F5F9",marginBottom:6}}>No transactions yet</div>
                <div style={{fontSize:12,color:"#475569",lineHeight:1.7}}>Add your first expense above, try the AI Logger,<br/>or import from SMS / bank statement.</div>
              </div>)}
            </div>

            {/* RIGHT: analytics sidebar */}
            <div>
              <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,padding:"14px 16px",marginBottom:0}}>
                <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:gTotal>0?10:0}}>
                  <div><div style={{fontSize:10,fontWeight:600,color:"#64748B",textTransform:"uppercase",letterSpacing:"0.7px",marginBottom:3}}>{SMONTHS[viewMonth]} {viewYear}</div><div style={{fontSize:28,fontWeight:800,color:"#F8FAFC",letterSpacing:"-1px"}}>{sym}{gTotal.toFixed(2)}</div><div style={{fontSize:11,color:"#475569",marginTop:3}}>{mExp.length} transaction{mExp.length!==1?"s":""} · All time: {expenses.length}</div></div>
                  {gTotal>0&&topCat&&(<div style={{textAlign:"right"}}><div style={{fontSize:10,color:"#64748B",marginBottom:3}}>Top</div><div style={{fontSize:13,fontWeight:700,color:cats[topCat]?.color}}>{cats[topCat]?.icon} {topCat}</div><div style={{fontSize:10,color:"#475569"}}>{topPct}%</div></div>)}
                </div>
                {(budgets.monthly||budgets.yearly)&&gTotal>0&&(<div style={{paddingTop:10,borderTop:"1px solid rgba(255,255,255,0.06)"}}><BudgetPanel budgets={budgets} setBudgets={setBudgets} currency={currency} monthSpend={gTotal} expenses={expenses}/></div>)}
              </div>

              <Section title="By Category" icon="🍩" defaultOpen={true}>
                <div style={{display:"flex",flexDirection:"column",gap:9}}>{catNames.map(cat=>{const c=cats[cat],val=totals[cat]||0,pct=maxCat>0?(val/maxCat)*100:0;return(<div key={cat} style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:14,width:20,textAlign:"center",flexShrink:0}}>{c?.icon}</span><div style={{flex:1,minWidth:0}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:11,color:"#94A3B8",fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{cat}</span><span style={{fontSize:11,fontWeight:700,color:c?.color,flexShrink:0,marginLeft:8}}>{sym}{val.toFixed(0)}</span></div><div role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} style={{height:5,background:"rgba(255,255,255,0.07)",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${pct}%`,background:c?.color,borderRadius:3,transition:"width 0.5s ease"}}/></div></div></div>);})}</div>
              </Section>
              <Section title="Spending Chart" icon="📈" defaultOpen={false}><BarChart expenses={expenses} viewYear={viewYear} viewMonth={viewMonth} currency={currency}/></Section>
              <Section title="Breakdown Donut" icon="🍩" defaultOpen={false}><Donut data={donut} currency={currency}/></Section>
              <Section title="Budget Settings" icon="💰" defaultOpen={false}><BudgetPanel budgets={budgets} setBudgets={setBudgets} currency={currency} monthSpend={gTotal} expenses={expenses}/></Section>
            </div>
          </div>
        )}

        {/* ════ AI LOGGER ════ */}
        {activeTab==="AI Logger"&&(
          <div style={{maxWidth:640,margin:"0 auto"}}>
            <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:16,padding:18}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
                <div style={{width:36,height:36,borderRadius:10,background:"rgba(129,140,248,0.15)",border:"1px solid rgba(129,140,248,0.25)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🗣️</div>
                <div><h2 style={{fontSize:14,fontWeight:700,color:"#F8FAFC",margin:0}}>AI Expense Logger</h2><div style={{fontSize:11,color:"#64748B",marginTop:1}}>Talk or type — no forms needed</div></div>
              </div>
              <NLPLogger onAdd={handleAddDirect} currency={currency} nextId={nextId} cats={cats}/>
            </div>
            <div className="form-2" style={{marginTop:12}}>
              <button onClick={()=>setActiveTab("Dashboard")} style={{padding:13,borderRadius:12,border:"1px solid rgba(255,255,255,0.08)",background:"rgba(255,255,255,0.03)",color:"#94A3B8",fontSize:12,fontWeight:600,cursor:"pointer",minHeight:46}}>📊 Dashboard</button>
              <button onClick={()=>setShowImp(true)} style={{padding:13,borderRadius:12,border:"1px solid rgba(110,231,183,0.2)",background:"rgba(110,231,183,0.06)",color:"#6EE7B7",fontSize:12,fontWeight:600,cursor:"pointer",minHeight:46}}>📸 Smart Import</button>
            </div>
            {expenses.length>0&&(<div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,padding:"14px 16px",marginTop:12,marginBottom:20}}>
              <div style={{fontSize:10,fontWeight:600,color:"#64748B",textTransform:"uppercase",letterSpacing:"0.8px",marginBottom:10}}>Recent</div>
              {[...expenses].sort((a,b)=>b.id-a.id).slice(0,5).map(e=>{const c=cats[e.category]||{color:"#94A3B8",bg:"rgba(148,163,184,0.12)",icon:"📦"};const eSym=getSym(e.currency||currency);return(<div key={e.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:"1px solid rgba(255,255,255,0.04)"}}><div style={{width:28,height:28,borderRadius:7,background:c.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,flexShrink:0}}>{c.icon}</div><div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:"#F1F5F9",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.name}</div><div style={{fontSize:10,color:"#475569"}}>{e.date} · {e.category}</div></div><div style={{fontSize:12,fontWeight:700,color:c.color}}>{eSym}{e.amount.toFixed(2)}</div></div>);})}
            </div>)}
          </div>
        )}

        {/* ════ FORECAST ════ */}
        {activeTab==="Forecast"&&(
          <div style={{maxWidth:680,margin:"0 auto",paddingBottom:24}}>
            <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:16,padding:18,marginBottom:12}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
                <div style={{width:36,height:36,borderRadius:10,background:"rgba(129,140,248,0.15)",border:"1px solid rgba(129,140,248,0.25)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🔮</div>
                <div><h2 style={{fontSize:14,fontWeight:700,color:"#F8FAFC",margin:0}}>Predictive Cash Flow</h2><div style={{fontSize:11,color:"#64748B",marginTop:1}}>AI forecasts from your historical patterns</div></div>
              </div>
              <ForecastPanel expenses={expenses} budgets={budgets} currency={currency} cats={cats}/>
            </div>
            <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:16,padding:18}}>
              <div style={{fontSize:10,fontWeight:600,color:"#64748B",textTransform:"uppercase",letterSpacing:"0.8px",marginBottom:12}}>Budget Settings</div>
              <BudgetPanel budgets={budgets} setBudgets={setBudgets} currency={currency} monthSpend={gTotal} expenses={expenses}/>
            </div>
          </div>
        )}
      </main>

      {/* Modals */}
      {showImp    && <ImportModal    onClose={()=>setShowImp(false)}    onImport={handleImp} nextId={nextId} cats={cats}/>}
      {showCatMgr && <CategoryManager cats={cats} setCats={setCats}    onClose={()=>setShowCatMgr(false)}/>}
      {showKeySt  && <ApiKeySettings onClose={()=>setShowKeySt(false)}/>}

      {/* Toast */}
      {toast&&(<div role="alert" aria-live="assertive" style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",background:toast.type==="err"?"#1A0A0E":"#0F1E2E",border:toast.type==="err"?"1px solid rgba(252,165,165,0.45)":"1px solid rgba(110,231,183,0.35)",borderRadius:12,padding:"11px 22px",color:toast.type==="err"?"#FCA5A5":"#6EE7B7",fontSize:13,fontWeight:700,pointerEvents:"none",zIndex:400,boxShadow:"0 8px 32px rgba(0,0,0,0.5)",animation:"fadeUp 0.22s ease",whiteSpace:"nowrap"}}>
        {toast.type==="err"?"⚠️ ":"✅ "}{toast.msg}
      </div>)}
    </div>
  );
}
