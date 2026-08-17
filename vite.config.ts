import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig, loadEnv } from "vite";

const packageMetadata = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };
const buildTime = new Date().toISOString();
const generatedBuildVersion = buildTime
  .replace(/[-:]/g, "")
  .replace(/\.\d{3}Z$/, "Z");
const buildVersion =
  process.env.VITE_BUILD_VERSION ??
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ??
  generatedBuildVersion;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const additionalAllowedHosts = (
    env["__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS"] ?? ""
  )
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean)
    .map((host) => {
      try {
        return new URL(host.includes("://") ? host : `https://${host}`).hostname;
      } catch {
        return host;
      }
    });

  return {
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom"],
            storage: ["dexie"],
            supabase: ["@supabase/supabase-js"],
          },
        },
      },
    },
    define: {
      "import.meta.env.APP_VERSION": JSON.stringify(packageMetadata.version),
      "import.meta.env.BUILD_VERSION": JSON.stringify(buildVersion),
      "import.meta.env.BUILD_TIME": JSON.stringify(buildTime),
    },
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      allowedHosts: additionalAllowedHosts,
    },
  };
});
