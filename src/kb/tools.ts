import { logger } from "../logger";
import { isSupabaseEnabled, getSupabase } from "../db/supabase-client";
import { loadKnowledgeBase, formatMensalidade, formatContato } from "./loader";

export interface KBTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

// Ferramenta: Escalar para especialista
const escalarTool: KBTool = {
  name: "escalate_to_specialist",
  description:
    "ÚLTIMO RECURSO. NÃO chame para perguntas sobre matrícula, valor, mensalidade, série, ano, turma, curso, fundamental, médio, pré-enem, ou para perguntas com números de série (5º ano, 7ª série, terceirão) — TODAS essas vão para get_enrollment_info. Chame APENAS quando: (a) cliente pergunta sobre educação infantil/maternal/jardim/berçário (não temos), (b) cliente fala explicitamente de bolsa/desconto/financiamento, (c) cliente pede pra falar com humano em palavras claras, (d) pergunta é totalmente fora do colégio (futebol, política, piada). Se a pergunta é sobre 'como matricular meu filho' — NÃO escale, isso é nosso negócio principal, responda com get_enrollment_info.",
  inputSchema: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description:
          "Motivo da escalação: technical, billing, academic, other",
      },
      student_id: {
        type: "string",
        description: "ID do aluno",
      },
      message: {
        type: "string",
        description: "Mensagem ou contexto a ser repassado",
      },
    },
    required: ["reason", "student_id"],
  },
  execute: async (args) => {
    const { reason, student_id, message } = args as {
      reason: string;
      student_id: string;
      message?: string;
    };

    logger.info(
      { reason, student_id, messageLength: message?.length },
      "Escalating to specialist"
    );

    const departments: Record<string, string> = {
      technical: "Suporte Técnico",
      billing: "Departamento Financeiro",
      academic: "Coordenação Acadêmica",
      other: "Atendimento Geral",
    };

    return `Sua solicitação foi escalada para ${departments[reason] || "Atendimento Geral"}. Um especialista entrará em contato com o aluno ${student_id} em breve.`;
  },
};

// Ferramenta: Consultar informações sobre cursos e mensalidades para matrícula
const consultarMensalidadesTool: KBTool = {
  name: "get_enrollment_info",
  description:
    "FERRAMENTA PRINCIPAL. Use SEMPRE que o cliente perguntar sobre valor, mensalidade, preço, custo, anuidade, curso, série, ano, turma, maternal, jardim, fundamental, médio, pré-enem, terceirão, cursinho, horário das aulas, turno, ou qualquer informação acadêmica das turmas. Aceita argumentos opcionais 'nivel' e 'unit'. Se o cliente disse só 'valor' sem especificar nível, chame sem argumento. Se mencionou uma unidade (Batista Campos/Augusto Montenegro/Cidade Nova), passe em 'unit'.",
  inputSchema: {
    type: "object",
    properties: {
      nivel: {
        type: "string",
        description:
          "Nível de interesse: Educação Infantil, Fundamental 1, Fundamental 2, Ensino Médio, Pré-Enem, Escolinhas, Cursos (opcional)",
      },
      unit: {
        type: "string",
        description:
          "Nome da unidade: 'Batista Campos'/'Sede', 'Augusto Montenegro', 'Cidade Nova' (opcional). Cada unidade tem seus próprios valores.",
      },
    },
    required: [],
  },
  execute: async (args) => {
    try {
      const { nivel, unit } = args as { nivel?: string; unit?: string };

      // POLÍTICA DO COLÉGIO: NUNCA expor valores monetários no atendimento
      // automatizado. Sempre orientar a cliente a confirmar valores com a
      // secretaria. Esta tool retorna apenas confirmação da existência do
      // nível e oferece os contatos. Não chama Supabase.
      const niveis: Record<string, string> = {
        "maternal":         "Educação Infantil (Maternal)",
        "jardim":           "Educação Infantil (Jardim I/II)",
        "infantil":         "Educação Infantil",
        "educação infantil":"Educação Infantil",
        "educacao infantil":"Educação Infantil",
        "fundamental 1":    "Ensino Fundamental 1 (1º ao 5º ano)",
        "fundamental1":     "Ensino Fundamental 1 (1º ao 5º ano)",
        "fund 1":           "Ensino Fundamental 1 (1º ao 5º ano)",
        "fundamental 2":    "Ensino Fundamental 2 (6º ao 9º ano)",
        "fundamental2":     "Ensino Fundamental 2 (6º ao 9º ano)",
        "fund 2":           "Ensino Fundamental 2 (6º ao 9º ano)",
        "ensino médio":     "Ensino Médio (1ª, 2ª e 3ª série)",
        "ensino medio":     "Ensino Médio (1ª, 2ª e 3ª série)",
        "médio":            "Ensino Médio",
        "medio":            "Ensino Médio",
        "pré-enem":         "Pré-Enem (Eixo) — Terceirão e Cursinho",
        "pre-enem":         "Pré-Enem (Eixo) — Terceirão e Cursinho",
        "eixo":             "Pré-Enem (Eixo) — Terceirão e Cursinho",
        "terceirão":        "Pré-Enem (Eixo)",
        "terceirao":        "Pré-Enem (Eixo)",
        "cursinho":         "Pré-Enem (Eixo)",
      };

      const nivelKey = (nivel || "").toLowerCase().trim();
      const nivelLabel = niveis[nivelKey] || (nivel ? `nível "${nivel}"` : "todos os níveis");

      const unidadeRef = unit
        ? `da unidade ${unit}`
        : "em todas as 3 unidades (Sede/Batista Campos, Augusto Montenegro e Cidade Nova)";

      return [
        `✅ Sim, ${nivelLabel} está disponível ${unidadeRef}.`,
        ``,
        `📌 POLÍTICA OFICIAL DO COLÉGIO: valores de mensalidade, matrícula e material são informados APENAS na secretaria — nunca por este atendimento.`,
        ``,
        `👉 Próximo passo: oriente o cliente a entrar em contato com a secretaria (use get_enrollment_contact) ou agendar uma visita.`,
      ].join("\n");

    } catch (error) {
      logger.error({ error }, "Error fetching enrollment info");
      return "Desculpe, não consegui carregar as informações de matrícula. Por favor, entre em contato com nossa coordenação.";
    }
  },
};

// Ferramenta: Obter informações de contato dos setores do colégio
const consultarContatoMatriculaTool: KBTool = {
  name: "get_enrollment_contact",
  description:
    "Obtém contatos dos setores do colégio cadastrados na tabela school_contacts. Aceita argumento opcional 'assunto' (palavra-chave) para filtrar UM setor específico — exemplos: 'secretaria', 'matriculas', 'financeiro', 'coordenacao'. Sem argumento retorna a lista completa. IMPORTANTE: se o cliente pediu UM setor específico (ex: 'número da secretaria'), SEMPRE passe 'assunto' — nunca devolva lista de 3+ contatos pra um pedido pontual. Se nenhum setor casar o filtro, o tool retorna lista vazia explicando — não invente contatos.",
  inputSchema: {
    type: "object",
    properties: {
      assunto: {
        type: "string",
        description:
          "Palavra-chave do setor (secretaria, matriculas, financeiro, coordenacao, etc). Tool faz match case-insensitive em name e role_title.",
      },
    },
    required: [],
  },
  execute: async (args) => {
    try {
      const { assunto } = args as { assunto?: string };
      let rows: Array<{ name: string; role_title: string; phone_number: string }> = [];

      if (isSupabaseEnabled()) {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from("school_contacts")
          .select("name, role_title, phone_number");
        if (error) throw error;
        rows = (data as any) || [];
      } else {
        const kb = loadKnowledgeBase();
        rows = kb.contatos.map((c) => ({
          name: c.nome,
          role_title: c.descricao || c.tipo,
          phone_number: c.telefone || c.email || "",
        }));
      }

      if (rows.length === 0) {
        return "Nenhum contato cadastrado na base. Avise o cliente que vai pedir pra coordenação retornar.";
      }

      if (assunto) {
        const q = assunto.toLowerCase().trim();
        const match = rows.find(
          (r) =>
            (r.name || "").toLowerCase().includes(q) ||
            (r.role_title || "").toLowerCase().includes(q)
        );
        if (match) {
          return `${match.name} (${match.role_title}) — ${match.phone_number}`;
        }
        // Não encontrou — devolve lista pra modelo escolher escalar
        const lista = rows
          .map((r) => `• ${r.name} (${r.role_title})`)
          .join("\n");
        return `Nenhum setor com "${assunto}". Setores cadastrados:\n${lista}\nSe nenhum servir, escale.`;
      }

      const contatos = rows
        .map((c) => `📞 *${c.name}* (${c.role_title}) — ${c.phone_number}`)
        .join("\n");
      return `ENTRE EM CONTATO:\n${contatos}`;
    } catch (error) {
      logger.error({ error }, "Error fetching contact info");
      return "Não consegui carregar contatos agora. Escale para coordenação.";
    }
  },
};

// Ferramenta: Consultar informações de unidades/campi do colégio
const consultarUnidadesTool: KBTool = {
  name: "get_unit_info",
  description:
    "Obtém informações sobre as unidades/campi do Colégio Ideal: endereço, telefone fixo, horário de funcionamento, níveis oferecidos, infraestrutura, atividades extracurriculares, capacidade e link de agendamento de visita. Use sempre que o cliente perguntar sobre unidade, sede, campus, endereço, onde fica, horário de funcionamento da escola, quantos alunos, capacidade, infraestrutura, atividades ou quiser agendar uma visita. Aceita o argumento opcional 'unit' com nome da unidade (Sede/Batista Campos, Augusto Montenegro, Cidade Nova). Se não especificar, retorna resumo de todas.",
  inputSchema: {
    type: "object",
    properties: {
      unit: {
        type: "string",
        description: "Nome da unidade: 'Batista Campos' (Sede), 'Augusto Montenegro' ou 'Cidade Nova' (opcional)",
      },
    },
    required: [],
  },
  execute: async (args) => {
    try {
      const { unit } = args as { unit?: string };
      if (!isSupabaseEnabled()) {
        return "Informações de unidades disponíveis somente quando o Supabase está configurado. Por favor, entre em contato com a secretaria.";
      }
      const supabase = getSupabase();
      const { data: units, error } = await supabase.from("school_units").select("*");
      if (error) throw error;
      if (!units || units.length === 0) {
        return "Nenhuma unidade cadastrada na base de dados.";
      }

      const formatUnit = (u: Record<string, any>): string => {
        const lines: string[] = [`🏫 ${u.name}`];
        if (u.address) lines.push(`📍 Endereço: ${u.address}`);
        if (u.phone) lines.push(`📞 Telefone: ${u.phone}`);
        // whatsapp omitido intencionalmente: o cliente já está no WhatsApp
        if (u.hours) lines.push(`🕐 Horário: ${u.hours}`);
        if (u.levels) lines.push(`🎓 Níveis: ${u.levels}`);
        if (u.infrastructure) lines.push(`🏗️ Infraestrutura: ${u.infrastructure}`);
        if (u.activities) lines.push(`⚽ Atividades: ${u.activities}`);
        if (u.capacity) lines.push(`👥 Capacidade: ${u.capacity}`);
        if (u.visit_link) lines.push(`🗓️ Agendar visita: ${u.visit_link}`);
        return lines.join("\n");
      };

      if (unit) {
        const unitLower = unit.toLowerCase().trim();
        const match = units.find((u: any) => {
          const name = (u.name || "").toLowerCase();
          const id = (u.id || "").toLowerCase();
          return (
            name.includes(unitLower) ||
            id.includes(unitLower) ||
            unitLower.includes(name) ||
            (unitLower.includes("batista") && (name.includes("sede") || name.includes("batista"))) ||
            (unitLower.includes("sede") && (name.includes("sede") || name.includes("batista"))) ||
            (unitLower.includes("augusto") && name.includes("augusto")) ||
            (unitLower.includes("montenegro") && name.includes("montenegro")) ||
            (unitLower.includes("cidade") && name.includes("cidade")) ||
            (unitLower.includes("ananindeua") && name.includes("cidade"))
          );
        });
        if (match) return formatUnit(match as any);
        return `Unidade "${unit}" não encontrada. Temos: ${units.map((u: any) => u.name).join(", ")}.`;
      }

      return `🏫 UNIDADES DO COLÉGIO IDEAL:\n\n${units.map((u: any) => formatUnit(u as any)).join("\n\n")}`;
    } catch (error) {
      logger.error({ error }, "Error fetching unit info");
      return "Desculpe, não consegui carregar as informações das unidades. Por favor, entre em contato com a secretaria.";
    }
  },
};

export function getKBTools(): KBTool[] {
  // ORDER MATTERS — Gemini biases toward earlier tools when descriptions
  // overlap. We list the "answer the question" tools FIRST so the model
  // reaches for them before considering escalation.
  return [
    consultarMensalidadesTool, // get_enrollment_info
    consultarUnidadesTool, // get_unit_info
    consultarContatoMatriculaTool, // get_enrollment_contact
    escalarTool, // escalate_to_specialist — last resort
  ];
}

export function getToolDefinitions() {
  return getKBTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

export async function executeKBTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  const tools = getKBTools();
  const tool = tools.find((t) => t.name === toolName);

  if (!tool) {
    throw new Error(`Tool ${toolName} not found`);
  }

  return tool.execute(args);
}
