import { z } from "zod";

export const PullRequestPayload = z.object({
  action: z.string(),
  installation: z.object({ id: z.number() }),
  pull_request: z.object({
    number: z.number(),
    head: z.object({ ref: z.string(), sha: z.string() }),
    base: z.object({ ref: z.string() }),
  }),
  repository: z.object({ full_name: z.string() }),
});

export const InstallationPayload = z.object({
  action: z.enum(["created", "deleted"]),
  installation: z.object({
    id: z.number(),
    account: z.object({
      login: z.string(),
      type: z.string(),
    }),
  }),
  repositories: z.array(z.object({ full_name: z.string() })).optional(),
});

export const InstallationReposPayload = z.object({
  action: z.enum(["added", "removed"]),
  installation: z.object({ id: z.number() }),
  repositories_added: z.array(z.object({ full_name: z.string() })).optional(),
  repositories_removed: z.array(z.object({ full_name: z.string() })).optional(),
});

export const InstallationIdParam = z.coerce.number().int().positive();
