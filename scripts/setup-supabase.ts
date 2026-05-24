/**
 * Setup automático do Supabase para o Agente Ideal.
 * Cria todas as tabelas necessárias e popula os dados iniciais.
 *
 * Uso:
 *   npx tsx scripts/setup-supabase.ts
 *
 * Requer SUPABASE_URL e SUPABASE_ANON_KEY no .env
 */

import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ SUPABASE_URL e SUPABASE_ANON_KEY devem estar no .env');
  process.exit(1);
}

// Extrai o project ref da URL (ex: hczmzumcyprnwygfvyfz)
const projectRef = SUPABASE_URL.replace('https://', '').split('.')[0];

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─────────────────────────────────────────────────────────────────────────────
// Tenta executar SQL via Management REST API se tiver PAT disponível
// ─────────────────────────────────────────────────────────────────────────────
async function execSqlViaManagementApi(sql: string, pat: string): Promise<boolean> {
  return new Promise((resolve) => {
    const body = JSON.stringify({ query: sql });
    const options = {
      hostname: 'api.supabase.com',
      path: `/v1/projects/${projectRef}/database/query`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${pat}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          resolve(true);
        } else {
          console.error(`  API respondeu ${res.statusCode}: ${data}`);
          resolve(false);
        }
      });
    });

    req.on('error', () => resolve(false));
    req.write(body);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Verifica se uma tabela existe tentando um SELECT
// ─────────────────────────────────────────────────────────────────────────────
async function tableExists(tableName: string): Promise<boolean> {
  const { error } = await supabase.from(tableName).select('*', { count: 'exact', head: true });
  if (!error) return true;
  if (error.code === '42P01') return false; // relation does not exist
  // Outros erros (ex: RLS sem política) — tabela existe mas sem permissão
  if (error.message?.includes('row-level security')) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Popula dados iniciais da base de conhecimento (não requer DDL)
// ─────────────────────────────────────────────────────────────────────────────
async function seedKnowledgeBase() {
  console.log('\n📚 Populando base de conhecimento...');

  // school_levels
  const levels = [
    { id: 'ef1', nivel: 'Ensino Fundamental 1', descricao: '1º ao 5º ano', preco_mensal: 1200, preco_semestral: 7200, preco_anual: 14400, incluso: 'Material didático atualizado,Acompanhamento pedagógico individualizado,Simulados periódicos,Aulas em turno matutino ou vespertino' },
    { id: 'ef2', nivel: 'Ensino Fundamental 2', descricao: '6º ao 9º ano', preco_mensal: 1400, preco_semestral: 8400, preco_anual: 16800, incluso: 'Material didático atualizado,Acompanhamento pedagógico individualizado,Simulados periódicos,Preparação para transição ao Ensino Médio,Aulas em turno matutino' },
    { id: 'em', nivel: 'Ensino Médio', descricao: '1ª e 2ª série', preco_mensal: 1700, preco_semestral: 10200, preco_anual: 20400, incluso: 'Material didático atualizado,Acompanhamento pedagógico individualizado,Simulados periódicos,Preparação para Enem e vestibulares,Aulas em turno matutino' },
    { id: 'pre-enem', nivel: 'Pré-Enem (Eixo)', descricao: 'Terceirão e Cursinho', preco_mensal: 1900, preco_semestral: 11400, preco_anual: 22800, incluso: 'Material didático especializado para Enem,Acompanhamento pedagógico intensivo,Simulados mensais tipo Enem,Aulas de aprofundamento à tarde,Foco total em aprovação nas melhores universidades,Turno integral (matutino + tarde)' },
  ];

  const { error: levelsErr } = await supabase
    .from('school_levels')
    .upsert(levels, { onConflict: 'id' });

  if (levelsErr) {
    console.error('  ❌ school_levels:', levelsErr.message);
  } else {
    console.log('  ✅ school_levels — 4 registros inseridos/atualizados');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔌 Conectando ao Supabase: ${SUPABASE_URL}`);
  console.log(`   Project ref: ${projectRef}\n`);

  // Verifica quais tabelas já existem
  const tables = ['contacts', 'messages', 'school_levels', 'school_contacts', 'school_materials'];
  const existing: string[] = [];
  const missing: string[] = [];

  for (const t of tables) {
    const exists = await tableExists(t);
    if (exists) existing.push(t);
    else missing.push(t);
  }

  if (existing.length > 0) {
    console.log(`✅ Tabelas já existentes: ${existing.join(', ')}`);
  }

  if (missing.length === 0) {
    console.log('\n🎉 Todas as tabelas já existem no Supabase!\n');
    await seedKnowledgeBase();
    console.log('\n✅ Setup concluído. Inicie o servidor com: npm run dev');
    console.log(`   Painel admin: http://localhost:3000/admin/\n`);
    return;
  }

  console.log(`\n⚠️  Tabelas faltando: ${missing.join(', ')}`);
  console.log('\nPara criá-las automaticamente, precisamos do Supabase Personal Access Token (PAT).');
  console.log('Você pode obter em: https://supabase.com/dashboard/account/tokens\n');

  // Tenta via PAT se passado como argumento
  const pat = process.argv[2];
  if (pat) {
    console.log('🔑 PAT fornecido — tentando criar tabelas via Management API...\n');

    const sqlFile = path.resolve(__dirname, '../admin-panel/supabase-setup.sql');
    const fullSql = fs.readFileSync(sqlFile, 'utf-8');

    // Remove comentários e executa blocos principais
    const statements = fullSql
      .split(/;\s*\n/)
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('--'));

    let ok = 0;
    for (const stmt of statements) {
      const preview = stmt.substring(0, 60).replace(/\n/g, ' ');
      process.stdout.write(`  Executando: ${preview}... `);
      const success = await execSqlViaManagementApi(stmt, pat);
      if (success) { console.log('✅'); ok++; }
      else { console.log('❌'); }
    }

    console.log(`\n  ${ok}/${statements.length} statements executados com sucesso.`);
    await seedKnowledgeBase();
  } else {
    // Sem PAT — instrução para o SQL Editor
    console.log('─────────────────────────────────────────────────────────');
    console.log('OPÇÃO 1 — Automático (com PAT):');
    console.log('  1. Vá em: https://supabase.com/dashboard/account/tokens');
    console.log('  2. Crie um token (qualquer nome)');
    console.log('  3. Execute:');
    console.log('     npx tsx scripts/setup-supabase.ts SEU_TOKEN_AQUI');
    console.log('');
    console.log('OPÇÃO 2 — Manual (SQL Editor):');
    console.log(`  1. Abra: https://supabase.com/dashboard/project/${projectRef}/sql/new`);
    console.log('  2. Cole o conteúdo de: admin-panel/supabase-setup.sql');
    console.log('  3. Clique em Run (Ctrl+Enter)');
    console.log('─────────────────────────────────────────────────────────\n');
  }

  console.log(`\n✅ Após criar as tabelas, inicie com: npm run dev`);
  console.log(`   Painel admin: http://localhost:3000/admin/\n`);
}

main().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
