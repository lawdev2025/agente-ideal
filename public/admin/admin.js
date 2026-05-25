// ==========================================================================
// PAINEL ADMIN - COLÉGIO IDEAL
// Todos os dados vêm exclusivamente do Supabase. Sem dados fictícios.
// ==========================================================================

let _sb = null;
let currentTab = 'dashboard';
let activeTable = 'school_products';
let activeContactId = null;
let chartConversations = null;
let chartSubjects = null;
let editRecordId = null;
let lastChartData = null;
let selectedUnitFilter = null; // null = todas as unidades
let cachedUnits = [];          // [{id, name}, ...] carregado do Supabase

const _injected = window.__ADMIN_CONFIG__ || {};
let adminToken = _injected.ADMIN_TOKEN || '';
const BACKEND_URL = _injected.BACKEND_URL !== undefined ? _injected.BACKEND_URL : 'http://localhost:3000';

const TABLE_SCHEMAS = {
    school_products: [
        { name: 'id',           label: 'ID (Auto)',                type: 'text',     readonly: true, hiddenOnAdd: true },
        { name: 'unit_id',      label: 'Unidade',                  type: 'select',   required: true, dynamicOptions: 'school_units' },
        { name: 'category',     label: 'Categoria',                type: 'select',   required: true, options: [
            'Educação Infantil',
            'Ensino Fundamental — Anos Iniciais',
            'Ensino Fundamental — Anos Finais',
            'Ensino Médio',
            'Pré-Vestibular (Eixo)',
            'Escolinhas de Esporte',
            'Cursos Específicos'
        ]},
        { name: 'name',         label: 'Nome do Produto / Turma',  type: 'text',     required: true },
        { name: 'description',  label: 'Descrição',                type: 'textarea', required: false },
        { name: 'monthly_fee',  label: 'Mensalidade (R$)',         type: 'number',   required: false },
        { name: 'material_fee', label: 'Material Didático (R$)',   type: 'number',   required: false },
        { name: 'schedule',     label: 'Horário das Aulas',        type: 'text',     required: false },
        { name: 'image_url',    label: 'Foto / Imagem',            type: 'file',     required: false }
    ],
    school_levels: [
        { name: 'id', label: 'ID', type: 'text', required: true, readonlyOnEdit: true },
        { name: 'nivel', label: 'Nível Escolar', type: 'text', required: true },
        { name: 'descricao', label: 'Descrição (Séries)', type: 'text', required: true },
        { name: 'preco_mensal', label: 'Mensalidade (R$)', type: 'number', required: true },
        { name: 'preco_semestral', label: 'Semestral (R$)', type: 'number', required: true },
        { name: 'preco_anual', label: 'Anual (R$)', type: 'number', required: true },
        { name: 'incluso', label: 'Inclusos no Pacote (separados por vírgula)', type: 'textarea', required: true }
    ],
    school_contacts: [
        { name: 'id', label: 'ID (Auto)', type: 'text', readonly: true, hiddenOnAdd: true },
        { name: 'name', label: 'Nome do Setor/Pessoa', type: 'text', required: true },
        { name: 'role_title', label: 'Descrição de Suporte', type: 'text', required: true },
        { name: 'phone_number', label: 'Telefone (ex: 5511999998888)', type: 'text', required: true }
    ],
    school_materials: [
        { name: 'id', label: 'ID (Auto)', type: 'text', readonly: true, hiddenOnAdd: true },
        { name: 'nivel', label: 'Nível (Fundamental/Médio)', type: 'select', options: ['Ensino Fundamental', 'Ensino Médio'], required: true },
        { name: 'subject', label: 'Disciplina', type: 'text', required: true },
        { name: 'title', label: 'Título do Material', type: 'text', required: true },
        { name: 'download_url', label: 'Link de Download (URL)', type: 'text', required: true },
        { name: 'image_url', label: 'Imagem Ilustrativa (Foto/Upload)', type: 'file', required: false }
    ],
    school_units: [
        { name: 'id',             label: 'ID',                           type: 'text',     required: true, readonlyOnEdit: true },
        { name: 'name',           label: 'Nome da Unidade',              type: 'text',     required: true },
        { name: 'address',        label: 'Endereço',                     type: 'text',     required: true },
        { name: 'phone',          label: 'Telefone',                     type: 'text',     required: false },
        { name: 'whatsapp',       label: 'WhatsApp',                     type: 'text',     required: false },
        { name: 'hours',          label: 'Horário de Funcionamento',     type: 'text',     required: false },
        { name: 'levels',         label: 'Níveis de Ensino Oferecidos',  type: 'text',     required: false },
        { name: 'infrastructure', label: 'Infraestrutura',               type: 'textarea', required: false },
        { name: 'activities',     label: 'Atividades Extracurriculares', type: 'text',     required: false },
        { name: 'capacity',       label: 'Capacidade Estimada',          type: 'text',     required: false }
    ]
};

// 1. INICIALIZAÇÃO
document.addEventListener('DOMContentLoaded', async () => {
    initTabs();
    initTheme();

    // Conecta ao Supabase — carrega dados reais após conexão
    initConnection().then(connected => {
        if (connected) {
            loadDashboardStats();
        }
    });

    document.querySelectorAll('.btn-db-nav').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.btn-db-nav').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            activeTable = e.currentTarget.getAttribute('data-table');
            loadDatabaseTable();
        });
    });

    document.getElementById('btn-add-row').addEventListener('click', openAddModal);
    document.getElementById('btn-close-modal').addEventListener('click', closeModal);
    document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
    document.getElementById('db-modal-form').addEventListener('submit', handleModalSubmit);
    document.getElementById('config-form').addEventListener('submit', saveConfigForm);
    document.getElementById('btn-clear-config').addEventListener('click', clearConfig);
    document.getElementById('contact-search').addEventListener('input', filterContacts);
    document.getElementById('btn-toggle-bot').addEventListener('click', toggleBotStatus);

    // CSV import
    document.getElementById('btn-import-csv').addEventListener('click', openCSVModal);
    document.getElementById('btn-close-csv-modal').addEventListener('click', closeCSVModal);
    document.getElementById('btn-cancel-csv-modal').addEventListener('click', closeCSVModal);
    document.getElementById('btn-download-csv-example').addEventListener('click', downloadCSVExample);
    document.getElementById('btn-import-csv-confirm').addEventListener('click', importCSVData);

    const csvFileInput = document.getElementById('csv-file-input');
    csvFileInput.addEventListener('change', (e) => handleCSVFile(e.target.files[0]));

    const dropZone = document.getElementById('csv-drop-zone');
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file) { document.getElementById('csv-file-input').files = e.dataTransfer.files; handleCSVFile(file); }
    });

    // Realtime via Supabase: subscriptions substituem o polling de 2s.
    // Fallback automatico pra polling de 30s se o canal nao subir em 10s.
    initRealtimeSubscriptions();
});

// 2. ABAS
function initTabs() {
    document.querySelectorAll('.sidebar-menu li').forEach(item => {
        item.addEventListener('click', (e) => {
            document.querySelectorAll('.sidebar-menu li').forEach(i => i.classList.remove('active'));
            e.currentTarget.classList.add('active');

            currentTab = e.currentTarget.getAttribute('data-tab');
            document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
            document.getElementById(`tab-${currentTab}`).classList.add('active');

            const titles = {
                dashboard: { title: 'Painel de Controle', subtitle: 'Resumo estatístico do Agente Ideal e atendimento escolar' },
                conversas: { title: 'Central de Conversas', subtitle: 'Visualize os atendimentos do bot e gerencie o status em tempo real' },
                banco: { title: 'Banco de Dados', subtitle: 'Edite, adicione ou exclua informações da base de conhecimento da escola' },
                config: { title: 'Configurações de Conexão', subtitle: 'Gerencie as chaves de integração do Supabase' }
            };
            document.getElementById('tab-title').textContent = titles[currentTab].title;
            document.getElementById('tab-subtitle').textContent = titles[currentTab].subtitle;

            if (currentTab === 'dashboard') loadDashboardStats();
            else if (currentTab === 'conversas') loadConversationsTab();
            else if (currentTab === 'banco') loadDatabaseTable();
        });
    });
}

// 3. TEMA
function initTheme() {
    const toggleBtn = document.getElementById('theme-toggle-btn');
    if (!toggleBtn) return;
    toggleBtn.addEventListener('click', () => {
        const isDark = document.documentElement.classList.toggle('dark');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
        updateThemeIcon();
        // Re-renderiza gráficos com as cores corretas do novo tema
        if (lastChartData) {
            setTimeout(() => renderCharts(lastChartData.msgCounts, lastChartData.subjects, lastChartData.days), 30);
        }
    });
    const savedTheme = localStorage.getItem('theme') || 'dark';
    if (savedTheme === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
    updateThemeIcon();
}

function updateThemeIcon() {
    const toggleBtn = document.getElementById('theme-toggle-btn');
    if (!toggleBtn) return;
    const isDark = document.documentElement.classList.contains('dark');
    toggleBtn.querySelector('i').className = isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    toggleBtn.querySelector('span').textContent = isDark ? 'Tema Claro' : 'Tema Escuro';
}

// 4. CONEXÃO SUPABASE
async function initConnection() {
    const statusText = document.getElementById('supabase-status-text');
    const statusIndicator = document.querySelector('.status-indicator');

    let url = _injected.SUPABASE_URL || null;
    let key = _injected.SUPABASE_ANON_KEY || null;
    if (_injected.ADMIN_TOKEN) adminToken = _injected.ADMIN_TOKEN;

    url = localStorage.getItem('SUPABASE_URL') || url;
    key = localStorage.getItem('SUPABASE_ANON_KEY') || key;

    // Tenta sempre obter as credenciais reais do .env do servidor local
    for (const fetchUrl of ['/api/config', `${BACKEND_URL}/api/config`]) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            const res = await fetch(fetchUrl, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (res.ok) {
                const cfg = await res.json();
                if (cfg.SUPABASE_URL && !url) url = cfg.SUPABASE_URL;
                if (cfg.SUPABASE_ANON_KEY && !key) key = cfg.SUPABASE_ANON_KEY;
                if (cfg.ADMIN_TOKEN) adminToken = cfg.ADMIN_TOKEN;

                // Popula os campos do formulário na aba de configurações
                if (cfg.SUPABASE_URL) document.getElementById('input-supabase-url').value = cfg.SUPABASE_URL;
                if (cfg.SUPABASE_ANON_KEY) document.getElementById('input-supabase-key').value = cfg.SUPABASE_ANON_KEY;
                if (cfg.LLM_PROVIDER) document.getElementById('select-llm-provider').value = cfg.LLM_PROVIDER;
                if (cfg.ANTHROPIC_API_KEY) document.getElementById('input-anthropic-key').value = cfg.ANTHROPIC_API_KEY;
                if (cfg.GEMINI_API_KEY) document.getElementById('input-gemini-key').value = cfg.GEMINI_API_KEY;
                if (cfg.TELEGRAM_BOT_TOKEN) document.getElementById('input-telegram-token').value = cfg.TELEGRAM_BOT_TOKEN;
                if (cfg.TELEGRAM_CHAT_ID) document.getElementById('input-telegram-chat-id').value = cfg.TELEGRAM_CHAT_ID;
                if (cfg.WHATSAPP_PHONE_NUMBER_ID) document.getElementById('input-whatsapp-phone-id').value = cfg.WHATSAPP_PHONE_NUMBER_ID;
                if (cfg.WHATSAPP_ACCESS_TOKEN) document.getElementById('input-whatsapp-token').value = cfg.WHATSAPP_ACCESS_TOKEN;
                if (cfg.WHATSAPP_VERIFY_TOKEN) document.getElementById('input-whatsapp-verify-token').value = cfg.WHATSAPP_VERIFY_TOKEN;
                if (cfg.ADMIN_TOKEN) document.getElementById('input-admin-token').value = cfg.ADMIN_TOKEN;
                break;
            }
        } catch (e) { /* silent fail se o servidor local estiver offline */ }
    }

    if (url) document.getElementById('input-supabase-url').value = url;
    if (key) document.getElementById('input-supabase-key').value = key;

    if (!url || !key) {
        statusText.textContent = 'Supabase não configurado';
        statusIndicator.className = 'status-indicator offline';
        return false;
    }

    try {
        if (!window.supabase) throw new Error('SDK do Supabase não carregada.');
        _sb = window.supabase.createClient(url, key);

        const checkPromise = _sb.from('school_contacts').select('count', { count: 'exact', head: true });
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout ao conectar ao Supabase')), 4000));
        
        await Promise.race([checkPromise, timeoutPromise]);

        statusText.textContent = 'Conectado ao Supabase';
        statusIndicator.className = 'status-indicator online';
        return true;
    } catch (err) {
        statusText.textContent = 'Erro de Conexão';
        statusIndicator.className = 'status-indicator offline';
        console.error('Erro de conexão Supabase:', err);
        _sb = null;
        return false;
    }
}

async function loadDashboardStats() {
    // Try backend API first (SQLite — auto-updates with each new message)
    if (adminToken) {
        try {
            const res = await fetch(`${BACKEND_URL}/api/admin/stats`, {
                headers: { 'Authorization': `Bearer ${adminToken}` }
            });
            if (res.ok) {
                const s = await res.json();
                document.getElementById('stat-total-messages').textContent = s.totalMessages ?? 0;
                document.getElementById('stat-active-contacts').textContent = s.activeContacts ?? 0;
                const activeTrend = document.getElementById('stat-active-trend');
                if (activeTrend) {
                    const inactive = s.inactiveContacts ?? 0;
                    const total = s.totalContacts ?? ((s.activeContacts ?? 0) + inactive);
                    activeTrend.className = inactive > 0 ? 'trend info' : 'trend positive';
                    activeTrend.innerHTML = `<i class="fa-solid fa-users"></i> ${inactive} inativos · ${total} no total`;
                }
                document.getElementById('stat-escalations').textContent = s.escalations ?? 0;
                document.getElementById('stat-telegram-errors').textContent = s.escalationMessages ?? 0;
                const trendEl = document.getElementById('stat-telegram-trend');
                if ((s.escalationMessages ?? 0) > 0) {
                    trendEl.className = 'trend negative';
                    trendEl.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${s.escalationMessages} escalações`;
                } else {
                    trendEl.className = 'trend positive';
                    trendEl.innerHTML = '<i class="fa-solid fa-circle-check"></i> Sem escalações';
                }
                renderCharts(s.msgCounts || [0,0,0,0,0,0,0], s.subjects || {}, s.days || []);
                return;
            }
        } catch (e) {
            console.warn('Backend stats indisponível, tentando Supabase...', e);
        }
    }

    if (!_sb) {
        ['stat-total-messages', 'stat-active-contacts', 'stat-escalations', 'stat-telegram-errors'].forEach(id => {
            document.getElementById(id).textContent = '—';
        });
        document.getElementById('stat-telegram-trend').className = 'trend info';
        document.getElementById('stat-telegram-trend').innerHTML = '<i class="fa-solid fa-plug-circle-xmark"></i> Sem conexão';
        renderCharts([0,0,0,0,0,0,0], {});
        return;
    }

    try {
        const [{ count: totalMessages }, { count: activeContacts }, { count: escalations }, { data: errorLogs }] = await Promise.all([
            _sb.from('messages').select('*', { count: 'exact', head: true }),
            _sb.from('contacts').select('*', { count: 'exact', head: true }),
            _sb.from('contacts').select('*', { count: 'exact', head: true }).eq('bot_paused', true),
            _sb.from('messages').select('content').ilike('content', '%erro%')
        ]);

        document.getElementById('stat-total-messages').textContent = totalMessages ?? 0;
        document.getElementById('stat-active-contacts').textContent = activeContacts ?? 0;
        document.getElementById('stat-escalations').textContent = escalations ?? 0;

        const telegramErrors = errorLogs ? errorLogs.length : 0;
        document.getElementById('stat-telegram-errors').textContent = telegramErrors;
        const trendEl = document.getElementById('stat-telegram-trend');
        if (telegramErrors > 0) {
            trendEl.className = 'trend negative';
            trendEl.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${telegramErrors} erros`;
        } else {
            trendEl.className = 'trend positive';
            trendEl.innerHTML = '<i class="fa-solid fa-circle-check"></i> Sem erros';
        }

        // Busca dados dos gráficos
        const days = [];
        const msgCounts = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            days.push(d.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric' }));
            const start = new Date(d); start.setHours(0,0,0,0);
            const end = new Date(d); end.setHours(23,59,59,999);
            const { count } = await _sb.from('messages').select('*', { count: 'exact', head: true })
                .gte('created_at', start.getTime()).lte('created_at', end.getTime());
            msgCounts.push(count || 0);
        }

        const subjects = { 'Mensalidades / Valores': 0, 'Matrículas & Vagas': 0, 'Materiais / Livros': 0, 'Contatos / Secretaria': 0, 'Horários & Grade': 0, 'Outras dúvidas': 0 };
        const { data: userMsgs } = await _sb.from('messages').select('content').eq('role', 'user');
        if (userMsgs) {
            userMsgs.forEach(msg => {
                const t = (msg.content || '').toLowerCase();
                if (t.match(/mensal|preço|valor|pagamento|custo/)) subjects['Mensalidades / Valores']++;
                else if (t.match(/matrícula|matricula|vaga|inscrição|inscrever/)) subjects['Matrículas & Vagas']++;
                else if (t.match(/material|livro|apostila|caderno/)) subjects['Materiais / Livros']++;
                else if (t.match(/contato|telefone|whatsapp|secretaria|falar com/)) subjects['Contatos / Secretaria']++;
                else if (t.match(/horário|horario|aula|grade|calendário/)) subjects['Horários & Grade']++;
                else subjects['Outras dúvidas']++;
            });
        }

        renderCharts(msgCounts, subjects, days);
    } catch (e) {
        console.error('Erro ao buscar estatísticas:', e);
    }
}

function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Arredonda o máximo para um "número bonito" ESTRITAMENTE maior que o pico
// (1, 2, 5 × 10ⁿ), garantindo que o ponto nunca encoste no topo.
// Ex.: 487 → 500, 100 → 200, 30 → 50, 10 → 20, 5 → 10, 0 → 5.
function niceCeiling(value) {
    if (!value || value < 1) return 5;
    const exp = Math.floor(Math.log10(value));
    const pow = Math.pow(10, exp);
    const norm = value / pow; // entre 1 e 10
    let nice;
    if (norm < 2) nice = 2;
    else if (norm < 5) nice = 5;
    else nice = 10;
    return nice * pow;
}

function renderCharts(msgCounts, subjects, days) {
    if (!window.Chart) return;

    if (!days) {
        days = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(); d.setDate(d.getDate() - i);
            days.push(d.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric' }));
        }
    }

    // Skip re-render if data didn't change (avoids flicker during 2s polling).
    const signature = JSON.stringify({ msgCounts, subjects, days });
    if (chartConversations && chartSubjects && lastChartData && lastChartData._sig === signature) {
        return;
    }
    lastChartData = { msgCounts, subjects, days, _sig: signature };

    // If charts already exist, just update their data in place — no destroy/recreate.
    if (chartConversations && chartSubjects) {
        chartConversations.data.labels = days;
        chartConversations.data.datasets[0].data = msgCounts || [];
        const maxIn = Math.max(0, ...(msgCounts || [0]));
        const ceil  = niceCeiling(maxIn);
        chartConversations.options.scales.y.max = ceil;
        chartConversations.options.scales.y.ticks.stepSize = Math.max(1, Math.round(ceil / 10));
        chartConversations.update('none');

        const subjectLabels = subjects ? Object.keys(subjects) : [];
        const subjectData   = subjects ? Object.values(subjects) : [];
        chartSubjects.data.labels = subjectLabels;
        chartSubjects.data.datasets[0].data = subjectData;
        chartSubjects.update('none');
        return;
    }

    if (chartConversations) { chartConversations.destroy(); chartConversations = null; }
    if (chartSubjects) { chartSubjects.destroy(); chartSubjects = null; }

    const tickColor   = cssVar('--text-secondary');
    const gridColor   = cssVar('--border-color');
    const legendColor = cssVar('--text-primary');

    const ctx1 = document.getElementById('chart-conversations').getContext('2d');
    chartConversations = new Chart(ctx1, {
        type: 'line',
        data: {
            labels: days,
            datasets: [{
                label: 'Mensagens',
                data: msgCounts || [],
                borderColor: '#AF1411',
                backgroundColor: 'rgba(175,20,17,0.08)',
                borderWidth: 3,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#AF1411',
                pointBorderColor: '#fff',
                pointRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { color: gridColor }, ticks: { color: tickColor } },
                y: (() => {
                    const maxIn = Math.max(0, ...(msgCounts || [0]));
                    const ceil  = niceCeiling(maxIn);
                    return {
                        grid: { color: gridColor },
                        ticks: {
                            color: tickColor,
                            stepSize: Math.max(1, Math.round(ceil / 10)),
                            precision: 0,
                            callback: (v) => Number.isInteger(v) ? v : null
                        },
                        beginAtZero: true,
                        min: 0,
                        max: ceil
                    };
                })()
            }
        }
    });

    const subjectEntries = subjects ? Object.entries(subjects).filter(([k]) => k !== 'Outras dúvidas') : [];
    const subjectLabels  = subjectEntries.map(([k]) => k);
    const subjectData    = subjectEntries.map(([, v]) => v);
    const isDark = document.documentElement.classList.contains('dark');
    const pieColors = ['#AF1411','#D32F2F','#F44336','#E57373','#FFCDD2', isDark ? '#555555' : '#9CA3AF'];

    const ctx2 = document.getElementById('chart-subjects').getContext('2d');
    chartSubjects = new Chart(ctx2, {
        type: 'doughnut',
        data: {
            labels: subjectLabels,
            datasets: [{ data: subjectData, backgroundColor: pieColors, borderWidth: 0 }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        color: legendColor,
                        font: { family: 'Quicksand', size: 12 },
                        padding: 15
                    }
                }
            },
            cutout: '70%'
        }
    });
}

// 6. CONVERSAS — dados reais do Supabase
let allContacts = [];

async function loadConversationsTab() {
    await loadContactsList();
}

async function loadContactsList() {
    const listContainer = document.getElementById('contacts-list-container');
    if (!listContainer) return;
    listContainer.innerHTML = '<div class="loading-spinner">Carregando contatos...</div>';

    // Try backend API first (reads from SQLite — always reliable)
    if (adminToken && BACKEND_URL !== undefined) {
        try {
            const res = await fetch(`${BACKEND_URL}/api/admin/contacts`, {
                headers: { 'Authorization': `Bearer ${adminToken}` }
            });
            if (res.ok) {
                const { contacts } = await res.json();
                allContacts = contacts || [];
                renderContactsList(allContacts);
                return;
            }
        } catch (e) {
            console.warn('Backend API indisponível, tentando Supabase...', e);
        }
    }

    // Fallback: Supabase
    if (!_sb) {
        listContainer.innerHTML = '<div class="no-records">Nenhum contato ainda.<br>Configure o Supabase ou inicie o servidor backend para ver as conversas.</div>';
        return;
    }
    try {
        const { data: contacts, error } = await _sb.from('contacts').select('*');
        if (error) throw error;
        allContacts = contacts || [];
        renderContactsList(allContacts);
    } catch (err) {
        console.error('Erro ao carregar contatos:', err);
        listContainer.innerHTML = '<div class="error-msg">Erro ao carregar contatos.</div>';
    }
}

function renderContactsList(contacts) {
    const listContainer = document.getElementById('contacts-list-container');
    if (!listContainer) return;

    if (!contacts || contacts.length === 0) {
        listContainer.innerHTML = '<div class="no-records">Nenhum contato ainda.<br>As conversas aparecerão aqui quando chegarem pelo WhatsApp.</div>';
        return;
    }

    listContainer.innerHTML = '';
    contacts.forEach(contact => {
        const item = document.createElement('div');
        item.className = `contact-item ${contact.wa_id === activeContactId ? 'active' : ''}`;
        item.setAttribute('data-id', contact.wa_id);

        const displayName = contact.name || contact.wa_id;
        const initials = displayName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        const botBadge = contact.bot_paused
            ? '<span class="bot-badge-paused"><i class="fa-solid fa-headset"></i> Humano</span>'
            : '<span class="bot-badge-active"><i class="fa-solid fa-robot"></i> Bot Ativo</span>';

        item.innerHTML = `
            <div class="contact-avatar">${initials}</div>
            <div class="contact-details">
                <div class="contact-header"><h4>${displayName}</h4></div>
                <div class="contact-meta"><p>${contact.phone || contact.wa_id}</p>${botBadge}</div>
            </div>`;

        item.addEventListener('click', () => {
            document.querySelectorAll('.contact-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            activeContactId = contact.wa_id;
            loadActiveChat(contact);
        });
        listContainer.appendChild(item);
    });
}

function filterContacts(e) {
    const query = e.target.value.toLowerCase();
    renderContactsList(allContacts.filter(c =>
        (c.wa_id && c.wa_id.toLowerCase().includes(query)) ||
        (c.name && c.name.toLowerCase().includes(query))
    ));
}

async function loadActiveChat(contact) {
    const headerInfo = document.getElementById('chat-header-info');
    const messagesBox = document.getElementById('chat-messages-box');
    if (!headerInfo || !messagesBox) return;

    headerInfo.style.display = 'flex';
    const displayName = contact.name || contact.wa_id;
    document.getElementById('chat-user-name').textContent = displayName;
    document.getElementById('chat-user-phone').textContent = contact.phone || contact.wa_id;
    document.getElementById('chat-user-avatar').textContent = displayName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    updateBotButtonUI(contact.bot_paused);

    messagesBox.innerHTML = '<div class="loading-spinner">Carregando histórico...</div>';

    let messages = null;

    // Try backend API first (SQLite — most up-to-date)
    if (adminToken && BACKEND_URL !== undefined) {
        try {
            const res = await fetch(`${BACKEND_URL}/api/admin/contacts/${encodeURIComponent(contact.wa_id)}/messages`, {
                headers: { 'Authorization': `Bearer ${adminToken}` }
            });
            if (res.ok) {
                const data = await res.json();
                messages = data.messages || [];
            }
        } catch (e) {
            console.warn('Backend API indisponível para mensagens, tentando Supabase...', e);
        }
    }

    // Fallback: Supabase
    if (messages === null && _sb) {
        try {
            const { data, error } = await _sb
                .from('messages').select('*').eq('wa_id', contact.wa_id).order('created_at', { ascending: true });
            if (!error) messages = data || [];
        } catch (e) {
            console.error('Erro ao carregar mensagens do Supabase:', e);
        }
    }

    messagesBox.innerHTML = '';
    if (!messages || messages.length === 0) {
        messagesBox.innerHTML = '<div class="chat-placeholder"><i class="fa-solid fa-comments"></i><h3>Nenhuma mensagem</h3><p>Este contato ainda não enviou mensagens.</p></div>';
        return;
    }

    messages.forEach(msg => {
        if (msg.role === 'tool' || msg.role === 'system') return; // skip internal messages
        const el = document.createElement('div');
        el.className = `chat-bubble-container ${msg.role === 'user' ? 'user' : 'bot'}`;
        const ts = parseInt(msg.created_at) || Date.parse(msg.created_at);
        const time = isNaN(ts) ? '--:--' : new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        el.innerHTML = `<div class="chat-bubble"><p class="bubble-text">${msg.content || ''}</p><span class="bubble-time">${time}</span></div>`;
        messagesBox.appendChild(el);
    });
    messagesBox.scrollTop = messagesBox.scrollHeight;
}

// Funções de sincronização periódica (tempo real silencioso) para o Painel Admin
async function refreshContactsList() {
    let fetchedContacts = [];

    // Tenta primeiro obter os contatos da API do backend
    if (adminToken && BACKEND_URL !== undefined) {
        try {
            const res = await fetch(`${BACKEND_URL}/api/admin/contacts`, {
                headers: { 'Authorization': `Bearer ${adminToken}` }
            });
            if (res.ok) {
                const { contacts } = await res.json();
                fetchedContacts = contacts || [];
            }
        } catch (e) {
            // Falha silenciosa em background
        }
    }

    // Fallback: Supabase
    if (fetchedContacts.length === 0 && _sb) {
        try {
            const { data: contacts, error } = await _sb.from('contacts').select('*');
            if (!error) {
                fetchedContacts = contacts || [];
            }
        } catch (err) {
            // Falha silenciosa em background
        }
    }

    if (fetchedContacts.length > 0) {
        // Ordena contatos por data de visualização/interação mais recente
        fetchedContacts.sort((a, b) => (b.last_seen_at || 0) - (a.last_seen_at || 0));

        allContacts = fetchedContacts;

        // Mantém a UI do botão de controle do bot atualizada caso o status mude
        const activeContact = allContacts.find(c => c.wa_id === activeContactId);
        if (activeContact) {
            updateBotButtonUI(activeContact.bot_paused);
        }

        // Renderiza a lista respeitando a busca atual do usuário
        const searchInput = document.getElementById('contact-search');
        const query = searchInput ? searchInput.value.toLowerCase() : '';
        if (query) {
            renderContactsListSilently(allContacts.filter(c =>
                (c.wa_id && c.wa_id.toLowerCase().includes(query)) ||
                (c.name && c.name.toLowerCase().includes(query))
            ));
        } else {
            renderContactsListSilently(allContacts);
        }
    }
}

function renderContactsListSilently(contacts) {
    const listContainer = document.getElementById('contacts-list-container');
    if (!listContainer) return;

    if (!contacts || contacts.length === 0) {
        listContainer.innerHTML = '<div class="no-records">Nenhum contato ainda.<br>As conversas aparecerão aqui quando chegarem pelo WhatsApp.</div>';
        return;
    }

    listContainer.innerHTML = '';
    contacts.forEach(contact => {
        const item = document.createElement('div');
        item.className = `contact-item ${contact.wa_id === activeContactId ? 'active' : ''}`;
        item.setAttribute('data-id', contact.wa_id);

        const displayName = contact.name || contact.wa_id;
        const initials = displayName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        const botBadge = contact.bot_paused
            ? '<span class="bot-badge-paused"><i class="fa-solid fa-headset"></i> Humano</span>'
            : '<span class="bot-badge-active"><i class="fa-solid fa-robot"></i> Bot Ativo</span>';

        item.innerHTML = `
            <div class="contact-avatar">${initials}</div>
            <div class="contact-details">
                <div class="contact-header"><h4>${displayName}</h4></div>
                <div class="contact-meta"><p>${contact.phone || contact.wa_id}</p>${botBadge}</div>
            </div>`;

        item.addEventListener('click', () => {
            document.querySelectorAll('.contact-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            activeContactId = contact.wa_id;
            loadActiveChat(contact);
        });
        listContainer.appendChild(item);
    });
}

async function refreshActiveChat(contact) {
    const messagesBox = document.getElementById('chat-messages-box');
    if (!messagesBox) return;

    let messages = null;

    // Tenta primeiro obter as mensagens da API do backend (SQLite)
    if (adminToken && BACKEND_URL !== undefined) {
        try {
            const res = await fetch(`${BACKEND_URL}/api/admin/contacts/${encodeURIComponent(contact.wa_id)}/messages`, {
                headers: { 'Authorization': `Bearer ${adminToken}` }
            });
            if (res.ok) {
                const data = await res.json();
                messages = data.messages || [];
            }
        } catch (e) {
            // Falha silenciosa em background
        }
    }

    // Fallback: Supabase
    if (messages === null && _sb) {
        try {
            const { data, error } = await _sb
                .from('messages').select('*').eq('wa_id', contact.wa_id).order('created_at', { ascending: true });
            if (!error) messages = data || [];
        } catch (e) {
            // Falha silenciosa em background
        }
    }

    if (messages !== null) {
        const visibleMessages = messages.filter(msg => msg.role !== 'tool' && msg.role !== 'system');
        const currentBubbles = messagesBox.querySelectorAll('.chat-bubble-container');
        
        // Só atualiza o DOM e move a rolagem se houver novas mensagens para evitar flickers ou interrupções na rolagem do usuário
        if (visibleMessages.length !== currentBubbles.length) {
            messagesBox.innerHTML = '';
            visibleMessages.forEach(msg => {
                const el = document.createElement('div');
                el.className = `chat-bubble-container ${msg.role === 'user' ? 'user' : 'bot'}`;
                const ts = parseInt(msg.created_at) || Date.parse(msg.created_at);
                const time = isNaN(ts) ? '--:--' : new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                el.innerHTML = `<div class="chat-bubble"><p class="bubble-text">${msg.content || ''}</p><span class="bubble-time">${time}</span></div>`;
                messagesBox.appendChild(el);
            });
            messagesBox.scrollTop = messagesBox.scrollHeight;
        }
    }
}

function updateBotButtonUI(botPaused) {
    const btn = document.getElementById('btn-toggle-bot');
    if (!btn) return;
    if (botPaused) {
        btn.className = 'btn btn-resume';
        btn.querySelector('i').className = 'fa-solid fa-play';
        btn.querySelector('span').textContent = 'Retomar Bot';
    } else {
        btn.className = 'btn btn-pause';
        btn.querySelector('i').className = 'fa-solid fa-pause';
        btn.querySelector('span').textContent = 'Pausar Bot';
    }
}

async function toggleBotStatus() {
    if (!activeContactId) return;
    if (!_sb) { alert('Conecte ao Supabase primeiro.'); return; }

    const contact = allContacts.find(c => c.wa_id === activeContactId);
    if (!contact) return;

    const nextState = !contact.bot_paused;
    try {
        const res = await fetch(`${BACKEND_URL}/api/admin/contacts/${encodeURIComponent(activeContactId)}/pause`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
            body: JSON.stringify({ paused: nextState })
        });
        if (!res.ok) {
            const { error } = await _sb.from('contacts').update({ bot_paused: nextState }).eq('wa_id', activeContactId);
            if (error) throw error;
        }
        contact.bot_paused = nextState;
        updateBotButtonUI(nextState);
        renderContactsList(allContacts);
    } catch (err) {
        console.error('Erro ao alterar status do bot:', err);
        alert(`Não foi possível alterar o status do bot.\n${err.message}`);
    }
}

// 7. BANCO DE DADOS — apenas dados reais
let currentTableData = [];

// Carrega lista de unidades do Supabase (cache em memória).
async function loadUnitsCache(force = false) {
    if (!_sb) return cachedUnits;
    if (cachedUnits.length > 0 && !force) return cachedUnits;
    try {
        const { data, error } = await _sb.from('school_units').select('id, name').order('name');
        if (error) throw error;
        cachedUnits = data || [];
    } catch (e) {
        console.warn('Não foi possível carregar unidades:', e);
    }
    return cachedUnits;
}

// Renderiza os chips do filtro de unidade no topo da aba Produtos.
// Sempre tem 1 unidade selecionada — não existe "todas".
async function renderUnitFilterChips() {
    await loadUnitsCache();
    const container = document.getElementById('unit-filter-chips');
    if (!container) return;
    container.innerHTML = '';

    // Pré-seleciona a primeira unidade se nenhuma estiver ativa ainda.
    if (!selectedUnitFilter && cachedUnits.length > 0) {
        selectedUnitFilter = cachedUnits[0].id;
    }

    cachedUnits.forEach(u => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'unit-chip' + (selectedUnitFilter === u.id ? ' active' : '');
        btn.textContent = u.name;
        btn.addEventListener('click', () => {
            selectedUnitFilter = u.id;
            renderUnitFilterChips();
            loadDatabaseTable();
        });
        container.appendChild(btn);
    });
}

async function loadDatabaseTable() {
    const tableBody = document.getElementById('db-data-body');
    const tableHead = document.querySelector('#db-data-table thead');
    if (!tableBody || !tableHead) return;

    // Mostra/esconde barra de filtro de unidade (só para school_products)
    const filterBar = document.getElementById('unit-filter-bar');
    if (filterBar) {
        if (activeTable === 'school_products') {
            filterBar.style.display = 'flex';
            await renderUnitFilterChips();
        } else {
            filterBar.style.display = 'none';
        }
    }

    const columns = TABLE_SCHEMAS[activeTable];
    let headHtml = '<tr>';
    columns.forEach(col => { headHtml += `<th>${col.label}</th>`; });
    headHtml += '<th class="action-column">Ações</th></tr>';
    tableHead.innerHTML = headHtml;

    if (!_sb) {
        tableBody.innerHTML = `<tr><td colspan="${columns.length + 1}"><div class="offline-banner"><i class="fa-solid fa-plug-circle-xmark"></i><h3>Sem conexão ao Supabase</h3><p>Vá em <strong>Configurações</strong> e insira suas credenciais.</p></div></td></tr>`;
        return;
    }

    tableBody.innerHTML = `<tr><td colspan="${columns.length + 1}" class="loading-spinner">Carregando...</td></tr>`;

    try {
        let query = _sb.from(activeTable).select('*');
        // Filtro de unidade quando aplicável
        if (activeTable === 'school_products' && selectedUnitFilter) {
            query = query.eq('unit_id', selectedUnitFilter);
        }
        const { data, error } = await query;
        if (error) throw error;

        currentTableData = data || [];
        if (currentTableData.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="${columns.length + 1}" class="no-records">Nenhum registro encontrado${selectedUnitFilter ? ' para esta unidade' : ''}.</td></tr>`;
            return;
        }

        // Map id → nome de unidade para resolver unit_id na renderização
        const unitNameById = {};
        cachedUnits.forEach(u => { unitNameById[u.id] = u.name; });

        tableBody.innerHTML = '';
        currentTableData.forEach(row => {
            const tr = document.createElement('tr');
            let html = '';
            columns.forEach(col => {
                let val = row[col.name];
                if (val === null || val === undefined) val = '<span class="null-val">-</span>';
                else if (col.name === 'unit_id') val = unitNameById[val] || `<code>${val}</code>`;
                else if (col.type === 'number') val = `R$ ${parseFloat(val).toFixed(2)}`;
                else if (col.name === 'image_url' && val && val.startsWith('http')) val = `<a href="${val}" target="_blank" class="db-img-preview-link"><i class="fa-solid fa-image"></i> Ver Foto</a>`;
                else if (typeof val === 'string' && val.length > 60) val = val.substring(0, 60) + '...';
                html += `<td>${val}</td>`;
            });
            html += `<td class="action-column">
                <button class="btn btn-action-edit" onclick="openEditModal('${row.id}')" title="Editar"><i class="fa-solid fa-pen-to-square"></i></button>
                <button class="btn btn-action-delete" onclick="deleteRow('${row.id}')" title="Excluir"><i class="fa-solid fa-trash"></i></button>
            </td>`;
            tr.innerHTML = html;
            tableBody.appendChild(tr);
        });
    } catch (err) {
        console.error('Erro ao ler tabela:', err);
        const msg = err.message || String(err);
        const isTableMissing  = /relation .* does not exist|table .* does not exist/i.test(msg);
        const isColumnMissing = /column .* does not exist|could not find the .* column/i.test(msg);
        let friendlyMsg;
        if (isTableMissing) {
            friendlyMsg = `<div class="offline-banner"><i class="fa-solid fa-table-cells-large"></i><h3>Tabela não existe no Supabase</h3><p>A tabela <strong>${activeTable}</strong> não existe.<br>Execute o script <strong>admin-panel/supabase-reset.sql</strong> no SQL Editor do Supabase.</p></div>`;
        } else if (isColumnMissing) {
            friendlyMsg = `<div class="offline-banner"><i class="fa-solid fa-table-cells-large"></i><h3>Coluna faltando no Supabase</h3><p>A tabela <strong>${activeTable}</strong> existe mas está sem uma coluna que o painel precisa.<br><br><strong>Erro:</strong> <code>${msg}</code><br><br>Cole o trecho abaixo no SQL Editor do Supabase:<br><pre style="background:#000;color:#0f0;padding:10px;border-radius:6px;text-align:left;font-size:12px;overflow:auto;">ALTER TABLE school_products ADD COLUMN IF NOT EXISTS unit_id TEXT;\nCREATE INDEX IF NOT EXISTS idx_school_products_unit ON school_products (unit_id);</pre></p></div>`;
        } else {
            friendlyMsg = `<div class="offline-banner"><i class="fa-solid fa-circle-exclamation"></i><h3>Erro ao carregar dados</h3><p>${msg}</p></div>`;
        }
        tableBody.innerHTML = `<tr><td colspan="${columns.length + 1}">${friendlyMsg}</td></tr>`;
    }
}

async function openAddModal() {
    if (!_sb) { alert('Conecte ao Supabase nas Configurações para adicionar registros.'); return; }
    editRecordId = null;
    document.getElementById('modal-title').textContent = 'Adicionar Novo Registro';
    await buildModalFields();
    document.getElementById('db-modal').style.display = 'flex';
}

window.openEditModal = async function(id) {
    editRecordId = id;
    document.getElementById('modal-title').textContent = 'Editar Registro';
    await buildModalFields();
    const row = currentTableData.find(r => r.id.toString() === id.toString());
    if (row) {
        TABLE_SCHEMAS[activeTable].forEach(col => {
            const input = document.getElementById(`form-field-${col.name}`);
            if (input && col.type !== 'file') input.value = row[col.name] !== null ? row[col.name] : '';
            if (col.type === 'file' && row[col.name]) {
                const helper = document.getElementById(`helper-${col.name}`);
                if (helper) helper.innerHTML = `<span class="img-curr-helper">Imagem atual: <a href="${row[col.name]}" target="_blank">Ver</a></span>`;
            }
        });
    }
    document.getElementById('db-modal').style.display = 'flex';
};

function closeModal() {
    document.getElementById('db-modal').style.display = 'none';
    document.getElementById('db-modal-form').reset();
}

async function buildModalFields() {
    const container = document.getElementById('modal-fields-container');
    if (!container) return;
    container.innerHTML = '';

    // Garante que unidades estão carregadas antes de montar selects dinâmicos
    if (TABLE_SCHEMAS[activeTable].some(c => c.dynamicOptions === 'school_units')) {
        await loadUnitsCache();
    }

    TABLE_SCHEMAS[activeTable].forEach(col => {
        if (editRecordId === null && col.hiddenOnAdd) return;
        const group = document.createElement('div');
        group.className = 'form-group';
        const label = document.createElement('label');
        label.setAttribute('for', `form-field-${col.name}`);
        label.textContent = col.label;
        group.appendChild(label);

        let input;
        if (col.type === 'textarea') { input = document.createElement('textarea'); input.rows = 3; }
        else if (col.type === 'select') {
            input = document.createElement('select');
            // Opções dinâmicas (ex: lista de unidades)
            if (col.dynamicOptions === 'school_units') {
                const placeholder = document.createElement('option');
                placeholder.value = '';
                placeholder.textContent = '— Selecione a unidade —';
                input.appendChild(placeholder);
                cachedUnits.forEach(u => {
                    const o = document.createElement('option');
                    o.value = u.id;
                    o.textContent = u.name;
                    input.appendChild(o);
                });
                // Pré-seleciona se há filtro ativo
                if (editRecordId === null && selectedUnitFilter) {
                    input.value = selectedUnitFilter;
                }
            } else {
                (col.options || []).forEach(opt => { const o = document.createElement('option'); o.value = opt; o.textContent = opt; input.appendChild(o); });
            }
        } else { input = document.createElement('input'); input.type = col.type; }

        input.id = `form-field-${col.name}`;
        input.name = col.name;
        if (col.required && col.type !== 'file') input.required = true;
        if (editRecordId !== null && col.readonlyOnEdit) { input.readOnly = true; input.classList.add('readonly-field'); }

        if (col.type === 'file') {
            const wrapper = document.createElement('div');
            wrapper.className = 'file-input-wrapper';
            wrapper.appendChild(input);
            const helper = document.createElement('div');
            helper.id = `helper-${col.name}`;
            helper.className = 'file-helper-text';
            helper.textContent = 'Selecione uma foto para salvar no Storage do Supabase';
            wrapper.appendChild(helper);
            group.appendChild(wrapper);
        } else { group.appendChild(input); }
        container.appendChild(group);
    });
}

async function handleModalSubmit(e) {
    e.preventDefault();
    if (!_sb) { alert('Conecte ao Supabase nas Configurações.'); return; }

    const saveBtn = document.getElementById('btn-save-modal');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Salvando...';

    try {
        const formData = new FormData(e.target);
        const record = {};
        let fileToUpload = null, fileFieldName = null;

        TABLE_SCHEMAS[activeTable].forEach(col => {
            if (col.type === 'file') {
                const fi = document.getElementById(`form-field-${col.name}`);
                if (fi && fi.files && fi.files[0]) { fileToUpload = fi.files[0]; fileFieldName = col.name; }
            } else {
                const val = formData.get(col.name);
                if (val !== null) record[col.name] = col.type === 'number' ? parseFloat(val) : val;
            }
        });

        if (fileToUpload) {
            const fileName = `${Date.now()}_${fileToUpload.name.replace(/\s+/g, '_')}`;
            const { error: uploadErr } = await _sb.storage.from('school-media').upload(fileName, fileToUpload, { cacheControl: '3600', upsert: true });
            if (uploadErr) throw new Error(uploadErr.message.includes('not found') ? "Bucket 'school-media' não existe no Supabase Storage." : uploadErr.message);
            const { data: urlData } = _sb.storage.from('school-media').getPublicUrl(fileName);
            record[fileFieldName] = urlData.publicUrl;
        }

        if (editRecordId !== null) {
            const { error } = await _sb.from(activeTable).update(record).eq('id', editRecordId);
            if (error) throw error;
        } else {
            const { error } = await _sb.from(activeTable).insert([record]);
            if (error) throw error;
        }

        closeModal();
        await loadDatabaseTable();
    } catch (err) {
        console.error('Erro ao salvar:', err);
        alert(`Erro ao salvar: ${err.message || err}`);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Salvar Registro';
    }
}

window.deleteRow = async function(id) {
    if (!_sb) { alert('Conecte ao Supabase nas Configurações.'); return; }
    if (!confirm('Excluir este registro permanentemente?')) return;
    try {
        const { error } = await _sb.from(activeTable).delete().eq('id', id);
        if (error) throw error;
        await loadDatabaseTable();
    } catch (err) {
        console.error('Erro ao deletar:', err);
        alert('Não foi possível excluir. Pode estar sendo referenciado por outras tabelas.');
    }
};

// 8. IMPORTAÇÃO CSV
let parsedCSVRows = [];

const CSV_EXAMPLES = {
    // school_products é gerado dinamicamente em downloadCSVExample() para
    // injetar os unit_id reais das unidades cadastradas no Supabase.
    school_products: null,
    school_levels: [
        ['id', 'nivel', 'descricao', 'preco_mensal', 'preco_semestral', 'preco_anual', 'incluso'],
        ['ef1', 'Ensino Fundamental 1', '1° ao 5° ano', '1200', '7200', '14400', '"Material didático,Acompanhamento pedagógico individual,Plataforma digital"'],
        ['ef2', 'Ensino Fundamental 2', '6° ao 9° ano', '1400', '8400', '16800', '"Material didático,Acompanhamento pedagógico individual,Plataforma digital"'],
        ['em', 'Ensino Médio', '1° e 2° série', '1700', '10200', '20400', '"Material didático,Simulados mensais,Plataforma digital"'],
        ['pre-enem', 'Pré-Enem (Eixo)', 'Terceirão e Cursinho', '1900', '11400', '22800', '"Material didático especializado para Enem,Acompanhamento pedagógico,Redação semanal"']
    ],
    school_contacts: [
        ['name', 'role_title', 'phone_number'],
        ['Secretaria Geral', 'Matrículas, documentos e informações gerais', '5511999998888'],
        ['Coordenação Pedagógica', 'Dúvidas sobre notas, faltas e turmas', '5511888887777'],
        ['Financeiro', 'Boletos, mensalidades e negociações', '5511777776666']
    ],
    school_materials: [
        ['nivel', 'subject', 'title', 'download_url', 'image_url'],
        ['Ensino Fundamental', 'Matemática', 'Apostila de Álgebra — 1° Bimestre', 'https://exemplo.com/matematica-algebra.pdf', ''],
        ['Ensino Fundamental', 'Português', 'Gramática e Redação — Vol. 1', 'https://exemplo.com/portugues-vol1.pdf', ''],
        ['Ensino Médio', 'Física', 'Mecânica Clássica — 2° Ano', 'https://exemplo.com/fisica-mecanica.pdf', ''],
        ['Ensino Médio', 'Química', 'Química Orgânica — Apostila Completa', 'https://exemplo.com/quimica-organica.pdf', '']
    ],
    school_units: [
        ['id', 'name', 'address', 'phone', 'whatsapp', 'hours', 'levels', 'infrastructure', 'activities', 'capacity'],
        ['sede', 'Sede (Batista Campos)', 'Rua dos Mundurucus, 1412', '(91) 3222-0000', '(91) 98888-0000', 'Seg-Sex: 07h-19h / Sáb: 08h-12h', 'Infantil ao Pré-Vestibular (Eixo) e Militares', '"Lousas digitais,ginásio,laboratórios,auditório"', '"Robótica,Educação Financeira,Esportes"', '1.500 alunos'],
        ['augusto-montenegro', 'Augusto Montenegro', 'Rod. Augusto Montenegro, 130', '(91) 3333-0000', '(91) 99999-0000', 'Seg-Sex: 07h-18h / Sáb: 08h-12h', 'Educação Infantil ao Ensino Médio', '"Parquinho,quadras auxiliares,lab de informática"', '"Robótica,Dança,Artes"', '1.200 alunos'],
        ['cidade-nova', 'Cidade Nova', 'Av. SN-3, 3277 (Ananindeua)', '(91) 3444-0000', '(91) 97777-0000', 'Seg-Sex: 07h-18h / Sáb: 08h-12h', 'Educação Infantil ao Ensino Médio', '"Brinquedoteca,quadra coberta,lab prático"', '"Música,Futsal,Robótica"', '1.000 alunos']
    ]
};

async function downloadCSVExample() {
    let rows = CSV_EXAMPLES[activeTable];

    // school_products: gera dinamicamente usando as unidades reais do Supabase
    // (assim os unit_id no exemplo são os mesmos IDs que você tem cadastrados).
    if (activeTable === 'school_products') {
        await loadUnitsCache();
        if (cachedUnits.length === 0) {
            alert('Cadastre primeiro as Unidades antes de importar Produtos.');
            return;
        }
        const header = ['unit_id', 'category', 'name', 'description', 'monthly_fee', 'material_fee', 'schedule', 'image_url'];
        const sampleProducts = [
            { category: 'Educação Infantil',                  name: 'Maternal',            description: 'Crianças de 2 a 3 anos. Estimulação sensorial.', monthly_fee: '1200', material_fee: '300', schedule: 'Seg-Sex: 07h30-11h30' },
            { category: 'Educação Infantil',                  name: 'Jardim I',            description: 'Crianças de 3 a 4 anos.',                          monthly_fee: '1250', material_fee: '320', schedule: 'Seg-Sex: 07h30-11h30' },
            { category: 'Ensino Fundamental — Anos Iniciais', name: '1º Ano',              description: 'Alfabetização e letramento.',                       monthly_fee: '1300', material_fee: '380', schedule: 'Seg-Sex: 07h-12h' },
            { category: 'Ensino Médio',                       name: '1ª Série EM',         description: 'Sistema Poliedro. Simulados mensais.',              monthly_fee: '1700', material_fee: '500', schedule: 'Seg-Sex: 07h-12h30' },
            { category: 'Pré-Vestibular (Eixo)',              name: 'Eixo Pré-Vestibular', description: 'Preparatório intensivo ENEM/vestibular.',           monthly_fee: '1900', material_fee: '550', schedule: 'Seg-Sex: 07h-17h' },
            { category: 'Escolinhas de Esporte',              name: 'Futsal',              description: 'Iniciação esportiva.',                              monthly_fee: '350',  material_fee: '0',   schedule: 'Ter/Qui: 14h-15h30' },
            { category: 'Cursos Específicos',                 name: 'Inglês',              description: 'Do básico ao avançado.',                            monthly_fee: '280',  material_fee: '120', schedule: 'Seg/Qua: 12h-13h' }
        ];
        rows = [header];
        // Pega APENAS a unidade selecionada (o filtro ativo) — exemplo focado.
        // Se quiser todas, escolha "Sede" no filtro depois de cadastrar e
        // duplicar pelo painel.
        const unitForExample = cachedUnits.find(u => u.id === selectedUnitFilter) || cachedUnits[0];
        sampleProducts.forEach(p => {
            rows.push([unitForExample.id, p.category, p.name, p.description, p.monthly_fee, p.material_fee, p.schedule, '']);
        });
    }

    if (!rows) return;

    // Escapa campos com vírgula/aspas/quebras envolvendo em "..."
    const escapeCell = (cell) => {
        const s = String(cell ?? '');
        if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
        return s;
    };
    const csv = rows.map(row => row.map(escapeCell).join(',')).join('\r\n');
    const tableLabel = { school_products: 'produtos', school_levels: 'mensalidades', school_contacts: 'contatos', school_materials: 'materiais', school_units: 'unidades' }[activeTable] || activeTable;

    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `modelo_${tableLabel}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

function openCSVModal() {
    if (!_sb) { alert('Conecte ao Supabase nas Configurações para importar dados.'); return; }
    parsedCSVRows = [];
    const tableLabel = { school_products: 'Produtos & Turmas', school_levels: 'Mensalidades (Níveis)', school_contacts: 'Contatos do Colégio', school_materials: 'Materiais Escolares', school_units: 'Unidades / Campi' }[activeTable] || activeTable;
    document.getElementById('csv-modal-title').textContent = `Importar CSV — ${tableLabel}`;
    document.getElementById('csv-file-input').value = '';
    document.getElementById('csv-drop-label').textContent = 'Clique para selecionar ou arraste o arquivo CSV aqui';
    document.getElementById('csv-drop-zone').classList.remove('has-file', 'dragover');
    document.getElementById('csv-preview-section').style.display = 'none';
    document.getElementById('csv-errors').style.display = 'none';
    document.getElementById('btn-import-csv-confirm').disabled = true;
    document.getElementById('csv-modal').style.display = 'flex';
}

function closeCSVModal() {
    document.getElementById('csv-modal').style.display = 'none';
    parsedCSVRows = [];
}

function parseCSVText(text) {
    text = text.replace(/^﻿/, '');
    const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
    if (lines.length < 2) return { headers: [], rows: [], error: 'O CSV precisa ter ao menos uma linha de cabeçalho e uma linha de dados.' };

    const parseLine = (line) => {
        const result = [];
        let current = '', inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
                else inQuotes = !inQuotes;
            } else if (ch === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }
        result.push(current.trim());
        return result;
    };

    const headers = parseLine(lines[0]);
    const rows = lines.slice(1).map(line => {
        const vals = parseLine(line);
        const row = {};
        headers.forEach((h, i) => { row[h] = vals[i] !== undefined ? vals[i] : ''; });
        return row;
    });

    return { headers, rows };
}

function handleCSVFile(file) {
    if (!file) return;
    document.getElementById('csv-drop-label').textContent = `Arquivo selecionado: ${file.name}`;
    document.getElementById('csv-drop-zone').classList.add('has-file');

    const reader = new FileReader();
    reader.onload = (e) => {
        const errorsEl = document.getElementById('csv-errors');
        const { headers, rows, error } = parseCSVText(e.target.result);

        if (error) {
            errorsEl.style.display = 'block';
            errorsEl.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${error}`;
            document.getElementById('csv-preview-section').style.display = 'none';
            document.getElementById('btn-import-csv-confirm').disabled = true;
            return;
        }

        const schema = TABLE_SCHEMAS[activeTable];
        const requiredCols = schema.filter(c => c.required && !c.hiddenOnAdd && !c.readonly).map(c => c.name);
        const missing = requiredCols.filter(h => !headers.includes(h));

        if (missing.length > 0) {
            errorsEl.style.display = 'block';
            errorsEl.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> Colunas obrigatórias ausentes no CSV: <strong>${missing.join(', ')}</strong>. Baixe o modelo para ver o formato correto.`;
            document.getElementById('csv-preview-section').style.display = 'none';
            document.getElementById('btn-import-csv-confirm').disabled = true;
            return;
        }

        errorsEl.style.display = 'none';
        parsedCSVRows = rows;

        const head = document.getElementById('csv-preview-head');
        const body = document.getElementById('csv-preview-body');
        document.getElementById('csv-row-count').textContent = `${rows.length} linha(s) encontrada(s)`;

        head.innerHTML = '<tr>' + headers.map(h => `<th>${h}</th>`).join('') + '</tr>';
        const previewRows = rows.slice(0, 5);
        body.innerHTML = previewRows.map(row =>
            '<tr>' + headers.map(h => `<td>${row[h] || '<span class="null-val">—</span>'}</td>`).join('') + '</tr>'
        ).join('');
        if (rows.length > 5) {
            body.innerHTML += `<tr><td colspan="${headers.length}" style="text-align:center;color:var(--text-muted);padding:10px">… e mais ${rows.length - 5} linha(s) não exibida(s)</td></tr>`;
        }

        document.getElementById('csv-preview-section').style.display = 'block';
        document.getElementById('btn-import-csv-confirm').disabled = false;
    };
    reader.readAsText(file, 'UTF-8');
}

async function importCSVData() {
    if (!_sb || parsedCSVRows.length === 0) return;

    const btn = document.getElementById('btn-import-csv-confirm');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Importando...';

    const schema = TABLE_SCHEMAS[activeTable];
    const importableCols = schema.filter(col => !col.hiddenOnAdd && !col.readonly && col.type !== 'file');

    try {
        const records = parsedCSVRows.map(row => {
            const record = {};
            importableCols.forEach(col => {
                const val = row[col.name];
                if (val !== undefined && val !== '') {
                    record[col.name] = col.type === 'number' ? parseFloat(val) : val;
                }
            });
            // for school_materials, image_url can come as plain text URL from CSV
            if (activeTable === 'school_materials' && row['image_url']) {
                record['image_url'] = row['image_url'];
            }
            return record;
        });

        const { error } = await _sb.from(activeTable).insert(records);
        if (error) throw error;

        closeCSVModal();
        await loadDatabaseTable();
        showToast(`${records.length} registro(s) importado(s) com sucesso!`, 'success');
    } catch (err) {
        console.error('Erro ao importar CSV:', err);
        const errorsEl = document.getElementById('csv-errors');
        errorsEl.style.display = 'block';
        errorsEl.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> Erro ao importar: ${err.message}`;
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-file-import"></i> Importar Dados';
    }
}

function showToast(message, type = 'success') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<i class="fa-solid ${type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation'}"></i> ${message}`;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 350); }, 3500);
}

// 9. CONFIGURAÇÕES
async function saveConfigForm(e) {
    e.preventDefault();
    const supabaseUrl = document.getElementById('input-supabase-url').value.trim();
    const supabaseAnonKey = document.getElementById('input-supabase-key').value.trim();
    
    const configPayload = {
        supabaseUrl,
        supabaseAnonKey,
        llmProvider: document.getElementById('select-llm-provider').value,
        anthropicApiKey: document.getElementById('input-anthropic-key').value.trim(),
        geminiApiKey: document.getElementById('input-gemini-key').value.trim(),
        telegramBotToken: document.getElementById('input-telegram-token').value.trim(),
        telegramChatId: document.getElementById('input-telegram-chat-id').value.trim(),
        whatsappPhoneNumberId: document.getElementById('input-whatsapp-phone-id').value.trim(),
        whatsappAccessToken: document.getElementById('input-whatsapp-token').value.trim(),
        whatsappVerifyToken: document.getElementById('input-whatsapp-verify-token').value.trim(),
        adminToken: document.getElementById('input-admin-token').value.trim(),
    };

    // Primeiro salva localmente no localStorage para conexão instantânea do painel
    if (supabaseUrl && supabaseAnonKey) {
        localStorage.setItem('SUPABASE_URL', supabaseUrl);
        localStorage.setItem('SUPABASE_ANON_KEY', supabaseAnonKey);
    }

    // Salva no .env local do servidor via chamada de API
    if (adminToken && BACKEND_URL !== undefined) {
        try {
            const res = await fetch(`${BACKEND_URL}/api/admin/config`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${adminToken}`
                },
                body: JSON.stringify(configPayload)
            });
            if (res.ok) {
                if (configPayload.adminToken) {
                    adminToken = configPayload.adminToken;
                }
                alert('Configurações salvas no servidor local com sucesso! O servidor está reiniciando para aplicar as mudanças...');
            } else {
                const errData = await res.json();
                alert(`Aviso: não foi possível salvar no .env do servidor: ${errData.error || 'Erro desconhecido'}`);
            }
        } catch (err) {
            console.warn('Erro ao salvar no servidor (.env):', err);
            alert('Aviso: Salvo no cache do navegador, mas o servidor backend não respondeu para salvar no .env.');
        }
    } else {
        alert('Configurações salvas localmente no navegador!');
    }

    // Reconecta
    initConnection().then(success => {
        if (success) {
            loadDashboardStats();
            document.querySelector('.sidebar-menu li[data-tab="dashboard"]').click();
        }
    });
}

function clearConfig() {
    if (!confirm('Limpar todas as credenciais salvas neste navegador?')) return;
    localStorage.removeItem('SUPABASE_URL');
    localStorage.removeItem('SUPABASE_ANON_KEY');
    document.getElementById('input-supabase-url').value = '';
    document.getElementById('input-supabase-key').value = '';
    document.getElementById('select-llm-provider').value = 'claude';
    document.getElementById('input-anthropic-key').value = '';
    document.getElementById('input-gemini-key').value = '';
    document.getElementById('input-telegram-token').value = '';
    document.getElementById('input-telegram-chat-id').value = '';
    document.getElementById('input-whatsapp-phone-id').value = '';
    document.getElementById('input-whatsapp-token').value = '';
    document.getElementById('input-whatsapp-verify-token').value = '';
    document.getElementById('input-admin-token').value = '';
    document.getElementById('supabase-status-text').textContent = 'Desconectado';
    document.querySelector('.status-indicator').className = 'status-indicator offline';
    _sb = null;
    alert('Credenciais removidas do cache do navegador.');
}

// =============================================================
// REALTIME - substitui polling 2s, zero invocacao Vercel
// =============================================================
let realtimeFallbackPolling = null;
let realtimeChannel = null;

function initRealtimeSubscriptions() {
    if (!_sb) {
        // Sem Supabase, ativa o polling de 30s como fallback
        activateFallbackPolling();
        return;
    }
    try {
        realtimeChannel = _sb.channel('admin-conversations')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' },
                (payload) => onRealtimeMessageInsert(payload.new))
            .on('postgres_changes', { event: '*', schema: 'public', table: 'contacts' },
                (payload) => onRealtimeContactChange(payload.new, payload.eventType))
            .subscribe((status) => {
                console.log('[Realtime] status:', status);
                if (status === 'SUBSCRIBED') {
                    deactivateFallbackPolling();
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                    activateFallbackPolling();
                }
            });

        // Failsafe: se em 10s nao virou SUBSCRIBED, liga fallback
        setTimeout(() => {
            if (!realtimeChannel || realtimeChannel.state !== 'joined') {
                console.warn('[Realtime] nao conectou em 10s, ativando polling fallback');
                activateFallbackPolling();
            }
        }, 10000);
    } catch (e) {
        console.error('[Realtime] erro ao subscrever:', e);
        activateFallbackPolling();
    }
}

function onRealtimeMessageInsert(msg) {
    if (currentTab === 'dashboard') {
        // Bump rapido nos contadores sem refetch completo
        const totalEl = document.getElementById('stat-total-messages');
        if (totalEl) {
            const n = parseInt(totalEl.textContent, 10) || 0;
            totalEl.textContent = n + 1;
        }
        // Atualiza grafico do dia em background
        loadDashboardStats();
    }
    if (currentTab === 'conversas') {
        // Se eh da conversa ativa, append direto
        if (msg.wa_id === activeContactId) {
            const activeContact = allContacts.find(c => c.wa_id === activeContactId);
            if (activeContact) {
                refreshActiveChat(activeContact);
            }
        }
        // Atualiza lista lateral
        refreshContactsList();
    }
}

function onRealtimeContactChange(contact, eventType) {
    if (currentTab === 'conversas') {
        refreshContactsList();
    }
    if (currentTab === 'dashboard') {
        loadDashboardStats();
    }
}

function activateFallbackPolling() {
    if (realtimeFallbackPolling) return;
    console.log('[Realtime] polling fallback ATIVO (30s)');
    realtimeFallbackPolling = setInterval(async () => {
        if (currentTab === 'conversas') {
            await refreshContactsList();
            if (activeContactId) {
                const c = allContacts.find(x => x.wa_id === activeContactId);
                if (c) await refreshActiveChat(c);
            }
        } else if (currentTab === 'dashboard') {
            await loadDashboardStats();
        }
    }, 30000);
}

function deactivateFallbackPolling() {
    if (!realtimeFallbackPolling) return;
    console.log('[Realtime] polling fallback DESATIVADO (Realtime SUBSCRIBED)');
    clearInterval(realtimeFallbackPolling);
    realtimeFallbackPolling = null;
}
