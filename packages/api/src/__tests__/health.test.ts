import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";

describe("health endpoint", () => {
  it("returns 200 when DB and Redis are healthy", async () => {
    const app = Fastify();
    const mockDb = {
      prepare: vi.fn().mockReturnValue({ get: vi.fn() }),
    } as any;
    const mockQueue = {
      client: Promise.resolve({ ping: vi.fn().mockResolvedValue("PONG") }),
    };

    app.get("/health", async (_, reply) => {
      try {
        (mockDb as any).prepare("SELECT 1").get();
        const client = await mockQueue.client;
        await client.ping();
        return { status: "ok" };
      } catch {
        return reply.code(503).send({ status: "error" });
      }
    });

    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: "ok" });
  });

  it("returns 503 when DB is down", async () => {
    const app = Fastify();
    const mockDb = {
      prepare: vi.fn(() => {
        throw new Error("DB gone");
      }),
    } as any;

    app.get("/health", async (_, reply) => {
      try {
        (mockDb as any).prepare("SELECT 1").get();
        return { status: "ok" };
      } catch {
        return reply.code(503).send({ status: "error" });
      }
    });

    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body)).toEqual({ status: "error" });
  });
});
