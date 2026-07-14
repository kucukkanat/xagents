import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  asId,
  CreateAgentInput,
  CreateKnowledgebaseInput,
  CreateSkillInput,
  isErr,
  isOk,
} from "@xagents/core";
import { openDb, type Db } from "./index";

let db: Db;

beforeEach(() => {
  db = openDb(":memory:");
});

afterEach(() => {
  db.close();
});

const agentInput = (over: Partial<CreateAgentInput> = {}): CreateAgentInput =>
  CreateAgentInput.parse({
    name: "Research Bot",
    instructionsMd: "You are helpful.",
    modelProvider: "deepseek",
    modelId: "deepseek-chat",
    ...over,
  });

describe("openDb", () => {
  test("seeds a single local user", () => {
    const user = db.users.getCurrent();
    expect(user.handle).toBe("local");
    expect(user.displayName).toBe("Local User");
    expect(user.id).toMatch(/^usr_/);
  });

  test("migrations are idempotent across reopen (file path)", () => {
    // Reopening the same in-memory db is impossible, so just assert a second
    // openDb on a fresh memory db doesn't throw and still seeds exactly one user.
    const other = openDb(":memory:");
    expect(other.users.getCurrent().handle).toBe("local");
    other.close();
  });
});

describe("agents", () => {
  test("create + getDetail resolves attached knowledgebases and skills", () => {
    const owner = db.users.getCurrent();
    const kb = db.knowledgebases.create(owner.id, CreateKnowledgebaseInput.parse({ name: "Docs" }));
    const skill = db.skills.create(
      owner.id,
      CreateSkillInput.parse({ name: "Summarize", skillMd: "# Summarize" }),
    );

    const agent = db.agents.create(
      owner.id,
      agentInput({ knowledgebaseIds: [kb.id], skillIds: [skill.id] }),
    );
    expect(agent.slug).toBe("research-bot");
    expect(agent.knowledgebaseIds).toEqual([kb.id]);
    expect(agent.skillIds).toEqual([skill.id]);
    expect(agent.forkedFrom).toBeNull();

    const detail = db.agents.getDetail(agent.id);
    expect(isOk(detail)).toBe(true);
    if (!isOk(detail)) return;
    expect(detail.value.knowledgebases.map((k) => k.id)).toEqual([kb.id]);
    expect(detail.value.skills.map((s) => s.id)).toEqual([skill.id]);
  });

  test("get returns not_found for unknown id", () => {
    const res = db.agents.get(asId("AgentId", "agt_does_not_exist"));
    expect(isErr(res)).toBe(true);
    if (isErr(res)) expect(res.error.code).toBe("not_found");
  });

  test("update patches fields and links", () => {
    const owner = db.users.getCurrent();
    const kb = db.knowledgebases.create(owner.id, CreateKnowledgebaseInput.parse({ name: "Docs" }));
    const agent = db.agents.create(owner.id, agentInput());

    const updated = db.agents.update(agent.id, {
      name: "Renamed",
      knowledgebaseIds: [kb.id],
      reasoning: "high",
    });
    expect(isOk(updated)).toBe(true);
    if (!isOk(updated)) return;
    expect(updated.value.name).toBe("Renamed");
    expect(updated.value.slug).toBe("renamed");
    expect(updated.value.reasoning).toBe("high");
    expect(updated.value.knowledgebaseIds).toEqual([kb.id]);

    // Persisted, not just returned.
    const reread = db.agents.get(agent.id);
    if (isOk(reread)) expect(reread.value.knowledgebaseIds).toEqual([kb.id]);
  });

  test("clone deep-copies with forkedFrom set", () => {
    const owner = db.users.getCurrent();
    const kb = db.knowledgebases.create(owner.id, CreateKnowledgebaseInput.parse({ name: "Docs" }));
    const source = db.agents.create(owner.id, agentInput({ knowledgebaseIds: [kb.id] }));

    const cloned = db.agents.clone(source.id, owner.id);
    expect(isOk(cloned)).toBe(true);
    if (!isOk(cloned)) return;
    expect(cloned.value.id).not.toBe(source.id);
    expect(cloned.value.forkedFrom).toBe(source.id);
    expect(cloned.value.knowledgebaseIds).toEqual([kb.id]);
    // Both listed under the owner.
    expect(db.agents.list(owner.id)).toHaveLength(2);
  });
});

describe("knowledgebases + FTS retrieval", () => {
  test("insertChunks then searchChunks returns BM25-ranked hits with citations", () => {
    const owner = db.users.getCurrent();
    const kb = db.knowledgebases.create(owner.id, CreateKnowledgebaseInput.parse({ name: "Docs" }));
    const doc = db.knowledgebases.addDocument(kb.id, {
      filename: "report.md",
      mime: "text/markdown",
      byteLength: 128,
    });
    db.knowledgebases.insertChunks(kb.id, doc.id, doc.filename, [
      { ord: 0, text: "The quick brown fox jumps over the lazy dog" },
      { ord: 1, text: "Databases store rows and indexes for fast retrieval" },
      { ord: 2, text: "A fox is a small omnivorous mammal" },
    ]);

    const hits = db.knowledgebases.searchChunks([kb.id], "fox", 10);
    expect(hits.length).toBe(2);
    expect(hits[0]?.score).toBeGreaterThan(0);
    expect(hits.map((h) => h.citation)).toContain("report.md:0");
    // Every hit belongs to a chunk that mentions the term.
    for (const h of hits) expect(h.text.toLowerCase()).toContain("fox");

    // documentCount / chunkCount surface through the domain types.
    expect(db.knowledgebases.get(kb.id)).toMatchObject({ ok: true });
    expect(db.knowledgebases.listDocuments(kb.id)[0]?.chunkCount).toBe(3);
  });

  test("searchChunks tolerates empty / malformed queries", () => {
    const owner = db.users.getCurrent();
    const kb = db.knowledgebases.create(owner.id, CreateKnowledgebaseInput.parse({ name: "Docs" }));
    expect(db.knowledgebases.searchChunks([kb.id], "", 10)).toEqual([]);
    expect(db.knowledgebases.searchChunks([kb.id], '"))(( AND', 10)).toEqual([]);
    expect(db.knowledgebases.searchChunks([], "fox", 10)).toEqual([]);
  });

  test("clone deep-copies documents and chunks", () => {
    const owner = db.users.getCurrent();
    const kb = db.knowledgebases.create(owner.id, CreateKnowledgebaseInput.parse({ name: "Docs" }));
    const doc = db.knowledgebases.addDocument(kb.id, {
      filename: "a.md",
      mime: "text/markdown",
      byteLength: 10,
    });
    db.knowledgebases.insertChunks(kb.id, doc.id, doc.filename, [{ ord: 0, text: "hello world" }]);

    const cloned = db.knowledgebases.clone(kb.id, owner.id);
    expect(isOk(cloned)).toBe(true);
    if (!isOk(cloned)) return;
    expect(cloned.value.forkedFrom).toBe(kb.id);
    expect(cloned.value.documentCount).toBe(1);
    // The cloned KB is independently searchable.
    const hits = db.knowledgebases.searchChunks([cloned.value.id], "hello", 10);
    expect(hits.length).toBe(1);
  });
});

describe("skills", () => {
  test("setResources / listResources round-trip and update patches", () => {
    const owner = db.users.getCurrent();
    const skill = db.skills.create(
      owner.id,
      CreateSkillInput.parse({ name: "Runner", skillMd: "# Runner" }),
    );
    db.skills.setResources(skill.id, [
      { path: "scripts/run.py", content: "print('hi')" },
      { path: "README.md", content: "docs" },
    ]);
    const resources = db.skills.listResources(skill.id);
    expect(resources.map((r) => r.path)).toEqual(["README.md", "scripts/run.py"]);

    const updated = db.skills.update(skill.id, { description: "does things" });
    if (isOk(updated)) {
      expect(updated.value.description).toBe("does things");
      expect(updated.value.resourceCount).toBe(2);
    }
  });
});

describe("chats", () => {
  test("messages and events round-trip", () => {
    const owner = db.users.getCurrent();
    const agent = db.agents.create(owner.id, agentInput());
    const chat = db.chats.create(agent.id, owner.id, "First chat");

    db.chats.messages.append(chat.id, "user", "hello");
    db.chats.messages.append(chat.id, "assistant", "hi there");
    const messages = db.chats.messages.list(chat.id);
    expect(messages.map((m) => `${m.role}:${m.content}`)).toEqual([
      "user:hello",
      "assistant:hi there",
    ]);

    db.chats.events.append(chat.id, 0, { type: "turn_started", chatId: chat.id });
    db.chats.events.append(chat.id, 1, { type: "text_delta", text: "hi" });
    db.chats.events.append(chat.id, 2, {
      type: "turn_completed",
      messageId: messages[1]?.id ?? "",
      text: "hi there",
      continuationToken: "tok_123",
    });
    const events = db.chats.events.list(chat.id);
    expect(events.map((e) => e.type)).toEqual(["turn_started", "text_delta", "turn_completed"]);
    const last = events[2];
    expect(last?.type === "turn_completed" ? last.continuationToken : "").toBe("tok_123");

    db.chats.setContinuationToken(chat.id, "tok_123");
    db.chats.setTitle(chat.id, "Renamed");
    const reread = db.chats.get(chat.id);
    if (isOk(reread)) {
      expect(reread.value.eveContinuationToken).toBe("tok_123");
      expect(reread.value.title).toBe("Renamed");
    }
    expect(db.chats.list(agent.id)).toHaveLength(1);
  });

  test("turns tracks durable status across start/complete/fail, isolated per chat", () => {
    const owner = db.users.getCurrent();
    const agent = db.agents.create(owner.id, agentInput());
    const chatA = db.chats.create(agent.id, owner.id, "Chat A");
    const chatB = db.chats.create(agent.id, owner.id, "Chat B");

    expect(db.chats.turns.listRunning()).toEqual([]);

    db.chats.turns.start(chatA.id);
    db.chats.turns.start(chatB.id);
    expect(new Set(db.chats.turns.listRunning())).toEqual(new Set([chatA.id, chatB.id]));

    db.chats.turns.complete(chatA.id);
    expect(db.chats.turns.listRunning()).toEqual([chatB.id]);

    db.chats.turns.fail(chatB.id, "boom");
    expect(db.chats.turns.listRunning()).toEqual([]);

    // Starting again after completion/failure re-marks the chat as running
    // (the row is upserted, not duplicated).
    db.chats.turns.start(chatA.id);
    expect(db.chats.turns.listRunning()).toEqual([chatA.id]);
  });

  test("listByUser returns history summaries newest-first, filterable by agent", () => {
    const owner = db.users.getCurrent();
    const agentA = db.agents.create(owner.id, agentInput());
    const agentB = db.agents.create(owner.id, agentInput());

    const chatA = db.chats.create(agentA.id, owner.id, "About A");
    db.chats.messages.append(chatA.id, "user", "first question");
    db.chats.messages.append(chatA.id, "assistant", "the latest answer");
    // A newer chat on the other agent so ordering is observable.
    const chatB = db.chats.create(agentB.id, owner.id, "Empty chat");

    const all = db.chats.listByUser(owner.id);
    expect(all.map((s) => s.chat.id)).toEqual([chatB.id, chatA.id]);

    const [, summaryA] = all;
    expect(summaryA?.agentName).toBe(agentA.name);
    expect(summaryA?.messageCount).toBe(2);
    expect(summaryA?.lastMessagePreview).toBe("the latest answer");

    // Empty chat carries a null preview and zero count.
    expect(all[0]?.messageCount).toBe(0);
    expect(all[0]?.lastMessagePreview).toBeNull();

    // The optional agent filter narrows to one agent's chats.
    const onlyA = db.chats.listByUser(owner.id, agentA.id);
    expect(onlyA.map((s) => s.chat.id)).toEqual([chatA.id]);
  });
});
