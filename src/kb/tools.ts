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
