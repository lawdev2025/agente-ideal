import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadKnowledgeBase,
  getMensalidadesByNivel,
  getCalendarioEventos,
  getMaterialsByNivel,
  getContatosByTipo,
  formatMensalidade,
  formatContato,
  KnowledgeBase,
  Mensalidade,
  CalendarioPeriodo,
  MaterialGrupo,
  Contato
} from '../src/kb/loader';
import {
  mockKnowledgeBase,
  mockMensalidades,
  mockCalendario,
  mockMateriais,
  mockContatos
} from './fixtures/kb-fixture';

describe('Knowledge Base Loader', () => {
  describe('loadKnowledgeBase', () => {
    it('should load all KB data successfully', () => {
      const kb = loadKnowledgeBase();

      expect(kb).toBeDefined();
      expect(kb.mensalidades).toBeDefined();
      expect(kb.calendario).toBeDefined();
      expect(kb.materiais).toBeDefined();
      expect(kb.contatos).toBeDefined();
    });

    it('should load mensalidades array', () => {
      const kb = loadKnowledgeBase();

      expect(Array.isArray(kb.mensalidades)).toBe(true);
      expect(kb.mensalidades.length).toBeGreaterThan(0);
    });

    it('should load calendario array', () => {
      const kb = loadKnowledgeBase();

      expect(Array.isArray(kb.calendario)).toBe(true);
      expect(kb.calendario.length).toBeGreaterThan(0);
    });

    it('should load materiais array', () => {
      const kb = loadKnowledgeBase();

      expect(Array.isArray(kb.materiais)).toBe(true);
      expect(kb.materiais.length).toBeGreaterThan(0);
    });

    it('should load contatos array', () => {
      const kb = loadKnowledgeBase();

      expect(Array.isArray(kb.contatos)).toBe(true);
      expect(kb.contatos.length).toBeGreaterThan(0);
    });
  });

  describe('getMensalidadesByNivel', () => {
    it('should return mensalidades for Educação Infantil', () => {
      const result = getMensalidadesByNivel(mockKnowledgeBase, 'Educação Infantil');

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].nivel).toContain('Educação Infantil');
    });

    it('should return mensalidades for Fundamental', () => {
      const result = getMensalidadesByNivel(mockKnowledgeBase, 'Fundamental');

      expect(result.length).toBeGreaterThan(0);
      result.forEach(m => {
        expect(m.nivel.toLowerCase()).toContain('fundamental');
      });
    });

    it('should be case-insensitive', () => {
      const result1 = getMensalidadesByNivel(mockKnowledgeBase, 'infantil');
      const result2 = getMensalidadesByNivel(mockKnowledgeBase, 'INFANTIL');

      expect(result1).toEqual(result2);
    });

    it('should return empty array for non-existent nivel', () => {
      const result = getMensalidadesByNivel(mockKnowledgeBase, 'Nível Inexistente');

      expect(result).toEqual([]);
    });

    it('should contain required fields in result', () => {
      const result = getMensalidadesByNivel(mockKnowledgeBase, 'Infantil');

      if (result.length > 0) {
        const m = result[0];
        expect(m).toHaveProperty('id');
        expect(m).toHaveProperty('nivel');
        expect(m).toHaveProperty('descricao');
        expect(m).toHaveProperty('preco_mensal');
        expect(m).toHaveProperty('preco_semestral');
        expect(m).toHaveProperty('preco_anual');
        expect(m).toHaveProperty('incluso');
      }
    });

    it('should have valid price format', () => {
      const result = getMensalidadesByNivel(mockKnowledgeBase, 'Infantil');

      result.forEach(m => {
        expect(typeof m.preco_mensal).toBe('number');
        expect(typeof m.preco_semestral).toBe('number');
        expect(typeof m.preco_anual).toBe('number');
        expect(m.preco_mensal).toBeGreaterThan(0);
        expect(m.preco_semestral).toBeGreaterThan(0);
        expect(m.preco_anual).toBeGreaterThan(0);
      });
    });

    it('should have incluso as array', () => {
      const result = getMensalidadesByNivel(mockKnowledgeBase, 'Infantil');

      result.forEach(m => {
        expect(Array.isArray(m.incluso)).toBe(true);
        expect(m.incluso.length).toBeGreaterThan(0);
      });
    });
  });

  describe('getCalendarioEventos', () => {
    it('should return eventos for date range', () => {
      const result = getCalendarioEventos(mockKnowledgeBase, '2024-01-01', '2024-12-31');

      expect(Array.isArray(result)).toBe(true);
    });

    it('should filter eventos within date range', () => {
      const result = getCalendarioEventos(mockKnowledgeBase, '2024-02-01', '2024-03-31');

      result.forEach(e => {
        expect(e.data >= '2024-02-01').toBe(true);
        expect(e.data <= '2024-03-31').toBe(true);
      });
    });

    it('should exclude eventos outside date range', () => {
      const result = getCalendarioEventos(mockKnowledgeBase, '2024-12-01', '2024-12-15');

      // Should not include events outside this range
      result.forEach(e => {
        expect(e.data).toBeGreaterThanOrEqual('2024-12-01');
        expect(e.data).toBeLessThanOrEqual('2024-12-15');
      });
    });

    it('should return sorted eventos by date', () => {
      const result = getCalendarioEventos(mockKnowledgeBase, '2024-01-01', '2024-12-31');

      for (let i = 1; i < result.length; i++) {
        expect(result[i].data >= result[i - 1].data).toBe(true);
      }
    });

    it('should contain required fields', () => {
      const result = getCalendarioEventos(mockKnowledgeBase, '2024-02-01', '2024-03-31');

      if (result.length > 0) {
        result.forEach(e => {
          expect(e).toHaveProperty('data');
          expect(e).toHaveProperty('evento');
          expect(e).toHaveProperty('tipo');
        });
      }
    });

    it('should return empty array for date range with no eventos', () => {
      const result = getCalendarioEventos(mockKnowledgeBase, '2099-01-01', '2099-12-31');

      expect(result).toEqual([]);
    });
  });

  describe('getMaterialsByNivel', () => {
    it('should return materiais for Educação Infantil', () => {
      const result = getMaterialsByNivel(mockKnowledgeBase, 'Infantil');

      expect(result.length).toBeGreaterThan(0);
    });

    it('should be case-insensitive', () => {
      const result1 = getMaterialsByNivel(mockKnowledgeBase, 'infantil');
      const result2 = getMaterialsByNivel(mockKnowledgeBase, 'INFANTIL');

      expect(result1).toEqual(result2);
    });

    it('should contain required fields', () => {
      const result = getMaterialsByNivel(mockKnowledgeBase, 'Infantil');

      if (result.length > 0) {
        const g = result[0];
        expect(g).toHaveProperty('id');
        expect(g).toHaveProperty('nivel');
        expect(g).toHaveProperty('descricao');
        expect(g).toHaveProperty('materiais');
      }
    });

    it('should have materiais array with required fields', () => {
      const result = getMaterialsByNivel(mockKnowledgeBase, 'Infantil');

      result.forEach(g => {
        expect(Array.isArray(g.materiais)).toBe(true);
        g.materiais.forEach(m => {
          expect(m).toHaveProperty('nome');
          expect(m).toHaveProperty('quantidade');
          expect(m).toHaveProperty('especificacoes');
        });
      });
    });

    it('should return empty array for non-existent nivel', () => {
      const result = getMaterialsByNivel(mockKnowledgeBase, 'Nível Inexistente');

      expect(result).toEqual([]);
    });
  });

  describe('getContatosByTipo', () => {
    it('should return contatos for secretaria', () => {
      const result = getContatosByTipo(mockKnowledgeBase, 'secretaria');

      expect(result.length).toBeGreaterThan(0);
      result.forEach(c => {
        expect(c.tipo).toBe('secretaria');
      });
    });

    it('should return contatos for financeiro', () => {
      const result = getContatosByTipo(mockKnowledgeBase, 'financeiro');

      expect(result.length).toBeGreaterThan(0);
      result.forEach(c => {
        expect(c.tipo).toBe('financeiro');
      });
    });

    it('should be case-insensitive', () => {
      const result1 = getContatosByTipo(mockKnowledgeBase, 'secretaria');
      const result2 = getContatosByTipo(mockKnowledgeBase, 'SECRETARIA');

      expect(result1).toEqual(result2);
    });

    it('should contain required fields', () => {
      const result = getContatosByTipo(mockKnowledgeBase, 'secretaria');

      if (result.length > 0) {
        const c = result[0];
        expect(c).toHaveProperty('id');
        expect(c).toHaveProperty('nome');
        expect(c).toHaveProperty('tipo');
        expect(c).toHaveProperty('telefone');
        expect(c).toHaveProperty('descricao');
      }
    });

    it('should return empty array for non-existent tipo', () => {
      const result = getContatosByTipo(mockKnowledgeBase, 'tipo-inexistente');

      expect(result).toEqual([]);
    });

    it('should include optional fields when present', () => {
      const result = getContatosByTipo(mockKnowledgeBase, 'financeiro');

      if (result.length > 0) {
        const c = result[0];
        // Some contatos may have email, ramal, etc
        if (c.email) expect(typeof c.email).toBe('string');
        if (c.ramal) expect(typeof c.ramal).toBe('string');
        if (c.horario_funcionamento) expect(typeof c.horario_funcionamento).toBe('string');
      }
    });
  });

  describe('formatMensalidade', () => {
    it('should format mensalidade with all details', () => {
      const m = mockMensalidades[0];
      const formatted = formatMensalidade(m);

      expect(formatted).toContain(m.descricao);
      expect(formatted).toContain(m.nivel);
      expect(formatted).toContain('R$');
    });

    it('should include pricing information', () => {
      const m = mockMensalidades[0];
      const formatted = formatMensalidade(m);

      expect(formatted).toContain(m.preco_mensal.toFixed(2));
      expect(formatted).toContain(m.preco_semestral.toFixed(2));
      expect(formatted).toContain(m.preco_anual.toFixed(2));
    });

    it('should include incluso items', () => {
      const m = mockMensalidades[0];
      const formatted = formatMensalidade(m);

      m.incluso.forEach(item => {
        expect(formatted).toContain(item);
      });
    });

    it('should format as readable markdown', () => {
      const m = mockMensalidades[0];
      const formatted = formatMensalidade(m);

      expect(formatted).toContain('**');
      expect(formatted).toContain('•');
      expect(formatted.length).toBeGreaterThan(0);
    });
  });

  describe('formatContato', () => {
    it('should format contato with required fields', () => {
      const c = mockContatos[0];
      const formatted = formatContato(c);

      expect(formatted).toContain(c.nome);
      expect(formatted).toContain(c.tipo);
      expect(formatted).toContain(c.descricao);
      expect(formatted).toContain(c.telefone);
    });

    it('should include email when present', () => {
      const c = mockContatos[0];
      if (c.email) {
        const formatted = formatContato(c);
        expect(formatted).toContain(c.email);
      }
    });

    it('should include ramal when present', () => {
      const c = mockContatos.find(ct => ct.ramal);
      if (c && c.ramal) {
        const formatted = formatContato(c);
        expect(formatted).toContain(c.ramal);
      }
    });

    it('should include horario_funcionamento when present', () => {
      const c = mockContatos.find(ct => ct.horario_funcionamento);
      if (c && c.horario_funcionamento) {
        const formatted = formatContato(c);
        expect(formatted).toContain(c.horario_funcionamento);
      }
    });

    it('should include disponibilidade when present', () => {
      const c = mockContatos.find(ct => ct.disponibilidade);
      if (c && c.disponibilidade) {
        const formatted = formatContato(c);
        expect(formatted).toContain(c.disponibilidade);
      }
    });

    it('should format as readable markdown', () => {
      const c = mockContatos[0];
      const formatted = formatContato(c);

      expect(formatted).toContain('**');
      expect(formatted.length).toBeGreaterThan(0);
    });

    it('should handle contatos without optional fields gracefully', () => {
      const minimalContato: Contato = {
        id: 'test',
        nome: 'Test Contact',
        tipo: 'test',
        telefone: '123456',
        descricao: 'Test description'
      };

      const formatted = formatContato(minimalContato);

      expect(formatted).toContain(minimalContato.nome);
      expect(formatted).toContain(minimalContato.telefone);
      expect(formatted).toContain(minimalContato.descricao);
    });
  });

  describe('Integration tests', () => {
    it('should provide a complete knowledge base with all sections', () => {
      const kb = loadKnowledgeBase();

      // Verify each section has content
      expect(kb.mensalidades.length).toBeGreaterThan(0);
      expect(kb.calendario.length).toBeGreaterThan(0);
      expect(kb.materiais.length).toBeGreaterThan(0);
      expect(kb.contatos.length).toBeGreaterThan(0);

      // Verify types
      const m = kb.mensalidades[0];
      expect(m.preco_mensal).toBeGreaterThan(0);

      const cal = kb.calendario[0];
      expect(cal.data_inicio).toBeDefined();

      const mat = kb.materiais[0];
      expect(mat.materiais.length).toBeGreaterThan(0);

      const con = kb.contatos[0];
      expect(con.telefone).toBeDefined();
    });

    it('should support queries for tuition by education level', () => {
      const kb = loadKnowledgeBase();

      // Test common queries
      const infantil = getMensalidadesByNivel(kb, 'infantil');
      expect(infantil.length).toBeGreaterThan(0);

      const fundamental = getMensalidadesByNivel(kb, 'fundamental');
      expect(fundamental.length).toBeGreaterThan(0);
    });

    it('should support queries for materials by education level', () => {
      const kb = loadKnowledgeBase();

      const infantil = getMaterialsByNivel(kb, 'infantil');
      expect(infantil.length).toBeGreaterThan(0);
      expect(infantil[0].materiais.length).toBeGreaterThan(0);
    });

    it('should support queries for contacts by type', () => {
      const kb = loadKnowledgeBase();

      const secretaria = getContatosByTipo(kb, 'secretaria');
      expect(secretaria.length).toBeGreaterThan(0);

      const emergencia = getContatosByTipo(kb, 'emergencia');
      expect(emergencia.length).toBeGreaterThan(0);
    });

    it('should provide calendar events for any given period', () => {
      const kb = loadKnowledgeBase();

      const events = getCalendarioEventos(kb, '2024-01-01', '2024-12-31');
      expect(events.length).toBeGreaterThan(0);

      // Verify events are sorted
      for (let i = 1; i < events.length; i++) {
        expect(events[i].data >= events[i - 1].data).toBe(true);
      }
    });
  });
});
