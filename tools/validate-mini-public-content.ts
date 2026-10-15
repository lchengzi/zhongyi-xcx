import buildConfig from '../apps/miniprogram/config/public-content-build';

const { publicContentManifest, readPublicContentOrigin } = buildConfig;

// Run before Taro: its configuration loader catches exceptions, so relying on
// that loader alone could leave an old build looking successful.
try {
  const manifest = publicContentManifest(readPublicContentOrigin(process.env));
  console.log(JSON.stringify({ ...manifest, scope: 'build_configuration_only',
    domainOwnershipVerified: false, publicTlsVerified: false,
    wechatRequestDomainVerified: false, actualDeviceVerified: false }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid public content build configuration');
  process.exitCode = 1;
}
