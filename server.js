const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const notifier = require('node-notifier');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware
app.use(express.static('public'));
app.use(express.json());

// Load or initialize automated replies configuration
const REPLIES_FILE = 'replies.json';
let automatedReplies = {};

// Default replies
const defaultReplies = {
    "hola": "¡Hola! Gracias por contactarnos. ¿En qué podemos ayudarte el día de hoy?",
    "precio": "Nuestros precios varían según el servicio. Por favor visita nuestra web o especifica qué servicio te interesa.",
    "horario": "Nuestro horario de atención es de Lunes a Viernes de 9:00 AM a 6:00 PM.",
    "direccion": "Estamos ubicados en Calle Falsa 123, Ciudad Ejemplo."
};

function loadReplies() {
    if (fs.existsSync(REPLIES_FILE)) {
        try {
            const data = fs.readFileSync(REPLIES_FILE, 'utf8');
            automatedReplies = JSON.parse(data);
        } catch (err) {
            console.error("Error loading replies:", err);
            automatedReplies = defaultReplies;
        }
    } else {
        automatedReplies = defaultReplies;
        fs.writeFileSync(REPLIES_FILE, JSON.stringify(automatedReplies, null, 2));
    }
}
loadReplies();

// History Storage
const HISTORY_FILE = 'history.json';
let conversations = {};

function loadHistory() {
    if (fs.existsSync(HISTORY_FILE)) {
        try {
            conversations = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        } catch (err) {
            console.error("Error loading history:", err);
            conversations = {};
        }
    }
}
loadHistory();

function saveHistory() {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(conversations, null, 2));
}

const APPOINTMENTS_FILE = 'appointments.json';
let appointmentsData = [];

const KNOWLEDGE_FILE = 'knowledge.json';
let knowledgeData = [];

function loadAppointments() {
    if (fs.existsSync(APPOINTMENTS_FILE)) {
        try {
            appointmentsData = JSON.parse(fs.readFileSync(APPOINTMENTS_FILE, 'utf8'));
        } catch (err) {
            console.error("Error loading appointments:", err);
            appointmentsData = [];
        }
    } else {
        appointmentsData = [
            { id: "1", date: "2026-02-07T10:00", customer: "Carlos", phone: "19362242209", motive: "Demo personalizada de TalosFlow. Demostración de automatización para agencia de seguros.", dur: "30 min", state: "Pendiente", origin: "Bot IA" },
            { id: "2", date: "2026-02-05T13:00", customer: "Yukata Yokoyama Antonio Durán", phone: "18297268656", motive: "Demo para Yukata Yokoyama Antonio Durán sobre autom...", dur: "30 min", state: "Pendiente", origin: "Bot IA" }
        ];
        fs.writeFileSync(APPOINTMENTS_FILE, JSON.stringify(appointmentsData, null, 2));
    }
}
loadAppointments();

function loadKnowledge() {
    if (fs.existsSync(KNOWLEDGE_FILE)) {
        try {
            knowledgeData = JSON.parse(fs.readFileSync(KNOWLEDGE_FILE, 'utf8'));
        } catch (err) {
            console.error("Error loading knowledge:", err);
            knowledgeData = [];
        }
    } else {
        knowledgeData = [
            { id: "1", category: "precios", title: "precios", description: "TalosFlow ofrece planes flexibles según el volumen de conversaciones y funcionalidades: Plan Starter: $99/mes -...", status: "Sincronizado", active: true },
            { id: "2", category: "casos_uso", title: "Casos de Uso", description: "TalosFlow se adapta a diferentes industrias: E-commerce / Tiendas Online: - Responder consultas de productos 24/7 - Capturar...", status: "Sincronizado", active: true },
            { id: "3", category: "general", title: "Información General de...", description: "TalosFlow es una plataforma SaaS de automatización con IA que conecta negocios con WhatsApp Business API y Meta Ads....", status: "Sincronizado", active: true }
        ];
        fs.writeFileSync(KNOWLEDGE_FILE, JSON.stringify(knowledgeData, null, 2));
    }
}
loadKnowledge();

// ───────────────────────────────────────────────────────────
// CAMPAIGN ATTRIBUTION
// ───────────────────────────────────────────────────────────
const CAMPAIGNS_FILE = 'campaigns.json';
let campaignsData = [];

function loadCampaigns() {
    if (fs.existsSync(CAMPAIGNS_FILE)) {
        try {
            campaignsData = JSON.parse(fs.readFileSync(CAMPAIGNS_FILE, 'utf8'));
        } catch (e) {
            campaignsData = [];
        }
    } else {
        // Default starter campaigns
        campaignsData = [
            { id: 'camp_1', name: 'Facebook Ads - Enero', keyword: 'FB-ENE', color: '#1877f2', source: 'facebook', active: true, leads: 0 },
            { id: 'camp_2', name: 'Instagram Stories', keyword: 'IG-STORIES', color: '#e1306c', source: 'instagram', active: true, leads: 0 },
            { id: 'camp_3', name: 'Google Ads', keyword: 'GOOGLE', color: '#4285f4', source: 'google', active: true, leads: 0 },
            { id: 'camp_4', name: 'WhatsApp Link Perfil', keyword: 'PERFIL', color: '#25d366', source: 'organic', active: true, leads: 0 },
            { id: 'camp_5', name: 'Email Marketing', keyword: 'EMAIL', color: '#f59e0b', source: 'email', active: true, leads: 0 }
        ];
        fs.writeFileSync(CAMPAIGNS_FILE, JSON.stringify(campaignsData, null, 2));
    }
}
loadCampaigns();

/**
 * Detects which campaign a first message belongs to.
 * Looks for campaign keywords in the message body.
 * Also handles the pattern: [KEYWORD] anywhere in the message.
 */
function detectCampaign(messageBody) {
    if (!messageBody || typeof messageBody !== 'string') return null;
    const upper = messageBody.toUpperCase();
    for (const camp of campaignsData) {
        if (!camp.active || !camp.keyword) continue;
        const kw = camp.keyword.toUpperCase();
        // Match exact keyword, bracket pattern [KW], or as standalone word
        if (
            upper.includes(`[${kw}]`) ||
            upper.includes(`(${kw})`) ||
            new RegExp(`\\b${kw}\\b`).test(upper)
        ) {
            return camp;
        }
    }
    return null;
}

// WhatsApp Client Initialization
const AGENT_SETTINGS_FILE = 'agentSettings.json';
let agentSettings = {};

function loadAgentSettings() {
    if (fs.existsSync(AGENT_SETTINGS_FILE)) {
        try {
            agentSettings = JSON.parse(fs.readFileSync(AGENT_SETTINGS_FILE, 'utf8'));
        } catch (err) {
            console.error("Error loading agent settings:", err);
            agentSettings = {};
        }
    }
}
loadAgentSettings();
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ],
    },
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    }
});

// Global Error Handlers - CRITICAL for debugging
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

let qrCodeData = null;
let clientStatus = 'disconnected'; // disconnected, qr_ready, connecting, ready, error

const BOT_STATE_FILE = 'botStatus.json';
let isBotEnabled = true;
if (fs.existsSync(BOT_STATE_FILE)) {
    try {
        const stateData = JSON.parse(fs.readFileSync(BOT_STATE_FILE, 'utf8'));
        if (stateData.hasOwnProperty('enabled')) {
            isBotEnabled = stateData.enabled;
        }
    } catch (e) { console.error("Error reading bot state", e); }
}

// Status Helper
function updateStatus(status, logic = null) {
    clientStatus = status;
    io.emit('status_update', { status, logic });
}

client.on('qr', (qr) => {
    console.log('QR Code Received');
    qrcode.toDataURL(qr, (err, url) => {
        if (err) {
            console.error("Error generating QR code", err);
            updateStatus('error', 'Error generating QR code');
            return;
        }
        qrCodeData = url;
        updateStatus('qr_ready', url);
    });
});

client.on('ready', async () => {
    console.log('Client is ready!');
    qrCodeData = null;
    updateStatus('ready');

    // Delay allowing WhatsApp Web's internal store to fully populate.
    setTimeout(async () => {
        try {
            console.log("Fetching existing chats from WhatsApp...");
            let chats = [];
            let retry = 0;
            while (retry < 3) {
                try {
                    chats = await client.pupPage.evaluate(() => {
                        if (!window.Store || !window.Store.Chat) return [];
                        const models = window.Store.Chat.getModelsArray();
                        return models.map(c => {
                            let lastMsgObj = c.msgs && c.msgs.length > 0 ? c.msgs[c.msgs.length - 1] : null;
                            let lastMsgText = "📷 Contenido";
                            if (lastMsgObj && lastMsgObj.body) { lastMsgText = lastMsgObj.body; }
                            return {
                                id: c.id._serialized,
                                name: c.formattedTitle || c.name || c.id._serialized,
                                timestamp: c.t || (lastMsgObj ? lastMsgObj.t : 0),
                                lastMessage: lastMsgText
                            };
                        });
                    });

                    if (chats && chats.length > 0) break;
                } catch (e) {
                    console.error("Retrying getChats()... internal error:", e.message);
                }
                retry++;
                await new Promise(r => setTimeout(r, 4000));
            }

            // Sort the raw chats to make sure the newest (highest timestamp) is on top
            chats.sort((a, b) => b.timestamp - a.timestamp);
            console.log(`Successfully scraped ${chats.length} active chats from WhatsApp Web UI.`);

            for (const chat of chats.slice(0, 50)) {
                if (!chat || !chat.id) continue;
                const chatId = chat.id; // Already serialized in evaluate payload

                if (!conversations[chatId]) {
                    conversations[chatId] = {
                        id: chatId,
                        name: chat.name || chatId,
                        messages: [],
                        lastMessage: chat.lastMessage || "...",
                        timestamp: chat.timestamp || Math.floor(Date.now() / 1000),
                        synced: false
                    };
                } else {
                    conversations[chatId].name = chat.name || chatId;
                    // Dont override valid timestamp with 0
                    if (chat.timestamp) {
                        conversations[chatId].timestamp = chat.timestamp;
                    }
                }
            }

            saveHistory();
            console.log("Sync complete. Emitting to frontend.");
            io.emit('chats_synced');

        } catch (err) {
            console.error("Error fetching initial chats:", err.message);
        }
    }, 5000);
});

client.on('authenticated', () => {
    console.log('Client is authenticated!');
    updateStatus('connecting');
});

client.on('auth_failure', msg => {
    console.error('AUTHENTICATION FAILURE', msg);
    updateStatus('error', 'Authentication failure: ' + msg);
});

client.on('disconnected', (reason) => {
    console.log('Client was logged out', reason);
    updateStatus('disconnected', reason);
    qrCodeData = null;
});

// Helper to process and store messages
async function handleMessage(msg) {
    // Ignore status updates/broadcasts
    if (msg.from === 'status@broadcast') return;

    try {
        // Only load chat/contact info for new incoming messages or if missing
        // For outgoing (msg.fromMe), we still need context

        const chat = await msg.getChat();
        const contact = await msg.getContact();

        const chatId = chat.id._serialized;
        const senderName = contact.pushname || contact.name || contact.number; // fallback
        const isFromMe = msg.fromMe;

        // Initialize chat history if not exists
        if (!conversations[chatId]) {
            conversations[chatId] = {
                id: chatId,
                name: chat.name || senderName || chatId,
                messages: [],
                lastMessage: null,
                timestamp: null
            };
        }

        const messageData = {
            id: msg.id._serialized,
            body: msg.body,
            fromMe: isFromMe,
            timestamp: msg.timestamp, // unix timestamp
            type: msg.type,
            formattedTime: new Date(msg.timestamp * 1000).toLocaleTimeString()
        };

        // Avoid duplicates (checking last 10 messages)
        const isDuplicate = conversations[chatId].messages.slice(-10).some(m => m.id === messageData.id);
        if (!isDuplicate) {
            conversations[chatId].messages.push(messageData);
            conversations[chatId].lastMessage = msg.body;
            conversations[chatId].timestamp = msg.timestamp;

            // Keep only last 50 messages
            if (conversations[chatId].messages.length > 50) {
                conversations[chatId].messages.shift();
            }

            // Extract CRM data automatically
            if (messageData.body && typeof messageData.body === 'string') {
                const bodyStr = messageData.body;
                const emailMatch = bodyStr.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/);
                if (emailMatch) {
                    conversations[chatId].email = emailMatch[1];
                }
                const nameMatch = bodyStr.match(/(?:me llamo|mi nombre es)\s+([A-ZáéíóúÁÉÍÓÚñÑ][a-záéíóúñ]+(?:\s+[A-ZáéíóúÁÉÍÓÚñÑ][a-záéíóúñ]+)?)/i);
                if (nameMatch && nameMatch[1]) {
                    conversations[chatId].extractedName = nameMatch[1];
                }
            }

            // ── CAMPAIGN ATTRIBUTION: detect from any incoming message ──
            if (!isFromMe && !conversations[chatId].campaign) {
                const detectedCampaign = detectCampaign(messageData.body);
                if (detectedCampaign) {
                    conversations[chatId].campaign = {
                        id: detectedCampaign.id,
                        name: detectedCampaign.name,
                        source: detectedCampaign.source,
                        color: detectedCampaign.color,
                        keyword: detectedCampaign.keyword,
                        detectedAt: new Date().toISOString(),
                        detectedFromMessage: messageData.body.substring(0, 100)
                    };
                    const campRecord = campaignsData.find(c => c.id === detectedCampaign.id);
                    if (campRecord) campRecord.leads = (campRecord.leads || 0) + 1;
                    fs.writeFileSync(CAMPAIGNS_FILE, JSON.stringify(campaignsData, null, 2));
                    console.log(`[Attribution] Lead ${chatId} → campaña: ${detectedCampaign.name}`);
                    io.emit('campaign_attributed', { chatId, campaign: conversations[chatId].campaign });
                }
            }

            saveHistory();

            // Emit to frontend
            io.emit('chat_update', {
                chatId: chatId,
                message: messageData,
                chatName: conversations[chatId].name,
                timestamp: conversations[chatId].timestamp
            });

            // Trigger OS Notification
            if (!isFromMe) {
                notifier.notify({
                    title: `Nuevo mensaje de ${conversations[chatId].name}`,
                    message: messageData.body || 'Nuevo archivo adjunto/sticker',
                    appID: "AutoCRM WhatsApp Web",
                    sound: true,
                    wait: false
                });
            }
        }

        // Automated Reply / AI Logic
        if (isBotEnabled && !isFromMe && !isDuplicate && !chat.isGroup) {
            const rawBody = msg.body || '';
            let responded = false;

            console.log(`[Bot Logic] Mensaje Entrante de ${senderName}: "${rawBody}"`);

            // 1. First prioritize EXACT matches (Respuestas Automáticas)
            if (agentSettings['agentSettings_auto-replies'] !== 'false') {
                for (const [key, responseText] of Object.entries(automatedReplies)) {
                    if (!key || !responseText) continue;
                    const cleanKey = key.trim().toLowerCase();
                    if (rawBody.toLowerCase().includes(cleanKey)) {
                        console.log(`[Bot Logic] Coincidencia exacta encontrada para: "${cleanKey}"`);
                        setTimeout(() => chat.sendMessage(responseText), 1000);
                        responded = true;
                        break;
                    }
                }
            }

            // 2. Fallback to Gemini AI or Simulated Smart Bot if no exact match
            if (!responded) {


                // Check if we should use Gemini AI (if API key is somewhat defined / mocked)
                // For this demo, let's use a mocked AI response if the user requested a "smart" bot
                // We will use a fallback or an actual Gemini call if process.env.GEMINI_API_KEY is available or hardcoded globally.
                // But we can construct an intelligent prompt using agentSettings!

                try {
                    // Initialize generative AI if it's available. To make this work locally without a real KEY instantly,
                    // we'll try to use it if configured, otherwise provide a very smart simulated response or fallback to rules.

                    // Usually the API key would come from agentSettings['api-key'] or env.
                    const apiKey = process.env.GEMINI_API_KEY || "simulated";

                    if (apiKey !== "simulated") {
                        const genAI = new GoogleGenerativeAI(apiKey);
                        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

                        const name = agentSettings['agentSettings_agent-name'] || 'Eryum';
                        const role = agentSettings['agentSettings_agent-role'] || 'asistente';
                        const personality = agentSettings['agentSettings_agent-personality'] || 'amable';
                        const business = agentSettings['agentSettings_business-name'] || 'TalosFlow';
                        const desc = agentSettings['agentSettings_business-desc'] || '';
                        const prods = agentSettings['agentSettings_business-products'] || '';
                        const lang = agentSettings['agentSettings_agent-language'] || 'Español';
                        const tone = agentSettings['agentSettings_agent-tone'] || 'amigable';

                        let historyStr = conversations[chatId].messages.slice(-5).map(m => `${m.fromMe ? 'Asistente' : 'Cliente'}: ${m.body}`).join('\n');
                        let kbStr = knowledgeData.map(k => `${k.title}: ${k.description}`).join('\n');

                        const prompt = `Eres ${name}, un ${role} de la empresa ${business}. 
Tu personalidad es ${personality}, respondes en ${lang} con un tono ${tone}.
No digas que eres una IA. Conversa fluidamente como un humano experto.
Información de la empresa: ${desc}
Nuestros servicios: ${prods}
Base de Conocimientos secreta (usa esto para ayudar al cliente):
${kbStr}

Historial reciente:
${historyStr}

Cliente acaba de decir: "${rawBody}"
Responde al cliente de manera corta, resolutiva y supremamente natural (como si estuvieras chateando por WhatsApp, usa un emoji si corresponde, pero no exageres):`;

                        const result = await model.generateContent(prompt);
                        const aiResponse = result.response.text();

                        setTimeout(() => {
                            chat.sendMessage(aiResponse).then(() => {
                                console.log(`[Gemini AI] ✓ Mensaje enviado: "${aiResponse}"`);
                            }).catch(err => console.error("[Gemini AI] Error:", err));
                        }, 2000);
                        responded = true;

                    } else {
                        // Simulated Smart Bot for immediate demo satisfaction without API keys
                        console.log(`[SmartSimulated Bot] Analyzing intent intelligently...`);
                        const lowerBody = rawBody.toLowerCase();
                        let responseText = "";

                        const name = agentSettings['agentSettings_agent-name'] || 'Eryum';
                        const business = agentSettings['agentSettings_business-name'] || 'TalosFlow';

                        if (lowerBody.includes('hola') || lowerBody.includes('buenos dias') || lowerBody.includes('buenas tardes')) {
                            responseText = `¡Hola! 👋 Soy ${name} de ${business}. Qué gusto saludarte. ¿En qué puedo ayudarte hoy para automatizar tu negocio?`;
                        } else if (lowerBody.includes('precio') || lowerBody.includes('costo') || lowerBody.includes('cuanto')) {
                            responseText = `Nuestros planes son súper flexibles. 🚀 Empezamos desde $99/mes con el Plan Starter, ideal para arrancar. ¿Cuántos leads o mensajes manejas al mes aprox, para darte una recomendación más exacta?`;
                        } else if (lowerBody.includes('funciona') || lowerBody.includes('como es') || lowerBody.includes('informacion')) {
                            responseText = `¡Claro! Básicamente conectamos a ${business} a tu WhatsApp y Meta Ads. Hacemos que la IA califique a tus clientes y responda dudas 24/7 sin que tú muevas un dedo. ¿Te gustaría agendar una demo rápida para verlo en vivo?`;
                        } else if (lowerBody.includes('demo') || lowerBody.includes('agenda') || lowerBody.includes('reunion')) {
                            responseText = `¡Excelente! 🗓️ Puedes agendar el día y la hora que mejor te acomode directamente en este link: https://calendly.com/${business.toLowerCase()}/demo . ¡Ahí nos vemos!`;
                        } else if (lowerBody.includes('humano') || lowerBody.includes('persona') || lowerBody.includes('hablar con alguien')) {
                            responseText = `Por supuesto. En este momento estoy transfiriendo este chat a uno de nuestros expertos. 👨‍💻 Te responderá en unos minutos por aquí mismo.`;
                        } else {
                            responseText = `Entiendo... la verdad es que cada negocio es un mundo. Basado en nuestra base de conocimientos, puedo ayudarte mejor si me cuentas: ¿cuál es el mayor cuello de botella que tienes ahora mismo en tu atención al cliente? 🤔`;
                        }

                        setTimeout(() => {
                            chat.sendMessage(responseText).then(() => {
                                console.log(`[Smart Bot] ✓ Mensaje enviado: "${responseText}"`);
                            }).catch(err => console.error("[Smart Bot] Error:", err));
                        }, 2000 + Math.random() * 2000); // 2 to 4 seconds delay to seem human
                        responded = true;
                    }

                } catch (aiError) {
                    console.error("[AiLogic] Error connecting to Gemini API:", aiError);
                }

            } // End of if (!responded)
        }
    } catch (err) {
        console.error("Error processing message:", err);
    }
}

// Captures ALL messages (incoming and outgoing)
client.on('message_create', handleMessage);


// Initialize client with error handling
console.log("Initializing WhatsApp Client...");
client.initialize().catch(err => {
    console.error("Init Error:", err.message);
    updateStatus('error', 'Initialization failed: ' + err.message);
});


// API Endpoints
app.get('/api/replies', (req, res) => {
    res.json(automatedReplies);
});

app.post('/api/replies', (req, res) => {
    const newReplies = req.body;
    if (!newReplies || typeof newReplies !== 'object') {
        return res.status(400).send("Invalid format");
    }
    automatedReplies = newReplies;
    fs.writeFileSync(REPLIES_FILE, JSON.stringify(automatedReplies, null, 2));
    res.json({ success: true, replies: automatedReplies });
});

app.get('/api/agent-settings', (req, res) => {
    res.json(agentSettings);
});

app.post('/api/agent-settings', (req, res) => {
    agentSettings = req.body || {};
    fs.writeFileSync(AGENT_SETTINGS_FILE, JSON.stringify(agentSettings, null, 2));
    res.json({ success: true });
});

// Bot toggle API
app.get('/api/bot-status', (req, res) => {
    res.json({ enabled: isBotEnabled });
});

app.post('/api/bot-status', (req, res) => {
    isBotEnabled = !!req.body.enabled;
    fs.writeFileSync(BOT_STATE_FILE, JSON.stringify({ enabled: isBotEnabled }, null, 2));
    io.emit('bot_status_changed', { enabled: isBotEnabled });
    res.json({ success: true, enabled: isBotEnabled });
});

// ── CAMPAIGNS API ──────────────────────────────────────────
app.get('/api/campaigns', (req, res) => {
    res.json(campaignsData);
});

app.post('/api/campaigns', (req, res) => {
    const { name, keyword, color, source } = req.body;
    if (!name || !keyword) return res.status(400).json({ error: 'Name and keyword required' });
    const newCamp = {
        id: 'camp_' + Date.now(),
        name, keyword: keyword.toUpperCase(), color: color || '#6366f1',
        source: source || 'other', active: true, leads: 0,
        createdAt: new Date().toISOString()
    };
    campaignsData.push(newCamp);
    fs.writeFileSync(CAMPAIGNS_FILE, JSON.stringify(campaignsData, null, 2));
    res.json({ success: true, campaign: newCamp });
});

app.put('/api/campaigns/:id', (req, res) => {
    const camp = campaignsData.find(c => c.id === req.params.id);
    if (!camp) return res.status(404).json({ error: 'Not found' });
    Object.assign(camp, req.body);
    if (camp.keyword) camp.keyword = camp.keyword.toUpperCase();
    fs.writeFileSync(CAMPAIGNS_FILE, JSON.stringify(campaignsData, null, 2));
    res.json({ success: true, campaign: camp });
});

app.delete('/api/campaigns/:id', (req, res) => {
    campaignsData = campaignsData.filter(c => c.id !== req.params.id);
    fs.writeFileSync(CAMPAIGNS_FILE, JSON.stringify(campaignsData, null, 2));
    res.json({ success: true });
});

// Attribution stats: leads per campaign
app.get('/api/campaigns/stats', (req, res) => {
    const stats = campaignsData.map(c => ({
        id: c.id, name: c.name, color: c.color, source: c.source,
        leads: c.leads || 0
    }));
    // Also count from conversations
    const conversationsWithCampaign = Object.values(conversations).filter(c => c.campaign);
    const countMap = {};
    conversationsWithCampaign.forEach(c => {
        const cid = c.campaign.id;
        countMap[cid] = (countMap[cid] || 0) + 1;
    });
    stats.forEach(s => { s.leadsDetected = countMap[s.id] || 0; });
    res.json(stats);
});

// Manually assign campaign to a lead
app.post('/api/conversations/:chatId/campaign', (req, res) => {
    const { chatId } = req.params;
    const { campaignId } = req.body;
    if (!conversations[chatId]) return res.status(404).json({ error: 'Chat not found' });
    const camp = campaignsData.find(c => c.id === campaignId);
    if (camp) {
        conversations[chatId].campaign = {
            id: camp.id, name: camp.name, source: camp.source,
            color: camp.color, keyword: camp.keyword,
            detectedAt: new Date().toISOString(), manual: true
        };
    } else {
        conversations[chatId].campaign = null;
    }
    saveHistory();
    res.json({ success: true, campaign: conversations[chatId].campaign });
});


app.get('/api/appointments', (req, res) => {
    res.json(appointmentsData);
});

app.post('/api/appointments', (req, res) => {
    appointmentsData = req.body;
    fs.writeFileSync(APPOINTMENTS_FILE, JSON.stringify(appointmentsData, null, 2));
    res.json({ success: true, data: appointmentsData });
});

app.get('/api/knowledge', (req, res) => {
    res.json(knowledgeData);
});

app.post('/api/knowledge', (req, res) => {
    knowledgeData = req.body;
    fs.writeFileSync(KNOWLEDGE_FILE, JSON.stringify(knowledgeData, null, 2));
    res.json({ success: true, data: knowledgeData });
});

app.delete('/api/knowledge/:id', (req, res) => {
    const id = req.params.id;
    knowledgeData = knowledgeData.filter(k => k.id !== id);
    fs.writeFileSync(KNOWLEDGE_FILE, JSON.stringify(knowledgeData, null, 2));
    res.json({ success: true });
});

// Multer: upload to /uploads folder
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, Date.now() + '_' + file.originalname)
});
const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        const allowed = ['.pdf', '.txt', '.docx', '.doc'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) cb(null, true);
        else cb(new Error('Tipo de archivo no permitido. Use PDF, TXT o DOCX.'));
    },
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

app.post('/api/knowledge/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo.' });

    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    let extractedText = '';

    try {
        if (ext === '.pdf') {
            const buffer = fs.readFileSync(filePath);
            const data = await pdfParse(buffer);
            extractedText = data.text;
        } else if (ext === '.docx' || ext === '.doc') {
            const result = await mammoth.extractRawText({ path: filePath });
            extractedText = result.value;
        } else if (ext === '.txt') {
            extractedText = fs.readFileSync(filePath, 'utf8');
        }

        // Truncate to 8000 chars to keep manageable
        extractedText = extractedText.trim().substring(0, 8000);

        // Create KB entry
        const newEntry = {
            id: Date.now().toString(),
            category: req.body.category || 'documento',
            title: req.body.title || req.file.originalname.replace(ext, ''),
            description: extractedText,
            status: 'Sincronizado',
            active: true,
            fileName: req.file.originalname,
            uploadedAt: new Date().toISOString()
        };

        knowledgeData.push(newEntry);
        fs.writeFileSync(KNOWLEDGE_FILE, JSON.stringify(knowledgeData, null, 2));
        res.json({ success: true, entry: newEntry });
    } catch (err) {
        console.error('Error procesando archivo:', err);
        res.status(500).json({ error: 'Error al procesar el archivo: ' + err.message });
    }
});

// AI Search Test: simulate bot response to a test message
app.post('/api/knowledge/test-search', async (req, res) => {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'Falta el mensaje de prueba.' });

    try {
        const kbStr = knowledgeData.filter(k => k.active).map(k => `## ${k.title}\n${k.description}`).join('\n\n');
        const name = agentSettings['agentSettings_agent-name'] || 'Eryum';
        const business = agentSettings['agentSettings_business-name'] || 'Tu empresa';
        const personality = agentSettings['agentSettings_agent-personality'] || 'amable y profesional';
        const tone = agentSettings['agentSettings_agent-tone'] || 'amigable';

        const apiKey = process.env.GEMINI_API_KEY;

        if (apiKey) {
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

            const prompt = `Eres ${name} de ${business}. Personalidad: ${personality}. Tono: ${tone}. 
No reveles que eres una IA. Responde como humano experto por WhatsApp (corto, natural, útil, máx 3 líneas, 1 emoji adecuado).

Base de Conocimiento disponible:
${kbStr}

El lead te escribe: "${query}"
Tu respuesta:`;

            const result = await model.generateContent(prompt);
            const aiResponse = result.response.text();
            res.json({ response: aiResponse, source: 'gemini', docsUsed: knowledgeData.filter(k => k.active).length });
        } else {
            // Smart simulated response using KB
            const lq = query.toLowerCase();
            let botResp = '';

            // Search KB for matching content
            const matchedDocs = knowledgeData.filter(k => {
                if (!k.active) return false;
                const combined = (k.title + ' ' + k.description).toLowerCase();
                return lq.split(' ').some(word => word.length > 3 && combined.includes(word));
            });

            if (matchedDocs.length > 0) {
                const doc = matchedDocs[0];
                const snippet = doc.description.substring(0, 200);
                botResp = `Claro, te explico sobre ${doc.title}: ${snippet}... ¿Tienes alguna otra duda? 😊`;
            } else if (lq.includes('precio') || lq.includes('costo') || lq.includes('cuánto')) {
                botResp = `Tenemos planes desde $99/mes. ¿Me cuentas cuántos clientes manejas aprox? Así te doy el plan ideal 🚀`;
            } else if (lq.includes('hola') || lq.includes('buenos')) {
                botResp = `¡Hola! 👋 Soy ${name} de ${business}. ¿En qué puedo ayudarte hoy?`;
            } else {
                botResp = `Entiendo tu consulta sobre "${query}". Basándome en mi conocimiento, te puedo orientar mejor si me das más detalles. ¿En qué aspecto específicamente necesitas ayuda? 🤔`;
            }

            res.json({ response: botResp, source: 'simulated', docsUsed: matchedDocs.length });
        }
    } catch (err) {
        console.error('Error en test-search:', err);
        res.status(500).json({ error: 'Error al generar respuesta: ' + err.message });
    }
});

// Chat APIs
app.get('/api/chats', (req, res) => {
    // Return summary list of chats sorted by recent activity
    const chatList = Object.values(conversations).map(c => ({
        id: c.id,
        name: c.name,
        lastMessage: c.lastMessage,
        timestamp: c.timestamp,
        formattedTime: new Date(c.timestamp * 1000).toLocaleString()
    })).sort((a, b) => b.timestamp - a.timestamp);
    res.json(chatList);
});

app.get('/api/chats/:id', async (req, res) => {
    const chatId = req.params.id;
    if (conversations[chatId]) {
        // Lazy-load messages if we haven't fetched them yet
        if (conversations[chatId].messages.length === 0) {
            try {
                const waChat = await client.getChatById(chatId);
                const messages = await waChat.fetchMessages({ limit: 30 });
                for (const m of messages) {
                    const msgData = {
                        id: m.id._serialized,
                        body: m.body || (m.hasMedia ? "📷 Archivo" : ""),
                        fromMe: m.fromMe,
                        timestamp: m.timestamp,
                        type: m.type,
                        formattedTime: new Date(m.timestamp * 1000).toLocaleTimeString()
                    };
                    const isDuplicate = conversations[chatId].messages.some(existing => existing.id === msgData.id);
                    if (!isDuplicate) {
                        conversations[chatId].messages.push(msgData);
                    }
                }
                conversations[chatId].synced = true;
                saveHistory(); // Optional but nice caching
            } catch (e) {
                console.error("Could not lazy-load messages:", e.message);
            }
        }
        res.json(conversations[chatId]);
    } else {
        res.status(404).json({ error: "Chat not found" });
    }
});

app.post('/api/send-message', async (req, res) => {
    const { chatId, message } = req.body;
    if (!chatId || !message) return res.status(400).json({ error: "Missing chatId or message" });

    try {
        await client.sendMessage(chatId, message);
        res.json({ success: true });
    } catch (err) {
        console.error("Send error:", err);
        res.status(500).json({ error: "Failed to send message" });
    }
});

app.post('/api/send-template', async (req, res) => {
    const { chatIds, templateText } = req.body;
    if (!chatIds || !Array.isArray(chatIds) || !templateText) {
        return res.status(400).json({ error: "Missing chatIds or templateText" });
    }

    let successCount = 0;
    try {
        for (const cid of chatIds) {
            await client.sendMessage(cid, templateText);
            successCount++;
        }
        res.json({ success: true, count: successCount });
    } catch (err) {
        console.error("Template send error:", err);
        res.status(500).json({ error: "Failed to send templates to some or all contacts", details: err.message });
    }
});



// Socket.io Connection
io.on('connection', (socket) => {
    console.log('Frontend connected');
    // Send current state
    if (clientStatus === 'qr_ready' && qrCodeData) {
        socket.emit('status_update', { status: 'qr_ready', logic: qrCodeData });
    } else {
        socket.emit('status_update', { status: clientStatus });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
