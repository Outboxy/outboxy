/**
 * Injection tokens for Outboxy NestJS module
 */

/** Token for module configuration options */
export const OUTBOXY_MODULE_OPTIONS = Symbol("OUTBOXY_MODULE_OPTIONS");

/** Token for OutboxyClient instance */
export const OUTBOXY_CLIENT = Symbol("OUTBOXY_CLIENT");

/** Token for InboxyClient instance */
export const INBOXY_CLIENT = Symbol("INBOXY_CLIENT");
