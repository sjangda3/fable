# Release checks

Target matrix: macOS 14+ on arm64 and x64; Windows 11 x64. Light mode is the reference target. Release completion requires evidence for each platform rather than a successful cross-compile alone.

## Build

`npm ci`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run make` run on each native runner. Electron Forge rebuilds better-sqlite3 and the file watcher for the packaged runtime. macOS output is a ZIP containing Fable.app; Windows output is a Squirrel installer and ZIP. The app includes Squirrel startup handling.

For signing, import the Developer ID certificate into the CI keychain and provide `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`. Forge signs and notarizes only when these are configured. Windows accepts `WINDOWS_CERTIFICATE_FILE` and `WINDOWS_CERTIFICATE_PASSWORD`. No credentials or certificates are included in this repository.

Before public distribution, complete:

- Native clean-machine install, first launch, folder access, upgrade, and rollback on all three targets.
- Signing, notarization, Gatekeeper/SmartScreen checks, and application icon checks.
- Native window controls, safe close with a pending save, offline launch/edit/reopen, disk failures, and external-edit conflict review.
- Platform-specific visual baselines and keyboard/screen-reader checks. The one-logical-pixel fidelity target is not yet an automated acceptance result.
- Both provider inference, cancellation, quota/authentication errors, malformed/stale proposals, rejection, apply, and undo. Renew the development machine's Claude login first.
- Provider integration eligibility and dependency-license review; original MIT code does not relicense provider SDKs/runtimes.
- Two computers against hosted and self-hosted Supabase with real OTP, Storage, and Edge Functions, interruption/recovery, cross-account rejection, attachment conflicts, revocation, recovery-key unlock, and server plaintext/log inspection.
- Performance with 10,000 notes / 50,000 tasks, including actual renderer frame times and full application launch. Vault benchmarks alone do not establish smooth scrolling or typing.

CI creates build artifacts; it does not automatically publish or deploy the app. No public release, hosted deployment, or remote repository push is performed by local build commands.
