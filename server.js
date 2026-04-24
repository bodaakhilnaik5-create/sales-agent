// ============================================================
//  AI VOICE SALES AGENT — Backend Server
//  Stack: Node.js + Express + Twilio + GROQ AI + Deepgram
//  Features: Outbound calls, call recording, WhatsApp follow-up
//  AI: Groq (FREE - no credit card needed)
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

// ─── PASTE YOUR KEYS HERE ─────────────────────────────────────
const CONFIG = {
  TWILIO_ACCOUNT_SID:   process.env.TWILIO_ACCOUNT_SID   || "PASTE_YOUR_TWILIO_SID_HERE",
  TWILIO_AUTH_TOKEN:    process.env.TWILIO_AUTH_TOKEN     || "PASTE_YOUR_TWILIO_TOKEN_HERE",
  TWILIO_PHONE_NUMBER:  process.env.TWILIO_PHONE_NUMBER   || "PASTE_YOUR_TWILIO_NUMBER_HERE",
  GROQ_API_KEY:         process.env.GROQ_API_KEY          || "PASTE_YOUR_GROQ_KEY_HERE",
  SERVER_URL:           process.env.SERVER_URL             || "https://your-server.railway.app",
  WHATSAPP_FROM:        process.env.WHATSAPP_FROM         || "whatsapp:+14155238886",
};

// ─── YOUR PRODUCT INFO — edit this ───────────────────────────
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

// ─── IN-MEMORY CALL SESSIONS ──────────────────────────────────
const callSessions = {};

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ─── GROQ AI — generate reply ─────────────────────────────────
async function getGroqReply(customerName, history) {
  const systemPrompt = `You are ${PRODUCT.agentName}, a friendly AI sales agent for ${PRODUCT.company}.
You are on a phone call introducing ${PRODUCT.productName} which offers ${PRODUCT.benefit1} and ${PRODUCT.benefit2}, starting at ${PRODUCT.price}.

STRICT RULES:
- Max 2-3 sentences per reply — this is a phone call
- Be warm, natural, never robotic or pushy
- If customer is interested → offer to schedule a specialist callback
- If customer asks about price → say ${PRODUCT.price} and emphasize value
- If customer says not interested → thank them politely and say goodbye
- Always end with a question to continue the conversation
- Never reveal you are an AI unless directly asked`;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${CONFIG.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: "llama3-8b-8192",
      max_tokens: 150,
      messages: [
        { role: "system", content: systemPrompt },
        ...history,
      ],
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

// ─── WHATSAPP FOLLOW-UP ───────────────────────────────────────
async function sendWhatsApp(customerPhone, customerName, outcome, transcript) {
  const summary = transcript.slice(-4)
    .map(t => `${t.role === "assistant" ? "Agent" : "You"}: ${t.content}`)
    .join("\n");

  let message = outcome === "interested" || outcome === "sold"
    ? `Hello ${customerName}! 👋\n\nThank you for speaking with *${PRODUCT.agentName}* from *${PRODUCT.company}* today!\n\nYou showed interest in *${PRODUCT.productName}*:\n✅ ${PRODUCT.benefit1}\n✅ ${PRODUCT.benefit2}\n✅ Starting at just *${PRODUCT.price}*\n\n📞 *${PRODUCT.callbackLine}*\n\nQuestions? Just reply here! 😊`
    : `Hello ${customerName}!\n\nThank you for your time today. 🙏\n\nIf you ever want to explore *${PRODUCT.productName}* in the future, we're here for you.\n\nHave a wonderful day! 🌟\n— ${PRODUCT.agentName}, ${PRODUCT.company}`;

  try {
    const result = await twilioClient.messages.create({
      from: CONFIG.WHATSAPP_FROM,
      to: `whatsapp:${customerPhone}`,
      body: message,
    });
    log(`✅ WhatsApp sent — SID: ${result.sid}`);
    return { success: true };
  } catch (err) {
    log(`❌ WhatsApp failed: ${err.message}`);
    return { success: false };
  }
}

// ═══════════════════════════════════════════════════════════════
//  ROUTES
// ═══════════════════════════════════════════════════════════════

app.get("/", (req, res) => res.json({ status: "🟢 Running", ai: "Groq Llama3 FREE" }));

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
      history: [], transcript: [], outcome: "unknown", recordingUrl: null,
    };
    log(`📞 Call started — ${customerName} — SID: ${call.sid}`);
    res.json({ success: true, callSid: call.sid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Greeting
app.post("/call/greeting", (req, res) => {
  const callSid = req.body.CallSid;
  const name = req.query.name || "there";
  const greeting = `Hello! May I speak with ${name}? Hi ${name}! This is ${PRODUCT.agentName} calling from ${PRODUCT.company}. I'm reaching out about an exciting real estate and insurance offer I think you'll love. Do you have just 2 minutes?`;
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
  log(`👤 Customer: "${speech}"`);

  const session = callSessions[callSid];
  if (!session) {
    res.type("text/xml");
    return res.send(twimlVoice("Thank you for your time. Goodbye!", null));
  }

  session.history.push({ role: "user", content: speech });
  session.transcript.push({ role: "user", content: speech, ts: new Date().toISOString() });

  if (["yes","sure","interested","tell me","okay","how much","price","good"].some(w => speech.toLowerCase().includes(w)))
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
    log(`❌ ${err.message}`);
    res.type("text/xml");
    res.send(twimlVoice("Sorry, technical issue. Our team will call you back. Goodbye!", null));
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
      await sendWhatsApp(session.customerPhone, session.customerName, session.outcome, session.transcript);
    }
  }
  res.sendStatus(200);
});

// 5. Recording saved
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
        record: true, recordingStatusCallback: `${CONFIG.SERVER_URL}/call/recording`,
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
  log(`🚀 Server on port ${PORT}`);
  log(`🤖 AI: Groq Llama3 (FREE)`);
  log(`📞 Twilio: ${CONFIG.TWILIO_PHONE_NUMBER}`);
});
