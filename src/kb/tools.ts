import { logger } from "../logger";
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
    "Obtém informações sobre mensalidade do aluno, incluindo valor, data de vencimento e status do pagamento",
  inputSchema: {
    type: "object",
    properties: {
      student_id: {
        type: "string",
        description: "ID único do aluno",
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
      return `Aluno ${student_id} não encontrado.`;
    }

    return `Mensalidade do aluno ${student_id}: ${info.value}, vencimento em ${info.dueDate}, status: ${info.status}`;
  },
};

// Ferramenta: Consultar cronograma de aulas
const cronogramaTool: KBTool = {
  name: "get_schedule",
  description:
    "Obtém o cronograma de aulas e datas importantes para o aluno",
  inputSchema: {
    type: "object",
    properties: {
      student_id: {
        type: "string",
        description: "ID único do aluno",
      },
    },
    required: ["student_id"],
  },
  execute: async (args) => {
    const { student_id } = args as { student_id: string };

    logger.info({ student_id }, "Fetching schedule");

    const schedules: Record<string, string[]> = {
      STU001: [
        "Segunda: 19:00 - Matemática",
        "Quarta: 19:00 - Português",
        "Sexta: 19:00 - Ciências",
        "Próxima avaliação: 01/06",
      ],
      STU002: [
        "Terça: 14:00 - Matemática",
        "Quinta: 14:00 - História",
        "Sábado: 10:00 - Redação",
        "Próxima avaliação: 03/06",
      ],
    };

    const schedule = schedules[student_id];
    if (!schedule) {
      return `Cronograma para aluno ${student_id} não encontrado.`;
    }

    return `Cronograma de ${student_id}:\n${schedule.join("\n")}`;
  },
};

// Ferramenta: Acessar materiais de estudo
const materiaisTool: KBTool = {
  name: "get_study_materials",
  description: "Obtém materiais de estudo e recursos disponíveis para o aluno",
  inputSchema: {
    type: "object",
    properties: {
      student_id: {
        type: "string",
        description: "ID único do aluno",
      },
      subject: {
        type: "string",
        description: "Disciplina (opcional): Matemática, Português, Ciências",
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
        Matemática: ["Apostila Cap. 1-3", "Exercícios resolvidos", "Vídeos"],
        Português: ["Gramática básica", "Leitura e interpretação", "Redação"],
        Ciências: ["Biologia", "Química", "Física"],
      },
      STU002: {
        Matemática: ["Geometria", "Álgebra", "Cálculo"],
        História: ["Era Medieval", "Renascimento", "Iluminismo"],
        Redação: ["Dissertativa", "Narrativa", "Descritiva"],
      },
    };

    const studentMaterials = materials[student_id];
    if (!studentMaterials) {
      return `Materiais para aluno ${student_id} não encontrados.`;
    }

    if (subject) {
      const subjectMaterials = studentMaterials[subject];
      if (!subjectMaterials) {
        return `Materiais de ${subject} não encontrados para ${student_id}.`;
      }
      return `Materiais de ${subject} para ${student_id}:\n${subjectMaterials.join("\n")}`;
    }

    const allMaterials = Object.entries(studentMaterials)
      .map(([subj, items]) => `${subj}: ${items.join(", ")}`)
      .join("\n");

    return `Materiais disponíveis para ${student_id}:\n${allMaterials}`;
  },
};

// Ferramenta: Obter contatos e suporte
const contatosTool: KBTool = {
  name: "get_contact_info",
  description:
    "Obtém informações de contato para suporte, coordenação e especialistas",
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
        "Agende uma reunião através da plataforma ou envie mensagem direta",
    };

    return `Contato ${type}: ${contacts[type] || "Tipo de contato não encontrado"}`;
  },
};

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
    "FERRAMENTA PRINCIPAL. Use SEMPRE que o cliente perguntar sobre valor, mensalidade, preço, custo, anuidade, curso, série, ano, turma, fundamental 1, fundamental 2, ensino médio, pré-enem, terceirão, cursinho, horário das aulas, turno, ou qualquer informação acadêmica das turmas regulares (do 1º ano do fundamental em diante). Aceita o argumento opcional 'nivel' com valores: 'Fundamental 1', 'Fundamental 2', 'Ensino Médio', 'Pré-Enem'. Se o cliente disse só 'valor' sem especificar nível, chame sem argumento (retorna resumo). MAPEIE em silêncio: '1º a 5º ano' → 'Fundamental 1'; '6º a 9º ano' → 'Fundamental 2'; '1ª/2ª série' → 'Ensino Médio'; 'terceirão/cursinho/pré-vestibular/3º ano' → 'Pré-Enem'.",
  inputSchema: {
    type: "object",
    properties: {
      nivel: {
        type: "string",
        description:
          "Nível de interesse: Fundamental 1, Fundamental 2, Médio, Pré-Enem (opcional)",
      },
    },
    required: [],
  },
  execute: async (args) => {
    try {
      const kb = loadKnowledgeBase();
      const { nivel } = args as { nivel?: string };

      if (!nivel || nivel.toLowerCase() === "todos") {
        // Retorna resumo de todos os cursos
        const resumo = kb.mensalidades
          .map(
            (m) =>
              `🎓 ${m.nivel} (${m.descricao})\n   Mensalidade: R$ ${m.preco_mensal}/mês\n`
          )
          .join("");
        return `📚 CURSOS E MENSALIDADES DO COLÉGIO IDEAL:\n\n${resumo}`;
      }

      // Busca nível específico
      const mensalidade = kb.mensalidades.find((m) =>
        m.nivel.toLowerCase().includes(nivel.toLowerCase())
      );

      if (!mensalidade) {
        return `Nível "${nivel}" não encontrado. Temos: Fundamental 1, Fundamental 2, Médio e Pré-Enem.`;
      }

      return formatMensalidade(mensalidade);
    } catch (error) {
      logger.error({ error }, "Error fetching enrollment info");
      return "Desculpe, não consegui carregar as informações de matrícula. Por favor, entre em contato com nossa coordenação.";
    }
  },
};

// Ferramenta: Obter informações de contato para matrícula
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
      const kb = loadKnowledgeBase();
      const contatos = kb.contatos.map((c) => formatContato(c)).join("\n\n");
      return `📞 ENTRE EM CONTATO:\n\n${contatos}`;
    } catch (error) {
      logger.error({ error }, "Error fetching contact info");
      return "Telefone: (91) 3000-0000 | Email: matriculas@colegioideal.com.br";
    }
  },
};

export function getKBTools(): KBTool[] {
  // ORDER MATTERS — Gemini biases toward earlier tools when descriptions
  // overlap. We list the "answer the question" tools FIRST so the model
  // reaches for them before considering escalation.
  return [
    consultarMensalidadesTool, // get_enrollment_info
    consultarContatoMatriculaTool, // get_enrollment_contact
    escalarTool, // escalate_to_specialist — last resort
  ];
}

// Legacy tools kept for tests/back-compat — not exposed to the LLM.
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
