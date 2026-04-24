// ============================================================
//  AI VOICE SALES AGENT — Multilingual + Human Voice
//  Languages: English, Telugu, Hindi (auto-detect)
//  Voice: Polly.Kajal (Neural — human lady voice)
// ============================================================

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const twilio = require("twilio");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// ─── YOUR KEYS ────────────────────────────────────────────────
const CONFIG = {
  TWILIO_ACCOUNT_SID:  process.env.TWILIO_ACCOUNT_SID  || "PASTE_YOUR_TWILIO_SID_HERE",
  TWILIO_AUTH_TOKEN:   process.env.TWILIO_AUTH_TOKEN   || "PASTE_YOUR_TWILIO_TOKEN_HERE",
  TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER || "PASTE_YOUR_TWILIO_NUMBER_HERE",
  GROQ_API_KEY:        process.env.GROQ_API_KEY        || "PASTE_YOUR_GROQ_KEY_HERE",
  SERVER_URL:          process.env.SERVER_URL           || "https://your-server.up.railway.app",
  WHATSAPP_FROM:       process.env.WHATSAPP_FROM       || "whatsapp:+14155238886",
};

// ─── PRODUCT INFO ─────────────────────────────────────────────
const PRODUCT = {
  agentName:    "Priya",
  company:      "PropSecure Advisors",
  productName:  "HomeShield Plus",
  benefit1:     "complete property and life coverage",
  benefit2:     "zero claim rejection guarantee",
  price:        "999 rupees per month",
  callbackLine: "Our specialist will call you within 2 hours.",
};

// ─── VOICE CONFIG ─────────────────────────────────────────────
// Polly.Kajal = Neural Indian lady voice — most human sounding
const VOICES = {
  en: { voice: "Polly.Kajal",  language: "en-IN" },   // Neural English Indian lady
  hi: { voice: "Polly.Kajal",  language: "hi-IN" },   // Neural Hindi lady
  te: { voice: "Polly.Kajal",  language: "en-IN" },   // Telugu text with Indian voice
};

// ─── INIT ─────────────────────────────────────────────────────
const twilioClient = twilio(CONFIG.TWILIO_ACCOUNT_SID, CONFIG.TWILIO_AUTH_TOKEN);
const callSessions = {};

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

// ─── LANGUAGE DETECTION ───────────────────────────────────────
function detectLanguage(text) {
  if (!text) return "en";
  // Telugu unicode range: 0C00–0C7F
  if (/[\u0C00-\u0C7F]/.test(text)) return "te";
  // Hindi/Devanagari unicode range: 0900–097F
  if (/[\u0900-\u097F]/.test(text)) return "hi";
  // Telugu romanized keywords
  const teluguWords = ["enti","ela","cheppandi","cheppu","avunu","ledu","meeru","nenu","mee","memu","oka","koncham","bagundi","telugu","andaru","emiti","kaadu","aite","sare","chuddam","matladandi","matladudam","ikkade","akkade","emi","eppudu","ekkada","enduku","evaru","emaina"];
  const lowerText = text.toLowerCase();
  if (teluguWords.some(w => lowerText.includes(w))) return "te";
  // Hindi romanized keywords
  const hindiWords = ["kya","hai","haan","nahi","theek","baat","karo","kaise","aap","main","hum","tum","accha","bilkul","samjha","samjhe","batao","dijiye","chahiye","boliye","suniye","dekhiye","jaroor","zaroor","abhi","baad","pehle","phir","suno","bolo","bol","kar","karo"];
  if (hindiWords.some(w => lowerText.includes(w))) return "hi";
  return "en";
}

// ─── GROQ AI — MULTILINGUAL ───────────────────────────────────
async function getGroqReply(customerName, history, detectedLang) {
  const langInstructions = {
    en: `Respond ONLY in English. Be warm and natural like a real Indian lady.`,
    hi: `Respond ONLY in Hindi (Hinglish is also fine). Be warm like a real Indian lady. Example: "Haan ji, bilkul! Hamare HomeShield Plus mein..."`,
    te: `Respond ONLY in Telugu. Be warm like a real Telugu lady. Example: "Avunu sir, mee kosam chala manci offerundi..."`,
  };

  const systemPrompt = `You are ${PRODUCT.agentName}, a warm and friendly Indian lady sales agent for ${PRODUCT.company}. You are on a phone call.

Product: ${PRODUCT.productName}
Benefits: ${PRODUCT.benefit1} and ${PRODUCT.benefit2}
Price: ${PRODUCT.price}

${langInstructions[detectedLang] || langInstructions.en}

IMPORTANT RULES:
- Sound like a REAL human lady — warm, caring, natural pauses in speech
- Max 2-3 sentences — this is a phone call
- If customer is interested → offer specialist callback
- If price objection → emphasize value and savings
- If not interested → thank warmly and say goodbye
- ALWAYS end with a friendly question
- NEVER sound robotic or like a script
- Add natural filler words like "actually", "you know", "I mean" in English
- In Hindi add "ji", "aap", "zaroor"
- In Telugu add "sir/madam", "avunu", "cheppandi"`;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${CONFIG.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: "llama3-8b-8192",
      max_tokens: 180,
      temperature: 0.85,  // Higher = more natural/human
      messages: [{ role: "system", content: systemPrompt }, ...history],
    }),
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

// ─── TWIML WITH HUMAN VOICE ───────────────────────────────────
function twimlVoice(text, lang, gatherAction = null) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  const voice = VOICES[lang] || VOICES.en;

  // Add SSML for more human-like speech
  const ssmlText = `<speak><prosody rate="95%" pitch="+2%">${text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</prosody></speak>`;

  if (gatherAction) {
    const gather = twiml.gather({
      input: "speech",
      action: gatherAction,
      speechTimeout: "auto",
      language: "hi-IN,en-IN,te-IN",  // Listen for ALL 3 languages
      speechModel: "phone_call",
      enhanced: "true",
    });
    gather.say({
      voice: voice.voice,
      language: voice.language,
    }, text);
    twiml.redirect(gatherAction);
  } else {
    twiml.say({
      voice: voice.voice,
      language: voice.language,
    }, text);
    twiml.hangup();
  }
  return twiml.toString();
}

// ─── WHATSAPP ─────────────────────────────────────────────────
async function sendWhatsApp(customerPhone, customerName, outcome, lang) {
  const messages = {
    en: outcome === "interested"
      ? `Hello ${customerName}! 👋\n\nThank you for speaking with *${PRODUCT.agentName}* from *${PRODUCT.company}* today!\n\nYou showed interest in *${PRODUCT.productName}*:\n✅ ${PRODUCT.benefit1}\n✅ ${PRODUCT.benefit2}\n✅ Starting at just *${PRODUCT.price}*\n\n📞 *${PRODUCT.callbackLine}*\n\nFeel free to reply here anytime! 😊`
      : `Hello ${customerName}! 🙏\n\nThank you for your time today. If you ever want to explore *${PRODUCT.productName}*, we are always here.\n\nHave a wonderful day! 🌟\n— ${PRODUCT.agentName}, ${PRODUCT.company}`,

    hi: outcome === "interested"
      ? `Namaste ${customerName} ji! 👋\n\n*${PRODUCT.agentName}* se baat karne ke liye shukriya!\n\nAapne *${PRODUCT.productName}* mein interest dikhaya:\n✅ ${PRODUCT.benefit1}\n✅ ${PRODUCT.benefit2}\n✅ Sirf *${PRODUCT.price}* se shuru\n\n📞 *Hamara specialist 2 ghante mein call karega.*\n\nKoi bhi sawaal ho toh yahan reply karein! 😊`
      : `Namaste ${customerName} ji! 🙏\n\nAapka samay dene ke liye dhanyavaad. Agar kabhi bhi *${PRODUCT.productName}* ke baare mein jaanna ho toh zaroor contact karein!\n\n— ${PRODUCT.agentName}, ${PRODUCT.company}`,

    te: outcome === "interested"
      ? `Namaskaram ${customerName} garu! 👋\n\n*${PRODUCT.agentName}*తో మాట్లాడినందుకు ధన్యవాదాలు!\n\n*${PRODUCT.productName}* పై మీరు ఆసక్తి చూపించారు:\n✅ ${PRODUCT.benefit1}\n✅ ${PRODUCT.benefit2}\n✅ కేవలం *${PRODUCT.price}* నుండి మొదలవుతుంది\n\n📞 *మా specialist 2 గంటల్లో call చేస్తారు.*\n\nఏదైనా అడగాలంటే ఇక్కడ reply చేయండి! 😊`
      : `Namaskaram ${customerName} garu! 🙏\n\nమీ సమయానికి చాలా ధన్యవాదాలు. భవిష్యత్తులో *${PRODUCT.productName}* గురించి తెలుసుకోవాలంటే మాకు call చేయండి!\n\n— ${PRODUCT.agentName}, ${PRODUCT.company}`,
  };

  const message = (messages[lang] || messages.en);

  try {
    const result = await twilioClient.messages.create({
      from: CONFIG.WHATSAPP_FROM,
      to: `whatsapp:${customerPhone}`,
      body: message,
    });
    log(`✅ WhatsApp sent (${lang}) — SID: ${result.sid}`);
  } catch (err) {
    log(`❌ WhatsApp failed: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
//  CALL LAUNCHER UI
// ═══════════════════════════════════════════════════════════════
app.get("/launch", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI Sales Agent — Call Launcher</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Outfit',sans-serif;background:#08090A;color:#EEF0F5;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#0F1117;border:1px solid #1E2330;border-radius:16px;padding:32px;width:100%;max-width:460px}
.logo{text-align:center;margin-bottom:24px}
.logo-icon{font-size:38px;margin-bottom:8px}
.logo-title{font-size:22px;font-weight:700;color:#00E5A0}
.logo-sub{font-size:12px;color:#636B82;margin-top:4px}
.lang-badges{display:flex;gap:6px;justify-content:center;margin-top:10px;flex-wrap:wrap}
.lang-badge{padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
.lb-en{background:rgba(0,229,160,0.1);border:1px solid rgba(0,229,160,0.3);color:#00E5A0}
.lb-hi{background:rgba(240,192,64,0.1);border:1px solid rgba(240,192,64,0.3);color:#F0C040}
.lb-te{background:rgba(77,158,255,0.1);border:1px solid rgba(77,158,255,0.3);color:#4D9EFF}
.status-bar{display:flex;align-items:center;gap:8px;background:rgba(0,229,160,0.06);border:1px solid rgba(0,229,160,0.2);border-radius:8px;padding:10px 14px;margin-bottom:20px}
.dot{width:8px;height:8px;border-radius:50%;background:#00E5A0;animation:pulse 2s infinite;flex-shrink:0}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
.status-text{font-size:12px;color:#00E5A0;font-family:monospace}
label{display:block;font-size:11px;font-weight:600;color:#636B82;margin-bottom:5px;margin-top:14px;text-transform:uppercase;letter-spacing:0.5px}
input,select{width:100%;background:rgba(255,255,255,0.04);border:1px solid #1E2330;border-radius:8px;padding:10px 13px;color:#EEF0F5;font-size:14px;font-family:'Outfit',sans-serif;transition:border-color 0.15s}
input:focus,select:focus{outline:none;border-color:#00E5A0}
select option{background:#0F1117}
.btn{width:100%;margin-top:20px;padding:13px;background:#00E5A0;color:#08090A;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;font-family:'Outfit',sans-serif;transition:all 0.15s}
.btn:hover{opacity:0.88;transform:translateY(-1px)}
.btn:disabled{opacity:0.4;cursor:not-allowed;transform:none}
#msg{margin-top:14px;padding:12px 14px;border-radius:8px;font-size:13px;display:none;white-space:pre-line;text-align:center;line-height:1.6}
.ok{background:rgba(0,229,160,0.1);border:1px solid rgba(0,229,160,0.3);color:#00E5A0}
.err{background:rgba(255,90,101,0.1);border:1px solid rgba(255,90,101,0.3);color:#FF5A65}
.loading{background:rgba(77,158,255,0.1);border:1px solid rgba(77,158,255,0.3);color:#4D9EFF}
.divider{height:1px;background:#1E2330;margin:20px 0}
.log-title{font-size:11px;color:#636B82;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px}
.call-row{display:flex;justify-content:space-between;align-items:center;padding:9px 12px;background:rgba(255,255,255,0.02);border-radius:8px;margin-bottom:6px;font-size:13px}
.badge{font-size:11px;padding:2px 8px;border-radius:20px}
.b-calling{background:rgba(77,158,255,0.15);color:#4D9EFF}
.b-done{background:rgba(0,229,160,0.15);color:#00E5A0}
.b-fail{background:rgba(255,90,101,0.15);color:#FF5A65}
.info-box{background:rgba(77,158,255,0.06);border:1px solid rgba(77,158,255,0.2);border-radius:8px;padding:10px 12px;font-size:12px;color:#4D9EFF;margin-top:14px;line-height:1.6}
</style>
</head>
<body>
<div class="card">
  <div class="logo">
    <div class="logo-icon">🎙️</div>
    <div class="logo-title">AI Sales Agent — Priya</div>
    <div class="logo-sub">Human Voice · Auto Language Detection</div>
    <div class="lang-badges">
      <span class="lang-badge lb-en">🇬🇧 English</span>
      <span class="lang-badge lb-hi">🇮🇳 Hindi</span>
      <span class="lang-badge lb-te">🌟 Telugu</span>
    </div>
  </div>

  <div class="status-bar">
    <div class="dot"></div>
    <div class="status-text">🟢 Online · ${CONFIG.TWILIO_PHONE_NUMBER}</div>
  </div>

  <label>Customer Name</label>
  <input id="name" placeholder="Priya Sharma / ప్రియ శర్మ" />

  <label>Phone Number (with country code)</label>
  <input id="phone" placeholder="+91 98765 43210" />

  <label>Interest</label>
  <select id="interest">
    <option>Home Loan</option>
    <option>Term Insurance</option>
    <option>Property Insurance</option>
    <option>Life Insurance</option>
    <option>Health Insurance</option>
    <option>Investment Property</option>
  </select>

  <button class="btn" id="btn" onclick="makeCall()">📞 Start Real Call Now</button>
  <div id="msg"></div>

  <div class="info-box">
    🤖 <strong>Auto Language:</strong> Agent starts in English. When customer speaks Telugu or Hindi, agent automatically switches to that language!
  </div>

  <div class="divider"></div>
  <div class="log-title">Recent Calls</div>
  <div id="log"><div style="color:#636B82;font-size:13px;text-align:center;padding:8px">No calls yet</div></div>
</div>
<script>
const calls=[];
async function makeCall(){
  const name=document.getElementById('name').value.trim();
  const phone=document.getElementById('phone').value.trim();
  const interest=document.getElementById('interest').value;
  if(!name)return show('⚠️ Please enter customer name!','err');
  if(!phone)return show('⚠️ Please enter phone with country code!\\nExample: +91 98765 43210','err');
  const btn=document.getElementById('btn');
  btn.disabled=true;btn.textContent='⏳ Dialing...';
  show('📞 Calling '+name+' at '+phone+'...\\nAgent will auto-detect their language!','loading');
  try{
    const r=await fetch('/call/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customerName:name,customerPhone:phone,customerInterest:interest})});
    const d=await r.json();
    if(d.success){
      show('✅ '+name+"'s phone is ringing!\\n\\nAgent: Priya (Human voice)\\nLanguages: English + Hindi + Telugu\\n\\nWhatsApp will be sent automatically after call! 📱",'ok');
      addLog(name,phone,'calling');
      document.getElementById('name').value='';
      document.getElementById('phone').value='';
    }else{show('❌ Error: '+d.error,'err');addLog(name,phone,'fail');}
  }catch(e){show('❌ Error: '+e.message,'err');}
  btn.disabled=false;btn.textContent='📞 Start Real Call Now';
}
function show(msg,cls){const el=document.getElementById('msg');el.textContent=msg;el.className=cls;el.style.display='block';}
function addLog(name,phone,status){
  calls.unshift({name,phone,status,time:new Date().toLocaleTimeString()});
  const log=document.getElementById('log');
  log.innerHTML=calls.slice(0,5).map(c=>
    '<div class="call-row"><div><div style="font-weight:600">'+c.name+'</div>'+
    '<div style="color:#636B82;font-size:11px;margin-top:2px">'+c.phone+' · '+c.time+'</div></div>'+
    '<span class="badge b-'+c.status+'">'+(c.status==='calling'?'📞 Calling':c.status==='fail'?'❌ Failed':'✅ Done')+'</span></div>'
  ).join('');
}
document.addEventListener('keypress',e=>{if(e.key==='Enter')makeCall();});
</script>
</body>
</html>`);
});

// ═══════════════════════════════════════════════════════════════
//  ROUTES
// ═══════════════════════════════════════════════════════════════

app.get("/", (req, res) => res.json({
  status: "🟢 Running",
  ai: "Groq Llama3 FREE",
  languages: ["English", "Hindi", "Telugu"],
  voice: "Polly.Kajal (Neural — Human Lady)",
  launcher: CONFIG.SERVER_URL + "/launch",
}));

// 1. Start call
app.post("/call/start", async (req, res) => {
  const { customerPhone, customerName, customerInterest } = req.body;
  if (!customerPhone || !customerName)
    return res.status(400).json({ error: "customerPhone and customerName required" });
  try {
    const call = await twilioClient.calls.create({
      to: customerPhone,
      from: CONFIG.TWILIO_PHONE_NUMBER,
      url: `${CONFIG.SERVER_URL}/call/greeting?name=${encodeURIComponent(customerName)}&interest=${encodeURIComponent(customerInterest || "real estate and insurance")}`,
      statusCallback: `${CONFIG.SERVER_URL}/call/status`,
      statusCallbackEvent: ["completed", "failed", "no-answer"],
      record: true,
      recordingChannels: "dual",
      recordingStatusCallback: `${CONFIG.SERVER_URL}/call/recording`,
    });
    callSessions[call.sid] = {
      customerName, customerPhone, customerInterest,
      callSid: call.sid, startedAt: new Date().toISOString(),
      history: [], transcript: [], outcome: "unknown",
      lang: "en", recordingUrl: null,
    };
    log(`📞 Call started — ${customerName} — SID: ${call.sid}`);
    res.json({ success: true, callSid: call.sid });
  } catch (err) {
    log(`❌ ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// 2. Greeting — always starts in English
app.post("/call/greeting", (req, res) => {
  const callSid = req.body.CallSid;
  const name = req.query.name || "there";
  const greeting = `Hello! Am I speaking with ${name}? Hi ${name}! This is Priya calling from PropSecure Advisors. I'm reaching out about a really exciting offer on home protection and insurance — I think you'll love it! Do you have just 2 minutes?`;

  if (callSessions[callSid]) {
    callSessions[callSid].history.push({ role: "assistant", content: greeting });
    callSessions[callSid].transcript.push({ role: "assistant", content: greeting, ts: new Date().toISOString() });
  }

  res.type("text/xml");
  res.send(twimlVoice(greeting, "en", `${CONFIG.SERVER_URL}/call/gather`));
});

// 3. Gather + detect language + AI reply
app.post("/call/gather", async (req, res) => {
  const callSid = req.body.CallSid;
  const speech = req.body.SpeechResult || "";
  log(`👤 Customer said: "${speech}"`);

  const session = callSessions[callSid];
  if (!session) {
    res.type("text/xml");
    return res.send(twimlVoice("Thank you for your time. Goodbye!", "en", null));
  }

  // Detect language
  const detectedLang = detectLanguage(speech);
  session.lang = detectedLang;
  log(`🌐 Language detected: ${detectedLang}`);

  session.history.push({ role: "user", content: speech });
  session.transcript.push({ role: "user", content: speech, lang: detectedLang, ts: new Date().toISOString() });

  // Detect interest
  const interestWords = ["yes","sure","interested","okay","how much","price","good","callback","avunu","sare","haan","theek","batao","cheppandi","cheppu"];
  if (interestWords.some(w => speech.toLowerCase().includes(w))) session.outcome = "interested";

  // Detect ending
  const endWords = ["bye","goodbye","not interested","stop","no thanks","ledu","vendu","nahi","mat karo","band karo"];
  const isEnding = endWords.some(w => speech.toLowerCase().includes(w));

  try {
    const reply = await getGroqReply(session.customerName, session.history, detectedLang);
    session.history.push({ role: "assistant", content: reply });
    session.transcript.push({ role: "assistant", content: reply, lang: detectedLang, ts: new Date().toISOString() });
    log(`🤖 Groq (${detectedLang}): "${reply}"`);

    res.type("text/xml");
    if (isEnding) {
      if (session.outcome !== "interested") session.outcome = "not_interested";
      res.send(twimlVoice(reply, detectedLang, null));
    } else {
      res.send(twimlVoice(reply, detectedLang, `${CONFIG.SERVER_URL}/call/gather`));
    }
  } catch (err) {
    log(`❌ ${err.message}`);
    res.type("text/xml");
    res.send(twimlVoice("Sorry, I'm having a small technical issue. Our team will call you back shortly. Thank you!", "en", null));
  }
});

// 4. Call ended
app.post("/call/status", async (req, res) => {
  const { CallSid, CallStatus, CallDuration } = req.body;
  log(`📊 ${CallSid} — ${CallStatus} — ${CallDuration}s`);
  const session = callSessions[CallSid];
  if (session) {
    session.status = CallStatus;
    session.duration = CallDuration;
    session.endedAt = new Date().toISOString();
    if (CallStatus === "no-answer") session.outcome = "no-answer";
    const dir = path.join(__dirname, "transcripts");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, `${CallSid}.json`), JSON.stringify(session, null, 2));
    if (CallStatus === "completed") {
      await sendWhatsApp(session.customerPhone, session.customerName, session.outcome, session.lang || "en");
    }
  }
  res.sendStatus(200);
});

// 5. Recording
app.post("/call/recording", (req, res) => {
  const { CallSid, RecordingUrl, RecordingSid, RecordingDuration } = req.body;
  if (callSessions[CallSid]) {
    callSessions[CallSid].recordingUrl = `${RecordingUrl}.mp3`;
    callSessions[CallSid].recordingSid = RecordingSid;
    callSessions[CallSid].recordingDuration = RecordingDuration;
  }
  log(`🎙️ Recording — ${RecordingDuration}s`);
  res.sendStatus(200);
});

// 6. Get calls
app.get("/calls", (req, res) => res.json({ calls: Object.values(callSessions) }));

// 7. WhatsApp manual
app.post("/whatsapp/send", async (req, res) => {
  const { phone, name, message } = req.body;
  try {
    const r = await twilioClient.messages.create({
      from: CONFIG.WHATSAPP_FROM,
      to: `whatsapp:${phone}`,
      body: message || `Hello ${name}! Thank you for your interest. Our team will contact you soon. — ${PRODUCT.agentName}`,
    });
    res.json({ success: true, sid: r.sid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── START ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  log(`🚀 Server running on port ${PORT}`);
  log(`🎙️ Voice: Polly.Kajal Neural (Human Lady)`);
  log(`🌐 Languages: English + Hindi + Telugu`);
  log(`📞 Twilio: ${CONFIG.TWILIO_PHONE_NUMBER}`);
  log(`🌍 Launcher: ${CONFIG.SERVER_URL}/launch`);
});
