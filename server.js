// ============================================================
//  AI VOICE SALES AGENT — Complete Backend Server
//  Stack: Node.js + Express + Twilio + GROQ AI
//  Features: Outbound calls, recording, WhatsApp, Call Launcher UI
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

// ─── YOUR KEYS (set in Railway Variables) ────────────────────
const CONFIG = {
  TWILIO_ACCOUNT_SID:  process.env.TWILIO_ACCOUNT_SID  || "PASTE_YOUR_TWILIO_SID_HERE",
  TWILIO_AUTH_TOKEN:   process.env.TWILIO_AUTH_TOKEN   || "PASTE_YOUR_TWILIO_TOKEN_HERE",
  TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER || "PASTE_YOUR_TWILIO_NUMBER_HERE",
  GROQ_API_KEY:        process.env.GROQ_API_KEY        || "PASTE_YOUR_GROQ_KEY_HERE",
  SERVER_URL:          process.env.SERVER_URL           || "https://your-server.up.railway.app",
  WHATSAPP_FROM:       process.env.WHATSAPP_FROM       || "whatsapp:+14155238886",
};

// ─── YOUR PRODUCT INFO ────────────────────────────────────────
const PRODUCT = {
  agentName:    "Aria",
  company:      "PropSecure Advisors",
  productName:  "HomeShield Plus",
  benefit1:     "complete property and life coverage",
  benefit2:     "zero claim rejection guarantee",
  price:        "999 rupees per month",
  callbackLine: "Our specialist will call you within 2 hours.",
};

// ─── INIT TWILIO ──────────────────────────────────────────────
const twilioClient = twilio(CONFIG.TWILIO_ACCOUNT_SID, CONFIG.TWILIO_AUTH_TOKEN);

// ─── CALL SESSIONS ────────────────────────────────────────────
const callSessions = {};

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ─── GROQ AI ──────────────────────────────────────────────────
async function getGroqReply(customerName, history) {
  const systemPrompt = `You are ${PRODUCT.agentName}, a friendly AI sales agent for ${PRODUCT.company}.
You are on a phone call introducing ${PRODUCT.productName} which offers ${PRODUCT.benefit1} and ${PRODUCT.benefit2}, starting at ${PRODUCT.price}.
RULES:
- Max 2-3 sentences per reply — this is a phone call
- Be warm, natural, never robotic
- If customer is interested → offer to schedule a specialist callback
- If customer asks price → say ${PRODUCT.price} and emphasize value
- If not interested → thank politely and say goodbye
- Always end with a question
- Never say you are an AI`;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${CONFIG.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: "llama3-8b-8192",
      max_tokens: 150,
      messages: [{ role: "system", content: systemPrompt }, ...history],
    }),
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

// ─── TWIML HELPER ─────────────────────────────────────────────
function twimlVoice(text, gatherAction = null) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  if (gatherAction) {
    const gather = twiml.gather({
      input: "speech",
      action: gatherAction,
      speechTimeout: "auto",
      language: "en-IN",
      speechModel: "phone_call",
    });
    gather.say({ voice: "Polly.Aditi", language: "en-IN" }, text);
    twiml.redirect(gatherAction);
  } else {
    twiml.say({ voice: "Polly.Aditi", language: "en-IN" }, text);
    twiml.hangup();
  }
  return twiml.toString();
}

// ─── WHATSAPP ─────────────────────────────────────────────────
async function sendWhatsApp(customerPhone, customerName, outcome) {
  const message = outcome === "interested" || outcome === "sold"
    ? `Hello ${customerName}! 👋\n\nThank you for speaking with *${PRODUCT.agentName}* from *${PRODUCT.company}* today!\n\nYou showed interest in *${PRODUCT.productName}*:\n✅ ${PRODUCT.benefit1}\n✅ ${PRODUCT.benefit2}\n✅ Starting at just *${PRODUCT.price}*\n\n📞 *${PRODUCT.callbackLine}*\n\nQuestions? Just reply here! 😊`
    : `Hello ${customerName}!\n\nThank you for your time today. 🙏\n\nIf you ever want to explore *${PRODUCT.productName}* in the future, we are here for you.\n\nHave a wonderful day! 🌟\n— ${PRODUCT.agentName}, ${PRODUCT.company}`;

  try {
    const result = await twilioClient.messages.create({
      from: CONFIG.WHATSAPP_FROM,
      to: `whatsapp:${customerPhone}`,
      body: message,
    });
    log(`✅ WhatsApp sent — SID: ${result.sid}`);
  } catch (err) {
    log(`❌ WhatsApp failed: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
//  CALL LAUNCHER UI — built into the server
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
</style>
</head>
<body>
<div class="card">
  <div class="logo">
    <div class="logo-icon">🎙️</div>
    <div class="logo-title">AI Sales Agent</div>
    <div class="logo-sub">Powered by Twilio + Groq AI · Free</div>
  </div>

  <div class="status-bar">
    <div class="dot"></div>
    <div class="status-text">🟢 Server Online · ${CONFIG.TWILIO_PHONE_NUMBER}</div>
  </div>

  <label>Customer Name</label>
  <input id="name" placeholder="Priya Sharma" />

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

  <div class="divider"></div>
  <div class="log-title">Recent Calls</div>
  <div id="log"><div style="color:#636B82;font-size:13px;text-align:center;padding:8px">No calls yet</div></div>
</div>

<script>
const calls = [];
async function makeCall() {
  const name = document.getElementById('name').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const interest = document.getElementById('interest').value;
  if (!name) return show('⚠️ Please enter customer name!', 'err');
  if (!phone) return show('⚠️ Please enter phone number with country code!\\nExample: +91 98765 43210', 'err');
  const btn = document.getElementById('btn');
  btn.disabled = true; btn.textContent = '⏳ Dialing...';
  show('📞 Calling ' + name + ' at ' + phone + '...', 'loading');
  try {
    const r = await fetch('/call/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerName: name, customerPhone: phone, customerInterest: interest })
    });
    const d = await r.json();
    if (d.success) {
      show('✅ ' + name + "'s phone is ringing now!\\n\\nCall SID: " + d.callSid + "\\n\\nWhatsApp will be sent automatically after the call.", 'ok');
      addLog(name, phone, 'calling');
      document.getElementById('name').value = '';
      document.getElementById('phone').value = '';
    } else {
      show('❌ Error: ' + d.error, 'err');
      addLog(name, phone, 'fail');
    }
  } catch(e) {
    show('❌ Error: ' + e.message, 'err');
  }
  btn.disabled = false; btn.textContent = '📞 Start Real Call Now';
}
function show(msg, cls) {
  const el = document.getElementById('msg');
  el.textContent = msg; el.className = cls; el.style.display = 'block';
}
function addLog(name, phone, status) {
  calls.unshift({ name, phone, status, time: new Date().toLocaleTimeString() });
  const log = document.getElementById('log');
  log.innerHTML = calls.slice(0,5).map(c =>
    '<div class="call-row"><div><div style="font-weight:600">' + c.name + '</div>' +
    '<div style="color:#636B82;font-size:11px;margin-top:2px">' + c.phone + ' · ' + c.time + '</div></div>' +
    '<span class="badge b-' + c.status + '">' +
    (c.status==='calling'?'📞 Calling':c.status==='fail'?'❌ Failed':'✅ Done') +
    '</span></div>'
  ).join('');
}
document.addEventListener('keypress', e => { if(e.key==='Enter') makeCall(); });
</script>
</body>
</html>`);
});

// ═══════════════════════════════════════════════════════════════
//  API ROUTES
// ═══════════════════════════════════════════════════════════════

// Health check
app.get("/", (req, res) => res.json({
  status: "🟢 Running",
  ai: "Groq Llama3 FREE",
  twilio: CONFIG.TWILIO_PHONE_NUMBER,
  launcher: CONFIG.SERVER_URL + "/launch",
}));

// 1. Start outbound call
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
      history: [], transcript: [], outcome: "unknown", recordingUrl: null,
    };

    log(`📞 Call started — ${customerName} — SID: ${call.sid}`);
    res.json({ success: true, callSid: call.sid });
  } catch (err) {
    log(`❌ Call error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// 2. Greeting
app.post("/call/greeting", (req, res) => {
  const callSid = req.body.CallSid;
  const name = req.query.name || "there";
  const greeting = `Hello! May I speak with ${name}? Hi ${name}! This is ${PRODUCT.agentName} calling from ${PRODUCT.company}. I am reaching out about an exciting real estate and insurance offer I think you will love. Do you have just 2 minutes?`;

  if (callSessions[callSid]) {
    callSessions[callSid].history.push({ role: "assistant", content: greeting });
    callSessions[callSid].transcript.push({ role: "assistant", content: greeting, ts: new Date().toISOString() });
  }

  res.type("text/xml");
  res.send(twimlVoice(greeting, `${CONFIG.SERVER_URL}/call/gather`));
});

// 3. Gather + AI reply
app.post("/call/gather", async (req, res) => {
  const callSid = req.body.CallSid;
  const speech = req.body.SpeechResult || "";
  log(`👤 Customer said: "${speech}"`);

  const session = callSessions[callSid];
  if (!session) {
    res.type("text/xml");
    return res.send(twimlVoice("Thank you for your time. Goodbye!", null));
  }

  session.history.push({ role: "user", content: speech });
  session.transcript.push({ role: "user", content: speech, ts: new Date().toISOString() });

  if (["yes","sure","interested","tell me","okay","how much","price","good","callback"].some(w => speech.toLowerCase().includes(w)))
    session.outcome = "interested";

  const isEnding = ["bye","goodbye","not interested","stop","no thanks","remove"].some(w => speech.toLowerCase().includes(w));

  try {
    const reply = await getGroqReply(session.customerName, session.history);
    session.history.push({ role: "assistant", content: reply });
    session.transcript.push({ role: "assistant", content: reply, ts: new Date().toISOString() });
    log(`🤖 Groq: "${reply}"`);

    res.type("text/xml");
    if (isEnding) {
      if (session.outcome !== "interested") session.outcome = "not_interested";
      res.send(twimlVoice(reply, null));
    } else {
      res.send(twimlVoice(reply, `${CONFIG.SERVER_URL}/call/gather`));
    }
  } catch (err) {
    log(`❌ Groq error: ${err.message}`);
    res.type("text/xml");
    res.send(twimlVoice("Sorry, I am having a technical issue. Our team will call you back shortly. Goodbye!", null));
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
      await sendWhatsApp(session.customerPhone, session.customerName, session.outcome);
    }
  }
  res.sendStatus(200);
});

// 5. Recording ready
app.post("/call/recording", (req, res) => {
  const { CallSid, RecordingUrl, RecordingSid, RecordingDuration } = req.body;
  if (callSessions[CallSid]) {
    callSessions[CallSid].recordingUrl = `${RecordingUrl}.mp3`;
    callSessions[CallSid].recordingSid = RecordingSid;
    callSessions[CallSid].recordingDuration = RecordingDuration;
  }
  log(`🎙️ Recording ready — ${RecordingDuration}s`);
  res.sendStatus(200);
});

// 6. Get all calls
app.get("/calls", (req, res) => res.json({ calls: Object.values(callSessions) }));

// 7. Manual WhatsApp
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

// 8. Bulk campaign
app.post("/campaign/start", async (req, res) => {
  const { customers, delaySeconds = 30 } = req.body;
  if (!customers?.length) return res.status(400).json({ error: "Provide customers array" });
  const results = [];
  for (let i = 0; i < customers.length; i++) {
    const c = customers[i];
    try {
      const call = await twilioClient.calls.create({
        to: c.phone, from: CONFIG.TWILIO_PHONE_NUMBER,
        url: `${CONFIG.SERVER_URL}/call/greeting?name=${encodeURIComponent(c.name)}`,
        statusCallback: `${CONFIG.SERVER_URL}/call/status`,
        statusCallbackEvent: ["completed", "failed", "no-answer"],
        record: true,
        recordingStatusCallback: `${CONFIG.SERVER_URL}/call/recording`,
      });
      callSessions[call.sid] = {
        customerName: c.name, customerPhone: c.phone, callSid: call.sid,
        startedAt: new Date().toISOString(), history: [], transcript: [],
        outcome: "unknown", recordingUrl: null,
      };
      results.push({ name: c.name, callSid: call.sid, status: "initiated" });
      if (i < customers.length - 1) await new Promise(r => setTimeout(r, delaySeconds * 1000));
    } catch (err) {
      results.push({ name: c.name, status: "failed", error: err.message });
    }
  }
  res.json({ success: true, results });
});

// ─── START ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  log(`🚀 Server running on port ${PORT}`);
  log(`🤖 AI: Groq Llama3 (FREE)`);
  log(`📞 Twilio: ${CONFIG.TWILIO_PHONE_NUMBER}`);
  log(`🌍 Launcher: ${CONFIG.SERVER_URL}/launch`);
});
