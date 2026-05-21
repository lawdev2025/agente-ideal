import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase, closeDatabase, getDatabase } from '../src/db/connection';
import { createSchema } from '../src/db/init';
import { StateRepository, Message, Contact } from '../src/state/repository';

let repo: StateRepository;

beforeEach(() => {
  // Create a new in-memory DB for each test
  const counter = Math.random().toString(36).substring(7);
  process.env.DB_PATH = `file:memdb${counter}?mode=memory&cache=shared`;

  initDatabase();
  createSchema();
  repo = new StateRepository();
});

afterEach(() => {
  // Clear all data from tables before closing
  try {
    const db = getDatabase();
    db.exec('DELETE FROM inbound_queue');
    db.exec('DELETE FROM messages');
    db.exec('DELETE FROM contacts');
    db.exec('DELETE FROM dead_letter');
  } catch {
    // Ignore errors
  }
  closeDatabase();
});

describe('StateRepository', () => {
  describe('appendMessage', () => {
    it('should append a message and return its ID', () => {
      const messageId = repo.appendMessage(
        '5511999999999',
        'user',
        'Hello, how much is the tuition?'
      );

      expect(messageId).toBeGreaterThan(0);
    });

    it('should append multiple messages for different contacts', () => {
      const id1 = repo.appendMessage('5511111111111', 'user', 'Message 1');
      const id2 = repo.appendMessage('5522222222222', 'user', 'Message 2');

      expect(id1).toBeGreaterThan(0);
      expect(id2).toBeGreaterThan(0);
      expect(id1).not.toBe(id2);
    });

    it('should store message with correct role', () => {
      const userId = repo.appendMessage(
        '5511999999999',
        'user',
        'User message'
      );
      const assistantId = repo.appendMessage(
        '5511999999999',
        'assistant',
        'Assistant response'
      );

      const history = repo.getHistory('5511999999999');
      expect(history).toHaveLength(2);
      expect(history[0].role).toBe('user');
      expect(history[1].role).toBe('assistant');
    });

    it('should store message content correctly', () => {
      const content = 'This is a test message with special chars: @#$%';
      repo.appendMessage('5511999999999', 'user', content);

      const history = repo.getHistory('5511999999999');
      expect(history[0].content).toBe(content);
    });

    it('should store message timestamp', () => {
      const beforeTime = Date.now();
      repo.appendMessage('5511999999999', 'user', 'Test');
      const afterTime = Date.now();

      const history = repo.getHistory('5511999999999');
      expect(history[0].created_at).toBeGreaterThanOrEqual(beforeTime);
      expect(history[0].created_at).toBeLessThanOrEqual(afterTime);
    });
  });

  describe('getHistory', () => {
    it('should return empty array for contact with no messages', () => {
      const history = repo.getHistory('5511999999999');
      expect(history).toEqual([]);
    });

    it('should return messages ordered from oldest to newest', () => {
      repo.appendMessage('5511999999999', 'user', 'First');
      repo.appendMessage('5511999999999', 'assistant', 'Second');
      repo.appendMessage('5511999999999', 'user', 'Third');

      const history = repo.getHistory('5511999999999');
      expect(history).toHaveLength(3);
      expect(history[0].content).toBe('First');
      expect(history[1].content).toBe('Second');
      expect(history[2].content).toBe('Third');
    });

    it('should respect the limit parameter', () => {
      for (let i = 0; i < 15; i++) {
        repo.appendMessage('5511999999999', 'user', `Message ${i}`);
      }

      const history = repo.getHistory('5511999999999', 10);
      expect(history).toHaveLength(10);
      // Should return the last 10 messages (messages 5-14, reversed to oldest-first)
      expect(history[0].content).toBe('Message 5');
      expect(history[9].content).toBe('Message 14');
      // Verify they are in the correct order
      for (let i = 0; i < 10; i++) {
        expect(history[i].content).toBe(`Message ${i + 5}`);
      }
    });

    it('should default to limit of 10', () => {
      for (let i = 0; i < 15; i++) {
        repo.appendMessage('5511999999999', 'user', `Message ${i}`);
      }

      const history = repo.getHistory('5511999999999');
      expect(history).toHaveLength(10);
    });

    it('should isolate messages by contact', () => {
      repo.appendMessage('5511111111111', 'user', 'Contact 1 message 1');
      repo.appendMessage('5511111111111', 'user', 'Contact 1 message 2');
      repo.appendMessage('5522222222222', 'user', 'Contact 2 message 1');

      const history1 = repo.getHistory('5511111111111');
      const history2 = repo.getHistory('5522222222222');

      expect(history1).toHaveLength(2);
      expect(history2).toHaveLength(1);
      expect(history1[0].content).toBe('Contact 1 message 1');
      expect(history2[0].content).toBe('Contact 2 message 1');
    });

    it('should return messages with all fields populated', () => {
      repo.appendMessage('5511999999999', 'user', 'Test message');

      const history = repo.getHistory('5511999999999');
      const message = history[0];

      expect(message).toHaveProperty('id');
      expect(message).toHaveProperty('wa_id');
      expect(message).toHaveProperty('role');
      expect(message).toHaveProperty('content');
      expect(message).toHaveProperty('created_at');
      expect(message.wa_id).toBe('5511999999999');
      expect(message.role).toBe('user');
      expect(message.content).toBe('Test message');
    });
  });

  describe('getOrCreateContact', () => {
    it('should create a new contact with default values', () => {
      const contact = repo.getOrCreateContact('5511999999999');

      expect(contact.wa_id).toBe('5511999999999');
      expect(contact.bot_paused).toBe(false);
      expect(contact.paused_reason).toBeNull();
      expect(contact.paused_at).toBeNull();
      expect(contact.last_seen_at).toBeNull();
    });

    it('should return existing contact without creating duplicate', () => {
      const contact1 = repo.getOrCreateContact('5511999999999');
      const contact2 = repo.getOrCreateContact('5511999999999');

      expect(contact1).toEqual(contact2);
    });

    it('should return contact with correct boolean conversion from database', () => {
      // Pause bot first
      repo.pauseBot('5511999999999', 'test reason');

      const contact = repo.getOrCreateContact('5511999999999');

      expect(contact.bot_paused).toBe(true);
      expect(contact.paused_reason).toBe('test reason');
    });

    it('should isolate contacts', () => {
      const contact1 = repo.getOrCreateContact('5511111111111');
      const contact2 = repo.getOrCreateContact('5522222222222');

      expect(contact1.wa_id).toBe('5511111111111');
      expect(contact2.wa_id).toBe('5522222222222');
    });
  });

  describe('pauseBot', () => {
    it('should pause bot and set reason', () => {
      const reason = 'Escalated to human support';
      repo.pauseBot('5511999999999', reason);

      const contact = repo.getOrCreateContact('5511999999999');
      expect(contact.bot_paused).toBe(true);
      expect(contact.paused_reason).toBe(reason);
    });

    it('should set paused_at timestamp', () => {
      const beforeTime = Date.now();
      repo.pauseBot('5511999999999', 'test reason');
      const afterTime = Date.now();

      const contact = repo.getOrCreateContact('5511999999999');
      expect(contact.paused_at).toBeGreaterThanOrEqual(beforeTime);
      expect(contact.paused_at).toBeLessThanOrEqual(afterTime);
    });

    it('should create contact if it does not exist', () => {
      repo.pauseBot('5511999999999', 'test reason');

      const contact = repo.getOrCreateContact('5511999999999');
      expect(contact.wa_id).toBe('5511999999999');
      expect(contact.bot_paused).toBe(true);
    });

    it('should update pause reason when called multiple times', () => {
      repo.pauseBot('5511999999999', 'First reason');
      repo.pauseBot('5511999999999', 'Second reason');

      const contact = repo.getOrCreateContact('5511999999999');
      expect(contact.paused_reason).toBe('Second reason');
    });
  });

  describe('resumeBot', () => {
    it('should resume bot and clear pause status', () => {
      repo.pauseBot('5511999999999', 'test reason');
      repo.resumeBot('5511999999999');

      const contact = repo.getOrCreateContact('5511999999999');
      expect(contact.bot_paused).toBe(false);
      expect(contact.paused_reason).toBeNull();
      expect(contact.paused_at).toBeNull();
    });

    it('should create contact if it does not exist', () => {
      repo.resumeBot('5511999999999');

      const contact = repo.getOrCreateContact('5511999999999');
      expect(contact.wa_id).toBe('5511999999999');
      expect(contact.bot_paused).toBe(false);
    });

    it('should be idempotent when bot is not paused', () => {
      repo.resumeBot('5511999999999');
      repo.resumeBot('5511999999999');

      const contact = repo.getOrCreateContact('5511999999999');
      expect(contact.bot_paused).toBe(false);
    });
  });

  describe('isBotPaused', () => {
    it('should return false for non-existent contact', () => {
      const paused = repo.isBotPaused('5511999999999');
      expect(paused).toBe(false);
    });

    it('should return false for non-paused contact', () => {
      repo.getOrCreateContact('5511999999999');
      const paused = repo.isBotPaused('5511999999999');
      expect(paused).toBe(false);
    });

    it('should return true for paused contact', () => {
      repo.pauseBot('5511999999999', 'test reason');
      const paused = repo.isBotPaused('5511999999999');
      expect(paused).toBe(true);
    });

    it('should return false after resuming bot', () => {
      repo.pauseBot('5511999999999', 'test reason');
      repo.resumeBot('5511999999999');

      const paused = repo.isBotPaused('5511999999999');
      expect(paused).toBe(false);
    });

    it('should isolate pause state by contact', () => {
      repo.pauseBot('5511111111111', 'paused');
      repo.getOrCreateContact('5522222222222'); // Not paused

      const paused1 = repo.isBotPaused('5511111111111');
      const paused2 = repo.isBotPaused('5522222222222');

      expect(paused1).toBe(true);
      expect(paused2).toBe(false);
    });
  });

  describe('updateLastSeen', () => {
    it('should set last_seen_at timestamp to now', () => {
      const beforeTime = Date.now();
      repo.updateLastSeen('5511999999999');
      const afterTime = Date.now();

      const contact = repo.getOrCreateContact('5511999999999');
      expect(contact.last_seen_at).toBeGreaterThanOrEqual(beforeTime);
      expect(contact.last_seen_at).toBeLessThanOrEqual(afterTime);
    });

    it('should create contact if it does not exist', () => {
      repo.updateLastSeen('5511999999999');

      const contact = repo.getOrCreateContact('5511999999999');
      expect(contact.wa_id).toBe('5511999999999');
      expect(contact.last_seen_at).not.toBeNull();
    });

    it('should update last_seen_at on each call', () => {
      repo.updateLastSeen('5511999999999');
      const firstTime = repo.getOrCreateContact('5511999999999').last_seen_at;

      // Small delay to ensure different timestamp
      const startWait = Date.now();
      while (Date.now() - startWait < 5) {
        // Wait 5ms
      }

      repo.updateLastSeen('5511999999999');
      const secondTime = repo.getOrCreateContact('5511999999999').last_seen_at;

      expect(secondTime).toBeGreaterThan(firstTime!);
    });

    it('should isolate last_seen_at by contact', () => {
      repo.updateLastSeen('5511111111111');

      // Small delay to ensure different timestamp
      const startWait = Date.now();
      while (Date.now() - startWait < 5) {
        // Wait 5ms
      }

      repo.updateLastSeen('5522222222222');

      const contact1 = repo.getOrCreateContact('5511111111111');
      const contact2 = repo.getOrCreateContact('5522222222222');

      expect(contact1.last_seen_at).toBeLessThan(contact2.last_seen_at!);
    });
  });

  describe('Integration scenarios', () => {
    it('should handle a complete conversation flow', () => {
      const waId = '5511999999999';

      // User sends a message
      const msgId1 = repo.appendMessage(
        waId,
        'user',
        'What is the tuition cost?'
      );
      expect(msgId1).toBeGreaterThan(0);

      // Update last seen
      repo.updateLastSeen(waId);

      // Get history (should have 1 message)
      let history = repo.getHistory(waId);
      expect(history).toHaveLength(1);

      // Assistant responds
      const msgId2 = repo.appendMessage(
        waId,
        'assistant',
        'The tuition is R$ 1500'
      );
      expect(msgId2).toBeGreaterThan(0);

      // Get updated history
      history = repo.getHistory(waId);
      expect(history).toHaveLength(2);

      // Check contact state
      const contact = repo.getOrCreateContact(waId);
      expect(contact.bot_paused).toBe(false);
      expect(contact.last_seen_at).not.toBeNull();
    });

    it('should handle pause/resume flow with messages', () => {
      const waId = '5511999999999';

      // Add some messages
      repo.appendMessage(waId, 'user', 'Message 1');
      repo.appendMessage(waId, 'assistant', 'Response 1');

      // Pause bot
      repo.pauseBot(waId, 'Escalated to human');

      // Check contact state
      let contact = repo.getOrCreateContact(waId);
      expect(contact.bot_paused).toBe(true);

      // Continue adding messages (messages are stored even when paused)
      repo.appendMessage(waId, 'user', 'Message 2');

      // History should still work
      const history = repo.getHistory(waId);
      expect(history).toHaveLength(3);

      // Resume bot
      repo.resumeBot(waId);

      // Check contact state
      contact = repo.getOrCreateContact(waId);
      expect(contact.bot_paused).toBe(false);
    });

    it('should maintain separate state for multiple contacts', () => {
      const waId1 = '5511111111111';
      const waId2 = '5522222222222';

      // Contact 1: add messages
      repo.appendMessage(waId1, 'user', 'Message from contact 1');
      repo.appendMessage(waId1, 'assistant', 'Response to contact 1');

      // Contact 2: add different messages
      repo.appendMessage(waId2, 'user', 'Message from contact 2');

      // Contact 1: pause
      repo.pauseBot(waId1, 'Paused reason 1');

      // Contact 2: not paused
      repo.pauseBot(waId2, 'Paused reason 2');

      // Verify isolation
      const contact1 = repo.getOrCreateContact(waId1);
      const contact2 = repo.getOrCreateContact(waId2);

      expect(contact1.paused_reason).toBe('Paused reason 1');
      expect(contact2.paused_reason).toBe('Paused reason 2');

      const history1 = repo.getHistory(waId1);
      const history2 = repo.getHistory(waId2);

      expect(history1).toHaveLength(2);
      expect(history2).toHaveLength(1);
    });
  });
});
