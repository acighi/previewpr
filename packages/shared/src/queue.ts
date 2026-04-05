import { Queue, Worker, type Processor } from "bullmq";
import type { PipelineJobData } from "./types.js";

export const QUEUE_NAME = "previewpr-pipeline";

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: "exponential" as const,
    delay: 60000,
  },
};

function parseRedisUrl(redisUrl: string): {
  host: string;
  port: number;
  db?: number;
  password?: string;
} {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    ...(url.pathname.length > 1 ? { db: Number(url.pathname.slice(1)) } : {}),
    ...(url.password ? { password: url.password } : {}),
  };
}

export function createQueue(redisUrl: string): Queue<PipelineJobData> {
  const connection = parseRedisUrl(redisUrl);
  return new Queue<PipelineJobData>(QUEUE_NAME, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
}

export function createWorkerProcessor(
  redisUrl: string,
  processor: Processor<PipelineJobData>,
): Worker<PipelineJobData> {
  const connection = parseRedisUrl(redisUrl);
  return new Worker<PipelineJobData>(QUEUE_NAME, processor, {
    connection,
    concurrency: 2,
    lockDuration: 600_000, // 10 min — pipeline runs up to 5 min
    lockRenewTime: 150_000, // renew every 2.5 min
  });
}
