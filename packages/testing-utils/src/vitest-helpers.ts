import { defineProject, type UserProjectConfigExport } from "vitest/config";

interface ProjectOptions {
  name: string;
  needsContainers?: boolean;
  testTimeout?: number;
}

export function createProjectConfig(
  options: ProjectOptions,
): UserProjectConfigExport {
  return defineProject({
    test: {
      name: options.name,
      restoreMocks: true,
      testTimeout:
        options.testTimeout ?? (options.needsContainers ? 30_000 : 10_000),
      ...(options.needsContainers && {
        globalSetup: [new URL("./globalSetup.ts", import.meta.url).pathname],
      }),
    },
  });
}
