import type { AppEnv } from "./config/env.js";
import type { Repo } from "./db/repo.js";
import type { KmsService } from "./crypto/kms.js";
import type { EmailService } from "./email/ses.js";
import type { TicketService } from "./auth/tickets.js";
import type { OpenAIClient } from "./openai/client.js";

declare module "fastify" {
  interface FastifyInstance {
    env: AppEnv;
    repo: Repo;
    kmsService: KmsService;
    emailService: EmailService;
    ticketService: TicketService;
    openaiClient: OpenAIClient;
  }
}
