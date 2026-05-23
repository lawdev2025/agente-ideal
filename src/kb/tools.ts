import { logger } from "../logger";
import { isSupabaseEnabled, getSupabase } from "../db/supabase";
import { loadKnowledgeBase, formatMensalidade, formatContato } from "./loader";

export interface KBTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

// Ferramenta: Consultar mensalidade do aluno
const mensalidadeTool: KBTool = {
  name: "get_tuition_info",
  description:
    "ObtÃ©m informaÃ§Ãµes sobre mensalidade do aluno, incluindo valor, data de vencimento e status do pagamento",
  inputSchema: {
    type: "object",
    properties: {
      student_id: {
        type: "string",
        description: "ID Ãºnico do aluno",
      },
    },
    required: ["student_id"],
  },
  execute: async (args) => {
    const { student_id } = args as { student_id: string };

    logger.info({ student_id }, "Fetching tuition info");

    // Simulated data - in production would query real database
    const tuitionData: Record<
      string,
      { value: string; dueDate: string; status: string }
    > = {
      STU001: {
        value: "R$ 500.00",
        dueDate: "25 de maio",
        status: "Pago",
      },
      STU002: {
        value: "R$ 500.00",
        dueDate: "30 de maio",
        status: "Pendente",
      },
    };

    const info = tuitionData[student_id];
    if (!info) {
      return `Aluno ${student_id} nÃ£o encontrado.`;
    }

    return `Mensalidade do aluno ${student_id}: ${info.value}, vencimento em ${info.dueDate}, status: ${info.status}`;
  },
};

// Ferramenta: Consultar cronograma de aulas
const cronogramaTool: KBTool = {
  name: "get_schedule",
  description:
    "ObtÃ©m o cronograma de aulas e datas importantes para o aluno",
  inputSchema: {
    type: "object",
    properties: {
      student_id: {
        type: "string",
        description: "ID Ãºnico do aluno",
      },
    },
    required: ["student_id"],
  },
  execute: async (args) => {
    const { student_id } = args as { student_id: string };

    logger.info({ student_id }, "Fetching schedule");

    const schedules: Record<string, string[]> = {
      STU001: [
        "Segunda: 19:00 - MatemÃ¡tica",
        "Quarta: 19:00 - PortuguÃªs",
        "Sexta: 19:00 - CiÃªncias",
        "PrÃ³xima avaliaÃ§Ã£o: 01/06",
      ],
      STU002: [
        "TerÃ§a: 14:00 - MatemÃ¡tica",
        "Quinta: 14:00 - HistÃ³ria",
        "SÃ¡bado: 10:00 - RedaÃ§Ã£o",
        "PrÃ³xima avaliaÃ§Ã£o: 03/06",
      ],
    };

    const schedule = schedules[student_id];
    if (!schedule) {
      return `Cronograma para aluno ${student_id} nÃ£o encontrado.`;
    }

    return `Cronograma de ${student_id}:\n${schedule.join("\n")}`;
  },
};

// Ferramenta: Acessar materiais de estudo
const materiaisTool: KBTool = {
  name: "get_study_materials",
  description: "ObtÃ©m materiais de estudo e recursos disponÃ­veis para o aluno",
  inputSchema: {
    type: "object",
    properties: {
      student_id: {
        type: "string",
        description: "ID Ãºnico do aluno",
      },
      subject: {
        type: "string",
        description: "Disciplina (opcional): MatemÃ¡tica, PortuguÃªs, CiÃªncias",
      },
    },
    required: ["student_id"],
  },
  execute: async (args) => {
    const { student_id, subject } = args as {
      student_id: string;
      subject?: string;
    };

    logger.info({ student_id, subject }, "Fetching study materials");

    const materials: Record<string, Record<string, string[]>> = {
      STU001: {
        MatemÃ¡tica: ["Apostila Cap. 1-3", "ExercÃ­cios resolvidos", "VÃ­deos"],
        PortuguÃªs: ["GramÃ¡tica bÃ¡sica", "Leitura e interpretaÃ§Ã£o", "RedaÃ§Ã£o"],
        CiÃªncias: ["Biologia", "QuÃ­mica", "FÃ­sica"],
      },
      STU002: {
        MatemÃ¡tica: ["Geometria", "Ãlgebra", "CÃ¡lculo"],
        HistÃ³ria: ["Era Medieval", "Renascimento", "Iluminismo"],
        RedaÃ§Ã£o: ["Dissertativa", "Narrativa", "Descritiva"],
      },
    };

    const studentMaterials = materials[student_id];
    if (!studentMaterials) {
      return `Materiais para aluno ${student_id} nÃ£o encontrados.`;
    }

    if (subject) {
      const subjectMaterials = studentMaterials[subject];
      if (!subjectMaterials) {
        return `Materiais de ${subject} nÃ£o encontrados para ${student_id}.`;
      }
      return `Materiais de ${subject} para ${student_id}:\n${subjectMaterials.join("\n")}`;
    }

    const allMaterials = Object.entries(studentMaterials)
      .map(([subj, items]) => `${subj}: ${items.join(", ")}`)
      .join("\n");

    return `Materiais disponÃ­veis para ${student_id}:\n${allMaterials}`;
  },
};

// Ferramenta: Obter contatos e suporte
const contatosTool: KBTool = {
  name: "get_contact_info",
  description:
    "ObtÃ©m informaÃ§Ãµes de contato para suporte, coordenaÃ§Ã£o e especialistas",
  inputSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["support", "coordination", "teacher"],
        description: "Tipo de contato: support, coordination, teacher",
      },
    },
    required: ["type"],
  },
  execute: async (args) => {
    const { type } = args as { type: string };

    logger.info({ type }, "Fetching contact info");

    const contacts: Record<string, string> = {
      support: "Email: suporte@plataforma.com | Tel: (11) 3000-0000",
      coordination:
        "Email: coordenacao@plataforma.com | Tel: (11) 3000-1111",
      teacher:
        "Agende uma reuniÃ£o atravÃ©s da plataforma ou envie mensagem direta",
    };

    return `Contato ${type}: ${contacts[type] || "Tipo de contato nÃ£o encontrado"}`;
  },
};

// Ferramenta: Escalar para especialista
const escalarTool: KBTool = {
  name: "escalate_to_specialist",
  description:
    "ÃšLTIMO RECURSO. NÃƒO chame para perguntas sobre matrÃ­cula, valor, mensalidade, sÃ©rie, ano, turma, curso, fundamental, mÃ©dio, prÃ©-enem, ou para perguntas com nÃºmeros de sÃ©rie (5Âº ano, 7Âª sÃ©rie, terceirÃ£o) â€” TODAS essas vÃ£o para get_enrollment_info. Chame APENAS quando: (a) cliente pergunta sobre educaÃ§Ã£o infantil/maternal/jardim/berÃ§Ã¡rio (nÃ£o temos), (b) cliente fala explicitamente de bolsa/desconto/financiamento, (c) cliente pede pra falar com humano em palavras claras, (d) pergunta Ã© totalmente fora do colÃ©gio (futebol, polÃ­tica, piada). Se a pergunta Ã© sobre 'como matricular meu filho' â€” NÃƒO escale, isso Ã© nosso negÃ³cio principal, responda com get_enrollment_info.",
  inputSchema: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description:
          "Motivo da escalaÃ§Ã£o: technical, billing, academic, other",
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
      technical: "Suporte TÃ©cnico",
      billing: "Departamento Financeiro",
      academic: "CoordenaÃ§Ã£o AcadÃªmica",
      other: "Atendimento Geral",
    };

    return `Sua solicitaÃ§Ã£o foi escalada para ${departments[reason] || "Atendimento Geral"}. Um especialista entrarÃ¡ em contato com o aluno ${student_id} em breve.`;
  },
};

// Ferramenta: Consultar informaÃ§Ãµes sobre cursos e mensalidades para matrÃ­cula
const consultarMensalidadesTool: KBTool = {
  name: "get_enrollment_info",
  description:
    "FERRAMENTA PRINCIPAL. Use SEMPRE que o cliente perguntar sobre valor, mensalidade, preço, custo, anuidade, curso, série, ano, turma, fundamental 1, fundamental 2, ensino médio, pró-enem, terceirão, cursinho, horário das aulas, turno, ou qualquer informação acadêmica das turmas regulares (do 1º ano do fundamental em diante). Aceita o argumento opcional 'nivel' com valores: 'Fundamental 1', 'Fundamental 2', 'Ensino Médio', 'Pró-Enem'. Se o cliente disse só 'valor' sem especificar nível, chame sem argumento (retorna resumo). MAPEIE em silêncio: '1º a 5º ano' -> 'Fundamental 1'; '6º a 9º ano' -> 'Fundamental 2'; '1º/2º série' -> 'Ensino Médio'; 'terceirão/cursinho/pró-vestibular/3º ano' -> 'Pró-Enem'.",
  inputSchema: {
    type: "object",
    properties: {
      nivel: {
        type: "string",
        description:
          "Nível de interesse: Fundamental 1, Fundamental 2, Médio, Pró-Enem (opcional)",
      },
    },
    required: [],
  },
  execute: async (args) => {
    try {
      const { nivel } = args as { nivel?: string };
      if (isSupabaseEnabled()) {
        const supabase = getSupabase();
        if (!nivel || nivel.toLowerCase() === "todos") {
          const { data, error } = await supabase
            .from("school_levels")
            .select("*");
          if (error) throw error;
          if (data && data.length > 0) {
            const resumo = data
              .map(
                (m) =>
                  `?? ${m.nivel} (${m.descricao})\\n   Mensalidade: R$ ${m.preco_mensal}/mês\\n`
              )
              .join("");
            return `?? CURSOS E MENSALIDADES DO COLÉGIO IDEAL:\\n\\n${resumo}`;
          }
        } else {
          const { data, error } = await supabase
            .from("school_levels")
            .select("*");
          if (error) throw error;
          const mensalidade = data?.find((m) =>
            m.nivel.toLowerCase().includes(nivel.toLowerCase())
          );
          if (mensalidade) {
            return `?? **${mensalidade.nivel}** (${mensalidade.descricao})\\n?? Mensalidade: R$ ${mensalidade.preco_mensal}/mês\\n?? Semestral: R$ ${mensalidade.preco_semestral} | Anual: R$ ${mensalidade.preco_anual}\\n? Incluso no pacote:\\n${mensalidade.incluso.map((i: string) => `• ${i}`).join("\\n")}`;
          }
        }
      }
      const kb = loadKnowledgeBase();
      if (!nivel || nivel.toLowerCase() === "todos") {
        const resumo = kb.mensalidades
          .map(
            (m) =>
              `?? ${m.nivel} (${m.descricao})\\n   Mensalidade: R$ ${m.preco_mensal}/mês\\n`
          )
          .join("");
        return `?? CURSOS E MENSALIDADES DO COLÉGIO IDEAL:\\n\\n${resumo}`;
      }
      const mensalidade = kb.mensalidades.find((m) =>
        m.nivel.toLowerCase().includes(nivel.toLowerCase())
      );
      if (!mensalidade) {
        return `Nível "${nivel}" não encontrado. Temos: Fundamental 1, Fundamental 2, Médio e Pró-Enem.`;
      }
      return formatMensalidade(mensalidade);
    } catch (error) {
      logger.error({ error }, "Error fetching enrollment info");
      return "Desculpe, não consegui carregar as informações de matrícula. Por favor, entre em contato com nossa coordenação.";
    }
  },
};

// Ferramenta: Obter informaÃ§Ãµes de contato para matrÃ­cula
const consultarContatoMatriculaTool: KBTool = {
  name: "get_enrollment_contact",
  description:
    "Obtém informações de contato para dúvidas sobre matrícula e inscrição",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: async (args) => {
    try {
      if (isSupabaseEnabled()) {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from("school_contacts")
          .select("*");
        if (error) throw error;
        if (data && data.length > 0) {
          const contatos = data
            .map((c) => `?? *${c.name}* (${c.role_title})\\n   Telefone: ${c.phone_number}`)
            .join("\\n\\n");
          return `?? ENTRE EM CONTATO:\\n\\n${contatos}`;
        }
      }
      const kb = loadKnowledgeBase();
      const contatos = kb.contatos.map((c) => formatContato(c)).join("\\n\\n");
      return `?? ENTRE EM CONTATO:\\n\\n${contatos}`;
    } catch (error) {
      logger.error({ error }, "Error fetching contact info");
      return "Telefone: (91) 3000-0000 | Email: matriculas@colegioideal.com.br";
    }
  },
};

export function getKBTools(): KBTool[] {
  // ORDER MATTERS â€” Gemini biases toward earlier tools when descriptions
  // overlap. We list the "answer the question" tools FIRST so the model
  // reaches for them before considering escalation.
  return [
    consultarMensalidadesTool, // get_enrollment_info
    consultarContatoMatriculaTool, // get_enrollment_contact
    escalarTool, // escalate_to_specialist â€” last resort
  ];
}

// Legacy tools kept for tests/back-compat â€” not exposed to the LLM.
export const legacyTools = {
  mensalidadeTool,
  cronogramaTool,
  materiaisTool,
  contatosTool,
};

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
