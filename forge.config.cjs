const { execFileSync } = require("node:child_process");
module.exports = {
  packagerConfig: {
    name: "Fable",
    executableName: "Fable",
    appBundleId: "app.fable.desktop",
    appCategoryType: "public.app-category.productivity",
    asar: true,
    icon: "./public/fable",
    ignore: [
      /^\/\.fable-dev/,
      /^\/artifacts/,
      /^\/out/,
      /^\/tests/,
      /^\/packages/,
      /^\/apps/,
      /^\/scripts/,
      /^\/supabase/,
      /^\/\.github/,
      /^\/\.git(?:\/|$)/,
      /^\/node_modules\/@anthropic-ai\/claude-agent-sdk-(darwin|win32|linux)/,
    ],
    ...(process.env.APPLE_ID
      ? {
          osxSign: {},
          osxNotarize: {
            appleId: process.env.APPLE_ID,
            appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
            teamId: process.env.APPLE_TEAM_ID,
          },
        }
      : {}),
  },
  rebuildConfig: {},
  makers: [
    { name: "@electron-forge/maker-zip", platforms: ["darwin", "win32"] },
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "Fable",
        authors: "Fable contributors",
        description: "Your notes, tasks, and projects in Markdown.",
        setupIcon: "./public/fable.ico",
        ...(process.env.WINDOWS_CERTIFICATE_FILE
          ? {
              certificateFile: process.env.WINDOWS_CERTIFICATE_FILE,
              certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD,
            }
          : {}),
      },
    },
  ],
  plugins: [{ name: "@electron-forge/plugin-auto-unpack-natives", config: {} }],
  hooks: {
    generateAssets: async () => {
      execFileSync(
        process.platform === "win32" ? "npm.cmd" : "npm",
        ["run", "build"],
        { stdio: "inherit", shell: process.platform === "win32" },
      );
    },
  },
};
