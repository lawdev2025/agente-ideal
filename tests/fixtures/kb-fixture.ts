import { KnowledgeBase, Mensalidade, CalendarioPeriodo, MaterialGrupo, Contato } from '../../src/kb/loader';

export const mockMensalidades: Mensalidade[] = [
  {
    id: 'tuition_infantil_integral',
    nivel: 'Educação Infantil',
    descricao: 'Período Integral (7h às 17h)',
    preco_mensal: 1500.00,
    preco_semestral: 8500.00,
    preco_anual: 16000.00,
    incluso: [
      'Aulas de educação física',
      'Aulas de inglês',
      'Alimentação (café, almoço, lanche)',
      'Atividades extracurriculares'
    ]
  },
  {
    id: 'tuition_fundamental_1',
    nivel: 'Ensino Fundamental I (1º a 5º ano)',
    descricao: 'Período Integral (7h às 17h)',
    preco_mensal: 1800.00,
    preco_semestral: 10000.00,
    preco_anual: 19000.00,
    incluso: [
      'Aulas regulares',
      'Aulas de educação física',
      'Aulas de inglês',
      'Aulas de tecnologia',
      'Alimentação (café, almoço, lanche)'
    ]
  }
];

export const mockCalendario: CalendarioPeriodo[] = [
  {
    id: 'semestre_1',
    nome: 'Primeiro Semestre 2024',
    data_inicio: '2024-02-01',
    data_fim: '2024-06-30',
    eventos: [
      {
        data: '2024-02-12',
        evento: 'Início das aulas',
        tipo: 'aula'
      },
      {
        data: '2024-03-08',
        evento: 'Dia Internacional da Mulher - Feriado',
        tipo: 'feriado'
      },
      {
        data: '2024-06-30',
        evento: 'Encerramento do primeiro semestre',
        tipo: 'encerramento'
      }
    ]
  }
];

export const mockMateriais: MaterialGrupo[] = [
  {
    id: 'materiais_infantil',
    nivel: 'Educação Infantil (3 a 5 anos)',
    descricao: 'Lista de materiais para Educação Infantil',
    materiais: [
      {
        nome: 'Mochila escolar',
        quantidade: 1,
        especificacoes: 'Tamanho pequeno (não muito pesada)'
      },
      {
        nome: 'Uniforme',
        quantidade: 3,
        especificacoes: 'Conforme tabela de tamanhos da escola'
      },
      {
        nome: 'Estojo com materiais básicos',
        quantidade: 1,
        especificacoes: 'Lápis de cor, giz de cera, tesoura de ponta arredondada, cola, borracha'
      }
    ]
  }
];

export const mockContatos: Contato[] = [
  {
    id: 'contato_principal',
    nome: 'Secretaria Escolar',
    tipo: 'secretaria',
    telefone: '551133334444',
    email: 'secretaria@escolaideal.com.br',
    horario_funcionamento: '8h às 17h - Segunda a Sexta',
    descricao: 'Atendimento geral, matrículas e informações administrativas'
  },
  {
    id: 'contato_financeiro',
    nome: 'Departamento Financeiro',
    tipo: 'financeiro',
    telefone: '551133334445',
    email: 'financeiro@escolaideal.com.br',
    horario_funcionamento: '9h às 16h - Segunda a Quinta',
    descricao: 'Informações sobre boletos, parcelamento e financiamento',
    ramal: '105'
  },
  {
    id: 'contato_emergencia',
    nome: 'Emergência Escolar',
    tipo: 'emergencia',
    telefone: '551133334448',
    email: 'emergencia@escolaideal.com.br',
    descricao: 'Atendimento 24h para situações de emergência com alunos',
    disponibilidade: '24 horas, 7 dias por semana'
  }
];

export const mockKnowledgeBase: KnowledgeBase = {
  mensalidades: mockMensalidades,
  calendario: mockCalendario,
  materiais: mockMateriais,
  contatos: mockContatos
};
