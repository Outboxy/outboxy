#!/usr/bin/env tsx
/**
 * Environment Variable Documentation Generator
 *
 * Parses Zod config schemas from config.ts files and generates:
 * - docs/deployment/.env.example (with comments and defaults)
 * - docs/deployment/kubernetes/configmap.yaml (non-secrets only)
 *
 * Usage: pnpm generate:env-docs
 */

import * as fs from "fs";
import * as path from "path";

interface EnvVar {
  name: string;
  envKey: string;
  description: string;
  type: string;
  default?: string;
  required: boolean;
  isSecret: boolean;
}

interface ConfigSection {
  name: string;
  description: string;
  vars: EnvVar[];
}

// Map camelCase config keys to SCREAMING_SNAKE_CASE env vars
function toEnvKey(camelCase: string): string {
  return camelCase
    .replace(/([A-Z])/g, "_$1")
    .toUpperCase()
    .replace(/^_/, "");
}

// Parse a config.ts file and extract environment variables
function parseConfigFile(filePath: string, sectionName: string): ConfigSection {
  const content = fs.readFileSync(filePath, "utf-8");
  const vars: EnvVar[] = [];

  // Match JSDoc comment followed by field definition in Zod schema
  // Using multiline-aware pattern to handle definitions spanning multiple lines
  // Note: handles `z.` or `z\n  .` (line break between z and method call)
  const fieldPattern =
    /\/\*\*\s*([^*]+(?:\*(?!\/)[^*]*)*)\s*\*\/\s*(\w+):\s*z\s*\.([\s\S]+?)(?=\/\*\*|}\s*\)|$)/g;

  let match;
  while ((match = fieldPattern.exec(content)) !== null) {
    const description = match[1]
      .replace(/\s*\*\s*/g, " ")
      .trim()
      .replace(/\s+/g, " ");
    const fieldName = match[2];
    // Clean up the zod definition - remove trailing commas, whitespace
    const zodDefinition = match[3].replace(/,\s*$/, "").trim();

    // Extract type
    let type = "string";
    if (zodDefinition.includes("number()")) type = "number";
    else if (zodDefinition.includes("boolean()")) type = "boolean";
    else if (zodDefinition.includes("enum(")) {
      const enumMatch = zodDefinition.match(/enum\(\[([^\]]+)\]/);
      if (enumMatch) {
        type = `enum: ${enumMatch[1].replace(/"/g, "")}`;
      }
    }

    // Extract default value
    let defaultValue: string | undefined;
    const defaultMatch = zodDefinition.match(/\.default\(([^)]+)\)/);
    if (defaultMatch) {
      defaultValue = defaultMatch[1].replace(/"/g, "").replace(/'/g, "");
    }

    // Check if required (no default and not optional)
    const required =
      !defaultValue &&
      !zodDefinition.includes(".optional()") &&
      !zodDefinition.includes(".default(");

    // Check if this is a secret (contains url, password, key, secret, token)
    const envKey = toEnvKey(fieldName);
    const isSecret =
      /url|password|key|secret|token/i.test(fieldName) ||
      /DATABASE_URL/.test(envKey);

    vars.push({
      name: fieldName,
      envKey,
      description,
      type,
      default: defaultValue,
      required,
      isSecret,
    });
  }

  // Also parse the rawConfig object to get actual env var mappings
  const rawConfigPattern = /const rawConfig = \{([^}]+)\}/s;
  const rawConfigMatch = content.match(rawConfigPattern);

  if (rawConfigMatch) {
    const rawConfigContent = rawConfigMatch[1];
    // Match: fieldName: process.env.ENV_VAR
    const envMappingPattern = /(\w+):\s*process\.env\.(\w+)/g;
    let envMatch;

    while ((envMatch = envMappingPattern.exec(rawConfigContent)) !== null) {
      const fieldName = envMatch[1];
      const actualEnvKey = envMatch[2];

      // Update the envKey for the matching var
      const varToUpdate = vars.find((v) => v.name === fieldName);
      if (varToUpdate) {
        varToUpdate.envKey = actualEnvKey;
      }
    }
  }

  // Debug: show vars found
  if (process.env.DEBUG) {
    console.log(`\n${sectionName} config vars found:`);
    for (const v of vars) {
      console.log(
        `  ${v.envKey}: ${v.type}, default=${v.default}, required=${v.required}`,
      );
    }
  }

  return {
    name: sectionName,
    description: `${sectionName} environment variables`,
    vars,
  };
}

// Generate .env.example content
function generateEnvExample(sections: ConfigSection[]): string {
  const lines: string[] = [
    "# =============================================================================",
    "# OUTBOXY CONFIGURATION",
    "# Generated from config.ts - Run 'pnpm generate:env-docs' to regenerate",
    "# =============================================================================",
    "",
  ];

  // Required section first (deduplicated by envKey)
  const allRequiredVars = sections.flatMap((s) =>
    s.vars.filter((v) => v.required),
  );
  const seenEnvKeys = new Set<string>();
  const requiredVars = allRequiredVars.filter((v) => {
    if (seenEnvKeys.has(v.envKey)) return false;
    seenEnvKeys.add(v.envKey);
    return true;
  });
  if (requiredVars.length > 0) {
    lines.push(
      "# -----------------------------------------------------------------------------",
    );
    lines.push("# Required");
    lines.push(
      "# -----------------------------------------------------------------------------",
    );
    for (const v of requiredVars) {
      lines.push(`# ${v.description}`);
      if (v.isSecret) {
        lines.push(
          `${v.envKey}=postgresql://user:password@localhost:5432/outboxy`,
        );
      } else {
        lines.push(`${v.envKey}=`);
      }
      lines.push("");
    }
  }

  // Then each section (skipping vars already seen in Required or previous sections)
  for (const section of sections) {
    const optionalVars = section.vars.filter(
      (v) => !v.required && !seenEnvKeys.has(v.envKey),
    );
    if (optionalVars.length === 0) continue;

    lines.push(
      "# -----------------------------------------------------------------------------",
    );
    lines.push(`# ${section.name} Configuration`);
    lines.push(
      "# -----------------------------------------------------------------------------",
    );

    for (const v of optionalVars) {
      seenEnvKeys.add(v.envKey);
      lines.push(`# ${v.description}`);
      if (v.type.startsWith("enum:")) {
        lines.push(`# Options: ${v.type.replace("enum: ", "")}`);
      }
      const value = v.default ?? "";
      const comment = v.default ? "" : " # No default";
      lines.push(`${v.envKey}=${value}${comment}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

// Generate Kubernetes ConfigMap YAML
function generateConfigMap(sections: ConfigSection[]): string {
  const allNonSecretVars = sections.flatMap((s) =>
    s.vars.filter((v) => !v.isSecret && !v.required),
  );
  // Deduplicate by envKey
  const seenEnvKeys = new Set<string>();
  const nonSecretVars = allNonSecretVars.filter((v) => {
    if (seenEnvKeys.has(v.envKey)) return false;
    seenEnvKeys.add(v.envKey);
    return true;
  });

  const lines: string[] = [
    "# =============================================================================",
    "# OUTBOXY CONFIGMAP",
    "# Generated from config.ts - Run 'pnpm generate:env-docs' to regenerate",
    "# =============================================================================",
    "apiVersion: v1",
    "kind: ConfigMap",
    "metadata:",
    "  name: outboxy-config",
    "  labels:",
    "    app.kubernetes.io/name: outboxy",
    "data:",
  ];

  for (const v of nonSecretVars) {
    if (v.default !== undefined) {
      lines.push(`  # ${v.description}`);
      lines.push(`  ${v.envKey}: "${v.default}"`);
    }
  }

  return lines.join("\n") + "\n";
}

// Generate Kubernetes Secret YAML template
function generateSecretTemplate(sections: ConfigSection[]): string {
  const allSecretVars = sections.flatMap((s) =>
    s.vars.filter((v) => v.isSecret || v.required),
  );
  // Deduplicate by envKey
  const seenEnvKeys = new Set<string>();
  const secretVars = allSecretVars.filter((v) => {
    if (seenEnvKeys.has(v.envKey)) return false;
    seenEnvKeys.add(v.envKey);
    return true;
  });

  const lines: string[] = [
    "# =============================================================================",
    "# OUTBOXY SECRETS",
    "# Generated from config.ts - Run 'pnpm generate:env-docs' to regenerate",
    "# IMPORTANT: Replace placeholder values before applying!",
    "# =============================================================================",
    "apiVersion: v1",
    "kind: Secret",
    "metadata:",
    "  name: outboxy-secrets",
    "  labels:",
    "    app.kubernetes.io/name: outboxy",
    "type: Opaque",
    "stringData:",
  ];

  for (const v of secretVars) {
    lines.push(`  # ${v.description}`);
    lines.push(`  ${v.envKey}: "REPLACE_ME"`);
  }

  return lines.join("\n") + "\n";
}

// Parse an inline Zod schema (no JSDoc on fields, env vars mapped via .parse())
// Targeted for publisher-factory.ts which uses publisherEnvSchema.parse({...})
function parseInlineSchemaFile(
  filePath: string,
  sectionName: string,
): ConfigSection {
  const content = fs.readFileSync(filePath, "utf-8");
  const vars: EnvVar[] = [];

  // Build description map from function JSDoc: "* - ENV_VAR: description"
  const descMap = new Map<string, string>();
  const jsdocPattern = /\*\s+-\s+(\w+):\s+(.+)/g;
  let jsdocMatch;
  while ((jsdocMatch = jsdocPattern.exec(content)) !== null) {
    descMap.set(jsdocMatch[1], jsdocMatch[2].trim());
  }

  // Extract the Zod object schema block
  const schemaBlockPattern = /z\.object\(\{([\s\S]+?)\}\)/;
  const schemaMatch = content.match(schemaBlockPattern);
  if (!schemaMatch) {
    return {
      name: sectionName,
      description: `${sectionName} environment variables`,
      vars,
    };
  }

  // Parse fields: fieldName: z.chain() — supports multiline chains (e.g. z\n    .enum(...))
  const fieldPattern = /(\w+):\s*z\s*\.([\s\S]+?)(?=\w+:\s*z\s*\.|$)/g;
  let fieldMatch;
  while ((fieldMatch = fieldPattern.exec(schemaMatch[1])) !== null) {
    const fieldName = fieldMatch[1];
    const zodDefinition = fieldMatch[2].replace(/,\s*$/, "").trim();

    const envKey = toEnvKey(fieldName);
    const description =
      descMap.get(envKey) ??
      fieldName
        .replace(/([A-Z])/g, " $1")
        .toLowerCase()
        .trim();

    let type = "string";
    if (zodDefinition.includes("number()")) type = "number";
    else if (zodDefinition.includes("boolean()")) type = "boolean";
    else if (zodDefinition.includes("enum(")) {
      const enumMatch = zodDefinition.match(/enum\(\[([^\]]+)\]/);
      if (enumMatch) {
        type = `enum: ${enumMatch[1].replace(/"/g, "")}`;
      }
    }

    let defaultValue: string | undefined;
    const defaultMatch = zodDefinition.match(/\.default\(([^)]+)\)/);
    if (defaultMatch) {
      defaultValue = defaultMatch[1].replace(/"/g, "").replace(/'/g, "");
    }

    const required =
      !defaultValue &&
      !zodDefinition.includes(".optional()") &&
      !zodDefinition.includes(".default(");

    const isSecret =
      /url|password|key|secret|token/i.test(fieldName) ||
      /DATABASE_URL/.test(envKey);

    vars.push({
      name: fieldName,
      envKey,
      description,
      type,
      default: defaultValue,
      required,
      isSecret,
    });
  }

  if (process.env.DEBUG) {
    console.log(`\n${sectionName} config vars found:`);
    for (const v of vars) {
      console.log(
        `  ${v.envKey}: ${v.type}, default=${v.default}, required=${v.required}`,
      );
    }
  }

  return {
    name: sectionName,
    description: `${sectionName} environment variables`,
    vars,
  };
}

// Main execution
function main() {
  const rootDir = path.resolve(__dirname, "..");
  const docsDeploymentDir = path.join(rootDir, "docs", "deployment");
  const k8sDir = path.join(docsDeploymentDir, "kubernetes");

  // Parse config files (server and publisher first so required vars appear first)
  const sections: ConfigSection[] = [];

  const serverConfigPath = path.join(
    rootDir,
    "packages",
    "server",
    "src",
    "config.ts",
  );
  if (fs.existsSync(serverConfigPath)) {
    sections.push(parseConfigFile(serverConfigPath, "Server"));
  }

  const publisherFactoryPath = path.join(
    rootDir,
    "packages",
    "server",
    "src",
    "publisher-factory.ts",
  );
  if (fs.existsSync(publisherFactoryPath)) {
    sections.push(parseInlineSchemaFile(publisherFactoryPath, "Publisher"));
  }

  const apiConfigPath = path.join(
    rootDir,
    "packages",
    "api",
    "src",
    "config.ts",
  );
  if (fs.existsSync(apiConfigPath)) {
    sections.push(parseConfigFile(apiConfigPath, "API"));
  }

  const workerConfigPath = path.join(
    rootDir,
    "packages",
    "worker",
    "src",
    "config.ts",
  );
  if (fs.existsSync(workerConfigPath)) {
    sections.push(parseConfigFile(workerConfigPath, "Worker"));
  }

  // Generate outputs
  const envExample = generateEnvExample(sections);
  const configMap = generateConfigMap(sections);
  const secretTemplate = generateSecretTemplate(sections);

  // Write files
  fs.writeFileSync(path.join(docsDeploymentDir, ".env.example"), envExample);
  console.log("✓ Generated docs/deployment/.env.example");

  fs.writeFileSync(path.join(k8sDir, "configmap.yaml"), configMap);
  console.log("✓ Generated docs/deployment/kubernetes/configmap.yaml");

  fs.writeFileSync(path.join(k8sDir, "secret.yaml"), secretTemplate);
  console.log("✓ Generated docs/deployment/kubernetes/secret.yaml");

  // Summary
  const totalVars = sections.reduce((sum, s) => sum + s.vars.length, 0);
  const requiredVars = sections.reduce(
    (sum, s) => sum + s.vars.filter((v) => v.required).length,
    0,
  );
  const secretVars = sections.reduce(
    (sum, s) => sum + s.vars.filter((v) => v.isSecret).length,
    0,
  );

  console.log("\nSummary:");
  console.log(`  Total environment variables: ${totalVars}`);
  console.log(`  Required: ${requiredVars}`);
  console.log(`  Secrets: ${secretVars}`);
  console.log(`  Optional with defaults: ${totalVars - requiredVars}`);
}

main();
