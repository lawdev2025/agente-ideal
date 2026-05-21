import { logger } from "../logger";

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
    "Escala o atendimento para um especialista humano ou departamento específico",
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

export function getKBTools(): KBTool[] {
  return [
    mensalidadeTool,
    cronogramaTool,
    materiaisTool,
    contatosTool,
    escalarTool,
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
