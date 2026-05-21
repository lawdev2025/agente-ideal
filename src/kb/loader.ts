import fs from 'fs';
import path from 'path';

export interface Mensalidade {
  id: string;
  nivel: string;
  descricao: string;
  preco_mensal: number;
  preco_semestral: number;
  preco_anual: number;
  incluso: string[];
}

export interface CalendarioEvento {
  data: string;
  evento: string;
  tipo: string;
}

export interface CalendarioPeriodo {
  id: string;
  nome: string;
  data_inicio: string;
  data_fim: string;
  eventos?: CalendarioEvento[];
  descricao?: string;
}

export interface Material {
  nome: string;
  quantidade: number | string;
  especificacoes: string;
}

export interface MaterialGrupo {
  id: string;
  nivel: string;
  descricao: string;
  materiais: Material[];
}

export interface Contato {
  id: string;
  nome: string;
  tipo: string;
  telefone: string;
  email?: string;
  horario_funcionamento?: string;
  descricao: string;
  ramal?: string;
  disponibilidade?: string;
}

export interface KnowledgeBase {
  mensalidades: Mensalidade[];
  calendario: CalendarioPeriodo[];
  materiais: MaterialGrupo[];
  contatos: Contato[];
}

const dataDir = path.join(__dirname, 'data');

/**
 * Load knowledge base data from JSON files
 */
export function loadKnowledgeBase(): KnowledgeBase {
  const mensalidades = loadJSON<Mensalidade[]>('mensalidades.json');
  const calendario = loadJSON<CalendarioPeriodo[]>('calendario.json');
  const materiais = loadJSON<MaterialGrupo[]>('materiais.json');
  const contatos = loadJSON<Contato[]>('contatos.json');

  return {
    mensalidades,
    calendario,
    materiais,
    contatos
  };
}

/**
 * Load a JSON file from the data directory
 */
function loadJSON<T>(filename: string): T {
  const filepath = path.join(dataDir, filename);

  if (!fs.existsSync(filepath)) {
    throw new Error(`Knowledge base file not found: ${filepath}`);
  }

  try {
    const content = fs.readFileSync(filepath, 'utf-8');
    return JSON.parse(content) as T;
  } catch (error) {
    throw new Error(
      `Failed to load or parse knowledge base file ${filename}: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Get mensalidades (tuition) by nível (education level)
 */
export function getMensalidadesByNivel(kb: KnowledgeBase, nivel: string): Mensalidade[] {
  return kb.mensalidades.filter(m => m.nivel.toLowerCase().includes(nivel.toLowerCase()));
}

/**
 * Get all calendar events for a date range
 */
export function getCalendarioEventos(
  kb: KnowledgeBase,
  dataInicio: string,
  dataFim: string
): CalendarioEvento[] {
  const eventos: CalendarioEvento[] = [];

  kb.calendario.forEach(periodo => {
    if (periodo.eventos) {
      periodo.eventos.forEach(evento => {
        if (evento.data >= dataInicio && evento.data <= dataFim) {
          eventos.push(evento);
        }
      });
    }
  });

  return eventos.sort((a, b) => a.data.localeCompare(b.data));
}

/**
 * Get materiais (materials) by nível (education level)
 */
export function getMaterialsByNivel(kb: KnowledgeBase, nivel: string): MaterialGrupo[] {
  return kb.materiais.filter(m => m.nivel.toLowerCase().includes(nivel.toLowerCase()));
}

/**
 * Get contato (contact) by type
 */
export function getContatosByTipo(kb: KnowledgeBase, tipo: string): Contato[] {
  return kb.contatos.filter(c => c.tipo.toLowerCase() === tipo.toLowerCase());
}

/**
 * Format mensalidades for display
 */
export function formatMensalidade(m: Mensalidade): string {
  const incluso = m.incluso.map(item => `  • ${item}`).join('\n');
  return `
**${m.descricao}**
Nível: ${m.nivel}

Preços:
  • Mensal: R$ ${m.preco_mensal.toFixed(2)}
  • Semestral: R$ ${m.preco_semestral.toFixed(2)}
  • Anual: R$ ${m.preco_anual.toFixed(2)}

Incluído:
${incluso}
  `.trim();
}

/**
 * Format contato for display
 */
export function formatContato(c: Contato): string {
  let result = `**${c.nome}** (${c.tipo})\n`;
  result += `Descrição: ${c.descricao}\n`;

  if (c.telefone) {
    result += `Telefone: ${c.telefone}\n`;
  }

  if (c.ramal) {
    result += `Ramal: ${c.ramal}\n`;
  }

  if (c.email) {
    result += `Email: ${c.email}\n`;
  }

  if (c.horario_funcionamento) {
    result += `Horário: ${c.horario_funcionamento}\n`;
  }

  if (c.disponibilidade) {
    result += `Disponibilidade: ${c.disponibilidade}\n`;
  }

  return result.trim();
}
