import { logger } from "../logger";
import { isSupabaseEnabled, getSupabase } from "../db/supabase-client";
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
    "Obtém informações de contato dinâmicas do banco de dados para suporte, coordenação, financeiro e professores",
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

    try {
      if (isSupabaseEnabled()) {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from("school_contacts")
          .select("*");
        
        if (error) throw error;
        
        if (data && data.length > 0) {
          let matched: any = null;
          
          if (type === "support") {
            // Busca Secretaria, Suporte, Financeiro, Mensalidades ou o primeiro disponível
            matched = data.find((c: any) => 
              c.name.toLowerCase().includes("secretaria") || 
              c.role_title.toLowerCase().includes("matrículas") || 
              c.role_title.toLowerCase().includes("suporte") ||
              c.name.toLowerCase().includes("financeiro") ||
              c.role_title.toLowerCase().includes("mensalidades")
            ) || data[0];
          } else if (type === "coordination") {
            // Busca Coordenação Pedagógica
            matched = data.find((c: any) => 
              c.name.toLowerCase().includes("coordenação") || 
              c.role_title.toLowerCase().includes("pedagógico")
            ) || data.find((c: any) => c.name.toLowerCase().includes("coord")) || data[2] || data[0];
          } else if (type === "teacher") {
            // Busca Professores ou docentes
            matched = data.find((c: any) => 
              c.name.toLowerCase().includes("professor") || 
              c.role_title.toLowerCase().includes("professor") ||
              c.name.toLowerCase().includes("docente")
            );
          }
          
          if (matched) {
            return `Contato ${type}: Setor: ${matched.name} | ${matched.role_title} | Telefone: ${matched.phone_number}`;
          }
        }
      }
    } catch (dbErr) {
      logger.error({ dbErr }, "Erro ao consultar school_contacts no get_contact_info");
    }

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

      if (isSupabaseEnabled()) {
        const supabase = getSupabase();

        // Resolve nome → unit_id consultando school_units (se unit foi passado)
        let resolvedUnitId: string | null = null;
        let resolvedUnitName: string | null = null;
        if (unit) {
          const unitLower = unit.toLowerCase().trim();
          const { data: units } = await supabase.from("school_units").select("id, name");
          if (units && units.length > 0) {
            const match = units.find((u: any) => {
              const n = (u.name || "").toLowerCase();
              const i = (u.id || "").toLowerCase();
              return (
                n.includes(unitLower) ||
                i.includes(unitLower) ||
                (unitLower.includes("batista") && (n.includes("sede") || n.includes("batista"))) ||
                (unitLower.includes("sede") && (n.includes("sede") || n.includes("batista"))) ||
                (unitLower.includes("augusto") && n.includes("augusto")) ||
                (unitLower.includes("montenegro") && n.includes("montenegro")) ||
                (unitLower.includes("cidade") && n.includes("cidade")) ||
                (unitLower.includes("ananindeua") && n.includes("cidade"))
              );
            });
            if (match) {
              resolvedUnitId = (match as any).id;
              resolvedUnitName = (match as any).name;
            }
          }
        }

        // Map nivel param to school_products category names
        const categoryMap: Record<string, string> = {
          "educação infantil": "Educação Infantil",
          "educacao infantil": "Educação Infantil",
          "maternal": "Educação Infantil",
          "jardim": "Educação Infantil",
          "infantil": "Educação Infantil",
          "fundamental 1": "Ensino Fundamental — Anos Iniciais",
          "fundamental1": "Ensino Fundamental — Anos Iniciais",
          "fund 1": "Ensino Fundamental — Anos Iniciais",
          "anos iniciais": "Ensino Fundamental — Anos Iniciais",
          "fundamental 2": "Ensino Fundamental — Anos Finais",
          "fundamental2": "Ensino Fundamental — Anos Finais",
          "fund 2": "Ensino Fundamental — Anos Finais",
          "anos finais": "Ensino Fundamental — Anos Finais",
          "ensino médio": "Ensino Médio",
          "ensino medio": "Ensino Médio",
          "médio": "Ensino Médio",
          "medio": "Ensino Médio",
          "pré-enem": "Pré-Vestibular (Eixo)",
          "pre-enem": "Pré-Vestibular (Eixo)",
          "pré enem": "Pré-Vestibular (Eixo)",
          "pre enem": "Pré-Vestibular (Eixo)",
          "eixo": "Pré-Vestibular (Eixo)",
          "terceirão": "Pré-Vestibular (Eixo)",
          "terceirao": "Pré-Vestibular (Eixo)",
          "cursinho": "Pré-Vestibular (Eixo)",
          "escolinhas": "Escolinhas de Esporte",
          "esporte": "Escolinhas de Esporte",
          "cursos": "Cursos Específicos",
          "específicos": "Cursos Específicos",
          "especificos": "Cursos Específicos",
        };

        const nivelLower = (nivel || "").toLowerCase().trim();
        const targetCategory = nivelLower ? categoryMap[nivelLower] : null;

        // Try school_products first (the main product catalog)
        let query = supabase.from("school_products").select("*");
        if (targetCategory) {
          query = query.eq("category", targetCategory);
        } else if (nivelLower && nivelLower !== "todos") {
          // Fuzzy match: try to find category containing the nivel string
          query = query.ilike("category", `%${nivelLower}%`);
        }
        // Filtro de unidade: o cliente perguntou sobre uma unidade específica.
        // Se NÃO passou unidade, mostramos todas (mas com a unidade visível
        // em cada linha pra deixar claro que valores podem variar).
        if (resolvedUnitId) {
          query = query.eq("unit_id", resolvedUnitId);
        }

        const { data: products, error: productError } = await query.order("category").order("name");

        const unitSuffix = resolvedUnitName ? ` — ${resolvedUnitName}` : "";

        if (!productError && products && products.length > 0) {
          if (!nivelLower || nivelLower === "todos") {
            // Group by category for summary
            const byCategory = products.reduce((acc: Record<string, typeof products>, p) => {
              if (!acc[p.category]) acc[p.category] = [];
              acc[p.category].push(p);
              return acc;
            }, {});
            const resumo = Object.entries(byCategory)
              .map(([cat, items]) => {
                const prices = items
                  .filter((i) => i.monthly_fee)
                  .map((i) => `  • ${i.name}: R$ ${Number(i.monthly_fee).toLocaleString('pt-BR', { minimumFractionDigits: 0 })}/mês`)
                  .join("\n");
                return prices ? `📚 ${cat}:\n${prices}` : `📚 ${cat}: (consulte a secretaria para valores)`;
              })
              .join("\n\n");
            return `📋 CURSOS E MENSALIDADES DO COLÉGIO IDEAL${unitSuffix}:\n\n${resumo}`;
          }

          // Specific category result
          const lines = products.map((p) => {
            let line = `• ${p.name}`;
            if (p.monthly_fee) line += ` — R$ ${Number(p.monthly_fee).toLocaleString('pt-BR', { minimumFractionDigits: 0 })}/mês`;
            if (p.material_fee) line += ` | Material: R$ ${Number(p.material_fee).toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`;
            if (p.schedule) line += ` | Horário: ${p.schedule}`;
            if (p.description && !p.monthly_fee) line += ` — ${p.description}`;
            return line;
          });
          const categoryName = products[0].category;
          // Se nenhuma unidade foi especificada, anota a unidade em cada linha
          // pra deixar claro pro cliente que valores variam por unidade.
          if (!resolvedUnitId) {
            const unitNameById: Record<string, string> = {};
            const { data: allUnits } = await supabase.from("school_units").select("id, name");
            (allUnits || []).forEach((u: any) => { unitNameById[u.id] = u.name; });
            const linesWithUnit = products.map((p: any) => {
              const unitTag = p.unit_id ? ` [${unitNameById[p.unit_id] || p.unit_id}]` : "";
              let line = `• ${p.name}${unitTag}`;
              if (p.monthly_fee) line += ` — R$ ${Number(p.monthly_fee).toLocaleString('pt-BR', { minimumFractionDigits: 0 })}/mês`;
              if (p.material_fee) line += ` | Material: R$ ${Number(p.material_fee).toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`;
              if (p.schedule) line += ` | Horário: ${p.schedule}`;
              return line;
            });
            return `📚 ${categoryName} (valores por unidade):\n${linesWithUnit.join("\n")}`;
          }
          return `📚 ${categoryName}${unitSuffix}:\n${lines.join("\n")}`;
        }

        // Fallback to school_levels for backward compatibility
        if (productError || !products || (products as unknown[]).length === 0) {
          const { data: levels, error: levelsError } = await supabase.from("school_levels").select("*");
          if (!levelsError && levels && levels.length > 0) {
            if (!nivelLower || nivelLower === "todos") {
              const resumo = levels.map((m) => `📚 ${m.nivel} (${m.descricao})\n   Mensalidade: R$ ${m.preco_mensal}/mês`).join("\n\n");
              return `📋 CURSOS E MENSALIDADES DO COLÉGIO IDEAL:\n\n${resumo}`;
            }
            const match = levels.find((m) => m.nivel.toLowerCase().includes(nivelLower));
            if (match) {
              const incluso = (match.incluso as string).split(",").map((i: string) => `  • ${i.trim()}`).join("\n");
              return `📚 ${match.nivel} (${match.descricao})\n💰 Mensalidade: R$ ${match.preco_mensal}/mês\n💰 Semestral: R$ ${match.preco_semestral} | Anual: R$ ${match.preco_anual}\n✅ Incluso:\n${incluso}`;
            }
          }
        }

        if (nivelLower) {
          return `Nível "${nivel}" não encontrado na base de dados. Por favor, entre em contato com a secretaria para mais informações.`;
        }
      }

      // Local JSON fallback
      const kb = loadKnowledgeBase();
      if (!nivel || nivel.toLowerCase() === "todos") {
        const resumo = kb.mensalidades
          .map((m) => `📚 ${m.nivel} (${m.descricao})\n   Mensalidade: R$ ${m.preco_mensal}/mês`)
          .join("\n\n");
        return `📋 CURSOS E MENSALIDADES DO COLÉGIO IDEAL:\n\n${resumo}`;
      }
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
    "Obt�m informa��es de contato para d�vidas sobre matr�cula e inscri��o",
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

// Ferramenta: Consultar informações de unidades/campi do colégio
const consultarUnidadesTool: KBTool = {
  name: "get_unit_info",
  description:
    "Obtém informações sobre as unidades/campi do Colégio Ideal: endereço, telefone, WhatsApp, horário de funcionamento, níveis oferecidos, infraestrutura, atividades extracurriculares e capacidade (número de alunos). Use sempre que o cliente perguntar sobre unidade, sede, campus, endereço, onde fica, horário de funcionamento da escola, quantos alunos, capacidade, infraestrutura, atividades. Aceita o argumento opcional 'unit' com nome da unidade (Sede/Batista Campos, Augusto Montenegro, Cidade Nova). Se não especificar, retorna resumo de todas.",
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
        if (u.whatsapp) lines.push(`💬 WhatsApp: ${u.whatsapp}`);
        if (u.hours) lines.push(`🕐 Horário: ${u.hours}`);
        if (u.levels) lines.push(`🎓 Níveis: ${u.levels}`);
        if (u.infrastructure) lines.push(`🏗️ Infraestrutura: ${u.infrastructure}`);
        if (u.activities) lines.push(`⚽ Atividades: ${u.activities}`);
        if (u.capacity) lines.push(`👥 Capacidade: ${u.capacity}`);
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
