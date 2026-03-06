function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const [key, val] of Object.entries(saved)) {
    if (val === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = val;
    }
  }
}

function saveEnv(keys: string[]): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {};
  for (const key of keys) {
    saved[key] = process.env[key];
  }
  return saved;
}

export function withEnv(env: Record<string, string>, fn: () => void): void {
  const saved = saveEnv(Object.keys(env));
  for (const [key, val] of Object.entries(env)) {
    process.env[key] = val;
  }
  try {
    fn();
  } finally {
    restoreEnv(saved);
  }
}

export function withoutEnv(keys: string[], fn: () => void): void {
  const saved = saveEnv(keys);
  for (const key of keys) {
    delete process.env[key];
  }
  try {
    fn();
  } finally {
    restoreEnv(saved);
  }
}
