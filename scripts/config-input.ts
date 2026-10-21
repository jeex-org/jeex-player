/**
 * The inputs the build, test and site configs read from outside the code:
 * `package.json#version` and the numeric environment knobs (ports, worker
 * counts). Each is judged by one Zod schema here, so a typo fails loudly with
 * the name of the variable instead of turning into `NaN` or `undefined` deep
 * inside a tool.
 *
 * Read by `vite.config.ts`, `vite.lib.config.ts`, `vitest.config.ts`,
 * `playwright.config.ts`, `scripts/schema-gen.ts` and `scripts/site-poster.ts`.
 * Ships nothing: none of this reaches a bundle.
 */

import { readFileSync } from 'node:fs';
import { z } from 'zod';

/** The one field of `package.json` the builds stamp into the bundles and the schemas. */
const packageJsonSchema = z.object({ version: z.string().min(1, { error: 'must be a non-empty string' }) });

/** `package.json#version`, read from the file `url` names; throws naming the file when the field is missing or empty. */
export function readPackageVersion(url: URL): string {
  const parsed: unknown = JSON.parse(readFileSync(url, 'utf8'));
  const result = packageJsonSchema.safeParse(parsed);
  if (!result.success) throw new Error(`${url.pathname}: "version" ${result.error.issues[0]?.message ?? 'is missing'}`);
  return result.data.version;
}

/**
 * A positive integer, coerced from the string an environment variable
 * arrives as. `Number('abc')` is `NaN` and Zod refuses `NaN`, so a typo fails
 * here rather than becoming a port or a worker count of `NaN`.
 */
const positiveIntSchema = z.coerce.number().int().positive();

/** A TCP port: a positive integer no larger than 65535. */
const portSchema = positiveIntSchema.max(65_535);

type Env = Readonly<Record<string, string | undefined>>;

function readNumber(schema: z.ZodType<number>, what: string, name: string, fallback: number, env: Env): number {
  const raw = env[name];
  if (raw === undefined) return fallback;
  const result = schema.safeParse(raw);
  if (!result.success) throw new Error(`${name} must be ${what}, got ${JSON.stringify(raw)}`);
  return result.data;
}

/** `env[name]` as a positive integer, or `fallback` when it is unset; throws naming the variable otherwise. */
export function positiveIntEnv(name: string, fallback: number, env: Env = process.env): number {
  return readNumber(positiveIntSchema, 'a positive integer', name, fallback, env);
}

/** `env[name]` as a TCP port, or `fallback` when it is unset; throws naming the variable otherwise. */
export function portEnv(name: string, fallback: number, env: Env = process.env): number {
  return readNumber(portSchema, 'a port number (1-65535)', name, fallback, env);
}
