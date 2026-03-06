/**
 * Outboxy NestJS SDK
 *
 * NestJS integration for the Outboxy transactional outbox pattern.
 *
 * @packageDocumentation
 */

// Module
export { OutboxyModule } from "./outboxy.module.js";

// Interfaces
export type {
  OutboxyModuleOptions,
  OutboxyOptionsFactory,
  OutboxyModuleAsyncOptions,
  InboxModuleOptions,
} from "./interfaces/index.js";

// Constants (for advanced DI scenarios)
export {
  OUTBOXY_MODULE_OPTIONS,
  OUTBOXY_CLIENT,
  INBOXY_CLIENT,
} from "./constants.js";

// Re-export core SDK types for convenience
export {
  OutboxyClient,
  InboxyClient,
  OutboxyError,
  OutboxyValidationError,
  OutboxyConnectionError,
  OutboxyDuplicateError,
  type PublishEventInput,
  type OutboxyConfig,
  type InboxyConfig,
  type InboxReceiveEventInput,
  type InboxReceiveResult,
  type QueryFn,
  type AdapterFn,
} from "@outboxy/sdk";
