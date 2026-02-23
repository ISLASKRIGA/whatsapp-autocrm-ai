const socket = io();

// UI Elements
const statusText = document.getElementById('status-text');
const statusDot = document.querySelector('.status-dot');
const statusIndicator = document.getElementById('status-indicator');
const retryBtn = document.querySelector('.retry-btn');
const qrImage = document.getElementById('qr-image');
const qrPanel = document.getElementById('connection-panel');
const chatList = document.getElementById('chat-list');
const messagesContainer = document.getElementById('messages-container');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const currentChatName = document.getElementById('current-chat-name');
const repliesList = document.getElementById('replies-list');
const logsContainer = document.getElementById('logs-container');
const liveFeedView = document.getElementById('live-feed-view');
const chatView = document.getElementById('chat-view');
const chatCountBadge = document.getElementById('chat-count');
const clientesView = document.getElementById('clientes-view');
const chatSidebar = document.getElementById('chat-sidebar');

// State
let conversations = {}; // { chatId: { messages: [], ... } }
let currentChatId = null;
let automatedReplies = {};
let globalBotEnabled = true;

// --- SOCKET EVENTS ---

socket.on('status_update', (data) => {
    console.log('Status:', data);
    updateConnectionStatus(data.status, data.logic);
});

socket.on('chat_update', (data) => {
    // data: { chatId, message, chatName, timestamp }
    handleIncomingMessage(data);
});

socket.on('chats_synced', () => {
    console.log('Chats synced from phone. Reloading sidebar.');
    loadChats();
});

socket.on('bot_status_changed', (data) => {
    globalBotEnabled = data.enabled;
    const toggle = document.getElementById('global-bot-toggle');
    if (toggle) toggle.checked = globalBotEnabled;
});


// --- INITIALIZATION ---

async function init() {
    await loadReplies();
    await loadChats();

    // Fetch initial bot status
    try {
        const res = await fetch('/api/bot-status');
        const data = await res.json();
        globalBotEnabled = data.enabled;
        const toggle = document.getElementById('global-bot-toggle');
        if (toggle) toggle.checked = globalBotEnabled;
    } catch (e) { console.error('Error fetching bot status', e); }

    // Default show dashboard
    showSection('dashboard');
}

// --- CORE LOGIC ---

async function loadChats() {
    try {
        const response = await axios.get('/api/chats');
        chatList.innerHTML = '';

        // Reverse array because renderChatItem uses prepend()
        // We want the newest items (index 0) to be prepended LAST, ending up at the true top
        const d = response.data;
        d.reverse().forEach(chat => {
            renderChatItem(chat);
            if (!conversations[chat.id]) {
                conversations[chat.id] = { ...chat, messages: [] };
            }
        });
        if (chatCountBadge) chatCountBadge.textContent = d.length;
    } catch (err) {
        console.error("Error loading chats", err);
        chatList.innerHTML = '<div class="loading">Error cargando chats</div>';
    }
}

async function loadChatMessages(chatId) {
    try {
        const response = await axios.get(`/api/chats/${chatId}`);
        const chatData = response.data;
        conversations[chatId] = chatData;
        renderMessages(chatId);
    } catch (err) {
        console.error("Error loading messages", err);
    }
}

function handleIncomingMessage(data) {
    const { chatId, message, chatName, timestamp } = data;

    // Update state
    if (!conversations[chatId]) {
        conversations[chatId] = { id: chatId, name: chatName, messages: [] };
    }

    conversations[chatId].messages.push(message);
    conversations[chatId].lastMessage = message.body;
    conversations[chatId].timestamp = timestamp;
    conversations[chatId].formattedTime = message.formattedTime;

    // Update UI by re-rendering the chat item (which also moves it to the top)
    renderChatItem(conversations[chatId]);

    if (currentChatId === chatId) {
        appendMessage(message);
        scrollToBottom();
    }

    // Live update the Clientes CRM table if it's currently open
    if (!document.getElementById('clientes-view').classList.contains('hidden')) {
        renderClientsList();
    }
}

// Enable 'Enter' key to send message
messageInput.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

// Agente IA Tabs Navigation
function switchAgentTab(tabId) {
    // Hide all tab panes
    document.querySelectorAll('.agent-tab-pane').forEach(pane => {
        pane.classList.add('hidden');
        pane.style.display = 'none';
    });

    // Remove active class from all tabs
    document.querySelectorAll('.agent-tab').forEach(tab => {
        tab.classList.remove('active');
    });

    // Show the selected tab pane
    const targetPane = document.getElementById(`agent-tab-${tabId}`);
    if (targetPane) {
        targetPane.classList.remove('hidden');
        targetPane.style.display = 'flex';
    }

    // Set clicked tab to active
    const clickedTab = Array.from(document.querySelectorAll('.agent-tab'))
        .find(t => t.textContent.toLowerCase().includes(tabId) ||
            (tabId === 'config' && t.textContent.includes('Configuración')) ||
            (tabId === 'captura' && t.textContent.includes('Captura')));
    if (clickedTab) {
        clickedTab.classList.add('active');
    }
}

// --- AGENT ACTIONS ---
const AGENT_CONFIG_IDS = [
    'agent-name', 'agent-role', 'agent-personality',
    'agent-language', 'agent-tone', 'business-name',
    'business-desc', 'business-products', 'msg-welcome',
    'msg-fallback', 'msg-human'
];

function loadAgentConfig() {
    AGENT_CONFIG_IDS.forEach(id => {
        const el = document.getElementById(id);
        const storedVal = localStorage.getItem('agentSettings_' + id);
        if (el && storedVal !== null) {
            el.value = storedVal;
        }
    });

    // Checkbox special handling
    const autoRepliesToggle = document.getElementById('auto-replies-toggle');
    if (autoRepliesToggle !== null) {
        const storedToggle = localStorage.getItem('agentSettings_auto-replies');
        if (storedToggle !== null) {
            autoRepliesToggle.checked = storedToggle === 'true';
        }
    }
}

function saveAgentConfig() {
    const btn = document.getElementById('btn-save-agent');
    const btnText = document.getElementById('btn-save-agent-text');
    const originalText = btnText.innerText;

    // Simulate loading state
    btn.style.opacity = '0.7';
    btn.style.pointerEvents = 'none';
    btnText.innerText = 'Guardando...';

    // Save to localStorage and gather payload
    let payload = {};
    AGENT_CONFIG_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            localStorage.setItem('agentSettings_' + id, el.value);
            payload['agentSettings_' + id] = el.value;
        }
    });

    // Checkbox special handling
    const autoRepliesToggle = document.getElementById('auto-replies-toggle');
    if (autoRepliesToggle !== null) {
        localStorage.setItem('agentSettings_auto-replies', autoRepliesToggle.checked);
        payload['agentSettings_auto-replies'] = autoRepliesToggle.checked.toString();
    }

    // Send to backend
    axios.post('/api/agent-settings', payload).then(() => {
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
        btnText.innerText = 'Guardado!';
        setTimeout(() => {
            btnText.innerText = originalText;
        }, 2000);
    }).catch(err => {
        console.error("Error saving agent config", err);
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
        btnText.innerText = 'Error al guardar';
        setTimeout(() => {
            btnText.innerText = originalText;
        }, 2000);
    });
}

function discardAgentConfig() {
    if (confirm('¿Estás seguro de que deseas descartar todos los cambios no guardados?')) {
        location.reload();
    }
}

async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !currentChatId) return;

    messageInput.value = '';

    // UI Optimistic update (optional, but waiting for server confirmation is safer)
    // We rely on 'message_create' event from server to echo it back

    try {
        await axios.post('/api/send-message', {
            chatId: currentChatId,
            message: text
        });
        // Success
    } catch (err) {
        alert("Error enviando mensaje");
        console.error(err);
    }
}

async function toggleGlobalBot(checkbox) {
    const isEnabled = checkbox.checked;
    try {
        await axios.post('/api/bot-status', { enabled: isEnabled });
        globalBotEnabled = isEnabled;
    } catch (e) {
        console.error("Error toggling bot", e);
        // revert UI on error
        checkbox.checked = !isEnabled;
    }
}


// --- UI RENDERING ---

function updateConnectionStatus(status, logic) {
    statusDot.className = 'status-dot'; // reset
    retryBtn.style.display = 'none';

    // New WhatsApp section elements
    const waQrImage = document.getElementById('wa-qr-image');
    const waQrSpinner = document.getElementById('wa-qr-spinner');
    const waStatus = document.getElementById('wa-status-text');
    const waConnected = document.getElementById('wa-connected-box');
    const waQrBox = document.getElementById('wa-qr-box');
    const waBtnScanning = document.getElementById('wa-btn-scanning');
    const waBtnDisconnect = document.getElementById('wa-btn-disconnect');
    const waBtnReconnect = document.getElementById('wa-btn-reconnect');

    // Helper
    const showBtn = (el, show) => { if (el) el.style.display = show ? (el.tagName === 'BUTTON' ? 'inline-block' : 'flex') : 'none'; };

    switch (status) {
        case 'disconnected':
            statusDot.classList.add('disconnected');
            statusText.textContent = 'Desconectado';
            qrPanel.style.display = 'flex';
            retryBtn.style.display = 'inline-block';
            if (waStatus) waStatus.textContent = 'Sesión cerrada. Reconecta para vincular de nuevo.';
            if (waConnected) waConnected.style.display = 'none';
            if (waQrBox) waQrBox.style.display = 'flex';
            if (waQrSpinner) waQrSpinner.style.display = 'block';
            if (waQrImage) { waQrImage.style.display = 'none'; waQrImage.src = ''; }
            showBtn(waBtnScanning, false);
            showBtn(waBtnDisconnect, false);
            showBtn(waBtnReconnect, true);
            break;
        case 'qr_ready':
            statusDot.classList.add('waiting');
            statusText.textContent = 'Esperando Escaneo';
            qrPanel.style.display = 'flex';
            if (logic) {
                qrImage.src = logic;
                qrImage.style.display = 'block';
                if (waQrImage) { waQrImage.src = logic; waQrImage.style.display = 'block'; }
                if (waQrSpinner) waQrSpinner.style.display = 'none';
                if (waStatus) waStatus.textContent = 'Escanea el código QR con tu teléfono';
                if (waConnected) waConnected.style.display = 'none';
                if (waQrBox) waQrBox.style.display = 'flex';
            }
            showBtn(waBtnScanning, true);
            showBtn(waBtnDisconnect, false);
            showBtn(waBtnReconnect, false);
            break;
        case 'connecting':
            statusDot.classList.add('connecting');
            statusText.textContent = 'Conectando...';
            qrPanel.style.display = 'flex';
            if (waStatus) waStatus.textContent = 'Conectando...';
            showBtn(waBtnScanning, false);
            showBtn(waBtnDisconnect, false);
            showBtn(waBtnReconnect, false);
            break;
        case 'ready':
            statusDot.classList.add('connected');
            statusText.textContent = 'Conectado';
            qrPanel.style.display = 'none';
            if (waStatus) waStatus.textContent = '¡Número conectado y activo!';
            if (waQrBox) waQrBox.style.display = 'none';
            if (waConnected) waConnected.style.display = 'flex';
            showBtn(waBtnScanning, false);
            showBtn(waBtnDisconnect, true);
            showBtn(waBtnReconnect, false);
            break;
        default: // error
            statusDot.classList.add('disconnected');
            statusText.textContent = 'Error: ' + logic;
            if (logic && logic.includes('generate')) qrPanel.style.display = 'flex';
            if (waStatus) waStatus.textContent = 'Error de conexión';
            showBtn(waBtnScanning, false);
            showBtn(waBtnDisconnect, false);
            showBtn(waBtnReconnect, true);
            break;
    }
}

async function disconnectWhatsApp() {
    const btn = document.getElementById('wa-btn-disconnect');
    if (btn) { btn.disabled = true; btn.textContent = 'Desconectando...'; }
    try {
        await axios.post('/api/disconnect');
        // UI will update via socket event
    } catch (e) {
        console.error('Error disconnecting', e);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🔌 Desconectar WhatsApp'; }
    }
}

async function reconnectWhatsApp() {
    const btn = document.getElementById('wa-btn-reconnect');
    if (btn) { btn.disabled = true; btn.textContent = 'Reconectando...'; }
    const waStatus = document.getElementById('wa-status-text');
    if (waStatus) waStatus.textContent = 'Iniciando conexión...';
    try {
        await axios.post('/api/reconnect');
        // UI will update via socket events (qr_ready → ready)
    } catch (e) {
        console.error('Error reconnecting', e);
        if (waStatus) waStatus.textContent = 'Error al reconectar. Intenta de nuevo.';
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🔄 Reconectar WhatsApp'; }
    }
}



function renderChatItem(chat) {
    // Check if exists to update or append
    let el = document.querySelector(`.chat-item[data-id="${chat.id}"]`);
    if (!el) {
        el = document.createElement('div');
        el.className = 'chat-item';
        el.dataset.id = chat.id;
        el.onclick = () => selectChat(chat.id);
        chatList.prepend(el); // Newest top
    } else {
        // Move to top if updated
        chatList.prepend(el);
    }

    let nameStr = chat.name || chat.id || '?';
    let initial = nameStr.charAt(0).toUpperCase();
    if (!initial.match(/[A-Z0-9]/)) initial = 'W'; // default

    // Hash string to pick a color background 1-5
    let hash = 0;
    for (let i = 0; i < nameStr.length; i++) { hash = nameStr.charCodeAt(i) + ((hash << 5) - hash); }
    let colorIndex = Math.abs(hash % 5) + 1;

    let preTag = "";
    if (chat.messages && chat.messages.length > 0) {
        let lastObj = chat.messages[chat.messages.length - 1];
        if (lastObj && lastObj.fromMe) {
            preTag = `<span class="preview-tag ia">🤖 IA</span> Tu: `;
        }
    }

    el.innerHTML = `
        <div class="user-avatar bg-color-${colorIndex}" data-initial="${initial}" data-color="${colorIndex}">${initial}</div>
        <div class="chat-item-content">
            <div class="chat-item-header">
                <span class="chat-item-name">${nameStr}</span>
                <span class="chat-item-time">${chat.formattedTime || ''}</span>
            </div>
            <div class="chat-item-preview">${preTag}${chat.lastMessage || '...'}</div>
        </div>
    `;
}

function updateChatListPreview(chatId, lastMsg) {
    const el = document.querySelector(`.chat-item[data-id="${chatId}"] p`);
    if (el) el.textContent = lastMsg;
}

function selectChat(chatId) {
    currentChatId = chatId;
    currentChatName.textContent = conversations[chatId].name;

    const headerAvatar = document.getElementById('chat-header-avatar');
    // Mirror the avatar logic from the selected chat item
    let nameStr = conversations[chatId].name || '?';
    let initial = nameStr.charAt(0).toUpperCase();
    if (!initial.match(/[A-Z0-9]/)) initial = 'W';
    let hash = 0;
    for (let i = 0; i < nameStr.length; i++) { hash = nameStr.charCodeAt(i) + ((hash << 5) - hash); }
    let colorIndex = Math.abs(hash % 5) + 1;

    if (headerAvatar) {
        headerAvatar.className = 'user-avatar bg-color-' + colorIndex;
        headerAvatar.textContent = initial;
    }

    // Highlight
    document.querySelectorAll('.chat-item').forEach(i => i.classList.remove('active'));
    document.querySelector(`.chat-item[data-id="${chatId}"]`)?.classList.add('active');

    // Enable input
    messageInput.disabled = false;
    sendBtn.disabled = false;

    // Populate Right Sidebar info if present
    const clientNameEl = document.getElementById('client-info-name');
    const clientPhoneEl = document.getElementById('client-info-phone');
    if (clientNameEl) clientNameEl.textContent = nameStr;
    if (clientPhoneEl) {
        // Fallback for phone (just parse digits if name doesn't have it, or use ID)
        let phoneStr = chatId.split('@')[0];
        clientPhoneEl.textContent = phoneStr || 'Desconocido';
    }

    showSection('dashboard');

    if (conversations[chatId].messages.length === 0) {
        messagesContainer.innerHTML = '<div class="loading">Cargando historial...</div>';
        loadChatMessages(chatId);
    } else {
        renderMessages(chatId);
    }
}

function renderMessages(chatId) {
    messagesContainer.innerHTML = '';
    const messages = conversations[chatId].messages;

    if (messages.length === 0) {
        messagesContainer.innerHTML = '<div class="empty-icon-box" style="margin: 40px auto; border-radius:50%; width: 40px; height: 40px;"><svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></div><div style="text-align:center; color: var(--text-muted); font-size: 0.9rem;">No hay historial cargado.</div>';
        return;
    }

    messages.forEach(msg => appendMessage(msg));
    scrollToBottom();
}

function appendMessage(msg) {
    const div = document.createElement('div');
    const isMe = msg.fromMe; // backend should send this boolean
    div.className = `message-bubble ${isMe ? 'msg-outgoing' : 'msg-incoming'}`;

    div.innerHTML = `
        <div class="msg-text">${msg.body}</div>
        <span class="msg-time">${msg.formattedTime || ''}</span>
    `;
    messagesContainer.appendChild(div);
}

function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function toggleClientInfo() {
    const panel = document.getElementById('client-info-panel');
    if (panel) {
        panel.classList.toggle('hidden');
        panel.classList.toggle('visible');
    }
}

// --- NAVIGATION ---

function backToChatList() {
    currentChatId = null;
    document.querySelectorAll('.chat-item').forEach(i => i.classList.remove('active'));
    showSection('dashboard');
}

function showSection(id) {
    document.querySelectorAll('.nav-btn, .menu-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`[onclick="showSection('${id}')"]`)?.classList.add('active');

    const agendaView = document.getElementById('agenda-view');
    const conocimientoView = document.getElementById('conocimiento-view');
    const reportesView = document.getElementById('reportes-view');
    const plantillasView = document.getElementById('plantillas-view');
    const funnelView = document.getElementById('funnel-view');
    const waSectionEl = document.getElementById('section-whatsapp');
    if (waSectionEl && id !== 'whatsapp') waSectionEl.style.display = 'none';

    if (id === 'dashboard') {
        chatSidebar.classList.remove('hidden');
        clientesView.classList.add('hidden');
        document.getElementById('replies-view').classList.add('hidden');
        if (agendaView) agendaView.classList.add('hidden');
        if (conocimientoView) conocimientoView.classList.add('hidden');
        if (reportesView) reportesView.classList.add('hidden');
        if (plantillasView) plantillasView.classList.add('hidden');
        if (funnelView) funnelView.classList.add('hidden');

        if (currentChatId) {
            chatView.classList.remove('hidden');
            liveFeedView.classList.add('hidden');
        } else {
            chatView.classList.add('hidden');
            liveFeedView.classList.remove('hidden');
        }
    } else if (id === 'clientes') {
        chatSidebar.classList.add('hidden');
        chatView.classList.add('hidden');
        liveFeedView.classList.add('hidden');
        document.getElementById('replies-view').classList.add('hidden');
        if (agendaView) agendaView.classList.add('hidden');
        if (conocimientoView) conocimientoView.classList.add('hidden');
        if (reportesView) reportesView.classList.add('hidden');
        if (plantillasView) plantillasView.classList.add('hidden');
        if (funnelView) funnelView.classList.add('hidden');
        clientesView.classList.remove('hidden');
        renderClientsList();
    } else if (id === 'replies') {
        chatSidebar.classList.add('hidden');
        chatView.classList.add('hidden');
        liveFeedView.classList.add('hidden');
        clientesView.classList.add('hidden');
        if (conocimientoView) conocimientoView.classList.add('hidden');
        if (agendaView) agendaView.classList.add('hidden');
        if (reportesView) reportesView.classList.add('hidden');
        if (plantillasView) plantillasView.classList.add('hidden');
        if (funnelView) funnelView.classList.add('hidden');
        document.getElementById('replies-view').classList.remove('hidden');
    } else if (id === 'agenda') {
        chatSidebar.classList.add('hidden');
        chatView.classList.add('hidden');
        liveFeedView.classList.add('hidden');
        clientesView.classList.add('hidden');
        if (conocimientoView) conocimientoView.classList.add('hidden');
        if (reportesView) reportesView.classList.add('hidden');
        if (plantillasView) plantillasView.classList.add('hidden');
        if (funnelView) funnelView.classList.add('hidden');
        document.getElementById('replies-view').classList.add('hidden');
        if (agendaView) agendaView.classList.remove('hidden');
        renderAgendaList();
    } else if (id === 'conocimiento') {
        chatSidebar.classList.add('hidden');
        chatView.classList.add('hidden');
        liveFeedView.classList.add('hidden');
        clientesView.classList.add('hidden');
        document.getElementById('replies-view').classList.add('hidden');
        if (agendaView) agendaView.classList.add('hidden');
        if (reportesView) reportesView.classList.add('hidden');
        if (plantillasView) plantillasView.classList.add('hidden');
        if (funnelView) funnelView.classList.add('hidden');
        if (conocimientoView) conocimientoView.classList.remove('hidden');
        renderKnowledgeList();
    } else if (id === 'reportes') {
        chatSidebar.classList.add('hidden');
        chatView.classList.add('hidden');
        liveFeedView.classList.add('hidden');
        clientesView.classList.add('hidden');
        document.getElementById('replies-view').classList.add('hidden');
        if (agendaView) agendaView.classList.add('hidden');
        if (conocimientoView) conocimientoView.classList.add('hidden');
        if (plantillasView) plantillasView.classList.add('hidden');
        if (reportesView) reportesView.classList.remove('hidden');
        if (funnelView) funnelView.classList.add('hidden');
        renderReportesList();
        loadCampaigns(); // Load campaigns when reportes view opens
    } else if (id === 'plantillas') {
        chatSidebar.classList.add('hidden');
        chatView.classList.add('hidden');
        liveFeedView.classList.add('hidden');
        clientesView.classList.add('hidden');
        document.getElementById('replies-view').classList.add('hidden');
        if (agendaView) agendaView.classList.add('hidden');
        if (conocimientoView) conocimientoView.classList.add('hidden');
        if (reportesView) reportesView.classList.add('hidden');
        if (plantillasView) plantillasView.classList.remove('hidden');
        if (funnelView) funnelView.classList.add('hidden');
        renderPlantillasList();
    } else if (id === 'funnel') {
        chatSidebar.classList.add('hidden');
        chatView.classList.add('hidden');
        liveFeedView.classList.add('hidden');
        clientesView.classList.add('hidden');
        document.getElementById('replies-view').classList.add('hidden');
        if (agendaView) agendaView.classList.add('hidden');
        if (conocimientoView) conocimientoView.classList.add('hidden');
        if (reportesView) reportesView.classList.add('hidden');
        if (plantillasView) plantillasView.classList.add('hidden');
        if (funnelView) funnelView.classList.remove('hidden');
        renderFunnelList();
    } else if (id === 'whatsapp') {
        chatSidebar.classList.add('hidden');
        chatView.classList.add('hidden');
        liveFeedView.classList.add('hidden');
        clientesView.classList.add('hidden');
        document.getElementById('replies-view').classList.add('hidden');
        if (agendaView) agendaView.classList.add('hidden');
        if (conocimientoView) conocimientoView.classList.add('hidden');
        if (reportesView) reportesView.classList.add('hidden');
        if (plantillasView) plantillasView.classList.add('hidden');
        if (funnelView) funnelView.classList.add('hidden');
        const waSection = document.getElementById('section-whatsapp');
        if (waSection) { waSection.style.display = 'flex'; }
    }
}

// ════════════════════════════════════════════════
//  CAMPAIGN ATTRIBUTION
// ════════════════════════════════════════════════
let campaignsList = [];

function loadCampaigns() {
    fetch('/api/campaigns')
        .then(r => r.json())
        .then(data => {
            campaignsList = data;
            renderCampaignsStatsGrid();
            renderCampaignsTable();
        })
        .catch(err => console.error('Error loading campaigns:', err));
}

const SOURCE_ICONS = {
    facebook: '💙',
    instagram: '📷',
    google: '🔍',
    tiktok: '🎵',
    email: '📧',
    organic: '🌿',
    other: '📌'
};

function renderCampaignsStatsGrid() {
    const grid = document.getElementById('campaigns-stats-grid');
    if (!grid) return;
    if (!campaignsList.length) {
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; color:#94a3b8; padding:24px;">Aún no tienes campañas. Crea la primera ↑</div>';
        return;
    }
    grid.innerHTML = campaignsList.map(c => `
        <div class="campaign-stat-card" style="--camp-color:${c.color}; border-left:4px solid ${c.color};">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                <span style="font-size:1.2rem;">${SOURCE_ICONS[c.source] || '📌'}</span>
                <span style="font-weight:700; font-size:0.9rem; color:#0f172a; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${c.name}</span>
            </div>
            <div style="font-size:2rem; font-weight:800; color:${c.color}; line-height:1;">${c.leads || 0}</div>
            <div style="font-size:0.78rem; color:#94a3b8; margin-top:2px;">leads detectados</div>
            <div style="margin-top:8px; font-size:0.75rem; background:#f1f5f9; color:#475569; padding:3px 8px; border-radius:6px; font-family:monospace; display:inline-block;">${c.keyword}</div>
        </div>
    `).join('');
}

function renderCampaignsTable() {
    const tbody = document.getElementById('campaigns-table-body');
    if (!tbody) return;
    if (!campaignsList.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:24px; color:#94a3b8;">Sin campañas aún. Crea la primera con "Nueva Campaña".</td></tr>';
        return;
    }
    tbody.innerHTML = campaignsList.map(c => `
        <tr style="border-bottom:1px solid #f1f5f9; transition:background 0.15s;" onmouseover="this.style.background='#fafafa'" onmouseout="this.style.background=''">
            <td style="padding:12px;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <div style="width:10px; height:10px; border-radius:50%; background:${c.color}; flex-shrink:0;"></div>
                    <span style="font-weight:600; color:#0f172a;">${c.name}</span>
                    ${c.createdAt ? `<span style="font-size:0.72rem;color:#94a3b8;">${new Date(c.createdAt).toLocaleDateString('es')}</span>` : ''}
                </div>
            </td>
            <td style="padding:12px;">
                <code style="font-size:0.82rem; background:#f1f5f9; color:#6366f1; padding:3px 10px; border-radius:6px; font-weight:700;">${c.keyword}</code>
            </td>
            <td style="padding:12px;">
                <span style="font-size:0.85rem; color:#64748b;">${SOURCE_ICONS[c.source] || '📌'} ${c.source}</span>
            </td>
            <td style="padding:12px; text-align:center;">
                <span style="font-size:1.1rem; font-weight:700; color:${c.color};">${c.leads || 0}</span>
            </td>
            <td style="padding:12px; text-align:center;">
                <div onclick="toggleCampaignActive('${c.id}', ${!c.active})"
                    style="width:36px; height:20px; background:${c.active ? '#10b981' : '#cbd5e1'}; border-radius:10px; position:relative; cursor:pointer; display:inline-block; transition:background 0.2s;">
                    <div style="width:16px; height:16px; background:white; border-radius:50%; position:absolute; top:2px; ${c.active ? 'right:2px' : 'left:2px'}; transition:all 0.2s; box-shadow:0 1px 2px rgba(0,0,0,0.15);"></div>
                </div>
            </td>
            <td style="padding:12px;">
                <div style="display:flex; gap:6px; justify-content:flex-end;">
                    <button onclick="editCampaign('${c.id}')" style="background:#eff6ff; border:none; color:#2563eb; cursor:pointer; padding:5px 10px; border-radius:6px; font-size:0.75rem; font-weight:600;">✏️</button>
                    <button onclick="deleteCampaign('${c.id}')" style="background:#fef2f2; border:none; color:#ef4444; cursor:pointer; padding:5px 10px; border-radius:6px; font-size:0.75rem; font-weight:600;">🗑️</button>
                </div>
            </td>
        </tr>
    `).join('');
}

function openCampaignModal(campId = null) {
    document.getElementById('campaign-edit-id').value = campId || '';
    document.getElementById('campaign-modal-title').textContent = campId ? 'Editar Campaña' : 'Nueva Campaña';

    if (campId) {
        const c = campaignsList.find(x => x.id === campId);
        if (c) {
            document.getElementById('campaign-name').value = c.name;
            document.getElementById('campaign-keyword').value = c.keyword;
            document.getElementById('campaign-source').value = c.source;
            document.getElementById('campaign-color').value = c.color;
            updateCampaignExample(c.keyword);
        }
    } else {
        document.getElementById('campaign-name').value = '';
        document.getElementById('campaign-keyword').value = '';
        document.getElementById('campaign-source').value = 'facebook';
        document.getElementById('campaign-color').value = '#6366f1';
        updateCampaignExample('KEYWORD');
    }
    document.getElementById('campaign-modal').style.display = 'flex';

    // Live preview
    document.getElementById('campaign-keyword').oninput = function () {
        updateCampaignExample(this.value || 'KEYWORD');
    };
}

function updateCampaignExample(kw) {
    const ex = document.getElementById('campaign-example');
    if (ex) ex.textContent = `Hola, vengo de [${kw || 'KEYWORD'}] 👋`;
}

function closeCampaignModal() {
    document.getElementById('campaign-modal').style.display = 'none';
}

async function saveCampaign() {
    const id = document.getElementById('campaign-edit-id').value;
    const name = document.getElementById('campaign-name').value.trim();
    const keyword = document.getElementById('campaign-keyword').value.trim().toUpperCase();
    const source = document.getElementById('campaign-source').value;
    const color = document.getElementById('campaign-color').value;

    if (!name || !keyword) { alert('El nombre y la keyword son requeridos.'); return; }

    try {
        let resp;
        if (id) {
            resp = await fetch(`/api/campaigns/${id}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, keyword, source, color })
            });
        } else {
            resp = await fetch('/api/campaigns', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, keyword, source, color })
            });
        }
        if (resp.ok) {
            closeCampaignModal();
            await loadCampaigns();
            showFunnelToast(`✅ Campaña "${name}" guardada`);
        }
    } catch (err) { alert('Error guardando campaña: ' + err.message); }
}

function editCampaign(id) { openCampaignModal(id); }

async function deleteCampaign(id) {
    const c = campaignsList.find(x => x.id === id);
    if (!c || !confirm(`¿Eliminar la campaña "${c.name}"?`)) return;
    await fetch(`/api/campaigns/${id}`, { method: 'DELETE' });
    await loadCampaigns();
    showFunnelToast(`🗑️ Campaña eliminada`);
}

async function toggleCampaignActive(id, active) {
    await fetch(`/api/campaigns/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active })
    });
    await loadCampaigns();
}

// Socket.io: listen for real-time campaign attribution
if (typeof socket !== 'undefined') {
    socket.on('campaign_attributed', ({ chatId, campaign }) => {
        console.log(`[Attribution] Lead ${chatId} atribuido a: ${campaign.name}`);
        showFunnelToast(`📡 Lead atribuido: ${campaign.name}`);
        loadCampaigns(); // Refresh stats
    });
}


function renderClientsList() {
    const tbody = document.getElementById('crm-table-body');
    const totalBadge = document.getElementById('crm-total-badge');
    const totalStat = document.getElementById('stat-total');
    const resultsCount = document.getElementById('crm-results-count');

    if (!tbody) return;
    tbody.innerHTML = '';

    const chatsArray = Object.values(conversations).sort((a, b) => b.timestamp - a.timestamp);

    if (totalBadge) totalBadge.textContent = `${chatsArray.length} contactos`;
    if (totalStat) totalStat.textContent = chatsArray.length;
    if (resultsCount) resultsCount.textContent = `${chatsArray.length} resultados`;

    chatsArray.forEach((chat, index) => {
        let nameStr = chat.name || chat.id || '?';
        let initial = nameStr.charAt(0).toUpperCase();
        if (!initial.match(/[A-Z0-9]/)) initial = 'W';
        let hash = 0;
        for (let i = 0; i < nameStr.length; i++) { hash = nameStr.charCodeAt(i) + ((hash << 5) - hash); }
        let colorIndex = Math.abs(hash % 5) + 1;

        // Auto determine pseudo-status for demo
        let statuses = ['Nuevo', 'Interesado', 'En Proceso'];
        let statusIdx = (chat.timestamp || index) % 3;
        let status = statuses[statusIdx];

        let bgStatus = status === 'Nuevo' ? '#f3f4f6' : (status === 'Interesado' ? '#fef3c7' : '#e0e7ff');
        let colStatus = status === 'Nuevo' ? '#6b7280' : (status === 'Interesado' ? '#b45309' : '#4338ca');

        let leadScore = ((chat.timestamp || index) % 100);
        let phoneNumber = chat.id.split('@')[0];

        let isBotActive = (index % 4) !== 0;

        let tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <div style="display:flex; align-items:center; gap:12px;">
                    <div class="user-avatar bg-color-${colorIndex}" style="width:36px; height:36px; font-size:0.85rem;">${initial}</div>
                    <div style="display:flex; flex-direction:column;">
                        <span style="font-weight:600; color:var(--text-primary); font-size:0.9rem;">${nameStr}</span>
                        <span style="color:var(--text-muted); font-size:0.75rem;">${phoneNumber}</span>
                    </div>
                </div>
            </td>
            <td>
                <div style="display:flex; flex-direction:column; gap:6px; font-size:0.8rem; color:var(--text-secondary);">
                    <div style="display:flex; gap:6px; align-items:center;">
                        <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg> -
                    </div>
                    <div style="display:flex; gap:6px; align-items:center;">
                        <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg> ${phoneNumber}
                    </div>
                </div>
            </td>
            <td>
                <span style="padding:4px 12px; border-radius:12px; font-size:0.75rem; font-weight:600; background:${bgStatus}; color:${colStatus};">${status}</span>
            </td>
            <td>
                <div style="display:flex; align-items:center; gap:8px;">
                    <div style="width:60px; height:6px; background:#f3f4f6; border-radius:3px; overflow:hidden;">
                        <div style="height:100%; width:${leadScore}%; background:${leadScore > 50 ? '#f59e0b' : '#9ca3af'};"></div>
                    </div>
                    <span style="font-size:0.8rem; font-weight:600; color:var(--text-secondary);">${leadScore}%</span>
                </div>
            </td>
            <td>
                <div style="display:inline-flex; align-items:center; gap:6px; background:${isBotActive ? '#ecfdf5' : '#fffbeb'}; color:${isBotActive ? '#10b981' : '#f59e0b'}; padding:6px 12px; border-radius:12px; font-size:0.75rem; font-weight:600;">
                    <div style="width:6px; height:6px; border-radius:50%; background:currentColor;"></div>
                    ${isBotActive ? 'Activo' : 'Humano'}
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}


// --- AGENDA / API LOGIC ---
let appointments = [];

async function renderAgendaList() {
    try {
        const res = await axios.get('/api/appointments');
        appointments = res.data;
        const tbody = document.getElementById('agenda-table-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        appointments.forEach(app => {
            const tr = document.createElement('tr');

            // Format dates simply for display
            let displayDate = "";
            let displayTime = "";
            if (app.date) {
                const parts = app.date.split('T');
                displayDate = parts[0] || '';
                displayTime = parts[1] || '';
                // Optional: convert YYYY-MM-DD to DD/MM/YYYY
                const dp = displayDate.split('-');
                if (dp.length === 3) displayDate = `${dp[2]}/${dp[1]}/${dp[0]}`;
            }

            tr.innerHTML = `
                <td>
                    <div style="font-weight:600; color:var(--text-primary); margin-bottom:4px; font-size:0.85rem;">${displayDate}</div>
                    <div style="color:var(--text-muted); font-size:0.8rem;">${displayTime}</div>
                </td>
                <td>
                    <div style="font-weight:600; color:var(--text-primary); margin-bottom:4px; font-size:0.85rem;">${app.customer}</div>
                    <div style="color:var(--text-muted); font-size:0.8rem;">${app.phone || ''}</div>
                </td>
                <td>
                    <div style="font-size:0.85rem; color:var(--text-secondary); max-width: 250px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${app.motive}">${app.motive}</div>
                </td>
                <td style="color:var(--text-secondary); font-size:0.85rem;">${app.dur}</td>
                <td>
                    <span style="padding:4px 12px; border-radius:12px; font-size:0.75rem; font-weight:600; background:#fef3c7; color:#d97706;">${app.state}</span>
                </td>
                <td>
                    <span style="display:inline-flex; align-items:center; justify-content:center; width:36px; height:36px; border-radius:50%; font-size:0.65rem; font-weight:700; background:#f3e8ff; color:#9333ea; line-height:1; text-align:center;">${app.origin}</span>
                </td>
                <td class="agenda-actions-cell">
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // Update stats summary
        const hoyBadge = document.getElementById('agenda-stat-hoy');
        const semBadge = document.getElementById('agenda-stat-semana');
        const penBadge = document.getElementById('agenda-stat-pendientes');
        const comBadge = document.getElementById('agenda-stat-completadas');

        if (hoyBadge) hoyBadge.textContent = "1"; // Mock calculation
        if (semBadge) semBadge.textContent = appointments.length;
        if (penBadge) penBadge.textContent = appointments.filter(a => a.state === 'Pendiente').length;
        if (comBadge) comBadge.textContent = appointments.filter(a => a.state === 'Completada').length;

        // Render calendars if visible
        renderCalendars();

    } catch (err) {
        console.error("Failed to load appointments", err);
    }
}

function changeAgendaView(view) {
    document.querySelectorAll('.agenda-view-toggles .toggle-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`btn-view-${view}`).classList.add('active');

    const listaContainer = document.getElementById('agenda-lista-container');
    const calContainer = document.getElementById('agenda-calendar-container');

    if (view === 'lista') {
        listaContainer.classList.remove('hidden');
        calContainer.classList.add('hidden');
    } else {
        listaContainer.classList.add('hidden');
        calContainer.classList.remove('hidden');
        renderCalendars(view);
    }
}

function renderCalendars(currentView = 'mes') {
    const calContainer = document.getElementById('agenda-calendar-container');
    if (calContainer.classList.contains('hidden')) return;

    // Detect actual active view if not passed
    const activeBtn = document.querySelector('.agenda-view-toggles .toggle-btn.active');
    if (activeBtn && activeBtn.id === 'btn-view-semana') currentView = 'semana';

    // Dummy calendar data to indicate functionality based on user request
    if (currentView === 'semana') {
        let html = '<div class="calendar-header">FEBRERO 2026 - SEMANA 3</div><div class="calendar-week-grid">';
        html += '<div class="calendar-week-header-cell">Hora</div>';

        ['LUN 16', 'MAR 17', 'MIE 18', 'JUE 19', 'VIE 20', 'SAB 21', 'DOM 22'].forEach(d => {
            html += `<div class="calendar-week-header-cell">${d}</div>`;
        });

        for (let time = 9; time <= 17; time++) {
            html += `<div class="calendar-time-col"><div class="calendar-time-cell">${time}:00</div></div>`;
            for (let day = 1; day <= 7; day++) {
                // mock event
                if (day === 4 && time === 10) {
                    html += `<div class="calendar-day-col"><div class="calendar-slot"><div class="calendar-event">Carlos - Demo</div></div></div>`;
                } else {
                    html += `<div class="calendar-day-col"><div class="calendar-slot"></div></div>`;
                }
            }
        }
        html += '</div>';
        calContainer.innerHTML = html;

    } else if (currentView === 'mes') {
        let html = '<div class="calendar-header">FEBRERO 2026</div><div class="calendar-month-grid">';
        html += '<div class="calendar-day-header">Lunes</div><div class="calendar-day-header">Martes</div><div class="calendar-day-header">Lunes</div><div class="calendar-day-header">Miércoles</div><div class="calendar-day-header">Jueves</div><div class="calendar-day-header">Viernes</div><div class="calendar-day-header">Sábado</div>';

        // Blank leading days
        for (let i = 0; i < 6; i++) html += '<div class="calendar-day empty"></div>';

        // Month days
        for (let i = 1; i <= 28; i++) {
            let eventsHtml = '';
            if (i === 5) {
                eventsHtml = '<div class="calendar-event">13:00 - Yukata Y. (Demo)</div>';
            } else if (i === 7) {
                eventsHtml = '<div class="calendar-event">10:00 - Carlos (Demo)</div>';
            }

            html += `<div class="calendar-day"><div class="calendar-day-header">${i}</div>${eventsHtml}</div>`;
        }

        html += '</div>';
        calContainer.innerHTML = html;
    }
}

// --- KNOWLEDGE BASE / API LOGIC ---
let knowledgeItems = [];
let kbSelectedFile = null;

async function renderKnowledgeList() {
    try {
        const res = await axios.get('/api/knowledge');
        knowledgeItems = res.data;
        const grid = document.getElementById('kb-grid-container');
        if (!grid) return;
        grid.innerHTML = '';

        let categories = new Set();

        if (knowledgeItems.length === 0) {
            grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:60px 20px; color:#94a3b8;">
                <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="1" fill="none" style="display:block; margin:0 auto 16px; opacity:0.4;">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                </svg>
                <p style="font-size:0.95rem; font-weight:600; margin:0 0 8px;">Sin documentos aún</p>
                <p style="font-size:0.85rem; margin:0;">Haz clic en <strong>Subir Archivo</strong> para agregar tu primer documento.</p>
            </div>`;
        }

        knowledgeItems.forEach(item => {
            categories.add(item.category);

            const card = document.createElement('div');
            card.className = 'kb-card';

            const ext = item.fileName ? item.fileName.split('.').pop().toUpperCase() : 'TXT';
            const extColor = ext === 'PDF' ? '#ef4444' : ext === 'DOCX' || ext === 'DOC' ? '#3b82f6' : '#10b981';
            const snippet = (item.description || '').substring(0, 150);

            card.innerHTML = `
                <div>
                    <div style="display:flex; align-items:flex-start; gap:10px; margin-bottom:10px;">
                        <div style="background:${extColor}15; color:${extColor}; font-size:0.65rem; font-weight:700; padding:4px 8px; border-radius:6px; white-space:nowrap; margin-top:2px;">${ext}</div>
                        <div class="kb-card-category">${item.category}</div>
                    </div>
                    <div class="kb-card-title" title="${item.title}">${item.title}</div>
                    <div class="kb-card-desc">${snippet}${snippet.length >= 150 ? '...' : ''}</div>
                    ${item.uploadedAt ? `<div style="font-size:0.72rem; color:#94a3b8; margin-top:6px;">Subido: ${new Date(item.uploadedAt).toLocaleDateString('es-MX')}</div>` : ''}
                </div>
                <div class="kb-card-footer">
                    <div class="kb-status">
                        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg>
                        ${item.status}
                    </div>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <span style="color:${item.active ? '#10b981' : '#f59e0b'}; font-size:0.75rem; font-weight:600;">${item.active ? 'Activo' : 'Inactivo'}</span>
                        <button onclick="deleteKbItem('${item.id}')" title="Eliminar" style="background:#fef2f2; border:none; border-radius:6px; padding:4px 8px; cursor:pointer; color:#ef4444; font-size:0.75rem; font-weight:600;">
                            &#128465;
                        </button>
                    </div>
                </div>
            `;
            grid.appendChild(card);
        });

        // Update stats
        const totalBadge = document.getElementById('kb-stat-total');
        const syncedBadge = document.getElementById('kb-stat-synced');
        const pendingBadge = document.getElementById('kb-stat-pending');
        const catBadge = document.getElementById('kb-stat-categories');

        if (totalBadge) totalBadge.textContent = knowledgeItems.length;
        if (syncedBadge) syncedBadge.textContent = knowledgeItems.filter(i => i.status === 'Sincronizado').length;
        if (pendingBadge) pendingBadge.textContent = knowledgeItems.filter(i => i.status !== 'Sincronizado').length;
        if (catBadge) catBadge.textContent = categories.size;

    } catch (err) {
        console.error("Failed to load knowledge base:", err);
    }
}

async function deleteKbItem(id) {
    if (!confirm('\u00bfEliminar este documento de la base de conocimiento?')) return;
    try {
        await axios.delete(`/api/knowledge/${id}`);
        renderKnowledgeList();
    } catch (err) {
        alert('Error al eliminar: ' + err.message);
    }
}

// --- KB UPLOAD MODAL ---
function showKbUploadModal() {
    const modal = document.getElementById('kb-upload-modal');
    modal.style.display = 'flex';
    kbSelectedFile = null;
    document.getElementById('kb-drop-label').innerHTML = 'Arrastra tu archivo aquí o <strong style="color:#6366f1;">haz clic para seleccionar</strong>';
    document.getElementById('kb-doc-title').value = '';
    document.getElementById('kb-upload-progress').style.display = 'none';
    document.getElementById('kb-progress-bar').style.width = '0%';
    document.getElementById('kb-file-input').value = '';
}

function closeKbUploadModal() {
    document.getElementById('kb-upload-modal').style.display = 'none';
}

function handleKbFileSelect(input) {
    if (input.files && input.files[0]) {
        kbSelectedFile = input.files[0];
        document.getElementById('kb-drop-label').innerHTML = `✅ <strong>${kbSelectedFile.name}</strong> seleccionado`;
        // Pre-fill title from filename
        const nameNoExt = kbSelectedFile.name.replace(/\.[^.]+$/, '');
        if (!document.getElementById('kb-doc-title').value) {
            document.getElementById('kb-doc-title').value = nameNoExt;
        }
    }
}

function handleKbFileDrop(event) {
    event.preventDefault();
    const zone = document.getElementById('kb-drop-zone');
    zone.style.borderColor = '#cbd5e1';
    zone.style.background = '#f8fafc';
    if (event.dataTransfer.files && event.dataTransfer.files[0]) {
        const fi = document.getElementById('kb-file-input');
        // Transfer to the input (not directly possible so simulate)
        kbSelectedFile = event.dataTransfer.files[0];
        document.getElementById('kb-drop-label').innerHTML = `✅ <strong>${kbSelectedFile.name}</strong> seleccionado`;
        const nameNoExt = kbSelectedFile.name.replace(/\.[^.]+$/, '');
        if (!document.getElementById('kb-doc-title').value) {
            document.getElementById('kb-doc-title').value = nameNoExt;
        }
    }
}

async function submitKbUpload() {
    if (!kbSelectedFile) {
        alert('Por favor selecciona un archivo primero.');
        return;
    }

    const title = document.getElementById('kb-doc-title').value;
    const category = document.getElementById('kb-doc-category').value;
    const btn = document.getElementById('kb-upload-btn');
    const progressDiv = document.getElementById('kb-upload-progress');
    const progressBar = document.getElementById('kb-progress-bar');
    const statusText = document.getElementById('kb-upload-status');

    btn.disabled = true;
    btn.textContent = 'Procesando...';
    progressDiv.style.display = 'block';

    // Animate progress
    let prog = 0;
    const progInterval = setInterval(() => {
        prog = Math.min(prog + 15, 85);
        progressBar.style.width = prog + '%';
    }, 200);

    try {
        const formData = new FormData();
        formData.append('file', kbSelectedFile);
        formData.append('title', title);
        formData.append('category', category);

        statusText.textContent = 'Extrayendo texto del documento...';
        const res = await axios.post('/api/knowledge/upload', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });

        clearInterval(progInterval);
        progressBar.style.width = '100%';
        statusText.textContent = '\u2705 Documento procesado y guardado correctamente.';
        statusText.style.color = '#10b981';

        setTimeout(() => {
            closeKbUploadModal();
            renderKnowledgeList();
            btn.disabled = false;
            btn.textContent = 'Subir Documento';
        }, 1500);

    } catch (err) {
        clearInterval(progInterval);
        progressBar.style.width = '0%';
        progressBar.style.background = '#ef4444';
        statusText.textContent = '\u274c Error: ' + (err.response?.data?.error || err.message);
        statusText.style.color = '#ef4444';
        btn.disabled = false;
        btn.textContent = 'Subir Documento';
    }
}

// --- KB SEARCH TEST MODAL ---
function showKbSearchModal() {
    const modal = document.getElementById('kb-search-modal');
    modal.style.display = 'flex';
    document.getElementById('kb-chat-preview').innerHTML = '<div style="text-align:center; color:#94a3b8; font-size:0.8rem;">El resultado aparecerá aquí...</div>';
    document.getElementById('kb-test-input').value = '';
    document.getElementById('kb-test-meta').textContent = '';
}

function closeKbSearchModal() {
    document.getElementById('kb-search-modal').style.display = 'none';
}

async function runKbSearchTest() {
    const input = document.getElementById('kb-test-input');
    const query = input.value.trim();
    if (!query) return;

    const preview = document.getElementById('kb-chat-preview');
    const metaEl = document.getElementById('kb-test-meta');
    const btn = document.getElementById('kb-test-btn');

    // Show user message
    const removeEmpty = preview.querySelector('div[style*="text-align:center"]');
    if (removeEmpty) removeEmpty.remove();

    preview.innerHTML += `
        <div style="align-self:flex-end; background:#6366f1; color:white; padding:10px 14px; border-radius:16px 16px 4px 16px; max-width:80%; font-size:0.87rem; word-break:break-word;">
            ${query}
        </div>
    `;

    // Typing indicator
    const typingId = 'kb-typing-' + Date.now();
    preview.innerHTML += `
        <div id="${typingId}" style="align-self:flex-start; background:white; padding:10px 14px; border-radius:16px 16px 16px 4px; max-width:80%; font-size:0.87rem; color:#64748b; border:1px solid #e2e8f0;">
            <span style="animation:pulse 1.2s infinite;">Analizando tu pregunta...</span>
        </div>
    `;
    preview.scrollTop = preview.scrollHeight;
    btn.disabled = true;
    input.value = '';

    try {
        const res = await axios.post('/api/knowledge/test-search', { query });
        const data = res.data;

        // Remove typing indicator
        document.getElementById(typingId)?.remove();

        // Show bot response
        preview.innerHTML += `
            <div style="align-self:flex-start; background:white; padding:10px 14px; border-radius:16px 16px 16px 4px; max-width:80%; font-size:0.87rem; color:#1e293b; border:1px solid #e2e8f0; line-height:1.5;">
                ${data.response}
            </div>
        `;

        const sourceLabel = data.source === 'gemini' ? '✨ Respuesta generada con Gemini AI' : '🧠 Respuesta inteligente simulada';
        metaEl.textContent = `${sourceLabel} • ${data.docsUsed} doc(s) usados`;

    } catch (err) {
        document.getElementById(typingId)?.remove();
        preview.innerHTML += `<div style="color:#ef4444; font-size:0.82rem;">Error: ${err.response?.data?.error || err.message}</div>`;
    }

    preview.scrollTop = preview.scrollHeight;
    btn.disabled = false;
}


// --- REPORTES LOGIC ---
async function renderReportesList() {
    try {
        const conversacionesBadge = document.getElementById('reportes-stat-conversaciones');
        const citasBadge = document.getElementById('reportes-stat-citas');

        // We can fetch data slightly redundantly here just to make sure stats are up to date
        // Conversations count matches keys in conversations dictionary
        const convCount = Object.keys(conversations).length;
        if (conversacionesBadge) conversacionesBadge.textContent = convCount;

        // Fetch appointments to count
        const appRes = await axios.get('/api/appointments');
        const appList = appRes.data;
        if (citasBadge) citasBadge.textContent = appList.length;

    } catch (err) {
        console.error('Error rendering reportes', err);
    }
}

// --- PLANTILLAS LOGIC ---
const TEMPLATES = [
    {
        id: 'hello_world',
        name: 'hello_world',
        status: 'Aprobada',
        category: 'UTILITY',
        lang: 'en_US',
        body: 'Welcome and congratulations!! This message demonstrates your ability to send a WhatsApp message notification from the Cloud API, hosted by Meta. Thank you for taking the time to test with us.\n\nWhatsApp Business Platform sample message'
    },
    {
        id: 'promo_descuento',
        name: 'promo_descuento',
        status: 'Aprobada',
        category: 'MARKETING',
        lang: 'es_MX',
        body: '¡Hola! Tenemos un descuento especial del 20% para ti en tu próxima compra. Usa el código PROMOMETA al finalizar tu pago.'
    }
];

let selectedTemplateId = null;

function renderPlantillasList() {
    const listContainer = document.getElementById('plantillas-list');
    const contactSelect = document.getElementById('pt-contact-select');

    if (!listContainer || !contactSelect) return;

    // Render left list
    listContainer.innerHTML = '';

    TEMPLATES.forEach(tpl => {
        const card = document.createElement('div');
        card.className = 'pt-card';
        card.id = `pt-card-${tpl.id}`;
        card.onclick = () => selectPlantilla(tpl.id);

        card.innerHTML = `
            <div class="pt-card-title">
                ${tpl.name}
                <span class="pt-badge aprobada">${tpl.status}</span>
            </div>
            <div class="pt-card-subtitle">${tpl.category} • ${tpl.lang}</div>
        `;
        listContainer.appendChild(card);
    });

    // Default selection
    if (TEMPLATES.length > 0 && !selectedTemplateId) {
        selectPlantilla(TEMPLATES[0].id);
    }

    // Render RHS contacts
    contactSelect.innerHTML = '';
    const chatsArray = Object.values(conversations).sort((a, b) => b.timestamp - a.timestamp);

    chatsArray.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.className = 'pt-contact-option';
        opt.textContent = c.name || c.id || 'Desconocido';
        contactSelect.appendChild(opt);
    });
}

function selectPlantilla(id) {
    selectedTemplateId = id;

    // Update active styles
    document.querySelectorAll('.pt-card').forEach(c => c.classList.remove('active'));
    document.getElementById(`pt-card-${id}`)?.classList.add('active');

    // Update preview panel
    const tpl = TEMPLATES.find(t => t.id === id);
    if (!tpl) return;

    document.getElementById('pt-preview-title').textContent = tpl.name;
    document.getElementById('pt-preview-subtitle').textContent = `${tpl.category} • ${tpl.lang}`;
    document.getElementById('pt-preview-body').textContent = tpl.body;
}

async function sendPlantilla() {
    if (!selectedTemplateId) return alert('Selecciona una plantilla primero.');

    const contactSelect = document.getElementById('pt-contact-select');
    const selectedOptions = Array.from(contactSelect.selectedOptions).map(opt => opt.value);

    if (selectedOptions.length === 0) return alert('Debes seleccionar al menos un contacto.');

    const confirmSend = confirm(`¿Enviar la plantilla a ${selectedOptions.length} contacto(s)?`);
    if (!confirmSend) return;

    const tpl = TEMPLATES.find(t => t.id === selectedTemplateId);

    const btn = document.getElementById('pt-btn-send');
    btn.innerHTML = 'Enviando...';
    btn.disabled = true;

    try {
        const cleanedChatIds = selectedOptions.map(id => id.replace(/^\+/, ''));
        const res = await axios.post('/api/send-template', {
            chatIds: cleanedChatIds,
            templateText: tpl.body
        });
        alert(`Éxito: Se enviaron ${res.data.count} mensajes.`);
        // clear selection
        for (let i = 0; i < contactSelect.options.length; i++) {
            contactSelect.options[i].selected = false;
        }
    } catch (err) {
        console.error('Send template error:', err);
        alert('Ocurrió un error al enviar las plantillas.');
    } finally {
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg> Enviar';
        btn.disabled = false;
    }
}


// --- REPLIES CONFIG (Legacy/Simple) ---
async function loadReplies() {
    try {
        const res = await axios.get('/api/replies');
        automatedReplies = res.data;
        renderReplies();
    } catch (e) { console.error(e); }
}

function renderReplies() {
    repliesList.innerHTML = '';
    for (const [k, v] of Object.entries(automatedReplies)) {
        const d = document.createElement('div');
        d.className = 'reply-item';
        d.innerHTML = `<span class="reply-keyword">${k}</span> <span class="reply-text">${v}</span> <button class="reply-delete-btn" onclick="deleteReply('${k}')"><svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>`;
        repliesList.appendChild(d);
    }
}

function deleteReply(k) {
    delete automatedReplies[k];
    renderReplies();
    saveReplies();
}

function addReply() {
    const k = document.getElementById('keyword-input').value;
    const v = document.getElementById('response-input').value;
    if (k && v) { automatedReplies[k] = v; renderReplies(); }
}
async function saveReplies() {
    await axios.post('/api/replies', automatedReplies);
    alert('Guardado');
}

function retryConnection() { location.reload(); }

// --- FUNNEL TEMPLATES LOGIC ---
const FUNNEL_TEMPLATES_DATA = {
    'taveras': {
        title: 'Taveras Solutions (Agencia IA/Automation)',
        description: 'Funnel especializado de Erik Taveras para agencias de automatización y desarrollo de IA.',
        steps: [
            { title: 'Atracción y Filtrado', desc: 'Atraer agencias o negocios que busquen implementar IA.', objectives: ['interes detectado', 'rubro identificado'] },
            { title: 'Propuesta de Valor', desc: 'Mostrar casos de éxito de automatización.', objectives: ['caso mostrado', 'presupuesto consultado'] },
            { title: 'Agendamiento', desc: 'Llamada estratégica para cierre rápido.', objectives: ['reunión agendada'] }
        ]
    },
    'inmobiliaria': {
        title: 'Inmobiliaria / Bienes Raíces',
        description: 'Funnel para captación de leads interesados en compra, venta o alquiler de propiedades.',
        steps: [
            { title: 'Bienvenida', desc: 'Primer contacto, dar la bienvenida y detectar el interés inicial.', objectives: ['saludo hecho', 'intencion identificada'] },
            { title: 'Calificación', desc: 'Obtener información sobre presupuesto, zona, tipo de inmueble buscado.', objectives: ['nombre capturado', 'contacto capturado'] },
            { title: 'Presentación de Opciones', desc: 'Presentar opciones disponibles que coincidan con los criterios del cliente.', objectives: ['opciones presentadas', 'interes detectado'] }
        ]
    },
    'ecommerce': {
        title: 'E-commerce / Tienda Online',
        description: 'Funnel para atención al cliente y soporte en tiendas virtuales.',
        steps: [
            { title: 'Recepción', desc: 'Identificar el problema: estado de pedido, devoluciones, producto específico.', objectives: ['motivo contacto', 'numero orden'] },
            { title: 'Resolución / Upsell', desc: 'Dar estatus o mostrar productos relacionados.', objectives: ['problema resuelto', 'upsell sugerido'] }
        ]
    },
    'servicios': {
        title: 'Servicios Profesionales',
        description: 'Funnel para captación de clientes de consultoría, abogados, contadores, etc.',
        steps: [
            { title: 'Calificación de Caso', desc: 'Entender brevemente la situación del cliente.', objectives: ['detalle caso', 'urgencia'] },
            { title: 'Agendamiento de Asesoría', desc: 'Definir fecha para llamada o consulta en oficina.', objectives: ['cita confirmada', 'datos personales'] }
        ]
    },
    'educacion': {
        title: 'Educación / Cursos',
        description: 'Funnel para inscripción a cursos, talleres y venta de infoproductos.',
        steps: [
            { title: 'Exploración', desc: 'Saber qué le interesa aprender al lead.', objectives: ['interes curso', 'nivel conocimiento'] },
            { title: 'Oferta e Inscripción', desc: 'Enviar descuento y link de registro.', objectives: ['oferta enviada', 'link clickeado'] }
        ]
    }
};

function openFunnelTemplateModal() {
    const modal = document.getElementById('funnel-template-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.style.display = 'flex';
        // Initialize template selection events once
        if (!modal.dataset.initialized) {
            initFunnelTemplateCards();
            modal.dataset.initialized = 'true';
        }
    }
}

function closeFunnelTemplateModal() {
    const modal = document.getElementById('funnel-template-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.style.display = 'none';
    }
}

function initFunnelTemplateCards() {
    const cards = document.querySelectorAll('.funnel-template-card');
    cards.forEach(card => {
        card.addEventListener('click', () => {
            // Remove active class from all
            cards.forEach(c => c.classList.remove('active'));
            // Add active to clicked
            card.classList.add('active');

            // Update RHS content
            updateFunnelTemplateDetails(card.dataset.id);
        });
    });

    // Add data-ids sequentially to matching cards created in HTML
    if (cards.length === 5) {
        cards[0].dataset.id = 'taveras';
        cards[1].dataset.id = 'inmobiliaria';
        cards[2].dataset.id = 'ecommerce';
        cards[3].dataset.id = 'servicios';
        cards[4].dataset.id = 'educacion';
    }
}

function updateFunnelTemplateDetails(templateId) {
    const data = FUNNEL_TEMPLATES_DATA[templateId];
    if (!data) return;

    // update right content area
    const rightSide = document.querySelector('#funnel-template-modal .modal-content > div:nth-child(2) > div:nth-child(2)');
    if (rightSide) {
        let stepsHtml = '';
        data.steps.forEach((step, index) => {
            let tagsHtml = step.objectives.map(obj => `<span class="ft-tag green">${obj}</span>`).join('');
            stepsHtml += `
            <div class="ft-step">
                <div class="ft-step-number">${index + 1}</div>
                <div class="ft-step-content">
                    <h5>${step.title}</h5>
                    <p>${step.desc}</p>
                    <div class="ft-tags">
                        <span class="ft-tag">Objetivos:</span>
                        ${tagsHtml}
                    </div>
                </div>
            </div>
           `;
        });

        rightSide.innerHTML = `
            <h3 style="font-size: 1.5rem; font-weight: 700; color: #111827; margin: 0 0 8px 0;">${data.title}</h3>
            <p style="font-size: 0.95rem; color: #6b7280; margin: 0 0 32px 0;">${data.description}</p>
            <div style="display: flex; flex-direction: column; gap: 24px;">
                ${stepsHtml}
            </div>
       `;
    }
}

// --- FUNNEL DATA ---
let funnelNodesConfig = [
    { id: 'node0', type: 'trigger', title: 'Bienvenida', desc: 'Saludo inicial, detectar el negocio del lead.', x: 50, y: 150, next: ['node1'] },
    { id: 'node1', type: 'action', title: 'Diagnóstico', desc: 'Detectar el problema principal del cliente.', x: 400, y: 50, next: ['node2'] },
    { id: 'node2', type: 'action', title: 'Agendar Demo', desc: 'Cita confirmada en calendario.', x: 400, y: 250, next: ['node3'] },
    { id: 'node3', type: 'action', title: 'Presentación', desc: 'Mostrar propuesta de valor.', x: 750, y: 150, next: ['node4'] },
    { id: 'node4', type: 'end', title: 'Confirmación', desc: 'Fin del flujo de ventas.', x: 1100, y: 150, next: [] }
];

function renderFunnelList() {
    const tbody = document.getElementById('funnel-list-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    funnelNodesConfig.forEach((node, index) => {
        const nextLabel = node.next && node.next.length > 0
            ? node.next.map(nid => {
                const target = funnelNodesConfig.find(n => n.id === nid);
                return target ? `→ ${target.title}` : `→ ${nid}`;
            }).join(', ')
            : '<span style="color:#94a3b8">Fin del flujo</span>';

        const typeIcon = node.type === 'trigger' ? '⚡' : (node.type === 'end' ? '🏁' : '🤖');
        const typeBg = node.type === 'trigger' ? '#fff7ed' : (node.type === 'end' ? '#f0fdf4' : '#eff6ff');
        const typeColor = node.type === 'trigger' ? '#ea580c' : (node.type === 'end' ? '#16a34a' : '#2563eb');

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="text-align: center;">
                <div style="background: #f1f5f9; color: #475569; font-weight: 700; font-size: 0.85rem; width: 28px; height: 28px;
                    border-radius: 6px; display: inline-flex; align-items: center; justify-content: center;">${index}</div>
            </td>
            <td>
                <div style="display:flex; align-items:center; gap:8px;">
                    <div style="background:${typeBg}; color:${typeColor}; font-size:0.75rem; font-weight:700; padding:3px 8px; border-radius:6px;">${typeIcon} ${node.type}</div>
                    <span style="font-weight: 600; color: #0f172a; font-size: 0.9rem;">${node.title}</span>
                </div>
                <div style="font-size: 0.75rem; color: #94a3b8; font-family: monospace; margin-top:2px;">${node.id}</div>
            </td>
            <td><div style="font-size: 0.85rem; color: #64748b;">${nextLabel}</div></td>
            <td><div style="font-size: 0.85rem; color: #64748b; max-width: 260px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${node.desc || '-'}</div></td>
            <td>
                <div style="display: flex; gap: 6px;">
                    <button onclick="editFunnelStep('${node.id}')"
                        style="background: #eff6ff; border: none; color: #2563eb; cursor: pointer; padding: 6px 10px; border-radius:6px; font-size:0.75rem; font-weight:600;">✏️ Editar</button>
                    ${index > 0 ? `<button onclick="deleteFunnelStep('${node.id}')"
                        style="background: #fef2f2; border: none; color: #ef4444; cursor: pointer; padding: 6px 10px; border-radius:6px; font-size:0.75rem; font-weight:600;">🗑️</button>` : ''}
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function editFunnelStep(nodeId) {
    const node = funnelNodesConfig.find(n => n.id === nodeId);
    if (!node) return;
    document.getElementById('funnel-step-modal-title').textContent = 'Editar Paso';
    document.getElementById('funnel-step-id').value = nodeId;
    document.getElementById('funnel-step-title').value = node.title;
    document.getElementById('funnel-step-desc').value = node.desc;
    document.getElementById('funnel-step-type').value = node.type;
    const modal = document.getElementById('funnel-step-modal');
    modal.style.display = 'flex';
}

function openAddFunnelStep() {
    document.getElementById('funnel-step-modal-title').textContent = 'Nuevo Paso';
    document.getElementById('funnel-step-id').value = '';
    document.getElementById('funnel-step-title').value = '';
    document.getElementById('funnel-step-desc').value = '';
    document.getElementById('funnel-step-type').value = 'action';
    const modal = document.getElementById('funnel-step-modal');
    modal.style.display = 'flex';
}

function closeFunnelStepModal() {
    document.getElementById('funnel-step-modal').style.display = 'none';
}

function saveFunnelStep() {
    const id = document.getElementById('funnel-step-id').value;
    const title = document.getElementById('funnel-step-title').value.trim();
    const desc = document.getElementById('funnel-step-desc').value.trim();
    const type = document.getElementById('funnel-step-type').value;

    if (!title) { alert('El nombre del paso es requerido.'); return; }

    if (id) {
        // Edit existing
        const node = funnelNodesConfig.find(n => n.id === id);
        if (node) { node.title = title; node.desc = desc; node.type = type; }
    } else {
        // Add new
        const newId = 'node_' + Date.now();
        const lastNode = funnelNodesConfig[funnelNodesConfig.length - 1];
        const lastX = lastNode ? lastNode.x + 350 : 50;
        const lastY = lastNode ? lastNode.y : 150;

        // Connect previous last non-end node to new
        const prevActionNode = [...funnelNodesConfig].reverse().find(n => n.type !== 'end');
        if (prevActionNode) prevActionNode.next.push(newId);

        funnelNodesConfig.push({ id: newId, type, title, desc, x: lastX, y: lastY, next: [] });
    }

    closeFunnelStepModal();
    renderFunnelList();
    if (currentFunnelView === 'canvas') {
        renderFunnelNodes();
    }
}

function deleteFunnelStep(nodeId) {
    if (!confirm('¿Eliminar este paso del funnel?')) return;
    // Remove node
    funnelNodesConfig = funnelNodesConfig.filter(n => n.id !== nodeId);
    // Remove references from other nodes
    funnelNodesConfig.forEach(n => {
        n.next = n.next.filter(id => id !== nodeId);
    });
    renderFunnelList();
    if (currentFunnelView === 'canvas') {
        renderFunnelNodes();
    }
}

function applyFunnelTemplate() {
    const activeCard = document.querySelector('.funnel-template-card.active');
    if (!activeCard) { alert('Selecciona una plantilla primero'); return; }
    const templateId = activeCard.dataset.id;
    const data = FUNNEL_TEMPLATES_DATA[templateId];
    if (!data) return;

    if (!confirm(`¿Aplicar la plantilla "${data.title}"? Esto reemplazará los pasos actuales del funnel.`)) return;

    // Build new nodes from template
    const nodeSpacingX = 350;
    funnelNodesConfig = data.steps.map((step, i) => ({
        id: 'node_t' + i,
        type: i === 0 ? 'trigger' : (i === data.steps.length - 1 ? 'end' : 'action'),
        title: step.title,
        desc: step.desc,
        x: 50 + i * nodeSpacingX,
        y: i % 2 === 0 ? 150 : 50,
        next: i < data.steps.length - 1 ? ['node_t' + (i + 1)] : []
    }));

    closeFunnelTemplateModal();
    renderFunnelList();
    if (currentFunnelView === 'canvas') {
        const cv = document.getElementById('funnel-canvas-view');
        cv.dataset.initialized = '';
        initFunnelCanvas();
    }

    // Show success toast
    showFunnelToast(`✅ Plantilla "${data.title}" aplicada con ${data.steps.length} pasos.`);
}

function showFunnelToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `position:fixed; bottom:24px; right:24px; background:#0f172a; color:white; padding:12px 20px;
        border-radius:12px; font-size:0.85rem; font-weight:600; z-index:9999; box-shadow:0 8px 24px rgba(0,0,0,0.2);
        animation: slideIn 0.3s ease; max-width:320px;`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

// --- FUNNEL CANVAS BUILDER STATE ---
let currentFunnelView = 'list';
let canvasZoom = 1;
let canvasPanX = 0;
let canvasPanY = 0;
let isConnecting = false;
let connectingStartPort = null;
let connectingStartNodeId = null;
let connectingCurrentMouse = null;

function switchFunnelView(viewStyle) {
    currentFunnelView = viewStyle;
    const btnList = document.getElementById('btn-view-list');
    const btnCanvas = document.getElementById('btn-view-canvas');
    const listView = document.getElementById('funnel-list-view');
    const canvasView = document.getElementById('funnel-canvas-view');

    if (viewStyle === 'list') {
        btnList.classList.add('active');
        btnList.style.background = 'white';
        btnList.style.boxShadow = '0 1px 2px rgba(0,0,0,0.1)';
        btnList.style.color = '#0f172a';

        btnCanvas.classList.remove('active');
        btnCanvas.style.background = 'transparent';
        btnCanvas.style.boxShadow = 'none';
        btnCanvas.style.color = '#64748b';

        listView.classList.remove('hidden');
        listView.style.display = 'block';
        canvasView.classList.add('hidden');
        canvasView.style.display = 'none';
        renderFunnelList();
    } else {
        btnCanvas.classList.add('active');
        btnCanvas.style.background = 'white';
        btnCanvas.style.boxShadow = '0 1px 2px rgba(0,0,0,0.1)';
        btnCanvas.style.color = '#0f172a';

        btnList.classList.remove('active');
        btnList.style.background = 'transparent';
        btnList.style.boxShadow = 'none';
        btnList.style.color = '#64748b';

        listView.classList.add('hidden');
        canvasView.classList.remove('hidden');

        // initialize if first time
        if (!canvasView.dataset.initialized) {
            initFunnelCanvas();
            canvasView.dataset.initialized = 'true';
        }
        drawFunnelConnections(); // redraw lines just in case
    }
}

function initFunnelCanvas() {
    renderFunnelNodes();
    initCanvasDrag();

    // Rerender connections on window resize
    window.addEventListener('resize', () => {
        if (currentFunnelView === 'canvas') drawFunnelConnections();
    });
}

function renderFunnelNodes() {
    const container = document.getElementById('canvas-nodes');
    if (!container) return;
    container.innerHTML = '';

    funnelNodesConfig.forEach(node => {
        const el = document.createElement('div');
        el.className = 'funnel-node';
        el.id = node.id;
        el.style.left = node.x + 'px';
        el.style.top = node.y + 'px';

        let headerClass = node.type === 'trigger' ? ' trigger' : '';
        let iconHtml = node.type === 'trigger' ? '⚡ ' : (node.type === 'end' ? '🏁 ' : '🤖 ');

        el.innerHTML = `
            ${node.type !== 'trigger' ? '<div class="funnel-port input" data-id="in-' + node.id + '"></div>' : ''}
            <div class="funnel-node-header${headerClass}">
                <div class="funnel-node-title">${iconHtml} ${node.title}</div>
            </div>
            <div class="funnel-node-body">
                ${node.desc}
            </div>
            ${node.next ? '<div class="funnel-port output" data-id="out-' + node.id + '"></div>' : ''}
        `;

        // Handle Node Drag
        let isDragging = false;
        let startX, startY;

        el.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('funnel-port')) return; // let port click handle later
            isDragging = true;
            startX = e.clientX - (node.x * canvasZoom);
            startY = e.clientY - (node.y * canvasZoom);

            // visually bring to front
            document.querySelectorAll('.funnel-node').forEach(n => n.classList.remove('active'));
            el.classList.add('active');

            e.stopPropagation();
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            let newX = (e.clientX - startX) / canvasZoom;
            let newY = (e.clientY - startY) / canvasZoom;
            node.x = newX;
            node.y = newY;
            el.style.left = node.x + 'px';
            el.style.top = node.y + 'px';
            drawFunnelConnections();
        });

        window.addEventListener('mouseup', () => {
            isDragging = false;
        });

        // --- PORT INTERACTION (Connection Drawing) ---
        const outPort = el.querySelector('.funnel-port.output');
        const inPort = el.querySelector('.funnel-port.input');

        if (outPort) {
            outPort.addEventListener('mousedown', (e) => {
                e.stopPropagation(); // prevent node drag
                isConnecting = true;
                connectingStartPort = outPort;
                connectingStartNodeId = node.id;
            });
        }

        if (inPort) {
            inPort.addEventListener('mouseup', (e) => {
                if (isConnecting && connectingStartNodeId !== node.id) {
                    // Finish connection
                    const startData = funnelNodesConfig.find(n => n.id === connectingStartNodeId);
                    if (startData && !startData.next.includes(node.id)) {
                        startData.next.push(node.id);
                    }
                }
            });
        }

        container.appendChild(el);
    });

    // Draw initial lines delay
    setTimeout(drawFunnelConnections, 50);
}

function drawFunnelConnections() {
    const svg = document.getElementById('canvas-lines');
    const nodesContainer = document.getElementById('canvas-nodes');
    if (!svg || !nodesContainer) return;

    // clear lines
    svg.innerHTML = `
        <defs>
            <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#cbd5e1" />
            </marker>
            <marker id="arrowhead-active" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#3b82f6" />
            </marker>
        </defs>
    `;

    funnelNodesConfig.forEach(node => {
        if (!node.next || node.next.length === 0) return;

        node.next.forEach(targetId => {
            const outPort = document.querySelector(`#${node.id} .output`);
            const inPort = document.querySelector(`#${targetId} .input`);

            if (outPort && inPort) {
                // Get rect relative to container
                const containerRect = nodesContainer.getBoundingClientRect();
                const outRect = outPort.getBoundingClientRect();
                const inRect = inPort.getBoundingClientRect();

                // Calculate scaled coordinates based on current zoom and pan
                // The logical position within the canvas before scaling
                const x1 = ((outRect.left + outRect.width / 2) - containerRect.left) / canvasZoom;
                const y1 = ((outRect.top + outRect.height / 2) - containerRect.top) / canvasZoom;
                const x2 = ((inRect.left + inRect.width / 2) - containerRect.left) / canvasZoom;
                const y2 = ((inRect.top + inRect.height / 2) - containerRect.top) / canvasZoom;

                // Create Spline Curve
                const cp1x = x1 + 80;
                const cp1y = y1;
                const cp2x = x2 - 80;
                const cp2y = y2;

                const d = `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;

                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', d);
                path.setAttribute('fill', 'none');
                path.setAttribute('stroke', '#cbd5e1');
                path.setAttribute('stroke-width', '2.5');
                path.setAttribute('marker-end', 'url(#arrowhead)');
                path.style.transition = 'stroke 0.2s';

                // Add click to delete connection
                path.style.cursor = 'pointer';
                path.addEventListener('mouseenter', () => { path.setAttribute('stroke', '#ef4444'); });
                path.addEventListener('mouseleave', () => { path.setAttribute('stroke', '#cbd5e1'); });
                path.addEventListener('click', () => {
                    if (confirm('¿Eliminar esta conexión?')) {
                        node.next = node.next.filter(id => id !== targetId);
                        drawFunnelConnections();
                    }
                });

                svg.appendChild(path);
            }
        });
    });

    // Draw active connecting line
    if (connectingStartPort && connectingCurrentMouse) {
        const containerRect = nodesContainer.getBoundingClientRect();
        const startRect = connectingStartPort.getBoundingClientRect();

        const x1 = ((startRect.left + startRect.width / 2) - containerRect.left) / canvasZoom;
        const y1 = ((startRect.top + startRect.height / 2) - containerRect.top) / canvasZoom;
        const x2 = (connectingCurrentMouse.x - containerRect.left) / canvasZoom;
        const y2 = (connectingCurrentMouse.y - containerRect.top) / canvasZoom;

        const cp1x = x1 + 80;
        const cp1y = y1;
        const cp2x = x2 - 80;
        const cp2y = y2;

        const d = `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#3b82f6');
        path.setAttribute('stroke-width', '2.5');
        path.setAttribute('stroke-dasharray', '5,5'); // dashed line
        path.setAttribute('marker-end', 'url(#arrowhead-active)');
        svg.appendChild(path);
    }
}

function initCanvasDrag() {
    const container = document.getElementById('funnel-canvas-view');
    const nodesLayer = document.getElementById('canvas-nodes');
    const linesLayer = document.getElementById('canvas-lines');

    let isPanning = false;
    let startX, startY;

    container.addEventListener('mousedown', (e) => {
        if (e.target.closest('.funnel-node')) return; // ignore clicking on nodes
        isPanning = true;
        startX = e.clientX - canvasPanX;
        startY = e.clientY - canvasPanY;
        container.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
        if (!isPanning) return;
        canvasPanX = e.clientX - startX;
        canvasPanY = e.clientY - startY;
        updateCanvasTransform();
    });

    window.addEventListener('mouseup', () => {
        isPanning = false;
        container.style.cursor = 'grab';

        if (isConnecting) {
            isConnecting = false;
            connectingStartPort = null;
            connectingStartNodeId = null;
            connectingCurrentMouse = null;
            drawFunnelConnections();
        }
    });

    // Track mouse globally for connecting line
    window.addEventListener('mousemove', (e) => {
        if (isConnecting) {
            connectingCurrentMouse = { x: e.clientX, y: e.clientY };
            drawFunnelConnections();
        }
    });

    // Mouse wheel zoom
    container.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.95 : 1.05;
        zoomCanvas(delta);
    }, { passive: false });
}

function updateCanvasTransform() {
    const nodesLayer = document.getElementById('canvas-nodes');
    const linesLayer = document.getElementById('canvas-lines');
    const transformStr = `translate(${canvasPanX}px, ${canvasPanY}px) scale(${canvasZoom})`;
    if (nodesLayer) nodesLayer.style.transform = transformStr;
    if (linesLayer) linesLayer.style.transform = transformStr;
}

function zoomCanvas(factor) {
    canvasZoom *= factor;
    // clamp zoom
    if (canvasZoom < 0.3) canvasZoom = 0.3;
    if (canvasZoom > 2) canvasZoom = 2;
    updateCanvasTransform();
}

function resetCanvasView() {
    canvasZoom = 1;
    canvasPanX = 0;
    canvasPanY = 0;
    updateCanvasTransform();
}

// Start
loadAgentConfig();
init();
