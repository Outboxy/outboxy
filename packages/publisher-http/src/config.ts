import { z } from "zod";

/**
 * HTTP Publisher configuration schema
 */
export const httpPublisherConfigSchema = z.object({
  /**
   * Request timeout in milliseconds
   * @default 30000 (30 seconds)
   */
  timeoutMs: z.number().int().positive().default(30000),

  /**
   * User-Agent header sent with requests
   * @default "Outboxy-Worker/1.0"
   */
  userAgent: z.string().default("Outboxy-Worker/1.0"),
});

export type HttpPublisherConfig = z.infer<typeof httpPublisherConfigSchema>;
