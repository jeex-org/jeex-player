/**
 * The part of the Khronos glTF Validator's npm API the conformance test uses;
 * the package ships plain JavaScript without type declarations.
 */
declare module 'gltf-validator' {
  export type ValidationOptions = {
    uri?: string;
    format?: 'glb' | 'gltf';
    writeTimestamp?: boolean;
    maxIssues?: number;
    ignoredIssues?: string[];
    onlyIssues?: string[];
    severityOverrides?: Record<string, number>;
  };
  export function validateBytes(data: Uint8Array, options?: ValidationOptions): Promise<unknown>;
  export function version(): string;
  export function supportedExtensions(): string[];
}
