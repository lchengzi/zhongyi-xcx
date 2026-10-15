import { isIP } from 'node:net';
import { Compilation, sources, type Compiler } from 'webpack';

export const PUBLIC_ORIGIN_ENV = 'FOOD_EDUCATION_PUBLIC_ORIGIN';

/** Build input only. Never spread process.env into a client bundle. This checks
 * address syntax, not domain ownership, TLS trust or WeChat configuration. */
export function readPublicContentOrigin(environment: Readonly<Record<string, string | undefined>>): string | null {
  const input = environment[PUBLIC_ORIGIN_ENV];
  if (input === undefined || input === '') return null;
  const invalid = () => new Error(`${PUBLIC_ORIGIN_ENV}: expected an owned public HTTPS origin, without credentials, path, query or nonstandard port`);
  if (input.length > 253 || !/^https:\/\/[^/?#\\\s]+$/i.test(input)) throw invalid();
  let url: URL;
  try { url = new URL(input); } catch { throw invalid(); }
  const host = url.hostname;
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || isIP(host) !== 0 || host.length > 253 || !host.includes('.')
    || host.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
    || /(?:^|\.)(?:localhost|local|internal|home|lan|test|invalid|example)$/.test(host)
    || /(?:^|\.)example\.(?:com|net|org)$/.test(host)
    || input.toLowerCase().replace(/:443$/, '') !== url.origin) throw invalid();
  return url.origin;
}

export function publicContentManifest(origin: string | null) {
  return Object.freeze({ schemaVersion: 1, protocolVersion: 1,
    mode: origin === null ? 'disabled' : 'configured', origin });
}

/** Emitted in the same compilation as the injected constant; no timestamps,
 * credentials or remote-provided configuration enter this public artifact. */
export class PublicContentManifestPlugin {
  constructor(private readonly origin: string | null) {}
  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap('PublicContentManifest', compilation => {
      compilation.hooks.processAssets.tap({ name: 'PublicContentManifest',
        stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL }, () => {
        compilation.emitAsset('public-content-build.json', new sources.RawSource(
          `${JSON.stringify(publicContentManifest(this.origin), null, 2)}\n`));
      });
    });
  }
}

// Taro loads this directory as CommonJS; root tooling is ESM. A default facade
// provides the same API under both loaders without changing Taro's package type.
export default { PUBLIC_ORIGIN_ENV, readPublicContentOrigin, publicContentManifest, PublicContentManifestPlugin };
