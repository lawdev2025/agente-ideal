// ==========================================================================
// LÓGICA DE GERENCIAMENTO DO PAINEL ADMIN - COLÉGIO IDEAL
// Conectado diretamente ao Supabase para operações em tempo real
// ==========================================================================

let supabase = null;
let currentTab = 'dashboard';
let activeTable = 'school_levels';
let activeContactId = null;
let chartConversations = null;
let chartSubjects = null;
let editRecordId = null; // Guarda ID do registro sendo editado

// Estruturas de Colunas das Tabelas
const TABLE_SCHEMAS = {
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
    ]
};

// 1. INICIALIZAÇÃO E EVENTOS
document.addEventListener('DOMContentLoaded', async () => {
    initTabs();
    initTheme();
    
    // Renderiza gráficos com dados demonstrativos logo de início
    // para garantir feedback visual WOW instantâneo e evitar telas pretas/vazias
    renderCharts();
    
    // Conecta em segundo plano de forma assíncrona
    initConnection().then(connected => {
        if (connected) {
            console.log("Supabase conectado com sucesso. Dados reais carregados.");
        } else {
            console.log("Painel rodando em Modo de Demonstração (Local / Offline).");
        }
    });

    // Eventos do Banco de Dados
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

    // Eventos de Configuração
    document.getElementById('config-form').addEventListener('submit', saveConfigForm);
    document.getElementById('btn-clear-config').addEventListener('click', clearConfig);

    // Busca de contatos no chat
    document.getElementById('contact-search').addEventListener('input', filterContacts);

    // Botão de alternar bot no chat
    document.getElementById('btn-toggle-bot').addEventListener('click', toggleBotStatus);
});

// Inicializar Abas
function initTabs() {
    document.querySelectorAll('.sidebar-menu li').forEach(item => {
        item.addEventListener('click', (e) => {
            document.querySelectorAll('.sidebar-menu li').forEach(i => i.classList.remove('active'));
            e.currentTarget.classList.add('active');
            
            currentTab = e.currentTarget.getAttribute('data-tab');
            document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
            document.getElementById(`tab-${currentTab}`).classList.add('active');

            // Atualiza Header
            const titles = {
                dashboard: { title: 'Dashboard', subtitle: 'Resumo estatístico do Agente Ideal e atendimento escolar' },
                conversas: { title: 'Central de Conversas', subtitle: 'Visualize os atendimentos do bot e gerencie o status em tempo real' },
                banco: { title: 'Banco de Dados', subtitle: 'Edite, adicione ou exclua informações da base de conhecimento da escola' },
                config: { title: 'Configurações de Conexão', subtitle: 'Gerencie as chaves de integração do Supabase' }
            };

            document.getElementById('tab-title').textContent = titles[currentTab].title;
            document.getElementById('tab-subtitle').textContent = titles[currentTab].subtitle;

            // Recarrega dados específicos da aba se necessário
            if (currentTab === 'dashboard') {
                loadDashboardStats();
            } else if (currentTab === 'conversas') {
                loadConversationsTab();
            } else if (currentTab === 'banco') {
                loadDatabaseTable();
            }
        });
    });
}

// 2. TEMA ESCURO / CLARO
function initTheme() {
    const toggleBtn = document.getElementById('theme-toggle-btn');
    if (!toggleBtn) return;

    toggleBtn.addEventListener('click', () => {
        const isDark = document.documentElement.classList.toggle('dark');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
        updateThemeIcon();
    });

    // Carrega do LocalStorage ou default dark
    const savedTheme = localStorage.getItem('theme') || 'dark';
    if (savedTheme === 'dark') {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }
    updateThemeIcon();
}

function updateThemeIcon() {
    const toggleBtn = document.getElementById('theme-toggle-btn');
    if (!toggleBtn) return;
    const isDark = document.documentElement.classList.contains('dark');
    const icon = toggleBtn.querySelector('i');
    const text = toggleBtn.querySelector('span');
    
    if (isDark) {
        icon.className = 'fa-solid fa-sun';
        text.textContent = 'Modo Claro';
    } else {
        icon.className = 'fa-solid fa-moon';
        text.textContent = 'Modo Escuro';
    }
}

// 3. CONEXÃO COM SUPABASE
async function initConnection() {
    const statusText = document.getElementById('supabase-status-text');
    const statusIndicator = document.querySelector('.status-indicator');

    // Tenta carregar do localStorage primeiro
    let url = localStorage.getItem('SUPABASE_URL');
    let key = localStorage.getItem('SUPABASE_ANON_KEY');

    // Se não tiver no localStorage, tenta buscar do backend (com fallback para localhost se aberto localmente)
    if (!url || !key) {
        const fetchUrls = ['/api/config', 'http://localhost:3000/api/config'];
        for (const fetchUrl of fetchUrls) {
            try {
                // Timeout de 1 segundo para buscar a config local, evitando travamento de CORS
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 1000);
                
                const res = await fetch(fetchUrl, { signal: controller.signal });
                clearTimeout(timeoutId);
                
                if (res.ok) {
                    const config = await res.json();
                    url = config.SUPABASE_URL;
                    key = config.SUPABASE_ANON_KEY;
                    
                    // Pré-preenche se encontrou no backend
                    if (url && key) {
                        localStorage.setItem('SUPABASE_URL', url);
                        localStorage.setItem('SUPABASE_ANON_KEY', key);
                        break; // Sucesso, sai do loop
                    }
                }
            } catch (e) {
                console.log(`Falha ao obter config de ${fetchUrl}. Tentando próximo...`);
            }
        }
    }

    // Preenche os campos do form de config
    if (url) document.getElementById('input-supabase-url').value = url;
    if (key) document.getElementById('input-supabase-key').value = key;

    if (!url || !key) {
        statusText.textContent = 'Supabase não configurado';
        statusIndicator.className = 'status-indicator offline';
        return false;
    }

    try {
        if (!window.supabase) {
            throw new Error("SDK do Supabase não foi carregada no navegador.");
        }
        
        // Inicializa o cliente do Supabase
        supabase = window.supabase.createClient(url, key);
        
        // Timeout de 3 segundos para a consulta de validação do Supabase, evitando promessas infinitas do navegador (file://)
        const checkConnectionPromise = supabase.from('school_contacts').select('count', { count: 'exact', head: true });
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout de conexão de 3 segundos atingido')), 3000)
        );

        const { error } = await Promise.race([checkConnectionPromise, timeoutPromise]);
        
        if (error) throw error;

        statusText.textContent = 'Conectado ao Supabase';
        statusIndicator.className = 'status-indicator online';
        
        // Atualiza Dashboard com dados reais
        if (currentTab === 'dashboard') {
            loadDashboardStats();
        }
        return true;
    } catch (err) {
        console.error('Erro de conexão Supabase:', err);
        statusText.textContent = 'Erro de Conexão (Modo Demo)';
        statusIndicator.className = 'status-indicator offline';
        return false;
    }
}

// 4. LOGICA DO DASHBOARD E GRÁFICOS
async function loadDashboardStats() {
    if (!supabase) return;

    try {
        // 1. Total de mensagens
        const { count: totalMessages } = await supabase
            .from('messages')
            .select('*', { count: 'exact', head: true });

        // 2. Contatos ativos
        const { count: activeContacts } = await supabase
            .from('contacts')
            .select('*', { count: 'exact', head: true });

        // 3. Encaminhados / Escalações
        const { count: escalations } = await supabase
            .from('contacts')
            .select('*', { count: 'exact', head: true })
            .eq('bot_paused', true);

        // 4. Erros do Telegram
        const { data: errorLogs } = await supabase
            .from('messages')
            .select('content')
            .ilike('content', '%erro%');
        const telegramErrors = errorLogs ? errorLogs.length : 0;

        // Atualiza Cards no DOM
        document.getElementById('stat-total-messages').textContent = totalMessages || 0;
        document.getElementById('stat-active-contacts').textContent = activeContacts || 0;
        document.getElementById('stat-escalations').textContent = escalations || 0;
        
        const errElement = document.getElementById('stat-telegram-errors');
        errElement.textContent = telegramErrors;
        const trendElement = document.getElementById('stat-telegram-trend');
        if (telegramErrors > 0) {
            trendElement.className = 'trend negative';
            trendElement.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${telegramErrors} erros reg.`;
        } else {
            trendElement.className = 'trend positive';
            trendElement.innerHTML = `<i class="fa-solid fa-circle-check"></i> Sem erros`;
        }

        // Gera os gráficos com dados reais do Supabase
        await renderCharts();
    } catch (e) {
        console.error('Erro ao buscar estatísticas do Dashboard:', e);
    }
}

async function renderCharts() {
    try {
        const days = [];
        const msgCounts = [];
        
        // Define dias padrão dos últimos 7 dias
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            days.push(d.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric' }));
            msgCounts.push(0);
        }

        const subjects = {
            'Mensalidades / Valores': 0,
            'Matrículas & Vagas': 0,
            'Materiais / Livros': 0,
            'Contatos / Secretaria': 0,
            'Horários & Grade': 0,
            'Outras dúvidas': 0
        };

        let hasRealData = false;

        // Tenta colher dados reais do Supabase se ele estiver ativo
        if (supabase) {
            try {
                // Colhe estatísticas de linha do tempo
                for (let i = 6; i >= 0; i--) {
                    const d = new Date();
                    d.setDate(d.getDate() - i);
                    
                    const startOfDay = new Date(d);
                    startOfDay.setHours(0,0,0,0);
                    const endOfDay = new Date(d);
                    endOfDay.setHours(23,59,59,999);

                    const { count } = await supabase
                        .from('messages')
                        .select('*', { count: 'exact', head: true })
                        .gte('created_at', startOfDay.getTime())
                        .lte('created_at', endOfDay.getTime());

                    msgCounts[6 - i] = count || 0;
                    if (count > 0) hasRealData = true;
                }

                // Colhe tópicos
                const { data: messages } = await supabase
                    .from('messages')
                    .select('content')
                    .eq('role', 'user');

                if (messages && messages.length > 0) {
                    hasRealData = true;
                    messages.forEach(msg => {
                        const text = msg.content ? msg.content.toLowerCase() : '';
                        if (text.includes('mensal') || text.includes('preço') || text.includes('valor') || text.includes('pagamento') || text.includes('custo') || text.includes('mensalidade')) {
                            subjects['Mensalidades / Valores']++;
                        } else if (text.includes('matrícula') || text.includes('matricula') || text.includes('vaga') || text.includes('inscrição') || text.includes('inscrever')) {
                            subjects['Matrículas & Vagas']++;
                        } else if (text.includes('material') || text.includes('livro') || text.includes('apostila') || text.includes('caderno')) {
                            subjects['Materiais / Livros']++;
                        } else if (text.includes('contato') || text.includes('telefone') || text.includes('whatsapp') || text.includes('secretaria') || text.includes('falar com')) {
                            subjects['Contatos / Secretaria']++;
                        } else if (text.includes('horário') || text.includes('horario') || text.includes('aula') || text.includes('grade') || text.includes('calendário')) {
                            subjects['Horários & Grade']++;
                        } else {
                            subjects['Outras dúvidas']++;
                        }
                    });
                }
            } catch (errDb) {
                console.log("Não foi possível buscar dados reais de estatísticas (Offline).");
            }
        }

        // Se não houver dados reais ou estiver offline, preenche com mocks elegantes de alta fidelidade
        const lineData = hasRealData ? msgCounts : [12, 19, 15, 25, 22, 30, 28];
        
        const subjectLabels = Object.keys(subjects);
        let subjectData = Object.values(subjects);
        const sum = subjectData.reduce((a, b) => a + b, 0);
        if (sum === 0) {
            subjectData = [35, 25, 18, 12, 8, 5]; // Valores fictícios
        }

        // Destrói instâncias velhas se existirem
        if (chartConversations) chartConversations.destroy();
        if (chartSubjects) chartSubjects.destroy();

        if (!window.Chart) {
            console.warn("Chart.js não foi carregado. Ignorando renderização gráfica.");
            return;
        }

        // 1. Chart Linha (Histórico)
        const ctx1 = document.getElementById('chart-conversations').getContext('2d');
        chartConversations = new Chart(ctx1, {
            type: 'line',
            data: {
                labels: days,
                datasets: [{
                    label: 'Mensagens',
                    data: lineData,
                    borderColor: '#AF1411',
                    backgroundColor: 'rgba(175, 20, 17, 0.1)',
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
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#888' } },
                    y: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#888', precision: 0 } }
                }
            }
        });

        // 2. Chart Doughnut (Assuntos)
        const ctx2 = document.getElementById('chart-subjects').getContext('2d');
        chartSubjects = new Chart(ctx2, {
            type: 'doughnut',
            data: {
                labels: subjectLabels,
                datasets: [{
                    data: subjectData,
                    backgroundColor: [
                        '#AF1411',
                        '#D32F2F',
                        '#F44336',
                        '#E57373',
                        '#FFCDD2',
                        '#3a3a3a'
                    ],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            color: '#ccc',
                            font: { family: 'Quicksand', size: 12 },
                            padding: 15
                        }
                    }
                },
                cutout: '70%'
            }
        });

    } catch (err) {
        console.error('Erro ao renderizar gráficos:', err);
    }
}

// 5. LÓGICA DO CHAT (CENTRAL DE CONVERSAS)
let allContacts = [];
async function loadConversationsTab() {
    if (!supabase) return;
    await loadContactsList();
}

async function loadContactsList() {
    const listContainer = document.getElementById('contacts-list-container');
    if (!listContainer) return;

    listContainer.innerHTML = '<div class="loading-spinner">Carregando contatos...</div>';

    try {
        const { data: contacts, error } = await supabase
            .from('contacts')
            .select('*');

        if (error) throw error;

        allContacts = contacts || [];
        renderContactsList(allContacts);
    } catch (err) {
        console.error('Erro ao carregar lista de contatos:', err);
        listContainer.innerHTML = '<div class="error-msg">Erro ao carregar contatos do Supabase.</div>';
    }
}

function renderContactsList(contacts) {
    const listContainer = document.getElementById('contacts-list-container');
    if (!listContainer) return;

    if (contacts.length === 0) {
        listContainer.innerHTML = '<div class="no-records">Nenhum contato encontrado.</div>';
        return;
    }

    listContainer.innerHTML = '';
    contacts.forEach(contact => {
        const item = document.createElement('div');
        item.className = `contact-item ${contact.wa_id === activeContactId ? 'active' : ''}`;
        item.setAttribute('data-id', contact.wa_id);

        const displayName = contact.name || ('Aluno ' + contact.wa_id.substring(0, 10));
        const initials = displayName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        
        const botStatusHtml = contact.bot_paused 
            ? '<span class="bot-badge-paused"><i class="fa-solid fa-headset"></i> Humano</span>' 
            : '<span class="bot-badge-active"><i class="fa-solid fa-robot"></i> Bot Ativo</span>';

        item.innerHTML = `
            <div class="contact-avatar">${initials}</div>
            <div class="contact-details">
                <div class="contact-header">
                    <h4>${displayName}</h4>
                </div>
                <div class="contact-meta">
                    <p>${contact.phone || contact.wa_id}</p>
                    ${botStatusHtml}
                </div>
            </div>
        `;

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
    const filtered = allContacts.filter(c => 
        (c.wa_id && c.wa_id.toLowerCase().includes(query)) ||
        (c.name && c.name.toLowerCase().includes(query))
    );
    renderContactsList(filtered);
}

async function loadActiveChat(contact) {
    const headerInfo = document.getElementById('chat-header-info');
    const messagesBox = document.getElementById('chat-messages-box');
    const toggleBotBtn = document.getElementById('btn-toggle-bot');

    if (!headerInfo || !messagesBox || !toggleBotBtn) return;

    headerInfo.style.display = 'flex';
    
    const displayName = contact.name || ('Aluno ' + contact.wa_id.substring(0, 10));
    document.getElementById('chat-user-name').textContent = displayName;
    document.getElementById('chat-user-phone').textContent = contact.phone || contact.wa_id;
    
    const initials = displayName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    document.getElementById('chat-user-avatar').textContent = initials;

    updateBotButtonUI(contact.bot_paused);

    messagesBox.innerHTML = '<div class="loading-spinner">Carregando histórico...</div>';

    try {
        const { data: messages, error } = await supabase
            .from('messages')
            .select('*')
            .eq('wa_id', contact.wa_id)
            .order('created_at', { ascending: true });

        if (error) throw error;

        messagesBox.innerHTML = '';
        if (!messages || messages.length === 0) {
            messagesBox.innerHTML = '<div class="chat-placeholder"><h3>Nenhuma mensagem</h3><p>Esse contato ainda não enviou mensagens.</p></div>';
            return;
        }

        messages.forEach(msg => {
            const msgElement = document.createElement('div');
            const isUser = msg.role === 'user';
            msgElement.className = `chat-bubble-container ${isUser ? 'user' : 'bot'}`;
            
            const msgDate = new Date(parseInt(msg.created_at) || msg.created_at);
            const time = msgDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            
            msgElement.innerHTML = `
                <div class="chat-bubble">
                    <p class="bubble-text">${msg.content || ''}</p>
                    <span class="bubble-time">${time}</span>
                </div>
            `;
            messagesBox.appendChild(msgElement);
        });

        messagesBox.scrollTop = messagesBox.scrollHeight;
    } catch (err) {
        console.error('Erro ao carregar mensagens:', err);
        messagesBox.innerHTML = '<div class="error-msg">Erro ao carregar histórico.</div>';
    }
}

function updateBotButtonUI(botPaused) {
    const toggleBotBtn = document.getElementById('btn-toggle-bot');
    if (!toggleBotBtn) return;

    const icon = toggleBotBtn.querySelector('i');
    const text = toggleBotBtn.querySelector('span');

    if (botPaused) {
        toggleBotBtn.className = 'btn btn-resume';
        icon.className = 'fa-solid fa-play';
        text.textContent = 'Retomar Bot';
    } else {
        toggleBotBtn.className = 'btn btn-pause';
        icon.className = 'fa-solid fa-pause';
        text.textContent = 'Pausar Bot';
    }
}

async function toggleBotStatus() {
    if (!supabase || !activeContactId) return;

    const contact = allContacts.find(c => c.wa_id === activeContactId);
    if (!contact) return;

    const nextState = !contact.bot_paused;

    try {
        const { error } = await supabase
            .from('contacts')
            .update({ bot_paused: nextState })
            .eq('wa_id', activeContactId);

        if (error) throw error;

        contact.bot_paused = nextState;
        updateBotButtonUI(nextState);
        renderContactsList(allContacts);
    } catch (err) {
        console.error('Erro ao alterar status do bot:', err);
        alert('Não foi possível alterar o status do bot no Supabase.');
    }
}

// 6. LÓGICA DO BANCO DE DADOS (CRUD)
let currentTableData = [];

async function loadDatabaseTable() {
    if (!supabase) return;

    const tableBody = document.getElementById('db-data-body');
    const tableHead = document.querySelector('#db-data-table thead');

    if (!tableBody || !tableHead) return;

    tableHead.innerHTML = '<tr><th>Carregando colunas...</th></tr>';
    tableBody.innerHTML = '<tr><td>Carregando registros do Supabase...</td></tr>';

    try {
        const { data, error } = await supabase
            .from(activeTable)
            .select('*');

        if (error) throw error;

        currentTableData = data || [];
        const columns = TABLE_SCHEMAS[activeTable];

        let headHtml = '<tr>';
        columns.forEach(col => {
            headHtml += `<th>${col.label}</th>`;
        });
        headHtml += '<th class="action-column">Ações</th></tr>';
        tableHead.innerHTML = headHtml;

        if (currentTableData.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="${columns.length + 1}" class="no-records">Nenhum registro encontrado nesta tabela.</td></tr>`;
            return;
        }

        tableBody.innerHTML = '';
        currentTableData.forEach(row => {
            const tr = document.createElement('tr');
            
            let rowHtml = '';
            columns.forEach(col => {
                let val = row[col.name];
                
                if (val === null || val === undefined) {
                    val = '<span class="null-val">-</span>';
                } else if (col.type === 'number') {
                    val = `R$ ${parseFloat(val).toFixed(2)}`;
                } else if (col.name === 'image_url' && val && val.startsWith('http')) {
                    val = `<a href="${val}" target="_blank" class="db-img-preview-link"><i class="fa-solid fa-image"></i> Ver Foto</a>`;
                } else if (typeof val === 'string' && val.length > 50) {
                    val = val.substring(0, 50) + '...';
                }

                rowHtml += `<td>${val}</td>`;
            });

            rowHtml += `
                <td class="action-column">
                    <button class="btn btn-action-edit" onclick="openEditModal('${row.id}')" title="Editar"><i class="fa-solid fa-pen-to-square"></i></button>
                    <button class="btn btn-action-delete" onclick="deleteRow('${row.id}')" title="Excluir"><i class="fa-solid fa-trash"></i></button>
                </td>
            `;

            tr.innerHTML = rowHtml;
            tableBody.appendChild(tr);
        });

    } catch (err) {
        console.error('Erro ao ler tabela:', err);
        tableBody.innerHTML = `<tr><td colspan="5" class="error-msg">Erro ao carregar dados do Supabase. Verifique sua conexão e tabelas.</td></tr>`;
    }
}

function openAddModal() {
    editRecordId = null;
    document.getElementById('modal-title').textContent = 'Adicionar Novo Registro';
    buildModalFields();
    document.getElementById('db-modal').style.display = 'flex';
}

window.openEditModal = function(id) {
    editRecordId = id;
    document.getElementById('modal-title').textContent = 'Editar Registro';
    buildModalFields();
    
    const row = currentTableData.find(r => r.id.toString() === id.toString());
    if (row) {
        TABLE_SCHEMAS[activeTable].forEach(col => {
            const input = document.getElementById(`form-field-${col.name}`);
            if (input && col.type !== 'file') {
                input.value = row[col.name] !== null ? row[col.name] : '';
            }
            if (col.type === 'file' && row[col.name]) {
                const helper = document.getElementById(`helper-${col.name}`);
                if (helper) {
                    helper.innerHTML = `<span class="img-curr-helper">Imagem atual: <a href="${row[col.name]}" target="_blank">Ver</a></span>`;
                }
            }
        });
    }
    document.getElementById('db-modal').style.display = 'flex';
};

function closeModal() {
    document.getElementById('db-modal').style.display = 'none';
    document.getElementById('db-modal-form').reset();
}

function buildModalFields() {
    const container = document.getElementById('modal-fields-container');
    if (!container) return;

    container.innerHTML = '';
    const columns = TABLE_SCHEMAS[activeTable];

    columns.forEach(col => {
        if (editRecordId === null && col.hiddenOnAdd) return;

        const formGroup = document.createElement('div');
        formGroup.className = 'form-group';

        const label = document.createElement('label');
        label.setAttribute('for', `form-field-${col.name}`);
        label.textContent = col.label;
        formGroup.appendChild(label);

        let input;
        
        if (col.type === 'textarea') {
            input = document.createElement('textarea');
            input.rows = 3;
        } else if (col.type === 'select') {
            input = document.createElement('select');
            col.options.forEach(opt => {
                const o = document.createElement('option');
                o.value = opt;
                o.textContent = opt;
                input.appendChild(o);
            });
        } else {
            input = document.createElement('input');
            input.type = col.type;
        }

        input.id = `form-field-${col.name}`;
        input.name = col.name;
        if (col.required && col.type !== 'file') input.required = true;
        
        if (editRecordId !== null && col.readonlyOnEdit) {
            input.readOnly = true;
            input.classList.add('readonly-field');
        }

        if (col.type === 'file') {
            const wrapper = document.createElement('div');
            wrapper.className = 'file-input-wrapper';
            wrapper.appendChild(input);
            
            const helper = document.createElement('div');
            helper.id = `helper-${col.name}`;
            helper.className = 'file-helper-text';
            helper.textContent = 'Selecione uma foto para salvar no Storage do Supabase';
            wrapper.appendChild(helper);
            
            formGroup.appendChild(wrapper);
        } else {
            formGroup.appendChild(input);
        }

        container.appendChild(formGroup);
    });
}

async function handleModalSubmit(e) {
    e.preventDefault();
    if (!supabase) return;

    const saveBtn = document.getElementById('btn-save-modal');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Salvando...';

    try {
        const formData = new FormData(e.target);
        const record = {};
        let fileToUpload = null;
        let fileFieldName = null;

        TABLE_SCHEMAS[activeTable].forEach(col => {
            if (col.type === 'file') {
                const fileInput = document.getElementById(`form-field-${col.name}`);
                if (fileInput && fileInput.files && fileInput.files[0]) {
                    fileToUpload = fileInput.files[0];
                    fileFieldName = col.name;
                }
            } else {
                const val = formData.get(col.name);
                if (val !== null && val !== undefined) {
                    record[col.name] = col.type === 'number' ? parseFloat(val) : val;
                }
            }
        });

        // 1. Faz upload da imagem no Supabase Storage se existir
        if (fileToUpload) {
            const fileName = `${Date.now()}_${fileToUpload.name.replace(/\s+/g, '_')}`;
            
            const { data: uploadData, error: uploadErr } = await supabase.storage
                .from('school-media')
                .upload(fileName, fileToUpload, {
                    cacheControl: '3600',
                    upsert: true
                });

            if (uploadErr) {
                if (uploadErr.message.includes('not found') || uploadErr.error === 'Bucket not found') {
                    throw new Error("O bucket 'school-media' não existe no seu Supabase. Crie-o no painel do Supabase Storage como público para aceitar fotos.");
                }
                throw uploadErr;
            }

            const { data: publicUrlData } = supabase.storage
                .from('school-media')
                .getPublicUrl(fileName);

            record[fileFieldName] = publicUrlData.publicUrl;
        }

        // 2. Insere ou Atualiza no banco
        if (editRecordId !== null) {
            const { error } = await supabase
                .from(activeTable)
                .update(record)
                .eq('id', editRecordId);

            if (error) throw error;
        } else {
            const { error } = await supabase
                .from(activeTable)
                .insert([record]);

            if (error) throw error;
        }

        closeModal();
        await loadDatabaseTable();
    } catch (err) {
        console.error('Erro ao salvar registro:', err);
        alert(`Erro ao salvar registro: ${err.message || err}`);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Salvar Registro';
    }
}

window.deleteRow = async function(id) {
    if (!supabase) return;
    if (!confirm('Deseja realmente excluir este registro permanentemente do Supabase?')) return;

    try {
        const { error } = await supabase
            .from(activeTable)
            .delete()
            .eq('id', id);

        if (error) throw error;

        await loadDatabaseTable();
    } catch (err) {
        console.error('Erro ao deletar registro:', err);
        alert('Não foi possível excluir o registro. Ele pode estar sendo referenciado por outras tabelas.');
    }
};

// 7. LÓGICA DE CONFIGURAÇÕES DE CONEXÃO
function saveConfigForm(e) {
    e.preventDefault();
    const url = document.getElementById('input-supabase-url').value.trim();
    const key = document.getElementById('input-supabase-key').value.trim();

    if (url && key) {
        localStorage.setItem('SUPABASE_URL', url);
        localStorage.setItem('SUPABASE_ANON_KEY', key);
        
        alert('Configurações salvas localmente! Tentando conectar...');
        initConnection().then(success => {
            if (success) {
                const dashLi = document.querySelector('.sidebar-menu li[data-tab="dashboard"]');
                if (dashLi) dashLi.click();
            }
        });
    }
}

function clearConfig() {
    if (confirm('Deseja realmente limpar as credenciais salvas do Supabase neste navegador?')) {
        localStorage.removeItem('SUPABASE_URL');
        localStorage.removeItem('SUPABASE_ANON_KEY');
        document.getElementById('input-supabase-url').value = '';
        document.getElementById('input-supabase-key').value = '';
        
        const statusText = document.getElementById('supabase-status-text');
        const statusIndicator = document.querySelector('.status-indicator');
        statusText.textContent = 'Desconectado';
        statusIndicator.className = 'status-indicator offline';
        
        supabase = null;
        alert('Credenciais removidas com sucesso.');
    }
}
